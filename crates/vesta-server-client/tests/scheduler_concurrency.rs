use std::{sync::Arc, time::Duration};
use vesta_server_client::{
    scheduler::{RequestPriority, Scheduler},
    Error, ErrorCode,
};

// The global request cap is shared even between distinct origins in one process.
static OWNER: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tokio::test]
async fn settings_burst_waits_for_capacity_without_exceeding_origin_limit() {
    let _owner = OWNER.lock().await;
    let scheduler = Scheduler::default();
    let background = scheduler.admit(false).unwrap();
    let profile = scheduler.admit_request(true).await.unwrap();
    let properties = scheduler.admit_request(true);
    tokio::pin!(properties);
    assert!(
        tokio::time::timeout(Duration::from_millis(30), &mut properties)
            .await
            .is_err()
    );
    assert!(scheduler.admit(false).is_err());
    drop(profile);
    let _properties = properties.await.unwrap();
    assert!(scheduler.admit(true).is_err());
    drop(background);
}

#[tokio::test]
async fn interactive_waiters_are_bounded_and_cancellation_restores_capacity_and_tokens() {
    let _owner = OWNER.lock().await;
    let scheduler = Arc::new(Scheduler::default());
    let held: Vec<_> = (0..2).map(|_| scheduler.admit(true).unwrap()).collect();
    let mut waiting = Vec::new();
    for _ in 0..8 {
        let scheduler = scheduler.clone();
        waiting.push(tokio::spawn(
            async move { scheduler.admit_request(true).await },
        ));
        tokio::task::yield_now().await;
    }
    let error = tokio::time::timeout(Duration::from_millis(100), scheduler.admit_request(true))
        .await
        .unwrap()
        .err()
        .unwrap();
    assert_eq!(error.code, ErrorCode::ServerBusy);
    assert!(error.local_pressure);
    for waiter in waiting {
        waiter.abort();
        assert!(matches!(waiter.await, Err(error) if error.is_cancelled()));
    }
    drop(held);
    // Only the two admitted requests consumed tokens, not the queued/cancelled calls.
    for _ in 0..38 {
        drop(scheduler.admit_request(true).await.unwrap());
    }
    assert_eq!(
        scheduler.admit(true).err().unwrap().code,
        ErrorCode::RateLimited
    );
}

#[tokio::test]
async fn prolonged_capacity_pressure_settles_within_a_bounded_deadline() {
    let _owner = OWNER.lock().await;
    let scheduler = Scheduler::default();
    let _held: Vec<_> = (0..2).map(|_| scheduler.admit(true).unwrap()).collect();
    let error = tokio::time::timeout(Duration::from_secs(6), scheduler.admit_request(true))
        .await
        .unwrap()
        .err()
        .unwrap();
    assert_eq!(error.code, ErrorCode::ServerBusy);
    assert!(error.local_pressure);
}

#[test]
fn local_pressure_provenance_survives_ipc_without_mislabeling_remote_busy() {
    let local = Error::new(ErrorCode::ServerBusy).local_pressure();
    let remote = Error::wire(503, "temporarily_unavailable", None);
    assert!(!remote.local_pressure);
    assert_eq!(serde_json::to_value(local).unwrap()["localPressure"], true);
    assert!(serde_json::to_value(remote)
        .unwrap()
        .get("localPressure")
        .is_none());
}

#[tokio::test]
async fn two_panel_reads_wait_for_local_refill_without_increasing_the_budget() {
    let _owner = OWNER.lock().await;
    let scheduler = Scheduler::default();
    for _ in 0..40 {
        drop(scheduler.admit(true).unwrap());
    }
    assert_eq!(
        scheduler.admit(false).err().unwrap().code,
        ErrorCode::RateLimited
    );
    let started = std::time::Instant::now();
    let (sleep, motd) = tokio::join!(scheduler.admit_request(true), scheduler.admit_request(true));
    drop((sleep.unwrap(), motd.unwrap()));
    assert!(started.elapsed() >= Duration::from_millis(2900));
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(
        scheduler.admit(true).err().unwrap().code,
        ErrorCode::RateLimited
    );
}

#[tokio::test]
async fn authenticated_panels_have_a_session_budget_and_respect_server_backoff() {
    let _owner = OWNER.lock().await;
    let scheduler = Scheduler::default();
    for _ in 0..100 {
        drop(scheduler.admit_authenticated_request(true).await.unwrap());
    }
    // Anonymous traffic has its own smaller cap.
    for _ in 0..40 {
        drop(scheduler.admit(true).unwrap());
    }
    assert!(scheduler.admit(true).is_err());
    scheduler.pause(60_000);
    let error = scheduler
        .admit_authenticated_request(true)
        .await
        .err()
        .unwrap();
    assert_eq!(error.code, ErrorCode::RateLimited);
    assert!(error.retry_after_ms.unwrap() > 50_000);
}

#[tokio::test]
async fn saturated_reads_leave_control_capacity_and_urgent_flood_leaves_background_capacity() {
    let _owner = OWNER.lock().await;
    let scheduler = Scheduler::default();
    let reads: Vec<_> = (0..2).map(|_| scheduler.admit(true).unwrap()).collect();
    let control = tokio::time::timeout(
        Duration::from_millis(100),
        scheduler.admit_priority_request(RequestPriority::Urgent, true),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(scheduler.admit(true).is_err());
    let mut next = Box::pin(scheduler.admit_priority_request(RequestPriority::Urgent, true));
    assert!(tokio::time::timeout(Duration::from_millis(30), &mut next)
        .await
        .is_err());
    drop(reads);
    let background = scheduler.admit(false).unwrap();
    let second = scheduler.admit(false).unwrap();
    assert!(scheduler.admit(false).is_err());
    drop(control);
    let _next = next.await.unwrap();
    drop((background, second));
    assert!(scheduler.admit(false).is_ok());
}

#[tokio::test]
async fn global_lanes_sum_to_twelve_and_cancellation_restores_urgent_waiters() {
    let _owner = OWNER.lock().await;
    let schedulers: Vec<_> = (0..6).map(|_| Scheduler::default()).collect();
    let mut reads = Vec::new();
    for scheduler in &schedulers[..5] {
        for _ in 0..2 {
            reads.push(scheduler.admit(true).unwrap());
        }
    }
    assert!(schedulers[5].admit(true).is_err());
    let a = schedulers[0]
        .admit_priority_request(RequestPriority::Urgent, true)
        .await
        .unwrap();
    let b = schedulers[1]
        .admit_priority_request(RequestPriority::Urgent, true)
        .await
        .unwrap();
    let mut blocked = Box::pin(schedulers[2].admit_priority_request(RequestPriority::Urgent, true));
    assert!(
        tokio::time::timeout(Duration::from_millis(30), &mut blocked)
            .await
            .is_err()
    );
    drop(blocked);
    let mut first = Box::pin(schedulers[0].admit_priority_request(RequestPriority::Urgent, true));
    let mut second = Box::pin(schedulers[0].admit_priority_request(RequestPriority::Urgent, true));
    assert!(tokio::time::timeout(Duration::from_millis(20), &mut first)
        .await
        .is_err());
    assert!(tokio::time::timeout(Duration::from_millis(20), &mut second)
        .await
        .is_err());
    let error = schedulers[0]
        .admit_priority_request(RequestPriority::Urgent, true)
        .await
        .err()
        .unwrap();
    assert_eq!(error.code, ErrorCode::ServerBusy);
    drop((first, second, a, b, reads));
    assert!(schedulers[0]
        .admit_priority_request(RequestPriority::Urgent, true)
        .await
        .is_ok());
    assert!(schedulers[0].admit(false).is_ok());
}

#[tokio::test]
async fn urgent_requests_share_pause_and_anonymous_token_budget() {
    let _owner = OWNER.lock().await;
    let scheduler = Scheduler::default();
    for _ in 0..40 {
        drop(scheduler.admit(true).unwrap());
    }
    let mut urgent = Box::pin(scheduler.admit_priority_request(RequestPriority::Urgent, false));
    assert!(tokio::time::timeout(Duration::from_millis(30), &mut urgent)
        .await
        .is_err());
    // Waiting for tokens releases all capacity, including the urgent lane.
    assert!(scheduler.admit_authenticated_request(true).await.is_ok());
    drop(urgent);
    scheduler.pause(60_000);
    for authenticated in [false, true] {
        let error = scheduler
            .admit_priority_request(RequestPriority::Urgent, authenticated)
            .await
            .err()
            .unwrap();
        assert_eq!(error.code, ErrorCode::RateLimited);
        assert!(error.retry_after_ms.unwrap() > 50_000);
    }
}
