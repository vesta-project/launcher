//! Headless, real ServerManager coverage with a real Tauri AppHandle and agent.
use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::Listener;
#[path = "../../../../crates/vesta-server-client/tests/support/live_agent.rs"]
mod fixture;

async fn completed(client: &Client, id: &str) {
    for _ in 0..30 {
        match client.operation(id).await {
            Ok(op) if op.state == "succeeded" => return,
            Ok(op) => assert!(!op.terminal(), "operation failed: {op:?}"),
            Err(e) if matches!(e.code, ErrorCode::RateLimited | ErrorCode::ServerBusy) => {
                tokio::time::sleep(Duration::from_millis(e.retry_after_ms.unwrap_or(1000))).await;
            }
            Err(e) => panic!("operation read: {e:?}"),
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    panic!("operation timeout");
}
#[test]
#[ignore = "real agent, vault and Tauri runtime; requires VESTA_LIVE_AGENT=1"]
fn live_manager_storage_events_retry_and_restart() {
    assert_eq!(std::env::var("VESTA_LIVE_AGENT").as_deref(), Ok("1"));
    let builder = tauri::Builder::default();
    // Tauri permits a non-main event loop only on Windows and Linux. This
    // opt-in live fixture remains ignored by default on every platform.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let builder = builder.any_thread();
    let app = builder.build(tauri::generate_context!()).unwrap();
    let app = app.handle().clone();
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        let agent = fixture::Agent::start();
        let profile = agent.instance.join("profile");
        let mut manager = ServerManager::at_root(profile.clone()).unwrap();
        let denied = Credentials::new(&profile);
        denied.deny_storage();
        Arc::get_mut(&mut manager).unwrap().credentials = Arc::new(denied);
        let issued = agent.pair();
        let discovery = manager.discover(issued["pairing_link"].as_str().unwrap()).await.unwrap();
        assert_eq!(Endpoint::parse(&discovery.endpoint).unwrap(), Endpoint::parse(&agent.endpoint).unwrap());
        assert!(!discovery.secure_storage_available);
        assert_eq!(manager.minecraft(&app, &discovery.discovery_id, "unused-account", false, None).await.unwrap_err().code, ErrorCode::CredentialsUnavailable);
        assert_eq!(manager.pair(&app, &discovery.discovery_id, discovery.link_code.as_deref().unwrap(), false).await.unwrap_err().code, ErrorCode::CredentialsUnavailable);
        let temporary = manager.pair(&app, &discovery.discovery_id, discovery.link_code.as_deref().unwrap(), true).await.unwrap();
        assert!(temporary.connection.memory_only);
        assert_eq!(temporary.state.access, "paired");
        let bytes = std::fs::read(profile.join("server-connections-v1.json")).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains(&temporary.connection.id));
        drop(manager);
        let manager = ServerManager::at_root(profile.clone()).unwrap();
        assert!(manager.list().await.unwrap().is_empty());
        println!("manager 1: unavailable vault rejects before redemption; same code then pairs in memory; restart drops temporary connection");
        let issued = agent.pair();
        let discovery = manager.discover(issued["pairing_link"].as_str().unwrap()).await.unwrap();
        assert!(discovery.secure_storage_available);
        let paired = manager.pair(&app, &discovery.discovery_id, discovery.link_code.as_deref().unwrap(), false).await.unwrap();
        let id = paired.connection.id.clone();
        let device = manager.record(&id).await.unwrap().device_id;
        // Simulate a request whose response is lost after admission at the manager boundary.
        let client = manager.client(&id).await.unwrap();
        let payload = json!({"generation":null});
        let lost: Result<ServerOperation> = manager.mutate(&app, &id, "manager-start", "lifecycle.start", &payload, None, async {
            client.lifecycle("start", None, "manager-start").await?;
            Err(Error::new(ErrorCode::OutcomeUnknown))
        }).await;
        assert_eq!(lost.unwrap_err().code, ErrorCode::OutcomeUnknown);
        let retried = manager.lifecycle(&app, &id, "start", None, "manager-start").await.unwrap();
        assert!(!retried.operation_id.is_empty());
        assert_eq!(manager.lifecycle(&app, &id, "stop", Some("00000000000000000000000000000000"), "manager-start").await.unwrap_err().code, ErrorCode::Conflict);
        // The fixture's native child accepts a literal stop; use it for cleanup
        // through the generation-bound public client, after start finishes.
        completed(&client, &retried.operation_id).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        let generation = client.status(true).await.unwrap().generation.unwrap();
        let stop = client.lifecycle("stop", Some(&generation), "manager-stop").await.unwrap();
        completed(&client, &stop.operation_id).await;
        println!("manager 2: persistent pair and journaled uncertain mutation retry succeed; different action/payload conflicts");
        tokio::time::sleep(Duration::from_millis(350)).await;
        let count = Arc::new(AtomicUsize::new(0));
        let observed = count.clone();
        let listener = app.listen("core://servers-changed", move |_| {observed.fetch_add(1, Ordering::Relaxed);});
        let snapshot = manager.record(&id).await.unwrap().snapshot;
        for i in 0..20 {
            let mut sample = snapshot.clone();
            sample.status_observed_at_ms = Some(i);
            if let Some(status) = sample.status.as_mut() {status.uptime_seconds = Some(i.to_string());}
            manager.publish_observation(&app, sample).await.unwrap();
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(count.load(Ordering::Relaxed), 0, "sample-only updates emitted global events");
        for _ in 0..20 {manager.changed(&app);}
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(count.load(Ordering::Relaxed), 1, "burst did not coalesce");
        app.unlisten(listener);
        println!("manager 3: 20 detail samples emit zero global events; 20 invalidations coalesce to one event");
        client.transport.scheduler.pause(2000);
        tokio::time::sleep(Duration::from_millis(300)).await;
        let limited = manager.snapshot(&app, &id, true).await.unwrap();
        assert_eq!(limited.state.phase, "backoff");
        assert!(limited.state.rate_limited_until_ms.unwrap() > vesta_server_client::now_ms());
        assert_eq!(limited.state.retry_at_ms, limited.state.rate_limited_until_ms);
        client.transport.scheduler.pause(0);
        println!("manager 3b: successful interactive status preserves the active Retry-After deadline");
        drop(client);
        drop(manager);
        let manager = ServerManager::at_root(profile).unwrap();
        assert_eq!(manager.list().await.unwrap().len(), 1);
        let snapshot = manager.snapshot(&app, &id, true).await.unwrap();
        assert_eq!(snapshot.state.access, "paired");
        assert_eq!(snapshot.state.phase, "online");
        println!("manager 4: new ServerManager reloads profile and OS-vault device, establishes fresh session");
        agent.revoke(&device);
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(manager.snapshot(&app, &id, true).await.unwrap_err().code, ErrorCode::CredentialsRejected);
        assert_eq!(manager.snapshot(&app, &id, false).await.unwrap().state.access, "credentials_rejected");
        println!("manager 5: CLI revoke is classified and published as credentials_rejected");
        let reference = manager.record(&id).await.unwrap().key_reference;
        manager.credentials.delete(&reference).unwrap();
    });
}
