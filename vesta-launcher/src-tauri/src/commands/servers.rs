//! Thin, typed implementation of Solid's servers/native.ts IPC contract.
use crate::servers::ServerManager;
use std::sync::Arc;
use tauri::{ipc::Channel, AppHandle, State, WebviewWindow};
use vesta_server_client::{model::*, Result};
type Manager<'a> = State<'a, Arc<ServerManager>>;

async fn lifecycle_deadline<T>(run: impl std::future::Future<Output = Result<T>>) -> Result<T> {
    tokio::time::timeout(std::time::Duration::from_secs(30), run)
        .await
        .unwrap_or_else(|_| {
            Err(vesta_server_client::Error::new(
                vesta_server_client::ErrorCode::OutcomeUnknown,
            ))
        })
}
#[tauri::command]
pub async fn server_connections_list(manager: Manager<'_>) -> Result<Vec<ServerSnapshot>> {
    manager.list().await
}
#[tauri::command]
pub async fn server_discover(manager: Manager<'_>, address: String) -> Result<Discovery> {
    manager.discover(&address).await
}
#[tauri::command]
pub async fn server_pair(
    app: AppHandle,
    manager: Manager<'_>,
    discovery_id: String,
    code: String,
    memory_only: bool,
) -> Result<ServerSnapshot> {
    manager.pair(&app, &discovery_id, &code, memory_only).await
}
#[tauri::command]
pub async fn server_sign_in_minecraft(
    app: AppHandle,
    manager: Manager<'_>,
    discovery_id: String,
    account_uuid: String,
    memory_only: bool,
) -> Result<ServerSnapshot> {
    manager
        .minecraft(&app, &discovery_id, &account_uuid, memory_only)
        .await
}
#[tauri::command]
pub async fn server_trust_approve(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    fingerprint: String,
) -> Result<ServerSnapshot> {
    manager.approve(&app, &connection_id, &fingerprint).await
}
#[tauri::command]
pub async fn server_connection_update(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    patch: ConnectionPatch,
) -> Result<ServerSnapshot> {
    manager.update(&app, &connection_id, patch).await
}
#[tauri::command]
pub async fn server_connection_remove(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<()> {
    manager.remove(&app, &connection_id).await
}
#[tauri::command]
pub async fn server_snapshot(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    refresh: bool,
) -> Result<ServerSnapshot> {
    manager.snapshot(&app, &connection_id, refresh).await
}
#[tauri::command]
pub async fn server_subscribe(
    app: AppHandle,
    window: WebviewWindow,
    manager: Manager<'_>,
    connection_id: String,
    topic: ServerTopic,
    channel: Channel<ServerEvent>,
) -> Result<String> {
    manager
        .inner()
        .subscribe(&app, &connection_id, topic, window.label(), channel)
        .await
}
#[tauri::command]
pub async fn server_unsubscribe(
    window: WebviewWindow,
    manager: Manager<'_>,
    handle: String,
) -> Result<()> {
    manager.unsubscribe(&handle, window.label())
}
#[tauri::command]
pub async fn server_lifecycle(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    action: String,
    expected_generation: Option<String>,
    intent_id: String,
) -> Result<ServerOperation> {
    lifecycle_deadline(async {
        manager
            .inner()
            .lifecycle(
                &app,
                &connection_id,
                &action,
                expected_generation.as_deref(),
                &intent_id,
            )
            .await
    })
    .await
}
#[tauri::command]
pub async fn server_kill_prepare(
    manager: Manager<'_>,
    connection_id: String,
    expected_generation: String,
    intent_id: String,
) -> Result<KillPreparation> {
    lifecycle_deadline(async {
        manager
            .kill_prepare(&connection_id, &expected_generation, &intent_id)
            .await
    })
    .await
}
#[tauri::command]
pub async fn server_kill_confirm(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    intent_id: String,
) -> Result<ServerOperation> {
    lifecycle_deadline(async {
        manager
            .inner()
            .confirm(&app, &connection_id, &intent_id, "lifecycle/kill")
            .await
    })
    .await
}
#[tauri::command]
pub async fn server_operations(
    manager: Manager<'_>,
    connection_id: String,
    cursor: Option<String>,
) -> Result<Page<ServerOperation>> {
    manager.operations(&connection_id, cursor.as_deref()).await
}
#[tauri::command]
pub async fn server_console_page(
    manager: Manager<'_>,
    connection_id: String,
    cursor: Option<String>,
    limit: u16,
) -> Result<ConsolePage> {
    manager
        .console_page(&connection_id, cursor.as_deref(), limit)
        .await
}
#[tauri::command]
pub async fn server_console_send(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    line: String,
    expected_generation: String,
    intent_id: String,
) -> Result<ServerOperation> {
    manager
        .inner()
        .console_send(
            &app,
            &connection_id,
            &line,
            &expected_generation,
            &intent_id,
        )
        .await
}
#[tauri::command]
pub async fn server_players(manager: Manager<'_>, connection_id: String) -> Result<PlayersView> {
    manager.players(&connection_id).await
}
#[tauri::command]
pub async fn server_players_whitelist(
    manager: Manager<'_>,
    connection_id: String,
) -> Result<Vec<WhitelistEntry>> {
    manager.whitelist(&connection_id).await
}
#[tauri::command]
pub async fn server_players_ops(
    manager: Manager<'_>,
    connection_id: String,
) -> Result<Vec<OperatorEntry>> {
    manager.operators(&connection_id).await
}
#[tauri::command]
pub async fn server_players_bans(
    manager: Manager<'_>,
    connection_id: String,
) -> Result<Vec<BanEntry>> {
    manager.bans(&connection_id).await
}
#[tauri::command]
pub async fn server_moderate(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: ModerationAction,
    expected_generation: String,
    intent_id: String,
) -> Result<ModerationResult> {
    manager
        .inner()
        .moderate(
            &app,
            &connection_id,
            request,
            &expected_generation,
            &intent_id,
        )
        .await
}
#[tauri::command]
pub async fn server_offline_whitelist(
    manager: Manager<'_>,
    connection_id: String,
) -> Result<vesta_server_client::files::OfflineWhitelistSnapshot> {
    manager.offline_whitelist(&connection_id).await
}
#[tauri::command]
pub async fn server_offline_whitelist_update(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    player: String,
    add: bool,
    expected_sha256: Option<String>,
    intent_id: String,
) -> Result<String> {
    manager
        .offline_whitelist_update(
            &app,
            &connection_id,
            &player,
            add,
            expected_sha256.as_deref(),
            &intent_id,
        )
        .await
}
#[tauri::command]
pub async fn server_moderate_confirm(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    intent_id: String,
) -> Result<ServerOperation> {
    manager
        .inner()
        .confirm(&app, &connection_id, &intent_id, "players/moderate")
        .await
}
