//! Presence and branding IPC. Endpoints, validators and sessions remain native.
use crate::servers::ServerManager;
use serde_json::json;
use std::sync::Arc;
use tauri::{AppHandle, State};
use vesta_server_client::{branding::*, presence::*, Result};
type Manager<'a> = State<'a, Arc<ServerManager>>;

#[tauri::command]
pub async fn server_sleep_policy(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<SleepPolicyView> {
    manager
        .management_read(
            &app,
            &connection_id,
            |c| async move { c.sleep_policy().await },
        )
        .await
}
#[tauri::command]
pub async fn server_sleep_policy_update(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    policy: SleepPolicy,
    expected_revision: i64,
    intent_id: String,
) -> Result<SleepPolicyView> {
    let payload = json!({"policy":policy,"expectedRevision":expected_revision});
    let intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &intent,
            "sleep/policy",
            payload,
            false,
            |c| async move {
                c.sleep_policy_update(policy, expected_revision, &intent_id)
                    .await
            },
        )
        .await
}
#[tauri::command]
pub async fn server_motd_policy(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<MotdPolicyView> {
    manager
        .management_read(
            &app,
            &connection_id,
            |c| async move { c.motd_policy().await },
        )
        .await
}
#[tauri::command]
pub async fn server_motd_policy_update(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    document: MotdDocument,
    expected_revision: Option<String>,
    intent_id: String,
) -> Result<MotdPolicyView> {
    let payload = json!({"document":document,"expectedRevision":expected_revision});
    let intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &intent,
            "motd/policy",
            payload,
            false,
            |c| async move {
                c.motd_policy_update(document, expected_revision.as_deref(), &intent_id)
                    .await
            },
        )
        .await
}
#[tauri::command]
pub async fn server_motd_preview(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    state: String,
    document: MotdDocument,
) -> Result<MotdPreview> {
    manager
        .management_read(&app, &connection_id, |c| async move {
            c.motd_preview(&state, document).await
        })
        .await
}
#[tauri::command]
pub async fn server_branding(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<ServerBranding> {
    manager
        .management_read(&app, &connection_id, |c| async move { c.branding().await })
        .await
}
#[tauri::command]
pub async fn server_branding_update(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    patch: BrandingPatch,
    expected_revision: String,
    intent_id: String,
) -> Result<ServerBranding> {
    let payload = json!({"patch":patch,"expectedRevision":expected_revision});
    let intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &intent,
            "server/branding",
            payload,
            false,
            |c| async move {
                c.branding_update(patch, &expected_revision, &intent_id)
                    .await
            },
        )
        .await
}
#[tauri::command]
pub async fn server_icon(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<Option<String>> {
    manager
        .management_read(&app, &connection_id, |c| async move { c.icon().await })
        .await
}
#[tauri::command]
pub async fn server_icon_set(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    png_base64: String,
    intent_id: String,
) -> Result<()> {
    // Validate before reserving an intent or making any request.
    decode_icon(&png_base64)?;
    let payload = json!({"pngBase64":png_base64});
    let intent = intent_id.clone();
    // Conditional headers come from a native read. Reconstructing them after an
    // uncertain write could change the same intent, so this journal is one-shot.
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &intent,
            "server/icon/set",
            payload,
            true,
            |c| async move { c.icon_set(&png_base64, &intent_id).await },
        )
        .await
}
#[tauri::command]
pub async fn server_icon_clear(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    intent_id: String,
) -> Result<()> {
    let intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &intent,
            "server/icon/clear",
            json!({}),
            true,
            |c| async move { c.icon_clear(&intent_id).await },
        )
        .await
}
#[tauri::command]
pub async fn server_device_rename(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    device_id: String,
    name: String,
    intent_id: String,
) -> Result<RenamedDevice> {
    let payload = json!({"deviceId":device_id,"name":name});
    let intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &intent,
            "devices/rename",
            payload,
            false,
            |c| async move { c.device_rename(&device_id, &name, &intent_id).await },
        )
        .await
}
