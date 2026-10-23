//! Automation IPC follows native management authentication, intent journaling and failure sync.
use crate::servers::ServerManager;
use serde_json::json;
use std::sync::Arc;
use tauri::{AppHandle, State};
use vesta_server_client::{automation::*, Result};
type Manager<'a> = State<'a, Arc<ServerManager>>;

#[tauri::command]
pub async fn server_automation_self(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<AutomationSelf> {
    manager
        .management_read(&app, &connection_id, |c| async move {
            c.automation_self().await
        })
        .await
}

#[tauri::command]
pub async fn server_automation_workflows(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    after: Option<String>,
) -> Result<Paged<WorkflowSummary>> {
    manager
        .management_read(&app, &connection_id, |c| async move {
            c.automation_workflows(after.as_deref()).await
        })
        .await
}

#[tauri::command]
pub async fn server_automation_workflow(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    workflow_id: String,
) -> Result<WorkflowDetail> {
    manager
        .management_read(&app, &connection_id, |c| async move {
            c.automation_workflow(&workflow_id).await
        })
        .await
}

#[tauri::command]
pub async fn server_automation_workflow_runs(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    workflow_id: String,
    after: Option<String>,
    newest: Option<bool>,
) -> Result<Paged<RunSummary>> {
    manager
        .management_read(&app, &connection_id, |c| async move {
            if newest.unwrap_or(false) {
                c.automation_runs_newest(Some(&workflow_id), after.as_deref())
                    .await
            } else {
                c.automation_workflow_runs(&workflow_id, after.as_deref())
                    .await
            }
        })
        .await
}

#[tauri::command]
pub async fn server_automation_runs(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    after: Option<String>,
    newest: Option<bool>,
) -> Result<Paged<RunSummary>> {
    manager
        .management_read(&app, &connection_id, |c| async move {
            if newest.unwrap_or(false) {
                c.automation_runs_newest(None, after.as_deref()).await
            } else {
                c.automation_runs(after.as_deref()).await
            }
        })
        .await
}

#[tauri::command]
pub async fn server_automation_run(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    run_id: String,
) -> Result<RunDetail> {
    manager
        .management_read(&app, &connection_id, |c| async move {
            c.automation_run(&run_id).await
        })
        .await
}

#[tauri::command]
pub async fn server_automation_run_steps(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    run_id: String,
    after: Option<String>,
) -> Result<Paged<RunStep>> {
    manager
        .management_read(&app, &connection_id, |c| async move {
            c.automation_run_steps(&run_id, after.as_deref()).await
        })
        .await
}

#[tauri::command]
pub async fn server_automation_workflow_create(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    draft: WorkflowDraft,
    enabled: bool,
    intent_id: String,
) -> Result<WorkflowMutation> {
    let payload = json!({"draft":draft,"enabled":enabled});
    let intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &intent,
            "automation/workflows/create",
            payload,
            false,
            |c| async move {
                c.automation_workflow_create(draft, enabled, &intent_id)
                    .await
            },
        )
        .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn server_automation_workflow_update(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    workflow_id: String,
    expected_revision: u64,
    draft: WorkflowDraft,
    intent_id: String,
) -> Result<WorkflowMutation> {
    let payload =
        json!({"workflow_id":workflow_id,"expected_revision":expected_revision,"draft":draft});
    let intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &intent,
            "automation/workflows/update",
            payload,
            false,
            |c| async move {
                c.automation_workflow_update(&workflow_id, expected_revision, draft, &intent_id)
                    .await
            },
        )
        .await
}

#[tauri::command]
pub async fn server_automation_workflow_delete(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    workflow_id: String,
    expected_revision: u64,
    intent_id: String,
) -> Result<()> {
    let payload = json!({"workflow_id":workflow_id,"expected_revision":expected_revision});
    let intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &intent,
            "automation/workflows/delete",
            payload,
            false,
            |c| async move {
                c.automation_workflow_delete(&workflow_id, expected_revision, &intent_id)
                    .await
            },
        )
        .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn server_automation_workflow_enabled(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    workflow_id: String,
    expected_revision: u64,
    enabled: bool,
    intent_id: String,
) -> Result<WorkflowMutation> {
    let payload =
        json!({"workflow_id":workflow_id,"expected_revision":expected_revision,"enabled":enabled});
    let intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &intent,
            "automation/workflows/enabled",
            payload,
            false,
            |c| async move {
                c.automation_workflow_enabled(&workflow_id, expected_revision, enabled, &intent_id)
                    .await
            },
        )
        .await
}

#[tauri::command]
pub async fn server_automation_workflow_run(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    workflow_id: String,
    intent_id: String,
) -> Result<ManualRunResult> {
    let payload = json!({"workflow_id":workflow_id});
    let intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &intent,
            "automation/workflows/run",
            payload,
            false,
            |c| async move { c.automation_workflow_run(&workflow_id, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_automation_run_discard(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    run_id: String,
    intent_id: String,
) -> Result<()> {
    let payload = json!({"run_id":run_id});
    let intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &intent,
            "automation/runs/discard",
            payload,
            false,
            |c| async move { c.automation_run_discard(&run_id, &intent_id).await },
        )
        .await
}
