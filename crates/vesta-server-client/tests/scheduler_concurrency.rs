use std::{sync::Arc, time::Duration};
use vesta_server_client::{scheduler::Scheduler, Error, ErrorCode};

// The global request cap is shared even between distinct origins in one process.
static OWNER: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tokio::test]
async fn settings_burst_waits_for_capacity_without_exceeding_origin_limit() {
    let _owner = OWNER.lock().await;
    let scheduler = Scheduler::default();
    let background = scheduler.admit(false).unwrap();
    let other_background = scheduler.admit(false).unwrap();
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
    drop((background, other_background));
}

#[tokio::test]
async fn interactive_waiters_are_bounded_and_cancellation_restores_capacity_and_tokens() {
    let _owner = OWNER.lock().await;
    let scheduler = Arc::new(Scheduler::default());
    let held: Vec<_> = (0..3).map(|_| scheduler.admit(true).unwrap()).collect();
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
    // Only the three admitted requests consumed tokens, not the queued/cancelled calls.
    for _ in 0..37 {
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
    let _held: Vec<_> = (0..3).map(|_| scheduler.admit(true).unwrap()).collect();
    let error = tokio::time::timeout(Duration::from_secs(3), scheduler.admit_request(true))
        .await
        .unwrap()
        .err()
        .unwrap();
    assert_eq!(error.code, ErrorCode::ServerBusy);
    assert!(error.local_pressure);
}

#[test]
fn local_pressure_is_native_only_and_remote_busy_remains_distinguishable() {
    let local = Error::new(ErrorCode::ServerBusy).local_pressure();
    let remote = Error::wire(503, "temporarily_unavailable", None);
    assert!(!remote.local_pressure);
    assert_eq!(
        serde_json::to_value(local).unwrap(),
        serde_json::to_value(remote).unwrap()
    );
}
