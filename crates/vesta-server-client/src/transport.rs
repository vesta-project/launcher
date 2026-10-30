use crate::{
    endpoint::Endpoint,
    scheduler::{RequestPriority, Scheduler},
    trust, Error, ErrorCode, Result,
};
use futures_util::{
    future::{BoxFuture, Shared},
    FutureExt,
};
use reqwest::{Method, StatusCode};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

// Closed method/path allowlist: the legacy interactive flag cannot promote reads
// or unrelated mutations. Aliases, query strings and future routes stay ordinary.
fn request_priority(method: &Method, path: &str, interactive: bool) -> RequestPriority {
    if *method == Method::POST
        && matches!(
            path,
            "/api/v3/manage/lifecycle/sleep"
                | "/api/v3/manage/lifecycle/stop"
                | "/api/v3/manage/lifecycle/kill"
                | "/api/v3/manage/lifecycle/restart"
                | "/api/v3/auth/session/challenge"
                | "/api/v3/auth/session"
        )
    {
        RequestPriority::Urgent
    } else if interactive {
        RequestPriority::Foreground
    } else {
        RequestPriority::Background
    }
}

fn read_ttl(path: &str) -> Duration {
    if path.starts_with("/api/v3/manage/automation/")
        || path.ends_with("/policy")
        || path.starts_with("/api/v3/manage/backups/")
        || path == "/api/v3/manage/server"
        || path == "/api/v3/manage/session"
        || [
            "users",
            "roles",
            "devices",
            "invitations",
            "access-sources",
            "players/whitelist",
            "players/ops",
            "players/bans",
        ]
        .iter()
        .any(|route| {
            path.strip_prefix("/api/v3/manage/").is_some_and(|p| {
                p == *route
                    || p.starts_with(&format!("{route}?"))
                    || p.starts_with(&format!("{route}/"))
            })
        })
    {
        Duration::from_secs(10)
    } else {
        Duration::from_millis(250)
    }
}

pub(crate) fn server_busy_retry_delay(error: &Error) -> Option<Duration> {
    if error.code != ErrorCode::ServerBusy || error.local_pressure {
        return None;
    }
    let delay = error
        .retry_after_ms
        .map(Duration::from_millis)
        .unwrap_or(Duration::from_millis(150));
    (delay <= Duration::from_secs(2)).then_some(delay)
}
use tokio_tungstenite::{
    tungstenite::{client::IntoClientRequest, protocol::WebSocketConfig},
    Connector, MaybeTlsStream, WebSocketStream,
};

pub type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
type SharedRead = Shared<BoxFuture<'static, Result<Value>>>;
pub struct Transport {
    pub(crate) endpoint: Endpoint,
    pub(crate) http: reqwest::Client,
    read_epoch: std::sync::atomic::AtomicU64,
    tls: Arc<rustls::ClientConfig>,
    pub(crate) expected: Option<String>,
    observed: Arc<Mutex<Option<String>>>,
    pub scheduler: Arc<Scheduler>,
    reads: tokio::sync::Mutex<HashMap<String, (Instant, SharedRead)>>,
    validators: tokio::sync::Mutex<HashMap<String, (String, Value)>>,
}
impl Transport {
    pub fn new(endpoint: Endpoint, expected: Option<String>) -> Result<Arc<Self>> {
        let expected = expected
            .map(|v| crate::endpoint::fingerprint(&v))
            .transpose()?;
        let observed = Arc::new(Mutex::new(None));
        let tls = trust::config(expected.clone(), observed.clone());
        let http = reqwest::Client::builder()
            .use_preconfigured_tls(tls.clone())
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(15))
            .pool_max_idle_per_host(2)
            .pool_idle_timeout(Duration::from_secs(30))
            .tcp_keepalive(Duration::from_secs(30))
            .build()
            .map_err(|_| Error::new(ErrorCode::Internal))?;
        let scheduler = Scheduler::for_origin(endpoint.url().as_str())?;
        Ok(Arc::new(Self {
            read_epoch: Default::default(),
            endpoint,
            http,
            tls: Arc::new(tls),
            expected,
            observed,
            scheduler,
            reads: Default::default(),
            validators: Default::default(),
        }))
    }
    pub fn observed(&self) -> Option<String> {
        self.observed.lock().ok().and_then(|v| v.clone())
    }
    pub(crate) fn network_error(&self, error: reqwest::Error) -> Error {
        if self
            .expected
            .as_ref()
            .zip(self.observed())
            .is_some_and(|(a, b)| a != &b)
        {
            return Error::new(ErrorCode::FingerprintMismatch);
        }
        if error.is_timeout() {
            return Error::new(ErrorCode::Timeout);
        }
        // TLS record EOF during an established response is a truncated body,
        // not a trust failure. Downloads may resume only with a strong validator.
        if error.is_body() || error.is_decode() {
            return Error::new(ErrorCode::OutcomeUnknown);
        }
        // Error strings are classified here only; never logged (may contain URLs).
        let message = format!("{error:?}").to_ascii_lowercase();
        Error::new(
            if message.contains("certificate") || message.contains("tls") {
                ErrorCode::TlsFailed
            } else if error.is_connect() {
                ErrorCode::Unreachable
            } else {
                ErrorCode::OutcomeUnknown
            },
        )
    }
    /// Retire cached projections after asynchronous work changes server state.
    pub fn invalidate_reads(&self) {
        self.read_epoch
            .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
    }

    pub async fn request(
        self: &Arc<Self>,
        method: Method,
        path: &str,
        token: Option<&str>,
        body: Option<Value>,
        key: Option<&str>,
        interactive: bool,
    ) -> Result<Value> {
        if method != Method::GET {
            return self
                .execute(method, path, token, body, key, interactive)
                .await;
        }
        // Include credential identity without keeping a plaintext token in cache keys.
        let credential = token
            .map(|v| trust::leaf_fingerprint(v.as_bytes()))
            .unwrap_or_default();
        let epoch = self.read_epoch.load(std::sync::atomic::Ordering::Acquire);
        let cache_key = format!("{epoch}:{credential}:{path}");
        let future = {
            let mut reads = self.reads.lock().await;
            reads.retain(|_, (at, future)| {
                future.peek().is_none() || at.elapsed() < Duration::from_secs(10)
            });
            if reads.get(&cache_key).is_some_and(|(at, future)| {
                future.peek().is_some_and(|result| {
                    at.elapsed()
                        >= if result.is_ok() {
                            read_ttl(path)
                        } else {
                            Duration::from_millis(250)
                        }
                })
            }) {
                reads.remove(&cache_key);
            }
            if let Some((_, f)) = reads.get(&cache_key) {
                f.clone()
            } else {
                if reads.len() >= 128 {
                    return Err(Error::new(ErrorCode::ServerBusy).local_pressure());
                }
                let owner = self.clone();
                let path = path.to_owned();
                let token = token.map(|v| zeroize::Zeroizing::new(v.to_owned()));
                let (sender, receiver) = tokio::sync::oneshot::channel();
                let task_key = cache_key.clone();
                // The bounded task owns completion even if every waiter closes.
                // Cache futures contain only a receiver, never an Arc back to us.
                tokio::spawn(async move {
                    let result = owner
                        .execute(
                            Method::GET,
                            &path,
                            token.as_ref().map(|v| v.as_str()),
                            None,
                            None,
                            interactive,
                        )
                        .await;
                    let completed = futures_util::future::ready(result.clone()).boxed().shared();
                    let _ = completed.clone().now_or_never();
                    owner
                        .reads
                        .lock()
                        .await
                        .insert(task_key, (Instant::now(), completed));
                    let _ = sender.send(result);
                });
                let f = async move {
                    receiver
                        .await
                        .unwrap_or_else(|_| Err(Error::new(ErrorCode::Internal)))
                }
                .boxed()
                .shared();
                reads.insert(cache_key, (Instant::now(), f.clone()));
                f
            }
        };
        future.await
    }
    async fn execute(
        &self,
        method: Method,
        path: &str,
        token: Option<&str>,
        body: Option<Value>,
        key: Option<&str>,
        interactive: bool,
    ) -> Result<Value> {
        let retryable = method == Method::GET && interactive;
        let result = self
            .execute_once(method.clone(), path, token, body.clone(), key, interactive)
            .await;
        if retryable {
            if let Err(error) = &result {
                if let Some(delay) = server_busy_retry_delay(error) {
                    tokio::time::sleep(delay).await;
                    return self
                        .execute_once(method, path, token, body, key, interactive)
                        .await;
                }
            }
        }
        result
    }

    async fn execute_once(
        &self,
        method: Method,
        path: &str,
        token: Option<&str>,
        body: Option<Value>,
        key: Option<&str>,
        interactive: bool,
    ) -> Result<Value> {
        let _permit = self
            .scheduler
            .admit_priority_request(
                request_priority(&method, path, interactive),
                token.is_some(),
            )
            .await?;
        if self.expected.is_none()
            && (method != Method::GET || path != "/api/v3/status" || token.is_some())
        {
            return Err(Error::new(ErrorCode::TlsFailed));
        }
        let mutation = method != Method::GET;
        let conditional = method == Method::GET
            && matches!(
                path,
                "/api/v3/manage/server/status" | "/api/v3/manage/metrics/current"
            );
        let validator = if conditional {
            self.validators.lock().await.get(path).cloned()
        } else {
            None
        };
        let mut request = self.http.request(method, self.endpoint.route(path)?);
        if mutation
            && matches!(
                path,
                "/api/v3/manage/pack/install/plan"
                    | "/api/v3/manage/pack/install/apply"
                    | "/api/v3/manage/pack/archive/inspect"
                    | "/api/v3/manage/pack/draft/uploads/finish"
            )
        {
            // Match the agent's hour-long pack budget, including slow large downloads.
            request = request.timeout(Duration::from_secs(3630));
        }
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        if let Some(key) = key {
            request = request.header("Idempotency-Key", key);
        }
        if let Some((tag, _)) = &validator {
            request = request.header("If-None-Match", tag);
        }
        let mut response = request.send().await.map_err(|e| self.network_error(e))?;
        let status = response.status();
        // A rejected revision means the cached observation used to construct the
        // mutation may already be stale. Retire before returning the error, even
        // if its body is truncated. Conservatively include generic 409 conflicts:
        // routes use several version-conflict wire codes, not just HTTP 412.
        let conflict = mutation && matches!(status.as_u16(), 409 | 412);
        if conflict {
            self.invalidate_reads();
        }
        let uncertain_gateway = mutation && matches!(status.as_u16(), 502 | 504);
        let retry = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .map(|n| n.saturating_mul(1000).min(3_600_000));
        if status == StatusCode::TOO_MANY_REQUESTS {
            self.scheduler.pause(retry.unwrap_or(60_000));
        }
        if status == StatusCode::NOT_MODIFIED {
            return validator
                .map(|v| v.1)
                .ok_or_else(|| Error::new(ErrorCode::Unsupported));
        }
        let tag = response
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .filter(|v| v.len() <= 128)
            .map(str::to_owned);
        let body_limit =
            if path.starts_with("/api/v3/manage/pack/") || path == "/api/v3/manage/content" {
                32 * 1024 * 1024
            } else {
                1024 * 1024
            };
        if response
            .content_length()
            .is_some_and(|n| n > body_limit as u64)
        {
            return Err(Error::new(if uncertain_gateway {
                ErrorCode::OutcomeUnknown
            } else {
                ErrorCode::Unsupported
            }));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| {
            if uncertain_gateway {
                Error::new(ErrorCode::OutcomeUnknown)
            } else {
                self.network_error(e)
            }
        })? {
            if bytes.len() + chunk.len() > body_limit {
                return Err(Error::new(if uncertain_gateway {
                    ErrorCode::OutcomeUnknown
                } else {
                    ErrorCode::Unsupported
                }));
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| {
            if uncertain_gateway {
                Error::new(ErrorCode::OutcomeUnknown)
            } else if status.is_success() {
                Error::new(ErrorCode::Unsupported)
            } else {
                Error::wire(status.as_u16(), "", retry)
            }
        })?;
        // A typed agent refusal proves this provider step failed before applying
        // anything. A proxy/gateway failure still has an uncertain outcome.
        if uncertain_gateway
            && !(value["api_version"] == "3"
                && matches!(
                    value.pointer("/error/code").and_then(Value::as_str),
                    Some(
                        "content_pack_metadata_invalid"
                            | "content_pack_download_failed"
                            | "content_pack_hash_mismatch"
                            | "content_pack_source_unsafe"
                    )
                ))
        {
            return Err(Error::new(ErrorCode::OutcomeUnknown));
        }
        if !status.is_success() {
            let error = Error::wire_for_route(
                status.as_u16(),
                value
                    .pointer("/error/code")
                    .or_else(|| value.get("error"))
                    .and_then(Value::as_str)
                    .unwrap_or(""),
                retry,
                path,
            )
            .with_provider_details(value.pointer("/error/details").unwrap_or(&Value::Null))
            .with_pack_issue(value.pointer("/error/issue").unwrap_or(&Value::Null));
            // Some policy adapters signal revision conflicts by wire code with
            // another status. Apply the same rule after closed-code decoding.
            if mutation
                && !conflict
                && matches!(error.code, ErrorCode::StaleTarget | ErrorCode::Conflict)
            {
                self.invalidate_reads();
            }
            return Err(error);
        }
        // Implemented auth routes predate the v3 management envelope and return
        // plain objects. Never extend this exception to operational routes.
        let auth = path.starts_with("/api/v3/auth/") || path == "/api/v3/manage/pair";
        if !auth && value.get("api_version").and_then(Value::as_str) != Some("3") {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        let data = value.get("data").cloned().unwrap_or(value);
        if mutation && path.starts_with("/api/v3/manage/") {
            // New reads must not reuse a pre-mutation projection. In-flight old
            // readers may complete, but their epoch cannot repopulate the new cache.
            self.read_epoch
                .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        }
        if conditional {
            if let Some(tag) = tag {
                self.validators
                    .lock()
                    .await
                    .insert(path.to_owned(), (tag, data.clone()));
            }
        }
        Ok(data)
    }
    pub async fn socket(&self, path: &str, token: &str) -> Result<Socket> {
        if self.expected.is_none() {
            return Err(Error::new(ErrorCode::TlsFailed));
        }
        let _admission = self.scheduler.admit_authenticated(false)?;
        let mut url = self.endpoint.route(path)?;
        url.set_scheme("wss")
            .map_err(|_| Error::new(ErrorCode::Internal))?;
        let mut request = url
            .as_str()
            .into_client_request()
            .map_err(|_| Error::new(ErrorCode::InvalidInput))?;
        request.headers_mut().insert(
            "Authorization",
            format!("Bearer {token}")
                .parse()
                .map_err(|_| Error::new(ErrorCode::Internal))?,
        );
        let config = WebSocketConfig {
            max_message_size: Some(64 * 1024),
            max_frame_size: Some(64 * 1024),
            ..Default::default()
        };
        let result = tokio::time::timeout(
            Duration::from_secs(15),
            tokio_tungstenite::connect_async_tls_with_config(
                request,
                Some(config),
                false,
                Some(Connector::Rustls(self.tls.clone())),
            ),
        )
        .await;
        match result {
            Ok(Ok((socket, _))) => Ok(socket),
            Err(_) => Err(Error::new(ErrorCode::Timeout)),
            Ok(Err(tokio_tungstenite::tungstenite::Error::Http(response))) => {
                let retry = response
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                    .map(|v| v.saturating_mul(1000));
                if response.status().as_u16() == 429 {
                    self.scheduler.pause(retry.unwrap_or(60_000));
                }
                Err(Error::wire(response.status().as_u16(), "", retry))
            }
            Ok(Err(_)) => Err(Error::new(
                if self
                    .expected
                    .as_ref()
                    .zip(self.observed())
                    .is_some_and(|(a, b)| a != &b)
                {
                    ErrorCode::FingerprintMismatch
                } else {
                    ErrorCode::Unreachable
                },
            )),
        }
    }
}

#[cfg(test)]
mod priority_tests {
    use super::*;

    #[test]
    fn only_closed_control_and_session_routes_are_urgent() {
        for path in [
            "/api/v3/manage/lifecycle/sleep",
            "/api/v3/manage/lifecycle/stop",
            "/api/v3/manage/lifecycle/restart",
            "/api/v3/manage/lifecycle/kill",
            "/api/v3/auth/session/challenge",
            "/api/v3/auth/session",
        ] {
            assert_eq!(
                request_priority(&Method::POST, path, false),
                RequestPriority::Urgent
            );
            assert_eq!(
                request_priority(&Method::GET, path, true),
                RequestPriority::Foreground
            );
            assert_eq!(
                request_priority(&Method::POST, &format!("{path}?urgent=1"), true),
                RequestPriority::Foreground
            );
        }
        for path in [
            "/api/v3/manage/lifecycle/start",
            "/api/v3/manage/server/status",
            "/api/v3/manage/pair",
            "/api/v3/auth/session/other",
        ] {
            assert_eq!(
                request_priority(&Method::POST, path, true),
                RequestPriority::Foreground
            );
            assert_eq!(
                request_priority(&Method::GET, path, false),
                RequestPriority::Background
            );
        }
    }
}
