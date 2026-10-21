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
    Ended(ServerTopic, Option<ErrorCode>),
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
        let (send, mut recv) = mpsc::channel(64);
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
        let mut last_status = Instant::now() - Duration::from_secs(60);
        let mut last_console_page = Instant::now() - Duration::from_secs(60);
        let mut last_metrics_poll = Instant::now() - Duration::from_secs(60);
        let mut last_operation_poll = Instant::now() - Duration::from_secs(60);
        let mut last_stream_status: Option<Instant> = None;
        let mut idle_since = None;
        let mut status_blocked = false;
        let mut tick = tokio::time::interval(Duration::from_millis(100));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
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
            let client = match self.client(&id).await {
                Ok(c) => c,
                Err(_) => {
                    let _ = self.refresh(&app, &id, false).await;
                    break;
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
            let mut lines = Vec::new();
            let mut estimated = 0;
            // Max 64 messages and 48 KiB payload per batch, leaving JSON overhead.
            for _ in 0..64 {
                let message = match recv.try_recv() {
                    Ok(v) => v,
                    Err(_) => break,
                };
                match message {
                    StreamMessage::Ended(topic, code) => {
                        if let Some(code) = code {
                            self.synchronize_failure(&app, &id, &Error::new(code)).await;
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
                                    overflow.store(true, Ordering::Relaxed);
                                    continue;
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
                            if last_console_page.elapsed() >= Duration::from_secs(10) {
                                last_console_page = Instant::now();
                                // Exactly one bounded recovery page; never chase a noisy stream.
                                if let Ok(page) =
                                    client.console_page_with_priority(None, 100, false).await
                                {
                                    for line in page.items {
                                        ring.push(line.clone());
                                        lines.push(line);
                                    }
                                }
                            }
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
            if overflow.swap(false, Ordering::Relaxed) || ring.take_gap() {
                self.deliver(
                    &id,
                    ServerTopic::Console,
                    ServerEvent::Resync {
                        topic: ServerTopic::Console,
                    },
                );
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
                            snapshot.state = ConnectionState {
                                phase: "online".into(),
                                ..Default::default()
                            };
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
                        self.deliver(
                            &id,
                            ServerTopic::Console,
                            ServerEvent::Console { lines: page.items },
                        );
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
                code = Some(e.code);
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
