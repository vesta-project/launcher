mod credentials;
pub(crate) mod files;
mod hosting;
mod management;
pub(crate) mod pack_sync;
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

// Retires every retained client even if the user switches away and back before
// its next request. Config writes invalidate synchronously before publishing.
static ACCOUNT_SCOPE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
static ACCOUNT_MANAGERS: std::sync::OnceLock<StdMutex<Vec<std::sync::Weak<ServerManager>>>> =
    std::sync::OnceLock::new();
pub(crate) fn retire_account_scope() {
    ACCOUNT_SCOPE.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
    if let Some(managers) = ACCOUNT_MANAGERS.get() {
        if let Ok(mut managers) = managers.lock() {
            managers.retain(|weak| {
                let Some(manager) = weak.upgrade() else {
                    return false;
                };
                manager.retire_account_clients();
                true
            });
        }
    }
}
fn account_scope() -> u64 {
    ACCOUNT_SCOPE.load(std::sync::atomic::Ordering::Acquire)
}
fn selected_account() -> Option<String> {
    crate::utils::config::get_app_config()
        .ok()?
        .active_account_uuid
        .and_then(|id| uuid::Uuid::parse_str(&id).ok())
        .map(|id| id.to_string())
}
fn account_matches(bound: Option<&str>, selected: Option<&str>) -> bool {
    match (
        bound.and_then(|id| uuid::Uuid::parse_str(id).ok()),
        selected.and_then(|id| uuid::Uuid::parse_str(id).ok()),
    ) {
        (Some(bound), Some(selected)) => bound == selected,
        _ => false,
    }
}
fn protect_transport(transport: &Transport, account: &str, scope: u64) -> Result<()> {
    let account = account.to_owned();
    transport.set_access_guard(Arc::new(move || {
        account_scope() == scope && account_matches(Some(&account), selected_account().as_deref())
    }))
}
fn account_snapshot(record: &Record) -> ServerSnapshot {
    let mut snapshot = record.snapshot.clone();
    if !account_matches(
        record.account_uuid.as_deref(),
        selected_account().as_deref(),
    ) {
        snapshot.connection.role = None;
        snapshot.state = Default::default();
        snapshot.state.access = "credentials_rejected".into();
        snapshot.state.last_error = Some(ErrorCode::CredentialsRejected);
        snapshot.capabilities = CapabilityView {
            source: "unknown".into(),
            roles: None,
            granted: vec![],
            refused: vec![],
        };
        snapshot.info = None;
        snapshot.status = None;
        snapshot.pack = None;
        snapshot.join_address = None;
        snapshot.backups_configured = None;
        snapshot.status_observed_at_ms = None;
    }
    snapshot
}

struct Contact {
    discovery: Discovery,
    transport: Arc<Transport>,
    expires: Instant,
    input_hash: String,
    created: Instant,
}
#[derive(Default)]
struct Live {
    management: Mutex<()>,
    client: Mutex<Option<Arc<Client>>>,
    client_scope: std::sync::atomic::AtomicU64,
    refresh: Mutex<()>,
    worker: StdMutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    capabilities_loaded: std::sync::atomic::AtomicBool,
    info_loaded: std::sync::atomic::AtomicBool,
    players: StdMutex<Option<PlayersView>>,
}
pub struct ServerManager {
    account_app: StdMutex<Option<AppHandle>>,
    pack_previews: Mutex<HashMap<String, pack_sync::Prepared>>,
    pack_gate: Mutex<()>,
    root: PathBuf,
    credentials: Arc<Credentials>,
    store: Arc<Mutex<Store>>,
    credential_cleanup: Mutex<()>,
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
impl ServerManager {
    pub(crate) async fn files_client(&self, id: &str) -> Result<Arc<Client>> {
        self.client(id).await
    }
    pub fn new() -> Result<Arc<Self>> {
        let root = crate::utils::db_manager::get_app_config_dir().map_err(|_| internal())?;
        let manager = Self::at_root(root)?;
        let cleanup = Arc::downgrade(&manager);
        tauri::async_runtime::spawn(async move {
            loop {
                let Some(manager) = cleanup.upgrade() else {
                    break;
                };
                manager.cleanup_deleted_credentials().await;
                drop(manager);
                tokio::time::sleep(Duration::from_secs(60)).await;
            }
        });
        Ok(manager)
    }
    fn at_root(root: PathBuf) -> Result<Arc<Self>> {
        let (store, initialization_error) = match Store::load(&root) {
            Ok(s) => (s, None),
            Err(e) => {
                log::warn!("Server metadata is unavailable; remote management commands are disabled for this profile");
                (Store::default(), Some(e))
            }
        };
        let manager = Arc::new(Self {
            account_app: Default::default(),
            pack_previews: Default::default(),
            pack_gate: Default::default(),
            credentials: Arc::new(Credentials::new(&root)),
            root,
            store: Arc::new(Mutex::new(store)),
            credential_cleanup: Mutex::new(()),
            initialization_error,
            live: Default::default(),
            contacts: Default::default(),
            discovery_gate: Default::default(),
            enrollment_gate: Default::default(),
            subscriptions: Default::default(),
            streaming: Arc::new(Semaphore::new(4)),
            change_pending: Default::default(),
            trackers: Default::default(),
        });
        ACCOUNT_MANAGERS
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| internal())?
            .push(Arc::downgrade(&manager));
        Ok(manager)
    }
    fn retire_account_clients(&self) {
        if let Ok(mut subscriptions) = self.subscriptions.lock() {
            *subscriptions = Default::default();
        }
        if let Ok(mut previews) = self.pack_previews.try_lock() {
            previews.clear();
        }
        if let Ok(mut trackers) = self.trackers.lock() {
            for (_, task) in trackers.drain() {
                task.abort();
            }
        }
        if let Ok(live) = self.live.lock() {
            for slot in live.values() {
                if let Ok(mut worker) = slot.worker.lock() {
                    if let Some(worker) = worker.take() {
                        worker.abort();
                    }
                }
                if let Ok(mut client) = slot.client.try_lock() {
                    *client = None;
                }
                slot.info_loaded
                    .store(false, std::sync::atomic::Ordering::Release);
                slot.capabilities_loaded
                    .store(false, std::sync::atomic::Ordering::Release);
                if let Ok(mut players) = slot.players.lock() {
                    *players = None;
                }
            }
        }
        if let Ok(app) = self.account_app.lock() {
            if let Some(app) = app.as_ref() {
                self.changed(app);
            }
        }
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
            .map(account_snapshot)
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
        Store::edit(&self.store, &self.root, edit).await
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
        self.deliver(
            &id,
            ServerTopic::Status,
            ServerEvent::Snapshot {
                snapshot: Box::new(snapshot),
            },
        );
        self.changed(app);
        Ok(())
    }
    async fn publish_observation(&self, app: &AppHandle, snapshot: ServerSnapshot) -> Result<()> {
        let id = snapshot.connection.id.clone();
        if let Some(e) = &self.initialization_error {
            return Err(e.clone());
        }
        let (snapshot, changed) = Store::observe(&self.store, &self.root, snapshot).await?;
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
        if error.local_pressure {
            return;
        }
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
        snapshot
            .state
            .observe_request_failure(error, vesta_server_client::now_ms());
        let _ = self.publish_observation(app, snapshot).await;
    }
    async fn client(&self, id: &str) -> Result<Arc<Client>> {
        let r = self.record(id).await?;
        if !account_matches(r.account_uuid.as_deref(), selected_account().as_deref()) {
            return Err(Error::new(ErrorCode::CredentialsRejected));
        }
        let scope = account_scope();
        let slot = self.slot(id)?;
        let mut live = slot.client.lock().await;
        if slot.client_scope.load(std::sync::atomic::Ordering::Acquire) == scope {
            if let Some(client) = &*live {
                return Ok(client.clone());
            }
        } else {
            *live = None;
            slot.info_loaded
                .store(false, std::sync::atomic::Ordering::Relaxed);
            slot.capabilities_loaded
                .store(false, std::sync::atomic::Ordering::Relaxed);
            *slot.players.lock().map_err(|_| internal())? = None;
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
        protect_transport(
            &transport,
            r.account_uuid
                .as_deref()
                .ok_or_else(|| Error::new(ErrorCode::CredentialsRejected))?,
            scope,
        )?;
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
        slot.client_scope
            .store(scope, std::sync::atomic::Ordering::Release);
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
                vesta_server_client::Method::GET,
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
            let existing = store
                .connections
                .iter()
                .find(|r| r.snapshot.connection.server_id == discovery.server_id);
            if let Some(record) = existing {
                if discovery.existing_connection_id.as_deref()
                    != Some(record.snapshot.connection.id.as_str())
                {
                    return Err(Error::new(ErrorCode::Conflict));
                }
                if record.snapshot.connection.fingerprint != discovery.fingerprint {
                    return Err(Error::new(ErrorCode::FingerprintMismatch));
                }
                if !record.snapshot.connection.memory_only
                    && store.pending_credential_deletions.len() >= 256
                {
                    return Err(Error::new(ErrorCode::ServerBusy));
                }
            }
            if (existing.is_none() && store.connections.len() >= 100)
                || store.pending_enrollment_keys.len() >= 32
            {
                return Err(Error::new(ErrorCode::ServerBusy));
            }
        }
        if let Some(id) = &discovery.existing_connection_id {
            let record = self.record(id).await?;
            if account_matches(
                record.account_uuid.as_deref(),
                selected_account().as_deref(),
            ) && record.can_reuse_enrollment_key()
            {
                let reference = record.key_reference.clone();
                let signer = self.client(id).await?.device_signer();
                let memory = record.snapshot.connection.memory_only;
                return Ok((discovery, transport, reference, signer, memory));
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
        self: &Arc<Self>,
        app: &AppHandle,
        discovery: Discovery,
        transport: Arc<Transport>,
        reference: String,
        signer: Arc<dyn DeviceSigner>,
        memory: bool,
        device: String,
        role: Option<String>,
        method: &str,
        account_uuid: &str,
        scope: u64,
    ) -> Result<ServerSnapshot> {
        if scope != account_scope()
            || !account_matches(Some(account_uuid), selected_account().as_deref())
        {
            return Err(Error::new(ErrorCode::CredentialsRejected));
        }
        let id = discovery
            .existing_connection_id
            .clone()
            .unwrap_or_else(new_id);
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
            auth_revision: Some(new_id()),
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
                roles: None,
                granted: vec![],
                refused: vec![],
            },
            restart_required: false,
            join_address: None,
            backups_configured: None,
            public_lifecycle: discovery.public_lifecycle.clone(),
        };
        protect_transport(&transport, account_uuid, scope)?;
        let client = Client::new(transport, discovery.server_id, device.clone(), signer);
        let slot = self.slot(&id)?;
        let refresh = slot.refresh.lock().await;
        let management = slot.management.lock().await;
        let snapshot = self
            .edit_store(|s| {
                if scope != account_scope()
                    || !account_matches(Some(account_uuid), selected_account().as_deref())
                {
                    return Err(Error::new(ErrorCode::CredentialsRejected));
                }
                s.enroll(
                    Record {
                        snapshot: snapshot.clone(),
                        device_id: device,
                        key_reference: reference.clone(),
                        account_uuid: Some(account_uuid.into()),
                    },
                    discovery.existing_connection_id.as_deref(),
                )
            })
            .await?;
        if let Some(worker) = slot.worker.lock().map_err(|_| internal())?.take() {
            worker.abort();
        }
        if let Ok(mut trackers) = self.trackers.lock() {
            for key in [&id, &format!("{id}:whitelist")] {
                if let Some(task) = trackers.remove(key) {
                    task.abort();
                }
            }
        }
        self.subscriptions
            .lock()
            .map_err(|_| internal())?
            .reset_connection(&id);
        slot.client_scope
            .store(scope, std::sync::atomic::Ordering::Release);
        *slot.client.lock().await = Some(client);
        slot.info_loaded
            .store(false, std::sync::atomic::Ordering::Relaxed);
        slot.capabilities_loaded
            .store(false, std::sync::atomic::Ordering::Relaxed);
        *slot.players.lock().map_err(|_| internal())? = None;
        self.deliver(
            &id,
            ServerTopic::Status,
            ServerEvent::Snapshot {
                snapshot: Box::new(snapshot),
            },
        );
        self.contacts.lock().await.remove(&discovery.discovery_id);
        self.changed(app);
        drop(management);
        drop(refresh);
        self.cleanup_deleted_credentials().await;
        // Enrollment succeeded even if a follow-up read fails. Return an honest
        // classified connection snapshot rather than encouraging code redemption again.
        let _ = self.refresh(app, &id, true).await;
        self.ensure_worker(app, &id)?;
        Ok(account_snapshot(&self.record(&id).await?))
    }
    pub async fn pair(
        self: &Arc<Self>,
        app: &AppHandle,
        discovery_id: &str,
        code: &str,
        memory_only: bool,
    ) -> Result<ServerSnapshot> {
        let _ = (app, discovery_id, code, memory_only);
        Err(Error::new(ErrorCode::CredentialsRejected))
    }
    pub async fn minecraft(
        self: &Arc<Self>,
        app: &AppHandle,
        discovery_id: &str,
        account_uuid: &str,
        memory_only: bool,
        invitation_code: Option<&str>,
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
        let scope = account_scope();
        if !account_matches(Some(account_uuid), selected_account().as_deref()) {
            return Err(Error::new(ErrorCode::CredentialsRejected));
        }
        let account_uuid = uuid::Uuid::parse_str(account_uuid)
            .map_err(|_| Error::new(ErrorCode::InvalidInput))?
            .to_string();
        let account = crate::auth::ensure_account_tokens_valid(app.clone(), account_uuid.clone())
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
        protect_transport(&t, &account_uuid, scope)?;
        let challenge = t
            .request(
                vesta_server_client::Method::POST,
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
        let join = reqwest12::Client::builder().use_rustls_tls().redirect(reqwest12::redirect::Policy::none()).connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(15)).build().map_err(|_| internal())?
            .post("https://sessionserver.mojang.com/session/minecraft/join").json(&json!({"accessToken":token.as_str(),"selectedProfile":account.uuid,"serverId":server_hash})).send().await.map_err(|_| Error::new(ErrorCode::Unreachable))?;
        if !join.status().is_success() {
            return Err(Error::new(ErrorCode::CredentialsRejected));
        }
        let (d, t, r, s, m) = self.enrollment(discovery_id, memory_only).await?;
        let contact = self.contacts.lock().await.remove(discovery_id);
        let reused_key = if let Some(id) = d.existing_connection_id.as_deref() {
            self.record(id).await?.key_reference == r
        } else {
            false
        };
        if scope != account_scope()
            || !account_matches(Some(&account_uuid), selected_account().as_deref())
        {
            if !reused_key {
                self.discard_unredeemed(&r, m).await;
            }
            return Err(Error::new(ErrorCode::CredentialsRejected));
        }
        let mut payload = json!({"challenge":challenge_id,"device_name":local_device_name(),"public_key":s.public_key()});
        if let Some(code) = invitation_code.filter(|code| !code.trim().is_empty()) {
            payload["invitation_code"] = json!(code);
        }
        let completion = t
            .request(
                vesta_server_client::Method::POST,
                "/api/v3/auth/minecraft/complete",
                None,
                Some(payload),
                None,
                true,
            )
            .await
            .map_err(|e| {
                if matches!(
                    e.code,
                    ErrorCode::Timeout | ErrorCode::OutcomeUnknown | ErrorCode::Unreachable
                ) {
                    Error::new(ErrorCode::PairOutcomeUnknown)
                } else {
                    e
                }
            });
        let complete = match completion {
            Ok(complete) => complete,
            Err(error) => {
                if !matches!(
                    error.code,
                    ErrorCode::PairOutcomeUnknown | ErrorCode::FingerprintMismatch
                ) {
                    if !reused_key {
                        self.discard_unredeemed(&r, m).await;
                    }
                    if let Some(contact) = contact {
                        self.contacts
                            .lock()
                            .await
                            .insert(discovery_id.into(), contact);
                    }
                }
                return Err(error);
            }
        };
        let device = complete["device_id"]
            .as_str()
            .ok_or_else(|| Error::new(ErrorCode::PairOutcomeUnknown))?
            .into();
        self.finish_enrollment(
            app,
            d,
            t,
            r,
            s,
            m,
            device,
            complete["role"]
                .as_str()
                .filter(|role| !role.is_empty())
                .map(str::to_owned),
            "minecraft",
            &account_uuid,
            scope,
        )
        .await
    }
    pub async fn snapshot(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
        refresh: bool,
    ) -> Result<ServerSnapshot> {
        if refresh {
            self.refresh(app, id, true).await?;
            // A prior permanent/local construction error may have ended the
            // worker. A successful explicit recovery restores existing demand.
            self.ensure_worker(app, id)?;
        }
        Ok(account_snapshot(&self.record(id).await?))
    }
    pub async fn refresh(&self, app: &AppHandle, id: &str, interactive: bool) -> Result<()> {
        self.client(id).await?;
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
            // Learn effective access before requesting any privileged metadata.
            // Minecraft enrollment can be player-only, with no management grants.
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
            if !snapshot
                .capabilities
                .granted
                .iter()
                .any(|cap| cap == "status.view")
            {
                snapshot.info = None;
                snapshot.status = None;
                snapshot.pack = None;
                snapshot.public_lifecycle = Some(client.public_lifecycle().await?);
                snapshot.status_observed_at_ms = Some(vesta_server_client::now_ms());
                return Ok::<(), Error>(());
            }
            if !slot.info_loaded.load(std::sync::atomic::Ordering::Relaxed) {
                let info = client.info().await?;
                if snapshot.connection.name == snapshot.connection.endpoint {
                    snapshot.connection.name = info.name.clone();
                }
                snapshot.backups_configured = info.backups_configured;
                snapshot.join_address = info.join_address.clone().or_else(|| {
                    info.game_port.and_then(|port| {
                        let endpoint = Endpoint::parse(&snapshot.connection.endpoint).ok()?;
                        Some(format!("{}:{port}", endpoint.url().host()?))
                    })
                });
                snapshot.info = Some(info);
                slot.info_loaded
                    .store(true, std::sync::atomic::Ordering::Relaxed);
            }
            if snapshot.pack.is_none() {
                snapshot.pack = Some(from_wire(
                    client.get("pack", interactive, "status.view").await?,
                )?);
            }
            let status = client.status(interactive).await?;
            snapshot.public_lifecycle = None;
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
            // Keep any metadata fetched earlier in this refresh without changing
            // connectivity based on a request that never reached the host.
            Err(e) if e.local_pressure => {}
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
        self.publish(app, snapshot).await?;
        Ok(account_snapshot(&self.record(id).await?))
    }
    pub async fn approve(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
        fingerprint: &str,
    ) -> Result<ServerSnapshot> {
        self.client(id).await?;
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
                let record = self.record(id).await?;
                protect_transport(
                    &transport,
                    record
                        .account_uuid
                        .as_deref()
                        .ok_or_else(|| Error::new(ErrorCode::CredentialsRejected))?,
                    account_scope(),
                )?;
                *current = Some(client.repin(transport));
            }
        }
        slot.info_loaded
            .store(false, std::sync::atomic::Ordering::Relaxed);
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
        self.edit_store(|s| s.remove_connection(id)).await?;
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
        self.cleanup_deleted_credentials().await;
        Ok(())
    }
    async fn cleanup_deleted_credentials(&self) {
        let Ok(_guard) = self.credential_cleanup.try_lock() else {
            return;
        };
        let _ = Store::cleanup_keys(&self.store, &self.root, |key| {
            let credentials = self.credentials.clone();
            async move {
                tokio::task::spawn_blocking(move || credentials.delete(&key))
                    .await
                    .map_err(|_| internal())?
            }
        })
        .await;
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
        let record = self.record(id).await?;
        let authorized = account_matches(
            record.account_uuid.as_deref(),
            selected_account().as_deref(),
        );
        let snapshot = account_snapshot(&record);
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
            if authorized {
                if let Some(players) = self
                    .slot(id)?
                    .players
                    .lock()
                    .map_err(|_| internal())?
                    .clone()
                {
                    self.deliver(id, topic, ServerEvent::Players { players });
                }
            }
        }
        self.ensure_worker(app, id)?;
        Ok(handle)
    }
    fn ensure_worker(self: &Arc<Self>, app: &AppHandle, id: &str) -> Result<()> {
        *self.account_app.lock().map_err(|_| internal())? = Some(app.clone());
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
        let event = {
            let Ok(store) = self.store.try_lock() else {
                return;
            };
            let Some(record) = store
                .connections
                .iter()
                .find(|r| r.snapshot.connection.id == id)
            else {
                return;
            };
            if !account_matches(
                record.account_uuid.as_deref(),
                selected_account().as_deref(),
            ) {
                match event {
                    ServerEvent::Snapshot { .. } => ServerEvent::Snapshot {
                        snapshot: Box::new(account_snapshot(record)),
                    },
                    _ => return,
                }
            } else {
                event
            }
        };
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
            let auth_revision = s
                .connections
                .iter()
                .find(|r| r.snapshot.connection.id == id)
                .and_then(|r| r.snapshot.connection.auth_revision.clone());
            if let Some(old) = s
                .intents
                .iter()
                .find(|i| i.connection_id == id && i.key == key)
            {
                if old.action != action
                    || old.payload_hash != digest
                    || old.auth_revision != auth_revision
                {
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
                auth_revision,
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
        let players = self.client(id).await?.players().await?;
        *self.slot(id)?.players.lock().map_err(|_| internal())? = Some(players.clone());
        Ok(players)
    }
    pub async fn whitelist(&self, id: &str) -> Result<Vec<WhitelistEntry>> {
        self.client(id).await?.player_list("whitelist").await
    }
    pub async fn offline_whitelist(
        &self,
        id: &str,
    ) -> Result<vesta_server_client::files::OfflineWhitelistSnapshot> {
        self.client(id).await?.offline_whitelist().await
    }
    pub async fn offline_whitelist_update(
        &self,
        app: &AppHandle,
        id: &str,
        player: &str,
        add: bool,
        expected: Option<&str>,
        intent: &str,
    ) -> Result<String> {
        let client = self.client(id).await?;
        let result = self
            .mutate(
                app,
                id,
                intent,
                "players.whitelist.offline",
                &json!({"player":player,"add":add,"expected":expected}),
                None,
                client.offline_whitelist_update(player, add, expected, intent),
            )
            .await?;
        let key = intent_key(intent)?;
        self.edit_store(|s| {
            if let Some(i) = s
                .intents
                .iter_mut()
                .find(|i| i.connection_id == id && i.key == key)
            {
                i.terminal = true;
                i.uncertain = false;
            }
            Ok(())
        })
        .await?;
        Ok(result)
    }
    pub async fn operators(&self, id: &str) -> Result<Vec<OperatorEntry>> {
        self.client(id).await?.player_list("ops").await
    }
    pub async fn startup_whitelist_update(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
        player: &str,
        add: bool,
        generation: &str,
        intent: &str,
    ) -> Result<String> {
        let client = self.client(id).await?;
        let receipt = self
            .mutate(
                app,
                id,
                intent,
                "players.whitelist.desired",
                &json!({"player":player,"add":add,"generation":generation}),
                None,
                client.startup_whitelist_update(player, add, generation, intent),
            )
            .await?;
        let key = intent_key(intent)?;
        self.edit_store(|s| {
            if let Some(i) = s
                .intents
                .iter_mut()
                .find(|i| i.connection_id == id && i.key == key)
            {
                i.operation_id = Some(receipt.clone());
                i.uncertain = false;
            }
            Ok(())
        })
        .await?;
        self.ensure_whitelist_tracker(app, id)?;
        Ok(receipt)
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

/// Device identity remains the enrolled key; this is only its display label.
fn local_device_name() -> String {
    let name = sysinfo::System::host_name().unwrap_or_default();
    let mut name: String = name
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(64)
        .collect();
    while name.len() > 64 {
        name.pop();
    }
    if name.is_empty() {
        if cfg!(target_os = "windows") {
            "Windows computer"
        } else if cfg!(target_os = "macos") {
            "Mac"
        } else {
            "Linux computer"
        }
        .into()
    } else {
        name
    }
}
