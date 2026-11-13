use super::*;
use serde::Serialize;
use vesta_server_client::host::{string, Bootstrap, HostSession, ServerRef, VestaHost};
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
                        if let Ok(mut live) = self.live.lock() {
                            live.retain(|id, slot| {
                                if id.starts_with(&format!("{}:", d.host_id)) {
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
                }
                found.push(d);
                break;
            }
        }
        Ok(found)
    }
    async fn host_account_proof(
        &self,
        app: &AppHandle,
        b: &mut Bootstrap,
        account_uuid: &str,
        signer: &dyn vesta_server_client::auth::DeviceSigner,
        purpose: &str,
    ) -> Result<Value> {
        let account = crate::auth::ensure_account_tokens_valid(app.clone(), account_uuid.into())
            .await
            .map_err(|_| Error::new(ErrorCode::CredentialsRejected))?;
        if !crate::auth::is_previously_authenticated_account(&account) {
            return Err(Error::new(ErrorCode::CredentialsRejected));
        }
        let account_id = uuid::Uuid::parse_str(&account.uuid)
            .map_err(|_| internal())?
            .to_string();
        let profile = account.uuid.replace('-', "");
        let name = account.username.clone();
        let token = zeroize::Zeroizing::new(
            account
                .access_token
                .ok_or_else(|| Error::new(ErrorCode::CredentialsRejected))?,
        );
        b.account_proof(&account_id,&name,signer,purpose,|server_hash|async move {
            let joined=reqwest12::Client::builder().use_rustls_tls().no_proxy().redirect(reqwest12::redirect::Policy::none()).timeout(Duration::from_secs(15)).build().map_err(|_|internal())?
                .post("https://sessionserver.mojang.com/session/minecraft/join").json(&json!({"accessToken":token.as_str(),"selectedProfile":profile,"serverId":server_hash})).send().await.map_err(|_|Error::new(ErrorCode::Unreachable))?;
            if !joined.status().is_success(){return Err(Error::new(ErrorCode::CredentialsRejected));}Ok(())
        }).await
    }
    async fn host_save_enrollment(
        &self,
        b: &Bootstrap,
        address: &str,
        reference: String,
        signer: Arc<dyn vesta_server_client::auth::DeviceSigner>,
        reply: &Value,
    ) -> Result<VestaHost> {
        let id = string(&b.discovery, "hostId")?;
        if reply["hostId"] != id || reply["fingerprint"] != b.connection.fingerprint {
            return Err(Error::new(ErrorCode::FingerprintMismatch));
        }
        let h = VestaHost {
            id: id.clone(),
            name: b.discovery["name"].as_str().unwrap_or(address).into(),
            fingerprint: b.connection.fingerprint.clone(),
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
    pub async fn host_enroll(
        &self,
        app: &AppHandle,
        address: &str,
        code: &str,
        account_uuid: &str,
        device_name: &str,
        link: bool,
    ) -> Result<Value> {
        let _gate = self.host_gate.lock().await;
        let credentials = self.credentials.clone();
        let reference = new_id();
        let r = reference.clone();
        let signer = tokio::task::spawn_blocking(move || credentials.create(&r, false))
            .await
            .map_err(|_| internal())??;
        let mut key_guard = EnrollmentKey {
            credentials: self.credentials.clone(),
            reference: reference.clone(),
            retain: false,
        };
        let mut b = Bootstrap::start(
            address,
            code,
            if link {
                vesta_host_client::Purpose::Link
            } else {
                vesta_host_client::Purpose::Claim
            },
            signer.as_ref(),
        )
        .await?;
        let proof = self
            .host_account_proof(
                app,
                &mut b,
                account_uuid,
                signer.as_ref(),
                if link { "link" } else { "claim" },
            )
            .await?;
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
            self.host_save_enrollment(&b, address, reference, signer, &reply)
                .await?,
        )
        .map_err(|_| internal())?)
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
    pub async fn host_info(&self, id: &str) -> Result<Value> {
        let session = self.host_session(id).await?;
        let info = session.call("GET", "/v1/host", None, None, None).await?;
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
        let session = self.host_session(id).await?;
        let response = session
            .call("GET", "/v1/host/servers", None, None, None)
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
