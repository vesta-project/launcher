//! Typed automation projections. Preset params and arbitrary JSON remain opaque.
use super::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
fn unsupported() -> Error {
    Error::new(ErrorCode::Unsupported)
}
fn invalid() -> Error {
    Error::new(ErrorCode::InvalidInput)
}
fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|_| unsupported())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSelf {
    #[serde(alias = "principal_id")]
    pub principal_id: String,
    pub rank: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDefinition {
    pub trigger: WorkflowTrigger,
    #[serde(alias = "missed_policy")]
    pub missed_policy: MissedPolicy,
    pub steps: Vec<WorkflowStep>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStep {
    pub id: String,
    pub action: WorkflowAction,
    #[serde(alias = "timeout_secs")]
    pub timeout_secs: u32,
    pub retries: RetryPolicy,
    #[serde(alias = "on_success")]
    pub on_success: SuccessBranch,
    #[serde(alias = "on_failure")]
    pub on_failure: FailureBranch,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryPolicy {
    #[serde(alias = "max_retries")]
    pub max_retries: u8,
    #[serde(alias = "backoff_secs")]
    pub backoff_secs: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSummary {
    /// Missing only on older agents.
    #[serde(default)]
    pub trigger: Option<WorkflowTrigger>,
    pub id: String,
    pub name: String,
    pub enabled: bool,
    #[serde(alias = "execution_principal_id")]
    pub execution_principal_id: String,
    #[serde(alias = "created_at_ms")]
    pub created_at_ms: i64,
    #[serde(alias = "updated_at_ms")]
    pub updated_at_ms: i64,
    pub revision: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDetail {
    #[serde(flatten)]
    pub summary: WorkflowSummary,
    pub definition: WorkflowDefinition,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub id: String,
    #[serde(alias = "workflow_id")]
    pub workflow_id: String,
    #[serde(alias = "workflow_revision")]
    pub workflow_revision: u64,
    #[serde(alias = "execution_principal_id")]
    pub execution_principal_id: String,
    pub trigger: RunTrigger,
    pub state: String,
    #[serde(alias = "current_step")]
    pub current_step: u32,
    pub attempt: u32,
    #[serde(alias = "next_wake_at_ms")]
    pub next_wake_at_ms: Option<i64>,
    #[serde(alias = "started_at_ms")]
    pub started_at_ms: i64,
    #[serde(alias = "finished_at_ms")]
    pub finished_at_ms: Option<i64>,
    #[serde(alias = "outcome_code")]
    pub outcome_code: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDetail {
    #[serde(flatten)]
    pub summary: RunSummary,
    pub definition: WorkflowDefinition,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStep {
    #[serde(alias = "run_id")]
    pub run_id: String,
    pub index: u32,
    pub attempt: u32,
    pub cursor: String,
    pub state: String,
    #[serde(alias = "operation_reference")]
    pub operation_reference: Option<String>,
    pub output: Value,
    #[serde(alias = "error_code")]
    pub error_code: Option<String>,
    #[serde(alias = "started_at_ms")]
    pub started_at_ms: i64,
    #[serde(alias = "finished_at_ms")]
    pub finished_at_ms: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDraft {
    pub name: String,
    #[serde(alias = "execution_principal_id")]
    pub execution_principal_id: String,
    pub definition: WorkflowDefinition,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowMutation {
    #[serde(alias = "workflow_id")]
    pub workflow_id: String,
    pub revision: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualRunResult {
    #[serde(alias = "workflow_id")]
    pub workflow_id: String,
    #[serde(alias = "run_id")]
    pub run_id: Option<String>,
    pub skipped: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Paged<T> {
    pub items: Vec<T>,
    pub next_after: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum WorkflowTrigger {
    Manual,
    AgentStartup,
    ServerStarted,
    ServerStopped,
    ServerCrashed,
    PlayerCountZero,
    FirstPlayerJoined,
    UpdateAvailable,
    Cron {
        expr: String,
        #[serde(alias = "utc_offset_minutes")]
        utc_offset_minutes: i16,
    },
    Interval {
        seconds: u32,
    },
    BackupCompleted {
        profile: Option<String>,
    },
    BackupFailed {
        profile: Option<String>,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum MissedPolicy {
    SkipAndNotify,
    RunLatest,
    CatchUp { max: u8 },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotifySeverity {
    Info,
    Warning,
    Critical,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum WorkflowAction {
    Delay {
        secs: u32,
    },
    Backup {
        profile: String,
    },
    VerifyBackup {
        profile: String,
    },
    Start,
    Stop,
    Restart,
    CleanTrash,
    ConsoleCommand {
        line: String,
    },
    Notify {
        severity: NotifySeverity,
        title: String,
        body: String,
    },
    ScriptPreset {
        preset: String,
        params: BTreeMap<String, String>,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum SuccessBranch {
    Next,
    End,
    Goto {
        #[serde(alias = "step_id")]
        step_id: String,
    },
    IfOutputEquals {
        key: String,
        value: Value,
        #[serde(alias = "then_step")]
        then_step: String,
        otherwise: Option<String>,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum FailureBranch {
    Fail,
    Next,
    Goto {
        #[serde(alias = "step_id")]
        step_id: String,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AutomationEvent {
    AgentStarted,
    ServerStarted,
    ServerStopped,
    ServerCrashed,
    PlayerCountZero,
    FirstPlayerJoined,
    UpdateAvailable,
    BackupCompleted { profile: Option<String> },
    BackupFailed { profile: Option<String> },
}
#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum RunTrigger {
    Manual,
    Schedule { occurrence_ms: i64 },
    Event { event: AutomationEvent },
    Other,
}
impl<'de> Deserialize<'de> for RunTrigger {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        Ok(match value["kind"].as_str() {
            Some("manual") => Self::Manual,
            // engine.rs::schedule persists occurrence as UTC epoch milliseconds already.
            Some("schedule") => value
                .get("occurrence")
                .or_else(|| value.get("occurrenceMs"))
                .and_then(Value::as_i64)
                .filter(|n| *n >= 0)
                .map(|occurrence_ms| Self::Schedule { occurrence_ms })
                .unwrap_or(Self::Other),
            Some("event") => serde_json::from_value(value["event"].clone())
                .map(|event| Self::Event { event })
                .unwrap_or(Self::Other),
            _ => Self::Other,
        })
    }
}
// Convert only definition schema fields; never traverse params or branch comparison values.
fn definition_wire(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| {
                    let wire_key = match key.as_str() {
                        "utcOffsetMinutes" => "utc_offset_minutes",
                        "missedPolicy" => "missed_policy",
                        "timeoutSecs" => "timeout_secs",
                        "maxRetries" => "max_retries",
                        "backoffSecs" => "backoff_secs",
                        "onSuccess" => "on_success",
                        "onFailure" => "on_failure",
                        "stepId" => "step_id",
                        "thenStep" => "then_step",
                        _ => &key,
                    }
                    .to_owned();
                    let value = if matches!(key.as_str(), "params" | "value") {
                        value
                    } else {
                        definition_wire(value)
                    };
                    (wire_key, value)
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.into_iter().map(definition_wire).collect()),
        value => value,
    }
}
impl WorkflowDraft {
    pub fn wire(&self) -> Result<Value> {
        Ok(
            json!({"name":self.name,"execution_principal_id":self.execution_principal_id,
   "definition":definition_wire(serde_json::to_value(&self.definition).map_err(|_| invalid())?)}),
        )
    }
}
fn expected_revision(revision: u64) -> Result<u64> {
    if !(1..=9_007_199_254_740_991).contains(&revision) {
        return Err(invalid());
    }
    Ok(revision)
}
fn id(value: &str) -> Result<&str> {
    // Agent PrincipalId syntax, excluding path-normalizing dot segments.
    if value.is_empty()
        || value.len() > 128
        || matches!(value, "." | "..")
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
    {
        return Err(invalid());
    }
    Ok(value)
}
fn step_cursor(value: &Value) -> Result<String> {
    value
        .as_u64()
        .filter(|n| *n <= 191)
        .map(|n| n.to_string())
        .ok_or_else(unsupported)
}
fn page_route(route: &str, after: Option<&str>, steps: bool, limit: u16) -> Result<String> {
    if !(1..=100).contains(&limit) {
        return Err(invalid());
    }
    let mut query = url::form_urlencoded::Serializer::new(String::new());
    query.append_pair("limit", &limit.to_string());
    if let Some(after) = after {
        if steps {
            let cursor = after.parse::<u16>().map_err(|_| invalid())?;
            if cursor > 191 || cursor.to_string() != after {
                return Err(invalid());
            }
        } else {
            id(after)?;
        }
        query.append_pair("after", after);
    }
    Ok(format!("{route}?{}", query.finish()))
}
fn page<T: serde::de::DeserializeOwned>(
    mut value: Value,
    key: &str,
    steps: bool,
) -> Result<Paged<T>> {
    let next_after = match value.get("next_after").ok_or_else(unsupported)? {
        Value::Null => None,
        cursor if steps => Some(step_cursor(cursor)?),
        Value::String(cursor) => Some(cursor.clone()),
        _ => return Err(unsupported()),
    };
    let items = value
        .get_mut(key)
        .and_then(Value::as_array_mut)
        .ok_or_else(unsupported)?;
    if steps {
        for item in items.iter_mut() {
            let cursor = step_cursor(&item["cursor"])?;
            item.as_object_mut()
                .ok_or_else(unsupported)?
                .insert("cursor".into(), json!(cursor));
        }
    }
    Ok(Paged {
        items: items.iter().cloned().map(decode).collect::<Result<_>>()?,
        next_after,
    })
}
impl Client {
    pub async fn automation_self(&self) -> Result<AutomationSelf> {
        let value = self.get("session", true, "").await?;
        auth::check_identity(
            &self.server_id,
            value["server_id"].as_str().ok_or_else(unsupported)?,
        )?;
        let roles = value["roles"].as_array().ok_or_else(unsupported)?;
        let rank = roles
            .iter()
            .map(|role| decode::<i32>(role["rank"].clone()))
            .collect::<Result<Vec<_>>>()?
            .into_iter()
            .max()
            .unwrap_or(0);
        Ok(AutomationSelf {
            principal_id: decode(value["principal_id"].clone())?,
            rank,
        })
    }
    pub async fn automation_workflows(
        &self,
        after: Option<&str>,
    ) -> Result<Paged<WorkflowSummary>> {
        page(
            self.get(
                &page_route("automation/workflows", after, false, 100)?,
                true,
                "automation.view",
            )
            .await?,
            "workflows",
            false,
        )
    }
    pub async fn automation_workflow(&self, workflow_id: &str) -> Result<WorkflowDetail> {
        let value = self
            .get(
                &format!("automation/workflows/{}", id(workflow_id)?),
                true,
                "automation.view",
            )
            .await?;
        decode(value["workflow"].clone())
    }
    pub async fn automation_workflow_create(
        &self,
        draft: WorkflowDraft,
        enabled: bool,
        intent: &str,
    ) -> Result<WorkflowMutation> {
        let mut body = draft.wire()?;
        body["enabled"] = json!(enabled);
        decode(
            self.management_mutate(
                Method::POST,
                "automation/workflows",
                Some(body),
                intent,
                "automation.manage",
            )
            .await?,
        )
    }
    pub async fn automation_workflow_update(
        &self,
        workflow_id: &str,
        expected: u64,
        draft: WorkflowDraft,
        intent: &str,
    ) -> Result<WorkflowMutation> {
        let mut body = draft.wire()?;
        body["expected_revision"] = json!(expected_revision(expected)?);
        decode(
            self.management_mutate(
                Method::PUT,
                &format!("automation/workflows/{}", id(workflow_id)?),
                Some(body),
                intent,
                "automation.manage",
            )
            .await?,
        )
    }
    pub async fn automation_workflow_delete(
        &self,
        workflow_id: &str,
        expected: u64,
        intent: &str,
    ) -> Result<()> {
        self.management_mutate(
            Method::DELETE,
            &format!("automation/workflows/{}", id(workflow_id)?),
            Some(json!({"expected_revision":expected_revision(expected)?})),
            intent,
            "automation.manage",
        )
        .await?;
        Ok(())
    }
    pub async fn automation_workflow_enabled(
        &self,
        workflow_id: &str,
        expected: u64,
        enabled: bool,
        intent: &str,
    ) -> Result<WorkflowMutation> {
        decode(
            self.management_mutate(
                Method::POST,
                &format!("automation/workflows/{}/enabled", id(workflow_id)?),
                Some(json!({"expected_revision":expected_revision(expected)?,"enabled":enabled})),
                intent,
                "automation.manage",
            )
            .await?,
        )
    }
    pub async fn automation_workflow_run(
        &self,
        workflow_id: &str,
        intent: &str,
    ) -> Result<ManualRunResult> {
        decode(
            self.management_mutate(
                Method::POST,
                &format!("automation/workflows/{}/run", id(workflow_id)?),
                Some(json!({})),
                intent,
                "automation.manage",
            )
            .await?,
        )
    }
    pub async fn automation_workflow_runs(
        &self,
        workflow_id: &str,
        after: Option<&str>,
    ) -> Result<Paged<RunSummary>> {
        page(
            self.get(
                &page_route(
                    &format!("automation/workflows/{}/runs", id(workflow_id)?),
                    after,
                    false,
                    100,
                )?,
                true,
                "automation.view",
            )
            .await?,
            "runs",
            false,
        )
    }
    pub async fn automation_runs(&self, after: Option<&str>) -> Result<Paged<RunSummary>> {
        page(
            self.get(
                &page_route("automation/runs", after, false, 100)?,
                true,
                "automation.view",
            )
            .await?,
            "runs",
            false,
        )
    }
    pub async fn automation_runs_newest(
        &self,
        workflow_id: Option<&str>,
        after: Option<&str>,
    ) -> Result<Paged<RunSummary>> {
        let route = match workflow_id {
            Some(workflow) => format!("automation/workflows/{}/runs", id(workflow)?),
            None => "automation/runs".to_owned(),
        };
        page(
            self.get(
                &format!("{}&order=newest", page_route(&route, after, false, 100)?),
                true,
                "automation.view",
            )
            .await?,
            "runs",
            false,
        )
    }
    pub async fn automation_run(&self, run_id: &str) -> Result<RunDetail> {
        let value = self
            .get(
                &format!("automation/runs/{}", id(run_id)?),
                true,
                "automation.view",
            )
            .await?;
        decode(value["run"].clone())
    }
    pub async fn automation_run_steps(
        &self,
        run_id: &str,
        after: Option<&str>,
    ) -> Result<Paged<RunStep>> {
        page(
            self.get(
                &page_route(
                    &format!("automation/runs/{}/steps", id(run_id)?),
                    after,
                    true,
                    100,
                )?,
                true,
                "automation.view",
            )
            .await?,
            "steps",
            true,
        )
    }
    pub async fn automation_run_discard(&self, run_id: &str, intent: &str) -> Result<()> {
        // The agent atomically checks suspended state; a preflight read would race.
        self.management_mutate(
            Method::POST,
            &format!("automation/runs/{}/discard", id(run_id)?),
            Some(json!({})),
            intent,
            "automation.manage",
        )
        .await?;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn definition() -> Value {
        json!({"trigger":{"kind":"cron","expr":"0 5 * * *","utc_offset_minutes":600},
   "missed_policy":{"kind":"catch_up","max":2},"steps":[{
    "id":"one","action":{"kind":"script_preset","preset":"safe","params":{"utc_offset_minutes":"literal","someKey":"x","step_id":"y"}},
    "timeout_secs":60,"retries":{"max_retries":2,"backoff_secs":3},
    "on_success":{"kind":"if_output_equals","key":"raw_key","value":{"then_step":{"utc_offset_minutes":42}},"then_step":"two","otherwise":null},
    "on_failure":{"kind":"goto","step_id":"two"}},
   {"id":"two","action":{"kind":"delay","secs":1},"timeout_secs":10,"retries":{"max_retries":0,"backoff_secs":0},"on_success":{"kind":"end"},"on_failure":{"kind":"fail"}}]})
    }
    #[test]
    fn definitions_round_trip_schema_fields_and_preserve_opaque_keys() {
        let wire = definition();
        let definition: WorkflowDefinition = decode(wire.clone()).unwrap();
        let ipc = serde_json::to_value(&definition).unwrap();
        assert_eq!(ipc["trigger"]["utcOffsetMinutes"], 600);
        assert_eq!(ipc["missedPolicy"]["kind"], "catch_up");
        let step = &ipc["steps"][0];
        assert_eq!(step["timeoutSecs"], 60);
        assert_eq!(step["retries"], json!({"maxRetries":2,"backoffSecs":3}));
        assert_eq!(step["onSuccess"]["thenStep"], "two");
        assert_eq!(step["onFailure"]["stepId"], "two");
        assert_eq!(
            step["action"]["params"],
            wire["steps"][0]["action"]["params"]
        );
        assert_eq!(
            step["onSuccess"]["value"],
            wire["steps"][0]["on_success"]["value"]
        );
        let from_ipc: WorkflowDefinition = decode(ipc).unwrap();
        assert_eq!(
            WorkflowDraft {
                name: "test".into(),
                execution_principal_id: "owner".into(),
                definition: from_ipc
            }
            .wire()
            .unwrap(),
            json!({"name":"test","execution_principal_id":"owner","definition":wire})
        );
        let branch: SuccessBranch = decode(json!({"kind":"goto","step_id":"two"})).unwrap();
        assert_eq!(
            serde_json::to_value(branch).unwrap(),
            json!({"kind":"goto","stepId":"two"})
        );
    }
    #[test]
    fn run_triggers_handle_epoch_milliseconds_events_and_unknown_shapes() {
        for (wire, ipc) in [
            (json!({"kind":"manual"}), json!({"kind":"manual"})),
            (
                json!({"kind":"schedule","occurrence":1791115200000_i64}),
                json!({"kind":"schedule","occurrenceMs":1791115200000_i64}),
            ),
            (
                json!({"kind":"event","event":{"kind":"backup_completed","profile":"daily"}}),
                json!({"kind":"event","event":{"kind":"backup_completed","profile":"daily"}}),
            ),
            (
                json!({"kind":"schedule","occurrence":"tomorrow"}),
                json!({"kind":"other"}),
            ),
            (
                json!({"kind":"schedule","occurrence":-1}),
                json!({"kind":"other"}),
            ),
            (
                json!({"kind":"event","event":{"kind":"future_event"}}),
                json!({"kind":"other"}),
            ),
            (json!({"kind":"future"}), json!({"kind":"other"})),
            (Value::Null, json!({"kind":"other"})),
        ] {
            assert_eq!(
                serde_json::to_value(decode::<RunTrigger>(wire).unwrap()).unwrap(),
                ipc
            );
        }
    }
    #[test]
    fn unknown_closed_definition_variants_fail_cleanly() {
        let mut wire = definition();
        wire["trigger"] = json!({"kind":"future"});
        assert_eq!(
            decode::<WorkflowDefinition>(wire).unwrap_err().code,
            ErrorCode::Unsupported
        );
        let mut wire = definition();
        wire["steps"][0]["action"] = json!({"kind":"future"});
        assert_eq!(
            decode::<WorkflowDefinition>(wire).unwrap_err().code,
            ErrorCode::Unsupported
        );
        let mut wire = definition();
        wire["missed_policy"] = json!({"kind":"future"});
        assert_eq!(
            decode::<WorkflowDefinition>(wire).unwrap_err().code,
            ErrorCode::Unsupported
        );
    }
    #[test]
    fn pagination_preserves_exclusive_cursors_and_limits() {
        assert_eq!(
            page_route("automation/workflows", Some("workflow-1"), false, 100).unwrap(),
            "automation/workflows?limit=100&after=workflow-1"
        );
        assert_eq!(
            page_route("automation/runs/r/steps", Some("0"), true, 1).unwrap(),
            "automation/runs/r/steps?limit=1&after=0"
        );
        for cursor in ["", "01", "192", "-1", "x", "1&limit=2"] {
            assert!(page_route("r", Some(cursor), true, 100).is_err());
        }
        for cursor in ["", "../x", "x&limit=2", "x/y"] {
            assert!(page_route("r", Some(cursor), false, 100).is_err());
        }
        assert_eq!(
            page_route("r", Some("workflow.v1"), false, 100).unwrap(),
            "r?limit=100&after=workflow.v1"
        );
        assert!(id(".").is_err());
        assert!(id("..").is_err());
        assert!(page_route("r", None, false, 0).is_err());
        assert!(page_route("r", None, false, 101).is_err());
        let full: Paged<Value> = page(
            json!({"steps":[{"cursor":191}],"next_after":191}),
            "steps",
            true,
        )
        .unwrap();
        assert_eq!(full.items[0]["cursor"], "191");
        assert_eq!(full.next_after.as_deref(), Some("191"));
        let empty: Paged<Value> =
            page(json!({"steps":[],"next_after":null}), "steps", true).unwrap();
        assert!(empty.items.is_empty() && empty.next_after.is_none());
        assert!(page::<Value>(json!({"steps":[null],"next_after":null}), "steps", true).is_err());
        assert!(page::<Value>(
            json!({"steps":[{"cursor":192}],"next_after":null}),
            "steps",
            true
        )
        .is_err());
    }
    #[test]
    fn automation_errors_and_revision_bounds_match_frontend() {
        for (status, code, expected) in [
            (412, "precondition_failed", ErrorCode::StaleTarget),
            (409, "automation_conflict", ErrorCode::Conflict),
            (409, "idempotency_conflict", ErrorCode::Conflict),
            (400, "invalid_request", ErrorCode::InvalidInput),
            (404, "resource_not_found", ErrorCode::NotFound),
            (403, "forbidden", ErrorCode::Forbidden),
            (503, "temporarily_unavailable", ErrorCode::ServerBusy),
        ] {
            assert_eq!(
                Error::wire_for_route(status, code, None, "/api/v3/manage/automation/workflows")
                    .code,
                expected
            );
        }
        assert!(expected_revision(0).is_err());
        assert!(expected_revision(9_007_199_254_740_992).is_err());
        assert!(expected_revision(1).is_ok());
        assert!(expected_revision(9_007_199_254_740_991).is_ok());
    }
}
