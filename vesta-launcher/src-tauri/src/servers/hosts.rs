use super::*;
use serde::Serialize;
use vesta_server_client::host::{
    device_name, reasoned, string, AccountSignIn, Bootstrap, HostSession, ServerRef, VestaHost,
};
type Signer = Arc<dyn vesta_server_client::auth::DeviceSigner>;
/// The launcher's Minecraft session, used only for the Mojang join.
struct MinecraftAccount {
    id: String,
    name: String,
    profile: String,
    token: zeroize::Zeroizing<String>,
}
impl MinecraftAccount {
    async fn join(self, server_hash: String) -> Result<()> {
        let joined = reqwest12::Client::builder()
            .use_rustls_tls()
            .no_proxy()
            .redirect(reqwest12::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| internal())?
            .post("https://sessionserver.mojang.com/session/minecraft/join")
            .json(&json!({"accessToken":self.token.as_str(),"selectedProfile":self.profile,"serverId":server_hash}))
            .send()
            .await
            .map_err(|_| reasoned(ErrorCode::Unreachable, "account_service_unreachable"))?;
        if !joined.status().is_success() {
            return Err(reasoned(
                ErrorCode::CredentialsRejected,
                "account_proof_failed",
            ));
        }
        Ok(())
    }
}
/// A code proven by PAKE but not yet used. Holds the live bootstrap connection and the
/// fresh device key it was bound to; dropping it closes the connection and deletes the key.
pub struct VerifiedCode {
    id: String,
    address: String,
    link: bool,
    bootstrap: Bootstrap,
    signer: Signer,
    key: EnrollmentKey,
}
/// Connection level failures where a fresh exchange is worth one transparent retry.
fn exchange_lost(e: &Error) -> bool {
    match e.code {
        ErrorCode::Unreachable | ErrorCode::TlsFailed | ErrorCode::Timeout => e.reason.is_none(),
        ErrorCode::CredentialsRejected => e.reason.as_deref() == Some("pairing_failed"),
        _ => false,
    }
}
/// A code that already passed once now fails: it expired or was replaced on the machine.
fn after_verified(e: Error) -> Error {
    if e.reason.as_deref() == Some("pairing_failed") {
        reasoned(ErrorCode::CredentialsRejected, "code_expired")
    } else {
        e
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostDiscovery {
    pub host_id: String,
    pub name: Option<String>,
    pub fingerprint: String,
    pub address: String,
    pub state: Option<String>,
}
pub struct PendingLink {
    bootstrap: Bootstrap,
    signer: Arc<dyn vesta_server_client::auth::DeviceSigner>,
    reference: String,
    address: String,
    account: String,
    last_poll: Instant,
}
struct EnrollmentKey {
    credentials: Arc<Credentials>,
    reference: String,
    retain: bool,
}
impl Drop for EnrollmentKey {
    fn drop(&mut self) {
        if !self.retain {
            let credentials = self.credentials.clone();
            let reference = self.reference.clone();
            tokio::task::spawn_blocking(move || {
                let _ = credentials.delete(&reference);
            });
        }
    }
}
impl ServerManager {
    pub async fn hosts_list(&self) -> Result<Vec<VestaHost>> {
        Ok(self.host_store.lock().await.hosts.clone())
    }
    pub async fn host_session(&self, id: &str) -> Result<Arc<HostSession>> {
        if crate::utils::config::get_app_config().is_ok_and(|c| c.proxy_enabled) {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        let mut sessions = self.host_sessions.lock().await;
        if let Some(s) = sessions.get(id) {
            return Ok(s.clone());
        }
        let mut h = {
            let store = self.host_store.lock().await;
            store
                .hosts
                .iter()
                .chain(store.pending_enrollments.iter())
                .find(|h| h.id == id)
                .cloned()
                .ok_or_else(|| Error::new(ErrorCode::NotFound))?
        };
        let credentials = self.credentials.clone();
        let reference = h.key_reference.clone();
        let signer = tokio::task::spawn_blocking(move || credentials.load(&reference))
            .await
            .map_err(|_| internal())??;
        if h.device_id.is_empty() {
            let mut connection = vesta_server_client::host::Connection::open(
                &Endpoint::host(h.endpoints.first().ok_or_else(internal)?)?,
                Some(h.fingerprint.clone()),
            )
            .await?;
            let challenge = connection
                .call(
                    "POST",
                    "/v1/host/sessions/challenge",
                    None,
                    Some(json!({"deviceKey":signer.public_key()})),
                    None,
                    None,
                )
                .await?;
            h.device_id = string(&challenge, "deviceId")?;
            let recovery =
                HostSession::new(h.clone(), signer.clone(), Endpoint::host(&h.endpoints[0])?);
            recovery.token(None).await?; // possession proof, never trust anonymous lookup alone
            let mut store = self.host_store.lock().await;
            let mut next = store.clone();
            next.pending_enrollments.retain(|p| p.id != id);
            next.hosts.retain(|p| p.id != id);
            next.hosts.push(h.clone());
            next.pending_enrollments.retain(|p| p.id != h.id);
            next.save(&self.root)?;
            *store = next;
        }
        let s = HostSession::new(
            h.clone(),
            signer,
            Endpoint::host(h.endpoints.first().ok_or_else(internal)?)?,
        );
        sessions.insert(id.into(), s.clone());
        Ok(s)
    }
    pub async fn host_endpoint(&self, id: &str) -> Result<Endpoint> {
        let s = self.host_session(id).await?;
        for address in &s.host.endpoints {
            let endpoint = Endpoint::host(address)?;
            if vesta_server_client::host::Connection::open(
                &endpoint,
                Some(s.host.fingerprint.clone()),
            )
            .await
            .is_ok()
            {
                return Ok(endpoint);
            }
        }
        Err(Error::new(ErrorCode::Unreachable))
    }
    pub async fn host_probe(&self, address: &str) -> Result<HostDiscovery> {
        let endpoint = Endpoint::host(address)?;
        let mut c = vesta_server_client::host::Connection::open(&endpoint, None).await?;
        let v = c
            .call("GET", "/v1/host/discovery", None, None, None, None)
            .await?;
        if v["fingerprint"] != c.fingerprint || v["protocol"] != "host-v1" {
            return Err(Error::new(ErrorCode::FingerprintMismatch));
        }
        Ok(HostDiscovery {
            host_id: string(&v, "hostId")?,
            name: v["name"].as_str().map(str::to_owned),
            fingerprint: c.fingerprint,
            address: endpoint.display(),
            state: v["claimState"].as_str().map(str::to_owned),
        })
    }
    pub async fn host_discover(&self) -> Result<Vec<HostDiscovery>> {
        let hints = tokio::task::spawn_blocking(|| {
            vesta_host_client::discovery::browse(Duration::from_secs(3))
        })
        .await
        .map_err(|_| internal())?
        .map_err(|_| internal())?;
        let mut found = Vec::new();
        for hint in hints {
            for address in hint.addresses {
                let ip = address.to_string();
                let address = if ip.contains(':') {
                    format!("[{ip}]:{}", hint.port)
                } else {
                    format!("{ip}:{}", hint.port)
                };
                let Ok(d) = self.host_probe(&address).await else {
                    continue;
                };
                if d.host_id != hint.txt.id {
                    continue;
                }
                // Discovery never rotates trust. Only a successful pinned handshake admits a new endpoint.
                let saved = self
                    .host_store
                    .lock()
                    .await
                    .hosts
                    .iter()
                    .find(|h| h.id == d.host_id)
                    .cloned();
                if let Some(h) = saved {
                    if !h.endpoints.contains(&d.address)
                        && vesta_server_client::host::Connection::open(
                            &Endpoint::host(&address)?,
                            Some(h.fingerprint),
                        )
                        .await
                        .is_ok()
                    {
                        let mut store = self.host_store.lock().await;
                        let mut next = store.clone();
                        if let Some(h) = next.hosts.iter_mut().find(|h| h.id == d.host_id) {
                            h.endpoints.retain(|e| e != &d.address);
                            h.endpoints.insert(0, d.address.clone());
                            h.endpoints.truncate(8);
                        }
                        next.save(&self.root)?;
                        *store = next;
                        drop(store);
                        if let Some(session) = self.host_sessions.lock().await.get(&d.host_id) {
                            let endpoints = self
                                .host_store
                                .lock()
                                .await
                                .hosts
                                .iter()
                                .find(|h| h.id == d.host_id)
                                .map(|h| h.endpoints.clone())
                                .unwrap_or_default();
                            session.update_endpoints(endpoints);
                        }
                        // Retire clients so their next connection uses the re-resolved address.
                        self.host_retire_clients(&d.host_id);
                    }
                }
                found.push(d);
                break;
            }
        }
        Ok(found)
    }
    async fn host_minecraft_account(app: &AppHandle, account_uuid: &str) -> Result<MinecraftAccount> {
        let signin = || reasoned(ErrorCode::CredentialsUnavailable, "account_signin_required");
        let account = crate::auth::ensure_account_tokens_valid(app.clone(), account_uuid.into())
            .await
            .map_err(|_| signin())?;
        if !crate::auth::is_previously_authenticated_account(&account) {
            return Err(signin());
        }
        Ok(MinecraftAccount {
            id: uuid::Uuid::parse_str(&account.uuid)
                .map_err(|_| internal())?
                .to_string(),
            name: account.username.clone(),
            profile: account.uuid.replace('-', ""),
            token: zeroize::Zeroizing::new(account.access_token.ok_or_else(signin)?),
        })
    }
    async fn host_account_proof(
        &self,
        app: &AppHandle,
        b: &mut Bootstrap,
        account_uuid: &str,
        signer: &dyn vesta_server_client::auth::DeviceSigner,
        purpose: &str,
    ) -> Result<Value> {
        let account = Self::host_minecraft_account(app, account_uuid).await?;
        let (id, name) = (account.id.clone(), account.name.clone());
        b.account_proof(&id, &name, signer, purpose, move |hash| account.join(hash))
            .await
    }
    /// What this computer is called on the machine's devices list.
    pub fn host_device_name(fallback: &str) -> String {
        sysinfo::System::host_name()
            .as_deref()
            .and_then(device_name)
            .or_else(|| device_name(fallback))
            .unwrap_or_else(|| {
                match std::env::consts::OS {
                    "windows" => "Windows PC",
                    "macos" => "Mac",
                    _ => "Linux PC",
                }
                .into()
            })
    }
    async fn host_save_enrollment(
        &self,
        discovery: &Value,
        fingerprint: &str,
        address: &str,
        reference: String,
        signer: Arc<dyn vesta_server_client::auth::DeviceSigner>,
        reply: &Value,
    ) -> Result<VestaHost> {
        let id = string(discovery, "hostId")?;
        if reply["hostId"] != id || reply["fingerprint"] != fingerprint {
            return Err(Error::new(ErrorCode::FingerprintMismatch));
        }
        let h = VestaHost {
            id: id.clone(),
            name: discovery["name"].as_str().unwrap_or(address).into(),
            fingerprint: fingerprint.into(),
            endpoints: vec![Endpoint::host(address)?.display()],
            device_id: string(reply, "deviceId")?,
            key_reference: reference,
            account_id: string(reply, "accountId")?,
            auth_revision: string(reply, "authGeneration")?,
        };
        let session = HostSession::new(h.clone(), signer, Endpoint::host(address)?);
        session.install(reply).await?;
        let mut store = self.host_store.lock().await;
        let mut next = store.clone();
        next.hosts.retain(|h| h.id != id);
        next.hosts.push(h.clone());
        next.pending_enrollments.retain(|p| p.id != id);
        next.save(&self.root)?;
        *store = next;
        drop(store);
        self.host_sessions.lock().await.insert(id, session);
        Ok(h)
    }
    async fn host_new_key(&self) -> Result<(Signer, EnrollmentKey)> {
        let credentials = self.credentials.clone();
        let reference = new_id();
        let r = reference.clone();
        let signer = tokio::task::spawn_blocking(move || credentials.create(&r, false))
            .await
            .map_err(|_| internal())??;
        Ok((
            signer,
            EnrollmentKey {
                credentials: self.credentials.clone(),
                reference,
                retain: false,
            },
        ))
    }
    fn purpose(link: bool) -> vesta_host_client::Purpose {
        if link {
            vesta_host_client::Purpose::Link
        } else {
            vesta_host_client::Purpose::Claim
        }
    }
    /// Runs the PAKE exchange as soon as a code is complete, so a wrong code is reported
    /// before anything else. The proven connection is kept for the claim that follows.
    pub async fn host_verify_code(&self, address: &str, code: &str, link: bool) -> Result<Value> {
        let _gate = self.host_gate.lock().await;
        // Drop any earlier verification first: it closes that connection and deletes its key.
        self.host_verified.lock().await.take();
        let (signer, key) = self.host_new_key().await?;
        let bootstrap =
            Bootstrap::start(address, code, Self::purpose(link), signer.as_ref()).await?;
        let id = new_id();
        let reply = json!({
            "verificationId": id,
            "hostId": bootstrap.discovery["hostId"],
            "name": bootstrap.discovery["name"],
        });
        *self.host_verified.lock().await = Some(VerifiedCode {
            id,
            address: address.into(),
            link,
            bootstrap,
            signer,
            key,
        });
        Ok(reply)
    }
    pub async fn host_enroll(
        &self,
        app: &AppHandle,
        address: &str,
        code: &str,
        account_uuid: &str,
        device_name: &str,
        link: bool,
        verification: Option<&str>,
    ) -> Result<Value> {
        let _gate = self.host_gate.lock().await;
        let verified = verification.is_some();
        // Whatever sits in the slot is spent now; a mismatched one is dropped with its key.
        let cached = self.host_verified.lock().await.take().filter(|v| {
            Some(v.id.as_str()) == verification && v.address == address && v.link == link
        });
        // Reuse the proven exchange when it is still alive; otherwise redo it with the
        // remembered code. A code that passed before and now fails has expired or rotated.
        let cached = match cached {
            Some(mut v) => {
                let alive = v.bootstrap.usable().await;
                Some((v, alive))
            }
            None => None,
        };
        let (signer, mut key_guard, mut b, reused) = match cached {
            Some((v, true)) => (v.signer, v.key, v.bootstrap, true),
            Some((v, false)) => {
                let b = Bootstrap::start(address, code, Self::purpose(link), v.signer.as_ref())
                    .await
                    .map_err(after_verified)?;
                (v.signer, v.key, b, false)
            }
            None => {
                let (signer, key) = self.host_new_key().await?;
                let b = Bootstrap::start(address, code, Self::purpose(link), signer.as_ref())
                    .await
                    .map_err(|e| if verified { after_verified(e) } else { e })?;
                (signer, key, b, false)
            }
        };
        let reference = key_guard.reference.clone();
        let purpose = if link { "link" } else { "claim" };
        let proof = match self
            .host_account_proof(app, &mut b, account_uuid, signer.as_ref(), purpose)
            .await
        {
            Err(e) if reused && exchange_lost(&e) => {
                b = Bootstrap::start(address, code, Self::purpose(link), signer.as_ref())
                    .await
                    .map_err(after_verified)?;
                self.host_account_proof(app, &mut b, account_uuid, signer.as_ref(), purpose)
                    .await?
            }
            other => other?,
        };
        // Journal only PAKE-proven identity and key reference before dispatch. A lost
        // claim reply can be recovered via device-key lookup and fresh possession proof.
        let pending = VestaHost {
            id: string(&b.discovery, "hostId")?,
            name: b.discovery["name"].as_str().unwrap_or(address).into(),
            fingerprint: b.connection.fingerprint.clone(),
            endpoints: vec![Endpoint::host(address)?.display()],
            device_id: String::new(),
            key_reference: reference.clone(),
            account_id: string(&proof, "accountId")?,
            auth_revision: "0".into(),
        };
        {
            let mut store = self.host_store.lock().await;
            let mut next = store.clone();
            next.pending_enrollments.retain(|p| p.id != pending.id);
            next.pending_enrollments.push(pending);
            next.save(&self.root)?;
            *store = next;
        }
        key_guard.retain = true;
        if link {
            let link_id = b.link_id.clone().ok_or_else(internal)?;
            let mut nonce = [0u8; 32];
            use vesta_host_client::rand_core::RngCore;
            vesta_host_client::rand_core::OsRng.fill_bytes(&mut nonce);
            let request = json!({"hostId":b.discovery["hostId"],"linkId":link_id,"deviceKey":signer.public_key(),"accountId":proof["accountId"],"requestedRole":"linked_device","deviceName":device_name,"nonce":vesta_host_client::encode(&nonce),"expiresAt":(chrono::Utc::now()+chrono::Duration::seconds(110)).to_rfc3339()});
            let signature = signer
                .sign(&vesta_host_client::requests::signing_bytes(
                    "vesta.host.link.v1",
                    &request,
                ))
                .await?;
            let response=b.call("/v1/host/links",Some(json!({"exchangeId":b.exchange_id,"accountProofId":proof["accountProofId"],"request":request,"signature":signature}))).await?;
            self.host_links.lock().await.insert(
                link_id,
                PendingLink {
                    bootstrap: b,
                    signer,
                    reference,
                    address: address.into(),
                    account: string(&proof, "accountId")?,
                    last_poll: Instant::now() - Duration::from_secs(2),
                },
            );
            return Ok(response);
        }
        let reply = b.claim(&proof, device_name, signer.as_ref()).await?;
        Ok(serde_json::to_value(
            self.host_save_enrollment(
                &b.discovery,
                &b.connection.fingerprint,
                address,
                reference,
                signer,
                &reply,
            )
            .await?,
        )
        .map_err(|_| internal())?)
    }
    /// A machine someone already set up: the Minecraft account is the permission, so a new
    /// device key is enrolled with no code. `host_id` is the machine the person picked.
    pub async fn host_sign_in_with_account(
        &self,
        app: &AppHandle,
        address: &str,
        host_id: Option<&str>,
        account_uuid: &str,
        device_name: &str,
    ) -> Result<VestaHost> {
        let _gate = self.host_gate.lock().await;
        let h = self
            .host_account_sign_in(app, address, host_id, account_uuid, device_name)
            .await?;
        self.changed(app);
        Ok(h)
    }
    async fn host_account_sign_in(
        &self,
        app: &AppHandle,
        address: &str,
        host_id: Option<&str>,
        account_uuid: &str,
        device_name: &str,
    ) -> Result<VestaHost> {
        let known = |store: &vesta_server_client::host::HostStore, id: &str| {
            store
                .hosts
                .iter()
                .chain(store.pending_enrollments.iter())
                .find(|h| h.id == id)
                .cloned()
        };
        // An existing pin always wins over whatever the address presents now.
        let pin = match host_id {
            Some(id) => known(&*self.host_store.lock().await, id).map(|h| h.fingerprint),
            None => None,
        };
        let mut s = AccountSignIn::open(address, pin.clone(), host_id).await?;
        if pin.is_none() {
            if let Some(h) = known(&*self.host_store.lock().await, &s.host_id) {
                if h.fingerprint != s.connection.fingerprint {
                    return Err(reasoned(
                        ErrorCode::FingerprintMismatch,
                        "host_identity_changed",
                    ));
                }
            }
        }
        let account = Self::host_minecraft_account(app, account_uuid).await?;
        let (signer, mut key) = self.host_new_key().await?;
        let (id, name) = (account.id.clone(), account.name.clone());
        let proof = s
            .account_proof(&id, &name, signer.as_ref(), move |hash| account.join(hash))
            .await?;
        // Journal the key before enrolling so a lost reply is recovered by device key lookup.
        let pending = VestaHost {
            id: s.host_id.clone(),
            name: s.discovery["name"].as_str().unwrap_or(address).into(),
            fingerprint: s.connection.fingerprint.clone(),
            endpoints: vec![Endpoint::host(address)?.display()],
            device_id: String::new(),
            key_reference: key.reference.clone(),
            account_id: string(&proof, "accountId")?,
            auth_revision: "0".into(),
        };
        self.host_journal(|next| {
            next.pending_enrollments.retain(|p| p.id != pending.id);
            next.pending_enrollments.push(pending.clone());
        })
        .await?;
        key.retain = true;
        let reply = match s.enroll(&proof, device_name, signer.as_ref()).await {
            Ok(reply) => reply,
            Err(e) => {
                if !matches!(e.code, ErrorCode::Unreachable | ErrorCode::Timeout) {
                    // A definite answer: nothing was enrolled, so forget the key.
                    key.retain = false;
                    let reference = key.reference.clone();
                    self.host_journal(|next| {
                        next.pending_enrollments
                            .retain(|p| p.key_reference != reference)
                    })
                    .await?;
                }
                return Err(e);
            }
        };
        let previous = self
            .host_store
            .lock()
            .await
            .hosts
            .iter()
            .find(|h| h.id == s.host_id)
            .cloned();
        let h = self
            .host_save_enrollment(
                &s.discovery,
                &s.connection.fingerprint,
                address,
                key.reference.clone(),
                signer,
                &reply,
            )
            .await?;
        if let Some(old) = previous.filter(|old| old.key_reference != h.key_reference) {
            self.host_retire_clients(&h.id);
            let credentials = self.credentials.clone();
            let _ = tokio::task::spawn_blocking(move || credentials.delete(&old.key_reference))
                .await;
        }
        Ok(h)
    }
    async fn host_journal(
        &self,
        change: impl FnOnce(&mut vesta_server_client::host::HostStore),
    ) -> Result<()> {
        let mut store = self.host_store.lock().await;
        let mut next = store.clone();
        change(&mut next);
        next.save(&self.root)?;
        *store = next;
        Ok(())
    }
    /// Server clients of a machine hold its old session; the next use builds new ones.
    fn host_retire_clients(&self, host_id: &str) {
        if let Ok(mut live) = self.live.lock() {
            live.retain(|id, slot| {
                if id.starts_with(&format!("{host_id}:")) {
                    if let Ok(mut worker) = slot.worker.lock() {
                        if let Some(task) = worker.take() {
                            task.abort();
                        }
                    }
                    false
                } else {
                    true
                }
            });
        }
    }
    /// This device was revoked or its key is gone. The account still decides access, so
    /// sign in again with a new key; only a failure reaches the person.
    async fn host_recover(&self, app: &AppHandle, id: &str, stale_device: &str) -> Result<()> {
        let _gate = self.host_gate.lock().await;
        let h = self
            .host_store
            .lock()
            .await
            .hosts
            .iter()
            .find(|h| h.id == id)
            .cloned()
            .ok_or_else(|| Error::new(ErrorCode::NotFound))?;
        if h.device_id != stale_device {
            return Ok(()); // someone else already signed in again
        }
        self.host_sessions.lock().await.remove(id);
        let device = Self::host_device_name("");
        let mut last = Error::new(ErrorCode::Unreachable);
        for address in &h.endpoints {
            match self
                .host_account_sign_in(app, address, Some(id), &h.account_id, &device)
                .await
            {
                Ok(_) => return Ok(()),
                Err(e) if matches!(e.code, ErrorCode::Unreachable | ErrorCode::Timeout | ErrorCode::TlsFailed) && e.reason.is_none() => last = e,
                Err(e) => return Err(e),
            }
        }
        Err(last)
    }
    /// Runs a host request, signing in again once if this device lost its access.
    pub async fn host_using<T, F, Fut>(&self, app: &AppHandle, id: &str, run: F) -> Result<T>
    where
        F: Fn(Arc<HostSession>) -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        let stale = |store: &vesta_server_client::host::HostStore| {
            store
                .hosts
                .iter()
                .find(|h| h.id == id)
                .map(|h| h.device_id.clone())
        };
        let session = match self.host_session(id).await {
            Ok(session) => session,
            // The key for this machine is missing from the system keychain.
            Err(e) if e.code == ErrorCode::CredentialsUnavailable && e.reason.is_none() => {
                let Some(device) = stale(&*self.host_store.lock().await) else {
                    return Err(e);
                };
                self.host_recover(app, id, &device).await?;
                self.host_session(id).await?
            }
            Err(e) => return Err(e),
        };
        let device = session.host.device_id.clone();
        match run(session).await {
            Err(e) if e.reason.as_deref() == Some("device_revoked") => {
                self.host_recover(app, id, &device).await?;
                run(self.host_session(id).await?).await
            }
            other => other,
        }
    }
    pub async fn host_link_poll(&self, link_id: &str) -> Result<Value> {
        uuid::Uuid::parse_str(link_id).map_err(|_| Error::new(ErrorCode::InvalidInput))?;
        let mut links = self.host_links.lock().await;
        let p = links
            .get_mut(link_id)
            .ok_or_else(|| Error::new(ErrorCode::NotFound))?;
        if p.last_poll.elapsed() < Duration::from_secs(1) {
            return Err(Error::new(ErrorCode::RateLimited));
        }
        p.last_poll = Instant::now();
        let response = p
            .bootstrap
            .call(&format!("/v1/host/links/{link_id}"), None)
            .await?;
        if response["state"] == "approved" {
            let h = VestaHost {
                id: string(&p.bootstrap.discovery, "hostId")?,
                name: p.bootstrap.discovery["name"]
                    .as_str()
                    .unwrap_or(&p.address)
                    .into(),
                fingerprint: p.bootstrap.connection.fingerprint.clone(),
                endpoints: vec![Endpoint::host(&p.address)?.display()],
                device_id: string(&response, "deviceId")?,
                key_reference: p.reference.clone(),
                account_id: p.account.clone(),
                auth_revision: "0".into(),
            };
            let session =
                HostSession::new(h.clone(), p.signer.clone(), Endpoint::host(&p.address)?);
            session.token(None).await?;
            let mut store = self.host_store.lock().await;
            let mut next = store.clone();
            next.hosts.retain(|old| old.id != h.id);
            next.hosts.push(h.clone());
            next.pending_enrollments.retain(|old| old.id != h.id);
            next.save(&self.root)?;
            *store = next;
            drop(store);
            self.host_sessions.lock().await.insert(h.id, session);
            links.remove(link_id);
        }
        Ok(response)
    }
    pub async fn host_remove(&self, app: &AppHandle, id: &str) -> Result<()> {
        let _gate = self.host_gate.lock().await;
        let h = self
            .host_store
            .lock()
            .await
            .hosts
            .iter()
            .find(|h| h.id == id)
            .cloned()
            .ok_or_else(|| Error::new(ErrorCode::NotFound))?;
        self.edit_store(|s| {
            s.connections
                .retain(|r| !r.snapshot.connection.id.starts_with(&format!("{id}:")));
            Ok(())
        })
        .await?;
        let mut store = self.host_store.lock().await;
        let mut next = store.clone();
        next.remove(id);
        next.save(&self.root)?;
        *store = next;
        drop(store);
        self.host_sessions.lock().await.remove(id);
        if let Ok(mut live) = self.live.lock() {
            live.retain(|key, slot| {
                if key.starts_with(&format!("{id}:")) {
                    if let Ok(mut worker) = slot.worker.lock() {
                        if let Some(task) = worker.take() {
                            task.abort();
                        }
                    }
                    false
                } else {
                    true
                }
            });
        }
        let credentials = self.credentials.clone();
        tokio::task::spawn_blocking(move || credentials.delete(&h.key_reference))
            .await
            .map_err(|_| internal())??;
        self.changed(app);
        Ok(())
    }
    pub async fn host_info(&self, app: &AppHandle, id: &str) -> Result<Value> {
        let (info, session) = self
            .host_using(app, id, |session| async move {
                Ok((session.call("GET", "/v1/host", None, None, None).await?, session))
            })
            .await?;
        if info["hostId"] != id || info["fingerprint"] != session.host.fingerprint {
            return Err(Error::new(ErrorCode::FingerprintMismatch));
        }
        let mut store = self.host_store.lock().await;
        let mut next = store.clone();
        if let Some(host) = next.hosts.iter_mut().find(|h| h.id == id) {
            host.auth_revision = string(&info, "authGeneration")?;
            if let Some(name) = info["name"].as_str() {
                host.name = name.into();
            }
        }
        next.save(&self.root)?;
        *store = next;
        Ok(info)
    }
    pub async fn host_servers(&self, app: &AppHandle, id: &str) -> Result<Value> {
        let (response, session) = self
            .host_using(app, id, |session| async move {
                Ok((
                    session
                        .call("GET", "/v1/host/servers", None, None, None)
                        .await?,
                    session,
                ))
            })
            .await?;
        let servers = response["servers"].as_array().ok_or_else(internal)?;
        // Machine servers belong to the account that was signed in when they were listed.
        let account = selected_account();
        for server in servers {
            let server_id = string(server, "serverId")?;
            let target = ServerRef {
                host_id: id.into(),
                server_id: server_id.clone(),
            };
            let connection_id = target.connection_id();
            let host = &session.host;
            let snapshot = ServerSnapshot {
                connection: ServerConnection {
                    id: connection_id.clone(),
                    name: string(server, "name")?,
                    endpoint: host.endpoints[0].clone(),
                    server_id,
                    fingerprint: host.fingerprint.clone(),
                    role: server["role"].as_str().map(str::to_owned),
                    sign_in_method: "host".into(),
                    memory_only: false,
                    pinned: true,
                    added_at_ms: vesta_server_client::now_ms(),
                    last_connected_at_ms: None,
                    auth_revision: Some(host.auth_revision.clone()),
                },
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
                public_lifecycle: None,
            };
            self.edit_store(|s| {
                if !s
                    .connections
                    .iter()
                    .any(|r| r.snapshot.connection.id == connection_id)
                {
                    s.connections.push(Record {
                        snapshot,
                        device_id: host.device_id.clone(),
                        key_reference: host.key_reference.clone(),
                        account_uuid: account.clone(),
                    });
                }
                Ok(())
            })
            .await?;
            let mut store = self.host_store.lock().await;
            let mut next = store.clone();
            if !next.servers.contains(&target) {
                next.servers.push(target);
                next.save(&self.root)?;
                *store = next;
            }
        }
        self.changed(app);
        Ok(response)
    }
}
