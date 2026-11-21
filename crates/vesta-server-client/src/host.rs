//! Host identity transport. Bootstrap owns one TLS 1.3 connection throughout PAKE/account proof.
use crate::{auth::DeviceSigner, endpoint::Endpoint, Error, ErrorCode, Result};
use hyper::{body::HttpBody, Body, Request};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{Arc, Mutex as StdMutex},
    time::Duration,
};
use tokio::sync::Mutex;
use zeroize::Zeroizing;
fn invalid() -> Error {
    Error::new(ErrorCode::Unsupported)
}
fn network(_: impl std::fmt::Display) -> Error {
    Error::new(ErrorCode::Unreachable)
}
/// A closed code plus a bounded reason, so the UI can tell causes apart.
pub fn reasoned(code: ErrorCode, reason: &str) -> Error {
    let mut error = Error::new(code);
    error.reason = Some(reason.to_owned());
    error
}
/// The PAKE token is valid for 10 minutes; leave room for account proof and claim.
const PAKE_REUSE: Duration = Duration::from_secs(9 * 60);
pub fn string(v: &Value, key: &str) -> Result<String> {
    v[key].as_str().map(str::to_owned).ok_or_else(invalid)
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VestaHost {
    pub id: String,
    pub name: String,
    pub fingerprint: String,
    pub endpoints: Vec<String>,
    pub device_id: String,
    pub key_reference: String,
    pub account_id: String,
    pub auth_revision: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServerRef {
    pub host_id: String,
    pub server_id: String,
}
impl ServerRef {
    pub fn connection_id(&self) -> String {
        format!("{}:{}", self.host_id, self.server_id)
    }
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostStore {
    pub hosts: Vec<VestaHost>,
    pub servers: Vec<ServerRef>,
    #[serde(default)]
    pub pending_enrollments: Vec<VestaHost>,
}
impl HostStore {
    pub fn load(root: &Path) -> Result<Self> {
        let path = root.join("hosts-v1.json");
        if !path.exists() {
            return Ok(Self::default());
        }
        serde_json::from_slice(&std::fs::read(path).map_err(network)?).map_err(|_| invalid())
    }
    pub fn save(&self, root: &Path) -> Result<()> {
        std::fs::create_dir_all(root).map_err(network)?;
        let mut file = tempfile::NamedTempFile::new_in(root).map_err(network)?;
        use std::io::Write;
        file.write_all(&serde_json::to_vec(self).map_err(|_| invalid())?)
            .map_err(network)?;
        file.as_file().sync_all().map_err(network)?;
        file.persist(root.join("hosts-v1.json")).map_err(network)?;
        Ok(())
    }
    pub fn remove(&mut self, id: &str) {
        self.hosts.retain(|h| h.id != id);
        self.pending_enrollments.retain(|h| h.id != id);
        self.servers.retain(|s| s.host_id != id);
    }
}
/// This sender cannot reconnect: losing bootstrap TCP invalidates the PAKE capability.
pub struct Connection {
    sender: hyper::client::conn::SendRequest<Body>,
    pub fingerprint: String,
    pub exporter: [u8; 32],
    authority: String,
    bootstrap: bool,
}
impl Connection {
    /// False once the peer closed the connection (host restart, network loss). Never blocks long.
    pub async fn alive(&mut self) -> bool {
        matches!(
            tokio::time::timeout(
                Duration::from_millis(50),
                std::future::poll_fn(|cx| self.sender.poll_ready(cx))
            )
            .await,
            Ok(Ok(()))
        )
    }
    pub async fn open(endpoint: &Endpoint, pin: Option<String>) -> Result<Self> {
        let observed = Arc::new(StdMutex::new(None));
        // TLS 1.3 only for every host connection; never resume bootstrap.
        let mut config = rustls::ClientConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(network)?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(crate::trust::PinVerifier::new(
            pin.clone(),
            observed.clone(),
        )))
        .with_no_client_auth();
        config.resumption = rustls::client::Resumption::disabled();
        config.enable_early_data = false;
        let host = endpoint
            .url()
            .host_str()
            .ok_or_else(invalid)?
            .trim_matches(['[', ']'])
            .to_owned();
        let port = endpoint.url().port_or_known_default().ok_or_else(invalid)?;
        let tcp = tokio::time::timeout(
            Duration::from_secs(5),
            tokio::net::TcpStream::connect((host.as_str(), port)),
        )
        .await
        .map_err(network)?
        .map_err(network)?;
        let name = rustls::pki_types::ServerName::try_from(host.clone()).map_err(network)?;
        let tls = tokio::time::timeout(
            Duration::from_secs(10),
            tokio_rustls::TlsConnector::from(Arc::new(config)).connect(name, tcp),
        )
        .await
        .map_err(network)?
        .map_err(|_| {
            if observed
                .lock()
                .ok()
                .and_then(|v| v.clone())
                .zip(pin.as_ref())
                .is_some_and(|(actual, expected)| &actual != expected)
            {
                Error::new(ErrorCode::FingerprintMismatch)
            } else {
                Error::new(ErrorCode::TlsFailed)
            }
        })?;
        let exporter = tls
            .get_ref()
            .1
            .export_keying_material([0u8; 32], vesta_host_client::EXPORTER_LABEL, Some(b""))
            .map_err(network)?;
        let fingerprint = observed
            .lock()
            .map_err(|_| invalid())?
            .clone()
            .ok_or_else(invalid)?;
        let (sender, connection) = hyper::client::conn::handshake(tls).await.map_err(network)?;
        tokio::spawn(async move {
            let _ = connection.await;
        });
        Ok(Self {
            sender,
            fingerprint,
            exporter,
            authority: format!("{}:{port}", endpoint.url().host().ok_or_else(invalid)?),
            bootstrap: pin.is_none(),
        })
    }
    pub async fn call(
        &mut self,
        method: &str,
        path: &str,
        authorization: Option<&str>,
        body: Option<Value>,
        revision: Option<&str>,
        key: Option<&str>,
    ) -> Result<Value> {
        if !path.starts_with("/v1/host") || path.contains(['\r', '\n', '#']) || path.contains("..")
        {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        if self.bootstrap
            && !matches!(
                path,
                "/v1/host/discovery"
                    | "/v1/host/pake/start"
                    | "/v1/host/pake/finish"
                    | "/v1/host/accounts/challenge"
                    | "/v1/host/accounts/complete"
                    | "/v1/host/claim"
                    | "/v1/host/sign-in"
                    | "/v1/host/links"
            )
            && !path.starts_with("/v1/host/links/")
        {
            return Err(Error::new(ErrorCode::TlsFailed));
        }
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header("Host", &self.authority)
            .header("Content-Type", "application/json");
        if let Some(auth) = authorization {
            request = request.header("Authorization", auth);
        }
        if let Some(rev) = revision {
            request = request.header("If-Match", rev);
        }
        if method != "GET" {
            request = request.header(
                "Idempotency-Key",
                key.map(str::to_owned)
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            );
        }
        let request = request
            .body(Body::from(
                body.map(|v| serde_json::to_vec(&v).unwrap())
                    .unwrap_or_default(),
            ))
            .map_err(network)?;
        tokio::time::timeout(Duration::from_secs(60), async {
            let mut response = self.sender.send_request(request).await.map_err(network)?;
            let status = response.status().as_u16();
            let retry = response
                .headers()
                .get("retry-after")
                .and_then(|h| h.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .map(|n| n.saturating_mul(1000));
            let mut bytes = Vec::new();
            while let Some(chunk) = response.body_mut().data().await {
                let chunk = chunk.map_err(network)?;
                if bytes.len() + chunk.len() > 1024 * 1024 {
                    return Err(invalid());
                }
                bytes.extend_from_slice(&chunk);
            }
            let v: Value = if bytes.is_empty() {
                Value::Null
            } else {
                serde_json::from_slice(&bytes).map_err(|_| invalid())?
            };
            if !(200..300).contains(&status) {
                return Err(Error::wire(
                    status,
                    v.pointer("/error/code")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                    retry,
                ));
            }
            Ok(v)
        })
        .await
        .map_err(network)?
    }
}
struct Session {
    token: Zeroizing<String>,
    expires: i64,
}
pub struct HostSession {
    pub host: VestaHost,
    pub signer: Arc<dyn DeviceSigner>,
    session: Mutex<Option<Session>>,
    pub endpoint: Endpoint,
    endpoints: std::sync::RwLock<Vec<String>>,
}
impl HostSession {
    pub fn new(host: VestaHost, signer: Arc<dyn DeviceSigner>, endpoint: Endpoint) -> Arc<Self> {
        Arc::new(Self {
            endpoints: std::sync::RwLock::new(host.endpoints.clone()),
            host,
            signer,
            session: Mutex::new(None),
            endpoint,
        })
    }
    pub fn endpoints(&self) -> Vec<String> {
        self.endpoints.read().map(|e| e.clone()).unwrap_or_default()
    }
    pub fn update_endpoints(&self, endpoints: Vec<String>) {
        if let Ok(mut e) = self.endpoints.write() {
            *e = endpoints;
        }
    }
    pub async fn install(&self, value: &Value) -> Result<()> {
        *self.session.lock().await = Some(self.decode_session(value)?);
        Ok(())
    }
    fn decode_session(&self, v: &Value) -> Result<Session> {
        if v["hostId"] != self.host.id
            || v["deviceId"] != self.host.device_id
            || v["accountId"] != self.host.account_id
        {
            return Err(Error::new(ErrorCode::CredentialsRejected));
        }
        let expires = chrono::DateTime::parse_from_rfc3339(&string(v, "expiresAt")?)
            .map_err(|_| invalid())?
            .timestamp_millis();
        if expires <= crate::now_ms() {
            return Err(Error::new(ErrorCode::CredentialsRejected));
        }
        Ok(Session {
            token: Zeroizing::new(string(v, "session")?),
            expires,
        })
    }
    pub async fn connect(&self) -> Result<Connection> {
        let mut last = Error::new(ErrorCode::Unreachable);
        for address in &self.endpoints() {
            match Connection::open(
                &Endpoint::host(address)?,
                Some(self.host.fingerprint.clone()),
            )
            .await
            {
                Ok(c) => return Ok(c),
                Err(e) => last = e,
            }
        }
        Err(last)
    }
    pub async fn token(&self, rejected: Option<&str>) -> Result<Zeroizing<String>> {
        // Hold across renewal: all server clients sharing this host join one proof.
        let mut session = self.session.lock().await;
        if let Some(s) = session.as_ref() {
            if s.expires > crate::now_ms() + 120_000 && rejected != Some(s.token.as_str()) {
                return Ok(s.token.clone());
            }
        }
        let mut c = self.connect().await?;
        // The host answers an unknown or revoked device with the same 401; either way this
        // key can no longer sign in and the account has to enroll a new one.
        let revoked = |e: Error| {
            if e.code == ErrorCode::CredentialsRejected {
                reasoned(ErrorCode::CredentialsRejected, "device_revoked")
            } else {
                e
            }
        };
        let challenge = c
            .call(
                "POST",
                "/v1/host/sessions/challenge",
                None,
                Some(json!({"deviceId":self.host.device_id})),
                None,
                None,
            )
            .await
            .map_err(revoked)?;
        let signature=self.signer.sign(&vesta_host_client::requests::signing_bytes("vesta.host.session.v1",&json!({"hostId":self.host.id,"deviceId":self.host.device_id,"challengeId":challenge["challengeId"],"nonce":challenge["nonce"],"expiresAt":challenge["expiresAt"]}))).await?;
        let response=c.call("POST","/v1/host/sessions",None,Some(json!({"deviceId":self.host.device_id,"challengeId":challenge["challengeId"],"signature":signature})),None,None).await.map_err(revoked)?;
        let renewed = self.decode_session(&response)?;
        let token = renewed.token.clone();
        *session = Some(renewed);
        Ok(token)
    }
    pub async fn call(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
        revision: Option<&str>,
        key: Option<&str>,
    ) -> Result<Value> {
        let key = key
            .map(str::to_owned)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let key = Some(key.as_str());
        let token = self.token(None).await?;
        let result = self
            .connect()
            .await?
            .call(
                method,
                path,
                Some(&format!("Bearer {}", token.as_str())),
                body.clone(),
                revision,
                key,
            )
            .await;
        if result
            .as_ref()
            .is_err_and(|e| e.code == ErrorCode::CredentialsRejected)
        {
            let token = self.token(Some(&token)).await?;
            return self
                .connect()
                .await?
                .call(
                    method,
                    path,
                    Some(&format!("Bearer {}", token.as_str())),
                    body,
                    revision,
                    key,
                )
                .await;
        }
        result
    }
}
pub struct Bootstrap {
    pub connection: Connection,
    pub discovery: Value,
    pub token: Zeroizing<String>,
    pub exchange_id: String,
    pub link_id: Option<String>,
    proven_at: std::time::Instant,
}
impl Bootstrap {
    /// The PAKE capability lives only on this connection and for a bounded time.
    pub async fn usable(&mut self) -> bool {
        self.proven_at.elapsed() < PAKE_REUSE && self.connection.alive().await
    }
    pub async fn start(
        address: &str,
        code: &str,
        purpose: vesta_host_client::Purpose,
        signer: &dyn DeviceSigner,
    ) -> Result<Self> {
        let mut connection = Connection::open(&Endpoint::host(address)?, None).await?;
        let discovery = connection
            .call("GET", "/v1/host/discovery", None, None, None, None)
            .await?;
        // LAN discovery reports claim state on purpose; a claim would only fail uniformly.
        if purpose == vesta_host_client::Purpose::Claim && discovery["claimState"] == "claimed" {
            return Err(reasoned(ErrorCode::Conflict, "host_already_claimed"));
        }
        let code = vesta_host_client::SetupCode::parse(code)
            .map_err(|_| Error::new(ErrorCode::InvalidInput))?;
        let public =
            vesta_host_client::decode::<32>(&signer.public_key()).map_err(|_| invalid())?;
        let (client, start) = vesta_host_client::Client::start(
            &code,
            purpose,
            None,
            string(&discovery, "hostId")?,
            public,
        );
        let started = connection
            .call(
                "POST",
                "/v1/host/pake/start",
                None,
                Some(serde_json::to_value(start).unwrap()),
                None,
                None,
            )
            .await?;
        let started: vesta_host_client::Started =
            serde_json::from_value(started).map_err(|_| invalid())?;
        let exchange_id = started.exchange_id.clone();
        let link_id = started.link_id.clone();
        let (confirmation, finish) = client
            .finish(&started, &connection.fingerprint, &connection.exporter)
            .map_err(|_| reasoned(ErrorCode::CredentialsRejected, "pairing_failed"))?;
        let finished = connection
            .call(
                "POST",
                "/v1/host/pake/finish",
                None,
                Some(serde_json::to_value(finish).unwrap()),
                None,
                None,
            )
            .await?;
        let token = confirmation
            .verify(serde_json::from_value(finished).map_err(|_| invalid())?)
            .map_err(|_| reasoned(ErrorCode::CredentialsRejected, "pairing_failed"))?;
        Ok(Self {
            connection,
            discovery,
            token: Zeroizing::new(token),
            exchange_id,
            link_id,
            proven_at: std::time::Instant::now(),
        })
    }
    pub async fn call(&mut self, path: &str, body: Option<Value>) -> Result<Value> {
        self.connection
            .call(
                if body.is_some() { "POST" } else { "GET" },
                path,
                Some(&format!("Pake {}", self.token.as_str())),
                body,
                None,
                None,
            )
            .await
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn host_store_roundtrip_remove_and_no_sessions() {
        let root = tempfile::tempdir().unwrap();
        let mut store = HostStore::default();
        store.hosts.push(VestaHost {
            id: "host".into(),
            name: "test".into(),
            fingerprint: "ab".repeat(32),
            endpoints: vec!["localhost:25500".into()],
            device_id: "device".into(),
            key_reference: "vault-reference".into(),
            account_id: "account".into(),
            auth_revision: "1".into(),
        });
        store.servers.push(ServerRef {
            host_id: "host".into(),
            server_id: "server".into(),
        });
        store.save(root.path()).unwrap();
        let mut loaded = HostStore::load(root.path()).unwrap();
        assert_eq!(loaded.hosts.len(), 1);
        assert_eq!(loaded.servers, store.servers);
        let bytes = std::fs::read_to_string(root.path().join("hosts-v1.json")).unwrap();
        assert!(!bytes.contains("session"));
        loaded.remove("host");
        loaded.save(root.path()).unwrap();
        assert!(HostStore::load(root.path()).unwrap().servers.is_empty());
        std::fs::write(root.path().join("hosts-v1.json"), b"broken").unwrap();
        assert!(HostStore::load(root.path()).is_err());
    }
    #[test]
    fn target_routes_retain_server_scope_and_queries() {
        let id = "11111111-1111-4111-8111-111111111111";
        let e = Endpoint::host("[::1]").unwrap().for_server(id).unwrap();
        assert_eq!(e.display(), "[::1]:25500");
        for suffix in [
            "manage/files/download?path=world%2Flevel.dat",
            "manage/console/stream",
            "manage/metrics/stream",
            "status",
        ] {
            assert_eq!(
                e.route(&format!("/api/v3/{suffix}")).unwrap().path(),
                format!("/v1/servers/{id}/{}", suffix.split('?').next().unwrap())
            );
        }
        assert!(e.route("/api/v3/auth/session").is_err());
        assert!(e.route("/api/v3/manage/../auth").is_err());
        assert!(e.for_server("a/b").is_err());
        for bad in [
            "http://host",
            "host/path",
            "user@host",
            "host?x=1",
            "host:0",
        ] {
            assert!(Endpoint::host(bad).is_err(), "{bad}");
        }
    }
    #[tokio::test]
    async fn concurrent_session_renewal_and_rejected_token_coalesce() {
        use hyper::{service::service_fn, Response};
        use std::sync::atomic::{AtomicUsize, Ordering};
        let cert = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let pin = crate::trust::leaf_fingerprint(cert.cert.der());
        let tls = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_protocol_versions(&[&rustls::version::TLS13])
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![cert.cert.der().clone()],
            rustls::pki_types::PrivatePkcs8KeyDer::from(cert.key_pair.serialize_der()).into(),
        )
        .unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(tls));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let renewals = Arc::new(AtomicUsize::new(0));
        let count = renewals.clone();
        let task = tokio::spawn(async move {
            loop {
                let (tcp, _) = listener.accept().await.unwrap();
                let acceptor = acceptor.clone();
                let count = count.clone();
                tokio::spawn(async move {
                    if let Ok(tls) = acceptor.accept(tcp).await {
                        let _=hyper::server::conn::Http::new().serve_connection(tls,service_fn(move|req:Request<Body>|{
                let value=if req.uri().path().starts_with("/v1/servers/") {
                assert_eq!(req.uri().path(),"/v1/servers/11111111-1111-4111-8111-111111111111/manage/server/status");
                assert_eq!(req.headers()["authorization"],"Bearer token-1");
                json!({"api_version":"3","data":{"managed":true}})
            } else if req.uri().path().ends_with("challenge"){json!({"challengeId":"challenge","nonce":"nonce","expiresAt":(chrono::Utc::now()+chrono::Duration::seconds(60)).to_rfc3339()})}else{let n=count.fetch_add(1,Ordering::SeqCst);json!({"hostId":"host","deviceId":"device","accountId":"account","session":format!("token-{n}"),"expiresAt":(chrono::Utc::now()+chrono::Duration::minutes(15)).to_rfc3339()})};
                async move{Ok::<_,std::convert::Infallible>(Response::new(Body::from(value.to_string())))}
            })).await;
                    }
                });
            }
        });
        let endpoint = Endpoint::host(&address.to_string()).unwrap();
        let host = VestaHost {
            id: "host".into(),
            name: "fixture".into(),
            fingerprint: pin,
            endpoints: vec!["127.0.0.1:1".into(), address.to_string()],
            device_id: "device".into(),
            account_id: "account".into(),
            key_reference: "key".into(),
            auth_revision: "1".into(),
        };
        let session = HostSession::new(
            host,
            Arc::new(crate::auth::Ed25519Signer::from_seed([1; 32])),
            endpoint,
        );
        let mut tasks = Vec::new();
        for _ in 0..16 {
            let session = session.clone();
            tasks.push(tokio::spawn(
                async move { session.token(None).await.unwrap() },
            ));
        }
        for t in tasks {
            assert_eq!(t.await.unwrap().as_str(), "token-0");
        }
        assert_eq!(renewals.load(Ordering::SeqCst), 1);
        let mut tasks = Vec::new();
        for _ in 0..16 {
            let session = session.clone();
            tasks.push(tokio::spawn(async move {
                session.token(Some("token-0")).await.unwrap()
            }));
        }
        for t in tasks {
            assert_eq!(t.await.unwrap().as_str(), "token-1");
        }
        assert_eq!(renewals.load(Ordering::SeqCst), 2);
        assert!(session.install(&json!({"hostId":"wrong"})).await.is_err());
        let transport = crate::transport::Transport::for_host(
            Endpoint::host("127.0.0.1:1")
                .unwrap()
                .for_server("11111111-1111-4111-8111-111111111111")
                .unwrap(),
            session.clone(),
        )
        .unwrap();
        let client = crate::Client::for_host(
            transport,
            "11111111-1111-4111-8111-111111111111".into(),
            session.clone(),
        );
        assert_eq!(
            client.get("server/status", true, "").await.unwrap()["managed"],
            true
        );
        task.abort();
    }
}
impl Bootstrap {
    pub async fn account_proof<F, Fut>(
        &mut self,
        account_id: &str,
        name: &str,
        signer: &dyn DeviceSigner,
        purpose: &str,
        join: F,
    ) -> Result<Value>
    where
        F: FnOnce(String) -> Fut,
        Fut: std::future::Future<Output = Result<()>>,
    {
        let host = string(&self.discovery, "hostId")?;
        let auth = format!("Pake {}", self.token.as_str());
        let binding = self.exchange_id.clone();
        prove_account(
            &mut self.connection,
            Some(&auth),
            &host,
            &binding,
            AccountRequest {
                account_id,
                name,
                purpose,
            },
            signer,
            join,
        )
        .await
    }
    pub async fn claim(
        &mut self,
        proof: &Value,
        device_name: &str,
        signer: &dyn DeviceSigner,
    ) -> Result<Value> {
        let signature=signer.sign(&vesta_host_client::requests::signing_bytes("vesta.host.claim.v1",&json!({"hostId":self.discovery["hostId"],"exchangeId":self.exchange_id,"accountProofId":proof["accountProofId"],"deviceKey":signer.public_key(),"deviceName":device_name}))).await?;
        self.call("/v1/host/claim",Some(json!({"exchangeId":self.exchange_id,"accountProofId":proof["accountProofId"],"deviceName":device_name,"signature":signature}))).await
    }
}
pub struct AccountRequest<'a> {
    pub account_id: &'a str,
    pub name: &'a str,
    pub purpose: &'a str,
}
/// The Mojang serverId to join, only when it is the one an honest host would issue for
/// values this launcher chose or observed itself. Otherwise a relaying host could spend
/// the join on another machine, so the join must not happen at all.
pub fn checked_server_hash(
    challenge: &Value,
    host_id: &str,
    device_key: &str,
    purpose: &str,
    binding: &str,
    account_id: &str,
) -> Result<String> {
    let server_hash = string(challenge, "serverHash")?;
    let nonce = string(challenge, "nonce")
        .map_err(|_| reasoned(ErrorCode::FingerprintMismatch, "server_hash_mismatch"))?;
    let expected = vesta_host_client::requests::account_server_hash(
        host_id, device_key, purpose, binding, account_id, &nonce,
    );
    if expected != server_hash {
        return Err(reasoned(
            ErrorCode::FingerprintMismatch,
            "server_hash_mismatch",
        ));
    }
    Ok(server_hash)
}
async fn prove_account<F, Fut>(
    connection: &mut Connection,
    auth: Option<&str>,
    host_id: &str,
    binding: &str,
    request: AccountRequest<'_>,
    signer: &dyn DeviceSigner,
    join: F,
) -> Result<Value>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<()>>,
{
    let AccountRequest {
        account_id,
        name,
        purpose,
    } = request;
    let key = signer.public_key();
    let challenge = connection
        .call(
            "POST",
            "/v1/host/accounts/challenge",
            auth,
            Some(json!({"accountId":account_id,"name":name,"deviceKey":key,"purpose":purpose,"binding":binding})),
            None,
            None,
        )
        .await?;
    let server_hash = checked_server_hash(&challenge, host_id, &key, purpose, binding, account_id)?;
    join(server_hash.clone()).await?;
    let signature=signer.sign(&vesta_host_client::requests::signing_bytes("vesta.host.account.v1",&json!({"hostId":host_id,"deviceKey":key,"challengeId":challenge["challengeId"],"serverHash":server_hash,"purpose":purpose,"binding":binding}))).await?;
    // The host answers a profile the provider didn't confirm with the uniform pairing
    // failure. The capability (PAKE or the pinned connection) was just accepted, so name it.
    connection
        .call(
            "POST",
            "/v1/host/accounts/complete",
            auth,
            Some(json!({"challengeId":challenge["challengeId"],"signature":signature})),
            None,
            None,
        )
        .await
        .map_err(|e| {
            if e.reason.as_deref() == Some("pairing_failed") {
                reasoned(ErrorCode::CredentialsRejected, "account_proof_failed")
            } else {
                e
            }
        })
}
/// The name the host lists for this device, in the host's sanitised form: control,
/// zero width and bidi characters removed, whitespace collapsed, at most 64 characters.
pub fn device_name(raw: &str) -> Option<String> {
    let hidden = |c: char| {
        c.is_control()
            || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{061C}' | '\u{FEFF}')
    };
    let cleaned: String = raw.chars().take(256).filter(|c| !hidden(*c)).collect();
    let name: String = cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(64)
        .collect();
    let name = name.trim().to_owned();
    (!name.is_empty()).then_some(name)
}
/// Sign in on a new device with no code: one connection carries discovery, a fresh
/// account proof bound to the observed certificate, and enrollment of a new device key.
pub struct AccountSignIn {
    pub connection: Connection,
    pub discovery: Value,
    pub host_id: String,
}
impl AccountSignIn {
    /// `pin` is a fingerprint this launcher already trusts for the machine; without one
    /// the observed certificate is trusted on first use. `expected_host` is the machine the
    /// person picked; a different one answering is an identity change, never a re-pin.
    pub async fn open(
        address: &str,
        pin: Option<String>,
        expected_host: Option<&str>,
    ) -> Result<Self> {
        let mut connection = Connection::open(&Endpoint::host(address)?, pin).await?;
        let discovery = connection
            .call("GET", "/v1/host/discovery", None, None, None, None)
            .await?;
        if discovery["fingerprint"] != connection.fingerprint || discovery["protocol"] != "host-v1"
        {
            return Err(Error::new(ErrorCode::FingerprintMismatch));
        }
        let host_id = string(&discovery, "hostId")?;
        if expected_host.is_some_and(|expected| expected != host_id) {
            return Err(reasoned(
                ErrorCode::FingerprintMismatch,
                "host_identity_changed",
            ));
        }
        Ok(Self {
            connection,
            discovery,
            host_id,
        })
    }
    pub async fn account_proof<F, Fut>(
        &mut self,
        account_id: &str,
        name: &str,
        signer: &dyn DeviceSigner,
        join: F,
    ) -> Result<Value>
    where
        F: FnOnce(String) -> Fut,
        Fut: std::future::Future<Output = Result<()>>,
    {
        let binding = self.connection.fingerprint.clone();
        prove_account(
            &mut self.connection,
            None,
            &self.host_id,
            &binding,
            AccountRequest {
                account_id,
                name,
                purpose: "signin",
            },
            signer,
            join,
        )
        .await
    }
    /// Enrolls the device key. 403 `account_has_no_access` and `device_approval_required`
    /// keep their reasons so the launcher can explain each one.
    pub async fn enroll(
        &mut self,
        proof: &Value,
        device_name: &str,
        signer: &dyn DeviceSigner,
    ) -> Result<Value> {
        let key = signer.public_key();
        let signature=signer.sign(&vesta_host_client::requests::signing_bytes("vesta.host.signin.v1",&json!({"hostId":self.host_id,"fingerprint":self.connection.fingerprint,"accountProofId":proof["accountProofId"],"deviceKey":key,"deviceName":device_name}))).await?;
        let reply = self
            .connection
            .call(
                "POST",
                "/v1/host/sign-in",
                None,
                Some(json!({"accountProofId":proof["accountProofId"],"deviceKey":key,"deviceName":device_name,"signature":signature})),
                None,
                None,
            )
            .await
            .map_err(|e| {
                if e.reason.as_deref() == Some("pairing_failed") {
                    reasoned(ErrorCode::CredentialsRejected, "account_proof_failed")
                } else {
                    e
                }
            })?;
        if reply["state"] != "enrolled"
            || reply["hostId"] != self.host_id
            || reply["fingerprint"] != self.connection.fingerprint
            || reply["accountId"] != proof["accountId"]
        {
            return Err(Error::new(ErrorCode::FingerprintMismatch));
        }
        Ok(reply)
    }
}
#[cfg(test)]
mod sign_in_tests {
    use super::*;
    use crate::auth::DeviceSigner;
    use hyper::{service::service_fn, Response};
    use std::sync::atomic::{AtomicUsize, Ordering};

    const ACCOUNT: &str = "11111111-2222-4333-8444-555555555555";

    #[derive(Clone, Copy, PartialEq)]
    enum Behaviour {
        Honest,
        WrongHash,
        NoAccess,
        Approval,
    }

    /// A host that answers the sign-in routes; returns its address, pin and route hit counts.
    async fn host(
        behaviour: Behaviour,
        nonce: String,
    ) -> (String, String, Arc<StdMutex<Vec<String>>>) {
        let cert = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let pin = crate::trust::leaf_fingerprint(cert.cert.der());
        let tls = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_protocol_versions(&[&rustls::version::TLS13])
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![cert.cert.der().clone()],
            rustls::pki_types::PrivatePkcs8KeyDer::from(cert.key_pair.serialize_der()).into(),
        )
        .unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(tls));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap().to_string();
        let routes = Arc::new(StdMutex::new(Vec::new()));
        let (seen, fp) = (routes.clone(), pin.clone());
        tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let tls = acceptor.accept(tcp).await.unwrap();
            let challenge: Arc<StdMutex<Value>> = Arc::default();
            let _ = hyper::server::conn::Http::new()
                .serve_connection(
                    tls,
                    service_fn(move |req: Request<Body>| {
                        let (seen, fp, challenge) = (seen.clone(), fp.clone(), challenge.clone());
                        let nonce = nonce.clone();
                        async move {
                            let path = req.uri().path().to_owned();
                            seen.lock().unwrap().push(path.clone());
                            let body: Value = serde_json::from_slice(
                                &hyper::body::to_bytes(req.into_body()).await.unwrap(),
                            )
                            .unwrap_or(Value::Null);
                            let (status, value) = match path.as_str() {
                                "/v1/host/discovery" => (200, json!({"hostId":"host","fingerprint":fp,"protocol":"host-v1","name":"attic-pc"})),
                                "/v1/host/accounts/challenge" => {
                                    let hash = vesta_host_client::requests::account_server_hash(
                                        "host",
                                        body["deviceKey"].as_str().unwrap(),
                                        body["purpose"].as_str().unwrap(),
                                        body["binding"].as_str().unwrap(),
                                        body["accountId"].as_str().unwrap(),
                                        &nonce,
                                    );
                                    let hash = if behaviour == Behaviour::WrongHash { "0".repeat(40) } else { hash };
                                    *challenge.lock().unwrap() = body.clone();
                                    (200, json!({"challengeId":"c1","serverHash":hash,"nonce":nonce,"expiresAt":"2099-01-01T00:00:00Z"}))
                                }
                                "/v1/host/accounts/complete" => (200, json!({"accountProofId":"p1","accountId":ACCOUNT,"expiresAt":"2099-01-01T00:00:00Z"})),
                                "/v1/host/sign-in" => match behaviour {
                                    Behaviour::NoAccess => (403, json!({"error":{"code":"account_has_no_access"}})),
                                    Behaviour::Approval => (403, json!({"error":{"code":"device_approval_required"}})),
                                    _ => {
                                        assert_eq!(body["deviceName"], "Attic PC");
                                        assert_eq!(body["deviceKey"], challenge.lock().unwrap()["deviceKey"]);
                                        (200, json!({"state":"enrolled","hostId":"host","fingerprint":fp,"accountId":ACCOUNT,"deviceId":"d1","deviceName":"Attic PC","session":"s","expiresAt":(chrono::Utc::now()+chrono::Duration::minutes(15)).to_rfc3339(),"authGeneration":"2"}))
                                    }
                                },
                                _ => (404, json!({"error":{"code":"not_found"}})),
                            };
                            let mut response = Response::new(Body::from(value.to_string()));
                            *response.status_mut() = hyper::StatusCode::from_u16(status).unwrap();
                            Ok::<_, std::convert::Infallible>(response)
                        }
                    }),
                )
                .await;
        });
        (address, pin, routes)
    }

    async fn run(behaviour: Behaviour) -> (Result<Value>, usize, Vec<String>) {
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let (address, _, routes) = host(behaviour, nonce.clone()).await;
        let signer = crate::auth::Ed25519Signer::from_seed([7; 32]);
        let joins = Arc::new(AtomicUsize::new(0));
        let mut sign_in = AccountSignIn::open(&address, None, Some("host"))
            .await
            .unwrap();
        let fingerprint = sign_in.connection.fingerprint.clone();
        let counted = joins.clone();
        let key = signer.public_key();
        let result = async {
            let proof = sign_in
                .account_proof(ACCOUNT, "Steve", &signer, move |hash| async move {
                    assert_eq!(
                        hash,
                        vesta_host_client::requests::account_server_hash(
                            "host",
                            &key,
                            "signin",
                            &fingerprint,
                            ACCOUNT,
                            &nonce
                        )
                    );
                    counted.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                })
                .await?;
            sign_in.enroll(&proof, "Attic PC", &signer).await
        }
        .await;
        let routes = routes.lock().unwrap().clone();
        (result, joins.load(Ordering::SeqCst), routes)
    }

    #[tokio::test]
    async fn signs_in_on_one_pinned_connection_and_joins_once() {
        let (result, joins, routes) = run(Behaviour::Honest).await;
        let reply = result.unwrap();
        assert_eq!(reply["deviceId"], "d1");
        assert_eq!(joins, 1);
        assert_eq!(
            routes,
            [
                "/v1/host/discovery",
                "/v1/host/accounts/challenge",
                "/v1/host/accounts/complete",
                "/v1/host/sign-in"
            ]
        );
    }

    #[tokio::test]
    async fn a_server_hash_that_does_not_match_stops_before_the_join() {
        let (result, joins, routes) = run(Behaviour::WrongHash).await;
        let error = result.unwrap_err();
        assert_eq!(error.code, ErrorCode::FingerprintMismatch);
        assert_eq!(error.reason.as_deref(), Some("server_hash_mismatch"));
        assert_eq!(joins, 0);
        assert!(!routes.iter().any(|r| r.ends_with("complete")));
    }

    #[tokio::test]
    async fn no_access_and_approval_keep_their_reasons() {
        for (behaviour, reason) in [
            (Behaviour::NoAccess, "account_has_no_access"),
            (Behaviour::Approval, "device_approval_required"),
        ] {
            let error = run(behaviour).await.0.unwrap_err();
            assert_eq!(error.code, ErrorCode::Forbidden);
            assert_eq!(error.reason.as_deref(), Some(reason));
        }
    }

    #[tokio::test]
    async fn another_machine_at_the_address_is_an_identity_change() {
        let (address, _, _) =
            host(Behaviour::Honest, uuid::Uuid::new_v4().simple().to_string()).await;
        let error = AccountSignIn::open(&address, None, Some("other"))
            .await
            .err()
            .unwrap();
        assert_eq!(error.reason.as_deref(), Some("host_identity_changed"));
        let (address, _, _) =
            host(Behaviour::Honest, uuid::Uuid::new_v4().simple().to_string()).await;
        let error = AccountSignIn::open(&address, Some("ab".repeat(32)), None)
            .await
            .err()
            .unwrap();
        assert_eq!(error.code, ErrorCode::FingerprintMismatch);
    }

    #[test]
    fn hash_check_needs_the_nonce_and_exact_values() {
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let good =
            vesta_host_client::requests::account_server_hash("h", "k", "signin", "f", "a", &nonce);
        let challenge = json!({"serverHash":good,"nonce":nonce});
        assert_eq!(
            checked_server_hash(&challenge, "h", "k", "signin", "f", "a").unwrap(),
            good
        );
        assert!(checked_server_hash(&challenge, "h", "k", "signin", "other", "a").is_err());
        assert!(checked_server_hash(&challenge, "h", "k2", "signin", "f", "a").is_err());
        assert!(
            checked_server_hash(&json!({"serverHash":good}), "h", "k", "signin", "f", "a").is_err()
        );
    }

    #[test]
    fn device_names_follow_the_host_rules() {
        assert_eq!(device_name("  ATTIC-PC  ").as_deref(), Some("ATTIC-PC"));
        assert_eq!(
            device_name("Rae's\u{202E}  \tlaptop\u{200B}\n").as_deref(),
            Some("Rae's laptop")
        );
        assert_eq!(device_name(&"x".repeat(300)).unwrap().chars().count(), 64);
        assert_eq!(device_name("\u{200B}\u{0007} "), None);
    }
}
