use std::{
    collections::{HashMap, VecDeque},
    time::{Duration, Instant},
};
use tauri::ipc::Channel;
use vesta_server_client::{
    model::{ServerEvent, ServerTopic},
    Error, ErrorCode, Result,
};

struct Subscription {
    connection: String,
    topic: ServerTopic,
    window: String,
    channel: Channel<ServerEvent>,
    pending: VecDeque<(ServerEvent, usize)>,
    bytes: usize,
    last_sent: Option<Instant>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use vesta_server_client::model::ConsoleLine;
    fn channel(output: Arc<Mutex<Vec<serde_json::Value>>>) -> Channel<ServerEvent> {
        Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                output
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str(&json).unwrap());
            }
            Ok(())
        })
    }
    #[test]
    fn overflow_resync_and_delivery_are_bounded_per_window() {
        let mut subs = Subscriptions::default();
        let a = Arc::new(Mutex::new(vec![]));
        let b = Arc::new(Mutex::new(vec![]));
        let handle = subs
            .add(
                "server".into(),
                ServerTopic::Console,
                "a".into(),
                channel(a.clone()),
            )
            .unwrap();
        subs.add(
            "server".into(),
            ServerTopic::Console,
            "b".into(),
            channel(b.clone()),
        )
        .unwrap();
        for i in 0..40 {
            subs.send(
                "server",
                ServerTopic::Console,
                ServerEvent::Console {
                    lines: vec![ConsoleLine {
                        cursor: i.to_string(),
                        text: "line".into(),
                        truncated: false,
                    }],
                },
            );
        }
        assert!(subs
            .entries
            .values()
            .all(|s| s.bytes <= 64 * 1024 && s.pending.len() <= 32));
        subs.flush("server");
        subs.flush("server");
        assert_eq!(a.lock().unwrap().len(), 1);
        assert_eq!(a.lock().unwrap()[0]["kind"], "resync");
        assert_eq!(b.lock().unwrap().len(), 1);
        subs.remove(&handle, "b");
        assert!(subs.entries.contains_key(&handle));
        subs.remove_window("a");
        assert!(!subs.entries.contains_key(&handle));
        assert!(subs.demand("server", ServerTopic::Console));
        subs.remove_window("b");
        assert!(!subs.demand("server", ServerTopic::Console));
    }
    #[test]
    fn oversized_events_become_resync_and_metrics_are_latest_only() {
        let mut subs = Subscriptions::default();
        let out = Arc::new(Mutex::new(vec![]));
        subs.add(
            "server".into(),
            ServerTopic::Console,
            "a".into(),
            channel(out.clone()),
        )
        .unwrap();
        subs.send(
            "server",
            ServerTopic::Console,
            ServerEvent::Console {
                lines: vec![ConsoleLine {
                    cursor: "x".into(),
                    text: "x".repeat(70 * 1024),
                    truncated: false,
                }],
            },
        );
        subs.flush("server");
        assert_eq!(out.lock().unwrap()[0]["kind"], "resync");
        let latest = Arc::new(Mutex::new(vec![]));
        subs.add(
            "server".into(),
            ServerTopic::Metrics,
            "a".into(),
            channel(latest.clone()),
        )
        .unwrap();
        for at_ms in 0..100 {
            subs.send(
                "server",
                ServerTopic::Metrics,
                ServerEvent::Metrics {
                    sample: vesta_server_client::model::MetricsSample {
                        at_ms,
                        cpu_percent: None,
                        memory_used_bytes: None,
                        memory_max_bytes: None,
                        tps: None,
                        mspt: None,
                        players_online: None,
                    },
                },
            );
        }
        subs.flush("server");
        assert_eq!(latest.lock().unwrap().len(), 1);
        assert_eq!(latest.lock().unwrap()[0]["sample"]["atMs"], 99);
    }
}
#[derive(Default)]
pub struct Subscriptions {
    entries: HashMap<String, Subscription>,
}
impl Subscriptions {
    pub fn add(
        &mut self,
        connection: String,
        topic: ServerTopic,
        window: String,
        channel: Channel<ServerEvent>,
    ) -> Result<String> {
        if self.entries.len() >= 128 {
            return Err(Error::new(ErrorCode::ServerBusy));
        }
        let id = uuid::Uuid::new_v4().to_string();
        self.entries.insert(
            id.clone(),
            Subscription {
                connection,
                topic,
                window,
                channel,
                pending: VecDeque::new(),
                bytes: 0,
                last_sent: None,
            },
        );
        Ok(id)
    }
    pub fn remove(&mut self, handle: &str, window: &str) {
        if self.entries.get(handle).is_some_and(|s| s.window == window) {
            self.entries.remove(handle);
        }
    }
    pub fn remove_window(&mut self, window: &str) {
        self.entries.retain(|_, s| s.window != window);
    }
    pub fn remove_connection(&mut self, id: &str) {
        self.entries.retain(|_, s| s.connection != id);
    }
    pub fn demand(&self, id: &str, topic: ServerTopic) -> bool {
        self.entries
            .values()
            .any(|s| s.connection == id && s.topic == topic)
    }
    pub fn send(&mut self, id: &str, topic: ServerTopic, event: ServerEvent) {
        let size = serde_json::to_vec(&event)
            .map(|v| v.len())
            .unwrap_or(usize::MAX);
        let bounded = if size > 64 * 1024 {
            ServerEvent::Resync { topic }
        } else {
            event
        };
        for s in self
            .entries
            .values_mut()
            .filter(|s| s.connection == id && s.topic == topic)
        {
            // Status and telemetry are latest-only. Operation state updates for
            // the same ID supersede older updates still waiting in this queue.
            s.pending.retain(|(old,n)| {
                let replace = matches!((&bounded,old),(ServerEvent::Snapshot {..},ServerEvent::Snapshot {..})|(ServerEvent::Metrics {..},ServerEvent::Metrics {..}))
                    || matches!((&bounded,old),(ServerEvent::Operation {operation:a},ServerEvent::Operation {operation:b}) if a.operation_id == b.operation_id);
                if replace { s.bytes = s.bytes.saturating_sub(*n); } !replace
            });
            let bytes = serde_json::to_vec(&bounded)
                .map(|v| v.len())
                .unwrap_or(usize::MAX);
            if s.pending.len() >= 32 || s.bytes.saturating_add(bytes) > 64 * 1024 {
                s.pending.clear();
                s.bytes = 0;
                let marker = ServerEvent::Resync { topic };
                let bytes = serde_json::to_vec(&marker).map(|v| v.len()).unwrap_or(64);
                s.pending.push_back((marker, bytes));
                s.bytes = bytes;
            } else {
                s.pending.push_back((bounded.clone(), bytes));
                s.bytes += bytes;
            }
        }
    }
    pub fn flush(&mut self, id: &str) {
        self.entries.retain(|_, s| {
            if s.connection != id
                || s.last_sent
                    .is_some_and(|t| t.elapsed() < Duration::from_millis(100))
            {
                return true;
            }
            if let Some((event, bytes)) = s.pending.pop_front() {
                s.bytes = s.bytes.saturating_sub(bytes);
                s.last_sent = Some(Instant::now());
                s.channel.send(event).is_ok()
            } else {
                true
            }
        });
    }
}
