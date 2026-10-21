mod credentials;
mod files;
mod store;
mod subscriptions;
mod tasks;
#[cfg(test)]
mod tests;
mod worker;

use credentials::Credentials;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex as StdMutex},
    time::{Duration, Instant},
};
use store::{PendingIntent, Record, Store};
use subscriptions::Subscriptions;
use tauri::{ipc::Channel, AppHandle, Emitter};
use tokio::sync::{Mutex, Semaphore};
use vesta_server_client::{
    auth::DeviceSigner,
    endpoint::{Address, Endpoint},
    model::*,
    operations::intent_key,
    streams::ConsoleRing,
    transport::Transport,
    Client, Error, ErrorCode, Result,
};

struct Contact {
    discovery: Discovery,
    transport: Arc<Transport>,
    expires: Instant,
    input_hash: String,
    created: Instant,
}
#[derive(Default)]
struct Live {
    client: Mutex<Option<Arc<Client>>>,
    refresh: Mutex<()>,
    worker: StdMutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    capabilities_loaded: std::sync::atomic::AtomicBool,
}
pub struct ServerManager {
    root: PathBuf,
    credentials: Arc<Credentials>,
    store: Mutex<Store>,
    initialization_error: Option<Error>,
    live: StdMutex<HashMap<String, Arc<Live>>>,
    contacts: Mutex<HashMap<String, Contact>>,
    discovery_gate: Mutex<()>,
    enrollment_gate: Mutex<()>,
    subscriptions: StdMutex<Subscriptions>,
    streaming: Arc<Semaphore>,
    change_pending: Arc<std::sync::atomic::AtomicBool>,
    trackers: StdMutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
}
fn internal() -> Error {
    Error::new(ErrorCode::Internal)
}
fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn online_state(paused_for: Duration) -> ConnectionState {
    let until = (!paused_for.is_zero())
        .then(|| vesta_server_client::now_ms() + paused_for.as_millis() as i64);
    ConnectionState {
        phase: if until.is_some() { "backoff" } else { "online" }.into(),
        retry_at_ms: until,
        rate_limited_until_ms: until,
        last_error: until.map(|_| ErrorCode::RateLimited),
        ..Default::default()
    }
}
fn coarse_state(
    snapshot: &ServerSnapshot,
) -> (&str, &str, Option<(&str, Option<&str>, Option<&str>, &str)>) {
    (
        &snapshot.state.phase,
        &snapshot.state.access,
        snapshot.status.as_ref().map(|s| {
            (
                s.state.as_str(),
                s.lifecycle.as_deref(),
                s.generation.as_deref(),
                s.readiness.as_str(),
            )
        }),
    )
}
impl ServerManager {
    pub(crate) async fn files_client(&self, id: &str) -> Result<Arc<Client>> {
        self.client(id).await
    }
    pub fn new() -> Result<Arc<Self>> {
        let root = crate::utils::db_manager::get_app_config_dir().map_err(|_| internal())?;
        Self::at_root(root)
    }
    fn at_root(root: PathBuf) -> Result<Arc<Self>> {
        let (store, initialization_error) = match Store::load(&root) {
            Ok(s) => (s, None),
            Err(e) => {
                log::warn!("Server metadata is unavailable; remote management commands are disabled for this profile");
                (Store::default(), Some(e))
            }
        };
        Ok(Arc::new(Self {
            credentials: Arc::new(Credentials::new(&root)),
            root,
            store: Mutex::new(store),
            initialization_error,
            live: Default::default(),
            contacts: Default::default(),
            discovery_gate: Default::default(),
            enrollment_gate: Default::default(),
            subscriptions: Default::default(),
            streaming: Arc::new(Semaphore::new(4)),
            change_pending: Default::default(),
            trackers: Default::default(),
        }))
    }
    fn slot(&self, id: &str) -> Result<Arc<Live>> {
        let mut live = self.live.lock().map_err(|_| internal())?;
        if !live.contains_key(id) && live.len() >= 100 {
            return Err(Error::new(ErrorCode::ServerBusy));
        }
        Ok(live.entry(id.into()).or_default().clone())
    }
    pub async fn list(&self) -> Result<Vec<ServerSnapshot>> {
        if let Some(e) = &self.initialization_error {
            return Err(e.clone());
        }
        Ok(self
            .store
            .lock()
            .await
            .connections
            .iter()
            .map(|r| r.snapshot.clone())
            .collect())
    }
    async fn record(&self, id: &str) -> Result<Record> {
        if let Some(e) = &self.initialization_error {
            return Err(e.clone());
        }
        self.store
            .lock()
            .await
            .connections
            .iter()
            .find(|r| r.snapshot.connection.id == id)
            .cloned()
            .ok_or_else(|| Error::new(ErrorCode::NotFound))
    }
    async fn edit_store<T>(&self, edit: impl FnOnce(&mut Store) -> Result<T>) -> Result<T> {
        if let Some(e) = &self.initialization_error {
            return Err(e.clone());
        }
        let mut current = self.store.lock().await;
        let mut next = current.clone();
        let result = edit(&mut next)?;
        next.save(&self.root)?;
        *current = next;
        Ok(result)
    }
    fn changed(&self, app: &AppHandle) {
        use std::sync::atomic::Ordering;
        if self.change_pending.swap(true, Ordering::AcqRel) {
            return;
        }
        let pending = self.change_pending.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(250)).await;
            let _ = app.emit("core://servers-changed", ());
            pending.store(false, Ordering::Release);
        });
    }
    async fn publish(&self, app: &AppHandle, snapshot: ServerSnapshot) -> Result<()> {
        let id = snapshot.connection.id.clone();
        self.edit_store(|s| {
            let r = s
                .connections
                .iter_mut()
                .find(|r| r.snapshot.connection.id == id)
                .ok_or_else(|| Error::new(ErrorCode::NotFound))?;
            r.snapshot = snapshot.clone();
            Ok(())
        })
        .await?;
        if let Ok(mut subs) = self.subscriptions.lock() {
            subs.send(
                &id,
                ServerTopic::Status,
                ServerEvent::Snapshot {
                    snapshot: Box::new(snapshot),
                },
            );
        }
        self.changed(app);
        Ok(())
    }
    async fn publish_observation(
        &self,
        app: &AppHandle,
        mut snapshot: ServerSnapshot,
    ) -> Result<()> {
        let id = snapshot.connection.id.clone();
        let changed = self
            .edit_store(|s| {
                let record = s
                    .connections
                    .iter_mut()
                    .find(|r| r.snapshot.connection.id == id)
                    .ok_or_else(|| Error::new(ErrorCode::NotFound))?;
                let connected = snapshot.connection.last_connected_at_ms;
                let reported_name = snapshot.connection.name.clone();
                snapshot.connection = record.snapshot.connection.clone();
                snapshot.connection.last_connected_at_ms =
                    connected.or(snapshot.connection.last_connected_at_ms);
                if snapshot.connection.name == snapshot.connection.endpoint {
                    snapshot.connection.name = reported_name;
                }
                let changed = coarse_state(&record.snapshot) != coarse_state(&snapshot)
                    || record.snapshot.connection.name != snapshot.connection.name;
                record.snapshot = snapshot.clone();
                Ok(changed)
            })
            .await?;
        self.deliver(
            &id,
            ServerTopic::Status,
            ServerEvent::Snapshot {
                snapshot: Box::new(snapshot),
            },
        );
        if changed {
            self.changed(app);
        }
        Ok(())
    }
    async fn synchronize_failure(&self, app: &AppHandle, id: &str, error: &Error) {
        let Ok(mut snapshot) = self.record(id).await.map(|r| r.snapshot) else {
            return;
        };
        if let Ok(slot) = self.slot(id) {
            if let Some(client) = slot.client.lock().await.as_ref() {
                snapshot.capabilities.refused = client.refused().await;
                let paused = client.transport.scheduler.paused_for().as_millis() as i64;
                if paused > 0 {
                    snapshot.state.rate_limited_until_ms =
                        Some(vesta_server_client::now_ms() + paused);
                }
            }
        }
        snapshot.state.last_error = Some(error.code);
        match error.code {
            ErrorCode::FingerprintMismatch => {
                snapshot.state.access = "fingerprint_changed".into();
                snapshot.state.phase = "unreachable".into();
            }
            ErrorCode::CredentialsRejected => snapshot.state.access = "credentials_rejected".into(),
            ErrorCode::CredentialsUnavailable => {
                snapshot.state.access = "credentials_unavailable".into()
            }
            ErrorCode::NoManagementAccess => snapshot.state.access = "no_management_access".into(),
            ErrorCode::RateLimited | ErrorCode::ServerBusy => {
                snapshot.state.phase = "backoff".into();
                snapshot.state.retry_at_ms = Some(snapshot.state.rate_limited_until_ms.unwrap_or(
                    vesta_server_client::now_ms() + error.retry_after_ms.unwrap_or(10_000) as i64,
                ));
            }
            ErrorCode::Unreachable | ErrorCode::Timeout | ErrorCode::TlsFailed => {
                snapshot.state.phase = "unreachable".into()
            }
            _ => {}
        }
        let _ = self.publish_observation(app, snapshot).await;
    }
    async fn client(&self, id: &str) -> Result<Arc<Client>> {
        let r = self.record(id).await?;
        let slot = self.slot(id)?;
        let mut live = slot.client.lock().await;
        if let Some(client) = &*live {
            return Ok(client.clone());
        }
        if r.snapshot.connection.memory_only {
            return Err(Error::new(ErrorCode::CredentialsUnavailable));
        }
        // Respect explicitly configured proxy policy; don't silently bypass it.
        if crate::utils::config::get_app_config().is_ok_and(|c| c.proxy_enabled) {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        let credentials = self.credentials.clone();
        let reference = r.key_reference.clone();
        let signer = tokio::task::spawn_blocking(move || credentials.load(&reference))
            .await
            .map_err(|_| internal())??;
        let endpoint = Endpoint::parse(&r.snapshot.connection.endpoint)?;
        let transport = Transport::new(endpoint, Some(r.snapshot.connection.fingerprint.clone()))?;
        let client = Client::new(
            transport,
            r.snapshot.connection.server_id,
            r.device_id,
            signer,
        );
        client.restore_legacy_intents(
            self.store
                .lock()
                .await
                .intents
                .iter()
                .filter(|i| i.connection_id == id && i.key_version < 2)
                .map(|i| i.key.clone()),
        )?;
        *live = Some(client.clone());
        Ok(client)
    }
    pub async fn discover(&self, address: &str) -> Result<Discovery> {
        if let Some(e) = &self.initialization_error {
            return Err(e.clone());
        }
        let parsed = Address::parse(address)?;
        let _gate = self.discovery_gate.lock().await;
        let hash = vesta_server_client::trust::leaf_fingerprint(address.as_bytes());
        {
            let mut contacts = self.contacts.lock().await;
            contacts.retain(|_, c| c.expires > Instant::now());
            if let Some(c) = contacts
                .values()
                .find(|c| c.input_hash == hash && c.created.elapsed() < Duration::from_millis(250))
            {
                return Ok(c.discovery.clone());
            }
            if contacts.len() >= 32 {
                return Err(Error::new(ErrorCode::ServerBusy));
            }
        }
        if crate::utils::config::get_app_config().is_ok_and(|c| c.proxy_enabled) {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        let transport = Transport::new(parsed.endpoint.clone(), None)?;
        let status = transport
            .request(
                reqwest::Method::GET,
                "/api/v3/status",
                None,
                None,
                None,
                true,
            )
            .await?;
        let server_id = status["server_id"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 256)
            .ok_or_else(|| Error::new(ErrorCode::Unsupported))?
            .to_owned();
        if parsed.server_id.as_ref().is_some_and(|s| s != &server_id) {
            return Err(Error::new(ErrorCode::FingerprintMismatch));
        }
        let fingerprint = transport
            .observed()
            .ok_or_else(|| Error::new(ErrorCode::TlsFailed))?;
        if parsed
            .fingerprint
            .as_ref()
            .is_some_and(|p| p != &fingerprint)
        {
            return Err(Error::new(ErrorCode::FingerprintMismatch));
        }
        let existing = self
            .store
            .lock()
            .await
            .connections
            .iter()
            .find(|r| r.snapshot.connection.server_id == server_id)
            .map(|r| r.snapshot.connection.id.clone());
        let discovery = Discovery {
            discovery_id: new_id(),
            endpoint: parsed.endpoint.display(),
            server_id,
            fingerprint,
            public_lifecycle: status["state"].as_str().map(str::to_owned),
            expected_fingerprint: parsed.fingerprint,
            link_code: parsed.code,
            existing_connection_id: existing,
            secure_storage_available: {
                let credentials = self.credentials.clone();
                tokio::task::spawn_blocking(move || credentials.available())
                    .await
                    .map_err(|_| internal())?
            },
        };
        // Retire capture-mode pool now. Enrollment can only use the observed pin.
        let pinned = Transport::new(parsed.endpoint, Some(discovery.fingerprint.clone()))?;
        self.contacts.lock().await.insert(
            discovery.discovery_id.clone(),
            Contact {
                discovery: discovery.clone(),
                transport: pinned,
                expires: Instant::now() + Duration::from_secs(600),
                input_hash: hash,
                created: Instant::now(),
            },
        );
        Ok(discovery)
    }
    async fn enrollment(
        &self,
        discovery_id: &str,
        memory: bool,
    ) -> Result<(
        Discovery,
        Arc<Transport>,
        String,
        Arc<dyn DeviceSigner>,
        bool,
    )> {
        let (discovery, transport) = {
            let contacts = self.contacts.lock().await;
            let c = contacts
                .get(discovery_id)
                .filter(|c| c.expires > Instant::now())
                .ok_or_else(|| Error::new(ErrorCode::NotFound))?;
            (c.discovery.clone(), c.transport.clone())
        };
        {
            let store = self.store.lock().await;
            if store
                .connections
                .iter()
                .any(|r| r.snapshot.connection.server_id == discovery.server_id)
            {
                return Err(Error::new(ErrorCode::Conflict));
            }
            if store.connections.len() >= 100 || store.pending_enrollment_keys.len() >= 32 {
                return Err(Error::new(ErrorCode::ServerBusy));
            }
        }
        let reference = new_id();
        let r = reference.clone();
        let credentials = self.credentials.clone();
        let signer = tokio::task::spawn_blocking(move || credentials.create(&r, memory))
            .await
            .map_err(|_| internal())??;
        // Preserve orphan key reference before the one-shot redemption.
        if !memory {
            self.edit_store(|s| {
                s.pending_enrollment_keys.push(reference.clone());
                Ok(())
            })
            .await?;
        }
        Ok((discovery, transport, reference, signer, memory))
    }
    async fn discard_unredeemed(&self, reference: &str, memory: bool) {
        if memory {
            return;
        }
        let credentials = self.credentials.clone();
        let r = reference.to_owned();
        if matches!(
            tokio::task::spawn_blocking(move || credentials.delete(&r)).await,
            Ok(Ok(()))
        ) {
            let _ = self
                .edit_store(|s| {
                    s.pending_enrollment_keys.retain(|r| r != reference);
                    Ok(())
                })
                .await;
        }
    }
    async fn finish_enrollment(
        &self,
        app: &AppHandle,
        discovery: Discovery,
        transport: Arc<Transport>,
        reference: String,
        signer: Arc<dyn DeviceSigner>,
        memory: bool,
        device: String,
        role: Option<String>,
        method: &str,
    ) -> Result<ServerSnapshot> {
        let id = new_id();
        let connection = ServerConnection {
            id: id.clone(),
            name: discovery.endpoint.clone(),
            endpoint: discovery.endpoint,
            server_id: discovery.server_id.clone(),
            fingerprint: discovery.fingerprint,
            role,
            sign_in_method: method.into(),
            memory_only: memory,
            pinned: false,
            added_at_ms: vesta_server_client::now_ms(),
            last_connected_at_ms: None,
        };
        let snapshot = ServerSnapshot {
            connection,
            state: Default::default(),
            info: None,
            status: None,
            status_observed_at_ms: None,
            pack: None,
            capabilities: CapabilityView {
                source: "unknown".into(),
                granted: vec![],
                refused: vec![],
            },
            restart_required: false,
        };
        let client = Client::new(transport, discovery.server_id, device.clone(), signer);
        self.edit_store(|s| {
            s.connections.push(Record {
                snapshot: snapshot.clone(),
                device_id: device,
                key_reference: reference.clone(),
            });
            s.pending_enrollment_keys.retain(|r| r != &reference);
            Ok(())
        })
        .await?;
        *self.slot(&id)?.client.lock().await = Some(client);
        self.contacts.lock().await.remove(&discovery.discovery_id);
        self.changed(app);
        // Enrollment succeeded even if a follow-up read fails. Return an honest
        // classified connection snapshot rather than encouraging code redemption again.
        let _ = self.refresh(app, &id, true).await;
        self.snapshot(app, &id, false).await
    }
    pub async fn pair(
        &self,
        app: &AppHandle,
        discovery_id: &str,
        code: &str,
        memory_only: bool,
    ) -> Result<ServerSnapshot> {
        let _gate = self
            .enrollment_gate
            .try_lock()
            .map_err(|_| Error::new(ErrorCode::ServerBusy))?;
        let (d, t, r, s, m) = self.enrollment(discovery_id, memory_only).await?;
        let contact = self.contacts.lock().await.remove(discovery_id);
        let e = match Client::pair(&t, &d.server_id, code, s.as_ref()).await {
            Ok(e) => e,
            Err(e) => {
                if !matches!(
                    e.code,
                    ErrorCode::PairOutcomeUnknown | ErrorCode::FingerprintMismatch
                ) {
                    self.discard_unredeemed(&r, m).await;
                }
                if matches!(
                    e.code,
                    ErrorCode::PairCodeInvalid
                        | ErrorCode::InvalidInput
                        | ErrorCode::RateLimited
                        | ErrorCode::Forbidden
                        | ErrorCode::ServerBusy
                ) {
                    if let Some(contact) = contact {
                        self.contacts
                            .lock()
                            .await
                            .insert(discovery_id.into(), contact);
                    }
                }
                return Err(e);
            }
        };
        self.finish_enrollment(
            app,
            d,
            t,
            r,
            s,
            m,
            e.device_id,
            Some(e.role),
            "pairing_code",
        )
        .await
    }
    pub async fn minecraft(
        &self,
        app: &AppHandle,
        discovery_id: &str,
        account_uuid: &str,
        memory_only: bool,
    ) -> Result<ServerSnapshot> {
        let _gate = self
            .enrollment_gate
            .try_lock()
            .map_err(|_| Error::new(ErrorCode::ServerBusy))?;
        if !memory_only {
            let credentials = self.credentials.clone();
            if !tokio::task::spawn_blocking(move || credentials.available())
                .await
                .map_err(|_| internal())?
            {
                return Err(Error::new(ErrorCode::CredentialsUnavailable));
            }
        }
        let account = crate::auth::ensure_account_tokens_valid(app.clone(), account_uuid.into())
            .await
            .map_err(|_| Error::new(ErrorCode::CredentialsRejected))?;
        if !crate::auth::is_previously_authenticated_account(&account) {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        let t = {
            let contacts = self.contacts.lock().await;
            contacts
                .get(discovery_id)
                .filter(|c| c.expires > Instant::now())
                .map(|c| c.transport.clone())
                .ok_or_else(|| Error::new(ErrorCode::NotFound))?
        };
        let challenge = t
            .request(
                reqwest::Method::POST,
                "/api/v3/auth/minecraft/challenge",
                None,
                Some(json!({"uuid":account.uuid,"name":account.username})),
                None,
                true,
            )
            .await?;
        let server_hash = challenge["server_hash"]
            .as_str()
            .filter(|s| s.len() <= 64)
            .ok_or_else(|| Error::new(ErrorCode::Unsupported))?;
        let challenge_id = challenge["challenge"]
            .as_str()
            .filter(|s| s.len() <= 256)
            .ok_or_else(|| Error::new(ErrorCode::Unsupported))?;
        let token = zeroize::Zeroizing::new(
            account
                .access_token
                .ok_or_else(|| Error::new(ErrorCode::CredentialsRejected))?,
        );
        // This fixed Mojang origin is the only recipient of the launcher token.
        let join = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(15)).build().map_err(|_| internal())?
            .post("https://sessionserver.mojang.com/session/minecraft/join").json(&json!({"accessToken":token.as_str(),"selectedProfile":account.uuid,"serverId":server_hash})).send().await.map_err(|_| Error::new(ErrorCode::Unreachable))?;
        if !join.status().is_success() {
            return Err(Error::new(ErrorCode::CredentialsRejected));
        }
        let (d, t, r, s, m) = self.enrollment(discovery_id, memory_only).await?;
        self.contacts.lock().await.remove(discovery_id);
        let complete = t.request(reqwest::Method::POST,"/api/v3/auth/minecraft/complete",None,Some(json!({"challenge":challenge_id,"device_name":"Vesta Launcher","public_key":s.public_key()})),None,true).await.map_err(|e| if matches!(e.code,ErrorCode::Timeout|ErrorCode::OutcomeUnknown|ErrorCode::Unreachable) { Error::new(ErrorCode::PairOutcomeUnknown) } else {e})?;
        let device = complete["device_id"]
            .as_str()
            .ok_or_else(|| Error::new(ErrorCode::PairOutcomeUnknown))?
            .into();
        self.finish_enrollment(app, d, t, r, s, m, device, None, "minecraft")
            .await
    }
    pub async fn snapshot(
        &self,
        app: &AppHandle,
        id: &str,
        refresh: bool,
    ) -> Result<ServerSnapshot> {
        if refresh {
            self.refresh(app, id, true).await?;
        }
        Ok(self.record(id).await?.snapshot)
    }
    pub async fn refresh(&self, app: &AppHandle, id: &str, interactive: bool) -> Result<()> {
        self.record(id).await?;
        let slot = self.slot(id)?;
        let started = Instant::now();
        let _gate = slot.refresh.lock().await;
        let mut snapshot = self.record(id).await?.snapshot;
        // Followers of one refresh consume its last observation, no extra HTTP.
        if slot.client.lock().await.is_some()
            && snapshot.status_observed_at_ms.is_some_and(|at| {
                at >= vesta_server_client::now_ms() - started.elapsed().as_millis() as i64 - 250
            })
        {
            return Ok(());
        }
        let result = async {
            let client = self.client(id).await?;
            if snapshot.info.is_none() {
                let info = client.info().await?;
                if snapshot.connection.name == snapshot.connection.endpoint {
                    snapshot.connection.name = info.name.clone();
                }
                snapshot.info = Some(info);
            }
            if !slot
                .capabilities_loaded
                .load(std::sync::atomic::Ordering::Relaxed)
            {
                snapshot.capabilities = client
                    .capabilities(snapshot.connection.role.as_deref())
                    .await?;
                slot.capabilities_loaded
                    .store(true, std::sync::atomic::Ordering::Relaxed);
            }
            if snapshot.pack.is_none() {
                snapshot.pack = Some(from_wire(
                    client.get("pack", interactive, "status.view").await?,
                )?);
            }
            let status = client.status(interactive).await?;
            if snapshot.status.as_ref().and_then(|s| s.generation.as_ref())
                != status.generation.as_ref()
            {
                snapshot.restart_required = false;
            }
            snapshot.status = Some(status);
            snapshot.status_observed_at_ms = Some(vesta_server_client::now_ms());
            snapshot.capabilities.refused = client.refused().await;
            Ok::<(), Error>(())
        }
        .await;
        let mut paused_for = Duration::ZERO;
        if let Some(client) = slot.client.lock().await.as_ref() {
            snapshot.capabilities.refused = client.refused().await;
            paused_for = client.transport.scheduler.paused_for();
        }
        match &result {
            Ok(()) => {
                snapshot.state = online_state(paused_for);
                snapshot.connection.last_connected_at_ms = Some(vesta_server_client::now_ms());
            }
            Err(e) => {
                snapshot.state.last_error = Some(e.code);
                snapshot.state.phase = match e.code {
                    ErrorCode::RateLimited | ErrorCode::ServerBusy => "backoff",
                    ErrorCode::Forbidden
                    | ErrorCode::NoManagementAccess
                    | ErrorCode::Unsupported
                    | ErrorCode::CredentialsRejected => "online",
                    ErrorCode::CredentialsUnavailable => "disconnected",
                    _ => "unreachable",
                }
                .into();
                snapshot.state.access = match e.code {
                    ErrorCode::FingerprintMismatch => "fingerprint_changed",
                    ErrorCode::CredentialsRejected => "credentials_rejected",
                    ErrorCode::CredentialsUnavailable => "credentials_unavailable",
                    ErrorCode::NoManagementAccess => "no_management_access",
                    _ => &snapshot.state.access,
                }
                .into();
                if e.code == ErrorCode::RateLimited {
                    let until =
                        vesta_server_client::now_ms() + e.retry_after_ms.unwrap_or(60_000) as i64;
                    snapshot.state.rate_limited_until_ms = Some(until);
                    snapshot.state.retry_at_ms = Some(until);
                }
            }
        }
        self.publish_observation(app, snapshot).await?;
        result
    }
    pub async fn update(
        &self,
        app: &AppHandle,
        id: &str,
        patch: ConnectionPatch,
    ) -> Result<ServerSnapshot> {
        let mut snapshot = self.record(id).await?.snapshot;
        if let Some(name) = patch.name {
            if name.trim().is_empty()
                || name.chars().count() > 128
                || name.chars().any(char::is_control)
            {
                return Err(Error::new(ErrorCode::InvalidInput));
            }
            snapshot.connection.name = name.trim().into();
        }
        if let Some(pinned) = patch.pinned {
            snapshot.connection.pinned = pinned;
        }
        self.publish(app, snapshot.clone()).await?;
        Ok(snapshot)
    }
    pub async fn approve(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
        fingerprint: &str,
    ) -> Result<ServerSnapshot> {
        self.record(id).await?;
        let slot = self.slot(id)?;
        let _refresh = slot.refresh.lock().await;
        let fp = vesta_server_client::endpoint::fingerprint(fingerprint)?;
        let mut snapshot = self.record(id).await?.snapshot;
        // Unauthenticated discovery verifies both what the UI approved and the
        // already saved server_id, before any existing credential can be sent.
        let discovery = self.discover(&snapshot.connection.endpoint).await?;
        if fp != discovery.fingerprint || snapshot.connection.server_id != discovery.server_id {
            return Err(Error::new(ErrorCode::FingerprintMismatch));
        }
        snapshot.connection.fingerprint = fp;
        snapshot.state = Default::default();
        {
            let mut current = slot.client.lock().await;
            if let Some(client) = current.as_ref() {
                let transport = Transport::new(
                    Endpoint::parse(&snapshot.connection.endpoint)?,
                    Some(snapshot.connection.fingerprint.clone()),
                )?;
                *current = Some(client.repin(transport));
            }
        }
        slot.capabilities_loaded
            .store(false, std::sync::atomic::Ordering::Relaxed);
        self.publish(app, snapshot).await?;
        if let Some(worker) = slot.worker.lock().map_err(|_| internal())?.take() {
            worker.abort();
        }
        self.ensure_worker(app, id)?;
        drop(_refresh);
        self.snapshot(app, id, true).await
    }
    pub async fn remove(&self, app: &AppHandle, id: &str) -> Result<()> {
        let record = self.record(id).await?;
        if !record.snapshot.connection.memory_only {
            let credentials = self.credentials.clone();
            let reference = record.key_reference;
            tokio::task::spawn_blocking(move || credentials.delete(&reference))
                .await
                .map_err(|_| internal())??;
        }
        self.edit_store(|s| {
            s.connections.retain(|r| r.snapshot.connection.id != id);
            s.intents.retain(|i| i.connection_id != id);
            Ok(())
        })
        .await?;
        self.subscriptions
            .lock()
            .map_err(|_| internal())?
            .remove_connection(id);
        if let Some(live) = self.live.lock().map_err(|_| internal())?.remove(id) {
            if let Some(worker) = live.worker.lock().map_err(|_| internal())?.take() {
                worker.abort();
            }
        }
        self.changed(app);
        Ok(())
    }
    pub fn window_closed(&self, window: &str) {
        if let Ok(mut s) = self.subscriptions.lock() {
            s.remove_window(window);
        }
    }
    pub fn unsubscribe(&self, handle: &str, window: &str) -> Result<()> {
        self.subscriptions
            .lock()
            .map_err(|_| internal())?
            .remove(handle, window);
        Ok(())
    }
    pub async fn subscribe(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
        topic: ServerTopic,
        window: &str,
        channel: Channel<ServerEvent>,
    ) -> Result<String> {
        let snapshot = self.record(id).await?.snapshot;
        let handle = self.subscriptions.lock().map_err(|_| internal())?.add(
            id.into(),
            topic,
            window.into(),
            channel,
        )?;
        if topic == ServerTopic::Status {
            self.deliver(
                id,
                topic,
                ServerEvent::Snapshot {
                    snapshot: Box::new(snapshot),
                },
            );
        }
        self.ensure_worker(app, id)?;
        Ok(handle)
    }
    fn ensure_worker(self: &Arc<Self>, app: &AppHandle, id: &str) -> Result<()> {
        let slot = self.slot(id)?;
        let mut worker = slot.worker.lock().map_err(|_| internal())?;
        if worker.as_ref().is_none_or(|w| w.inner().is_finished()) {
            let manager = self.clone();
            let app = app.clone();
            let id = id.to_owned();
            *worker = Some(tauri::async_runtime::spawn(async move {
                manager.run_worker(app, id).await;
            }));
        }
        Ok(())
    }
    fn demanded(&self, id: &str, topic: ServerTopic) -> bool {
        self.subscriptions.lock().is_ok_and(|s| s.demand(id, topic))
    }
    fn deliver(&self, id: &str, topic: ServerTopic, event: ServerEvent) {
        if let Ok(mut s) = self.subscriptions.lock() {
            s.send(id, topic, event);
        }
    }

    /// Journal before network submission. Explicit identical retries replay the
    /// same server key across application restarts. No command/reason/player text is persisted.
    pub async fn mutate<T>(
        &self,
        app: &AppHandle,
        id: &str,
        intent: &str,
        action: &str,
        payload: &Value,
        operation_id: Option<&str>,
        run: impl std::future::Future<Output = Result<T>>,
    ) -> Result<T> {
        let key = intent_key(intent)?;
        let digest = vesta_server_client::trust::leaf_fingerprint(
            serde_json::to_vec(payload)
                .map_err(|_| internal())?
                .as_slice(),
        );
        self.edit_store(|s| {
            if let Some(old) = s
                .intents
                .iter()
                .find(|i| i.connection_id == id && i.key == key)
            {
                if old.action != action || old.payload_hash != digest {
                    return Err(Error::new(ErrorCode::Conflict));
                }
                // The same explicit intent may replay the agent's durable receipt.
                return Ok(());
            }
            if s.intents.len() >= 4096 {
                return Err(Error::new(ErrorCode::ServerBusy));
            }
            s.intents.push(PendingIntent {
                connection_id: id.into(),
                key: key.clone(),
                key_version: 2,
                action: action.into(),
                payload_hash: digest,
                operation_id: operation_id.map(str::to_owned),
                created_at_ms: vesta_server_client::now_ms(),
                terminal: false,
                uncertain: true,
            });
            Ok(())
        })
        .await?;
        let result = run.await;
        if let Err(error) = &result {
            self.synchronize_failure(app, id, error).await;
        }
        if result.as_ref().is_err_and(|e| {
            !matches!(
                e.code,
                ErrorCode::OutcomeUnknown
                    | ErrorCode::Timeout
                    | ErrorCode::Unreachable
                    | ErrorCode::PairOutcomeUnknown
                    | ErrorCode::Internal
            )
        }) {
            self.edit_store(|s| {
                s.intents.retain(|i| i.connection_id != id || i.key != key);
                Ok(())
            })
            .await?;
        }
        result
    }
    pub async fn lifecycle(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
        action: &str,
        expected: Option<&str>,
        intent: &str,
    ) -> Result<ServerOperation> {
        if let Some(op) = self
            .existing_operation(
                id,
                intent,
                &format!("lifecycle.{action}"),
                &json!({"generation":expected}),
            )
            .await?
        {
            return Ok(op);
        }
        let client = self.client(id).await?;
        let operation = self
            .mutate(
                app,
                id,
                intent,
                &format!("lifecycle.{action}"),
                &json!({"generation":expected}),
                None,
                client.lifecycle(action, expected, intent),
            )
            .await?;
        self.track(app, id, intent, &operation).await?;
        Ok(operation)
    }
    pub async fn kill_prepare(
        &self,
        id: &str,
        expected: &str,
        intent: &str,
    ) -> Result<KillPreparation> {
        self.client(id).await?.kill_prepare(expected, intent).await
    }
    pub async fn confirm(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
        intent: &str,
        path: &str,
    ) -> Result<ServerOperation> {
        if let Some(op) = self
            .existing_operation(id, intent, path, &json!({"confirmation":true}))
            .await?
        {
            return Ok(op);
        }
        let client = self.client(id).await?;
        let receipt = client.confirmation_operation(intent, path).await?;
        let operation = self
            .mutate(
                app,
                id,
                intent,
                path,
                &json!({"confirmation":true}),
                Some(&receipt.operation_id),
                client.confirm(intent, path),
            )
            .await?;
        self.track(app, id, intent, &operation).await?;
        Ok(operation)
    }
    pub async fn operations(
        &self,
        id: &str,
        cursor: Option<&str>,
    ) -> Result<Page<ServerOperation>> {
        let mut page = self.client(id).await?.operations(cursor).await?;
        for operation in &mut page.items {
            self.decorate_operation(id, operation).await;
        }
        Ok(page)
    }
    pub async fn console_page(
        &self,
        id: &str,
        cursor: Option<&str>,
        limit: u16,
    ) -> Result<ConsolePage> {
        self.client(id).await?.console_page(cursor, limit).await
    }
    pub async fn console_send(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
        line: &str,
        expected: &str,
        intent: &str,
    ) -> Result<ServerOperation> {
        if let Some(op) = self
            .existing_operation(
                id,
                intent,
                "console.command",
                &json!({"line":line,"generation":expected}),
            )
            .await?
        {
            return Ok(op);
        }
        let client = self.client(id).await?;
        let operation = self
            .mutate(
                app,
                id,
                intent,
                "console.command",
                &json!({"line":line,"generation":expected}),
                None,
                client.console_send(line, expected, intent),
            )
            .await?;
        self.track(app, id, intent, &operation).await?;
        Ok(operation)
    }
    pub async fn players(&self, id: &str) -> Result<PlayersView> {
        self.client(id).await?.players().await
    }
    pub async fn whitelist(&self, id: &str) -> Result<Vec<WhitelistEntry>> {
        self.client(id).await?.player_list("whitelist").await
    }
    pub async fn operators(&self, id: &str) -> Result<Vec<OperatorEntry>> {
        self.client(id).await?.player_list("ops").await
    }
    pub async fn bans(&self, id: &str) -> Result<Vec<BanEntry>> {
        self.client(id).await?.player_list("bans").await
    }
    pub async fn moderate(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
        action: ModerationAction,
        expected: &str,
        intent: &str,
    ) -> Result<ModerationResult> {
        if let Some(operation) = self
            .existing_operation(
                id,
                intent,
                "players.moderate",
                &json!({"action":action,"generation":expected}),
            )
            .await?
        {
            return Ok(ModerationResult::Operation { operation });
        }
        let client = self.client(id).await?;
        let result = self
            .mutate(
                app,
                id,
                intent,
                "players.moderate",
                &json!({"action":action,"generation":expected}),
                None,
                client.moderate(action.clone(), expected, intent),
            )
            .await?;
        match &result {
            ModerationResult::Operation { operation } => {
                self.track(app, id, intent, operation).await?
            }
            ModerationResult::AwaitingConfirmation { .. } => {
                // Prepared tokens live only in the client; allow the explicit confirm.
                let key = intent_key(intent)?;
                self.edit_store(|s| {
                    s.intents.retain(|i| i.connection_id != id || i.key != key);
                    Ok(())
                })
                .await?;
            }
        }
        Ok(result)
    }
}

impl Drop for ServerManager {
    fn drop(&mut self) {
        if let Ok(live) = self.live.lock() {
            for slot in live.values() {
                if let Ok(worker) = slot.worker.lock() {
                    if let Some(w) = worker.as_ref() {
                        w.abort();
                    }
                }
            }
        }
        if let Ok(trackers) = self.trackers.lock() {
            for t in trackers.values() {
                t.abort();
            }
        }
    }
}
