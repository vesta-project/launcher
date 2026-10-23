//! Console delivery never awaits an observation, credential read or history GET.
//! The controller has one in-flight read; dropping its owner aborts it and its socket.
use super::*;
use std::collections::{HashSet, VecDeque};

const BATCH_BYTES: usize = 48 * 1024;
const BATCH_MESSAGES: usize = 64;

// One bounded scan accounts for JSON escaping. Metadata keeps its cursor intact;
// content alone may be truncated. Never retain a line different from its replay.
fn fit_line(mut line: ConsoleLine) -> Option<ConsoleLine> {
    if line.cursor.len() > BATCH_BYTES - 64 {
        return None;
    }
    if line.text.len() > 32 * 1024 {
        let mut end = 32 * 1024;
        while !line.text.is_char_boundary(end) {
            end -= 1;
        }
        line.text.truncate(end);
        line.truncated = true;
    }
    let metadata = serde_json::to_vec(&ConsoleLine {
        cursor: line.cursor.clone(),
        text: String::new(),
        truncated: line.truncated,
    })
    .ok()?
    .len();
    let budget = (BATCH_BYTES - 64).checked_sub(metadata)?;
    let mut encoded = 0;
    let mut end = 0;
    for (offset, character) in line.text.char_indices() {
        let size = match character {
            '\"' | '\\' | '\n' | '\r' | '\t' | '\u{08}' | '\u{0c}' => 2,
            '\u{00}'..='\u{1f}' => 6,
            character => character.len_utf8(),
        };
        if encoded + size > budget {
            break;
        }
        encoded += size;
        end = offset + character.len_utf8();
    }
    if end < line.text.len() {
        line.text.truncate(end);
        line.truncated = true;
    }
    Some(line)
}

#[derive(Clone, Default)]
struct Position {
    latest: Option<String>,
    recovery: Option<(u64, Option<String>)>,
    revision: u64,
}
impl Position {
    fn recover(&mut self, floor: Option<String>) {
        self.revision = self.revision.wrapping_add(1);
        let floor = self.recovery.as_ref().map(|r| r.1.clone()).unwrap_or(floor);
        self.recovery = Some((self.revision, floor));
    }
}

#[derive(Default)]
struct Retained {
    ring: ConsoleRing,
    cursors: VecDeque<String>,
    seen: HashSet<String>,
}
impl Retained {
    fn insert(&mut self, line: ConsoleLine) -> std::result::Result<Option<ConsoleLine>, ()> {
        if self.seen.contains(&line.cursor) {
            return Ok(None);
        }
        let line = fit_line(line).ok_or(())?;
        self.ring.push(line);
        let line = self.ring.lines().back().ok_or(())?.clone();
        self.seen.insert(line.cursor.clone());
        self.cursors.push_back(line.cursor.clone());
        while self.cursors.len() > self.ring.lines().len() {
            if let Some(cursor) = self.cursors.pop_front() {
                self.seen.remove(&cursor);
            }
        }
        // Retention eviction is not a delivery gap.
        self.ring.take_gap();
        Ok(Some(line))
    }
}

// Include serialized escaping, rather than assuming text bytes equal IPC bytes.
fn batches(lines: Vec<ConsoleLine>) -> Vec<ServerEvent> {
    let mut events = Vec::new();
    let mut batch = Vec::new();
    let mut bytes = 64;
    for line in lines {
        let Some(line) = fit_line(line) else {
            events.push(ServerEvent::Resync {
                topic: ServerTopic::Console,
            });
            continue;
        };
        let size = serde_json::to_vec(&line).map_or(usize::MAX, |v| v.len() + 1);
        if size > BATCH_BYTES - 64 {
            if !batch.is_empty() {
                events.push(ServerEvent::Console {
                    lines: std::mem::take(&mut batch),
                });
                bytes = 64;
            }
            events.push(ServerEvent::Resync {
                topic: ServerTopic::Console,
            });
            continue;
        }
        if batch.len() == BATCH_MESSAGES || bytes + size > BATCH_BYTES {
            events.push(ServerEvent::Console {
                lines: std::mem::take(&mut batch),
            });
            bytes = 64;
        }
        bytes += size;
        batch.push(line);
    }
    if !batch.is_empty() {
        events.push(ServerEvent::Console { lines: batch });
    }
    events
}

pub(super) async fn run(manager: Arc<ServerManager>, app: AppHandle, id: String) {
    loop {
        // Only a coarse demand check remains when another topic alone is visible.
        while !manager.demanded(&id, ServerTopic::Console) {
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        let (send, mut recv) = mpsc::channel(1024);
        let (position, current) = watch::channel(Position::default());
        let (ended, ends) = mpsc::channel(2);
        let overflow = Arc::new(AtomicBool::new(false));
        let owner = manager.clone();
        let app = app.clone();
        let connection = id.clone();
        let positions = position.clone();
        let lost = overflow.clone();
        let _controller = SocketTask {
            task: tauri::async_runtime::spawn(async move {
                control(owner, app, connection, send, positions, current, ends, lost).await;
            }),
        };
        drain(
            &mut recv,
            &position,
            &ended,
            &overflow,
            || manager.demanded(&id, ServerTopic::Console),
            |event| manager.deliver(&id, ServerTopic::Console, event),
            || {
                if let Ok(mut subs) = manager.subscriptions.lock() {
                    subs.flush(&id);
                }
            },
        )
        .await;
    }
}

async fn drain(
    recv: &mut mpsc::Receiver<StreamMessage>,
    position: &watch::Sender<Position>,
    ended: &mpsc::Sender<Option<Error>>,
    overflow: &AtomicBool,
    demanded: impl Fn() -> bool,
    emit: impl Fn(ServerEvent),
    flush_pending: impl Fn(),
) {
    let mut retained = Retained::default();
    let mut flush = tokio::time::interval(Duration::from_millis(100));
    flush.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        if !demanded() {
            break;
        }
        tokio::select! {
            _ = flush.tick() => {
                if !demanded() { break; }
                if overflow.swap(false, Ordering::Relaxed) {
                    position.send_modify(|p| p.recover(p.latest.clone()));
                    emit(ServerEvent::Resync { topic: ServerTopic::Console });
                }
                flush_pending();
            }
            message = recv.recv() => {
                let Some(message) = message else { break; };
                let floor = position.borrow().latest.clone();
                let mut messages = vec![message];
                for _ in 1..BATCH_MESSAGES {
                    match recv.try_recv() { Ok(message) => messages.push(message), Err(_) => break }
                }
                let mut lines = Vec::new();
                let mut recovery = overflow.swap(false, Ordering::Relaxed);
                for message in messages {
                    match message {
                        StreamMessage::Console(value) => match value["type"].as_str() {
                            Some("console.line") => {
                                if let Ok(line) = from_wire::<ConsoleLine>(value) {
                                    match retained.insert(line) {
                                        Ok(Some(line)) => {
                                            // Replayed cursors cannot move the live floor backwards.
                                            position.send_if_modified(|p| {
                                                p.latest = Some(line.cursor.clone());
                                                false // No controller wakeup for live data.
                                            });
                                            lines.push(line);
                                        },
                                        Ok(None) => {},
                                        Err(()) => recovery = true,
                                    }
                                } else { recovery = true; }
                            }
                            Some("console.available" | "heartbeat") => {},
                            Some("console.gap") => {
                                emit(ServerEvent::ConsoleGap {
                                    cursor: value["cursor"].as_str().unwrap_or("").into(),
                                });
                                recovery = true;
                            }
                            _ => recovery = true,
                        },
                        StreamMessage::History { page, discontinuity } => {
                            if discontinuity {
                                emit(ServerEvent::ConsoleGap { cursor: page.latest_cursor.clone() });
                            }
                            let history = page.items.into_iter().filter_map(|line| match retained.insert(line) {
                                Ok(line) => line,
                                Err(()) => { emit(ServerEvent::Resync { topic: ServerTopic::Console }); None }
                            }).collect();
                            for event in batches(history) {
                                let event = match event {
                                    ServerEvent::Console { lines } => ServerEvent::ConsoleHistory { lines },
                                    event => event,
                                };
                                emit(event);
                            }
                        }
                        StreamMessage::Ended(_, error) => {
                            recovery = true;
                            let _ = ended.try_send(error);
                        }
                    }
                }
                for event in batches(lines) { emit(event); }
                if recovery {
                    position.send_modify(|p| p.recover(floor));
                    emit(ServerEvent::Resync { topic: ServerTopic::Console });
                }
                flush_pending();
                // A continuously readable socket cannot monopolize a runtime worker.
                tokio::task::yield_now().await;
            }
        }
    }
}

async fn control(
    manager: Arc<ServerManager>,
    app: AppHandle,
    id: String,
    send: mpsc::Sender<StreamMessage>,
    position: watch::Sender<Position>,
    mut current: watch::Receiver<Position>,
    mut ends: mpsc::Receiver<Option<Error>>,
    overflow: Arc<AtomicBool>,
) {
    let mut failures = 0_u32;
    let client = loop {
        match manager.client(&id).await {
            Ok(client) => break client,
            Err(error) => {
                manager.synchronize_failure(&app, &id, &error).await;
                failures = failures.saturating_add(1);
                let Some(delay) =
                    vesta_server_client::retry::client_reconstruction_delay(error.code, failures)
                else {
                    // Keep the drain owner alive without retrying a permanent
                    // trust/access failure. Explicit recovery replaces the worker.
                    std::future::pending::<()>().await;
                    return;
                };
                tokio::time::sleep(
                    delay.max(Duration::from_millis(error.retry_after_ms.unwrap_or(0))),
                )
                .await;
            }
        }
    };
    let (latest, _) = watch::channel(None);
    let (status, _) = watch::channel(None);
    let mut socket = None;
    let mut socket_floor = None;
    let mut retry = Instant::now();
    let mut page_retry = Instant::now();
    let mut disabled = false;
    let mut stopped = false;
    let mut page_failures = 0_u32;
    let mut next_page: Option<String> = None;
    let mut recovering: Option<u64> = None;
    let mut recovery_floor: Option<Option<String>> = None;
    loop {
        if socket.is_none() && !disabled && !stopped && Instant::now() >= retry {
            socket_floor = current.borrow().latest.clone();
            socket = Some(spawn_socket(
                client.clone(),
                ServerTopic::Console,
                send.clone(),
                latest.clone(),
                status.clone(),
                overflow.clone(),
            ));
        }
        let state = current.borrow_and_update().clone();
        let recover = state.recovery.clone();
        let fallback = socket.is_none() && !stopped;
        if !stopped && (recover.is_some() || fallback) && Instant::now() >= page_retry {
            if recovering != recover.as_ref().map(|r| r.0) {
                let floor = recover.as_ref().map(|r| r.1.clone());
                // New loss during a refill must not keep restarting an unfinished
                // page sequence at the same floor under sustained traffic.
                if next_page.is_none() || floor != recovery_floor {
                    next_page = match &recover {
                        Some((_, floor)) => floor.clone(),
                        None => state.latest.clone(),
                    };
                }
                recovery_floor = floor;
                recovering = recover.as_ref().map(|r| r.0);
            }
            let cursor = if recover.is_some() {
                next_page.clone()
            } else {
                next_page.clone().or_else(|| state.latest.clone())
            };
            let mut discontinuity = false;
            let result = match client
                .console_page_with_priority(cursor.as_deref(), 200, false)
                .await
            {
                Err(error)
                    if matches!(error.code, ErrorCode::Conflict | ErrorCode::InvalidInput) =>
                {
                    discontinuity = true;
                    client.console_page_with_priority(None, 200, false).await
                }
                result => result,
            };
            match result {
                Ok(page) => {
                    page_failures = 0;
                    next_page = page.next_cursor.clone().filter(|next| {
                        next != &page.latest_cursor && Some(next) != cursor.as_ref()
                    });
                    let tail = page.items.last().map(|l| l.cursor.clone());
                    if send
                        .send(StreamMessage::History {
                            page,
                            discontinuity,
                        })
                        .await
                        .is_err()
                    {
                        return;
                    }
                    if next_page.is_none() {
                        position.send_modify(|p| {
                            if p.recovery.as_ref().map(|r| r.0) == recovering {
                                p.recovery = None;
                            }
                            if tail.is_some() && p.latest == state.latest {
                                p.latest = tail;
                            }
                        });
                    }
                    page_retry = Instant::now()
                        + if next_page.is_some() {
                            Duration::from_secs(1)
                        } else {
                            Duration::from_secs(10)
                        };
                }
                Err(error) => {
                    stopped = blocked(error.code);
                    if stopped {
                        socket = None;
                    }
                    page_failures = page_failures.saturating_add(1);
                    page_retry = Instant::now()
                        + Duration::from_millis(
                            (2_u64.pow(page_failures.min(5)) * 1000)
                                .max(error.retry_after_ms.unwrap_or(0)),
                        );
                    manager.synchronize_failure(&app, &id, &error).await;
                }
            }
        }
        let mut deadline = None;
        if socket.is_none() && !disabled && !stopped {
            deadline = Some(retry);
        }
        if !stopped && (current.borrow().recovery.is_some() || socket.is_none()) {
            deadline = Some(deadline.map_or(page_retry, |d: Instant| d.min(page_retry)));
        }
        tokio::select! {
            error = ends.recv() => {
                let Some(error) = error else { return; };
                socket = None;
                if current.borrow().latest != socket_floor { failures = 0; }
                failures = failures.saturating_add(1);
                let code = error.as_ref().map(|e| e.code);
                stopped = code.is_some_and(blocked);
                disabled = code.is_some_and(|c| matches!(c, ErrorCode::Unsupported | ErrorCode::NotFound));
                let delay = (2_u64.pow(failures.min(5)) * 2 + u64::from(rand::random::<u8>() % 5)).min(60);
                retry = Instant::now() + Duration::from_secs(delay).max(Duration::from_millis(error.as_ref().and_then(|e| e.retry_after_ms).unwrap_or(0)));
                if let Some(error) = error { manager.synchronize_failure(&app, &id, &error).await; }
            }
            result = current.changed() => { if result.is_err() { return; } }
            _ = async {
                match deadline {
                    Some(deadline) => tokio::time::sleep_until(deadline.into()).await,
                    None => std::future::pending::<()>().await,
                }
            } => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{atomic::AtomicUsize, Mutex as TestMutex};

    fn line(i: usize, text: &str) -> ConsoleLine {
        ConsoleLine {
            cursor: format!("cursor-{i}"),
            text: text.into(),
            truncated: false,
        }
    }
    fn wire(i: usize) -> StreamMessage {
        StreamMessage::Console(
            json!({"type":"console.line", "cursor":format!("cursor-{i}"), "text":"burst", "truncated":false}),
        )
    }
    fn count(events: &[ServerEvent]) -> usize {
        events
            .iter()
            .map(|event| match event {
                ServerEvent::Console { lines } | ServerEvent::ConsoleHistory { lines } => {
                    lines.len()
                }
                _ => 0,
            })
            .sum()
    }
    #[test]
    fn batches_bound_serialized_bytes_and_count_including_escaping() {
        for text in [
            "short".to_string(),
            "\"\\\n".repeat(2000),
            "x".repeat(32 * 1024),
        ] {
            let events = batches((0..250).map(|i| line(i, &text)).collect());
            assert_eq!(count(&events), 250);
            for event in events {
                assert!(serde_json::to_vec(&event).unwrap().len() <= BATCH_BYTES);
                if let ServerEvent::Console { lines } = event {
                    assert!(lines.len() <= BATCH_MESSAGES);
                }
            }
        }
        let events = batches(vec![line(0, &"\n".repeat(32 * 1024))]);
        assert_eq!(count(&events), 1);
        assert!(matches!(&events[0], ServerEvent::Console { lines } if lines[0].truncated));
    }
    #[test]
    fn escaped_line_truncation_is_utf8_safe_stable_and_replay_deduplicates() {
        for text in ["\n".repeat(32 * 1024), "\u{00}?".repeat(8192)] {
            let mut retained = Retained::default();
            let original = line(17, &text);
            let bounded = retained.insert(original.clone()).unwrap().unwrap();
            assert!(bounded.truncated);
            assert_eq!(bounded.cursor, original.cursor);
            assert!(original.text.starts_with(&bounded.text));
            let events = batches(vec![bounded.clone()]);
            assert_eq!(events.len(), 1);
            assert!(
                matches!(&events[0], ServerEvent::Console { lines } if lines[0].truncated && lines[0].text == bounded.text)
            );
            assert!(serde_json::to_vec(&events[0]).unwrap().len() <= BATCH_BYTES);
            assert!(retained.insert(original).unwrap().is_none());
            let replay = fit_line(bounded.clone()).unwrap();
            assert_eq!(replay.text, bounded.text);
        }
        let mut invalid = line(1, "text");
        invalid.cursor = "\n".repeat(BATCH_BYTES / 2);
        assert!(fit_line(invalid).is_none(), "metadata cannot be truncated");
    }
    #[test]
    fn retention_deduplicates_and_evicts_within_existing_limits() {
        let mut retained = Retained::default();
        for i in 0..6000 {
            assert!(retained
                .insert(line(i, &"x".repeat(600)))
                .unwrap()
                .is_some());
            assert!(retained.insert(line(i, "duplicate")).unwrap().is_none());
        }
        assert!(retained.ring.bytes() <= 2 * 1024 * 1024);
        assert!(retained.ring.lines().len() <= 5000);
        assert_eq!(retained.seen.len(), retained.ring.lines().len());
        assert_eq!(retained.cursors.len(), retained.seen.len());
        assert!(
            !retained.ring.take_gap(),
            "ordinary retention is not a loss marker"
        );
        assert!(retained
            .insert(line(0, "evicted cursor may replay"))
            .unwrap()
            .is_some());
        let huge = retained
            .insert(line(9999, &"x".repeat(40 * 1024)))
            .unwrap()
            .unwrap();
        assert!(huge.truncated);
        assert_eq!(huge.text.len(), 32 * 1024);
    }
    #[test]
    fn repeated_loss_preserves_earliest_floor_and_changes_ack_revision() {
        let mut position = Position {
            latest: Some("live-1".into()),
            ..Default::default()
        };
        position.recover(position.latest.clone());
        let first = position.recovery.clone().unwrap();
        position.latest = Some("live-2".into());
        position.recover(position.latest.clone());
        let next = position.recovery.clone().unwrap();
        assert_ne!(first.0, next.0);
        assert_eq!(next.1, first.1);
        let mut empty = Position::default();
        empty.recover(None);
        empty.recover(Some("later".into()));
        assert_eq!(empty.recovery.unwrap().1, None);
    }
    #[tokio::test]
    async fn hanging_observation_and_history_do_not_block_burst_delivery() {
        let (send, mut recv) = mpsc::channel(1024);
        let (position, _) = watch::channel(Position::default());
        let (ended, _ends) = mpsc::channel(2);
        let overflow = AtomicBool::new(false);
        let demanded = AtomicBool::new(true);
        let events = TestMutex::new(Vec::new());
        let flushes = AtomicUsize::new(0);
        // Deliberately never resolves: models player/status/operation/history I/O.
        let observation = std::future::pending::<()>();
        for i in 0..800 {
            send.try_send(wire(i)).unwrap();
        }
        let work = drain(
            &mut recv,
            &position,
            &ended,
            &overflow,
            || demanded.load(Ordering::Relaxed),
            |event| {
                let mut events = events.lock().unwrap();
                events.push(event);
                if count(&events) == 800 {
                    demanded.store(false, Ordering::Relaxed);
                }
            },
            || {
                flushes.fetch_add(1, Ordering::Relaxed);
            },
        );
        tokio::time::timeout(Duration::from_secs(2), async {
            tokio::select! { _ = work => {}, _ = observation => panic!("observation unexpectedly completed") }
        }).await.unwrap();
        assert_eq!(count(&events.lock().unwrap()), 800);
        assert!(flushes.load(Ordering::Relaxed) > 0);
        for event in events.lock().unwrap().iter() {
            assert!(serde_json::to_vec(event).unwrap().len() <= BATCH_BYTES);
        }
    }
    #[tokio::test]
    async fn overflow_disconnect_history_replay_and_expired_cursor_are_truthful() {
        let (send, mut recv) = mpsc::channel(4);
        let (position, _) = watch::channel(Position::default());
        let (ended, mut ends) = mpsc::channel(2);
        let overflow = AtomicBool::new(true);
        let demanded = AtomicBool::new(true);
        let events = TestMutex::new(Vec::new());
        send.try_send(wire(1)).unwrap();
        send.try_send(StreamMessage::Ended(ServerTopic::Console, None))
            .unwrap();
        send.try_send(StreamMessage::History {
            page: ConsolePage {
                items: vec![line(0, "recovered"), line(1, "duplicate live cursor")],
                next_cursor: None,
                latest_cursor: "cursor-1".into(),
            },
            discontinuity: true,
        })
        .unwrap();
        // A recovered older cursor can replay on reconnect, but must neither
        // duplicate the page nor move the live recovery floor backwards.
        send.try_send(wire(0)).unwrap();
        let work = drain(
            &mut recv,
            &position,
            &ended,
            &overflow,
            || demanded.load(Ordering::Relaxed),
            |event| {
                let mut events = events.lock().unwrap();
                events.push(event);
                if count(&events) == 2 {
                    demanded.store(false, Ordering::Relaxed);
                }
            },
            || {},
        );
        tokio::time::timeout(Duration::from_secs(2), work)
            .await
            .unwrap();
        let events = events.lock().unwrap();
        assert_eq!(count(&events), 2);
        assert!(events
            .iter()
            .any(|e| matches!(e, ServerEvent::ConsoleGap { .. })));
        assert!(events
            .iter()
            .any(|e| matches!(e, ServerEvent::Resync { .. })));
        assert!(position.borrow().recovery.is_some());
        assert_eq!(position.borrow().latest.as_deref(), Some("cursor-1"));
        assert!(matches!(ends.try_recv(), Ok(None)));
    }
    #[tokio::test]
    async fn disposal_aborts_owned_task_and_drops_inflight_resources() {
        struct Dropped(Arc<AtomicBool>);
        impl Drop for Dropped {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }
        let released = Arc::new(AtomicBool::new(false));
        let captured = released.clone();
        let (started, ready) = tokio::sync::oneshot::channel();
        let owner = SocketTask {
            task: tauri::async_runtime::spawn(async move {
                let _nested = SocketTask {
                    task: tauri::async_runtime::spawn(async move {
                        let _resource = Dropped(captured);
                        let _ = started.send(());
                        std::future::pending::<()>().await;
                    }),
                };
                std::future::pending::<()>().await;
            }),
        };
        ready.await.unwrap();
        drop(owner);
        tokio::time::timeout(Duration::from_secs(2), async {
            while !released.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }
}
