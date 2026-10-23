//! Management projections. Only these allowlisted DTOs may cross launcher IPC.
use super::*;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

macro_rules! dto {
    ($name:ident { $($field:ident: $ty:ty),* $(,)? }) => {
        #[derive(Clone, Debug, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase")]
        pub struct $name { $(pub $field: $ty),* }
    };
}
dto!(BackupProfile { name: String, mode: String, keep_last: u64, keep_daily: u64,
    keep_weekly: u64, keep_monthly: u64, on_mutation: String, warn_seconds: u64, max_snapshots: Option<u64> });
dto!(BackupJob { id: String, profile: String, kind: String, state: String,
    requested_by: Option<String>, snapshot_id: Option<String>, error_code: Option<String>,
    created_at_ms: i64, started_at_ms: Option<i64>, finished_at_ms: Option<i64>, result: Option<BackupResult> });
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_new: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_changed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_unmodified: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_added: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes_processed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consistency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub world_changed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_written: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_removed: Option<u64>,
    pub safety_snapshot_id: Option<String>,
}
dto!(BackupSnapshot {
    id: String,
    time: String,
    safety: bool
});
dto!(BackupSnapshotDetail { id: String, time: String, size_bytes: Option<u64>, added_bytes: Option<u64>, file_count: Option<u64>, tags: Vec<String> });
dto!(BackupOverview { profiles: Vec<BackupProfile>, jobs: Vec<BackupJob>, next_before: Option<String>, recovery_required: bool });
dto!(BackupLimits { max_snapshots: Option<u64>, max_repository_bytes: Option<u64>, min_free_bytes: u64 });
dto!(BackupStorage { repository_bytes: u64, restore_points: u64, safety_snapshots: u64,
    free_bytes: Option<u64>, limits: BackupLimits, stopped: Option<String> });
dto!(RestorePreparation {
    job: BackupJob,
    expires_at_ms: i64
});
dto!(RoleCapability {
    capability: String,
    scope: String
});
dto!(RoleSummary { id: String, name: String, rank: i32, builtin: bool, capabilities: Vec<RoleCapability> });
dto!(MinecraftAccount { uuid: String, name: Option<String> });
dto!(RoleAssignment { role: RoleSummary, expires_at_ms: Option<i64> });
dto!(ServerUser { id: String, display_name: String, minecraft_accounts: Vec<MinecraftAccount>,
    roles: Vec<RoleAssignment>, rank: i32, device_count: u32, version: String });
dto!(UsersPage { users: Vec<ServerUser>, next_offset: Option<u32> });
dto!(ServerDevice { id: String, name: String, revoked: bool, current: bool,
    user_id: Option<String>, user_name: Option<String>, last_seen_at_ms: Option<i64> });
dto!(InvitationRole {
    id: String,
    name: String,
    rank: i32
});
dto!(Invitation { id: Option<String>, role: InvitationRole, created_at_ms: Option<i64>,
    expires_at_ms: i64, created_by: Option<String> });
dto!(IssuedInvitation { id: Option<String>, code: String, pairing_link: Option<String>, role: String, expires_at_ms: i64 });
dto!(AccessSources {
    anonymous: String,
    new_user: String,
    whitelist: String,
    whitelist_enabled: bool,
    password: String,
    version: String
});
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccessPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anonymous: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub whitelist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub whitelist_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}
impl AccessPatch {
    pub fn wire(&self, expected: &str) -> Value {
        let mut value = json!({"expected_version":expected});
        for (key, field) in [
            ("anonymous", &self.anonymous),
            ("new_user", &self.new_user),
            ("whitelist", &self.whitelist),
            ("password", &self.password),
        ] {
            if let Some(text) = field {
                value[key] = json!(text);
            }
        }
        if let Some(enabled) = self.whitelist_enabled {
            value["whitelist_enabled"] = json!(enabled);
        }
        value
    }
}
dto!(PackOutcome {
    hosted_revision: String,
    minimum_revision: String
});

struct Confirmation {
    token: zeroize::Zeroizing<String>,
    intent: String,
    expires: i64,
    job: Option<BackupJob>,
}
#[derive(Default)]
pub(super) struct State {
    confirmations: Mutex<HashMap<String, Confirmation>>,
    prepares: Mutex<HashSet<String>>,
    names: Mutex<Option<(Instant, HashMap<String, String>)>>,
}

fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T> {
    from_wire(value)
}
fn field(value: &Value, key: &str) -> Result<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| Error::new(ErrorCode::Unsupported))
}
pub(super) fn segment(text: &str) -> Result<&str> {
    if text.is_empty()
        || text.len() > 256
        || !text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
    {
        return Err(Error::new(ErrorCode::InvalidInput));
    }
    Ok(text)
}
fn query(route: &str, name: &str, value: &str) -> Result<String> {
    if value.len() > 512 || value.chars().any(char::is_control) {
        return Err(Error::new(ErrorCode::InvalidInput));
    }
    Ok(format!(
        "{route}?{}",
        url::form_urlencoded::Serializer::new(String::new())
            .append_pair(name, value)
            .finish()
    ))
}
fn route_missing(e: &Error) -> bool {
    matches!(e.code, ErrorCode::NotFound | ErrorCode::Unsupported)
}
fn unsupported_route(e: Error) -> Error {
    if route_missing(&e) {
        Error::new(ErrorCode::Unsupported)
    } else {
        e
    }
}

impl Client {
    /// No response cache: invitation codes and other issued credentials are returned once.
    pub async fn management_mutate(
        &self,
        method: Method,
        route: &str,
        body: Option<Value>,
        intent: &str,
        capability: &str,
    ) -> Result<Value> {
        let key = self.intent_key(intent)?;
        self.request(
            method,
            &format!("/api/v3/manage/{route}"),
            body,
            Some(&key),
            true,
            capability,
        )
        .await
    }
    pub async fn users(&self, offset: u32) -> Result<UsersPage> {
        if offset > 1_000_000 {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        let page: UsersPage = decode(
            self.get(
                &format!("users?offset={offset}&limit=100"),
                true,
                "principals.view",
            )
            .await?,
        )?;
        let mut cache = self.management.names.lock().await;
        if offset == 0 && page.next_offset.is_none() {
            *cache = Some((
                Instant::now(),
                page.users
                    .iter()
                    .map(|u| (u.id.clone(), u.display_name.clone()))
                    .collect(),
            ));
        } else {
            // A partial UI page must not masquerade as a complete display-name cache.
            *cache = None;
        }
        Ok(page)
    }
    async fn names(&self) -> HashMap<String, String> {
        // Refresh at most once per minute, including denied lookups. Never expose IDs as names.
        let mut cache = self.management.names.lock().await;
        if let Some((at, names)) = cache.as_ref() {
            if at.elapsed() < Duration::from_secs(60) {
                return names.clone();
            }
        }
        let mut names = HashMap::new();
        let mut offset = 0;
        for _ in 0..10 {
            let page = self
                .get(
                    &format!("users?offset={offset}&limit=100"),
                    true,
                    "principals.view",
                )
                .await
                .and_then(decode::<UsersPage>);
            let Ok(page) = page else {
                break;
            };
            for user in page.users {
                names.insert(user.id, user.display_name);
            }
            match page.next_offset {
                Some(next) if next > offset => offset = next,
                _ => break,
            }
        }
        *cache = Some((Instant::now(), names.clone()));
        names
    }
    pub async fn backups(&self, before: Option<&str>) -> Result<BackupOverview> {
        let route = before
            .map(|b| query("backups", "before", b))
            .transpose()?
            .unwrap_or_else(|| "backups".into());
        let mut overview: BackupOverview = decode(self.get(&route, true, "backups.view").await?)?;
        let names = self.names().await;
        for job in &mut overview.jobs {
            job.requested_by = job
                .requested_by
                .as_ref()
                .and_then(|id| names.get(id).cloned());
        }
        Ok(overview)
    }
    pub async fn backup_job(&self, id: &str) -> Result<BackupJob> {
        self.backup_job_with_priority(id, true).await
    }
    pub async fn backup_job_with_priority(&self, id: &str, interactive: bool) -> Result<BackupJob> {
        let value = self
            .get(
                &format!("backups/jobs/{}", segment(id)?),
                interactive,
                "backups.view",
            )
            .await?;
        let mut job: BackupJob = decode(
            value
                .get("job")
                .cloned()
                .ok_or_else(|| Error::new(ErrorCode::Unsupported))?,
        )?;
        let names = if interactive {
            self.names().await
        } else {
            self.management
                .names
                .lock()
                .await
                .as_ref()
                .map(|(_, n)| n.clone())
                .unwrap_or_default()
        };
        job.requested_by = job
            .requested_by
            .as_ref()
            .and_then(|id| names.get(id).cloned());
        Ok(job)
    }
    pub async fn backup_snapshots(&self, profile: &str) -> Result<Vec<BackupSnapshot>> {
        let mut snapshots = Vec::new();
        let mut pages = 0;
        for (route, safety) in [
            ("backups/snapshots", false),
            ("backups/safety-snapshots", true),
        ] {
            let base = query(route, "profile", profile)?;
            let mut next = None;
            let mut cursors = HashSet::new();
            for page in 0..4 {
                if pages >= 4 {
                    return Err(Error::new(ErrorCode::ServerBusy));
                }
                pages += 1;
                let route = match next.as_deref() {
                    Some(cursor) => format!(
                        "{base}&{}",
                        url::form_urlencoded::Serializer::new(String::new())
                            .append_pair("before", cursor)
                            .finish()
                    ),
                    None => base.clone(),
                };
                let route = format!("{route}&limit=100");
                let value = self.get(&route, true, "backups.view").await?;
                let rows = value["snapshots"]
                    .as_array()
                    .ok_or_else(|| Error::new(ErrorCode::Unsupported))?;
                for row in rows {
                    let time = field(row, "time")?;
                    if snapshot_time(&time).is_none() {
                        return Err(Error::new(ErrorCode::Unsupported));
                    }
                    snapshots.push(BackupSnapshot {
                        id: field(row, "id")?,
                        time,
                        safety,
                    });
                }
                next = value["next_before"].as_str().map(str::to_owned);
                match &next {
                    None => break, // Older agents return the entire listing without a cursor.
                    Some(cursor)
                        if cursor.len() <= 512 && cursors.insert(cursor.clone()) && page < 3 => {}
                    Some(_) => return Err(Error::new(ErrorCode::ServerBusy)),
                }
            }
        }
        // RFC3339 offsets/fractions must be compared as instants, not lexicographically.
        snapshots.sort_by(|a, b| {
            snapshot_time(&b.time)
                .cmp(&snapshot_time(&a.time))
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(snapshots)
    }
    pub async fn backup_snapshot(&self, profile: &str, id: &str) -> Result<BackupSnapshotDetail> {
        if id.len() != 32
            || !id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        let route = query(&format!("backups/snapshots/{id}"), "profile", profile)?;
        let value = self.get(&route, true, "backups.view").await?;
        if value.is_null() {
            return Err(Error::new(ErrorCode::NotFound));
        }
        decode(value["snapshot"].clone())
    }
    pub async fn backup_storage(&self) -> Result<BackupStorage> {
        let mut value = self.get("backups/storage", true, "backups.view").await?;
        value["stopped"] = value["backups_stopped"].clone();
        decode(value)
    }
    pub async fn backup_submit(
        &self,
        action: &str,
        body: Value,
        intent: &str,
    ) -> Result<BackupJob> {
        let capability = match action {
            "run" => "backups.create",
            "verify" => "backups.verify",
            "restore" => "backups.restore",
            _ => return Err(Error::new(ErrorCode::InvalidInput)),
        };
        let value = self
            .management_mutate(
                Method::POST,
                &format!("backups/{action}"),
                Some(body),
                intent,
                capability,
            )
            .await?;
        let id = field(&value, "job_id")?;
        // Receipt is already accepted; a detail read failure must not suggest resubmission.
        self.names().await;
        self.backup_job(&id)
            .await
            .map_err(|_| Error::new(ErrorCode::OutcomeUnknown))
    }
    pub async fn backup_restore_prepare(
        &self,
        body: Value,
        intent: &str,
    ) -> Result<RestorePreparation> {
        let key = self.intent_key(intent)?;
        {
            let mut used = self.management.prepares.lock().await;
            if used.contains(&key) {
                return Err(Error::new(ErrorCode::OutcomeUnknown));
            }
            if used.len() >= 4096 {
                return Err(Error::new(ErrorCode::ServerBusy));
            }
            used.insert(key.clone());
        }
        let mut confirmations = self.management.confirmations.lock().await;
        confirmations.retain(|_, c| c.expires > crate::now_ms());
        if confirmations.len() >= 64 {
            return Err(Error::new(ErrorCode::ServerBusy));
        }
        let token = self.token(None).await?;
        // Deliberately bypass request()'s 401 retry: the agent does not replay prepare.
        let mut value = self
            .transport
            .request(
                Method::POST,
                "/api/v3/manage/backups/restore-in-place",
                Some(&token),
                Some(body.clone()),
                Some(&key),
                true,
            )
            .await?;
        let secret = value
            .as_object_mut()
            .and_then(|v| v.remove("confirmation_token"))
            .and_then(|v| v.as_str().map(str::to_owned))
            .map(zeroize::Zeroizing::new)
            .ok_or_else(|| Error::new(ErrorCode::OutcomeUnknown))?;
        let id = field(&value, "job_id").map_err(|_| Error::new(ErrorCode::OutcomeUnknown))?;
        let expires = value["expires_at_ms"]
            .as_i64()
            .ok_or_else(|| Error::new(ErrorCode::OutcomeUnknown))?;
        // Retain the secret before reading details; a failed read must never cause
        // preparation to be submitted again. All displayed facts come from the agent.
        confirmations.insert(
            id.clone(),
            Confirmation {
                token: secret,
                intent: intent.into(),
                expires,
                job: None,
            },
        );
        drop(confirmations);
        let job = self
            .backup_job(&id)
            .await
            .map_err(|_| Error::new(ErrorCode::OutcomeUnknown))?;
        if let Some(c) = self.management.confirmations.lock().await.get_mut(&id) {
            c.job = Some(job.clone());
        }
        Ok(RestorePreparation {
            job,
            expires_at_ms: expires,
        })
    }
    pub async fn backup_restore_confirm(&self, id: &str) -> Result<BackupJob> {
        segment(id)?;
        let c = self
            .management
            .confirmations
            .lock()
            .await
            .remove(id)
            .ok_or_else(|| Error::new(ErrorCode::ConfirmationExpired))?;
        if c.expires <= crate::now_ms() {
            return Err(Error::new(ErrorCode::ConfirmationExpired));
        }
        let token = self.token(None).await?;
        let key = self.intent_key(&format!("backup-confirm:{}", intent_key(&c.intent)?))?;
        // A consumed one-time token is never replayed after an ambiguous response.
        self.transport
            .request(
                Method::POST,
                &format!("/api/v3/manage/backups/jobs/{id}/confirm"),
                Some(&token),
                Some(json!({"confirmation_token":c.token.as_str()})),
                Some(&key),
                true,
            )
            .await?;
        let mut job = match c.job {
            Some(job) => job,
            None => self
                .backup_job(id)
                .await
                .map_err(|_| Error::new(ErrorCode::OutcomeUnknown))?,
        };
        job.state = "queued".into();
        Ok(job)
    }
    pub async fn backup_resolve_recovery(&self, id: &str) -> Result<BackupJob> {
        segment(id)?;
        // This IPC has no intentId. A job-scoped key represents its single resolution intent.
        self.management_mutate(
            Method::POST,
            &format!("backups/jobs/{id}/resolve-recovery"),
            Some(json!({})),
            &format!("backup-recovery:{id}"),
            "backups.restore",
        )
        .await?;
        self.backup_job(id)
            .await
            .map_err(|_| Error::new(ErrorCode::OutcomeUnknown))
    }
    pub async fn roles(&self) -> Result<Vec<RoleSummary>> {
        let value = self.get("roles", true, "principals.view").await?;
        decode(value["roles"].clone())
    }
    pub async fn user_roles(&self, id: &str, body: Value, intent: &str) -> Result<ServerUser> {
        let value = self
            .management_mutate(
                Method::PUT,
                &format!("users/{}/roles", segment(id)?),
                Some(body),
                intent,
                "principals.manage",
            )
            .await?;
        *self.management.names.lock().await = None;
        decode(value)
    }
    pub async fn devices(&self) -> Result<Vec<ServerDevice>> {
        match self.device_pages().await {
            Ok(v) => Ok(v),
            Err(e) if route_missing(&e) => self.legacy_devices().await,
            Err(e) => Err(e),
        }
    }
    async fn device_pages(&self) -> Result<Vec<ServerDevice>> {
        let mut result = Vec::new();
        let mut offset = 0;
        for _ in 0..4 {
            let value = self
                .get(
                    &format!("devices?offset={offset}&limit=100"),
                    true,
                    "devices.revoke",
                )
                .await?;
            let rows = value["devices"]
                .as_array()
                .ok_or_else(|| Error::new(ErrorCode::Unsupported))?;
            for row in rows {
                result.push(device(row, &self.device_id, None)?);
            }
            match next_offset(&value, offset)? {
                Some(next) => offset = next,
                None => return Ok(result),
            }
        }
        Err(Error::new(ErrorCode::ServerBusy))
    }
    async fn legacy_devices(&self) -> Result<Vec<ServerDevice>> {
        let mut result = Vec::new();
        let mut offset = 0;
        let mut count = 0;
        // Bounded compatibility fallback. Never truncate silently.
        for _ in 0..4 {
            let page = self.users(offset).await?;
            for user in page.users {
                count += 1;
                if count > 24 {
                    return Err(Error::new(ErrorCode::ServerBusy).local_pressure());
                }
                let value = match self
                    .get(
                        &format!("users/{}/devices", segment(&user.id)?),
                        true,
                        "", // A rank-scoped refusal is not a global capability refusal.
                    )
                    .await
                {
                    Ok(v) => v,
                    Err(e) if e.code == ErrorCode::Forbidden => continue,
                    Err(e) => return Err(e),
                };
                for row in value["devices"]
                    .as_array()
                    .ok_or_else(|| Error::new(ErrorCode::Unsupported))?
                {
                    if result.len() >= 1000 {
                        return Err(Error::new(ErrorCode::ServerBusy));
                    }
                    result.push(device(row, &self.device_id, Some(&user))?);
                }
            }
            match page.next_offset {
                Some(next) if next > offset => offset = next,
                None => return Ok(result),
                _ => return Err(Error::new(ErrorCode::Unsupported)),
            }
        }
        Err(Error::new(ErrorCode::ServerBusy))
    }
    pub async fn device_revoke(&self, id: &str, intent: &str) -> Result<()> {
        self.management_mutate(
            Method::DELETE,
            &format!("devices/{}", segment(id)?),
            None,
            intent,
            "devices.revoke",
        )
        .await?;
        Ok(())
    }
    pub async fn invitations(&self) -> Result<Vec<Invitation>> {
        let mut result = Vec::new();
        let mut offset = 0;
        for _ in 0..4 {
            let value = self
                .get(
                    &format!("invitations?offset={offset}&limit=100"),
                    true,
                    "invitations.create",
                )
                .await
                .map_err(unsupported_route)?;
            for row in value["invitations"]
                .as_array()
                .ok_or_else(|| Error::new(ErrorCode::Unsupported))?
            {
                let mut row = row.clone();
                row["created_by"] = row
                    .pointer("/created_by/display_name")
                    .cloned()
                    .unwrap_or(Value::Null);
                result.push(decode(row)?);
            }
            match next_offset(&value, offset)? {
                Some(next) => offset = next,
                None => return Ok(result),
            }
        }
        Err(Error::new(ErrorCode::ServerBusy))
    }
    pub async fn invitation_create(
        &self,
        role: &str,
        expires_minutes: u16,
        intent: &str,
    ) -> Result<IssuedInvitation> {
        let value = self
            .management_mutate(
                Method::POST,
                "invitations",
                Some(json!({"role":role,"expires_minutes":expires_minutes})),
                intent,
                "invitations.create",
            )
            .await?;
        // Older agents omit id/pairing_link. Do not invent a public endpoint.
        // The agent's durable receipt intentionally omits the once-issued code.
        if value["issued"] == true && value.get("code").is_none() {
            return Err(Error::new(ErrorCode::OutcomeUnknown));
        }
        decode(value)
    }
    pub async fn invitation_revoke(&self, id: &str, intent: &str) -> Result<()> {
        self.management_mutate(
            Method::DELETE,
            &format!("invitations/{}", segment(id)?),
            None,
            intent,
            "invitations.create",
        )
        .await?;
        Ok(())
    }
    pub async fn access_sources(&self) -> Result<AccessSources> {
        access(
            self.get("access-sources", true, "access-sources.manage")
                .await?,
        )
    }
    pub async fn access_sources_update(
        &self,
        patch: &AccessPatch,
        expected: &str,
        intent: &str,
    ) -> Result<AccessSources> {
        access(
            self.management_mutate(
                Method::PATCH,
                "access-sources",
                Some(patch.wire(expected)),
                intent,
                "access-sources.manage",
            )
            .await?,
        )
    }
    pub async fn pack_publish(&self, expected: &str, intent: &str) -> Result<PackOutcome> {
        decode(
            self.management_mutate(
                Method::POST,
                "pack/publish",
                Some(json!({"expected_revision":expected})),
                intent,
                "pack.publish",
            )
            .await?,
        )
    }
    pub async fn pack_minimum(
        &self,
        expected: &str,
        minimum: &str,
        intent: &str,
    ) -> Result<PackOutcome> {
        decode(
            self.management_mutate(
                Method::POST,
                "pack/minimum",
                Some(json!({"expected_revision":expected,"minimum_revision":minimum})),
                intent,
                "pack.force_update",
            )
            .await?,
        )
    }
}
fn access(value: Value) -> Result<AccessSources> {
    let mut settings = value["settings"].clone();
    settings["version"] = value["version"].clone();
    decode(settings)
}
fn next_offset(value: &Value, current: u32) -> Result<Option<u32>> {
    match value.get("next_offset") {
        Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_u64()
            .filter(|&n| n > u64::from(current) && n <= 1_000_000)
            .map(|n| Some(n as u32))
            .ok_or_else(|| Error::new(ErrorCode::Unsupported)),
        None => Err(Error::new(ErrorCode::Unsupported)),
    }
}
fn device(row: &Value, own: &str, user: Option<&ServerUser>) -> Result<ServerDevice> {
    let id = field(row, "id")?;
    Ok(ServerDevice {
        current: row["current"].as_bool().unwrap_or(id == own),
        id,
        name: field(row, "name")?,
        revoked: row["revoked"]
            .as_bool()
            .ok_or_else(|| Error::new(ErrorCode::Unsupported))?,
        user_id: row
            .pointer("/user/id")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| user.map(|u| u.id.clone())),
        user_name: row
            .pointer("/user/display_name")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| user.map(|u| u.display_name.clone())),
        last_seen_at_ms: row["last_seen_at_ms"].as_i64(),
    })
}
fn snapshot_time(text: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(text).ok()
}
