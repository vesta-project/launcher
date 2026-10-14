//! Manual drop application. Decisions live outside Task Manager; only local
//! publication holds its shared filesystem exclusions and a worker permit.
use crate::notifications::manager::{ActionHandler, NotificationManager};
use crate::notifications::models::{
    CreateNotificationInput, NotificationAction, NotificationContext, NotificationSeverity,
    NotificationType,
};
use crate::resources::drop_archive::{self, DropCandidate, DropKind, InspectedDrop};
use crate::resources::manual_dependencies::{self, ManualDependencyPlan};
use crate::resources::source_enrichment::{self, PublishedSource};
use crate::tasks::add_dropped_mods::{publish_file_with_cancel, validate_source};
use crate::tasks::manager::{
    mods_conflict_key, resourcepacks_conflict_key, saves_conflict_key, shaderpacks_conflict_key,
    world_conflict_key, BoxFuture, Task, TaskContext, TaskManager,
};
use crate::worlds::{self, WorldRef};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, watch};
use uuid::Uuid;

const CHOICE_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_PATHS: usize = 50;
const MAX_ACTIVE_DROPS: usize = 8;
const CHOICE_EVENT: &str = "core://manual-resource-drop-choice";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceSelection {
    pub candidate_id: String,
    pub kind: DropKind,
    pub world: Option<WorldRef>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManualDropResponse {
    #[serde(default)]
    pub selections: Vec<ResourceSelection>,
    #[serde(default)]
    pub download_dependencies: bool,
    #[serde(default)]
    pub remember: bool,
    #[serde(default)]
    pub cancel: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyChoice {
    pub id: String,
    pub name: String,
    pub version: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChoiceEvent {
    operation_id: String,
    decision_id: String,
    instance_id: i32,
    instance_name: String,
    phase: &'static str,
    candidates: Vec<DropCandidate>,
    dependencies: Vec<DependencyChoice>,
    notes: Vec<String>,
    expires_at: String,
}

/// Register with `.manage(ManualDropManager::default())` during app setup.
#[derive(Clone, Default)]
pub struct ManualDropManager {
    inner: Arc<CoordinatorState>,
}

#[derive(Default)]
struct CoordinatorState {
    operations: Mutex<HashMap<String, Arc<Operation>>>,
    pending: Mutex<HashMap<String, PendingDecision>>,
    choice_gate: tokio::sync::Mutex<()>,
    inspection_gate: tokio::sync::Mutex<()>,
    actions_registered: AtomicBool,
}

struct Operation {
    id: String,
    instance_id: i32,
    instance_name: String,
    game_dir: PathBuf,
    cancel: watch::Sender<bool>,
}

impl Operation {
    fn cancelled(&self) -> bool {
        *self.cancel.borrow()
    }
    fn task_id(&self) -> String {
        format!("manual-drop-apply:{}", self.id)
    }
    fn notice_key(&self) -> String {
        format!("manual-drop:{}", self.id)
    }
    fn check_cancel(&self) -> Result<(), String> {
        if self.cancelled() {
            Err("Resource drop cancelled".into())
        } else {
            Ok(())
        }
    }
}

enum DecisionPlan {
    Resources {
        instance_id: i32,
        candidates: Vec<DropCandidate>,
    },
    Dependencies,
}

struct PendingDecision {
    operation_id: String,
    deadline: Instant,
    plan: DecisionPlan,
    sender: oneshot::Sender<ManualDropResponse>,
}

fn validate_response(plan: &DecisionPlan, response: &ManualDropResponse) -> Result<(), String> {
    if response.cancel {
        if !response.selections.is_empty() || response.download_dependencies || response.remember {
            return Err("Cancellation cannot include resource or dependency choices".into());
        }
        return Ok(());
    }
    match plan {
        DecisionPlan::Dependencies => {
            if !response.selections.is_empty() {
                return Err("This decision only accepts a dependency choice".into());
            }
        }
        DecisionPlan::Resources {
            instance_id,
            candidates,
        } => {
            if response.download_dependencies || response.remember {
                return Err("This decision only accepts resource choices".into());
            }
            if response.selections.is_empty() || response.selections.len() > candidates.len() {
                return Err("Select at least one resource, at most once per candidate".into());
            }
            let mut seen = HashSet::new();
            for selected in &response.selections {
                if !seen.insert(&selected.candidate_id) {
                    return Err("Select only one kind for each candidate".into());
                }
                let candidate = candidates
                    .iter()
                    .find(|c| c.id == selected.candidate_id)
                    .ok_or_else(|| "Unknown resource candidate".to_string())?;
                if !candidate.kinds.contains(&selected.kind) || selected.kind == DropKind::Modpack {
                    return Err("This resource kind cannot be applied to this instance".into());
                }
                if let Some(world) = &selected.world {
                    if world.instance_id != *instance_id {
                        return Err("The world does not belong to this instance".into());
                    }
                    worlds::validate_directory_name(&world.directory_name)?;
                }
                if selected.kind == DropKind::DataPack {
                    if selected.world.is_none() {
                        return Err("Select a world for each datapack".into());
                    }
                } else if selected.world.is_some() {
                    return Err("Only datapacks accept an existing world target".into());
                }
            }
        }
    }
    Ok(())
}

impl CoordinatorState {
    fn reserve(&self, operation: Arc<Operation>) -> Result<(), String> {
        let mut operations = self
            .operations
            .lock()
            .map_err(|_| "Resource drops are unavailable")?;
        if operations.len() >= MAX_ACTIVE_DROPS {
            return Err("Too many resource drops are pending. Finish or cancel one before dropping more files.".into());
        }
        operations.insert(operation.id.clone(), operation);
        Ok(())
    }

    fn submit(&self, decision_id: &str, response: ManualDropResponse) -> Result<(), String> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "Resource choices are unavailable")?;
        let decision = pending
            .get(decision_id)
            .ok_or("This resource choice is no longer pending")?;
        if decision.deadline <= Instant::now() {
            pending.remove(decision_id);
            return Err("This resource choice expired".into());
        }
        // Validate while the token remains in the map. Invalid submissions never
        // consume a valid decision, and concurrent valid submissions have one winner.
        validate_response(&decision.plan, &response)?;
        let operations = self
            .operations
            .lock()
            .map_err(|_| "Resource drops are unavailable")?;
        let op = operations
            .get(&decision.operation_id)
            .ok_or("This resource drop is no longer active")?;
        op.check_cancel()?;
        let decision = pending
            .remove(decision_id)
            .ok_or("This resource choice is no longer pending")?;
        decision
            .sender
            .send(response)
            .map_err(|_| "This resource choice is no longer pending".into())
    }

    fn clear_decisions(&self, operation_id: &str) {
        if let Ok(mut map) = self.pending.lock() {
            map.retain(|_, decision| decision.operation_id != operation_id);
        }
    }
}

fn manager(app: &AppHandle) -> Result<Arc<CoordinatorState>, String> {
    app.try_state::<ManualDropManager>()
        .map(|s| s.inner.clone())
        .ok_or_else(|| "Manual resource drops are unavailable".into())
}

fn validate_paths(paths: &[String]) -> Result<(), String> {
    if paths.is_empty() || paths.len() > MAX_PATHS {
        return Err(format!("Drop between 1 and {MAX_PATHS} paths at a time"));
    }
    if paths
        .iter()
        .any(|p| p.contains('\0') || !Path::new(p).is_absolute())
    {
        return Err("Dropped paths must be absolute filesystem paths".into());
    }
    Ok(())
}

fn current_instance(operation: &Operation) -> Result<crate::models::instance::Instance, String> {
    let instance = crate::commands::instances::get_instance(operation.instance_id)
        .map_err(|_| "The target instance is no longer available".to_string())?;
    validate_instance(&instance)?;
    if worlds::instance_game_directory(&instance)? != operation.game_dir {
        return Err("The instance game directory changed; drop the resources again".into());
    }
    Ok(instance)
}

fn validate_instance(instance: &crate::models::instance::Instance) -> Result<PathBuf, String> {
    if matches!(
        instance.installation_status.as_deref(),
        Some("installing" | "pending" | "verifying-runtime" | "launch-preflight-repair")
    ) {
        return Err("This instance is still being prepared. Try again when it finishes.".into());
    }
    let root = worlds::instance_game_directory(instance)?;
    if !root.is_absolute() {
        return Err("Instance game directory must be absolute".into());
    }
    Ok(root)
}

/// Returns after validation and creation of the operation notice, before inspection.
pub fn start(app: AppHandle, instance_id: i32, paths: Vec<String>) -> Result<String, String> {
    validate_paths(&paths)?;
    let state = manager(&app)?;
    let instance = crate::commands::instances::get_instance(instance_id)
        .map_err(|_| "The target instance is unavailable".to_string())?;
    let game_dir = validate_instance(&instance)?;
    let (cancel, _) = watch::channel(false);
    let operation = Arc::new(Operation {
        id: Uuid::new_v4().to_string(),
        instance_id,
        instance_name: instance.name,
        game_dir,
        cancel,
    });
    let actions = state
        .actions_registered
        .load(Ordering::Acquire)
        .then(|| {
            serde_json::to_string(&vec![NotificationAction {
                label: "Cancel".into(),
                action_id: "cancel_manual_resource_drop".into(),
                action_type: "secondary".into(),
                payload: Some(serde_json::json!({"operationId": operation.id})),
            }])
            .ok()
        })
        .flatten();
    let notices = app
        .try_state::<NotificationManager>()
        .ok_or("Notifications are unavailable")?;
    state.reserve(operation.clone())?;
    if notices
        .create(CreateNotificationInput {
            client_key: Some(operation.notice_key()),
            title: Some(format!(
                "Adding dropped resources to {}",
                operation.instance_name
            )),
            description: Some("Inspecting archive…".into()),
            notification_type: Some(NotificationType::Progress),
            dismissible: Some(false),
            progress: Some(-1),
            show_on_completion: Some(true),
            actions,
            metadata: NotificationContext::instance(
                instance_id,
                Some(operation.instance_name.clone()),
            )
            .metadata(),
            ..Default::default()
        })
        .is_err()
    {
        if let Ok(mut operations) = state.operations.lock() {
            operations.remove(&operation.id);
        }
        return Err("Could not create the resource drop notice".into());
    }
    let id = operation.id.clone();
    tauri::async_runtime::spawn(async move {
        let result = coordinate(&app, &state, operation.clone(), paths).await;
        match result {
            Ok(report) => finish(&app, &operation, report.summary(), report.severity()),
            Err(error) => finish(
                &app,
                &operation,
                error,
                if operation.cancelled() {
                    NotificationSeverity::Warning
                } else {
                    NotificationSeverity::Error
                },
            ),
        }
        state.clear_decisions(&operation.id);
        if let Ok(mut operations) = state.operations.lock() {
            operations.remove(&operation.id);
        };
    });
    Ok(id)
}

pub fn submit(
    app: &AppHandle,
    decision_id: &str,
    response: ManualDropResponse,
) -> Result<(), String> {
    manager(app)?.submit(decision_id, response)
}

pub fn cancel(app: &AppHandle, operation_id: &str) -> Result<(), String> {
    let state = manager(app)?;
    let operation = state
        .operations
        .lock()
        .map_err(|_| "Resource drops are unavailable")?
        .get(operation_id)
        .cloned()
        .ok_or("This resource drop is no longer active")?;
    operation.cancel.send_replace(true);
    state.clear_decisions(operation_id);
    if let Some(tasks) = app.try_state::<TaskManager>() {
        let _ = tasks.cancel_task(&operation.task_id());
    }
    Ok(())
}

struct CancelManualDrop;
impl ActionHandler for CancelManualDrop {
    fn auto_dismiss(&self, _app: &AppHandle, _key: Option<&str>) -> bool {
        false
    }
    fn handle(
        &self,
        app: &AppHandle,
        _key: Option<String>,
        payload: Option<serde_json::Value>,
    ) -> anyhow::Result<()> {
        let payload = payload.ok_or_else(|| anyhow::anyhow!("Missing resource drop operation"))?;
        let id = payload
            .get("operationId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing resource drop operation"))?;
        cancel(app, id).map_err(anyhow::Error::msg)
    }
}

/// Optional setup hook. Notices offer Cancel only once the handler is registered.
pub fn register_notification_actions(app: &AppHandle) {
    if let (Some(notices), Some(state)) = (
        app.try_state::<NotificationManager>(),
        app.try_state::<ManualDropManager>(),
    ) {
        notices.register_action("cancel_manual_resource_drop", Arc::new(CancelManualDrop));
        state
            .inner
            .actions_registered
            .store(true, Ordering::Release);
    }
}

fn progress(app: &AppHandle, operation: &Operation, description: impl Into<String>, waiting: bool) {
    if let Some(manager) = app.try_state::<NotificationManager>() {
        let _ = manager.update_progress_full(
            operation.notice_key(),
            if waiting { 0 } else { -1 },
            None,
            None,
            description.into(),
            None,
            None,
        );
    }
}
fn finish(
    app: &AppHandle,
    operation: &Operation,
    description: String,
    severity: NotificationSeverity,
) {
    if let Some(manager) = app.try_state::<NotificationManager>() {
        let _ = manager.update_progress_full(
            operation.notice_key(),
            100,
            None,
            None,
            description,
            Some(severity),
            None,
        );
    }
}

async fn cancelled(receiver: &mut watch::Receiver<bool>) {
    loop {
        if *receiver.borrow() {
            return;
        }
        if receiver.changed().await.is_err() {
            return;
        }
    }
}

async fn choice_gate<'a>(
    state: &'a CoordinatorState,
    operation: &Operation,
) -> Result<tokio::sync::MutexGuard<'a, ()>, String> {
    let mut cancel = operation.cancel.subscribe();
    tokio::select! {
        biased;
        _ = cancelled(&mut cancel) => Err("Resource drop cancelled".into()),
        gate = state.choice_gate.lock() => Ok(gate),
    }
}

async fn request_choice(
    app: &AppHandle,
    state: &CoordinatorState,
    operation: &Operation,
    plan: DecisionPlan,
    dependencies: Vec<DependencyChoice>,
    notes: Vec<String>,
) -> Result<ManualDropResponse, String> {
    progress(
        app,
        operation,
        match &plan {
            DecisionPlan::Resources { .. } => "Waiting for resource choices…",
            DecisionPlan::Dependencies => "Waiting for required dependency choices…",
        },
        true,
    );
    let _gate = choice_gate(state, operation).await?;
    operation.check_cancel()?;
    let decision_id = Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    let (phase, candidates) = match &plan {
        DecisionPlan::Resources { candidates, .. } => ("resources", candidates.clone()),
        DecisionPlan::Dependencies => ("dependencies", Vec::new()),
    };
    state
        .pending
        .lock()
        .map_err(|_| "Resource choices are unavailable")?
        .insert(
            decision_id.clone(),
            PendingDecision {
                operation_id: operation.id.clone(),
                deadline: Instant::now() + CHOICE_TTL,
                plan,
                sender,
            },
        );
    let event = ChoiceEvent {
        operation_id: operation.id.clone(),
        decision_id: decision_id.clone(),
        instance_id: operation.instance_id,
        instance_name: operation.instance_name.clone(),
        phase,
        candidates,
        dependencies,
        notes,
        expires_at: (chrono::Utc::now() + chrono::Duration::minutes(15)).to_rfc3339(),
    };
    let result = if app.emit(CHOICE_EVENT, event).is_err() {
        Err("Could not open the resource choice dialog".into())
    } else {
        let mut cancel = operation.cancel.subscribe();
        tokio::select! {
            biased;
            _ = cancelled(&mut cancel) => Err("Resource drop cancelled".into()),
            result = tokio::time::timeout(CHOICE_TTL, receiver) => match result {
                Ok(Ok(response)) => Ok(response),
                Ok(Err(_)) => Err("Resource choice was cancelled".into()),
                Err(_) => Err("Resource choice expired; drop the resources again".into()),
            }
        }
    };
    if let Ok(mut pending) = state.pending.lock() {
        pending.remove(&decision_id);
    }
    let _ = app.emit(
        "core://manual-resource-drop-choice-closed",
        serde_json::json!({"decisionId": decision_id}),
    );
    result
}

fn needs_resource_choice(candidates: &[DropCandidate], notes: &[String]) -> bool {
    let mut kind = None;
    if !notes.is_empty() {
        return true;
    }
    for candidate in candidates {
        if candidate.kinds.len() != 1 {
            return true;
        }
        let current = &candidate.kinds[0];
        if matches!(current, DropKind::DataPack | DropKind::Modpack) {
            return true;
        }
        if kind.as_ref().is_some_and(|previous| previous != current) {
            return true;
        }
        kind = Some(current.clone());
    }
    false
}

struct ApplySelection {
    resource: ResourceSelection,
    world_ids: Vec<String>,
}

async fn coordinate(
    app: &AppHandle,
    state: &CoordinatorState,
    operation: Arc<Operation>,
    paths: Vec<String>,
) -> Result<ApplyReport, String> {
    progress(
        app,
        &operation,
        "Waiting to inspect dropped resources…",
        true,
    );
    let mut cancel = operation.cancel.subscribe();
    let inspection_permit = tokio::select! {
        biased;
        _ = cancelled(&mut cancel) => return Err("Resource drop cancelled".into()),
        permit = state.inspection_gate.lock() => permit,
    };
    operation.check_cancel()?;
    progress(app, &operation, "Inspecting archive…", false);
    let inspection_operation = operation.clone();
    let inspected = tauri::async_runtime::spawn_blocking(move || {
        inspection_operation.check_cancel()?;
        drop_archive::inspect_paths_with_cancel(
            paths.into_iter().map(PathBuf::from).collect(),
            || inspection_operation.cancelled(),
        )
    })
    .await
    .map_err(|_| "Archive inspection failed".to_string())??;
    drop(inspection_permit);
    operation.check_cancel()?;
    let inspected = Arc::new(inspected);
    if inspected.candidates.is_empty() {
        return Err(if inspected.notes.is_empty() {
            "No supported resources found. Import modpacks through the normal new-instance flow."
                .into()
        } else {
            format!("No resources applied. {}", inspected.notes.join(" "))
        });
    }
    let selections = if needs_resource_choice(&inspected.candidates, &inspected.notes) {
        let response = request_choice(
            app,
            state,
            &operation,
            DecisionPlan::Resources {
                instance_id: operation.instance_id,
                candidates: inspected.candidates.clone(),
            },
            Vec::new(),
            inspected.notes.clone(),
        )
        .await?;
        if response.cancel {
            operation.cancel.send_replace(true);
            return Err("Resource drop cancelled".into());
        }
        response.selections
    } else {
        inspected
            .candidates
            .iter()
            .map(|candidate| ResourceSelection {
                candidate_id: candidate.id.clone(),
                kind: candidate.kinds[0].clone(),
                world: None,
            })
            .collect()
    };
    validate_response(
        &DecisionPlan::Resources {
            instance_id: operation.instance_id,
            candidates: inspected.candidates.clone(),
        },
        &ManualDropResponse {
            selections: selections.clone(),
            ..Default::default()
        },
    )?;
    let skipped = inspected.candidates.len().saturating_sub(selections.len());
    let mut prepared = Vec::new();
    for resource in selections {
        operation.check_cancel()?;
        let candidate = inspected
            .candidates
            .iter()
            .find(|c| c.id == resource.candidate_id)
            .ok_or("Unknown resource candidate")?;
        let world_ids = if resource.kind == DropKind::World {
            if candidate.world_candidates.is_empty() {
                return Err("No installable Java world found".into());
            }
            let selected = if candidate.world_candidates.len() == 1 {
                vec![candidate.world_candidates[0].id.clone()]
            } else {
                progress(app, &operation, "Waiting for worlds to install…", true);
                let _gate = choice_gate(state, &operation).await?;
                operation.check_cancel()?;
                worlds::install_selection::request_selection(
                    app,
                    serde_json::json!({"name": candidate.name, "resourceType": "world"}),
                    candidate.world_candidates.clone(),
                    operation.cancel.subscribe(),
                )
                .await?
            };
            validate_world_ids(&selected, candidate)?;
            selected
        } else {
            Vec::new()
        };
        prepared.push(ApplySelection {
            resource,
            world_ids,
        });
    }
    operation.check_cancel()?;
    let (sender, mut receiver) = oneshot::channel();
    let notes = inspected.notes.clone();
    let snapshots = Arc::new(Mutex::new(Some(inspected.clone())));
    let delivery = Arc::new(Mutex::new(Some(sender)));
    let selection_count = prepared.len();
    let task = ApplyDropTask {
        operation: operation.clone(),
        inspected: snapshots.clone(),
        selections: Arc::new(prepared),
        result: delivery.clone(),
    };
    // Retain immutable originals through post-publication enrichment.
    let keys = task.conflict_keys();
    progress(app, &operation, "Waiting to copy dropped resources…", true);
    app.try_state::<TaskManager>()
        .ok_or("Task Manager is unavailable")?
        .submit(Box::new(task))
        .await?;
    let mut cancellation = operation.cancel.subscribe();
    // This wait is a coordinator future, never a Task Manager worker.
    let mut report = tokio::select! {
        result = &mut receiver => result.map_err(|_| "Resource application was interrupted".to_string())?,
        _ = cancelled(&mut cancellation) => {
            if let Some(tasks) = app.try_state::<TaskManager>() { let _ = tasks.cancel_task(&operation.task_id()); }
            // If run has not claimed the immutable snapshot, release it now.
            // The queued task can later abandon without retaining private temp files.
            if snapshots.lock().ok().and_then(|mut slot| slot.take()).is_some() {
                deliver(&delivery, ApplyReport { skipped: selection_count, cancelled: true, ..Default::default() });
            }
            // Running work reports what was actually published, including partial work.
            receiver.await.map_err(|_| "Resource application was interrupted".to_string())?
        }
    };
    report.skipped += skipped;
    report.notes.extend(notes);
    // Ensure run has released its shared locks before identification or any new
    // UI decision. No worker permit is acquired by this coordinator barrier.
    if report.cancelled || operation.cancelled() {
        report.cancelled = true;
        return Ok(report);
    }
    let tasks = app
        .try_state::<TaskManager>()
        .ok_or("Task Manager is unavailable")?;
    let mut cancel = operation.cancel.subscribe();
    tokio::select! {
        biased;
        _ = cancelled(&mut cancel) => { report.cancelled = true; return Ok(report); },
        guard = tasks.acquire_conflicts(keys) => drop(guard),
    }
    if !report.sources.is_empty() && !operation.cancelled() {
        progress(
            app,
            &operation,
            "Recognizing added resource sources…",
            false,
        );
        let published = std::mem::take(&mut report.sources);
        let mut cancel = operation.cancel.subscribe();
        tokio::select! {
            biased;
            _ = cancelled(&mut cancel) => report.cancelled = true,
            notes = source_enrichment::enrich(app, published) => report.notes.extend(notes),
        }
    }
    if !report.mods.is_empty() && !operation.cancelled() {
        progress(app, &operation, "Identifying added mods…", false);
        let roots = report.mods.clone();
        let mut cancel = operation.cancel.subscribe();
        let plan = tokio::select! {
            biased;
            _ = cancelled(&mut cancel) => { report.cancelled = true; return Ok(report); },
            plan = manual_dependencies::plan_for_paths(app, operation.instance_id, &roots) => plan,
        };
        match plan {
            Ok(plan) => {
                report.notes.extend(plan.warnings.clone());
                if !plan.dependencies.is_empty() && !operation.cancelled() {
                    if let Err(error) =
                        process_dependencies(app, state, &operation, &plan, &mut report).await
                    {
                        report
                            .notes
                            .push(format!("Local resources remain added. {error}"));
                    }
                }
            }
            Err(_) => report.notes.push(
                "Local resources remain added, but mod identification or dependency lookup failed."
                    .into(),
            ),
        }
    }
    report.cancelled |= operation.cancelled();
    Ok(report)
}

fn validate_world_ids(selected: &[String], candidate: &DropCandidate) -> Result<(), String> {
    let mut seen = HashSet::new();
    if selected.is_empty() || selected.len() > candidate.world_candidates.len() {
        return Err("Select at least one world from this archive".into());
    }
    for id in selected {
        if !seen.insert(id)
            || !candidate
                .world_candidates
                .iter()
                .any(|world| &world.id == id)
        {
            return Err("Invalid or repeated world selection".into());
        }
    }
    Ok(())
}

async fn process_dependencies(
    app: &AppHandle,
    state: &CoordinatorState,
    operation: &Operation,
    plan: &ManualDependencyPlan,
    report: &mut ApplyReport,
) -> Result<(), String> {
    let config = crate::utils::config::get_app_config()
        .map_err(|_| "Could not read the dependency policy")?;
    let policy = config.manual_mod_dependency_policy.as_str();
    let download = match policy {
        "always" => true,
        "never" => false,
        "ask" => {
            let choices = plan
                .dependencies
                .iter()
                .map(|dependency| DependencyChoice {
                    id: dependency.id.clone(),
                    name: dependency.project.name.clone(),
                    version: dependency.version.version_number.clone(),
                })
                .collect();
            let mut notes = vec![format!(
                "Required dependencies for {}.",
                report
                    .mods
                    .iter()
                    .map(|path| leaf_name(path))
                    .collect::<Vec<_>>()
                    .join(", ")
            )];
            notes.extend(plan.warnings.clone());
            let response = request_choice(
                app,
                state,
                operation,
                DecisionPlan::Dependencies,
                choices,
                notes,
            )
            .await?;
            if response.cancel {
                operation.cancel.send_replace(true);
                return Err("Dependency choice cancelled; local resources remain added.".into());
            }
            if response.remember {
                if crate::utils::config::update_config_field(
                    app.clone(),
                    "manual_mod_dependency_policy".into(),
                    serde_json::json!(if response.download_dependencies {
                        "always"
                    } else {
                        "never"
                    }),
                )
                .is_err()
                {
                    report
                        .notes
                        .push("Could not remember the dependency preference.".into());
                }
            }
            response.download_dependencies
        }
        _ => return Err("Invalid manual mod dependency policy".into()),
    };
    operation.check_cancel()?;
    if download {
        let approved: Vec<String> = plan.dependencies.iter().map(|d| d.id.clone()).collect();
        let outcome =
            manual_dependencies::queue_plan(app, operation.instance_id, plan, &approved).await?;
        report.queued_dependencies += outcome.queued;
        report.notes.extend(outcome.warnings);
    } else {
        report.notes.push(format!(
            "{} required dependencies were not queued.",
            plan.dependencies.len()
        ));
    }
    Ok(())
}

#[derive(Clone, Default)]
struct ApplyReport {
    added: usize,
    duplicates: usize,
    skipped: usize,
    cancelled: bool,
    mods: Vec<PathBuf>,
    sources: Vec<PublishedSource>,
    items: Vec<String>,
    notes: Vec<String>,
    queued_dependencies: usize,
}
impl ApplyReport {
    fn summary(&self) -> String {
        let mut text = format!(
            "Added {} resource(s); {} already installed; {} skipped.",
            self.added, self.duplicates, self.skipped
        );
        if self.cancelled {
            text.push_str(" Cancelled; files already published remain installed.");
        }
        if self.queued_dependencies > 0 {
            text.push_str(&format!(
                " Queued {} required dependencies (downloads have not been tracked to completion).",
                self.queued_dependencies
            ));
        }
        if !self.items.is_empty() {
            text.push(' ');
            text.push_str(&self.items.join(" "));
        }
        if !self.notes.is_empty() {
            text.push(' ');
            text.push_str(&self.notes.join(" "));
        }
        text
    }
    fn severity(&self) -> NotificationSeverity {
        if self.cancelled || self.skipped > 0 || !self.notes.is_empty() || self.added == 0 {
            NotificationSeverity::Warning
        } else {
            NotificationSeverity::Success
        }
    }
}

struct ApplyDropTask {
    operation: Arc<Operation>,
    inspected: Arc<Mutex<Option<Arc<InspectedDrop>>>>,
    selections: Arc<Vec<ApplySelection>>,
    result: Arc<Mutex<Option<oneshot::Sender<ApplyReport>>>>,
}

fn deliver(result: &Mutex<Option<oneshot::Sender<ApplyReport>>>, report: ApplyReport) {
    if let Ok(mut slot) = result.lock() {
        if let Some(sender) = slot.take() {
            let _ = sender.send(report);
        }
    }
}
impl Drop for ApplyDropTask {
    fn drop(&mut self) {
        deliver(
            &self.result,
            ApplyReport {
                cancelled: true,
                notes: vec!["Resource application was abandoned before it could finish.".into()],
                ..Default::default()
            },
        );
    }
}

fn selection_conflicts(instance_id: i32, selections: &[ApplySelection]) -> Vec<String> {
    let mut keys = Vec::new();
    for selected in selections {
        let key = match selected.resource.kind {
            DropKind::Mod => mods_conflict_key(instance_id),
            DropKind::ResourcePack => resourcepacks_conflict_key(instance_id),
            DropKind::Shader => shaderpacks_conflict_key(instance_id),
            DropKind::World => saves_conflict_key(instance_id),
            DropKind::DataPack => match &selected.resource.world {
                Some(world) => world_conflict_key(instance_id, &world.directory_name),
                None => continue,
            },
            DropKind::Modpack => continue,
        };
        keys.push(key);
    }
    keys.sort();
    keys.dedup();
    keys
}

impl Task for ApplyDropTask {
    fn name(&self) -> String {
        format!(
            "Applying dropped resources to {}",
            self.operation.instance_name
        )
    }
    fn id(&self) -> Option<String> {
        Some(self.operation.task_id())
    }
    fn show_notification(&self) -> bool {
        false
    }
    fn cancellable(&self) -> bool {
        true
    }
    fn notification_context(&self) -> Option<NotificationContext> {
        Some(NotificationContext::instance(
            self.operation.instance_id,
            Some(self.operation.instance_name.clone()),
        ))
    }
    fn conflict_keys(&self) -> Vec<String> {
        selection_conflicts(self.operation.instance_id, &self.selections)
    }
    fn ready(&self, _ctx: TaskContext) -> BoxFuture<'static, Result<(), String>> {
        let operation = self.operation.clone();
        Box::pin(async move { operation.check_cancel() })
    }
    fn on_abandoned(&self, _app: &AppHandle) -> BoxFuture<'static, ()> {
        let result = self.result.clone();
        let count = self.selections.len();
        Box::pin(async move {
            deliver(
                &result,
                ApplyReport {
                    skipped: count,
                    cancelled: true,
                    notes: vec!["No local resources were published by the abandoned task.".into()],
                    ..Default::default()
                },
            );
        })
    }
    fn run(&self, ctx: TaskContext) -> BoxFuture<'static, Result<(), String>> {
        let operation = self.operation.clone();
        let inspected = self.inspected.clone();
        let selections = self.selections.clone();
        let result = self.result.clone();
        Box::pin(async move {
            progress(
                &ctx.app_handle,
                &operation,
                "Copying dropped resources…",
                false,
            );
            let snapshot = inspected.lock().ok().and_then(|mut slot| slot.take());
            let Some(snapshot) = snapshot else {
                deliver(
                    &result,
                    ApplyReport {
                        skipped: selections.len(),
                        cancelled: true,
                        ..Default::default()
                    },
                );
                return Ok(());
            };
            let app = ctx.app_handle.clone();
            let work_app = app.clone();
            let work_operation = operation.clone();
            let report = tauri::async_runtime::spawn_blocking(move || {
                apply_local(&work_app, &work_operation, &snapshot, &selections, &ctx)
            })
            .await;
            let mut report = match report {
                Ok(report) => report,
                Err(_) => ApplyReport { cancelled: operation.cancelled(),
                    notes: vec!["Resource application was interrupted. Files already published remain installed.".into()],
                    ..Default::default() },
            };
            if report.added > 0 {
                if let Some(watcher) = app.try_state::<crate::resources::ResourceWatcher>() {
                    if watcher
                        .refresh_instance(
                            operation.instance_id,
                            operation.game_dir.to_string_lossy().into_owned(),
                        )
                        .await
                        .is_err()
                    {
                        report.notes.push(
                            "Resources were added, but refreshing the local resource list failed."
                                .into(),
                        );
                    }
                    if watcher
                        .refresh_world_watches(operation.instance_id, &operation.game_dir)
                        .await
                        .is_err()
                    {
                        report.notes.push(
                            "Resources were added, but refreshing world watches failed.".into(),
                        );
                    }
                } else {
                    report.notes.push(
                        "Resources were added, but the resource watcher is unavailable.".into(),
                    );
                }
            }
            report.cancelled |= operation.cancelled();
            deliver(&result, report);
            Ok(())
        })
    }
}

fn check_apply_cancel(operation: &Operation, ctx: &TaskContext) -> Result<(), String> {
    operation.check_cancel()?;
    if *ctx.cancel_rx.borrow() {
        return Err("Resource application cancelled".into());
    }
    Ok(())
}

/// Every existing component beneath the declared game root must be a real
/// directory. In particular, never follow a resource-folder or saves symlink.
fn safe_directory(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    checked_directory(root, relative, true)
}

fn checked_directory(root: &Path, relative: &Path, create: bool) -> Result<PathBuf, String> {
    let root_meta =
        fs::symlink_metadata(root).map_err(|_| "Instance game directory is unavailable")?;
    if root_meta.file_type().is_symlink() || !root_meta.is_dir() {
        return Err("Instance game directory must be a real directory".into());
    }
    let root = root
        .canonicalize()
        .map_err(|_| "Instance game directory is unavailable")?;
    let mut current = root.clone();
    for component in relative.components() {
        let std::path::Component::Normal(name) = component else {
            return Err("Invalid resource directory".into());
        };
        current.push(name);
        match fs::symlink_metadata(&current) {
            Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {}
            Ok(_) => return Err("Resource directory is not a real directory".into()),
            Err(error) if create && error.kind() == io::ErrorKind::NotFound => {
                match fs::create_dir(&current) {
                    Ok(()) => {}
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                    Err(_) => return Err("Could not create the resource directory".into()),
                }
                let meta = fs::symlink_metadata(&current)
                    .map_err(|_| "Resource directory is unavailable")?;
                if !meta.is_dir() || meta.file_type().is_symlink() {
                    return Err("Resource directory is not a real directory".into());
                }
            }
            Err(_) => return Err("Resource directory is unavailable".into()),
        }
        let resolved = current
            .canonicalize()
            .map_err(|_| "Resource directory is unavailable")?;
        if !resolved.starts_with(&root) || resolved != current {
            return Err("Resource directory escapes the instance".into());
        }
    }
    Ok(current)
}

fn destination(operation: &Operation, selection: &ResourceSelection) -> Result<PathBuf, String> {
    current_instance(operation)?;
    match selection.kind {
        DropKind::Mod => safe_directory(&operation.game_dir, Path::new("mods")),
        DropKind::ResourcePack => safe_directory(&operation.game_dir, Path::new("resourcepacks")),
        DropKind::Shader => safe_directory(&operation.game_dir, Path::new("shaderpacks")),
        DropKind::World => safe_directory(&operation.game_dir, Path::new("saves")),
        DropKind::DataPack => {
            let world = selection
                .world
                .as_ref()
                .ok_or("Select a world for this datapack")?;
            if world.instance_id != operation.instance_id {
                return Err("The world does not belong to this instance".into());
            }
            worlds::validate_directory_name(&world.directory_name)?;
            let expected = checked_directory(
                &operation.game_dir,
                &Path::new("saves").join(&world.directory_name),
                false,
            )?;
            let resolved = worlds::resolve_world_path(world)
                .map_err(|_| "The selected world is no longer available or readable")?;
            if expected != resolved {
                return Err("World path escapes the instance saves directory".into());
            }
            safe_directory(
                &operation.game_dir,
                &Path::new("saves")
                    .join(&world.directory_name)
                    .join("datapacks"),
            )
        }
        DropKind::Modpack => Err("Import modpacks through the normal new-instance flow".into()),
    }
}

fn validate_pack(source: &Path, kind: DropKind) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|_| "Pack is unreadable")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() == 0 {
        return Err("Pack must be a nonempty regular file".into());
    }
    if !source
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
    {
        return Err("Normalized pack must be a ZIP archive".into());
    }
    let file = File::open(source).map_err(|_| "Pack is unreadable")?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| "Pack is not a valid ZIP archive")?;
    match kind {
        DropKind::DataPack | DropKind::ResourcePack => {
            if !archive
                .by_name("pack.mcmeta")
                .is_ok_and(|metadata| metadata.is_file())
            {
                return Err("Pack must contain pack.mcmeta at its root".into());
            }
        }
        DropKind::Shader => {
            let mut shader = false;
            for index in 0..archive.len() {
                let entry = archive
                    .by_index(index)
                    .map_err(|_| "Shader ZIP is unreadable")?;
                if entry.name().starts_with("shaders/") {
                    shader = true;
                }
            }
            if !shader {
                return Err("Shader ZIP must contain shaders at its root".into());
            }
        }
        _ => return Err("Unsupported pack kind".into()),
    }
    Ok(())
}

/// Uses the shared content hash helper, checking real active jar files rather
/// than relying on filenames or possibly stale Ledger rows.
fn identical_active_mod(
    source: &Path,
    mods: &Path,
    mut check: impl FnMut() -> Result<(), String>,
) -> Result<Option<PathBuf>, String> {
    check()?;
    let source_size = fs::metadata(source)
        .map_err(|_| "Could not inspect the dropped mod")?
        .len();
    let wanted = crate::utils::hash::calculate_sha256(source)
        .map_err(|_| "Could not hash the dropped mod")?;
    check()?;
    for entry in fs::read_dir(mods).map_err(|_| "Could not read installed mods")? {
        check()?;
        let entry = entry.map_err(|_| "Could not read an installed mod")?;
        let path = entry.path();
        let metadata =
            fs::symlink_metadata(&path).map_err(|_| "Could not inspect an installed mod")?;
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.len() != source_size
            || !path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("jar"))
        {
            continue;
        }
        let hash = crate::utils::hash::calculate_sha256(&path)
            .map_err(|_| "Could not hash an installed mod")?;
        check()?;
        if hash == wanted {
            return Ok(Some(path));
        }
    }
    Ok(None)
}

fn record_publication(app: &AppHandle, instance_id: i32, path: &Path, report: &mut ApplyReport) {
    let result = (|| -> Result<(), String> {
        let metadata = fs::metadata(path).map_err(|_| "Could not read published file metadata")?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or_default();
        let hash = crate::utils::hash::calculate_sha1(path)
            .map_err(|_| "Could not hash published file")?;
        let recorded = crate::resources::ledger::record_manual(
            instance_id,
            path,
            Some(hash),
            (metadata.len() as i64, modified),
            "manual",
            Some(crate::resources::ledger::ResourceProvenance::custom()),
        )
        .map_err(|_| "Could not update the installed resource ledger")?;
        if !recorded {
            return Err(
                "Published file was not registered by the installed resource ledger".into(),
            );
        }
        Ok(())
    })();
    if let Err(error) = result {
        report.notes.push(error);
    }
    if crate::resources::reconciliation::emit_rows_changed(app, instance_id, "manual-resource-drop")
        .is_err()
    {
        report
            .notes
            .push("Resources were added, but notifying the resource list failed.".into());
    }
}

fn apply_local(
    app: &AppHandle,
    operation: &Operation,
    inspected: &InspectedDrop,
    selections: &[ApplySelection],
    ctx: &TaskContext,
) -> ApplyReport {
    let mut report = ApplyReport::default();
    for (index, selected) in selections.iter().enumerate() {
        if check_apply_cancel(operation, ctx).is_err() {
            report.cancelled = true;
            report.skipped += selections.len() - index;
            break;
        }
        let name = inspected
            .candidates
            .iter()
            .find(|c| c.id == selected.resource.candidate_id)
            .map(|c| c.name.as_str())
            .unwrap_or("Resource");
        progress(app, operation, format!("Copying {name}…"), false);
        let item_result = apply_item(app, operation, inspected, selected, ctx, &mut report);
        if let Err(reason) = item_result {
            report.skipped += 1;
            report.items.push(format!("{name}: {reason}."));
            if check_apply_cancel(operation, ctx).is_err() {
                report.cancelled = true;
            }
        }
    }
    report
}

fn apply_item(
    app: &AppHandle,
    operation: &Operation,
    inspected: &InspectedDrop,
    selected: &ApplySelection,
    ctx: &TaskContext,
    report: &mut ApplyReport,
) -> Result<(), String> {
    check_apply_cancel(operation, ctx)?;
    let output = tempfile::tempdir().map_err(|_| "Could not stage this resource")?;
    let sources = inspected
        .materialize(
            &selected.resource.candidate_id,
            selected.resource.kind.clone(),
            output.path(),
        )
        .map_err(|_| "Could not prepare this resource from the inspected snapshot")?;
    check_apply_cancel(operation, ctx)?;
    if sources.is_empty() {
        return Err("No installable files in this candidate".into());
    }
    if selected.resource.kind == DropKind::World {
        if sources.len() != 1 || selected.world_ids.is_empty() {
            return Err("Invalid world archive selection".into());
        }
        let saves = destination(operation, &selected.resource)?;
        let installed = worlds::archive::install_archive(
            &sources[0],
            &saves,
            &selected.world_ids,
            None,
            |written, total| {
                check_apply_cancel(operation, ctx)?;
                let percent = if total == 0 {
                    0
                } else {
                    (written.saturating_mul(90) / total).min(90) as i32
                };
                if let Some(manager) = app.try_state::<NotificationManager>() {
                    let _ = manager.update_progress_full(
                        operation.notice_key(),
                        percent,
                        None,
                        None,
                        "Extracting selected worlds…".into(),
                        None,
                        None,
                    );
                }
                Ok(())
            },
        )
        .map_err(|_| {
            if check_apply_cancel(operation, ctx).is_err() {
                "World installation cancelled"
            } else {
                "Could not safely install the selected worlds"
            }
        })?;
        report.added += installed.len();
        for world in installed {
            if let Some(original) = inspected.source_evidence_path(&selected.resource.candidate_id)
            {
                let world_ref = WorldRef {
                    instance_id: operation.instance_id,
                    directory_name: world.directory_name.clone(),
                };
                match source_enrichment::capture_world(
                    operation.instance_id,
                    &operation.game_dir,
                    &world_ref,
                    &world.path,
                    original,
                ) {
                    Ok(evidence) => report.sources.push(evidence),
                    Err(_) => report.notes.push(
                        "World was added, but original archive evidence could not be saved.".into(),
                    ),
                }
            }
            report
                .items
                .push(format!("{}: added world.", world.directory_name));
        }
        if let Some(manager) = app.try_state::<worlds::WorldManager>() {
            manager.invalidate(operation.instance_id);
        }
        if app
            .emit(
                "core://instance-worlds-changed",
                serde_json::json!({"instanceId": operation.instance_id,
            "revision": chrono::Utc::now().timestamp_millis(), "reason": "archive-installed"}),
            )
            .is_err()
        {
            report
                .notes
                .push("Worlds were installed, but notifying the world list failed.".into());
        }
        return Ok(());
    }
    let count = sources.len();
    for (index, source) in sources.into_iter().enumerate() {
        if check_apply_cancel(operation, ctx).is_err() {
            report.skipped += count - index;
            report.cancelled = true;
            break;
        }
        if let Err(reason) = publish_source(
            app,
            operation,
            &source,
            &selected.resource,
            inspected.source_evidence_path(&selected.resource.candidate_id),
            ctx,
            report,
        ) {
            report.skipped += 1;
            report
                .items
                .push(format!("{}: {reason}.", leaf_name(&source)));
        }
    }
    Ok(())
}

fn publish_source(
    app: &AppHandle,
    operation: &Operation,
    source: &Path,
    selected: &ResourceSelection,
    original: Option<&Path>,
    ctx: &TaskContext,
    report: &mut ApplyReport,
) -> Result<(), String> {
    check_apply_cancel(operation, ctx)?;
    // Re-fetch status, directory and world ownership for each publication.
    let folder = destination(operation, selected)?;
    let kind = selected.kind;
    if kind == DropKind::Mod {
        validate_source(source).map_err(|reason| reason.describe().to_string())?;
        if let Some(existing) =
            identical_active_mod(source, &folder, || check_apply_cancel(operation, ctx))?
        {
            report.duplicates += 1;
            report.items.push(format!(
                "{}: already installed (identical bytes).",
                leaf_name(source)
            ));
            report.mods.push(existing);
            return Ok(());
        }
    } else {
        validate_pack(source, kind)?;
    }
    let published = publish_file_with_cancel(source, &folder, || {
        check_apply_cancel(operation, ctx).map_err(|_| {
            io::Error::new(io::ErrorKind::Interrupted, "Resource application cancelled")
        })
    })
    .map_err(|error| {
        if error.kind() == io::ErrorKind::Interrupted {
            "Copy cancelled"
        } else {
            "Could not publish without replacing an existing resource"
        }
    })?;
    // Publication is final even if indexing, identification or dependencies fail.
    report.added += 1;
    report
        .items
        .push(format!("{}: added.", leaf_name(&published)));
    if kind == DropKind::Mod {
        report.mods.push(published.clone());
    }
    record_publication(app, operation.instance_id, &published, report);
    if kind != DropKind::Mod {
        let resource_type = match kind {
            DropKind::DataPack => crate::models::resource::ResourceType::DataPack,
            DropKind::ResourcePack => crate::models::resource::ResourceType::ResourcePack,
            DropKind::Shader => crate::models::resource::ResourceType::Shader,
            _ => unreachable!("validated pack kind"),
        };
        match source_enrichment::capture_file(
            operation.instance_id,
            &operation.game_dir,
            &published,
            original,
            resource_type,
            selected.world.as_ref(),
        ) {
            Ok(evidence) => report.sources.push(evidence),
            Err(_) => report
                .notes
                .push("Resource was added, but source evidence could not be saved.".into()),
        }
    }
    if let Some(world) = &selected.world {
        if worlds::datapacks::emit_world_datapacks_changed(app, world, "manual-resource-drop")
            .is_err()
        {
            report
                .notes
                .push("Datapack was added, but notifying the world list failed.".into());
        }
    }
    Ok(())
}

fn leaf_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Resource")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn candidate(id: &str, kinds: Vec<DropKind>) -> DropCandidate {
        DropCandidate {
            id: id.into(),
            name: format!("{id}.zip"),
            kinds,
            world_candidates: Vec::new(),
        }
    }
    fn selection(id: &str, kind: DropKind) -> ResourceSelection {
        ResourceSelection {
            candidate_id: id.into(),
            kind,
            world: None,
        }
    }
    fn resource_plan() -> DecisionPlan {
        DecisionPlan::Resources {
            instance_id: 7,
            candidates: vec![
                candidate("one", vec![DropKind::Mod, DropKind::ResourcePack]),
                candidate("data", vec![DropKind::DataPack]),
                candidate("pack", vec![DropKind::Modpack]),
            ],
        }
    }
    fn operation() -> Arc<Operation> {
        let (cancel, _) = watch::channel(false);
        Arc::new(Operation {
            id: Uuid::new_v4().to_string(),
            instance_id: 7,
            instance_name: "Test".into(),
            game_dir: PathBuf::from("/instance"),
            cancel,
        })
    }
    fn pending(
        state: &CoordinatorState,
        operation: &Operation,
        plan: DecisionPlan,
        deadline: Instant,
    ) -> (String, oneshot::Receiver<ManualDropResponse>) {
        let (sender, receiver) = oneshot::channel();
        let id = Uuid::new_v4().to_string();
        state.pending.lock().unwrap().insert(
            id.clone(),
            PendingDecision {
                operation_id: operation.id.clone(),
                deadline,
                plan,
                sender,
            },
        );
        (id, receiver)
    }
    fn response(selections: Vec<ResourceSelection>) -> ManualDropResponse {
        ManualDropResponse {
            selections,
            ..Default::default()
        }
    }

    #[test]
    fn active_drop_limit_is_reserved_atomically_and_released_slots_are_reusable() {
        let state = CoordinatorState::default();
        let first = operation();
        state.reserve(first.clone()).unwrap();
        for _ in 1..MAX_ACTIVE_DROPS {
            state.reserve(operation()).unwrap();
        }
        let extra = operation();
        assert!(state.reserve(extra.clone()).is_err());
        assert_eq!(state.operations.lock().unwrap().len(), MAX_ACTIVE_DROPS);
        state.operations.lock().unwrap().remove(&first.id);
        state.reserve(extra).unwrap();
        assert_eq!(state.operations.lock().unwrap().len(), MAX_ACTIVE_DROPS);
    }

    #[test]
    fn resource_choices_reject_empty_unknown_kind_duplicates_and_excluded_modpacks() {
        let plan = resource_plan();
        for selections in [
            vec![],
            vec![selection("unknown", DropKind::Mod)],
            vec![selection("one", DropKind::Shader)],
            vec![
                selection("one", DropKind::Mod),
                selection("one", DropKind::ResourcePack),
            ],
            vec![selection("pack", DropKind::Modpack)],
        ] {
            assert!(validate_response(&plan, &response(selections)).is_err());
        }
        assert!(validate_response(&plan, &response(vec![selection("one", DropKind::Mod)])).is_ok());
    }

    #[test]
    fn datapack_choices_require_owned_valid_world_refs() {
        let plan = resource_plan();
        assert!(validate_response(
            &plan,
            &response(vec![selection("data", DropKind::DataPack)])
        )
        .is_err());
        let mut selected = selection("data", DropKind::DataPack);
        selected.world = Some(WorldRef {
            instance_id: 8,
            directory_name: "World".into(),
        });
        assert!(validate_response(&plan, &response(vec![selected.clone()])).is_err());
        selected.world.as_mut().unwrap().instance_id = 7;
        assert!(validate_response(&plan, &response(vec![selected.clone()])).is_ok());
        selected.world.as_mut().unwrap().directory_name = "../outside".into();
        assert!(validate_response(&plan, &response(vec![selected])).is_err());
    }

    #[test]
    fn decision_phases_and_cancellation_are_typed() {
        assert!(validate_response(
            &DecisionPlan::Dependencies,
            &response(vec![selection("one", DropKind::Mod)])
        )
        .is_err());
        assert!(validate_response(
            &resource_plan(),
            &ManualDropResponse {
                download_dependencies: true,
                selections: vec![selection("one", DropKind::Mod)],
                ..Default::default()
            }
        )
        .is_err());
        assert!(validate_response(
            &DecisionPlan::Dependencies,
            &ManualDropResponse {
                remember: true,
                ..Default::default()
            }
        )
        .is_ok());
        assert!(validate_response(
            &resource_plan(),
            &ManualDropResponse {
                cancel: true,
                ..Default::default()
            }
        )
        .is_ok());
        assert!(validate_response(
            &resource_plan(),
            &ManualDropResponse {
                cancel: true,
                selections: vec![selection("one", DropKind::Mod)],
                ..Default::default()
            }
        )
        .is_err());
    }

    #[tokio::test]
    async fn invalid_submission_does_not_consume_token_and_valid_response_is_once_only() {
        let state = CoordinatorState::default();
        let op = operation();
        state
            .operations
            .lock()
            .unwrap()
            .insert(op.id.clone(), op.clone());
        let (id, receiver) = pending(&state, &op, resource_plan(), Instant::now() + CHOICE_TTL);
        assert!(state.submit(&id, response(vec![])).is_err());
        assert!(state.pending.lock().unwrap().contains_key(&id));
        state
            .submit(&id, response(vec![selection("one", DropKind::Mod)]))
            .unwrap();
        assert_eq!(receiver.await.unwrap().selections.len(), 1);
        assert!(state
            .submit(&id, response(vec![selection("one", DropKind::Mod)]))
            .is_err());
    }

    #[tokio::test]
    async fn expiry_and_cancel_close_tokens_and_gate_waits() {
        let state = CoordinatorState::default();
        let op = operation();
        state
            .operations
            .lock()
            .unwrap()
            .insert(op.id.clone(), op.clone());
        let (expired, receiver) = pending(
            &state,
            &op,
            resource_plan(),
            Instant::now() - Duration::from_secs(1),
        );
        assert!(state
            .submit(&expired, response(vec![selection("one", DropKind::Mod)]))
            .is_err());
        assert!(receiver.await.is_err());
        let (_id, receiver) = pending(
            &state,
            &op,
            DecisionPlan::Dependencies,
            Instant::now() + CHOICE_TTL,
        );
        let gate = choice_gate(&state, &op).await.unwrap();
        assert!(state.choice_gate.try_lock().is_err());
        op.cancel.send_replace(true);
        state.clear_decisions(&op.id);
        assert!(receiver.await.is_err());
        assert!(choice_gate(&state, &op).await.is_err());
        drop(gate);
        assert!(state.choice_gate.try_lock().is_ok());
    }

    #[test]
    fn path_counts_defaults_and_zero_accepted_summary_are_safe() {
        assert!(validate_paths(&[]).is_err());
        assert!(validate_paths(&vec!["/file.jar".into(); MAX_PATHS + 1]).is_err());
        assert!(validate_paths(&["relative.jar".into()]).is_err());
        assert!(validate_paths(&["/file.jar\0".into()]).is_err());
        assert!(validate_paths(&["/file.jar".into()]).is_ok());
        let defaults: ManualDropResponse = serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(!defaults.download_dependencies && !defaults.remember && !defaults.cancel);
        assert_eq!(
            ApplyReport::default().severity(),
            NotificationSeverity::Warning
        );
    }

    #[test]
    fn coherent_batches_auto_apply_but_ambiguity_mixed_datapacks_and_notes_need_choice() {
        assert!(!needs_resource_choice(
            &[
                candidate("one", vec![DropKind::Mod]),
                candidate("two", vec![DropKind::Mod])
            ],
            &[]
        ));
        for candidates in [
            vec![candidate("one", vec![DropKind::DataPack])],
            vec![candidate(
                "one",
                vec![DropKind::Mod, DropKind::ResourcePack],
            )],
            vec![
                candidate("one", vec![DropKind::Mod]),
                candidate("two", vec![DropKind::Shader]),
            ],
            vec![candidate("pack", vec![DropKind::Modpack])],
        ] {
            assert!(needs_resource_choice(&candidates, &[]));
        }
        assert!(needs_resource_choice(
            &[candidate("one", vec![DropKind::Mod])],
            &["Excluded modpack".into()]
        ));
    }

    #[test]
    fn preselected_world_ids_reject_unknown_repeated_and_empty_choices() {
        let mut world = candidate("world", vec![DropKind::World]);
        world
            .world_candidates
            .push(worlds::archive::WorldArchiveCandidate {
                id: "root".into(),
                name: "World".into(),
                folder: "World".into(),
                size_bytes: 1,
                game_version: None,
                data_version: None,
                icon_data_url: None,
            });
        assert!(validate_world_ids(&[], &world).is_err());
        assert!(validate_world_ids(&["other".into()], &world).is_err());
        assert!(validate_world_ids(&["root".into(), "root".into()], &world).is_err());
        assert!(validate_world_ids(&["root".into()], &world).is_ok());
    }

    #[test]
    fn shared_keys_cover_mods_shaders_packs_worlds_and_owned_datapacks() {
        let mut data = selection("data", DropKind::DataPack);
        data.world = Some(WorldRef {
            instance_id: 7,
            directory_name: "World".into(),
        });
        let selections: Vec<_> = [
            selection("mod", DropKind::Mod),
            selection("shader", DropKind::Shader),
            selection("pack", DropKind::ResourcePack),
            selection("world", DropKind::World),
            data,
            selection("mod2", DropKind::Mod),
        ]
        .into_iter()
        .map(|resource| ApplySelection {
            resource,
            world_ids: Vec::new(),
        })
        .collect();
        assert_eq!(
            selection_conflicts(7, &selections),
            vec![
                mods_conflict_key(7),
                resourcepacks_conflict_key(7),
                saves_conflict_key(7),
                shaderpacks_conflict_key(7),
                world_conflict_key(7, "World")
            ]
        );
    }

    fn jar(path: &Path, marker: &[u8]) {
        let mut zip = zip::ZipWriter::new(File::create(path).unwrap());
        zip.start_file(
            "META-INF/MANIFEST.MF",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.write_all(marker).unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn content_dedupe_ignores_names_and_disabled_files_and_collisions_never_replace() {
        let temp = tempfile::tempdir().unwrap();
        let mods = temp.path().join("mods");
        fs::create_dir(&mods).unwrap();
        let source = temp.path().join("mod.jar");
        jar(&source, b"first");
        let active = mods.join("other-name.jar");
        fs::copy(&source, &active).unwrap();
        assert_eq!(
            identical_active_mod(&source, &mods, || Ok(())).unwrap(),
            Some(active.clone())
        );
        fs::rename(&active, mods.join("other-name.jar.disabled")).unwrap();
        assert!(identical_active_mod(&source, &mods, || Ok(()))
            .unwrap()
            .is_none());
        jar(&mods.join("mod.jar"), b"different");
        let original = fs::read(mods.join("mod.jar")).unwrap();
        let published = publish_file_with_cancel(&source, &mods, || Ok(())).unwrap();
        assert_eq!(leaf_name(&published), "mod (2).jar");
        assert_eq!(fs::read(mods.join("mod.jar")).unwrap(), original);
        assert_eq!(fs::read(published).unwrap(), fs::read(source).unwrap());
    }

    #[test]
    fn cancellation_discards_partial_staging_and_pack_root_is_validated() {
        let temp = tempfile::tempdir().unwrap();
        let folder = temp.path().join("resourcepacks");
        fs::create_dir(&folder).unwrap();
        let pack = temp.path().join("pack.zip");
        let mut zip = zip::ZipWriter::new(File::create(&pack).unwrap());
        zip.start_file(
            "wrapper/pack.mcmeta",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.write_all(b"{}").unwrap();
        zip.finish().unwrap();
        assert!(validate_pack(&pack, DropKind::DataPack).is_err());
        let mut checks = 0;
        let result = publish_file_with_cancel(&pack, &folder, || {
            checks += 1;
            if checks > 1 {
                Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"))
            } else {
                Ok(())
            }
        });
        assert!(result.is_err());
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn resource_and_world_directory_symlinks_never_escape_the_game_root() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("mods")).unwrap();
        assert!(safe_directory(&root, Path::new("mods")).is_err());
        fs::create_dir(root.join("saves")).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("saves/World")).unwrap();
        assert!(checked_directory(&root, Path::new("saves/World"), false).is_err());
        assert!(checked_directory(&root, Path::new("saves/Missing"), false).is_err());
        assert!(!root.join("saves/Missing").exists());
        assert!(safe_directory(&root, Path::new("../outside")).is_err());
    }
}
