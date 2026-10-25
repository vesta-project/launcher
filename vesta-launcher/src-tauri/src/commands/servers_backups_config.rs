use crate::servers::ServerManager;
use serde_json::json;
use std::sync::Arc;
use tauri::{AppHandle, State};
use vesta_server_client::{backups_config::*, Result};

#[tauri::command]
pub async fn server_backup_configuration(
    app: AppHandle,
    manager: State<'_, Arc<ServerManager>>,
    connection_id: String,
) -> Result<BackupConfiguration> {
    manager
        .management_read(&app, &connection_id, |c| async move {
            c.backup_configuration().await
        })
        .await
}

#[tauri::command]
pub async fn server_backup_configure(
    app: AppHandle,
    manager: State<'_, Arc<ServerManager>>,
    connection_id: String,
    draft: BackupConfigDraft,
    expected_revision: Option<u64>,
    intent_id: String,
) -> Result<BackupConfigOutcome> {
    let payload = json!({"draft":draft,"expectedRevision":expected_revision});
    let journal_intent = intent_id.clone();
    let result = manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &journal_intent,
            "backups/config",
            payload,
            false,
            |c| async move {
                c.backup_configure(draft, expected_revision, &intent_id)
                    .await
            },
        )
        .await?;
    manager
        .refresh_backups_configured(&app, &connection_id)
        .await;
    Ok(result)
}
