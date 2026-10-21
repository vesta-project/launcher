//! Opt-in integration with the real `vesta-agent serve` CLI, TLS, vault and inert child.
//! See docs/development/server-client-followup.md for prerequisites and invocation.
use futures_util::StreamExt;
use serde_json::Value;
use std::{sync::Arc, time::Duration};
use vesta_server_client::{
    auth::DeviceSigner,
    endpoint::{Address, Endpoint},
    model::{ConsoleLine, ServerTopic},
    transport::Transport,
    Client, ErrorCode,
};
#[allow(dead_code)]
#[path = "../../../vesta-launcher/src-tauri/src/servers/credentials.rs"]
mod credentials;
#[path = "support/live_agent.rs"]
mod fixture;

struct KeyCleanup<'a>(&'a credentials::Credentials, &'a str);
impl Drop for KeyCleanup<'_> {
    fn drop(&mut self) {
        let _ = self.0.delete(self.1);
    }
}
async fn completed(client: &Client, id: &str) {
    for _ in 0..30 {
        match client.operation(id).await {
            Ok(op) if op.state == "succeeded" => return,
            Ok(op) => assert!(!op.terminal(), "operation failed: {op:?}"),
            Err(e) if e.code == ErrorCode::RateLimited => {
                tokio::time::sleep(Duration::from_millis(e.retry_after_ms.unwrap_or(1500))).await;
            }
            Err(e) => panic!("operation read: {e:?}"),
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    panic!("operation timed out");
}
async fn next_json(socket: &mut vesta_server_client::transport::Socket) -> Value {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(15), socket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        if message.is_text() {
            return serde_json::from_str(message.to_text().unwrap()).unwrap();
        }
    }
}
#[tokio::test]
#[ignore = "requires VESTA_LIVE_AGENT=1, VESTA_AGENT_BIN and VESTA_AGENT_INERT_BIN"]
async fn real_agent_pair_lifecycle_console_reconnect_revoke() {
    assert_eq!(std::env::var("VESTA_LIVE_AGENT").as_deref(), Ok("1"));
    let agent = fixture::Agent::start();
    let issued = agent.pair();
    let address = Address::parse(
        issued["pairing_link"]
            .as_str()
            .expect("configured public endpoint pairing link"),
    )
    .unwrap();
    assert_eq!(address.endpoint, Endpoint::parse(&agent.endpoint).unwrap());
    let capture = Transport::new(address.endpoint.clone(), None).unwrap();
    let public = capture
        .request(
            reqwest::Method::GET,
            "/api/v3/status",
            None,
            None,
            None,
            true,
        )
        .await
        .unwrap();
    let fingerprint = capture.observed().unwrap();
    assert_eq!(fingerprint, issued["tls_sha256_fingerprint"]);
    assert_eq!(address.fingerprint.as_deref(), Some(fingerprint.as_str()));
    assert_eq!(public["server_id"], issued["server_id"]);
    println!("1 discover: pairing link, server ID and TLS fingerprint match CLI output");
    let server = public["server_id"].as_str().unwrap().to_owned();
    let vault = credentials::Credentials::new(&agent.instance.join("profile"));
    assert!(vault.available(), "real OS vault unavailable");
    let reference = uuid::Uuid::new_v4().to_string();
    let signer: Arc<dyn DeviceSigner> = vault.create(&reference, false).unwrap();
    let _cleanup = KeyCleanup(&vault, &reference);
    let transport = Transport::new(address.endpoint.clone(), Some(fingerprint.clone())).unwrap();
    let enrollment = Client::pair(
        &transport,
        &server,
        address.code.as_deref().unwrap(),
        signer.as_ref(),
    )
    .await
    .unwrap();
    let device = enrollment.device_id;
    let client = Client::new(transport, server.clone(), device.clone(), signer);
    println!("2 pair: real one-use owner code redeemed after OS-vault key storage");
    let projection = client.get("session", true, "").await.unwrap();
    println!("3 session: device challenge signed and session issued");
    let capabilities = client.capabilities(Some("owner")).await.unwrap();
    assert_eq!(capabilities.source, "session");
    assert_eq!(
        capabilities.granted,
        serde_json::from_value::<Vec<String>>(projection["capabilities"].clone()).unwrap()
    );
    assert!(capabilities
        .granted
        .iter()
        .any(|v| v == "lifecycle.force_kill"));
    println!(
        "4 GET /session: authoritative capabilities match ({} grants)",
        capabilities.granted.len()
    );
    assert_eq!(client.status(true).await.unwrap().state, "stopped");
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(client.status(true).await.unwrap().state, "stopped");
    let mut metrics = client.socket(ServerTopic::Status).await.unwrap();
    loop {
        let frame = next_json(&mut metrics).await;
        if frame["type"] == "status" {
            assert_eq!(frame["data"]["state"], "stopped");
            assert!(frame["etag"].is_string());
            break;
        }
    }
    metrics.close(None).await.unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;
    println!("5 status: repeated conditional GET succeeds; metrics socket supplies status + ETag");
    let mut console = client.socket(ServerTopic::Console).await.unwrap();
    // Wait for stream admission before creating output; the stream is forward-only.
    loop {
        if next_json(&mut console).await["type"] == "console.available" {
            break;
        }
    }
    let started = client
        .lifecycle("start", None, "live-start-1")
        .await
        .unwrap();
    completed(&client, &started.operation_id).await;
    let generation = client.status(true).await.unwrap().generation.unwrap();
    println!("6 start: operation succeeded; observed running generation {generation}");
    let sent = client
        .console_send("say vesta-live-console", &generation, "live-console-1")
        .await
        .unwrap();
    completed(&client, &sent.operation_id).await;
    let streamed = loop {
        let frame = next_json(&mut console).await;
        if frame["type"] == "console.line" && frame["text"].as_str().unwrap_or("").contains("say") {
            break vesta_server_client::model::from_wire::<ConsoleLine>(frame).unwrap();
        }
    };
    let page = client.console_page(None, 200).await.unwrap();
    assert!(page
        .items
        .iter()
        .any(|line| line.cursor == streamed.cursor && line.text == streamed.text));
    let continuation = client
        .console_page(Some(&streamed.cursor), 200)
        .await
        .unwrap();
    assert!(continuation
        .items
        .iter()
        .all(|line| line.cursor != streamed.cursor));
    console.close(None).await.unwrap();
    println!("7 console: real inert-child output; page/stream cursors identical, cursor excludes that line");
    let stopped = client
        .lifecycle("stop", Some(&generation), "live-stop-1")
        .await
        .unwrap();
    completed(&client, &stopped.operation_id).await;
    assert_eq!(client.status(true).await.unwrap().state, "stopped");
    println!("8 stop: generation-bound operation succeeded");
    // Reconstructing bypasses the local intent cache: this exercises the agent receipt.
    drop(client);
    let restored = Client::new(
        Transport::new(address.endpoint.clone(), Some(fingerprint.clone())).unwrap(),
        server.clone(),
        device.clone(),
        vault.load(&reference).unwrap(),
    );
    let replayed = restored
        .lifecycle("stop", Some(&generation), "live-stop-1")
        .await
        .unwrap();
    assert_eq!(replayed.operation_id, stopped.operation_id);
    assert_eq!(replayed.state, "succeeded");
    assert_eq!(
        restored
            .lifecycle(
                "stop",
                Some("00000000000000000000000000000000"),
                "live-stop-1"
            )
            .await
            .unwrap_err()
            .code,
        ErrorCode::Conflict
    );
    println!("9 retried stop: fresh client POST replays same succeeded receipt after game stopped; changed payload conflicts");
    let started = restored
        .lifecycle("start", None, "live-start-2")
        .await
        .unwrap();
    completed(&restored, &started.operation_id).await;
    let generation = restored.status(true).await.unwrap().generation.unwrap();
    let prepared = restored
        .kill_prepare(&generation, "live-kill-1")
        .await
        .unwrap();
    let killed = restored
        .confirm("live-kill-1", "lifecycle/kill")
        .await
        .unwrap();
    assert_eq!(killed.operation_id, prepared.operation_id);
    completed(&restored, &killed.operation_id).await;
    println!("10 kill: two-step exact-generation prepare/confirm succeeded");
    drop(restored);
    let restarted = Client::new(
        Transport::new(address.endpoint, Some(fingerprint)).unwrap(),
        server,
        device.clone(),
        vault.load(&reference).unwrap(),
    );
    assert_eq!(
        restarted.capabilities(None).await.unwrap().source,
        "session"
    );
    assert_eq!(restarted.status(true).await.unwrap().state, "stopped");
    println!("11 restart client: stored OS-vault device reconnects and creates a fresh session");
    agent.revoke(&device);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(
        restarted.status(true).await.unwrap_err().code,
        ErrorCode::CredentialsRejected
    );
    println!(
        "12 revoke: CLI devices revoke invalidates session/device; classified credentials_rejected"
    );
    vault.delete(&reference).unwrap();
}
