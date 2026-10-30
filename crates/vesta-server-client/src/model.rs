use serde::{Deserialize, Serialize};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidAddress,
    Unreachable,
    Timeout,
    TlsFailed,
    FingerprintMismatch,
    PairCodeInvalid,
    PairOutcomeUnknown,
    CredentialsRejected,
    CredentialsUnavailable,
    NoManagementAccess,
    Forbidden,
    NotFound,
    StaleTarget,
    ConfirmationExpired,
    Conflict,
    RateLimited,
    ServerBusy,
    BackupsNotConfigured,
    Unsupported,
    OutcomeUnknown,
    InvalidInput,
    Internal,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Error {
    pub code: ErrorCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
    /// No request reached the agent. Preserve provenance over IPC so the UI
    /// does not blame the server for the launcher's own request pacing.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub local_pressure: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<ProviderErrorDetails>,
}
/// A bounded public file identity, never a provider response, URL or credential.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderErrorDetails {
    pub stage: String,
    pub reason: Option<String>,
    pub provider: String,
    pub project_id: String,
    pub version_id: String,
    pub filename: Option<String>,
}
impl Error {
    pub(crate) fn with_provider_details(mut self, value: &serde_json::Value) -> Self {
        if !self
            .reason
            .as_deref()
            .is_some_and(|reason| reason.starts_with("content_pack_"))
        {
            return self;
        }
        let valid_id = |s: &str| {
            s.len() <= 128
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
        };
        let details = serde_json::from_value::<ProviderErrorDetails>(value.clone()).ok();
        self.details = details.filter(|d| {
            matches!(d.stage.as_str(), "metadata" | "download")
                && d.reason.as_deref().is_none_or(|r| matches!(r, "filename_not_portable" | "download_host_not_allowed" | "redirect_limit_exceeded" | "manual_download_required" | "provider_request_failed"))
                && matches!(d.provider.as_str(), "curseforge" | "modrinth")
                && !d.project_id.is_empty()
                && valid_id(&d.project_id)
                && valid_id(&d.version_id)
                && d.filename.as_ref().is_none_or(|s| {
                    !s.is_empty()
                        && s.len() <= 256
                        && s.chars().all(|c| !c.is_control() && !matches!(c, '/' | '\\' | ':'))
                })
        });
        self
    }
    pub fn wire_for_route(status: u16, code: &str, retry: Option<u64>, path: &str) -> Self {
        let mut error = Self::wire(status, code, retry);
        // Pre-inventory permission adapters recognized these paths but rejected
        // their fixed, valid GET queries as invalid_request rather than 501.
        if status == 400
            && code == "invalid_request"
            && (path.starts_with("/api/v3/manage/invitations?")
                || path.starts_with("/api/v3/manage/devices?"))
        {
            error.code = ErrorCode::Unsupported;
        }
        if status == 409
            && code != "idempotency_conflict"
            && (path == "/api/v3/manage/access-sources"
                || (path.starts_with("/api/v3/manage/users/") && path.ends_with("/roles")))
        {
            error.code = ErrorCode::StaleTarget;
        }
        error
    }
    pub fn new(code: ErrorCode) -> Self {
        Self {
            code,
            retry_after_ms: None,
            local_pressure: false,
            reason: None,
            details: None,
        }
    }
    pub fn local_pressure(mut self) -> Self {
        self.local_pressure = true;
        self
    }
    pub fn wire(status: u16, code: &str, retry_after_ms: Option<u64>) -> Self {
        let reason = (code.len() <= 96
            && code
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.'))
            && [
                "software_",
                "world_",
                "sftp_",
                "content_",
                "pack_",
                "server_install.",
            ]
            .iter()
            .any(|prefix| code.starts_with(prefix)))
        .then(|| code.to_owned());
        use ErrorCode::*;
        let code = match code {
            "software_runtime_unavailable" | "software_disabled" => Unsupported,
            "software_busy" | "pack_storage_low" => ServerBusy,
            "software_plan_expired" | "software_confirmation_invalid" => ConfirmationExpired,
            "software_revision_conflict" | "world_state_conflict" => StaleTarget,
            "recovery_required" if status == 409 => OutcomeUnknown,
            "backup_busy" => ServerBusy,
            "backups_not_configured" => BackupsNotConfigured,
            "backup_profile_unknown" | "backup_job_unknown" | "backup_snapshot_unknown" => NotFound,
            "backup_confirmation_invalid" | "backup_confirmation_expired" => ConfirmationExpired,
            "backup_policy_revision_conflict"
            | "sleep_policy_conflict"
            | "motd_policy_conflict" => StaleTarget,
            "backup_idempotency_conflict" => Conflict,
            "management_pair_invalid" | "pair_invalid" => PairCodeInvalid,
            "confirmation_invalid" | "confirmation_expired" | "confirmation_required" => {
                ConfirmationExpired
            }
            "management_session_invalid" | "device_session_required" => CredentialsRejected,
            "management_unavailable" | "pack_access_denied" if status == 403 => NoManagementAccess,
            "not_implemented" | "legacy_endpoint_removed" => Unsupported,
            _ => match status {
                400 | 413 | 416 | 422 => InvalidInput,
                401 => CredentialsRejected,
                403 => Forbidden,
                404 => NotFound,
                409 => Conflict,
                412 => StaleTarget,
                429 => RateLimited,
                501 => Unsupported,
                502..=504 => ServerBusy,
                _ => Internal,
            },
        };
        Self {
            code,
            retry_after_ms,
            local_pressure: false,
            reason,
            details: None,
        }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self.code)
    }
}
impl std::error::Error for Error {}

macro_rules! dto {
    ($name:ident { $($field:ident: $ty:ty),* $(,)? }) => {
        #[derive(Clone, Debug, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase")]
        pub struct $name { $(pub $field: $ty),* }
    }
}
dto!(ServerConnection {
    id: String, name: String, endpoint: String, server_id: String, fingerprint: String,
    role: Option<String>, sign_in_method: String, memory_only: bool, pinned: bool,
    added_at_ms: i64, last_connected_at_ms: Option<i64>,
});
dto!(ConnectionState {
    phase: String, access: String, retry_at_ms: Option<i64>,
    rate_limited_until_ms: Option<i64>, last_error: Option<ErrorCode>,
});
impl Default for ConnectionState {
    fn default() -> Self {
        Self {
            phase: "disconnected".into(),
            access: "paired".into(),
            retry_at_ms: None,
            rate_limited_until_ms: None,
            last_error: None,
        }
    }
}
impl ConnectionState {
    /// An operation deadline is not evidence that the agent is offline. Status
    /// refreshes and authenticated status events own the connectivity observation.
    pub fn observe_request_failure(&mut self, error: &Error, now_ms: i64) {
        if error.local_pressure {
            return;
        }
        self.last_error = Some(error.code);
        match error.code {
            ErrorCode::FingerprintMismatch => {
                self.access = "fingerprint_changed".into();
                self.phase = "unreachable".into();
            }
            ErrorCode::CredentialsRejected => self.access = "credentials_rejected".into(),
            ErrorCode::CredentialsUnavailable => self.access = "credentials_unavailable".into(),
            ErrorCode::NoManagementAccess => self.access = "no_management_access".into(),
            ErrorCode::RateLimited => {
                self.phase = "backoff".into();
                self.retry_at_ms = Some(self.rate_limited_until_ms.unwrap_or_else(|| {
                    now_ms.saturating_add(
                        error.retry_after_ms.unwrap_or(10_000).min(i64::MAX as u64) as i64,
                    )
                }));
            }
            ErrorCode::Unreachable | ErrorCode::TlsFailed => self.phase = "unreachable".into(),
            _ => {}
        }
    }
}
dto!(SupervisorStatus {
    orphan_running: bool, launch_unresolved: bool, observation_failed: bool,
    crash_restart_enabled: bool, crash_loop: bool, restart_state_unsaved: bool,
    recent_crashes: u32, restart_pending_ms: Option<String>,
});
dto!(ServerStatus {
    state: String, lifecycle: Option<String>, generation: Option<String>,
    player_count: Option<u32>, player_count_known: bool, player_count_observed_at_ms: Option<i64>,
    player_roster_revision: Option<String>,
    sleep_blocker: Option<crate::presence::SleepBlocker>,
    sleep_available: Option<bool>, on_agent_start: Option<String>,
    uptime_seconds: Option<String>, readiness: String, readiness_reason: Option<String>,
    readiness_evidence: String, supervision: String, supervisor: Option<SupervisorStatus>,
});
dto!(ServerInfo {
    server_id: String,
    name: String,
    agent_version: String,
    minecraft_version: String,
    pack_version: String,
    game_port: Option<u16>, backups_configured: Option<bool>, join_address: Option<String>
});
dto!(PackStatus { hosted_revision: Option<String>, minimum_revision: Option<String>, status: String });
dto!(CapabilityView { source: String, granted: Vec<String>, refused: Vec<String>, roles: Option<Vec<String>> });
dto!(ServerSnapshot {
    connection: ServerConnection, state: ConnectionState, info: Option<ServerInfo>,
    status: Option<ServerStatus>, status_observed_at_ms: Option<i64>, pack: Option<PackStatus>,
    capabilities: CapabilityView, restart_required: bool,
    join_address: Option<String>, backups_configured: Option<bool>,
});
dto!(Discovery {
    discovery_id: String, endpoint: String, server_id: String, fingerprint: String,
    public_lifecycle: Option<String>, expected_fingerprint: Option<String>,
    link_code: Option<String>, existing_connection_id: Option<String>, secure_storage_available: bool,
});
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerOperation {
    pub operation_id: String,
    #[serde(default)]
    pub intent: Option<String>,
    #[serde(deserialize_with = "operation_state")]
    pub state: String,
    pub progress_percent: Option<u8>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub finished_at_ms: Option<i64>,
    #[serde(default)]
    pub reconciling: bool,
    pub kind: Option<String>,
    pub actor: Option<Box<OperationActor>>,
    pub summary: Option<Box<OperationSummary>>,
    pub outcome: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum OperationActor {
    Principal {
        principal_id: String,
        display_name: String,
        device_name: Option<String>,
        #[serde(rename = "self")]
        is_self: bool,
    },
    Workflow {
        name: String,
    },
    System {
        name: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase")]
pub enum OperationSummary {
    #[serde(rename = "console.command")]
    ConsoleCommand { command: Option<String> },
    #[serde(rename = "players.moderate")]
    PlayersModerate {
        action: String,
        player: String,
        reason: Option<String>,
        duration_seconds: Option<u64>,
    },
    #[serde(rename = "lifecycle")]
    Lifecycle {
        action: LifecycleAction,
        target_generation: Option<String>,
        result_generation: Option<String>,
    },
    #[serde(rename = "purged")]
    Purged,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleAction {
    Sleep,
    Wake,
    Start,
    Stop,
    Restart,
    Kill,
}
impl ServerOperation {
    pub fn terminal(&self) -> bool {
        matches!(
            self.state.as_str(),
            "succeeded" | "failed" | "cancelled" | "recovery_required"
        )
    }
}
fn operation_state<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<String, D::Error> {
    let value = String::deserialize(d)?;
    if matches!(
        value.as_str(),
        "queued"
            | "validating"
            | "awaiting_confirmation"
            | "running"
            | "cancelling"
            | "succeeded"
            | "failed"
            | "cancelled"
            | "recovery_required"
    ) {
        Ok(value)
    } else {
        Err(serde::de::Error::custom("unknown operation state"))
    }
}
impl ServerStatus {
    pub fn validate(&self) -> Result<()> {
        if !matches!(
            self.state.as_str(),
            "stopped" | "running" | "stopping" | "draining"
        ) || !matches!(
            self.readiness.as_str(),
            "stopped" | "starting" | "ready" | "degraded"
        ) || !matches!(
            self.readiness_evidence.as_str(),
            "log_and_probe" | "log_only"
        ) || !matches!(self.supervision.as_str(), "in_process" | "separate")
            || self.lifecycle.as_ref().is_some_and(|v| {
                !matches!(
                    v.as_str(),
                    "offline"
                        | "sleeping"
                        | "waking"
                        | "starting"
                        | "online"
                        | "stopping"
                        | "crash_loop"
                        | "recovery_required"
                )
            })
            || self.readiness_reason.as_ref().is_some_and(|v| {
                !matches!(
                    v.as_str(),
                    "startup_timeout" | "probe_failed" | "fatal_output" | "console_gap"
                )
            })
        {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        if let Some(g) = &self.generation {
            crate::operations::generation(g).map_err(|_| Error::new(ErrorCode::Unsupported))?;
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
}
dto!(ConsoleLine {
    cursor: String,
    text: String,
    truncated: bool
});
dto!(ConsolePage { items: Vec<ConsoleLine>, next_cursor: Option<String>, latest_cursor: String });
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PlayersView {
    Known {
        known: bool,
        generation: String,
        #[serde(rename = "playerCount")]
        player_count: u32,
        names: Vec<String>,
    },
    Unknown {
        known: bool,
    },
}
dto!(WhitelistEntry {
    name: String,
    uuid: String
});
dto!(OperatorEntry {
    name: String,
    uuid: String,
    level: u8,
    bypasses_player_limit: bool
});
dto!(BanEntry {
    name: String,
    uuid: String,
    reason: String,
    created: String,
    expires: String,
    source: String
});
dto!(MetricsSample {
    at_ms: i64, cpu_percent: Option<f64>, memory_used_bytes: Option<String>,
    memory_max_bytes: Option<String>, tps: Option<f64>, mspt: Option<f64>, players_online: Option<u32>,
});
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerTopic {
    Status,
    Console,
    Metrics,
    Operations,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ServerEvent {
    Snapshot { snapshot: Box<ServerSnapshot> },
    Console { lines: Vec<ConsoleLine> },
    ConsoleHistory { lines: Vec<ConsoleLine> },
    Players { players: PlayersView },
    ConsoleGap { cursor: String },
    Metrics { sample: MetricsSample },
    Operation { operation: ServerOperation },
    PlayerListsChanged,
    Resync { topic: ServerTopic },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum ModerationAction {
    Kick {
        player: String,
        reason: Option<String>,
    },
    Ban {
        player: String,
        reason: Option<String>,
        #[serde(rename = "durationSeconds")]
        duration_seconds: Option<u64>,
    },
    Pardon {
        player: String,
    },
    WhitelistAdd {
        player: String,
    },
    WhitelistRemove {
        player: String,
    },
    Op {
        player: String,
    },
    Deop {
        player: String,
    },
    Kill {
        player: String,
    },
    Lightning {
        player: String,
    },
}
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ModerationResult {
    Operation {
        operation: ServerOperation,
    },
    AwaitingConfirmation {
        #[serde(rename = "expiresAtMs")]
        expires_at_ms: i64,
    },
}
dto!(KillPreparation {
    operation_id: String,
    expires_at_ms: i64
});
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionPatch {
    pub name: Option<String>,
    pub pinned: Option<bool>,
}

/// Wire keys are snake_case, IPC keys are camelCase. Values (IDs/counters) are untouched.
pub fn from_wire<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> Result<T> {
    fn convert(value: serde_json::Value) -> serde_json::Value {
        match value {
            serde_json::Value::Object(map) => serde_json::Value::Object(
                map.into_iter()
                    .map(|(k, v)| {
                        let mut upper = false;
                        let key = k
                            .chars()
                            .filter_map(|c| {
                                if c == '_' {
                                    upper = true;
                                    None
                                } else if upper {
                                    upper = false;
                                    Some(c.to_ascii_uppercase())
                                } else {
                                    Some(c)
                                }
                            })
                            .collect();
                        // Ownership dictionaries contain literal relative paths.
                        let opaque_files = k == "files"
                            && v.as_object()
                                .is_some_and(|m| m.values().all(serde_json::Value::is_string));
                        (key, if opaque_files { v } else { convert(v) })
                    })
                    .collect(),
            ),
            serde_json::Value::Array(v) => {
                serde_json::Value::Array(v.into_iter().map(convert).collect())
            }
            other => other,
        }
    }
    serde_json::from_value(convert(value)).map_err(|_| Error::new(ErrorCode::Unsupported))
}

#[cfg(test)]
mod provider_error_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn slow_operation_does_not_erase_live_connection_but_connection_failure_does() {
        let mut state = ConnectionState {
            phase: "online".into(),
            ..Default::default()
        };
        for code in [
            ErrorCode::Timeout,
            ErrorCode::OutcomeUnknown,
            ErrorCode::ServerBusy,
        ] {
            state.observe_request_failure(&Error::new(code), 1000);
            assert_eq!(state.phase, "online");
            assert_eq!(state.access, "paired");
            assert_eq!(state.last_error, Some(code));
        }
        state.observe_request_failure(&Error::new(ErrorCode::Unreachable), 1000);
        assert_eq!(state.phase, "unreachable");
        state.phase = "online".into();
        state.observe_request_failure(&Error::new(ErrorCode::FingerprintMismatch), 1000);
        assert_eq!(state.phase, "unreachable");
        assert_eq!(state.access, "fingerprint_changed");
    }
    #[test]
    fn local_pressure_preserves_connection_and_remote_rate_limit_preserves_retry() {
        let mut state = ConnectionState {
            phase: "online".into(),
            ..Default::default()
        };
        state.observe_request_failure(&Error::new(ErrorCode::RateLimited).local_pressure(), 1000);
        assert_eq!(state.phase, "online");
        assert!(state.last_error.is_none());
        state.rate_limited_until_ms = Some(7000);
        state.observe_request_failure(&Error::new(ErrorCode::RateLimited), 1000);
        assert_eq!(state.phase, "backoff");
        assert_eq!(state.retry_at_ms, Some(7000));
        state.observe_request_failure(&Error::new(ErrorCode::CredentialsRejected), 1000);
        assert_eq!(state.access, "credentials_rejected");
    }
    #[test]
    fn pack_reasons_and_public_file_details_survive_ipc() {
        let details = json!({"stage":"metadata","provider":"curseforge","projectId":"1691925","versionId":"9022781","filename":"mielon's-the-sift+26.3.jar", "downloadUrl":"https://ignored.invalid/private"});
        let error = Error::wire(422, "content_pack_download_unavailable", None)
            .with_provider_details(&details);
        assert_eq!(error.code, ErrorCode::InvalidInput);
        let ipc = serde_json::to_value(&error).unwrap();
        assert_eq!(ipc["details"]["filename"], "mielon's-the-sift+26.3.jar");
        assert_eq!(ipc["details"]["projectId"], "1691925");
        assert!(ipc["details"].get("downloadUrl").is_none());
        assert_eq!(
            Error::wire(400, "pack_path_invalid", None)
                .reason
                .as_deref(),
            Some("pack_path_invalid")
        );
    }
    #[test]
    fn untrusted_error_details_are_bounded_and_never_general_response_text() {
        let good = json!({"stage":"download","provider":"curseforge","projectId":"1","versionId":"2","filename":"mod.jar"});
        for (field, bad) in [
            ("stage", "arbitrary response".into()),
            ("provider", "https://private.invalid".into()),
            ("projectId", "id\nsecret".into()),
            ("filename", "../private.jar".into()),
            ("filename", "a".repeat(257)),
            ("filename", "bad\u{202e}.jar".into()),
        ] {
            let mut value = good.clone();
            value[field] = json!(bad);
            let error = Error::wire(502, "content_pack_download_failed", None)
                .with_provider_details(&value);
            assert!(error.details.is_none(), "accepted {field}");
        }
        assert!(Error::wire(400, "invalid_request", None)
            .with_provider_details(&good)
            .details
            .is_none());
        let old = Error::wire(400, "invalid_request", None);
        assert!(serde_json::to_value(old).unwrap().get("details").is_none());
    }
}
