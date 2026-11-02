use crate::servers::{
    pack_sync::{ApplyRequest, Link, Preview},
    ServerManager,
};
use std::sync::Arc;
use tauri::{AppHandle, State};
use vesta_server_client::Result;
#[tauri::command]
pub async fn server_pack_sync_preview(
    app: AppHandle,
    manager: State<'_, Arc<ServerManager>>,
    connection_id: String,
    instance_id: Option<i32>,
) -> Result<Preview> {
    manager
        .pack_sync_preview(&app, &connection_id, instance_id)
        .await
}
#[tauri::command]
pub async fn server_pack_sync_apply(
    app: AppHandle,
    manager: State<'_, Arc<ServerManager>>,
    request: ApplyRequest,
) -> Result<i32> {
    manager.pack_sync_apply(&app, request).await
}
#[tauri::command]
pub async fn server_pack_sync_link(
    manager: State<'_, Arc<ServerManager>>,
    instance_id: i32,
) -> Result<Option<Link>> {
    manager.pack_link(instance_id).await
}

#[tauri::command]
pub async fn server_pack_sync_check(
    app: AppHandle,
    manager: State<'_, Arc<ServerManager>>,
    instance_id: i32,
) -> Result<Option<crate::servers::pack_sync::Check>> {
    manager.pack_sync_check(&app, instance_id).await
}

#[tauri::command]
pub async fn server_pack_sync_discard(
    manager: State<'_, Arc<ServerManager>>,
    review_id: String,
) -> Result<()> {
    manager.pack_sync_discard(&review_id).await;
    Ok(())
}

#[tauri::command]
pub async fn server_pack_sync_details(app: AppHandle, manager: State<'_, Arc<ServerManager>>, connection_id: String) -> Result<crate::servers::pack_sync::PackDetails> {
    tokio::time::timeout(std::time::Duration::from_secs(120), manager.pack_sync_details(&app, &connection_id))
        .await.map_err(|_| vesta_server_client::Error::new(vesta_server_client::ErrorCode::Timeout))?
}
#[tauri::command]
pub async fn server_pack_sync_install(app: AppHandle, manager: State<'_, Arc<ServerManager>>, connection_id: String, revision: String, sha256: String, consent: bool, instance_data: crate::models::instance::Instance) -> Result<i32> {
    manager.start_pack_install(&app, &connection_id, &revision, &sha256, consent, instance_data).await
}

#[tauri::command]
pub fn server_pack_sync_install_details(manager: State<'_, Arc<ServerManager>>, instance_id: i32) -> Result<Option<crate::servers::pack_sync::PackDetails>> {
    manager.pack_install_details(instance_id)
}
