//! Opt-in against the actual CLI/agent; uses scratch instance data only.
#[path = "support/live_agent.rs"]
mod fixture;
use serde_json::json;
use std::{collections::BTreeMap, sync::Arc};
use vesta_server_client::{
    auth::{DeviceSigner, Ed25519Signer},
    endpoint::{Address, Endpoint},
    files::{FileTransfers, PropertiesUpdateResult},
    transport::Transport,
    Client, ErrorCode,
};

#[tokio::test]
#[ignore = "requires VESTA_LIVE_AGENT=1, VESTA_AGENT_BIN and VESTA_AGENT_INERT_BIN"]
async fn real_agent_files_upload_download_trash_and_properties() {
    assert_eq!(std::env::var("VESTA_LIVE_AGENT").as_deref(), Ok("1"));
    let agent = fixture::Agent::start();
    let issued = agent.pair();
    let address = Address::parse(issued["pairing_link"].as_str().unwrap()).unwrap();
    assert_eq!(address.endpoint, Endpoint::parse(&agent.endpoint).unwrap());
    let transport = Transport::new(address.endpoint, address.fingerprint).unwrap();
    let signer: Arc<dyn DeviceSigner> = Arc::new(Ed25519Signer::from_seed([37; 32]));
    let server = issued["server_id"].as_str().unwrap();
    let enrolled = Client::pair(
        &transport,
        server,
        address.code.as_deref().unwrap(),
        signer.as_ref(),
    )
    .await
    .unwrap();
    let device = enrolled.device_id;
    let client = Client::new(transport, server.into(), device.clone(), signer);
    assert!(client
        .files_list("", None)
        .await
        .unwrap()
        .items
        .iter()
        .any(|e| e.name == "config"));
    let created = client
        .file_write_text("config/live.txt", "first\n".into(), None, "files-create")
        .await
        .unwrap();
    let read = client.file_read_text("config/live.txt").await.unwrap();
    assert_eq!(read.text, "first\n");
    assert_eq!(read.sha256, Some(created.sha256.clone()));
    let written = client
        .file_write_text(
            "config/live.txt",
            "second\n".into(),
            Some(&created.sha256),
            "files-overwrite",
        )
        .await
        .unwrap();
    assert_eq!(
        client
            .file_write_text(
                "config/live.txt",
                "stale\n".into(),
                Some(&created.sha256),
                "files-stale"
            )
            .await
            .unwrap_err()
            .code,
        ErrorCode::StaleTarget
    );
    client
        .file_rename(
            "config/live.txt",
            "config/renamed.txt",
            None,
            "files-rename",
        )
        .await
        .unwrap();
    client
        .file_rename(
            "config/live.txt",
            "config/renamed.txt",
            None,
            "files-rename",
        )
        .await
        .unwrap();
    let deleted = client
        .file_delete("config/renamed.txt", Some(&written.sha256), "files-delete")
        .await
        .unwrap();
    assert!(client
        .trash_list(None)
        .await
        .unwrap()
        .items
        .iter()
        .any(|e| e.id == deleted.trash_id));
    client
        .trash_restore(&deleted.trash_id, "files-restore")
        .await
        .unwrap();
    assert_eq!(
        client
            .file_read_text("config/renamed.txt")
            .await
            .unwrap()
            .text,
        "second\n"
    );
    let transfers = FileTransfers::default();
    let source = agent.root.join("upload.txt");
    let data = "upload bytes\n".repeat(800);
    std::fs::write(&source, &data).unwrap();
    let candidate = transfers
        .pick(
            "live",
            std::fs::File::open(&source).unwrap(),
            "upload.txt".into(),
        )
        .await
        .unwrap();
    let mut progress = transfers
        .begin(
            &client,
            "live",
            "connection",
            &candidate.local_id,
            "config/upload.txt",
            None,
            "files-upload",
        )
        .await
        .unwrap();
    while progress.offset != progress.total_size {
        progress = transfers
            .chunk(&client, "live", "connection", &progress.upload_id)
            .await
            .unwrap();
    }
    transfers
        .finish(&client, "live", "connection", &progress.upload_id)
        .await
        .unwrap();
    let destination = agent.root.join("download.txt");
    client
        .file_download("config/upload.txt", false, &destination)
        .await
        .unwrap();
    assert_eq!(std::fs::read_to_string(destination).unwrap(), data);
    // A real rotated gzip archive: verify both the agent's cached decoded view
    // and the raw archive path, rather than emulating decompression in native.
    let gzip: &[u8] = &[
        31, 139, 8, 0, 0, 0, 0, 0, 4, 0, 43, 202, 47, 73, 44, 73, 77, 81, 200, 201, 79, 87, 200,
        201, 204, 75, 229, 2, 0, 173, 122, 9, 108, 17, 0, 0, 0,
    ];
    std::fs::create_dir_all(agent.instance.join("game/logs")).unwrap();
    std::fs::write(agent.instance.join("game/logs/rotated.log.gz"), gzip).unwrap();
    assert_eq!(
        client
            .log_tail("logs/rotated.log.gz", 100, true)
            .await
            .unwrap()
            .text,
        "rotated log line\n"
    );
    assert_eq!(
        client
            .log_lines("logs/rotated.log.gz", Some("0"), 100, "forward", true)
            .await
            .unwrap()
            .text,
        "rotated log line\n"
    );
    let decoded = agent.root.join("decoded.log");
    client
        .file_download("logs/rotated.log.gz", true, &decoded)
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(decoded).unwrap(),
        "rotated log line\n"
    );
    let archive = agent.root.join("raw.log.gz");
    client
        .file_download("logs/rotated.log.gz", false, &archive)
        .await
        .unwrap();
    assert_eq!(std::fs::read(archive).unwrap(), gzip);
    std::fs::write(
        agent.instance.join("game/server.properties"),
        "online-mode=true\nwhite-list=true\nenforce-whitelist=true\nmax-players=20\nmotd=Live\n",
    )
    .unwrap();
    let properties = client.properties_get().await.unwrap();
    assert_eq!(properties.values["online-mode"], true);
    let changes: BTreeMap<String, serde_json::Value> =
        serde_json::from_value(json!({"white-list":false,"max-players":21})).unwrap();
    let prepared = client
        .properties_update(
            changes.clone(),
            &properties.sha256,
            None,
            "files-properties",
        )
        .await
        .unwrap();
    let PropertiesUpdateResult::AwaitingConfirmation {
        confirmation_token, ..
    } = prepared
    else {
        panic!("expected weakening confirmation")
    };
    assert_eq!(
        client
            .properties_update(
                changes.clone(),
                &properties.sha256,
                Some("invalid"),
                "files-properties"
            )
            .await
            .unwrap_err()
            .code,
        ErrorCode::ConfirmationExpired
    );
    let applied = client
        .properties_update(
            changes,
            &properties.sha256,
            Some(&confirmation_token),
            "files-properties",
        )
        .await
        .unwrap();
    assert!(matches!(
        applied,
        PropertiesUpdateResult::Applied {
            restart_needed: true,
            ..
        }
    ));
    agent.revoke(&device);
    assert_eq!(
        client
            .file_read_text("config/renamed.txt")
            .await
            .unwrap_err()
            .code,
        ErrorCode::CredentialsRejected
    );
    println!("live files: list, read/write/stale validator, rename replay, trash/restore, native upload hash, streamed download, typed properties and weakening confirmation passed");
}
