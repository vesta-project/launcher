use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::{mpsc, watch};
use vesta_server_client::model::from_wire;

struct SocketTask {
    task: tauri::async_runtime::JoinHandle<()>,
}
impl Drop for SocketTask {
    fn drop(&mut self) {
        self.task.abort();
    }
}
enum StreamMessage {
    Console(Value),
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
    fn deliver_console_page(&self, id: &str, lines: Vec<ConsoleLine>, history: bool) {
        let mut batch = Vec::new();
        let mut bytes = 0;
        for line in lines {
            let size = serde_json::to_vec(&line).map_or(64 * 1024, |v| v.len() + 1);
            if bytes + size > 48 * 1024 && !batch.is_empty() {
                let lines = std::mem::take(&mut batch);
                self.deliver(
                    id,
                    ServerTopic::Console,
                    if history {
                        ServerEvent::ConsoleHistory { lines }
                    } else {
                        ServerEvent::Console { lines }
                    },
                );
                bytes = 0;
            }
            bytes += size;
            batch.push(line);
        }
        if !batch.is_empty() {
            self.deliver(
                id,
                ServerTopic::Console,
                if history {
                    ServerEvent::ConsoleHistory { lines: batch }
                } else {
                    ServerEvent::Console { lines: batch }
                },
            );
        }
    }
    pub(super) async fn run_worker(self: Arc<Self>, app: AppHandle, id: String) {
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
        let _ = self.refresh(&app, &id, false).await;
        self.resume_operations(&app, &id).await;
        let (send, mut recv) = mpsc::channel(1024);
        let (latest, mut metrics) = watch::channel::<Option<Value>>(None);
        let (latest_status, mut status_stream) = watch::channel::<Option<Value>>(None);
        let overflow = Arc::new(AtomicBool::new(false));
        let mut console: Option<SocketTask> = None;
        let mut telemetry: Option<SocketTask> = None;
        let mut console_retry = Instant::now();
        let mut metrics_retry = Instant::now();
        let mut console_stopped = false;
        let mut metrics_stopped = false;
        let mut console_stream_disabled = false;
        let mut metrics_stream_disabled = false;
        let mut console_failures = 0_u32;
        let mut metrics_failures = 0_u32;
        let mut ring = ConsoleRing::default();
        let mut players_generation: Option<String> = None;
        let mut players_count: Option<u32> = None;
        let mut players_revision: Option<String> = None;
        let mut players_retry = Instant::now();
        let mut console_recovery: Option<String> = None;
        let mut console_recovery_failures = 0_u32;
        let mut last_status = Instant::now() - Duration::from_secs(60);
        let mut last_console_page = Instant::now() - Duration::from_secs(60);
        let mut last_metrics_poll = Instant::now() - Duration::from_secs(60);
        let mut last_operation_poll = Instant::now() - Duration::from_secs(60);
        let mut last_stream_status: Option<Instant> = None;
        let mut idle_since = None;
        let mut status_blocked = false;
        let mut client_failures = 0u32;
        let mut client_retry = Instant::now();
        loop {
            // Console delivery stays responsive; status-only views do not wake
            // ten times per second just to check for one-second observations.
            tokio::time::sleep(if self.demanded(&id, ServerTopic::Console) {
                Duration::from_millis(100)
            } else if self.demanded(&id, ServerTopic::Metrics) {
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
            if !want_console {
                console = None;
            }
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
            if want_console
                && console.is_none()
                && !console_stopped
                && !console_stream_disabled
                && Instant::now() >= console_retry
            {
                console = Some(spawn_socket(
                    client.clone(),
                    ServerTopic::Console,
                    send.clone(),
                    latest.clone(),
                    latest_status.clone(),
                    overflow.clone(),
                ));
            }
            if (want_status || want_metrics)
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
            let recovery_floor = ring.lines().back().map(|l| l.cursor.clone());
            let mut lines = Vec::new();
            let mut estimated = 0;
            // Max 64 messages and 48 KiB payload per batch, leaving JSON overhead.
            for _ in 0..64 {
                let message = match recv.try_recv() {
                    Ok(v) => v,
                    Err(_) => break,
                };
                match message {
                    StreamMessage::Ended(topic, error) => {
                        let code = error.as_ref().map(|e| e.code);
                        if let Some(error) = error.as_ref() {
                            self.synchronize_failure(&app, &id, error).await;
                        }
                        let failures = if topic == ServerTopic::Console {
                            &mut console_failures
                        } else {
                            &mut metrics_failures
                        };
                        *failures = failures.saturating_add(1);
                        let delay = (2_u64.saturating_pow((*failures).min(5)) * 2).min(60);
                        let delay = (delay + u64::from(rand::random::<u8>() % 5)).min(60);
                        let unavailable = code.is_some_and(|c| {
                            matches!(c, ErrorCode::Unsupported | ErrorCode::NotFound)
                        });
                        if topic == ServerTopic::Console {
                            console_recovery = console_recovery.or_else(|| recovery_floor.clone());
                            console = None;
                            console_retry = Instant::now() + Duration::from_secs(delay);
                            console_stopped = code.is_some_and(blocked);
                            console_stream_disabled = unavailable;
                        } else {
                            telemetry = None;
                            last_stream_status = None;
                            metrics_retry = Instant::now() + Duration::from_secs(delay);
                            metrics_stopped = code.is_some_and(blocked);
                            metrics_stream_disabled = unavailable;
                        }
                        self.deliver(&id, topic, ServerEvent::Resync { topic });
                    }
                    StreamMessage::Console(v) => match v["type"].as_str() {
                        Some("console.line") => {
                            if let Ok(line) = from_wire::<ConsoleLine>(v) {
                                console_failures = 0;
                                let bytes = line.text.len() + line.cursor.len() + 128;
                                if estimated + bytes > 48 * 1024 {
                                    self.deliver(
                                        &id,
                                        ServerTopic::Console,
                                        ServerEvent::Console {
                                            lines: std::mem::take(&mut lines),
                                        },
                                    );
                                    estimated = 0;
                                }
                                estimated += bytes;
                                ring.push(line.clone());
                                lines.push(line);
                            }
                        }
                        Some("console.gap") => {
                            self.deliver(
                                &id,
                                ServerTopic::Console,
                                ServerEvent::ConsoleGap {
                                    cursor: v["cursor"].as_str().unwrap_or("").into(),
                                },
                            );
                            console_recovery = console_recovery.or_else(|| recovery_floor.clone());
                        }
                        Some("console.available" | "heartbeat") => {}
                        _ => self.deliver(
                            &id,
                            ServerTopic::Console,
                            ServerEvent::Resync {
                                topic: ServerTopic::Console,
                            },
                        ),
                    },
                }
            }
            if !lines.is_empty() {
                self.deliver(&id, ServerTopic::Console, ServerEvent::Console { lines });
            }
            // Evicting already-delivered history is normal retention, not data loss.
            let _ = ring.take_gap();
            if overflow.swap(false, Ordering::Relaxed) {
                console_recovery = console_recovery.or_else(|| recovery_floor.clone());
                self.deliver(
                    &id,
                    ServerTopic::Console,
                    ServerEvent::Resync {
                        topic: ServerTopic::Console,
                    },
                );
            }
            if let Some(cursor) = console_recovery.clone() {
                if last_console_page.elapsed() >= Duration::from_secs(1) {
                    last_console_page = Instant::now();
                    let recovered = match client
                        .console_page_with_priority(Some(&cursor), 200, false)
                        .await
                    {
                        Err(error)
                            if matches!(
                                error.code,
                                ErrorCode::Conflict | ErrorCode::InvalidInput
                            ) =>
                        {
                            client.console_page_with_priority(None, 200, false).await
                        }
                        result => result,
                    };
                    if let Ok(page) = &recovered {
                        console_recovery_failures = 0;
                        console_recovery = page
                            .next_cursor
                            .clone()
                            .filter(|next| next != &page.latest_cursor && next != &cursor);
                        if !page.items.is_empty() {
                            self.deliver_console_page(&id, page.items.clone(), true);
                        }
                    } else if let Err(error) = recovered {
                        if blocked(error.code) {
                            console_recovery = None;
                        } else {
                            console_recovery_failures = console_recovery_failures.saturating_add(1);
                            let backoff = (2_u64.pow(console_recovery_failures.min(5)) * 1000)
                                .max(error.retry_after_ms.unwrap_or(0));
                            last_console_page =
                                Instant::now() + Duration::from_millis(backoff.min(3_600_000));
                        }
                    }
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
                            if let Ok(players) = self.players(&id).await {
                                if let PlayersView::Known {
                                    generation,
                                    player_count,
                                    ..
                                } = &players
                                {
                                    players_generation = Some(generation.clone());
                                    players_count = Some(*player_count);
                                    players_revision = status.player_roster_revision.clone();
                                    players_retry = Instant::now() + Duration::from_secs(1);
                                    let mut updated = record.snapshot.clone();
                                    if let Some(current) = updated.status.as_mut() {
                                        current.player_count = Some(*player_count);
                                        current.player_count_known = true;
                                        current.player_count_observed_at_ms =
                                            Some(vesta_server_client::now_ms());
                                    }
                                    let _ = self.publish_observation(&app, updated).await;
                                }
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
            if want_console
                && console.is_none()
                && !console_stopped
                && last_console_page.elapsed() >= Duration::from_secs(10)
            {
                last_console_page = Instant::now();
                let cursor = ring.lines().back().map(|l| l.cursor.clone());
                match client
                    .console_page_with_priority(cursor.as_deref(), 100, false)
                    .await
                {
                    Ok(page) => {
                        for line in &page.items {
                            ring.push(line.clone());
                        }
                        self.deliver_console_page(&id, page.items, true);
                    }
                    Err(e) => {
                        console_stopped = blocked(e.code);
                    }
                }
            }
            if want_metrics
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
            if want_ops && last_operation_poll.elapsed() >= Duration::from_secs(10) {
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
            Ok(mut socket) => loop {
                let renewal = client.renewal_delay().await;
                let next = tokio::select! {
                    _=tokio::time::sleep(renewal)=>break,
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
            },
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
