//! Standalone wire fixtures: no dependency on the agent checkout or server crates.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::{SinkExt, StreamExt};
use hyper::{service::service_fn, Body, Request, Response, StatusCode};
use serde_json::{json, Value};
use std::{
    convert::Infallible,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
};
use tokio_tungstenite::{
    tungstenite::{protocol::Role, Message},
    WebSocketStream,
};
use vesta_server_client::{
    auth::{signing_bytes, DeviceSigner, Ed25519Signer},
    endpoint::Endpoint,
    model::ServerTopic,
    transport::Transport,
    trust::leaf_fingerprint,
    Client, ErrorCode,
};

// Fixtures share the production process-wide request budget. Serialize scenarios
// while preserving the concurrency exercised inside each scenario.
static TEST_OWNER: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
#[path = "support/files.rs"]
mod file_tests;

#[derive(Default)]
struct State {
    files: file_tests::Files,
    key: Mutex<Option<[u8; 32]>>,
    pairs: AtomicUsize,
    pair_names: Mutex<Vec<String>>,
    sessions: AtomicUsize,
    starts: AtomicUsize,
    start_keys: Mutex<Vec<String>>,
    status_reads: AtomicUsize,
    reject_old: AtomicBool,
    uncertain: AtomicBool,
    lost_confirmation: AtomicBool,
    modern: AtomicBool,
    lost_pair: AtomicBool,
    rate_limit: AtomicBool,
    forbidden: AtomicBool,
    wrong_identity: AtomicBool,
    expired_confirmation: AtomicBool,
    slow_status: AtomicBool,
    busy_status: AtomicUsize,
    busy_start: AtomicBool,
    near_expiry_first: AtomicBool,
    operation_details: Mutex<Option<Value>>,
    operation_reads: AtomicUsize,
    operation_read_denied: AtomicBool,
    mutation_has_details: AtomicBool,
}
struct Agent {
    endpoint: Endpoint,
    fingerprint: String,
    state: Arc<State>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Agent {
    fn drop(&mut self) {
        self.task.abort();
    }
}
fn plain(value: Value) -> Response<Body> {
    Response::new(Body::from(value.to_string()))
}
fn envelope(value: Value) -> Response<Body> {
    plain(json!({"api_version":"3","request_id":"fixture","data":value}))
}
fn error(status: StatusCode, code: &str) -> Response<Body> {
    let mut r = plain(json!({"api_version":"3","error":{"code":code}}));
    *r.status_mut() = status;
    r
}
fn operation(state: &str) -> Value {
    json!({"operation_id":"operation-1","state":state,"progress_percent":null,"created_at_ms":1,"updated_at_ms":2,"finished_at_ms":if state=="succeeded" {Some(2)} else {None}})
}
fn projected_operation(state: &State, operation_state: &str) -> Value {
    let mut value = operation(operation_state);
    if let Some(details) = state.operation_details.lock().unwrap().as_ref() {
        value
            .as_object_mut()
            .unwrap()
            .extend(details.as_object().unwrap().clone());
    }
    value
}
fn status() -> Value {
    json!({"state":"stopped","generation":null,"lifecycle":"offline","sleep_blocker":{"reason":"disabled"},"player_count":null,"player_count_known":false,"player_count_observed_at_ms":null,"uptime_seconds":null,"readiness":"stopped","readiness_reason":null,"readiness_evidence":"log_only","supervision":"in_process","supervisor":null})
}
impl Agent {
    async fn start() -> Self {
        let certificate = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let der = certificate.cert.der().to_vec();
        let fingerprint = leaf_fingerprint(&der);
        let config = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![rustls::pki_types::CertificateDer::from(der)],
            rustls::pki_types::PrivatePkcs8KeyDer::from(certificate.key_pair.serialize_der())
                .into(),
        )
        .unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let state = Arc::new(State::default());
        let shared = state.clone();
        let task = tokio::spawn(async move {
            loop {
                let (tcp, _) = listener.accept().await.unwrap();
                let tls = acceptor.clone();
                let state = shared.clone();
                tokio::spawn(async move {
                    if let Ok(tls) = tls.accept(tcp).await {
                        let service = service_fn(move |request| route(request, state.clone()));
                        let _ = hyper::server::conn::Http::new()
                            .serve_connection(tls, service)
                            .with_upgrades()
                            .await;
                    }
                });
            }
        });
        Self {
            endpoint: Endpoint::parse(&format!("https://{address}")).unwrap(),
            fingerprint,
            state,
            task,
        }
    }
    async fn paired(&self) -> Arc<Client> {
        let transport =
            Transport::new(self.endpoint.clone(), Some(self.fingerprint.clone())).unwrap();
        let signer: Arc<dyn DeviceSigner> = Arc::new(Ed25519Signer::from_seed([17; 32]));
        let enrolled = Client::pair(&transport, "server-1", "code", signer.as_ref())
            .await
            .unwrap();
        Client::new(transport, "server-1".into(), enrolled.device_id, signer)
    }
}
async fn route(
    mut req: Request<Body>,
    state: Arc<State>,
) -> std::result::Result<Response<Body>, Infallible> {
    let path = req.uri().path().to_owned();
    if path.ends_with("/console/stream") || path.ends_with("/metrics/stream") {
        assert!(req.headers()["authorization"]
            .to_str()
            .unwrap()
            .starts_with("Bearer token-"));
        assert!(!req.headers().contains_key("origin"));
        let key = req.headers()["sec-websocket-key"].as_bytes();
        let accept = tokio_tungstenite::tungstenite::handshake::derive_accept_key(key);
        let upgrade = hyper::upgrade::on(&mut req);
        let modern = state.modern.load(Ordering::SeqCst);
        tokio::spawn(async move {
            let upgraded = upgrade.await.unwrap();
            let mut socket = WebSocketStream::from_raw_socket(upgraded, Role::Server, None).await;
            let event = if path.ends_with("/console/stream") {
                json!({"type":"console.line","api_version":"3","cursor":"server-1.console.1","text":"real TLS console","truncated":false})
            } else if modern {
                json!({"type":"status","api_version":"3","data":status()})
            } else {
                json!({"type":"metrics.snapshot","columns":{"timestamps":[],"series":{}}})
            };
            socket.send(Message::Text(event.to_string())).await.unwrap();
            while let Some(Ok(message)) = socket.next().await {
                if message.is_close() {
                    break;
                }
            }
        });
        return Ok(Response::builder()
            .status(101)
            .header("connection", "upgrade")
            .header("upgrade", "websocket")
            .header("sec-websocket-accept", accept)
            .body(Body::empty())
            .unwrap());
    }
    let bytes = hyper::body::to_bytes(req.body_mut()).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(json!({}));
    if file_tests::handles(&path) {
        return Ok(file_tests::route(&req, &bytes, &body, &state.files));
    }
    let response = match path.as_str() {
        "/api/v3/status" => {
            plain(json!({"api_version":"3","server_id":"server-1","state":"offline","motd":{}}))
        }
        "/api/v3/manage/pair" => {
            state.pairs.fetch_add(1, Ordering::SeqCst);
            state
                .pair_names
                .lock()
                .unwrap()
                .push(body["device_name"].as_str().unwrap().to_owned());
            let key = URL_SAFE_NO_PAD
                .decode(body["public_key"].as_str().unwrap())
                .unwrap();
            *state.key.lock().unwrap() = Some(key.as_slice().try_into().unwrap());
            if state.lost_pair.load(Ordering::SeqCst) {
                return Ok(error(StatusCode::GATEWAY_TIMEOUT, "gateway_timeout"));
            }
            plain(
                json!({"server_id":"server-1","principal_id":"principal-1","device_id":"device-1","role":"owner"}),
            )
        }
        "/api/v3/auth/session/challenge" => {
            assert_eq!(body["device_id"], "device-1");
            if state.wrong_identity.load(Ordering::SeqCst) {
                return Ok(plain(
                    json!({"server_id":"other-server","nonce":"nonce","purpose":"vesta.management.session.v1"}),
                ));
            }
            plain(
                json!({"server_id":"server-1","nonce":"nonce","purpose":"vesta.management.session.v1","expires_in_seconds":60}),
            )
        }
        "/api/v3/auth/session" => {
            let signature = URL_SAFE_NO_PAD
                .decode(body["signature"].as_str().unwrap())
                .unwrap();
            let key = state.key.lock().unwrap().unwrap();
            ed25519_dalek::VerifyingKey::from_bytes(&key)
                .unwrap()
                .verify_strict(
                    &signing_bytes("server-1", "nonce"),
                    &ed25519_dalek::Signature::from_slice(&signature).unwrap(),
                )
                .unwrap();
            let n = state.sessions.fetch_add(1, Ordering::SeqCst) + 1;
            let lifetime = if n == 1 && state.near_expiry_first.load(Ordering::SeqCst) {
                30_000
            } else {
                900_000
            };
            plain(
                json!({"server_id":"server-1","token":format!("token-{n}"),"expires_at_ms":vesta_server_client::now_ms()+lifetime}),
            )
        }
        "/api/v3/manage/session" => {
            if state.modern.load(Ordering::SeqCst) {
                envelope(
                    json!({"server_id":"server-1","principal_id":"principal-1","device_id":"device-1","roles":[{"id":"owner","name":"Owner","rank":100}],"capabilities":["status.view","lifecycle.start"],"session_expires_at_ms":vesta_server_client::now_ms()+900_000}),
                )
            } else {
                error(StatusCode::NOT_IMPLEMENTED, "not_implemented")
            }
        }
        "/api/v3/manage/server/status" => {
            state.status_reads.fetch_add(1, Ordering::SeqCst);
            if state
                .busy_status
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
                .is_ok()
            {
                return Ok(error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "temporarily_unavailable",
                ));
            }
            if state.slow_status.load(Ordering::SeqCst) {
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            }
            if state.forbidden.load(Ordering::SeqCst) {
                return Ok(error(StatusCode::FORBIDDEN, "management_forbidden"));
            }
            if state.rate_limit.load(Ordering::SeqCst) {
                let mut r = error(StatusCode::TOO_MANY_REQUESTS, "rate_limited");
                r.headers_mut().insert("retry-after", "7".parse().unwrap());
                return Ok(r);
            }
            if state.reject_old.load(Ordering::SeqCst)
                && req.headers()["authorization"] == "Bearer token-1"
            {
                error(StatusCode::UNAUTHORIZED, "management_session_invalid")
            } else if req.headers().get("if-none-match").is_some() {
                Response::builder().status(304).body(Body::empty()).unwrap()
            } else {
                let mut r = envelope(status());
                r.headers_mut()
                    .insert("etag", "\"status-1\"".parse().unwrap());
                r
            }
        }
        "/api/v3/manage/lifecycle/start" => {
            state.starts.fetch_add(1, Ordering::SeqCst);
            if state.busy_start.load(Ordering::SeqCst) {
                return Ok(error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "temporarily_unavailable",
                ));
            }
            state.start_keys.lock().unwrap().push(
                req.headers()["idempotency-key"]
                    .to_str()
                    .unwrap()
                    .to_owned(),
            );
            assert!(req.headers()["idempotency-key"].as_bytes().len() >= 16);
            assert_eq!(body, json!({}));
            if state.uncertain.load(Ordering::SeqCst) {
                plain(json!({"api_version":"3","data":"response-lost-after-commit"}))
            } else {
                let mut r = envelope(if state.mutation_has_details.load(Ordering::SeqCst) {
                    projected_operation(&state, "queued")
                } else {
                    operation("queued")
                });
                *r.status_mut() = StatusCode::ACCEPTED;
                r
            }
        }
        "/api/v3/manage/lifecycle/kill" => {
            assert_eq!(
                body["acknowledgement"],
                "kill game:generation:00000000000000000000000000000000"
            );
            if body.get("confirmation_token").is_none() {
                if state.expired_confirmation.load(Ordering::SeqCst) {
                    return Ok(envelope(
                        json!({"operation_id":"operation-1","state":"awaiting_confirmation","confirmation_token":"native-only-secret","expires_at_ms":vesta_server_client::now_ms()-1}),
                    ));
                }
                envelope(
                    json!({"operation_id":"operation-1","state":"awaiting_confirmation","confirmation_token":"native-only-secret","expires_at_ms":vesta_server_client::now_ms()+120_000}),
                )
            } else if state.lost_confirmation.load(Ordering::SeqCst) {
                error(StatusCode::GATEWAY_TIMEOUT, "gateway_timeout")
            } else {
                assert_eq!(body["confirmation_token"], "native-only-secret");
                envelope(operation("queued"))
            }
        }
        "/api/v3/manage/operations/operation-1" => {
            state.operation_reads.fetch_add(1, Ordering::SeqCst);
            if state.operation_read_denied.load(Ordering::SeqCst) {
                error(StatusCode::FORBIDDEN, "management_forbidden")
            } else {
                envelope(projected_operation(&state, "succeeded"))
            }
        }
        "/api/v3/manage/operations" => envelope(
            json!({"items":[projected_operation(&state, "succeeded")], "next_cursor":"next-1"}),
        ),
        "/api/v3/manage/lifecycle/stop"
        | "/api/v3/manage/lifecycle/restart"
        | "/api/v3/manage/console/command" => envelope(operation("queued")),
        "/api/v3/manage/console" => envelope(
            json!({"items":[{"cursor":"server-1.console.1","text":"page","truncated":false}],"latest_cursor":"server-1.console.1","next_cursor":"server-1.console.1"}),
        ),
        "/api/v3/manage/players" => envelope(
            json!({"known":true,"generation":"00000000000000000000000000000000","player_count":1,"items":[{"name":"Alex"}]}),
        ),
        "/api/v3/manage/players/moderate" => {
            if body["action"] == "op" {
                if body.get("confirmation").is_none() {
                    return Ok(envelope(
                        json!({"operation_id":"operation-1","state":"awaiting_confirmation","confirmation_token":"native-only-op-secret","expires_at_ms":vesta_server_client::now_ms()+120_000}),
                    ));
                }
                assert_eq!(body["confirmation"], "native-only-op-secret");
                return Ok(envelope(operation("queued")));
            }
            assert_eq!(body["action"], "ban");
            assert_eq!(body["duration_seconds"], 60);
            assert!(body.get("durationSeconds").is_none());
            envelope(operation("queued"))
        }
        _ => error(StatusCode::NOT_FOUND, "resource_not_found"),
    };
    Ok(response)
}

#[tokio::test]
async fn self_signed_https_pair_session_status_lifecycle_console_stream_end_to_end() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    let capture = Transport::new(agent.endpoint.clone(), None).unwrap();
    assert_eq!(
        capture
            .request(
                reqwest::Method::GET,
                "/api/v3/status",
                None,
                None,
                None,
                true
            )
            .await
            .unwrap()["server_id"],
        "server-1"
    );
    assert_eq!(capture.observed(), Some(agent.fingerprint.clone()));
    let wrong = Transport::new(agent.endpoint.clone(), Some("00".repeat(32))).unwrap();
    assert_eq!(
        wrong
            .request(
                reqwest::Method::GET,
                "/api/v3/status",
                None,
                None,
                None,
                true
            )
            .await
            .unwrap_err()
            .code,
        ErrorCode::FingerprintMismatch
    );
    let client = agent.paired().await;
    assert_eq!(client.status(true).await.unwrap().state, "stopped");
    assert_eq!(
        client.capabilities(Some("owner")).await.unwrap().source,
        "role_defaults"
    );
    let op = client.lifecycle("start", None, "start-1").await.unwrap();
    // The single detail refresh can already observe completion after acceptance.
    assert_eq!(op.state, "succeeded");
    assert_eq!(
        client
            .lifecycle("start", None, "start-1")
            .await
            .unwrap()
            .state,
        "succeeded"
    );
    assert_eq!(agent.state.starts.load(Ordering::SeqCst), 1);
    let mut socket = client.socket(ServerTopic::Console).await.unwrap();
    let text = socket.next().await.unwrap().unwrap().into_text().unwrap();
    assert!(text.contains("real TLS console"));
    socket.close(None).await.unwrap();
    assert_eq!(client.console_page(None, 100).await.unwrap().items.len(), 1);
    assert_eq!(agent.state.sessions.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn renewal_is_single_flight_after_agent_session_loss_and_reads_are_deduplicated() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    let client = agent.paired().await;
    client.status(true).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(260)).await;
    agent.state.reject_old.store(true, Ordering::SeqCst);
    let mut calls = Vec::new();
    for _ in 0..12 {
        let client = client.clone();
        calls.push(tokio::spawn(async move { client.status(true).await }));
    }
    for call in calls {
        call.await.unwrap().unwrap();
    }
    assert_eq!(agent.state.sessions.load(Ordering::SeqCst), 2);
    assert_eq!(agent.state.status_reads.load(Ordering::SeqCst), 3);
}
#[tokio::test]
async fn uncertain_submission_explicit_retry_replays_and_known_id_reconciles_by_get() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    let client = agent.paired().await;
    agent.state.uncertain.store(true, Ordering::SeqCst);
    assert!(client.lifecycle("start", None, "lost-start").await.is_err());
    assert_eq!(
        client
            .lifecycle("start", None, "lost-start")
            .await
            .unwrap_err()
            .code,
        ErrorCode::OutcomeUnknown
    );
    assert_eq!(agent.state.starts.load(Ordering::SeqCst), 2);
    assert_eq!(
        client
            .lifecycle(
                "stop",
                Some("00000000000000000000000000000000"),
                "lost-start"
            )
            .await
            .unwrap_err()
            .code,
        ErrorCode::Conflict
    );
    agent.state.uncertain.store(false, Ordering::SeqCst);
    assert_eq!(
        client
            .lifecycle("start", None, "lost-start")
            .await
            .unwrap()
            .operation_id,
        "operation-1"
    );
    assert_eq!(agent.state.starts.load(Ordering::SeqCst), 3);
    let keys = agent.state.start_keys.lock().unwrap().clone();
    assert_eq!(keys.len(), 3);
    assert!(keys.iter().all(|key| key == &keys[0]));
    // After a known receipt, local retries reconcile the exact accepted operation.
    client.lifecycle("start", None, "lost-start").await.unwrap();
    assert_eq!(agent.state.starts.load(Ordering::SeqCst), 3);
    let p = client
        .kill_prepare("00000000000000000000000000000000", "kill-1")
        .await
        .unwrap();
    assert_eq!(p.operation_id, "operation-1");
    agent.state.lost_confirmation.store(true, Ordering::SeqCst);
    let confirmed = client.confirm("kill-1", "lifecycle/kill").await.unwrap();
    assert_eq!(
        client
            .operation(&confirmed.operation_id)
            .await
            .unwrap()
            .state,
        "succeeded"
    );
}

#[tokio::test]
async fn concurrent_settings_style_control_and_properties_reads_wait_for_inflight_work() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    let client = agent.paired().await;
    // Establish the session before deliberately occupying ordinary origin slots.
    client.status(true).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(260)).await;
    let held: Vec<_> = (0..2)
        .map(|_| client.transport.scheduler.admit(true).unwrap())
        .collect();
    let release = async move {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        drop(held);
    };
    // The profile uses ordinary JSON transport; properties use file transport.
    // Both need bounded admission rather than a spurious immediate busy error.
    let (status, properties, ()) =
        tokio::join!(client.status(true), client.properties_get(), release);
    assert_eq!(status.unwrap().state, "stopped");
    assert!(!properties.unwrap().values.is_empty());
}

#[tokio::test]
async fn transient_busy_get_recovers_once_without_replaying_mutations() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    let client = agent.paired().await;
    agent.state.busy_status.store(1, Ordering::SeqCst);
    assert_eq!(client.status(true).await.unwrap().state, "stopped");
    assert_eq!(agent.state.status_reads.load(Ordering::SeqCst), 2);
    agent
        .state
        .files
        .busy_properties
        .store(true, Ordering::SeqCst);
    assert!(!client.properties_get().await.unwrap().values.is_empty());
    agent.state.busy_start.store(true, Ordering::SeqCst);
    assert_eq!(
        client
            .lifecycle("start", None, "busy-no-replay")
            .await
            .unwrap_err()
            .code,
        ErrorCode::ServerBusy
    );
    assert_eq!(agent.state.starts.load(Ordering::SeqCst), 1);

    tokio::time::sleep(std::time::Duration::from_millis(260)).await;
    agent.state.busy_status.store(2, Ordering::SeqCst);
    assert_eq!(
        client.status(true).await.unwrap_err().code,
        ErrorCode::ServerBusy
    );
    assert_eq!(agent.state.status_reads.load(Ordering::SeqCst), 4);
}
#[tokio::test]
async fn additive_self_projection_and_status_stream_are_supported() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    agent.state.modern.store(true, Ordering::SeqCst);
    let client = agent.paired().await;
    assert_eq!(
        client.capabilities(None).await.unwrap().granted,
        vec!["status.view", "lifecycle.start"]
    );
    let mut socket = client.socket(ServerTopic::Metrics).await.unwrap();
    assert!(socket
        .next()
        .await
        .unwrap()
        .unwrap()
        .into_text()
        .unwrap()
        .contains("\"type\":\"status\""));
    socket.close(None).await.unwrap();
    let status = client.status(true).await.unwrap();
    assert_eq!(
        status.sleep_blocker,
        Some(vesta_server_client::presence::SleepBlocker::Disabled)
    );
    assert_eq!(
        serde_json::to_value(status).unwrap()["sleepBlocker"],
        json!({"reason":"disabled"})
    );
    tokio::time::sleep(std::time::Duration::from_millis(260)).await;
    assert_eq!(client.status(true).await.unwrap().state, "stopped");
}
#[tokio::test]
async fn typed_moderation_uses_snake_case_wire_and_no_console_authority() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    let client = agent.paired().await;
    let result = client
        .moderate(
            vesta_server_client::model::ModerationAction::Ban {
                player: "Alex".into(),
                reason: Some("reason".into()),
                duration_seconds: Some(60),
            },
            "00000000000000000000000000000000",
            "ban-1",
        )
        .await
        .unwrap();
    assert!(matches!(
        result,
        vesta_server_client::model::ModerationResult::Operation { .. }
    ));
}

#[tokio::test]
async fn unverified_capture_transport_cannot_send_credentials_or_redeem_a_code() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    let transport = Transport::new(agent.endpoint.clone(), None).unwrap();
    let signer = Ed25519Signer::from_seed([5; 32]);
    assert_eq!(
        Client::pair(&transport, "server-1", "code", &signer)
            .await
            .err()
            .unwrap()
            .code,
        ErrorCode::TlsFailed
    );
    assert_eq!(agent.state.pairs.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn lost_pairing_reply_is_unknown_and_never_automatically_redeemed_again() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    agent.state.lost_pair.store(true, Ordering::SeqCst);
    let transport =
        Transport::new(agent.endpoint.clone(), Some(agent.fingerprint.clone())).unwrap();
    let signer = Ed25519Signer::from_seed([5; 32]);
    assert_eq!(
        Client::pair(&transport, "server-1", "code", &signer)
            .await
            .err()
            .unwrap()
            .code,
        ErrorCode::PairOutcomeUnknown
    );
    assert_eq!(agent.state.pairs.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn rate_limit_guidance_pauses_background_work_without_a_retry_loop() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    let client = agent.paired().await;
    agent.state.rate_limit.store(true, Ordering::SeqCst);
    let error = client.status(false).await.unwrap_err();
    assert_eq!(error.code, ErrorCode::RateLimited);
    assert_eq!(error.retry_after_ms, Some(7000));
    assert!(client.transport.scheduler.paused_for().as_secs() >= 6);
    assert!(client
        .console_page_with_priority(None, 100, false)
        .await
        .is_err());
    assert_eq!(agent.state.status_reads.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn permission_refusals_are_learned_and_cross_server_challenges_are_not_signed() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    let client = agent.paired().await;
    agent.state.forbidden.store(true, Ordering::SeqCst);
    assert_eq!(
        client.status(true).await.unwrap_err().code,
        ErrorCode::Forbidden
    );
    assert_eq!(client.refused().await, vec!["status.view"]);
    let agent = Agent::start().await;
    let client = agent.paired().await;
    agent.state.wrong_identity.store(true, Ordering::SeqCst);
    assert_eq!(
        client.status(true).await.unwrap_err().code,
        ErrorCode::FingerprintMismatch
    );
    assert_eq!(agent.state.sessions.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn confirmation_is_bound_to_the_exact_generation_and_op_tokens_stay_native() {
    let _owner = TEST_OWNER.lock().await;
    use vesta_server_client::model::{ModerationAction, ModerationResult};
    let agent = Agent::start().await;
    let client = agent.paired().await;
    client
        .kill_prepare("00000000000000000000000000000000", "kill")
        .await
        .unwrap();
    assert_eq!(
        client
            .kill_prepare("11111111111111111111111111111111", "kill")
            .await
            .unwrap_err()
            .code,
        ErrorCode::Conflict
    );
    let result = client
        .moderate(
            ModerationAction::Op {
                player: "Alex".into(),
            },
            "00000000000000000000000000000000",
            "op",
        )
        .await
        .unwrap();
    assert!(matches!(
        result,
        ModerationResult::AwaitingConfirmation { .. }
    ));
    assert!(!serde_json::to_string(&result)
        .unwrap()
        .contains("native-only"));
    client.confirm("op", "players/moderate").await.unwrap();
    agent
        .state
        .expired_confirmation
        .store(true, Ordering::SeqCst);
    client
        .kill_prepare("00000000000000000000000000000000", "expired")
        .await
        .unwrap();
    assert_eq!(
        client
            .confirm("expired", "lifecycle/kill")
            .await
            .unwrap_err()
            .code,
        ErrorCode::ConfirmationExpired
    );
}
#[tokio::test]
async fn cancelling_a_read_waiter_does_not_leak_the_transport_or_leave_a_stuck_read() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    let client = agent.paired().await;
    client.status(true).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(260)).await;
    agent.state.slow_status.store(true, Ordering::SeqCst);
    let weak = Arc::downgrade(&client.transport);
    let caller = client.clone();
    let task = tokio::spawn(async move { caller.status(true).await });
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    task.abort();
    drop(client);
    tokio::time::sleep(std::time::Duration::from_millis(180)).await;
    assert!(weak.upgrade().is_none());
}

#[tokio::test]
async fn proactive_renewal_before_expiry_is_single_flight() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    agent.state.near_expiry_first.store(true, Ordering::SeqCst);
    let client = agent.paired().await;
    client.status(true).await.unwrap();
    let mut calls = vec![];
    for _ in 0..12 {
        let client = client.clone();
        calls.push(tokio::spawn(async move { client.status(true).await }));
    }
    for call in calls {
        call.await.unwrap().unwrap();
    }
    assert_eq!(agent.state.sessions.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn upgraded_uncertain_journals_reuse_the_original_wire_key() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    let client = agent.paired().await;
    let old_key = vesta_server_client::operations::intent_key("old-uncertain").unwrap();
    client.restore_legacy_intents([old_key.clone()]).unwrap();
    client
        .lifecycle("start", None, "old-uncertain")
        .await
        .unwrap();
    assert_eq!(
        agent.state.start_keys.lock().unwrap().as_slice(),
        &[old_key]
    );
}

fn console_details() -> Value {
    json!({"kind":"console.command", "actor":{"principal_id":"principal-1", "display_name":"Alex", "device_name":"Desktop"}, "summary":{"command":"say hello"}, "summary_purged":false, "outcome":"stdin_written"})
}

#[tokio::test]
async fn operation_list_detail_and_event_share_authorized_projection_and_session_identity() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    agent.state.modern.store(true, Ordering::SeqCst);
    *agent.state.operation_details.lock().unwrap() = Some(console_details());
    let client = agent.paired().await;
    // A reconstructed client can resolve self without an earlier capabilities call.
    let detail = serde_json::to_value(client.operation("operation-1").await.unwrap()).unwrap();
    let page = client.operations(None).await.unwrap();
    assert_eq!(page.next_cursor.as_deref(), Some("next-1"));
    let event = vesta_server_client::model::ServerEvent::Operation {
        operation: page.items[0].clone(),
    };
    assert_eq!(serde_json::to_value(event).unwrap()["operation"], detail);
    assert_eq!(detail["actor"]["self"], true);
    assert_eq!(detail["summary"]["command"], "say hello");
    assert_eq!(detail["outcome"], "stdin_written");
}

#[tokio::test]
async fn every_accepted_mutation_fetches_one_detail_and_preserves_its_intent() {
    let _owner = TEST_OWNER.lock().await;
    use vesta_server_client::model::{ModerationAction, ModerationResult};
    let generation = "00000000000000000000000000000000";
    for action in ["start", "stop", "restart", "kill", "console", "ban", "op"] {
        let agent = Agent::start().await;
        agent.state.modern.store(true, Ordering::SeqCst);
        let (kind, summary) = match action {
            "console" => ("console.command".to_owned(), json!({"command":"say hello"})),
            "ban" | "op" => (
                "players.moderate".to_owned(),
                json!({"action":action,"player":"Alex","duration_seconds":60}),
            ),
            _ => (
                format!("lifecycle.{action}"),
                json!({"target_generation":generation}),
            ),
        };
        *agent.state.operation_details.lock().unwrap() = Some(
            json!({"kind":kind, "actor":{"principal_id":"principal-1","display_name":"Alex","device_name":"Desktop"},"summary":summary,"summary_purged":false,"outcome":"succeeded"}),
        );
        let client = agent.paired().await;
        client.capabilities(None).await.unwrap();
        let operation = match action {
            "start" | "stop" | "restart" => client
                .lifecycle(action, Some(generation), action)
                .await
                .unwrap(),
            "kill" => {
                client.kill_prepare(generation, action).await.unwrap();
                assert_eq!(agent.state.operation_reads.load(Ordering::SeqCst), 0);
                client.confirm(action, "lifecycle/kill").await.unwrap()
            }
            "console" => client
                .console_send("say hello", generation, action)
                .await
                .unwrap(),
            _ => {
                let request = if action == "op" {
                    ModerationAction::Op {
                        player: "Alex".into(),
                    }
                } else {
                    ModerationAction::Ban {
                        player: "Alex".into(),
                        reason: None,
                        duration_seconds: Some(60),
                    }
                };
                match client.moderate(request, generation, action).await.unwrap() {
                    ModerationResult::Operation { operation } => operation,
                    ModerationResult::AwaitingConfirmation { .. } => {
                        assert_eq!(agent.state.operation_reads.load(Ordering::SeqCst), 0);
                        client.confirm(action, "players/moderate").await.unwrap()
                    }
                }
            }
        };
        assert_eq!(
            agent.state.operation_reads.load(Ordering::SeqCst),
            1,
            "{action}"
        );
        assert_eq!(operation.kind.as_deref(), Some(kind.as_str()), "{action}");
        assert!(operation.summary.is_some(), "{action}");
        assert!(operation.intent.is_some(), "{action}");
        assert_eq!(
            serde_json::to_value(operation).unwrap()["actor"]["self"],
            true,
            "{action}"
        );
    }
}

#[tokio::test]
async fn complete_receipt_skips_refetch_and_denied_detail_does_not_lose_acceptance() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    agent.state.modern.store(true, Ordering::SeqCst);
    agent
        .state
        .mutation_has_details
        .store(true, Ordering::SeqCst);
    *agent.state.operation_details.lock().unwrap() = Some(console_details());
    let client = agent.paired().await;
    let op = client.lifecycle("start", None, "complete").await.unwrap();
    assert!(op.summary.is_some());
    assert_eq!(op.state, "queued");
    assert_eq!(agent.state.operation_reads.load(Ordering::SeqCst), 0);

    let agent = Agent::start().await;
    agent
        .state
        .operation_read_denied
        .store(true, Ordering::SeqCst);
    let client = agent.paired().await;
    let op = client.lifecycle("start", None, "denied").await.unwrap();
    assert_eq!(op.state, "queued");
    assert_eq!(op.operation_id, "operation-1");
    assert!(op.summary.is_none());
    assert_eq!(agent.state.operation_reads.load(Ordering::SeqCst), 1);
    assert!(client.lifecycle("start", None, "denied").await.is_err());
    assert_eq!(agent.state.starts.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn named_pairing_sends_device_label_and_refuses_invalid_names_before_network() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    let transport =
        Transport::new(agent.endpoint.clone(), Some(agent.fingerprint.clone())).unwrap();
    let signer = Ed25519Signer::from_seed([17; 32]);
    Client::pair_named(&transport, "server-1", "code", &signer, "Home desktop")
        .await
        .unwrap();
    assert_eq!(*agent.state.pair_names.lock().unwrap(), ["Home desktop"]);
    for name in [
        String::new(),
        " ".into(),
        "a".repeat(65),
        "bad\nname".into(),
    ] {
        assert_eq!(
            Client::pair_named(&transport, "server-1", "code", &signer, &name)
                .await
                .err()
                .unwrap()
                .code,
            ErrorCode::InvalidInput
        );
    }
    assert_eq!(agent.state.pairs.load(Ordering::SeqCst), 1);
}
