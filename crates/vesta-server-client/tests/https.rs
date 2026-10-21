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

#[derive(Default)]
struct State {
    key: Mutex<Option<[u8; 32]>>,
    pairs: AtomicUsize,
    sessions: AtomicUsize,
    starts: AtomicUsize,
    status_reads: AtomicUsize,
    reject_old: AtomicBool,
    uncertain: AtomicBool,
    lost_confirmation: AtomicBool,
    modern: AtomicBool,
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
fn status() -> Value {
    json!({"state":"stopped","generation":null,"lifecycle":"offline","player_count":null,"player_count_known":false,"player_count_observed_at_ms":null,"uptime_seconds":null,"readiness":"stopped","readiness_reason":null,"readiness_evidence":"log_only","supervision":"in_process","supervisor":null})
}
impl Agent {
    async fn start() -> Self {
        let certificate = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let der = certificate.cert.der().to_vec();
        let fingerprint = leaf_fingerprint(&der);
        let config = rustls::ServerConfig::builder()
            .with_safe_defaults()
            .with_no_client_auth()
            .with_single_cert(
                vec![rustls::Certificate(der)],
                rustls::PrivateKey(certificate.key_pair.serialize_der()),
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
    let response = match path.as_str() {
        "/api/v3/status" => {
            plain(json!({"api_version":"3","server_id":"server-1","state":"offline","motd":{}}))
        }
        "/api/v3/manage/pair" => {
            state.pairs.fetch_add(1, Ordering::SeqCst);
            let key = URL_SAFE_NO_PAD
                .decode(body["public_key"].as_str().unwrap())
                .unwrap();
            *state.key.lock().unwrap() = Some(key.as_slice().try_into().unwrap());
            plain(
                json!({"server_id":"server-1","principal_id":"principal-1","device_id":"device-1","role":"owner"}),
            )
        }
        "/api/v3/auth/session/challenge" => {
            assert_eq!(body["device_id"], "device-1");
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
            plain(
                json!({"server_id":"server-1","token":format!("token-{n}"),"expires_at_ms":vesta_server_client::now_ms()+900_000}),
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
            assert!(req.headers()["idempotency-key"].as_bytes().len() >= 16);
            assert_eq!(body, json!({}));
            if state.uncertain.load(Ordering::SeqCst) {
                plain(json!({"api_version":"3","data":"response-lost-after-commit"}))
            } else {
                let mut r = envelope(operation("queued"));
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
        "/api/v3/manage/operations/operation-1" => envelope(operation("succeeded")),
        "/api/v3/manage/console" => envelope(
            json!({"items":[{"cursor":"server-1.console.1","text":"page","truncated":false}],"latest_cursor":"server-1.console.1","next_cursor":"server-1.console.1"}),
        ),
        "/api/v3/manage/players" => envelope(
            json!({"known":true,"generation":"00000000000000000000000000000000","player_count":1,"items":[{"name":"Alex"}]}),
        ),
        "/api/v3/manage/players/moderate" => {
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
    assert_eq!(op.state, "queued");
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
async fn uncertain_submission_is_not_duplicated_and_known_id_reconciles_by_get() {
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
    assert_eq!(agent.state.starts.load(Ordering::SeqCst), 1);
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
async fn additive_self_projection_and_status_stream_are_supported() {
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
    client.status(true).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(260)).await;
    assert_eq!(client.status(true).await.unwrap().state, "stopped");
}
#[tokio::test]
async fn typed_moderation_uses_snake_case_wire_and_no_console_authority() {
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
