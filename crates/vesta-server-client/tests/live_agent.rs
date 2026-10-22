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
#[allow(dead_code, clippy::items_after_test_module)]
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
            Err(e) if matches!(e.code, ErrorCode::RateLimited | ErrorCode::ServerBusy) => {
                tokio::time::sleep(Duration::from_millis(e.retry_after_ms.unwrap_or(1500))).await;
            }
            Err(e) => panic!("operation read: {e:?}"),
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    panic!("operation timed out");
}

async fn backup_completed(client: &Client, id: &str) -> vesta_server_client::management::BackupJob {
    for _ in 0..30 {
        let job = client.backup_job(id).await.unwrap();
        match job.state.as_str() {
            "succeeded" => return job,
            "failed" | "uncertain" | "recovery_required" => panic!("backup failed: {job:?}"),
            _ => tokio::time::sleep(Duration::from_secs(2)).await,
        }
    }
    panic!("backup job timed out")
}

#[tokio::test]
#[ignore = "requires VESTA_LIVE_AGENT=1 and the launcher-compat agent binaries"]
async fn live_presence_branding_and_icons() {
    use vesta_server_client::branding::BrandingPatch;
    assert_eq!(std::env::var("VESTA_LIVE_AGENT").as_deref(), Ok("1"));
    let agent = fixture::Agent::start();
    let issued = agent.pair();
    let address = Address::parse(issued["pairing_link"].as_str().unwrap()).unwrap();
    let server = issued["server_id"].as_str().unwrap();
    let transport = Transport::new(address.endpoint, address.fingerprint).unwrap();
    let signer = Arc::new(vesta_server_client::auth::Ed25519Signer::from_seed(
        [73; 32],
    ));
    let enrollment = Client::pair(
        &transport,
        server,
        address.code.as_deref().unwrap(),
        signer.as_ref(),
    )
    .await
    .unwrap();
    let device_id = enrollment.device_id.clone();
    let client = Client::new(transport, server.into(), enrollment.device_id, signer);
    let sleep = client.sleep_policy().await.unwrap();
    let mut policy = sleep.policy;
    policy.idle_seconds += 1;
    let saved = client
        .sleep_policy_update(policy.clone(), sleep.revision, "live-sleep")
        .await
        .unwrap();
    assert_eq!(saved.revision, sleep.revision + 1);
    assert_eq!(
        client
            .sleep_policy_update(policy, sleep.revision, "live-sleep-stale")
            .await
            .unwrap_err()
            .code,
        ErrorCode::StaleTarget
    );
    let mut motd = client.motd_policy().await.unwrap();
    motd.document.states.get_mut("sleeping").unwrap().template =
        "§b§l{server_name}\n§7Join to wake".into();
    let preview = client
        .motd_preview("sleeping", motd.document.clone())
        .await
        .unwrap();
    assert_eq!(preview.lines[1], "Join to wake");
    assert_eq!(preview.segments[0].color.as_deref(), Some("#55FFFF"));
    assert!(preview.segments[0].bold);
    let png = preview.icon_png.unwrap();
    let saved = client
        .motd_policy_update(motd.document.clone(), motd.revision.as_deref(), "live-motd")
        .await
        .unwrap();
    assert!(saved.revision.is_some());
    assert_eq!(
        client
            .motd_policy_update(
                motd.document.clone(),
                motd.revision.as_deref(),
                "live-motd-stale"
            )
            .await
            .unwrap_err()
            .code,
        ErrorCode::StaleTarget
    );
    motd.document.states.get_mut("sleeping").unwrap().template = "{unknown_placeholder}".into();
    assert_eq!(
        client
            .motd_preview("sleeping", motd.document)
            .await
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
    let branding = client.branding().await.unwrap();
    let saved = client
        .branding_update(
            BrandingPatch {
                name: Some("Live branding".into()),
                description: Some("A scratch server".into()),
            },
            &branding.revision,
            "live-branding",
        )
        .await
        .unwrap();
    assert_eq!(saved.name, "Live branding");
    assert_eq!(saved.description.as_deref(), Some("A scratch server"));
    assert_eq!(
        client
            .branding_update(
                BrandingPatch {
                    name: Some("Stale".into()),
                    description: None
                },
                &branding.revision,
                "live-branding-stale"
            )
            .await
            .unwrap_err()
            .code,
        ErrorCode::StaleTarget
    );
    assert!(client.icon().await.unwrap().is_none());
    client.icon_set(&png, "live-icon-create").await.unwrap();
    assert!(client.icon().await.unwrap().is_some());
    client.icon_set(&png, "live-icon-replace").await.unwrap();
    client.icon_clear("live-icon-delete").await.unwrap();
    assert!(client.icon().await.unwrap().is_none());
    client.icon_clear("live-icon-empty").await.unwrap();
    let renamed = client
        .device_rename(&device_id, "Live desktop", "live-device-rename")
        .await
        .unwrap();
    assert_eq!(renamed.name, "Live desktop");
    assert_eq!(
        client
            .devices()
            .await
            .unwrap()
            .iter()
            .find(|d| d.id == device_id)
            .unwrap()
            .name,
        "Live desktop"
    );
    eprintln!("Live sleep, MOTD preview/policy, branding, icon create/replace/delete and own-device rename passed: {}",agent.root.display());
}

#[tokio::test]
#[ignore = "requires VESTA_LIVE_AGENT=1 and the launcher-compat agent binaries"]
async fn live_management_access_pack_and_backups() {
    assert_eq!(std::env::var("VESTA_LIVE_AGENT").as_deref(), Ok("1"));
    let agent = fixture::Agent::start_with_backups();
    let issued = agent.pair();
    let address = Address::parse(issued["pairing_link"].as_str().unwrap()).unwrap();
    let server = issued["server_id"].as_str().unwrap();
    let transport = Transport::new(address.endpoint.clone(), address.fingerprint.clone()).unwrap();
    let signer = Arc::new(vesta_server_client::auth::Ed25519Signer::from_seed(
        [51; 32],
    ));
    let enrollment = Client::pair(
        &transport,
        server,
        address.code.as_deref().unwrap(),
        signer.as_ref(),
    )
    .await
    .unwrap();
    let client = Client::new(transport, server.into(), enrollment.device_id, signer);
    let users = client.users(0).await.unwrap();
    assert!(!users.users.is_empty());
    let roles = client.roles().await.unwrap();
    let role = roles
        .iter()
        .filter(|r| r.rank > 0 && r.rank < 100)
        .min_by_key(|r| r.rank)
        .unwrap();
    let invite = client
        .invitation_create(&role.id, 15, "live-invitation-revoke")
        .await
        .unwrap();
    let invitation_id = invite.id.as_deref().expect("compat agent invitation id");
    assert!(invite.pairing_link.is_some());
    assert!(client
        .invitations()
        .await
        .unwrap()
        .iter()
        .any(|i| i.id.as_deref() == Some(invitation_id)));
    client
        .invitation_revoke(invitation_id, "live-invitation-delete")
        .await
        .unwrap();
    // Let the short read coalescing window expire before checking the post-mutation list.
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(!client
        .invitations()
        .await
        .unwrap()
        .iter()
        .any(|i| i.id.as_deref() == Some(invitation_id)));
    let second = client
        .invitation_create(&role.id, 15, "live-second-device")
        .await
        .unwrap();
    let transport2 = Transport::new(address.endpoint, address.fingerprint).unwrap();
    let signer2 = vesta_server_client::auth::Ed25519Signer::from_seed([52; 32]);
    let second = Client::pair(&transport2, server, &second.code, &signer2)
        .await
        .unwrap();
    let devices = client.devices().await.unwrap();
    assert!(devices.iter().any(|d| d.current));
    assert!(devices.iter().any(|d| d.id == second.device_id));
    client
        .device_revoke(&second.device_id, "live-device-revoke")
        .await
        .unwrap();
    let sources = client.access_sources().await.unwrap();
    assert!(!sources.version.is_empty());
    println!("management access: users, roles, invitation create/list/revoke, second device revoke, sources");
    // Spacing keeps the live scenario within the production 40 requests/minute budget.
    tokio::time::sleep(Duration::from_secs(3)).await;
    let overview = client.backups(None).await.unwrap();
    assert_eq!(overview.profiles[0].name, "daily");
    let run = client
        .backup_submit("run", serde_json::json!({"profile":"daily"}), "live-backup")
        .await
        .unwrap();
    let done = backup_completed(&client, &run.id).await;
    let snapshots = client.backup_snapshots("daily").await.unwrap();
    assert!(!snapshots.is_empty());
    let snapshot = done.snapshot_id.as_deref().unwrap();
    assert!(snapshots.iter().any(|s| s.id == snapshot && !s.safety));
    let storage = client.backup_storage().await.unwrap();
    assert!(storage.repository_bytes > 0);
    tokio::time::sleep(Duration::from_secs(5)).await;
    let verify = client
        .backup_submit(
            "verify",
            serde_json::json!({"profile":"daily"}),
            "live-verify",
        )
        .await
        .unwrap();
    backup_completed(&client, &verify.id).await;
    let copy = client
        .backup_submit(
            "restore",
            serde_json::json!({"profile":"daily","snapshot":snapshot,"paths":[]}),
            "live-copy",
        )
        .await
        .unwrap();
    backup_completed(&client, &copy.id).await;
    tokio::time::sleep(Duration::from_secs(5)).await;
    let prepared = client.backup_restore_prepare(serde_json::json!({"profile":"daily","snapshot":snapshot,"paths":[],"skip_safety_snapshot":false}),"live-in-place").await.unwrap();
    assert!(!serde_json::to_string(&prepared)
        .unwrap()
        .contains("confirmationToken"));
    assert_eq!(prepared.job.state, "awaiting_confirmation");
    client
        .backup_restore_confirm(&prepared.job.id)
        .await
        .unwrap();
    backup_completed(&client, &prepared.job.id).await;
    assert!(client
        .backup_snapshots("daily")
        .await
        .unwrap()
        .iter()
        .any(|s| s.safety));
    println!("management backups: configured scratch profile, run, snapshots, storage, verify, copy, prepare/confirm with safety snapshot");
    tokio::time::sleep(Duration::from_secs(5)).await;
    let published = client.pack_publish("0", "live-publish").await.unwrap();
    let minimum = client
        .pack_minimum(
            &published.hosted_revision,
            &published.hosted_revision,
            "live-minimum",
        )
        .await
        .unwrap();
    assert_eq!(minimum.minimum_revision, published.hosted_revision);
    println!("management pack: publish and minimum revisions");
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
    let streamed = loop {
        let frame = next_json(&mut console).await;
        if frame["type"] == "console.line" && !frame["text"].as_str().unwrap_or("").is_empty() {
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
    tokio::time::sleep(Duration::from_millis(500)).await;
    println!("7 console: real inert-child output; page/stream cursors identical, cursor excludes that line");
    let sent = client
        .console_send("say Hello, players!", &generation, "live-console-details")
        .await
        .unwrap();
    let detail = serde_json::to_value(&sent).unwrap();
    assert_eq!(detail["kind"], "console.command");
    assert_eq!(
        detail["summary"],
        serde_json::json!({"kind":"console.command", "command":"say Hello, players!"})
    );
    assert_eq!(detail["actor"]["kind"], "principal");
    assert_eq!(detail["actor"]["principalId"], projection["principal_id"]);
    assert_eq!(detail["actor"]["self"], true);
    assert_eq!(detail["actor"]["deviceName"], "Vesta Launcher");
    completed(&client, &sent.operation_id).await;
    let finished = client.operation(&sent.operation_id).await.unwrap();
    assert_eq!(finished.outcome.as_deref(), Some("stdin_written"));
    let listed = client.operations(None).await.unwrap();
    let listed = listed
        .items
        .iter()
        .find(|op| op.operation_id == sent.operation_id)
        .unwrap();
    assert_eq!(
        serde_json::to_value(&listed.summary).unwrap(),
        detail["summary"]
    );
    assert_eq!(
        serde_json::to_value(&listed.actor).unwrap(),
        detail["actor"]
    );
    println!("7a operation details: real console text, own principal, device and stdin_written outcome; list/detail agree");
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
