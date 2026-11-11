//! Pending setup IPC. Invitations use server_sign_in_minecraft.
use crate::servers::{ServerManager, SetupDiscovery};
use std::sync::Arc;
use tauri::{AppHandle, State};
use vesta_server_client::{model::ServerSnapshot, setup::*, Result};
type Manager<'a> = State<'a, Arc<ServerManager>>;
#[tauri::command]
pub async fn server_setup_readiness(
    manager: Manager<'_>,
    address: Option<String>,
) -> Result<SetupDiscovery> {
    manager
        .setup_readiness(address.as_deref().unwrap_or("localhost:8443"))
        .await
}
#[tauri::command]
pub async fn server_setup_status(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<SetupStatus> {
    manager
        .management_read(
            &app,
            &connection_id,
            |c| async move { c.setup_status().await },
        )
        .await
}
#[tauri::command]
pub async fn server_setup_claim(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    intent_id: String,
) -> Result<SetupStatus> {
    manager
        .management_write(
            &app,
            &connection_id,
            &intent_id,
            "setup/claim",
            serde_json::json!({}),
            false,
            |c| async move { c.setup_claim().await },
        )
        .await
}
#[tauri::command]
pub async fn server_setup_plan(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: SetupPlanRequest,
    intent_id: String,
) -> Result<SetupJob> {
    let payload = serde_json::to_value(&request).map_err(|_| {
        vesta_server_client::Error::new(vesta_server_client::ErrorCode::InvalidInput)
    })?;
    manager
        .management_write(
            &app,
            &connection_id,
            &intent_id,
            "setup/plan",
            payload,
            true,
            |c| async move { c.setup_plan(request).await },
        )
        .await
}
#[tauri::command]
pub async fn server_setup_apply(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    job_id: String,
    acknowledge_warnings: bool,
    acknowledge_legacy_checksum: bool,
    intent_id: String,
) -> Result<SetupJob> {
    let payload = serde_json::json!({"jobId":job_id,"acknowledgeWarnings":acknowledge_warnings,"acknowledgeLegacyChecksum":acknowledge_legacy_checksum});
    let journal = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &journal,
            "setup/apply",
            payload,
            false,
            |c| async move {
                c.setup_apply(
                    &job_id,
                    acknowledge_warnings,
                    acknowledge_legacy_checksum,
                    &intent_id,
                )
                .await
            },
        )
        .await
}
#[tauri::command]
pub async fn server_setup_job(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    job_id: String,
) -> Result<SetupJob> {
    manager
        .management_read(&app, &connection_id, |c| async move {
            c.setup_job(&job_id).await
        })
        .await
}
#[tauri::command]
pub async fn server_setup_handoff(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<ServerSnapshot> {
    manager.inner().setup_handoff(&app, &connection_id).await
}
