//! Agent-shaped HTTPS fixtures exercise routing, DTO allowlists and compatibility.
use hyper::{service::service_fn, Body, Request, Response};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    convert::Infallible,
    sync::{Arc, Mutex},
};
use vesta_server_client::{
    auth::Ed25519Signer, endpoint::Endpoint, management::AccessPatch,
    operations::device_intent_key, transport::Transport, trust::leaf_fingerprint, Client, Error,
    ErrorCode,
};

static OWNER: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
#[path = "support/presence.rs"]
mod presence_tests;
#[derive(Clone, Debug)]
struct Call {
    method: String,
    route: String,
    body: Value,
    key: Option<String>,
}
#[derive(Default)]
struct State {
    routes: HashMap<(String, String), (u16, Value)>,
    calls: Vec<Call>,
    icon: Option<Vec<u8>>,
    icon_conflict: bool,
}
struct Agent {
    client: Arc<Client>,
    state: Arc<Mutex<State>>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Agent {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Agent {
    async fn start() -> Self {
        let certificate = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let der = certificate.cert.der().to_vec();
        let fingerprint = leaf_fingerprint(&der);
        let tls = rustls::ServerConfig::builder()
            .with_safe_defaults()
            .with_no_client_auth()
            .with_single_cert(
                vec![rustls::Certificate(der)],
                rustls::PrivateKey(certificate.key_pair.serialize_der()),
            )
            .unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(tls));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint =
            Endpoint::parse(&format!("https://{}", listener.local_addr().unwrap())).unwrap();
        let state = Arc::new(Mutex::new(State::default()));
        let shared = state.clone();
        let task = tokio::spawn(async move {
            loop {
                let (tcp, _) = listener.accept().await.unwrap();
                let acceptor = acceptor.clone();
                let state = shared.clone();
                tokio::spawn(async move {
                    if let Ok(tls) = acceptor.accept(tcp).await {
                        let service = service_fn(move |req| route(req, state.clone()));
                        let _ = hyper::server::conn::Http::new()
                            .serve_connection(tls, service)
                            .await;
                    }
                });
            }
        });
        let transport = Transport::new(endpoint, Some(fingerprint)).unwrap();
        let client = Client::new(
            transport,
            "server-1".into(),
            "device-1".into(),
            Arc::new(Ed25519Signer::from_seed([9; 32])),
        );
        Self {
            client,
            state,
            task,
        }
    }
    fn set(&self, method: &str, route: &str, value: Value) {
        self.reply(method, route, 200, value);
    }
    fn reply(&self, method: &str, route: &str, status: u16, value: Value) {
        self.state
            .lock()
            .unwrap()
            .routes
            .insert((method.into(), route.into()), (status, value));
    }
    fn calls(&self, route: &str) -> Vec<Call> {
        self.state
            .lock()
            .unwrap()
            .calls
            .iter()
            .filter(|c| c.route == route)
            .cloned()
            .collect()
    }
}
async fn route(
    mut req: Request<Body>,
    state: Arc<Mutex<State>>,
) -> Result<Response<Body>, Infallible> {
    let path = req.uri().path().to_owned();
    let method = req.method().to_string();
    let full = req.uri().path_and_query().unwrap().as_str().to_owned();
    let key = req
        .headers()
        .get("idempotency-key")
        .map(|v| v.to_str().unwrap().to_owned());
    let bytes = hyper::body::to_bytes(req.body_mut()).await.unwrap();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let mut state = state.lock().unwrap();
    state.calls.push(Call {
        method: method.clone(),
        route: full.clone(),
        body,
        key,
    });
    if path == "/api/v3/manage/server/icon" {
        assert_eq!(req.headers()["authorization"], "Bearer session");
        let etag = state
            .icon
            .as_ref()
            .map(|b| format!("\"{}\"", leaf_fingerprint(b)));
        if method == "GET" {
            return Ok(match (&state.icon, &etag) {
                (Some(bytes), Some(tag)) => Response::builder()
                    .header("content-type", "image/png")
                    .header("etag", tag)
                    .body(Body::from(bytes.clone()))
                    .unwrap(),
                _ => Response::builder()
                    .status(404)
                    .body(Body::from(
                        json!({"api_version":"3","error":{"code":"resource_not_found"}})
                            .to_string(),
                    ))
                    .unwrap(),
            });
        }
        assert!(req.headers().contains_key("idempotency-key"));
        if state.icon_conflict {
            state.icon_conflict = false;
            return Ok(Response::builder()
                .status(412)
                .body(Body::from(
                    json!({"api_version":"3","error":{"code":"precondition_failed"}}).to_string(),
                ))
                .unwrap());
        }
        match &etag {
            Some(tag) => assert_eq!(req.headers()["if-match"], tag.as_str()),
            None => assert_eq!(req.headers()["if-none-match"], "*"),
        }
        if method == "PUT" {
            assert_eq!(req.headers()["content-type"], "image/png");
            assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
            state.icon = Some(bytes.to_vec());
        } else {
            assert_eq!(method, "DELETE");
            state.icon = None;
        }
        return Ok(Response::new(Body::from(
            json!({"api_version":"3","data":{"ok":true}}).to_string(),
        )));
    }
    let (status, value) = if path == "/api/v3/auth/session/challenge" {
        (
            200,
            json!({"server_id":"server-1","nonce":"nonce","purpose":"vesta.management.session.v1"}),
        )
    } else if path == "/api/v3/auth/session" {
        (
            200,
            json!({"server_id":"server-1","token":"session","expires_at_ms":vesta_server_client::now_ms()+900_000}),
        )
    } else {
        assert_eq!(req.headers()["authorization"], "Bearer session");
        let (status, data) = state
            .routes
            .get(&(method, full))
            .cloned()
            .unwrap_or((501, json!({"code":"not_implemented"})));
        (
            status,
            if status < 300 {
                json!({"api_version":"3","data":data})
            } else {
                json!({"api_version":"3","error":data})
            },
        )
    };
    Ok(Response::builder()
        .status(status)
        .body(Body::from(value.to_string()))
        .unwrap())
}
fn role() -> Value {
    json!({"id":"viewer","name":"Viewer","rank":10,"builtin":true,"capabilities":[{"capability":"status.view","scope":"*"}]})
}
fn user() -> Value {
    json!({"id":"principal-1","display_name":"Alex","minecraft_accounts":[{"uuid":"abc","name":"AlexMC"}],"roles":[{"role":role(),"expires_at_ms":null}],"rank":10,"device_count":2,"version":"opaque-user","default_role":null,"overrides":[]})
}
fn job(kind: &str, state: &str) -> Value {
    json!({"id":"job-1","profile":"daily","kind":kind,"state":state,"requested_by":"principal-1","snapshot_id":"a".repeat(32),"error_code":null,"created_at_ms":42,"started_at_ms":null,"finished_at_ms":null,
    "result":{"files_new":2,"verified":true,"files_written":3,"files_removed":1,"safety_snapshot_id":"b".repeat(32),"restored_to":"private/path","changed_paths":["private"],"confirmation_token":"DO-NOT-EXPOSE"}})
}
fn users(a: &Agent) {
    a.set(
        "GET",
        "/api/v3/manage/users?offset=0&limit=100",
        json!({"users":[user()],"next_offset":null}),
    );
}
fn settings() -> Value {
    json!({"settings":{"anonymous":"viewer","new_user":"viewer","whitelist":"viewer","whitelist_enabled":true,"password":"viewer"},"version":"opaque-access"})
}
fn restore() -> Value {
    json!({"profile":"daily","snapshot":"a".repeat(32),"paths":[],"skip_safety_snapshot":false})
}

#[tokio::test]
async fn backup_reads_receipts_storage_snapshot_merge_and_name_cache() {
    let _owner = OWNER.lock().await;
    let a = Agent::start().await;
    users(&a);
    a.set("GET", "/api/v3/manage/backups?before=opaque%26cursor", json!({"profiles":[{"name":"daily","mode":"stopped","keep_last":7,"keep_daily":1,"keep_weekly":2,"keep_monthly":0,"on_mutation":"fail-world","warn_seconds":60,"max_snapshots":null}],"jobs":[job("backup","queued")],"next_before":"next","recovery_required":true,"restore_mode":"inspection_only"}));
    let overview = a.client.backups(Some("opaque&cursor")).await.unwrap();
    assert_eq!(overview.jobs[0].requested_by.as_deref(), Some("Alex"));
    let dto = serde_json::to_value(overview).unwrap();
    assert_eq!(dto["profiles"][0]["keepLast"], 7);
    assert_eq!(dto["nextBefore"], "next");
    assert!(dto["recoveryRequired"].as_bool().unwrap());
    assert!(!dto.to_string().contains("DO-NOT-EXPOSE"));
    assert!(!dto.to_string().contains("private/path"));
    a.set("GET", "/api/v3/manage/backups/snapshots?profile=daily&limit=100", json!({"snapshots":[{"id":"normal","time":"2026-10-22T10:00:00+10:00"}],"next_before":"cursor"}));
    a.set(
        "GET",
        "/api/v3/manage/backups/snapshots?profile=daily&before=cursor&limit=100",
        json!({"snapshots":[{"id":"old","time":"2026-10-21T23:59:59Z"}],"next_before":null}),
    );
    a.set(
        "GET",
        "/api/v3/manage/backups/safety-snapshots?profile=daily&limit=100",
        json!({"snapshots":[{"id":"safety","time":"2026-10-22T00:00:00.001Z"}]}),
    );
    let snapshots = a.client.backup_snapshots("daily").await.unwrap();
    assert_eq!(
        snapshots.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
        ["safety", "normal", "old"]
    );
    assert!(snapshots[0].safety);
    assert!(!snapshots[1].safety);
    a.set("GET", "/api/v3/manage/backups/storage", json!({"repository_bytes":123,"restore_points":2,"safety_snapshots":1,"free_bytes":null,"limits":{"max_snapshots":4,"max_repository_bytes":null,"min_free_bytes":0},"backups_stopped":"backup_snapshot_limit_reached"}));
    let storage = serde_json::to_value(a.client.backup_storage().await.unwrap()).unwrap();
    assert_eq!(storage["repositoryBytes"], 123);
    assert_eq!(storage["stopped"], "backup_snapshot_limit_reached");
    a.set(
        "GET",
        "/api/v3/manage/backups/jobs/job-1",
        json!({"job":job("backup","queued")}),
    );
    for action in ["run", "verify", "restore"] {
        let route = format!("/api/v3/manage/backups/{action}");
        a.set("POST", &route, json!({"job_id":"job-1","kind":action}));
        let body = if action == "restore" {
            json!({"profile":"daily","snapshot":"a".repeat(32),"paths":["world"]})
        } else {
            json!({"profile":"daily"})
        };
        let job = a
            .client
            .backup_submit(action, body.clone(), action)
            .await
            .unwrap();
        assert_eq!(job.requested_by.as_deref(), Some("Alex"));
        let call = &a.calls(&route)[0];
        assert_eq!(call.body, body);
        assert_eq!(
            call.key.as_deref(),
            Some(
                device_intent_key("server-1", "device-1", action)
                    .unwrap()
                    .as_str()
            )
        );
    }
    assert_eq!(a.calls("/api/v3/manage/users?offset=0&limit=100").len(), 1);
    a.set(
        "POST",
        "/api/v3/manage/backups/jobs/job-1/resolve-recovery",
        json!({"job_id":"job-1","state":"failed"}),
    );
    a.client.backup_resolve_recovery("job-1").await.unwrap();
    assert_eq!(
        a.calls("/api/v3/manage/backups/jobs/job-1/resolve-recovery")[0].body,
        json!({})
    );
}

#[tokio::test]
async fn restore_token_stays_native_is_consumed_once_and_prepare_is_never_retried() {
    let _owner = OWNER.lock().await;
    let a = Agent::start().await;
    users(&a);
    let route = "/api/v3/manage/backups/restore-in-place";
    a.set("POST", route, json!({"job_id":"job-1","kind":"restore_in_place","state":"awaiting_confirmation","confirmation_token":"native-only-secret","expires_at_ms":vesta_server_client::now_ms()+120000}));
    a.set(
        "GET",
        "/api/v3/manage/backups/jobs/job-1",
        json!({"job":job("restore_in_place","awaiting_confirmation")}),
    );
    let prepared = a
        .client
        .backup_restore_prepare(restore(), "prepare")
        .await
        .unwrap();
    let ipc = serde_json::to_string(&prepared).unwrap();
    assert!(!ipc.contains("secret"));
    assert!(!ipc.contains("token"));
    assert_eq!(prepared.job.created_at_ms, 42);
    assert_eq!(
        a.client
            .backup_restore_prepare(restore(), "prepare")
            .await
            .unwrap_err()
            .code,
        ErrorCode::OutcomeUnknown
    );
    assert_eq!(a.calls(route).len(), 1);
    a.set(
        "POST",
        "/api/v3/manage/backups/jobs/job-1/confirm",
        json!({"job_id":"job-1","state":"queued"}),
    );
    assert_eq!(
        a.client
            .backup_restore_confirm("job-1")
            .await
            .unwrap()
            .state,
        "queued"
    );
    let calls = a.calls("/api/v3/manage/backups/jobs/job-1/confirm");
    assert_eq!(
        calls[0].body,
        json!({"confirmation_token":"native-only-secret"})
    );
    assert_eq!(
        calls[0].key.as_deref(),
        Some(
            device_intent_key(
                "server-1",
                "device-1",
                &format!(
                    "backup-confirm:{}",
                    vesta_server_client::operations::intent_key("prepare").unwrap()
                )
            )
            .unwrap()
            .as_str()
        )
    );
    assert_eq!(
        a.client
            .backup_restore_confirm("job-1")
            .await
            .unwrap_err()
            .code,
        ErrorCode::ConfirmationExpired
    );
    a.reply(
        "POST",
        route,
        401,
        json!({"code":"management_session_invalid"}),
    );
    assert_eq!(
        a.client
            .backup_restore_prepare(restore(), "401")
            .await
            .unwrap_err()
            .code,
        ErrorCode::CredentialsRejected
    );
    assert_eq!(a.calls(route).len(), 2);
    assert_eq!(a.calls("/api/v3/auth/session").len(), 1);
    a.reply("POST", route, 504, json!({"code":"gateway_timeout"}));
    assert_eq!(
        a.client
            .backup_restore_prepare(restore(), "lost")
            .await
            .unwrap_err()
            .code,
        ErrorCode::OutcomeUnknown
    );
    assert_eq!(
        a.client
            .backup_restore_prepare(restore(), "lost")
            .await
            .unwrap_err()
            .code,
        ErrorCode::OutcomeUnknown
    );
    assert_eq!(a.calls(route).len(), 3);
}

#[tokio::test]
async fn users_roles_devices_invitations_and_access_mutations_match_wire() {
    let _owner = OWNER.lock().await;
    let a = Agent::start().await;
    users(&a);
    let page = a.client.users(0).await.unwrap();
    assert_eq!(page.users[0].version, "opaque-user");
    assert_eq!(
        page.users[0].roles[0].role.capabilities[0].capability,
        "status.view"
    );
    a.set("GET", "/api/v3/manage/roles", json!({"roles":[role()]}));
    assert!(a.client.roles().await.unwrap()[0].builtin);
    a.set("PUT", "/api/v3/manage/users/principal-1/roles", user());
    let roles = json!({"add":["viewer"],"remove":[],"expected_version":"opaque-user"});
    assert_eq!(
        a.client
            .user_roles("principal-1", roles.clone(), "roles")
            .await
            .unwrap()
            .display_name,
        "Alex"
    );
    assert_eq!(
        a.calls("/api/v3/manage/users/principal-1/roles")[0].body,
        roles
    );
    a.set("GET","/api/v3/manage/devices?offset=0&limit=100",json!({"devices":[{"id":"device-1","name":"Desktop","revoked":false,"current":true,"user":{"id":"principal-1","display_name":"Alex"},"last_seen_at_ms":55}],"next_offset":100}));
    a.set("GET","/api/v3/manage/devices?offset=100&limit=100",json!({"devices":[{"id":"device-2","name":"Laptop","revoked":true,"current":false,"user":{"id":"principal-1","display_name":"Alex"},"last_seen_at_ms":null}],"next_offset":null}));
    let devices = a.client.devices().await.unwrap();
    assert_eq!(devices.len(), 2);
    assert!(devices[0].current);
    assert_eq!(devices[0].user_name.as_deref(), Some("Alex"));
    assert_eq!(devices[0].last_seen_at_ms, Some(55));
    a.set(
        "DELETE",
        "/api/v3/manage/devices/device-2",
        json!({"revoked":true}),
    );
    a.client
        .device_revoke("device-2", "revoke-device")
        .await
        .unwrap();
    assert_eq!(
        a.calls("/api/v3/manage/devices/device-2")[0].body,
        Value::Null
    );
    a.set("GET","/api/v3/manage/invitations?offset=0&limit=100",json!({"invitations":[{"id":"invite-1","role":{"id":"viewer","name":"Viewer","rank":10},"created_at_ms":2,"expires_at_ms":999,"created_by":{"display_name":"Owner"}}],"next_offset":null}));
    let invitations = a.client.invitations().await.unwrap();
    assert_eq!(invitations[0].created_by.as_deref(), Some("Owner"));
    a.set("POST","/api/v3/manage/invitations",json!({"id":"invite-1","code":"one-time-code","pairing_link":"vesta://pair?endpoint=x&code=y&fp=z&sid=s","role":"viewer","expires_at_ms":999}));
    assert!(a
        .client
        .invitation_create("viewer", 15, "invite")
        .await
        .unwrap()
        .pairing_link
        .is_some());
    assert_eq!(
        a.calls("/api/v3/manage/invitations")[0].body,
        json!({"role":"viewer","expires_minutes":15})
    );
    a.set(
        "DELETE",
        "/api/v3/manage/invitations/invite-1",
        json!({"revoked":true}),
    );
    a.client
        .invitation_revoke("invite-1", "revoke-invite")
        .await
        .unwrap();
    a.set("GET", "/api/v3/manage/access-sources", settings());
    assert_eq!(
        a.client.access_sources().await.unwrap().version,
        "opaque-access"
    );
    a.set("PATCH", "/api/v3/manage/access-sources", settings());
    let patch: AccessPatch =
        serde_json::from_value(json!({"newUser":"viewer","whitelistEnabled":false})).unwrap();
    a.client
        .access_sources_update(&patch, "opaque-access", "access")
        .await
        .unwrap();
    let call = &a.calls("/api/v3/manage/access-sources")[1];
    assert_eq!(call.method, "PATCH");
    assert_eq!(
        call.body,
        json!({"expected_version":"opaque-access","new_user":"viewer","whitelist_enabled":false})
    );
    assert!(serde_json::from_value::<AccessPatch>(json!({"version":"inject"})).is_err());
    for (route, intent) in [
        ("/api/v3/manage/users/principal-1/roles", "roles"),
        ("/api/v3/manage/devices/device-2", "revoke-device"),
        ("/api/v3/manage/invitations", "invite"),
        ("/api/v3/manage/invitations/invite-1", "revoke-invite"),
    ] {
        assert_eq!(
            a.calls(route)[0].key.as_deref(),
            Some(
                device_intent_key("server-1", "device-1", intent)
                    .unwrap()
                    .as_str()
            )
        );
    }
}

#[tokio::test]
async fn old_agents_fall_back_only_for_missing_routes_and_do_not_invent_identity() {
    let _owner = OWNER.lock().await;
    let a = Agent::start().await;
    users(&a);
    a.set(
        "GET",
        "/api/v3/manage/users/principal-1/devices",
        json!({"devices":[{"id":"device-1","name":"Desktop","revoked":false}]}),
    );
    let devices = a.client.devices().await.unwrap();
    assert!(devices[0].current);
    assert_eq!(devices[0].last_seen_at_ms, None);
    assert_eq!(devices[0].user_id.as_deref(), Some("principal-1"));
    // The real pre-inventory adapter recognized /invitations but returned 400 for GET.
    a.reply(
        "GET",
        "/api/v3/manage/invitations?offset=0&limit=100",
        400,
        json!({"code":"invalid_request"}),
    );
    assert_eq!(
        a.client.invitations().await.unwrap_err().code,
        ErrorCode::Unsupported
    );
    assert_eq!(
        a.client
            .invitation_revoke("old-id", "old")
            .await
            .unwrap_err()
            .code,
        ErrorCode::Unsupported
    );
    a.set(
        "POST",
        "/api/v3/manage/invitations",
        json!({"issued":true,"code":"old-code","role":"viewer","expires_at_ms":9}),
    );
    let issued = a
        .client
        .invitation_create("viewer", 1, "old-invite")
        .await
        .unwrap();
    assert!(issued.id.is_none());
    assert!(issued.pairing_link.is_none());
    a.set(
        "POST",
        "/api/v3/manage/invitations",
        json!({"issued":true,"role":"viewer","expires_at_ms":9}),
    );
    assert_eq!(
        a.client
            .invitation_create("viewer", 1, "old-invite")
            .await
            .unwrap_err()
            .code,
        ErrorCode::OutcomeUnknown
    );
    a.reply(
        "DELETE",
        "/api/v3/manage/invitations/missing",
        404,
        json!({"code":"resource_not_found"}),
    );
    assert_eq!(
        a.client
            .invitation_revoke("missing", "missing-invite")
            .await
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
    // A forbidden global route must not probe individual users.
    let b = Agent::start().await;
    b.reply(
        "GET",
        "/api/v3/manage/devices?offset=0&limit=100",
        403,
        json!({"code":"management_forbidden"}),
    );
    assert_eq!(
        b.client.devices().await.unwrap_err().code,
        ErrorCode::Forbidden
    );
    assert_eq!(b.calls("/api/v3/manage/users?offset=0&limit=100").len(), 0);
    b.reply(
        "GET",
        "/api/v3/manage/users?offset=0&limit=100",
        403,
        json!({"code":"management_forbidden"}),
    );
    b.set(
        "GET",
        "/api/v3/manage/backups/jobs/job-1",
        json!({"job":job("backup","queued")}),
    );
    assert!(b
        .client
        .backup_job("job-1")
        .await
        .unwrap()
        .requested_by
        .is_none());
}

#[tokio::test]
async fn pack_routes_and_fixed_error_mapping() {
    let _owner = OWNER.lock().await;
    let a = Agent::start().await;
    for route in ["pack/publish", "pack/minimum"] {
        a.set(
            "POST",
            &format!("/api/v3/manage/{route}"),
            json!({"outcome":"succeeded","hosted_revision":"123","minimum_revision":"122"}),
        );
    }
    assert_eq!(
        a.client
            .pack_publish("0", "publish")
            .await
            .unwrap()
            .hosted_revision,
        "123"
    );
    assert_eq!(
        a.client
            .pack_minimum("123", "122", "minimum")
            .await
            .unwrap()
            .minimum_revision,
        "122"
    );
    assert_eq!(
        a.calls("/api/v3/manage/pack/publish")[0].body,
        json!({"expected_revision":"0"})
    );
    assert_eq!(
        a.calls("/api/v3/manage/pack/minimum")[0].body,
        json!({"expected_revision":"123","minimum_revision":"122"})
    );
    for (status, code, expected) in [
        (409, "backup_busy", ErrorCode::ServerBusy),
        (404, "backup_profile_unknown", ErrorCode::NotFound),
        (404, "backup_job_unknown", ErrorCode::NotFound),
        (404, "backups_not_configured", ErrorCode::Unsupported),
        (
            409,
            "backup_confirmation_invalid",
            ErrorCode::ConfirmationExpired,
        ),
        (
            409,
            "backup_confirmation_expired",
            ErrorCode::ConfirmationExpired,
        ),
        (409, "idempotency_conflict", ErrorCode::Conflict),
        (409, "backup_idempotency_conflict", ErrorCode::Conflict),
        (
            409,
            "backup_policy_revision_conflict",
            ErrorCode::StaleTarget,
        ),
        (412, "precondition_failed", ErrorCode::StaleTarget),
    ] {
        assert_eq!(Error::wire(status, code, None).code, expected);
    }
    for route in [
        "/api/v3/manage/users/p/roles",
        "/api/v3/manage/access-sources",
    ] {
        assert_eq!(
            Error::wire_for_route(409, "permission_conflict", None, route).code,
            ErrorCode::StaleTarget
        );
        assert_eq!(
            Error::wire_for_route(409, "idempotency_conflict", None, route).code,
            ErrorCode::Conflict
        );
    }
    assert_eq!(
        a.client.pack_publish("0", "").await.unwrap_err().code,
        ErrorCode::InvalidInput
    );
    assert_eq!(
        a.client
            .device_revoke("../server", "intent")
            .await
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
}

#[tokio::test]
async fn preparation_survives_detail_failure_without_replay_and_expired_tokens_are_not_sent() {
    let _owner = OWNER.lock().await;
    let a = Agent::start().await;
    let route = "/api/v3/manage/backups/restore-in-place";
    a.set("POST", route, json!({"job_id":"job-1","confirmation_token":"retained-native-secret","expires_at_ms":vesta_server_client::now_ms()+60000}));
    // The accepted receipt cannot be represented as a full DTO until its detail is visible.
    assert_eq!(
        a.client
            .backup_restore_prepare(restore(), "detail-failure")
            .await
            .unwrap_err()
            .code,
        ErrorCode::OutcomeUnknown
    );
    assert_eq!(
        a.client
            .backup_restore_prepare(restore(), "detail-failure")
            .await
            .unwrap_err()
            .code,
        ErrorCode::OutcomeUnknown
    );
    assert_eq!(a.calls(route).len(), 1);
    a.set(
        "POST",
        "/api/v3/manage/backups/jobs/job-1/confirm",
        json!({"job_id":"job-1","state":"queued"}),
    );
    a.set(
        "GET",
        "/api/v3/manage/backups/jobs/job-1",
        json!({"job":job("restore_in_place","queued")}),
    );
    assert_eq!(
        a.client
            .backup_restore_confirm("job-1")
            .await
            .unwrap()
            .state,
        "queued"
    );
    assert_eq!(
        a.calls("/api/v3/manage/backups/jobs/job-1/confirm")[0].body["confirmation_token"],
        "retained-native-secret"
    );
    a.set(
        "POST",
        route,
        json!({"job_id":"job-1","confirmation_token":"expired-secret","expires_at_ms":1}),
    );
    a.client
        .backup_restore_prepare(restore(), "expired")
        .await
        .unwrap();
    assert_eq!(
        a.client
            .backup_restore_confirm("job-1")
            .await
            .unwrap_err()
            .code,
        ErrorCode::ConfirmationExpired
    );
    assert_eq!(
        a.calls("/api/v3/manage/backups/jobs/job-1/confirm").len(),
        1
    );
}

#[tokio::test]
async fn mutation_invalidates_reads_and_large_old_agent_fallback_respects_budget() {
    let _owner = OWNER.lock().await;
    let a = Agent::start().await;
    a.set("GET","/api/v3/manage/invitations?offset=0&limit=100",json!({"invitations":[{"id":"i","role":{"id":"viewer","name":"Viewer","rank":1},"created_at_ms":1,"expires_at_ms":2,"created_by":null}],"next_offset":null}));
    assert_eq!(a.client.invitations().await.unwrap().len(), 1);
    a.set(
        "DELETE",
        "/api/v3/manage/invitations/i",
        json!({"revoked":true}),
    );
    a.client.invitation_revoke("i", "revoke").await.unwrap();
    a.set(
        "GET",
        "/api/v3/manage/invitations?offset=0&limit=100",
        json!({"invitations":[],"next_offset":null}),
    );
    assert!(a.client.invitations().await.unwrap().is_empty()); // No sleep: must bypass old projection.
    let b = Agent::start().await;
    let mut users = Vec::new();
    for n in 0..45 {
        let mut u = user();
        u["id"] = json!(format!("principal-{n}"));
        users.push(u);
        b.set(
            "GET",
            &format!("/api/v3/manage/users/principal-{n}/devices"),
            json!({"devices":[]}),
        );
    }
    b.set(
        "GET",
        "/api/v3/manage/users?offset=0&limit=100",
        json!({"users":users,"next_offset":null}),
    );
    assert!(matches!(
        b.client.devices().await.unwrap_err().code,
        ErrorCode::RateLimited | ErrorCode::ServerBusy
    ));
    assert!(b.state.lock().unwrap().calls.len() <= 40);
}
