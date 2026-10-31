use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::{mpsc, watch};
use vesta_server_client::model::from_wire;

#[path = "worker_console.rs"]
mod worker_console;

struct SocketTask {
    task: tauri::async_runtime::JoinHandle<()>,
}
impl Drop for SocketTask {
    fn drop(&mut self) {
        self.task.abort();
    }
}
#[derive(Debug)]
enum StreamMessage {
    Console(Value),
    History {
        page: ConsolePage,
        discontinuity: bool,
    },
    Ended(ServerTopic, Option<Error>),
}
fn blocked(code: ErrorCode) -> bool {
    matches!(
        code,
        ErrorCode::CredentialsRejected
            | ErrorCode::CredentialsUnavailable
            | ErrorCode::FingerprintMismatch
            | ErrorCode::Forbidden
            | ErrorCode::NoManagementAccess
    )
}

impl ServerManager {
    pub(super) async fn run_worker(self: Arc<Self>, app: AppHandle, id: String) {
        let observe = self.clone().observe_worker(app, id.clone());
        let idle = async {
            let mut idle_since = None;
            loop {
                if [
                    ServerTopic::Status,
                    ServerTopic::Console,
                    ServerTopic::Metrics,
                    ServerTopic::Operations,
                ]
                .iter()
                .any(|topic| self.demanded(&id, *topic))
                {
                    idle_since = None;
                } else if idle_since.get_or_insert_with(Instant::now).elapsed()
                    >= Duration::from_secs(2)
                {
                    return;
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        };
        // Also cancel a hung observation when its last subscriber goes away.
        tokio::select! { _ = observe => {}, _ = idle => {} }
    }
    async fn observe_worker(self: Arc<Self>, app: AppHandle, id: String) {
        // Four streaming servers; waiting owners do no background work and can
        // be cancelled as soon as their last subscriber leaves.
        let permit = loop {
            if ![
                ServerTopic::Status,
                ServerTopic::Console,
                ServerTopic::Metrics,
                ServerTopic::Operations,
            ]
            .iter()
            .any(|t| self.demanded(&id, *t))
            {
                return;
            }
            match self.streaming.clone().try_acquire_owned() {
                Ok(p) => break p,
                Err(_) => tokio::time::sleep(Duration::from_millis(250)).await,
            }
        };
        let _permit = permit;
        // Abort-on-drop ownership includes the console controller and sockets.
        let manager = self.clone();
        let console_app = app.clone();
        let console_id = id.clone();
        let _console = SocketTask {
            task: tauri::async_runtime::spawn(async move {
                worker_console::run(manager, console_app, console_id).await;
            }),
        };
        let _ = self.refresh(&app, &id, false).await;
        self.resume_operations(&app, &id).await;
        let (send, mut recv) = mpsc::channel(8);
        let (latest, mut metrics) = watch::channel::<Option<Value>>(None);
        let (latest_status, mut status_stream) = watch::channel::<Option<Value>>(None);
        let overflow = Arc::new(AtomicBool::new(false));
        let mut telemetry: Option<SocketTask> = None;
        let mut metrics_retry = Instant::now();
        let mut metrics_stopped = false;
        let mut metrics_stream_disabled = false;
        let mut metrics_failures = 0_u32;
        let mut players_generation: Option<String> = None;
        let mut players_count: Option<u32> = None;
        let mut players_revision: Option<String> = None;
        let mut players_retry = Instant::now();
        let mut last_status = Instant::now() - Duration::from_secs(60);
        let mut last_metrics_poll = Instant::now() - Duration::from_secs(60);
        let mut last_operation_poll = Instant::now() - Duration::from_secs(60);
        let mut last_stream_status: Option<Instant> = None;
        let mut idle_since = None;
        let mut status_blocked = false;
        let mut client_failures = 0u32;
        let mut client_retry = Instant::now();
        loop {
            // Slow observations cannot hold up the independent console drain.
            tokio::time::sleep(if self.demanded(&id, ServerTopic::Metrics) {
                Duration::from_millis(250)
            } else {
                Duration::from_secs(1)
            })
            .await;
            if let Ok(mut subs) = self.subscriptions.lock() {
                subs.flush(&id);
            }
            let want_console = self.demanded(&id, ServerTopic::Console);
            let want_status = self.demanded(&id, ServerTopic::Status);
            let want_metrics = self.demanded(&id, ServerTopic::Metrics);
            let want_ops = self.demanded(&id, ServerTopic::Operations);
            if !want_console && !want_status && !want_metrics && !want_ops {
                let idle = idle_since.get_or_insert_with(Instant::now);
                if idle.elapsed() > Duration::from_secs(2) {
                    break;
                }
                continue;
            }
            idle_since = None;
            if !want_status && !want_metrics {
                telemetry = None;
            }
            if Instant::now() < client_retry {
                continue;
            }
            let client = match self.client(&id).await {
                Ok(c) => {
                    client_failures = 0;
                    c
                }
                Err(error) => {
                    self.synchronize_failure(&app, &id, &error).await;
                    client_failures = client_failures.saturating_add(1);
                    let Some(delay) = vesta_server_client::retry::client_reconstruction_delay(
                        error.code,
                        client_failures,
                    ) else {
                        break;
                    };
                    client_retry = Instant::now() + delay;
                    continue;
                }
            };
            let snapshot = match self.record(&id).await {
                Ok(r) => r.snapshot,
                Err(_) => break,
            };
            if snapshot
                .state
                .rate_limited_until_ms
                .is_some_and(|t| t > vesta_server_client::now_ms())
            {
                continue;
            }
            if (want_status || want_metrics)
                && snapshot.capabilities.granted.iter().any(|cap| cap == "metrics.view")
                && telemetry.is_none()
                && !metrics_stopped
                && !metrics_stream_disabled
                && Instant::now() >= metrics_retry
            {
                telemetry = Some(spawn_socket(
                    client.clone(),
                    ServerTopic::Metrics,
                    send.clone(),
                    latest.clone(),
                    latest_status.clone(),
                    overflow.clone(),
                ));
            }
            while let Ok(message) = recv.try_recv() {
                if let StreamMessage::Ended(topic, error) = message {
                    let code = error.as_ref().map(|e| e.code);
                    if let Some(error) = error.as_ref() {
                        self.synchronize_failure(&app, &id, error).await;
                    }
                    metrics_failures = metrics_failures.saturating_add(1);
                    let delay = (2_u64.saturating_pow(metrics_failures.min(5)) * 2).min(60);
                    let delay = (delay + u64::from(rand::random::<u8>() % 5)).min(60);
                    telemetry = None;
                    last_stream_status = None;
                    metrics_retry = Instant::now()
                        + Duration::from_secs(delay).max(Duration::from_millis(
                            error.as_ref().and_then(|e| e.retry_after_ms).unwrap_or(0),
                        ));
                    metrics_stopped = code.is_some_and(blocked);
                    metrics_stream_disabled = code
                        .is_some_and(|c| matches!(c, ErrorCode::Unsupported | ErrorCode::NotFound));
                    self.deliver(&id, topic, ServerEvent::Resync { topic });
                }
            }
            if status_stream.has_changed().unwrap_or(false) {
                let event = status_stream.borrow_and_update().clone();
                if let Some(v) = event {
                    if matches!(v["type"].as_str(), Some("status" | "server.status")) {
                        let value = v
                            .get("data")
                            .or_else(|| v.get("status"))
                            .cloned()
                            .unwrap_or(v.clone());
                        if let Ok(status) = from_wire::<ServerStatus>(value) {
                            if status.validate().is_err() {
                                continue;
                            }
                            metrics_failures = 0;
                            let mut snapshot = self
                                .record(&id)
                                .await
                                .map(|r| r.snapshot)
                                .unwrap_or(snapshot.clone());
                            snapshot.status = Some(status);
                            snapshot.status_observed_at_ms = Some(vesta_server_client::now_ms());
                            snapshot.state = online_state(client.transport.scheduler.paused_for());
                            let _ = self.publish_observation(&app, snapshot).await;
                            last_stream_status = Some(Instant::now());
                            last_status = Instant::now();
                        }
                    }
                }
            }
            if metrics.has_changed().unwrap_or(false) {
                if let Some(v) = metrics.borrow_and_update().clone() {
                    match v["type"].as_str() {
                        Some("metrics.snapshot" | "metrics.sample") => {
                            metrics_failures = 0;
                            if let Some(sample) = metric_sample(&v) {
                                self.deliver(
                                    &id,
                                    ServerTopic::Metrics,
                                    ServerEvent::Metrics { sample },
                                );
                            }
                        }
                        Some("metrics.player_activity" | "heartbeat") => {}
                        _ => self.deliver(
                            &id,
                            ServerTopic::Metrics,
                            ServerEvent::Resync {
                                topic: ServerTopic::Metrics,
                            },
                        ),
                    }
                }
            }
            if want_status && Instant::now() >= players_retry {
                if let Ok(record) = self.record(&id).await {
                    if let Some(status) = record.snapshot.status.as_ref() {
                        if status.state == "running"
                            && status.readiness == "ready"
                            && record
                                .snapshot
                                .capabilities
                                .granted
                                .iter()
                                .any(|c| c == "players.view")
                            && (players_generation != status.generation
                                || players_count != status.player_count
                                || players_revision != status.player_roster_revision)
                        {
                            players_retry = Instant::now() + Duration::from_secs(30);
                            if let Ok(players) = client.players().await {
                                let Ok(current_record) = self.record(&id).await else {
                                    break;
                                };
                                let current_status = current_record.snapshot.status.as_ref();
                                // A slow roster read must not restore an older
                                // generation/revision or cross a trust replacement.
                                if !self.demanded(&id, ServerTopic::Status)
                                    || current_record.snapshot.connection.fingerprint
                                        != record.snapshot.connection.fingerprint
                                    || current_status.is_none_or(|current| {
                                        current.generation != status.generation
                                            || current.player_roster_revision
                                                != status.player_roster_revision
                                            || current.state != "running"
                                            || current.readiness != "ready"
                                    })
                                    || matches!(&players, PlayersView::Known { generation, .. }
                                        if Some(generation) != status.generation.as_ref())
                                {
                                    continue;
                                }
                                if let Ok(slot) = self.slot(&id) {
                                    if let Ok(mut cache) = slot.players.lock() {
                                        *cache = Some(players.clone());
                                    }
                                }
                                // Remember the triggering status even for an unknown
                                // roster. Feeding the returned count into status made
                                // old agents alternate null/count and refetch forever.
                                // Only a new authoritative status fact triggers a read.
                                players_generation = status.generation.clone();
                                players_count = status.player_count;
                                players_revision = status.player_roster_revision.clone();
                                players_retry = Instant::now() + Duration::from_secs(1);
                                self.deliver(
                                    &id,
                                    ServerTopic::Status,
                                    ServerEvent::Players { players },
                                );
                            }
                        } else if status.state == "stopped" && players_generation.take().is_some() {
                            players_count = None;
                            if let Ok(slot) = self.slot(&id) {
                                if let Ok(mut players) = slot.players.lock() {
                                    *players = Some(PlayersView::Unknown { known: false });
                                }
                            }
                            self.deliver(
                                &id,
                                ServerTopic::Status,
                                ServerEvent::Players {
                                    players: PlayersView::Unknown { known: false },
                                },
                            );
                        }
                    }
                }
            }
            // Once a live socket proves status support, it owns observation.
            // Older agents and disconnected sockets retain bounded polling.
            if want_status
                && !status_blocked
                && !(last_stream_status.is_some() && telemetry.is_some())
                && last_status.elapsed() >= Duration::from_secs(10)
            {
                last_status = Instant::now();
                if let Err(e) = self.refresh(&app, &id, false).await {
                    status_blocked = blocked(e.code);
                }
            }
            if want_metrics
                && snapshot.capabilities.granted.iter().any(|cap| cap == "metrics.view")
                && telemetry.is_none()
                && !metrics_stopped
                && last_metrics_poll.elapsed() >= Duration::from_secs(10)
            {
                last_metrics_poll = Instant::now();
                match client.get("metrics/current", false, "metrics.view").await {
                    Ok(v) => {
                        if let Some(sample) = metric_sample(&v) {
                            self.deliver(
                                &id,
                                ServerTopic::Metrics,
                                ServerEvent::Metrics { sample },
                            );
                        }
                    }
                    Err(e) => {
                        metrics_stopped = blocked(e.code);
                    }
                }
            }
            if want_ops
                && snapshot.capabilities.granted.iter().any(|cap| cap == "tasks.view")
                && !self.tracks_operations(&id)
                && last_operation_poll.elapsed() >= Duration::from_secs(10)
            {
                last_operation_poll = Instant::now();
                // List once per visible observation interval, never per window.
                if let Ok(page) = client.operations_with_priority(None, false).await {
                    for mut operation in page.items {
                        self.decorate_operation(&id, &mut operation).await;
                        self.deliver(
                            &id,
                            ServerTopic::Operations,
                            ServerEvent::Operation { operation },
                        );
                    }
                }
            }
        }
    }
}
fn spawn_socket(
    client: Arc<Client>,
    topic: ServerTopic,
    sender: mpsc::Sender<StreamMessage>,
    latest: watch::Sender<Option<Value>>,
    latest_status: watch::Sender<Option<Value>>,
    overflow: Arc<AtomicBool>,
) -> SocketTask {
    let task = tauri::async_runtime::spawn(async move {
        let mut code = None;
        match client.socket(topic).await {
            Ok(mut socket) => {
                // Session renewal may hold the client mutex across slow I/O.
                // Resolve its deadline concurrently with reads, once per socket.
                let renewal = async {
                    tokio::time::sleep(client.renewal_delay().await).await;
                };
                tokio::pin!(renewal);
                loop {
                    let next = tokio::select! {
                        _=&mut renewal=>break,
                        next=tokio::time::timeout(Duration::from_secs(35),socket.next())=>next,
                    };
                    match next {
                        Ok(Some(Ok(message))) => {
                            // Avoid a version dependency on tungstenite in the host.
                            if message.is_ping() || message.is_pong() {
                                if tokio::time::timeout(Duration::from_secs(2), socket.flush())
                                    .await
                                    .is_err()
                                {
                                    break;
                                }
                                continue;
                            }
                            if message.is_close() {
                                break;
                            }
                            if let Ok(text) = message.to_text() {
                                if let Ok(value) = serde_json::from_str::<Value>(text) {
                                    if topic == ServerTopic::Console {
                                        if sender.try_send(StreamMessage::Console(value)).is_err() {
                                            overflow.store(true, Ordering::Relaxed);
                                        }
                                    } else if matches!(
                                        value["type"].as_str(),
                                        Some("status" | "server.status")
                                    ) {
                                        latest_status.send_replace(Some(value));
                                    } else {
                                        latest.send_replace(Some(value));
                                    }
                                } else {
                                    overflow.store(true, Ordering::Relaxed);
                                }
                            }
                        }
                        _ => break,
                    }
                }
            }
            Err(e) => {
                code = Some(e);
            }
        }
        let _ = sender.send(StreamMessage::Ended(topic, code)).await;
    });
    SocketTask { task }
}
fn metric_sample(v: &Value) -> Option<MetricsSample> {
    let columns = v.get("columns").unwrap_or(v);
    let timestamps = columns["timestamps"].as_array()?;
    let i = timestamps.len().checked_sub(1)?;
    let value = |name: &str| {
        columns["series"][name]["avg"]
            .get(i)
            .and_then(Value::as_f64)
            .filter(|n| n.is_finite() && *n >= 0.)
    };
    Some(MetricsSample {
        at_ms: timestamps[i].as_i64()?,
        cpu_percent: value("game_cpu_percent"),
        memory_used_bytes: value("game_memory_bytes").map(|v| format!("{v:.0}")),
        memory_max_bytes: None,
        tps: value("tps"),
        mspt: value("mspt"),
        players_online: value("players_online").map(|v| v as u32),
    })
}
