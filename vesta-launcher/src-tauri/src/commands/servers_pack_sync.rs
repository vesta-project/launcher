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
