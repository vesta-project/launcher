//! Binary file responses retain their admission through the final body frame.
use crate::{
    scheduler::Admission,
    transport::{server_busy_retry_delay, Transport},
    Client, Error, ErrorCode, Result,
};
use reqwest::{header::HeaderMap, Method, StatusCode};
use serde_json::Value;
use std::{sync::Arc, time::Duration};
use tokio::sync::OwnedSemaphorePermit;

#[derive(Clone)]
pub(crate) struct Request {
    pub method: Method,
    pub path: String,
    pub body: Vec<u8>,
    pub headers: HeaderMap,
    pub key: Option<String>,
    pub bulk: bool,
}
pub(crate) struct Response {
    pub raw: reqwest::Response,
    transport: Arc<Transport>,
    _control: Option<Admission>,
    _bulk: Option<(OwnedSemaphorePermit, OwnedSemaphorePermit)>,
}
impl Response {
    pub fn header(&self, name: &str) -> Result<&str> {
        self.raw
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| Error::new(ErrorCode::Unsupported))
    }
    pub async fn chunk(&mut self) -> Result<Option<bytes::Bytes>> {
        self.raw
            .chunk()
            .await
            .map_err(|e| self.transport.network_error(e))
    }
    pub async fn bytes(mut self, limit: usize) -> Result<Vec<u8>> {
        let mut bytes = Vec::new();
        if self.raw.content_length().is_some_and(|n| n > limit as u64) {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        while let Some(chunk) = self.chunk().await? {
            if chunk.len() > limit.saturating_sub(bytes.len()) {
                return Err(Error::new(ErrorCode::Unsupported));
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }
    pub async fn json(self, limit: usize) -> Result<Value> {
        let bytes = self.bytes(limit).await?;
        let mut value: Value =
            serde_json::from_slice(&bytes).map_err(|_| Error::new(ErrorCode::Unsupported))?;
        if value["api_version"] != "3" || value.get("data").is_none() {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        Ok(value["data"].take())
    }
}
impl Transport {
    async fn file_request(self: &Arc<Self>, input: &Request, token: &str) -> Result<Response> {
        let retryable = input.method == Method::GET && !input.bulk;
        let result = self.file_request_once(input, token).await;
        if retryable {
            if let Err(error) = &result {
                if let Some(delay) = server_busy_retry_delay(error) {
                    tokio::time::sleep(delay).await;
                    return self.file_request_once(input, token).await;
                }
            }
        }
        result
    }

    async fn file_request_once(self: &Arc<Self>, input: &Request, token: &str) -> Result<Response> {
        if self.expected.is_none() {
            return Err(Error::new(ErrorCode::TlsFailed));
        }
        let control = if input.bulk {
            None
        } else {
            Some(self.scheduler.admit_authenticated_request(true).await?)
        };
        let bulk = if input.bulk {
            Some(self.scheduler.admit_bulk()?)
        } else {
            None
        };
        let mut request = self
            .http
            .request(input.method.clone(), self.endpoint.route(&input.path)?)
            .bearer_auth(token)
            .headers(input.headers.clone())
            .body(input.body.clone());
        if input.bulk {
            // Long downloads remain streamed; this is a deadline, not a buffer limit.
            request = request.timeout(Duration::from_secs(3600));
        }
        if let Some(key) = &input.key {
            request = request.header("Idempotency-Key", key);
        }
        let raw = request.send().await.map_err(|e| self.network_error(e))?;
        let status = raw.status();
        let retry = raw
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .map(|s| s.saturating_mul(1000).min(3_600_000));
        if status == StatusCode::TOO_MANY_REQUESTS {
            self.scheduler.pause(retry.unwrap_or(60_000));
        }
        let response = Response {
            raw,
            transport: self.clone(),
            _control: control,
            _bulk: bulk,
        };
        if !status.is_success() {
            if input.method != Method::GET && matches!(status.as_u16(), 502 | 504) {
                return Err(Error::new(ErrorCode::OutcomeUnknown));
            }
            let bytes = response.bytes(64 * 1024).await?;
            let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
            return Err(Error::wire(
                status.as_u16(),
                value
                    .pointer("/error/code")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
                retry,
            ).with_wire_reason(value.pointer("/error/reason").unwrap_or(&Value::Null))
             .with_pack_issue(value.pointer("/error/issue").unwrap_or(&Value::Null)));
        }
        Ok(response)
    }
}
impl Client {
    pub(crate) async fn file_request(&self, input: Request) -> Result<Response> {
        let mut token = self.token(None).await?;
        let result = self.transport.file_request(&input, &token).await;
        if result
            .as_ref()
            .is_err_and(|e| e.code == ErrorCode::CredentialsRejected)
        {
            token = self.token(Some(&token)).await?;
            return self.transport.file_request(&input, &token).await;
        }
        result
    }
}
