//! Exercise the production profile store and OS credential adapter without Tauri.
#[allow(dead_code, clippy::items_after_test_module)]
#[path = "../../../vesta-launcher/src-tauri/src/servers/credentials.rs"]
mod credentials;
#[allow(dead_code)]
#[path = "../../../vesta-launcher/src-tauri/src/servers/store.rs"]
mod store;

/// Opt-in local diagnostic. Use an existing profile's device and pinned TLS;
/// print only timing/status/error codes, never credentials or response data.
#[tokio::test]
#[ignore = "requires VESTA_DIAGNOSTIC_PROFILE pointing to an explicitly selected local profile"]
async fn diagnose_existing_profile_connection() {
    use std::{
        path::PathBuf,
        sync::{Arc, Mutex},
        time::Instant,
    };
    use vesta_server_client::{auth, endpoint::Endpoint, transport::Transport};
    let profile = PathBuf::from(std::env::var_os("VESTA_DIAGNOSTIC_PROFILE").unwrap());
    let saved = store::Store::load(&profile).unwrap();
    assert_eq!(
        saved.connections.len(),
        1,
        "select a single-connection diagnostic profile"
    );
    let record = &saved.connections[0];
    let signer = credentials::Credentials::new(&profile)
        .load(&record.key_reference)
        .unwrap();
    let endpoint = Endpoint::parse(&record.snapshot.connection.endpoint).unwrap();
    let pin = record.snapshot.connection.fingerprint.clone();
    let transport = Transport::new(endpoint.clone(), Some(pin.clone())).unwrap();
    let challenge = transport
        .request(
            reqwest::Method::POST,
            "/api/v3/auth/session/challenge",
            None,
            Some(serde_json::json!({"device_id":record.device_id})),
            None,
            true,
        )
        .await
        .unwrap();
    assert_eq!(challenge["server_id"], record.snapshot.connection.server_id);
    assert_eq!(challenge["purpose"], auth::SESSION_PURPOSE);
    let signature = signer
        .sign(&auth::signing_bytes(
            challenge["server_id"].as_str().unwrap(),
            challenge["nonce"].as_str().unwrap(),
        ))
        .await
        .unwrap();
    let session = transport.request(
        reqwest::Method::POST, "/api/v3/auth/session", None,
        Some(serde_json::json!({"device_id":record.device_id,"nonce":challenge["nonce"],"signature":signature})), None, true
    ).await.unwrap();
    let token = zeroize::Zeroizing::new(session["token"].as_str().unwrap().to_owned());
    let tls = vesta_server_client::trust::config(Some(pin), Arc::new(Mutex::new(None)));
    let http = reqwest::Client::builder()
        .use_preconfigured_tls(tls)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap();
    for path in [
        "/api/v3/manage/session",
        "/api/v3/manage/server",
        "/api/v3/manage/pack",
        "/api/v3/manage/server/status",
        "/api/v3/manage/config/server-properties",
    ] {
        let started = Instant::now();
        let response = http
            .get(endpoint.url().join(path).unwrap())
            .bearer_auth(token.as_str())
            .send()
            .await
            .unwrap();
        let status = response.status().as_u16();
        let value: serde_json::Value = response.json().await.unwrap();
        let code = value
            .pointer("/error/code")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        assert!(code.len() <= 128 && code.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'));
        println!(
            "{path}: HTTP {status}, {} ms, code={code}",
            started.elapsed().as_millis()
        );
    }
}
