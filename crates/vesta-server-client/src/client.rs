#[path = "automation.rs"]
pub mod automation;
#[path = "backups_config.rs"]
pub mod backups_config;
#[path = "branding.rs"]
pub mod branding;
#[path = "content.rs"]
pub mod content;
#[path = "pack.rs"]
pub mod pack;
#[path = "hosting.rs"]
pub mod hosting;
#[path = "management.rs"]
pub mod management;
#[path = "presence.rs"]
pub mod presence;
use crate::role_defaults::role_defaults;
use crate::{
    auth::{self, Challenge, DeviceSigner, Enrollment, Session},
    model::*,
    operations::{device_intent_key, generation, intent_key},
    transport::{Socket, Transport},
    Error, ErrorCode, Result,
};
use reqwest::Method;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, Mutex as StdMutex},
};
use tokio::sync::Mutex;

struct SessionState {
    session: Option<Session>,
    failure: Option<(std::time::Instant, Error)>,
}
struct Prepared {
    path: String,
    body: Value,
    key: String,
    operation_id: String,
    expires: i64,
    token: zeroize::Zeroizing<String>,
}
pub struct Client {
    pub transport: Arc<Transport>,
    pub server_id: String,
    device_id: String,
    signer: Arc<dyn DeviceSigner>,
    session: Mutex<SessionState>,
    refused: Mutex<Vec<String>>,
    prepared: Mutex<HashMap<String, Prepared>>,
    mutations: Mutex<()>,
    intents: Mutex<HashMap<String, Intent>>,
    legacy_intents: StdMutex<HashSet<String>>,
    principal_id: StdMutex<Option<String>>,
    principal_lookup: Mutex<bool>,
    completed_reads: StdMutex<VecDeque<String>>,
    pub(crate) file_validators: Mutex<HashMap<String, (String, String)>>,
    management: management::State,
    hosting: hosting::State,
}
#[derive(Clone)]
enum Intent {
    Accepted {
        path: String,
        digest: String,
        operation: ServerOperation,
    },
    Uncertain {
        path: String,
        digest: String,
    },
}
enum Submission {
    Operation(ServerOperation),
    Prepared(KillPreparation),
}
impl Submission {
    fn operation(self) -> Result<ServerOperation> {
        match self {
            Self::Operation(o) => Ok(o),
            Self::Prepared(_) => Err(Error::new(ErrorCode::Conflict)),
        }
    }
}
impl Client {
    /// Preserve pre-followup journal keys so upgrading cannot submit an uncertain
    /// old intent under a new key. Only hashes are restored, never payloads.
    pub fn restore_legacy_intents(&self, keys: impl IntoIterator<Item = String>) -> Result<()> {
        let mut legacy = self
            .legacy_intents
            .lock()
            .map_err(|_| Error::new(ErrorCode::Internal))?;
        for key in keys {
            if legacy.len() >= 4096 {
                return Err(Error::new(ErrorCode::ServerBusy));
            }
            legacy.insert(key);
        }
        Ok(())
    }
    fn intent_key(&self, intent: &str) -> Result<String> {
        let old = intent_key(intent)?;
        if self
            .legacy_intents
            .lock()
            .map_err(|_| Error::new(ErrorCode::Internal))?
            .contains(&old)
        {
            return Ok(old);
        }
        device_intent_key(&self.server_id, &self.device_id, intent)
    }

    /// A trust approval retires every old pool/session, including memory-only
    /// connections, without moving the key through IPC or plaintext storage.
    pub fn repin(&self, transport: Arc<Transport>) -> Arc<Self> {
        let client = Self::new(
            transport,
            self.server_id.clone(),
            self.device_id.clone(),
            self.signer.clone(),
        );
        if let Ok(legacy) = self.legacy_intents.lock() {
            let _ = client.restore_legacy_intents(legacy.iter().cloned());
        }
        client
    }
    pub async fn renewal_delay(&self) -> std::time::Duration {
        let state = self.session.lock().await;
        std::time::Duration::from_millis(
            state
                .session
                .as_ref()
                .map(|s| (s.expires_at_ms - crate::now_ms() - 120_000).max(1000) as u64)
                .unwrap_or(1000),
        )
    }
    pub fn new(
        transport: Arc<Transport>,
        server_id: String,
        device_id: String,
        signer: Arc<dyn DeviceSigner>,
    ) -> Arc<Self> {
        Arc::new(Self {
            transport,
            server_id,
            device_id,
            signer,
            session: Mutex::new(SessionState {
                session: None,
                failure: None,
            }),
            refused: Default::default(),
            prepared: Default::default(),
            mutations: Default::default(),
            intents: Default::default(),
            legacy_intents: Default::default(),
            principal_id: Default::default(),
            principal_lookup: Default::default(),
            completed_reads: Default::default(),
            file_validators: Default::default(),
            management: Default::default(),
            hosting: Default::default(),
        })
    }
    pub async fn pair(
        transport: &Arc<Transport>,
        server_id: &str,
        code: &str,
        signer: &dyn DeviceSigner,
    ) -> Result<Enrollment> {
        Self::pair_named(transport, server_id, code, signer, "Vesta Launcher").await
    }
    /// Enroll with the caller's bounded human-readable device name.
    pub async fn pair_named(
        transport: &Arc<Transport>,
        server_id: &str,
        code: &str,
        signer: &dyn DeviceSigner,
        device_name: &str,
    ) -> Result<Enrollment> {
        if device_name.trim().is_empty()
            || device_name.len() > 64
            || device_name.chars().any(char::is_control)
        {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        if code.is_empty() || code.len() > 256 {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        let value = transport
            .request(
                Method::POST,
                "/api/v3/manage/pair",
                None,
                Some(
                    json!({"code":code,"device_name":device_name,"public_key":signer.public_key()}),
                ),
                None,
                true,
            )
            .await
            .map_err(|e| {
                if matches!(
                    e.code,
                    ErrorCode::Timeout
                        | ErrorCode::Unreachable
                        | ErrorCode::OutcomeUnknown
                        | ErrorCode::Unsupported
                ) {
                    Error::new(ErrorCode::PairOutcomeUnknown)
                } else if e.code == ErrorCode::CredentialsRejected {
                    Error::new(ErrorCode::PairCodeInvalid)
                } else {
                    e
                }
            })?;
        let enrollment: Enrollment =
            serde_json::from_value(value).map_err(|_| Error::new(ErrorCode::PairOutcomeUnknown))?;
        auth::check_identity(server_id, &enrollment.server_id)?;
        Ok(enrollment)
    }
    pub(crate) async fn token(&self, rejected: Option<&str>) -> Result<zeroize::Zeroizing<String>> {
        let mut state = self.session.lock().await;
        if let Some(s) = &state.session {
            if s.expires_at_ms > crate::now_ms() + 120_000 && rejected != Some(s.token.as_str()) {
                return Ok(s.token.clone());
            }
        }
        if let Some((at, error)) = &state.failure {
            if at.elapsed().as_secs() < 2 {
                return Err(error.clone());
            }
        }
        let renewed = async {
            let challenge = self
                .transport
                .request(
                    Method::POST,
                    "/api/v3/auth/session/challenge",
                    None,
                    Some(json!({"device_id":self.device_id})),
                    None,
                    true,
                )
                .await?;
            let c: Challenge = serde_json::from_value(challenge)
                .map_err(|_| Error::new(ErrorCode::Unsupported))?;
            auth::check_identity(&self.server_id, &c.server_id)?;
            if c.purpose != auth::SESSION_PURPOSE
                || c.nonce.is_empty()
                || c.nonce.len() > 256
                || !c
                    .nonce
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
            {
                return Err(Error::new(ErrorCode::Unsupported));
            }
            let signature = self
                .signer
                .sign(&auth::signing_bytes(&c.server_id, &c.nonce))
                .await?;
            let session = self
                .transport
                .request(
                    Method::POST,
                    "/api/v3/auth/session",
                    None,
                    Some(json!({"device_id":self.device_id,"nonce":c.nonce,"signature":signature})),
                    None,
                    true,
                )
                .await?;
            let s: Session =
                serde_json::from_value(session).map_err(|_| Error::new(ErrorCode::Unsupported))?;
            auth::check_identity(&self.server_id, &s.server_id)?;
            if s.expires_at_ms <= crate::now_ms() || s.token.is_empty() {
                return Err(Error::new(ErrorCode::CredentialsRejected));
            }
            Ok(s)
        }
        .await;
        match renewed {
            Ok(s) => {
                let token = s.token.clone();
                state.session = Some(s);
                state.failure = None;
                self.refused.lock().await.clear();
                Ok(token)
            }
            Err(e) => {
                state.session = None;
                state.failure = Some((std::time::Instant::now(), e.clone()));
                Err(e)
            }
        }
    }
    pub async fn refused(&self) -> Vec<String> {
        self.refused.lock().await.clone()
    }
    pub async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        key: Option<&str>,
        interactive: bool,
        capability: &str,
    ) -> Result<Value> {
        let mut token = self.token(None).await?;
        let mut result = self
            .transport
            .request(
                method.clone(),
                path,
                Some(&token),
                body.clone(),
                key,
                interactive,
            )
            .await;
        if result
            .as_ref()
            .is_err_and(|e| e.code == ErrorCode::CredentialsRejected)
        {
            token = self.token(Some(&token)).await?;
            result = self
                .transport
                .request(method, path, Some(&token), body, key, interactive)
                .await;
        }
        if result
            .as_ref()
            .is_err_and(|e| e.code == ErrorCode::Forbidden)
            && !capability.is_empty()
        {
            let mut refused = self.refused.lock().await;
            if !refused.iter().any(|v| v == capability) && refused.len() < 128 {
                refused.push(capability.into());
            }
        }
        result
    }
    pub async fn get(&self, route: &str, interactive: bool, capability: &str) -> Result<Value> {
        self.request(
            Method::GET,
            &format!("/api/v3/manage/{route}"),
            None,
            None,
            interactive,
            capability,
        )
        .await
    }
    pub async fn status(&self, interactive: bool) -> Result<ServerStatus> {
        let status: ServerStatus = from_wire(
            self.get("server/status", interactive, "status.view")
                .await?,
        )?;
        status.validate()?;
        Ok(status)
    }
    pub async fn info(&self) -> Result<ServerInfo> {
        let info: ServerInfo = from_wire(self.get("server", true, "status.view").await?)?;
        auth::check_identity(&self.server_id, &info.server_id)?;
        Ok(info)
    }
    pub async fn capabilities(&self, role: Option<&str>) -> Result<CapabilityView> {
        match self.get("session", true, "").await {
            Ok(value) => {
                auth::check_identity(
                    &self.server_id,
                    value
                        .get("server_id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| Error::new(ErrorCode::Unsupported))?,
                )?;
                let granted = serde_json::from_value(
                    value.get("capabilities").cloned().unwrap_or(Value::Null),
                )
                .map_err(|_| Error::new(ErrorCode::Unsupported))?;
                *self
                    .principal_id
                    .lock()
                    .map_err(|_| Error::new(ErrorCode::Internal))? = value
                    .get("principal_id")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                Ok(CapabilityView {
                    source: "session".into(),
                    roles: value.get("roles").and_then(Value::as_array).map(|roles| {
                        roles
                            .iter()
                            .filter_map(|role| {
                                role.get("id").and_then(Value::as_str).map(str::to_owned)
                            })
                            .collect()
                    }),
                    granted,
                    refused: self.refused().await,
                })
            }
            Err(e) if matches!(e.code, ErrorCode::NotFound | ErrorCode::Unsupported) => {
                Ok(CapabilityView {
                    roles: None,
                    source: if role.is_some() {
                        "role_defaults"
                    } else {
                        "unknown"
                    }
                    .into(),
                    granted: role_defaults(role),
                    refused: self.refused().await,
                })
            }
            Err(e) => Err(e),
        }
    }
    pub async fn socket(&self, topic: ServerTopic) -> Result<Socket> {
        let path = match topic {
            ServerTopic::Console => "/api/v3/manage/console/stream",
            ServerTopic::Metrics | ServerTopic::Status => "/api/v3/manage/metrics/stream",
            _ => return Err(Error::new(ErrorCode::Unsupported)),
        };
        let token = self.token(None).await?;
        let result = match self.transport.socket(path, &token).await {
            Err(e) if e.code == ErrorCode::CredentialsRejected => {
                let fresh = self.token(Some(&token)).await?;
                self.transport.socket(path, &fresh).await
            }
            other => other,
        };
        if result
            .as_ref()
            .is_err_and(|e| e.code == ErrorCode::Forbidden)
        {
            let capability = if topic == ServerTopic::Console {
                "console.read"
            } else {
                "metrics.view"
            };
            let mut refused = self.refused.lock().await;
            if !refused.iter().any(|c| c == capability) {
                refused.push(capability.into());
            }
        }
        result
    }
    pub async fn lifecycle(
        &self,
        action: &str,
        expected: Option<&str>,
        intent: &str,
    ) -> Result<ServerOperation> {
        if !["start", "stop", "restart", "sleep", "wake"].contains(&action) {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        let body =
            if action == "start" || action == "wake" || (action == "stop" && expected.is_none()) {
                json!({})
            } else {
                let g = expected.ok_or_else(|| Error::new(ErrorCode::InvalidInput))?;
                generation(g)?;
                json!({"expected_generation":g})
            };
        self.submit(
            &format!("lifecycle/{action}"),
            body,
            intent,
            match action {
                "sleep" => "lifecycle.stop",
                "wake" => "lifecycle.start",
                "start" => "lifecycle.start",
                "stop" => "lifecycle.stop",
                "restart" => "lifecycle.restart",
                _ => unreachable!(),
            },
        )
        .await?
        .operation()
    }
    async fn submit(
        &self,
        path: &str,
        body: Value,
        intent: &str,
        capability: &str,
    ) -> Result<Submission> {
        // One submission owner; repeated UI calls never issue concurrent mutations.
        let _owner = self
            .mutations
            .try_lock()
            .map_err(|_| Error::new(ErrorCode::ServerBusy))?;
        let key = self.intent_key(intent)?;
        let digest = crate::trust::leaf_fingerprint(
            serde_json::to_string(&body)
                .map_err(|_| Error::new(ErrorCode::Internal))?
                .as_bytes(),
        );
        if let Some(previous) = self.intents.lock().await.get(&key).cloned() {
            match previous {
                Intent::Accepted {
                    path: old,
                    digest: d,
                    operation,
                } => {
                    if old != path || d != digest {
                        return Err(Error::new(ErrorCode::Conflict));
                    }
                    let mut observed = self.operation(&operation.operation_id).await?;
                    observed.intent = operation.intent;
                    return Ok(Submission::Operation(observed));
                }
                Intent::Uncertain {
                    path: old,
                    digest: d,
                } => {
                    if old == path && d == digest {
                        if let Some(p) = self.prepared.lock().await.get(&key) {
                            if p.expires <= crate::now_ms() {
                                return Err(Error::new(ErrorCode::ConfirmationExpired));
                            }
                            return Ok(Submission::Prepared(KillPreparation {
                                operation_id: p.operation_id.clone(),
                                expires_at_ms: p.expires,
                            }));
                        }
                    }
                    if old != path || d != digest {
                        return Err(Error::new(ErrorCode::Conflict));
                    }
                    // An explicit identical retry reuses the durable key. The
                    // agent replays its receipt if the first request committed.
                }
            }
        }
        let full = {
            let intents = self.intents.lock().await;
            intents.len() >= 4096 && !intents.contains_key(&key)
        };
        if full {
            return Err(Error::new(ErrorCode::ServerBusy));
        }
        // Record before I/O; cancellation/drop of the future is also uncertain.
        self.intents.lock().await.insert(
            key.clone(),
            Intent::Uncertain {
                path: path.into(),
                digest: digest.clone(),
            },
        );
        let value = self
            .request(
                Method::POST,
                &format!("/api/v3/manage/{path}"),
                Some(body.clone()),
                Some(&key),
                true,
                capability,
            )
            .await;
        let value = match value {
            Ok(v) => v,
            Err(e)
                if matches!(
                    e.code,
                    ErrorCode::Timeout
                        | ErrorCode::Unreachable
                        | ErrorCode::OutcomeUnknown
                        | ErrorCode::Unsupported
                        | ErrorCode::Internal
                ) =>
            {
                return Err(Error::new(ErrorCode::OutcomeUnknown))
            }
            Err(e) => {
                self.intents.lock().await.remove(&key);
                return Err(e);
            }
        };
        if value.get("state").and_then(Value::as_str) == Some("awaiting_confirmation") {
            let p = Prepared {
                path: path.into(),
                body,
                key: key.clone(),
                operation_id: value["operation_id"]
                    .as_str()
                    .ok_or_else(|| Error::new(ErrorCode::Unsupported))?
                    .into(),
                expires: value["expires_at_ms"]
                    .as_i64()
                    .ok_or_else(|| Error::new(ErrorCode::Unsupported))?,
                token: zeroize::Zeroizing::new(
                    value["confirmation_token"]
                        .as_str()
                        .ok_or_else(|| Error::new(ErrorCode::Unsupported))?
                        .into(),
                ),
            };
            let mut prepared = self.prepared.lock().await;
            prepared.retain(|_, p| p.expires > crate::now_ms());
            if prepared.len() >= 32 {
                return Err(Error::new(ErrorCode::ServerBusy));
            }
            let receipt = KillPreparation {
                operation_id: p.operation_id.clone(),
                expires_at_ms: p.expires,
            };
            prepared.insert(key, p);
            // Confirmation receipts do not carry a complete operation projection.
            return Ok(Submission::Prepared(receipt));
        }
        let needs_detail = !has_operation_details(&value);
        let mut operation = self
            .decode_operation(value)
            .await
            .map_err(|_| Error::new(ErrorCode::OutcomeUnknown))?;
        operation.intent = Some(path.replace('/', "."));
        self.intents.lock().await.insert(
            key,
            Intent::Accepted {
                path: path.into(),
                digest,
                operation: operation.clone(),
            },
        );
        operation = self.enrich_accepted(operation, needs_detail).await;
        Ok(Submission::Operation(operation))
    }
    pub async fn kill_prepare(&self, expected: &str, intent: &str) -> Result<KillPreparation> {
        generation(expected)?;
        let body = json!({"expected_generation":expected,"acknowledgement":format!("kill game:generation:{expected}")});
        match self
            .submit("lifecycle/kill", body, intent, "lifecycle.force_kill")
            .await
        {
            Ok(Submission::Prepared(receipt)) => Ok(receipt),
            Err(e) => Err(e),
            Ok(_) => Err(Error::new(ErrorCode::Conflict)),
        }
    }
    pub async fn confirmation_operation(
        &self,
        intent: &str,
        path: &str,
    ) -> Result<KillPreparation> {
        let prepared = self.prepared.lock().await;
        let p = prepared
            .get(&self.intent_key(intent)?)
            .filter(|p| p.path == path && p.expires > crate::now_ms())
            .ok_or_else(|| Error::new(ErrorCode::ConfirmationExpired))?;
        Ok(KillPreparation {
            operation_id: p.operation_id.clone(),
            expires_at_ms: p.expires,
        })
    }
    pub async fn confirm(&self, intent: &str, expected_path: &str) -> Result<ServerOperation> {
        let _owner = self
            .mutations
            .try_lock()
            .map_err(|_| Error::new(ErrorCode::ServerBusy))?;
        let key = self.intent_key(intent)?;
        let mut all = self.prepared.lock().await;
        let p = all
            .remove(&key)
            .ok_or_else(|| Error::new(ErrorCode::ConfirmationExpired))?;
        drop(all);
        if p.expires <= crate::now_ms() || p.path != expected_path {
            return Err(Error::new(ErrorCode::ConfirmationExpired));
        }
        let digest = crate::trust::leaf_fingerprint(
            serde_json::to_string(&p.body)
                .map_err(|_| Error::new(ErrorCode::Internal))?
                .as_bytes(),
        );
        let mut body = p.body;
        body[if p.path == "lifecycle/kill" {
            "confirmation_token"
        } else {
            "confirmation"
        }] = json!(p.token.as_str());
        let result = self
            .request(
                Method::POST,
                &format!("/api/v3/manage/{}", p.path),
                Some(body),
                Some(&p.key),
                true,
                if p.path == "lifecycle/kill" {
                    "lifecycle.force_kill"
                } else {
                    "players.operator"
                },
            )
            .await;
        // Whether response was lost or received, reconcile this exact operation ID.
        let mut observed = match result {
            Ok(value) => {
                let needs_detail = !has_operation_details(&value);
                match self.decode_operation(value).await {
                    Ok(mut operation) => {
                        operation.intent = Some(p.path.replace('/', "."));
                        Ok(self.enrich_accepted(operation, needs_detail).await)
                    }
                    Err(e) => Err(e),
                }
            }
            Err(e)
                if matches!(
                    e.code,
                    ErrorCode::Timeout | ErrorCode::Unreachable | ErrorCode::OutcomeUnknown
                ) =>
            {
                self.operation(&p.operation_id)
                    .await
                    .map(|mut o| {
                        o.reconciling = !o.terminal();
                        o
                    })
                    .map_err(|_| Error::new(ErrorCode::OutcomeUnknown))
            }
            Err(e) => Err(e),
        };
        if let Ok(operation) = &mut observed {
            operation.intent = Some(p.path.replace('/', "."));
        }
        if let Ok(operation) = &observed {
            self.intents.lock().await.insert(
                key,
                Intent::Accepted {
                    path: p.path,
                    digest,
                    operation: operation.clone(),
                },
            );
        }
        observed
    }
    pub async fn operation(&self, id: &str) -> Result<ServerOperation> {
        if id.is_empty()
            || id.len() > 256
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        self.decode_operation(
            self.get(&format!("operations/{id}"), false, "tasks.view")
                .await?,
        )
        .await
    }
    pub async fn operations(&self, cursor: Option<&str>) -> Result<Page<ServerOperation>> {
        self.operations_with_priority(cursor, true).await
    }
    /// One bounded observation of admitted IDs, independent of history ordering.
    pub async fn operations_selected(&self, ids: &[String]) -> Result<Page<ServerOperation>> {
        if ids.is_empty()
            || ids.len() > 32
            || ids.iter().any(|id| {
                id.is_empty()
                    || id.len() > 256
                    || !id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
            })
            || ids.iter().collect::<std::collections::BTreeSet<_>>().len() != ids.len()
        {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        let value = self
            .get(
                &format!("operations?ids={}", ids.join(",")),
                false,
                "tasks.view",
            )
            .await?;
        if value["selected"] != true {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        let values = value["items"]
            .as_array()
            .ok_or_else(|| Error::new(ErrorCode::Unsupported))?;
        if values.len() > ids.len() {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        let mut items = Vec::with_capacity(values.len());
        for value in values {
            let operation = self.decode_operation(value.clone()).await?;
            if !ids.contains(&operation.operation_id)
                || items
                    .iter()
                    .any(|item: &ServerOperation| item.operation_id == operation.operation_id)
            {
                return Err(Error::new(ErrorCode::Unsupported));
            }
            items.push(operation);
        }
        Ok(Page {
            items,
            next_cursor: None,
        })
    }
    pub async fn operations_with_priority(
        &self,
        cursor: Option<&str>,
        interactive: bool,
    ) -> Result<Page<ServerOperation>> {
        let value = self
            .get(
                &page_route("operations", cursor, 100)?,
                interactive,
                "tasks.view",
            )
            .await?;
        #[derive(serde::Deserialize)]
        struct WirePage {
            items: Vec<Value>,
            next_cursor: Option<String>,
        }
        let page: WirePage =
            serde_json::from_value(value).map_err(|_| Error::new(ErrorCode::Unsupported))?;
        let mut items = Vec::with_capacity(page.items.len());
        for value in page.items {
            items.push(self.decode_operation(value).await?);
        }
        Ok(Page {
            items,
            next_cursor: page.next_cursor,
        })
    }

    async fn decode_operation(&self, value: Value) -> Result<ServerOperation> {
        // Native refresh normally obtained this through GET /session already.
        // Standalone/reconstructed clients resolve it lazily, once per connection.
        if value
            .get("actor")
            .and_then(|actor| actor.get("principal_id"))
            .is_some()
        {
            let mut attempted = self.principal_lookup.lock().await;
            let missing = self
                .principal_id
                .lock()
                .map_err(|_| Error::new(ErrorCode::Internal))?
                .is_none();
            if missing && !*attempted {
                *attempted = true;
                // Attribution failure must not discard a known accepted receipt.
                let _ = self.capabilities(None).await;
            }
        }
        let principal = self
            .principal_id
            .lock()
            .map_err(|_| Error::new(ErrorCode::Internal))?;
        let operation = crate::operations::decode(value, principal.as_deref())?;
        drop(principal);
        if operation.terminal() && !operation.reconciling {
            let mut completed = self
                .completed_reads
                .lock()
                .map_err(|_| Error::new(ErrorCode::Internal))?;
            if !completed.contains(&operation.operation_id) {
                // Submission acceptance can precede the actual effect by minutes.
                // Retire native read caches before delivering the completion to UI.
                // Bound bookkeeping and ignore repeated history/poll observations.
                if completed.len() == 256 {
                    completed.pop_front();
                }
                completed.push_back(operation.operation_id.clone());
                self.transport.invalidate_reads();
            }
        }
        Ok(operation)
    }

    async fn enrich_accepted(
        &self,
        operation: ServerOperation,
        needs_detail: bool,
    ) -> ServerOperation {
        if needs_detail {
            // Receipts predate the detail projection. One bounded authorized GET
            // also handles terminal receipts, which will not be polled later.
            // A denied/busy/unreachable read cannot undo remote acceptance.
            if let Ok(Ok(mut detail)) = tokio::time::timeout(
                std::time::Duration::from_secs(2),
                self.operation(&operation.operation_id),
            )
            .await
            {
                detail.intent = operation.intent;
                detail.reconciling = operation.reconciling;
                return detail;
            }
        }
        operation
    }
    pub async fn console_page(&self, cursor: Option<&str>, limit: u16) -> Result<ConsolePage> {
        self.console_page_with_priority(cursor, limit, true).await
    }
    pub async fn console_page_with_priority(
        &self,
        cursor: Option<&str>,
        limit: u16,
        interactive: bool,
    ) -> Result<ConsolePage> {
        if !(1..=200).contains(&limit) {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        from_wire(
            self.get(
                &page_route("console", cursor, limit)?,
                interactive,
                "console.read",
            )
            .await?,
        )
    }
    pub async fn console_send(
        &self,
        line: &str,
        expected: &str,
        intent: &str,
    ) -> Result<ServerOperation> {
        generation(expected)?;
        if line.trim().is_empty()
            || line.len() > 1024
            || line
                .chars()
                .any(|c| c.is_control() || matches!(c, '\u{2028}' | '\u{2029}'))
        {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        self.submit(
            "console/command",
            json!({"line":line,"expected_generation":expected}),
            intent,
            "console.write",
        )
        .await?
        .operation()
    }
    pub async fn players(&self) -> Result<PlayersView> {
        let v = self.get("players", true, "players.view").await?;
        if v["known"] != true {
            return Ok(PlayersView::Unknown { known: false });
        }
        Ok(PlayersView::Known {
            known: true,
            generation: v["generation"]
                .as_str()
                .ok_or_else(|| Error::new(ErrorCode::Unsupported))?
                .into(),
            player_count: v["player_count"]
                .as_u64()
                .ok_or_else(|| Error::new(ErrorCode::Unsupported))?
                as u32,
            names: v["items"]
                .as_array()
                .ok_or_else(|| Error::new(ErrorCode::Unsupported))?
                .iter()
                .filter_map(|v| v["name"].as_str().map(str::to_owned))
                .collect(),
        })
    }
    pub async fn player_list<T: serde::de::DeserializeOwned>(&self, kind: &str) -> Result<Vec<T>> {
        if !["whitelist", "ops", "bans"].contains(&kind) {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        let v = self
            .get(&format!("players/{kind}"), true, "players.view")
            .await?;
        from_wire(
            v.get("items")
                .cloned()
                .ok_or_else(|| Error::new(ErrorCode::Unsupported))?,
        )
    }
    pub async fn moderate(
        &self,
        action: ModerationAction,
        expected: &str,
        intent: &str,
    ) -> Result<ModerationResult> {
        generation(expected)?;
        let mut value =
            serde_json::to_value(&action).map_err(|_| Error::new(ErrorCode::InvalidInput))?;
        let player = value["player"].as_str().unwrap_or("");
        if player.is_empty()
            || player.len() > 16
            || !player
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_')
        {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        if let Some(reason) = value.get("reason").and_then(Value::as_str) {
            if reason.trim().is_empty()
                || reason.len() > 512
                || reason.chars().count() > 256
                || reason
                    .chars()
                    .any(|c| c.is_control() || matches!(c, '\u{2028}' | '\u{2029}'))
            {
                return Err(Error::new(ErrorCode::InvalidInput));
            }
        }
        if let Some(duration) = value.get("durationSeconds").and_then(Value::as_u64) {
            if !(60..=31_536_000).contains(&duration) {
                return Err(Error::new(ErrorCode::InvalidInput));
            }
        }
        if let Some(v) = value
            .as_object_mut()
            .and_then(|m| m.remove("durationSeconds"))
        {
            value["duration_seconds"] = v;
        }
        value["expected_generation"] = json!(expected);
        let capability = if matches!(
            action,
            ModerationAction::Op { .. } | ModerationAction::Deop { .. }
        ) {
            "players.operator"
        } else {
            "players.moderate"
        };
        match self
            .submit("players/moderate", value, intent, capability)
            .await
        {
            Ok(Submission::Operation(operation)) => Ok(ModerationResult::Operation { operation }),
            Ok(Submission::Prepared(p)) => Ok(ModerationResult::AwaitingConfirmation {
                expires_at_ms: p.expires_at_ms,
            }),
            Err(e) => Err(e),
        }
    }
}
fn has_operation_details(value: &Value) -> bool {
    ["kind", "actor", "summary", "summary_purged", "outcome"]
        .iter()
        .all(|key| value.get(key).is_some())
}
fn page_route(route: &str, cursor: Option<&str>, limit: u16) -> Result<String> {
    let mut result = format!("{route}?limit={limit}");
    if let Some(c) = cursor {
        if c.len() > 512
            || !c
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        result.push_str("&cursor=");
        result.push_str(c);
    }
    Ok(result)
}
