//! Game-root files, logs and structured properties. No native paths in IPC DTOs.
mod transfers;
mod cancellation;
pub use cancellation::{DownloadCancellation, DownloadTransfers};
use crate::{
    file_transport::{Request, Response},
    model::Page,
    operations::intent_key,
    Client, Error, ErrorCode, Result,
};
use base64::Engine;
use reqwest::{
    header::{HeaderMap, HeaderValue},
    Method,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
pub use transfers::FileTransfers;

pub const CHUNK_BYTES: usize = 1024 * 1024;
pub const MAX_WRITE_BYTES: u64 = 16 * CHUNK_BYTES as u64;
const MAX_VALIDATOR_BYTES: u64 = 256 * 1024 * 1024;
pub(super) fn invalid() -> Error {
    Error::new(ErrorCode::InvalidInput)
}
pub(super) fn unsupported() -> Error {
    Error::new(ErrorCode::Unsupported)
}
pub(super) fn io_error(_: std::io::Error) -> Error {
    Error::new(ErrorCode::Internal)
}

/// Mirrors the agent's portable lexical resource policy. Canonical filesystem,
/// scope, symlink and opened-handle checks remain authoritative on the agent.
pub fn validate_path(path: &str, root: bool) -> Result<()> {
    if path.is_empty() && root {
        return Ok(());
    }
    if path.is_empty() || path.len() > 4096 || !path.is_ascii() {
        return Err(invalid());
    }
    for part in path.split('/') {
        let stem = part
            .split('.')
            .next()
            .unwrap_or("")
            .trim_end_matches(' ')
            .to_ascii_lowercase();
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.len() > 255
            || part.ends_with(['.', ' '])
            || part.starts_with(' ')
            || part.bytes().any(|b| {
                b.is_ascii_control()
                    || matches!(b, b'\\' | b':' | b'<' | b'>' | b'"' | b'|' | b'?' | b'*')
            })
            || ["con", "prn", "aux", "nul", "clock$", "conin$", "conout$"].contains(&stem.as_str())
            || (stem.len() == 4
                && (stem.starts_with("com") || stem.starts_with("lpt"))
                && stem.as_bytes()[3].is_ascii_digit())
            || [
                ".vesta",
                ".git",
                ".hg",
                ".svn",
                "wrapper-config.toml",
                "vesta-wrapper",
                "start-vesta-wrapper.sh",
                "start-vesta-wrapper.bat",
                "server.properties",
                "whitelist.json",
                "banned-players.json",
                "banned-ips.json",
                "ops.json",
            ]
            .iter()
            .any(|n| part.eq_ignore_ascii_case(n))
        {
            return Err(invalid());
        }
    }
    Ok(())
}
pub fn validate_sha256(hash: &str) -> Result<()> {
    if hash.len() == 64
        && hash
            .bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'))
    {
        Ok(())
    } else {
        Err(invalid())
    }
}
pub(super) fn decimal(s: &str) -> Result<u64> {
    if s.is_empty() || (s.len() > 1 && s.starts_with('0')) || !s.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(invalid());
    }
    s.parse().map_err(|_| invalid())
}
fn opaque(s: &str) -> Result<()> {
    if s.is_empty()
        || s.len() > 256
        || !s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        Err(invalid())
    } else {
        Ok(())
    }
}
pub(super) fn route(name: &str, pairs: &[(&str, &str)]) -> String {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(pairs.iter().copied())
        .finish();
    format!(
        "/api/v3/manage/{name}{}{}",
        if query.is_empty() { "" } else { "?" },
        query
    )
}
pub(super) fn request(
    method: Method,
    path: String,
    intent: Option<&str>,
    bulk: bool,
) -> Result<Request> {
    Ok(Request {
        method,
        path,
        body: Vec::new(),
        headers: HeaderMap::new(),
        key: intent.map(intent_key).transpose()?,
        bulk,
    })
}
pub(super) fn conditional(input: &mut Request, expected: Option<&str>) -> Result<()> {
    let (name, value) = if let Some(hash) = expected {
        validate_sha256(hash)?;
        ("if-match", hash)
    } else {
        ("if-none-match", "*")
    };
    input
        .headers
        .insert(name, HeaderValue::from_str(value).map_err(|_| invalid())?);
    Ok(())
}
pub(super) fn json_body(input: &mut Request, value: Value) -> Result<()> {
    input.body = serde_json::to_vec(&value).map_err(|_| invalid())?;
    if input.body.len() > 65536 {
        return Err(invalid());
    }
    input
        .headers
        .insert("content-type", HeaderValue::from_static("application/json"));
    Ok(())
}
pub(super) fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|_| unsupported())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub kind: String,
    pub size: String,
    #[serde(alias = "modified_at")]
    pub modified_at_ms: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub text: String,
    pub sha256: Option<String>,
    pub size: String,
    pub binary: bool,
    pub truncated: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub sha256: String,
    pub size: String,
    #[serde(alias = "trash_id")]
    pub trash_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    pub path: String,
    pub sha256: String,
    pub size: String,
    #[serde(alias = "trashed_at_ms")]
    pub trashed_at_ms: i64,
    #[serde(alias = "expires_at_ms")]
    pub expires_at_ms: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Deleted {
    #[serde(alias = "trash_id")]
    pub trash_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadCandidate {
    pub local_id: String,
    pub name: String,
    pub size: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadProgress {
    pub upload_id: String,
    pub offset: String,
    pub total_size: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DownloadResult {
    Saved { size: String },
    Cancelled,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    pub text: String,
    pub binary: bool,
    pub start_byte: String,
    pub end_byte: String,
    pub next_byte: Option<String>,
    pub prev_byte: Option<String>,
    pub size: String,
    pub etag: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerProperties {
    pub values: BTreeMap<String, Value>,
    pub sha256: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PropertiesUpdateResult {
    #[serde(rename_all = "camelCase")]
    Applied {
        sha256: String,
        restart_needed: bool,
    },
    #[serde(rename_all = "camelCase")]
    AwaitingConfirmation {
        operation_id: String,
        confirmation_token: String,
        expires_at_ms: i64,
    },
}

#[derive(Deserialize)]
struct WirePage<T> {
    items: Vec<T>,
    next_cursor: Option<String>,
}
impl Client {
    pub async fn files_list(&self, path: &str, cursor: Option<&str>) -> Result<Page<FileEntry>> {
        validate_path(path, true)?;
        let mut pairs = vec![("path", path)];
        add_cursor(&mut pairs, cursor)?;
        let value = self
            .file_request(request(Method::GET, route("files", &pairs), None, false)?)
            .await?
            .json(CHUNK_BYTES)
            .await?;
        let page: WirePage<FileEntry> = decode(value)?;
        Ok(Page {
            items: page.items,
            next_cursor: page.next_cursor,
        })
    }
    pub async fn file_read_text(&self, path: &str) -> Result<TextFile> {
        validate_path(path, false)?;
        let input = request(
            Method::GET,
            route("files/content", &[("path", path)]),
            None,
            false,
        )?;
        let response = self.file_request(input.clone()).await;
        let mut truncated = false;
        let response = match response {
            Err(e) if e.code == ErrorCode::InvalidInput => {
                let mut input = input;
                input
                    .headers
                    .insert("range", HeaderValue::from_static("bytes=0-1048575"));
                truncated = true;
                self.file_request(input).await?
            }
            other => other?,
        };
        binary_version(&response)?;
        let size = decimal(response.header("x-vesta-file-size")?)?;
        let sha256 = if truncated {
            None
        } else {
            let hash = response.header("x-vesta-sha256")?.to_owned();
            validate_sha256(&hash).map_err(|_| unsupported())?;
            Some(hash)
        };
        let bytes = response.bytes(CHUNK_BYTES).await?;
        if !truncated
            && (bytes.len() as u64 != size
                || sha256.as_deref() != Some(&format!("{:x}", Sha256::digest(&bytes))))
        {
            return Err(unsupported());
        }
        let (text, binary) = text(&bytes);
        Ok(TextFile {
            text,
            binary,
            sha256,
            size: size.to_string(),
            truncated,
        })
    }
    pub async fn file_write_text(
        &self,
        path: &str,
        text: String,
        expected: Option<&str>,
        intent: &str,
    ) -> Result<FileChange> {
        validate_path(path, false)?;
        if text.len() as u64 > MAX_WRITE_BYTES {
            return Err(invalid());
        }
        let mut input = request(
            Method::PUT,
            route("files/content", &[("path", path)]),
            Some(intent),
            false,
        )?;
        conditional(&mut input, expected)?;
        input.body = text.into_bytes();
        input.headers.insert(
            "content-type",
            HeaderValue::from_static("application/octet-stream"),
        );
        decode(self.file_request(input).await?.json(CHUNK_BYTES).await?)
    }
    pub async fn file_mkdir(&self, path: &str, intent: &str) -> Result<()> {
        validate_path(path, false)?;
        let mut input = request(Method::POST, route("files/mkdir", &[]), Some(intent), false)?;
        json_body(&mut input, json!({"path":path}))?;
        self.file_request(input).await?.json(CHUNK_BYTES).await?;
        Ok(())
    }
    /// Listings omit content hashes and metadata ETags are not content hashes.
    /// Hash one bounded download with fixed-size storage. A change between this
    /// observation and mutation is rejected by the agent as stale_target.
    async fn mutation_validator(&self, path: &str, expected: Option<&str>) -> Result<String> {
        if let Some(hash) = expected {
            validate_sha256(hash)?;
            return Ok(hash.into());
        }
        let mut response = self
            .file_request(request(
                Method::GET,
                route("files/download", &[("path", path)]),
                None,
                true,
            )?)
            .await?;
        binary_version(&response)?;
        let size = decimal(response.header("x-vesta-file-size")?)?;
        if size > MAX_VALIDATOR_BYTES {
            return Err(invalid());
        }
        let mut count = 0u64;
        let mut hash = Sha256::new();
        while let Some(bytes) = response.chunk().await? {
            count += bytes.len() as u64;
            if count > size {
                return Err(unsupported());
            }
            hash.update(bytes);
        }
        if count != size {
            return Err(Error::new(ErrorCode::OutcomeUnknown));
        }
        Ok(format!("{:x}", hash.finalize()))
    }
    async fn intent_validator(
        &self,
        path: &str,
        expected: Option<&str>,
        intent: &str,
        action: &str,
        destination: Option<&str>,
    ) -> Result<String> {
        let key = format!("{action}:{}", intent_key(intent)?);
        if let Some(hash) = expected {
            validate_sha256(hash)?;
            return Ok(hash.into());
        }
        let binding = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&(path, destination)).map_err(|_| invalid())?)
        );
        let mut validators = self.file_validators.lock().await;
        if let Some((old, hash)) = validators.get(&key) {
            return if *old == binding {
                Ok(hash.clone())
            } else {
                Err(Error::new(ErrorCode::Conflict))
            };
        }
        if validators.len() >= 1024 {
            return Err(Error::new(ErrorCode::ServerBusy));
        }
        let hash = self.mutation_validator(path, None).await?;
        // Preserve the materialized validator for an explicit same-intent replay,
        // even after the first rename/delete has removed the source pathname.
        validators.insert(key, (binding, hash.clone()));
        Ok(hash)
    }
    pub async fn file_rename(
        &self,
        from: &str,
        to: &str,
        expected: Option<&str>,
        intent: &str,
    ) -> Result<FileChange> {
        validate_path(from, false)?;
        validate_path(to, false)?;
        let hash = self
            .intent_validator(from, expected, intent, "rename", Some(to))
            .await?;
        let mut input = request(
            Method::POST,
            route("files/rename", &[]),
            Some(intent),
            false,
        )?;
        json_body(
            &mut input,
            json!({"from":from,"to":to,"expected_sha256":hash}),
        )?;
        decode(self.file_request(input).await?.json(CHUNK_BYTES).await?)
    }
    pub async fn file_delete(
        &self,
        path: &str,
        expected: Option<&str>,
        intent: &str,
    ) -> Result<Deleted> {
        validate_path(path, false)?;
        let hash = self
            .intent_validator(path, expected, intent, "delete", None)
            .await?;
        let mut input = request(
            Method::DELETE,
            route("files", &[("path", path)]),
            Some(intent),
            false,
        )?;
        conditional(&mut input, Some(&hash))?;
        decode(self.file_request(input).await?.json(CHUNK_BYTES).await?)
    }
    pub async fn trash_list(&self, cursor: Option<&str>) -> Result<Page<TrashEntry>> {
        let mut pairs = Vec::new();
        add_cursor(&mut pairs, cursor)?;
        let page: WirePage<TrashEntry> = decode(
            self.file_request(request(Method::GET, route("trash", &pairs), None, false)?)
                .await?
                .json(CHUNK_BYTES)
                .await?,
        )?;
        Ok(Page {
            items: page.items,
            next_cursor: page.next_cursor,
        })
    }
    pub async fn trash_restore(&self, id: &str, intent: &str) -> Result<FileChange> {
        opaque(id)?;
        let mut input = request(
            Method::POST,
            route(&format!("trash/{id}/restore"), &[]),
            Some(intent),
            false,
        )?;
        json_body(&mut input, json!({}))?;
        decode(self.file_request(input).await?.json(CHUNK_BYTES).await?)
    }
    pub async fn log_tail(&self, path: &str, lines: u16, decompress: bool) -> Result<LogPage> {
        self.log_page(path, None, lines, None, decompress).await
    }
    pub async fn log_lines(
        &self,
        path: &str,
        from: Option<&str>,
        limit: u16,
        direction: &str,
        decompress: bool,
    ) -> Result<LogPage> {
        if !["forward", "backward"].contains(&direction) {
            return Err(invalid());
        }
        self.log_page(path, from, limit, Some(direction), decompress)
            .await
    }
    async fn log_page(
        &self,
        path: &str,
        from: Option<&str>,
        limit: u16,
        direction: Option<&str>,
        decompress: bool,
    ) -> Result<LogPage> {
        validate_path(path, false)?;
        if !(1..=1000).contains(&limit) {
            return Err(invalid());
        }
        if let Some(from) = from {
            decimal(from)?;
        }
        let count = limit.to_string();
        let mut pairs = vec![
            ("path", path),
            (
                if direction.is_none() {
                    "lines"
                } else {
                    "limit"
                },
                &count,
            ),
        ];
        if let Some(from) = from {
            pairs.push(("from_byte", from));
        }
        if let Some(direction) = direction {
            pairs.push(("direction", direction));
        }
        if decompress {
            pairs.push(("decompress", "1"));
        }
        let value = self
            .file_request(request(
                Method::GET,
                route(
                    if direction.is_none() {
                        "files/tail"
                    } else {
                        "files/lines"
                    },
                    &pairs,
                ),
                None,
                false,
            )?)
            .await?
            .json(6 * CHUNK_BYTES)
            .await?;
        decode_log_page(value)
    }
    pub async fn properties_get(&self) -> Result<ServerProperties> {
        // Do not use recursive snake_case conversion: property keys are literal.
        decode(
            self.file_request(request(
                Method::GET,
                route("config/server-properties", &[]),
                None,
                false,
            )?)
            .await?
            .json(CHUNK_BYTES)
            .await?,
        )
    }
    pub async fn properties_update(
        &self,
        changes: BTreeMap<String, Value>,
        expected: &str,
        token: Option<&str>,
        intent: &str,
    ) -> Result<PropertiesUpdateResult> {
        validate_sha256(expected)?;
        if changes.is_empty()
            || changes.len() > 32
            || changes.iter().any(|(k, v)| {
                k.is_empty()
                    || k.len() > 128
                    || !(v.is_boolean() || v.is_string() || v.as_i64().is_some())
            })
        {
            return Err(invalid());
        }
        let mut input = request(
            Method::PATCH,
            route("config/server-properties", &[]),
            Some(intent),
            false,
        )?;
        let mut body = json!({"changes":changes,"expected_sha256":expected});
        if let Some(token) = token {
            if token.is_empty() || token.len() > 4096 {
                return Err(invalid());
            }
            body["confirmation_token"] = json!(token);
        }
        json_body(&mut input, body)?;
        let value = self.file_request(input).await?.json(CHUNK_BYTES).await?;
        if value["state"] == "awaiting_confirmation" {
            Ok(PropertiesUpdateResult::AwaitingConfirmation {
                operation_id: field(&value, "operation_id")?,
                confirmation_token: field(&value, "confirmation_token")?,
                expires_at_ms: value["expires_at_ms"].as_i64().ok_or_else(unsupported)?,
            })
        } else {
            Ok(PropertiesUpdateResult::Applied {
                sha256: field(&value, "sha256")?,
                restart_needed: value["restart_needed"].as_bool().ok_or_else(unsupported)?,
            })
        }
    }
}
fn add_cursor<'a>(pairs: &mut Vec<(&'a str, &'a str)>, cursor: Option<&'a str>) -> Result<()> {
    if let Some(cursor) = cursor {
        if cursor.len() > 512 {
            return Err(invalid());
        }
        pairs.push(("cursor", cursor));
    }
    Ok(())
}
pub(super) fn field(value: &Value, key: &str) -> Result<String> {
    value[key]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(unsupported)
}
pub(super) fn binary_version(response: &Response) -> Result<()> {
    if response.header("x-vesta-api-version")? == "3" {
        Ok(())
    } else {
        Err(unsupported())
    }
}
fn text(bytes: &[u8]) -> (String, bool) {
    match std::str::from_utf8(bytes) {
        Ok(s) if !s.contains('\0') => (s.into(), false),
        _ => (String::new(), true),
    }
}
fn decode_log_page(value: Value) -> Result<LogPage> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(field(&value, "bytes_base64")?)
        .map_err(|_| unsupported())?;
    if bytes.len() > 4 * CHUNK_BYTES {
        return Err(unsupported());
    }
    let (text, binary) = text(&bytes);
    Ok(LogPage {
        text,
        binary: binary || value["encoding"] == "binary",
        start_byte: field(&value, "start_byte")?,
        end_byte: field(&value, "cursor")?,
        next_byte: decode(value["next_byte"].clone())?,
        prev_byte: decode(value["prev_byte"].clone())?,
        size: field(&value, "size")?,
        etag: field(&value, "etag")?,
    })
}
