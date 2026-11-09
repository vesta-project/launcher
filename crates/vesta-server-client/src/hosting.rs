//! Allowlisted hosting DTOs and native-only software approval tokens.
use super::*;
use serde::{Deserialize, Serialize};
macro_rules! dto {($name:ident { $($field:ident:$ty:ty),* $(,)? })=>{
    #[derive(Clone,Debug,Serialize,Deserialize)] #[serde(rename_all="camelCase",deny_unknown_fields)]
    pub struct $name { $(pub $field:$ty),* }
};}
// Responses are decoded through explicit DTOs; token fields never cross IPC.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerWorld {
    pub size_bytes: Option<String>,
    #[serde(default)]
    pub size_complete: bool,
    pub size_observed_at_ms: Option<i64>,
    pub last_modified_at_ms: Option<i64>,
    pub last_played_at_ms: Option<i64>,
    #[serde(default)]
    pub dimensions: Vec<WorldDimension>,
    #[serde(default)]
    pub datapacks: Vec<WorldDatapack>,
    pub datapack_state_source: Option<String>,
    pub name: String,
    pub seed: Option<String>,
    pub configured_seed: String,
    pub exists: bool,
    pub revision: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareLaunch {
    #[serde(default)]
    pub custom_jar: Option<CustomJar>,
    pub software: Option<String>,
    pub version: Option<String>,
    pub build: Option<u32>,
    pub installation_id: String,
    pub loader_version: Option<String>,
    pub java_major: Option<u32>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CustomJar {
    pub path: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomJarPlan {
    pub plan_id: String,
    pub expires_at_ms: i64,
    pub expected_revision: String,
    pub custom_jar: Option<CustomJar>,
    pub main_class: Option<String>,
    pub risks: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareDescriptor {
    pub software: String,
    pub automatic_backend: bool,
    pub unavailable_reason: Option<String>,
    pub source: String,
    pub licence: String,
    pub eula: String,
    pub caution: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareState {
    pub available: bool,
    pub unavailable_reason: Option<String>,
    pub revision: String,
    pub current: Option<SoftwareLaunch>,
    pub previous: Option<SoftwareLaunch>,
    #[serde(default)]
    pub previous_restorable: bool,
    pub recovery_required: bool,
    pub catalog: Vec<SoftwareDescriptor>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareReleases {
    pub software: String,
    pub version: String,
    pub releases: Vec<SoftwareRelease>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareRelease {
    pub id: String,
    pub build: Option<u32>,
    pub loader_version: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareVersions {
    pub software: String,
    pub versions: Vec<String>,
}

#[cfg(test)]
mod release_tests {
    use super::*;

    #[test]
    fn release_wire_preserves_exact_loader_and_build_choices() {
        let value: SoftwareReleases = from_wire(json!({"software":"fabric","version":"1.21.4","releases":[{"id":"0.16.10","build":null,"loader_version":"0.16.10"}]})).unwrap();
        assert_eq!(value.releases[0].loader_version.as_deref(), Some("0.16.10"));
        let value: SoftwareReleases = from_wire(json!({"software":"paper","version":"1.21.4","releases":[{"id":"130","build":130,"loader_version":null}]})).unwrap();
        assert_eq!(value.releases[0].build, Some(130));
    }
}
dto!(SoftwarePlanRequest {software:String,version:String,build:Option<u32>,loader_version:Option<String>,experimental:Option<bool>});
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaRequirement {
    pub major: u32,
    pub evidence: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwarePlan {
    #[serde(default)]
    pub loader_version: Option<String>,
    pub plan_id: String,
    pub expires_at_ms: i64,
    pub expected_revision: String,
    pub software: String,
    pub version: String,
    pub build: Option<u32>,
    pub java: JavaRequirement,
    pub java_compatible: Option<bool>,
    pub selected_java_major: Option<u32>,
    pub managed_download_major: Option<u32>,
    pub warnings: Vec<String>,
    pub risks: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareJob {
    #[serde(default)]
    pub error_context: Option<serde_json::Value>,
    pub id: String,
    pub kind: String,
    pub state: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub error: Option<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpLimits {
    pub sessions: u32,
    pub sessions_per_ip: u32,
    pub handles_per_session: u32,
    pub transfers_per_principal: u32,
    pub bytes_per_second: u64,
    pub bytes_per_session: u64,
    pub max_file_bytes: u64,
    pub idle_timeout_secs: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpConfig {
    pub enabled: bool,
    pub bind_address: String,
    pub port: u16,
    pub allow_cidrs: Vec<String>,
    pub deny_cidrs: Vec<String>,
    pub limits: SftpLimits,
}
dto!(SftpLimitsPatch {sessions:Option<u32>,sessions_per_ip:Option<u32>,handles_per_session:Option<u32>,transfers_per_principal:Option<u32>,bytes_per_second:Option<u64>,bytes_per_session:Option<u64>,max_file_bytes:Option<u64>,idle_timeout_secs:Option<u32>});
dto!(SftpConfigPatch {enabled:Option<bool>,bind_address:Option<String>,port:Option<u16>,allow_cidrs:Option<Vec<String>>,deny_cidrs:Option<Vec<String>>,limits:Option<SftpLimitsPatch>});
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpStatus {
    pub config: SftpConfig,
    pub running: bool,
    pub bound_address: Option<String>,
    pub host_key_fingerprint: Option<String>,
    pub active_sessions: u32,
    pub authentication: Vec<String>,
    pub username: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpKey {
    pub id: String,
    pub principal_id: String,
    pub label: String,
    pub fingerprint: String,
    pub public_key: String,
    pub created_at_ms: i64,
    pub expires_at_ms: Option<i64>,
    pub revoked_at_ms: Option<i64>,
}
dto!(SftpTarget {host:String,port:u16,username:String,host_key_fingerprint:Option<String>});

struct Approval {
    token: zeroize::Zeroizing<String>,
    expires: i64,
    attempt: Option<String>,
}
#[derive(Default)]
pub(super) struct State {
    approvals: Mutex<HashMap<String, Approval>>,
}
fn invalid() -> Error {
    Error::new(ErrorCode::InvalidInput)
}
fn unsupported() -> Error {
    Error::new(ErrorCode::Unsupported)
}
fn software(id: &str) -> Result<&str> {
    if [
        "vanilla", "paper", "folia", "purpur", "fabric", "quilt", "forge", "neoforge", "bukkit",
        "spigot",
    ]
    .contains(&id)
    {
        Ok(id)
    } else {
        Err(invalid())
    }
}

fn revision(value: &mut Value, key: &str) -> Result<()> {
    if let Some(n) = value.get(key).and_then(Value::as_u64) {
        value[key] = json!(n.to_string());
    }
    if value.get(key).and_then(Value::as_str).is_none() {
        return Err(unsupported());
    }
    Ok(())
}
pub(super) fn wire(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| {
                    let key = key
                        .chars()
                        .flat_map(|c| {
                            if c.is_ascii_uppercase() {
                                vec!['_', c.to_ascii_lowercase()]
                            } else {
                                vec![c]
                            }
                        })
                        .collect();
                    (key, wire(value))
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.into_iter().map(wire).collect()),
        other => other,
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EulaState { pub accepted: bool }
impl Client {
    pub async fn eula(&self) -> Result<EulaState> {
        from_wire(self.get("eula", true, "config.view").await?)
    }
    pub async fn set_eula(&self, accepted: bool, intent: &str) -> Result<EulaState> {
        let key = self.intent_key(intent)?;
        from_wire(self.request(Method::POST, "/api/v3/manage/eula", Some(json!({"accepted":accepted})), Some(&key), true, "config.edit").await?)
    }

    pub async fn custom_jar_plan(
        &self,
        path: Option<String>,
        expected_revision: String,
    ) -> Result<CustomJarPlan> {
        let expected = expected_revision.parse::<u64>().map_err(|_| invalid())?;
        let route = if path.is_some() {
            "software/custom-jar/plan"
        } else {
            "software/restore-managed/plan"
        };
        let mut value = self
            .request(
                Method::POST,
                &format!("/api/v3/manage/{route}"),
                Some(json!({"path":path,"expected_revision":expected})),
                None,
                true,
                "content.install",
            )
            .await?;
        let token = value
            .get("confirmation_token")
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty() && token.len() <= 128)
            .ok_or_else(unsupported)?
            .to_owned();
        revision(&mut value, "expected_revision")?;
        let plan: CustomJarPlan = from_wire(value)?;
        let mut approvals = self.hosting.approvals.lock().await;
        approvals.retain(|_, a| a.attempt.is_some() || a.expires > crate::now_ms());
        if approvals.len() >= 64 {
            return Err(Error::new(ErrorCode::ServerBusy));
        }
        approvals.insert(
            format!("custom:{}", plan.plan_id),
            Approval {
                token: zeroize::Zeroizing::new(token),
                expires: plan.expires_at_ms,
                attempt: None,
            },
        );
        Ok(plan)
    }
    pub async fn custom_jar_apply(&self, id: String, intent: &str) -> Result<SoftwareJob> {
        let key = self.intent_key(intent)?;
        let mut approvals = self.hosting.approvals.lock().await;
        let approval = approvals
            .get_mut(&format!("custom:{id}"))
            .ok_or_else(|| Error::new(ErrorCode::ConfirmationExpired))?;
        if approval
            .attempt
            .as_ref()
            .is_some_and(|previous| previous != &key)
        {
            return Err(Error::new(ErrorCode::Conflict));
        }
        if approval.attempt.is_none() && approval.expires <= crate::now_ms() {
            return Err(Error::new(ErrorCode::ConfirmationExpired));
        }
        approval.attempt = Some(key.clone());
        from_wire(self.request(Method::POST,"/api/v3/manage/software/custom-jar/apply",Some(json!({"plan_id":id,"confirmation_token":approval.token.as_str(),"idempotency_key":key})),Some(&key),true,"content.install").await?)
    }
    /// Select a fresh world through the server's recoverable, owner-only operation.
    pub async fn new_world(&self, expected_revision: String, confirm_world: String, intent: &str) -> Result<ServerWorld> {
        let value = self.management_mutate(Method::POST, "world/new", Some(json!({"seed":"", "expected_revision":expected_revision,"confirm_world":confirm_world})), intent, "config.edit").await?;
        from_wire(value.get("world").cloned().ok_or_else(invalid)?)
    }
    pub async fn world(&self) -> Result<ServerWorld> {
        from_wire(self.get("world", true, "config.view").await?)
    }
    pub async fn software(&self) -> Result<SoftwareState> {
        let mut value = self.get("software", true, "content.install").await?;
        revision(&mut value, "revision")?;
        from_wire(value)
    }
    pub async fn software_versions(&self, id: &str) -> Result<SoftwareVersions> {
        from_wire(
            self.get(
                &format!("software/versions?software={}", software(id)?),
                true,
                "content.install",
            )
            .await?,
        )
    }
    pub async fn software_releases(&self, id: &str, version: &str) -> Result<SoftwareReleases> {
        if version.is_empty()
            || version.len() > 128
            || !version
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
        {
            return Err(invalid());
        }
        from_wire(
            self.get(
                &format!(
                    "software/releases?software={}&version={}",
                    software(id)?,
                    version
                ),
                true,
                "content.install",
            )
            .await?,
        )
    }
    pub async fn software_plan(&self, request: SoftwarePlanRequest) -> Result<SoftwarePlan> {
        software(&request.software)?;
        if request.version.is_empty()
            || request.version.len() > 128
            || request.experimental == Some(true)
        {
            return Err(invalid());
        }
        let mut body = wire(serde_json::to_value(request).map_err(|_| invalid())?);
        body["experimental"] = json!(false);
        let mut value = self
            .request(
                Method::POST,
                "/api/v3/manage/software/plan",
                Some(body),
                None,
                true,
                "content.install",
            )
            .await?;
        let token = value
            .get("confirmation_token")
            .and_then(Value::as_str)
            .filter(|t| !t.is_empty() && t.len() <= 128)
            .ok_or_else(unsupported)?
            .to_owned();
        revision(&mut value, "expected_revision")?;
        let plan: SoftwarePlan = from_wire(value)?;
        if plan.java_compatible == Some(false) {
            return Ok(plan);
        }
        let mut approvals = self.hosting.approvals.lock().await;
        approvals
            .retain(|_, approval| approval.attempt.is_some() || approval.expires > crate::now_ms());
        if approvals.len() >= 64 {
            return Err(Error::new(ErrorCode::ServerBusy));
        }
        approvals.insert(
            plan.plan_id.clone(),
            Approval {
                token: zeroize::Zeroizing::new(token),
                expires: plan.expires_at_ms,
                attempt: None,
            },
        );
        Ok(plan)
    }
    pub async fn software_apply(
        &self,
        id: String,
        warnings: bool,
        legacy: bool,
        intent: &str,
    ) -> Result<SoftwareJob> {
        let key = self.intent_key(intent)?;
        let binding = format!("{key}:{warnings}:{legacy}");
        let mut approvals = self.hosting.approvals.lock().await;
        let approval = approvals
            .get_mut(&id)
            .ok_or_else(|| Error::new(ErrorCode::ConfirmationExpired))?;
        if approval
            .attempt
            .as_ref()
            .is_some_and(|previous| previous != &binding)
        {
            return Err(Error::new(ErrorCode::Conflict));
        }
        if approval.attempt.is_none() && approval.expires <= crate::now_ms() {
            return Err(Error::new(ErrorCode::ConfirmationExpired));
        }
        approval.attempt = Some(binding);
        let value=self.request(Method::POST,"/api/v3/manage/software/apply",Some(json!({"plan_id":id,"confirmation_token":approval.token.as_str(),"idempotency_key":key,"acknowledge_warnings":warnings,"acknowledge_legacy_checksum":legacy})),Some(&key),true,"content.install").await?;
        from_wire(value)
    }
    pub async fn software_jobs(&self, interactive: bool) -> Result<Vec<SoftwareJob>> {
        let value = self
            .get("software/jobs", interactive, "content.install")
            .await?;
        let jobs: Vec<SoftwareJob> =
            from_wire(value.get("jobs").cloned().ok_or_else(unsupported)?)?;
        if jobs.len() > 100 {
            return Err(unsupported());
        }
        Ok(jobs)
    }
    pub async fn software_rollback(&self, expected: String, intent: &str) -> Result<SoftwareJob> {
        let expected = expected.parse::<u64>().map_err(|_| invalid())?;
        let key = self.intent_key(intent)?;
        let name = format!("rollback:{intent}");
        let binding = format!("{key}:{expected}");
        let mut approvals = self.hosting.approvals.lock().await;
        if !approvals.contains_key(&name) {
            if approvals.len() >= 64 {
                return Err(Error::new(ErrorCode::ServerBusy));
            }
            let value = self
                .request(
                    Method::POST,
                    "/api/v3/manage/software/rollback/plan",
                    Some(json!({"expected_revision":expected})),
                    None,
                    true,
                    "content.install",
                )
                .await?;
            let id = value
                .get("plan_id")
                .and_then(Value::as_str)
                .ok_or_else(unsupported)?;
            let token = value
                .get("confirmation_token")
                .and_then(Value::as_str)
                .ok_or_else(unsupported)?;
            if id.len() != 36 || token.len() > 128 {
                return Err(unsupported());
            }
            // Retain plan id with the native token for exact uncertain replay.
            approvals.insert(
                name.clone(),
                Approval {
                    token: zeroize::Zeroizing::new(format!("{id}\n{token}")),
                    expires: value
                        .get("expires_at_ms")
                        .and_then(Value::as_i64)
                        .ok_or_else(unsupported)?,
                    attempt: None,
                },
            );
        }
        let approval = approvals.get_mut(&name).ok_or_else(unsupported)?;
        if approval
            .attempt
            .as_ref()
            .is_some_and(|previous| previous != &binding)
        {
            return Err(Error::new(ErrorCode::Conflict));
        }
        if approval.attempt.is_none() && approval.expires <= crate::now_ms() {
            return Err(Error::new(ErrorCode::ConfirmationExpired));
        }
        approval.attempt = Some(binding);
        let (id, token) = approval.token.split_once('\n').ok_or_else(unsupported)?;
        let value=self.request(Method::POST,"/api/v3/manage/software/rollback",Some(json!({"expected_revision":expected,"idempotency_key":key,"confirm":true,"plan_id":id,"confirmation_token":token})),Some(&key),true,"content.install").await?;
        from_wire(value)
    }
    pub async fn sftp(&self) -> Result<SftpStatus> {
        from_wire(self.get("sftp", true, "config.view").await?)
    }
    pub async fn sftp_update(&self, patch: SftpConfigPatch, intent: &str) -> Result<SftpStatus> {
        from_wire(
            self.management_mutate(
                Method::PATCH,
                "sftp",
                Some(wire(serde_json::to_value(patch).map_err(|_| invalid())?)),
                intent,
                "security.manage",
            )
            .await?,
        )
    }
    pub async fn sftp_keys(&self) -> Result<Vec<SftpKey>> {
        let value = self.get("sftp/keys", true, "credentials.manage").await?;
        let keys: Vec<SftpKey> = from_wire(value.get("keys").cloned().ok_or_else(unsupported)?)?;
        if keys.len() > 256 {
            return Err(unsupported());
        }
        Ok(keys)
    }
    pub async fn sftp_key_add(
        &self,
        principal: String,
        label: String,
        public_key: String,
        expires: Option<i64>,
        intent: &str,
    ) -> Result<SftpKey> {
        if uuid::Uuid::parse_str(&principal).is_err()
            || label.is_empty()
            || label.len() > 96
            || label.chars().any(char::is_control)
            || public_key.len() > 4096
            || !public_key.starts_with("ssh-ed25519 ")
            || public_key.contains("PRIVATE KEY")
        {
            return Err(invalid());
        }
        from_wire(self.management_mutate(Method::POST,"sftp/keys",Some(json!({"principal_id":principal,"label":label,"public_key":public_key,"expires_at_ms":expires})),intent,"credentials.manage").await?)
    }
    pub async fn sftp_key_revoke(&self, id: String, intent: &str) -> Result<()> {
        if uuid::Uuid::parse_str(&id).is_err() {
            return Err(invalid());
        }
        self.management_mutate(
            Method::DELETE,
            &format!("sftp/keys/{id}"),
            None,
            intent,
            "credentials.manage",
        )
        .await?;
        Ok(())
    }
}

/// Validate a server-relative directory and encode each segment for appending to an SFTP root URL.
pub fn sftp_relative_url_path(path: &str) -> Result<String> {
    let path = path.replace('\\', "/");
    if path.starts_with('/')
        || path.chars().any(char::is_control)
        || (path.as_bytes().get(1) == Some(&b':') && path.as_bytes()[0].is_ascii_alphabetic())
    {
        return Err(invalid());
    }
    let mut encoded = String::new();
    for segment in path.split('/') {
        if segment == ".." {
            return Err(invalid());
        }
        if segment.is_empty() || segment == "." {
            continue;
        }
        for byte in segment.bytes() {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                encoded.push(char::from(byte));
            } else {
                use std::fmt::Write;
                write!(encoded, "%{byte:02X}").expect("writing to a String cannot fail");
            }
        }
        encoded.push('/');
    }
    Ok(encoded)
}

#[cfg(test)]
mod sftp_path_tests {
    use super::*;

    #[test]
    fn sftp_path_normalizes_and_encodes_segments() {
        for (path, expected) in [
            ("", ""),
            ("./", ""),
            ("world/datapacks", "world/datapacks/"),
            (".\\plugins\\Essentials//./", "plugins/Essentials/"),
            (
                "world/ä b/50%#?@:!",
                "world/%C3%A4%20b/50%25%23%3F%40%3A%21/",
            ),
            ("%2e%2e/%2F", "%252e%252e/%252F/"),
            ("a..b/~_-.", "a..b/~_-./"),
        ] {
            assert_eq!(sftp_relative_url_path(path).unwrap(), expected, "{path:?}");
        }
    }

    #[test]
    fn sftp_path_rejects_traversal_absolute_paths_and_controls() {
        for path in [
            "..",
            "a/../b",
            "a\\..\\b",
            "/world",
            "\\world",
            "//host/share",
            "\\\\host\\share",
            "C:/world",
            "c:\\world",
            "C:world",
            "a\0b",
            "a\nb",
            "a\rb",
            "a\tb",
            "a\u{7f}b",
            "a\u{85}b",
        ] {
            assert_eq!(
                sftp_relative_url_path(path).unwrap_err().code,
                ErrorCode::InvalidInput,
                "{path:?}"
            );
        }
    }
}

/// Build a fixed-scheme URL from a pinned management endpoint and authenticated status.
pub fn sftp_target(
    endpoint: &crate::endpoint::Endpoint,
    status: &SftpStatus,
) -> Result<(String, SftpTarget)> {
    if !status.config.enabled || !status.running {
        let mut e = Error::new(ErrorCode::Conflict);
        e.reason = Some("sftp_disabled".into());
        return Err(e);
    }
    if uuid::Uuid::parse_str(&status.username).is_err() || status.config.port == 0 {
        return Err(unsupported());
    }
    let host = endpoint
        .url()
        .host_str()
        .ok_or_else(unsupported)?
        .trim_matches(['[', ']'])
        .to_owned();
    let authority = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.clone()
    };
    let mut url = url::Url::parse(&format!("sftp://{authority}:{}/", status.config.port))
        .map_err(|_| invalid())?;
    url.set_username(&status.username).map_err(|_| invalid())?;
    Ok((
        url.to_string(),
        SftpTarget {
            host,
            port: status.config.port,
            username: status.username.clone(),
            host_key_fingerprint: status.host_key_fingerprint.clone(),
        },
    ))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerJavaRuntime {
    pub id: String,
    pub path: String,
    pub version: String,
    pub major: u32,
    pub vendor: String,
    pub arch: String,
    pub managed: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerJavaInventory {
    pub runtimes: Vec<ServerJavaRuntime>,
    pub selected: Option<ServerJavaRuntime>,
    pub custom_paths_allowed: bool,
    pub managed_majors: Vec<u32>,
}
impl Client {
    pub async fn java_inventory(&self) -> Result<ServerJavaInventory> {
        from_wire(self.get("java", true, "content.install").await?)
    }
    pub async fn java_select(
        &self,
        runtime_id: Option<String>,
        custom_path: Option<String>,
        intent: &str,
    ) -> Result<SoftwareJob> {
        if runtime_id.is_some() == custom_path.is_some()
            || custom_path
                .as_ref()
                .is_some_and(|p| p.len() > 4096 || p.chars().any(char::is_control))
        {
            return Err(invalid());
        }
        from_wire(
            self.management_mutate(
                Method::POST,
                "java/select",
                Some(json!({"runtime_id":runtime_id,"custom_path":custom_path})),
                intent,
                "content.install",
            )
            .await?,
        )
    }
    pub async fn java_download(&self, major: u32, intent: &str) -> Result<SoftwareJob> {
        if !(8..=99).contains(&major) {
            return Err(invalid());
        }
        from_wire(
            self.management_mutate(
                Method::POST,
                "java/download",
                Some(json!({"major":major})),
                intent,
                "content.install",
            )
            .await?,
        )
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldDimension {
    pub id: String,
    pub present: bool,
    pub folders: Vec<String>,
    pub layout: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldDatapack {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub path: Option<String>,
    pub enabled: Option<bool>,
}
impl Client {
    pub async fn world_datapack_offline(
        &self,
        pack_id: String,
        enabled: bool,
        expected_revision: String,
        intent: &str,
    ) -> Result<ServerWorld> {
        if !pack_id.starts_with("file/")
            || pack_id.len() > 1024
            || pack_id.chars().any(char::is_control)
            || expected_revision.len() != 64
            || !expected_revision.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(invalid());
        }
        self.management_mutate(
            Method::POST,
            "world/datapacks/offline",
            Some(
                json!({"pack_id":pack_id,"enabled":enabled,"expected_revision":expected_revision}),
            ),
            intent,
            "config.edit",
        )
        .await?;
        self.world().await
    }
    pub async fn world_datapack_toggle(
        &self,
        pack_id: String,
        enabled: bool,
        expected_generation: String,
        intent: &str,
    ) -> Result<crate::model::ServerOperation> {
        if pack_id.is_empty() || pack_id.len() > 1024 || pack_id.chars().any(char::is_control) {
            return Err(invalid());
        }
        crate::operations::generation(&expected_generation)?;
        let value=self.management_mutate(Method::POST,"world/datapacks/toggle",Some(json!({"pack_id":pack_id,"enabled":enabled,"expected_generation":expected_generation})),intent,"config.edit").await?;
        crate::operations::decode(value, None)
    }
}

#[cfg(test)]
mod software_ids_tests {
    #[test]
    fn job_warnings_round_trip_and_old_agents_default_to_none() {
        let old = serde_json::json!({"id":"job","kind":"apply","state":"succeeded","createdAtMs":1,"updatedAtMs":2,"error":null});
        let job: super::SoftwareJob = serde_json::from_value(old.clone()).unwrap();
        assert!(job.warnings.is_empty());
        let mut new = old;
        new["warnings"] = serde_json::json!(["source_build_reference_mismatch"]);
        let job: super::SoftwareJob = serde_json::from_value(new.clone()).unwrap();
        assert_eq!(serde_json::to_value(job).unwrap(), new);
    }
    #[test]
    fn source_build_targets_use_fixed_software_ids() {
        for id in ["bukkit", "spigot"] {
            assert_eq!(super::software(id).unwrap(), id);
        }
        assert!(super::software("https://example.invalid/server.jar").is_err());
    }
}
