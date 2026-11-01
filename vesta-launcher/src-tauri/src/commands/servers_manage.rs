//! Exact camelCase argument and DTO contract in servers/native-manage.ts.
use crate::servers::ServerManager;
use serde_json::json;
use std::sync::Arc;
use tauri::{AppHandle, State};
use vesta_server_client::{management::*, Result};
type Manager<'a> = State<'a, Arc<ServerManager>>;

#[tauri::command]
pub async fn server_backups(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    before: Option<String>,
) -> Result<BackupOverview> {
    manager
        .management_read(&app, &connection_id, |client| async move {
            client.backups(before.as_deref()).await
        })
        .await
}

#[tauri::command]
pub async fn server_backup_snapshots(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    profile: String,
) -> Result<Vec<BackupSnapshot>> {
    manager
        .management_read(&app, &connection_id, |client| async move {
            client.backup_snapshots(&profile).await
        })
        .await
}

#[tauri::command]
pub async fn server_backup_storage(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    refresh: Option<bool>,
) -> Result<BackupStorage> {
    manager
        .management_read(&app, &connection_id, |client| async move {
            if refresh.unwrap_or(false) {
                client.transport.invalidate_reads();
            }
            client.backup_storage().await
        })
        .await
}

#[tauri::command]
pub async fn server_users(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    offset: u32,
) -> Result<UsersPage> {
    manager
        .management_read(&app, &connection_id, |client| async move {
            client.users(offset).await
        })
        .await
}

#[tauri::command]
pub async fn server_roles(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<Vec<RoleSummary>> {
    manager
        .management_read(&app, &connection_id, |client| async move {
            client.roles().await
        })
        .await
}

#[tauri::command]
pub async fn server_devices(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<Vec<ServerDevice>> {
    manager
        .management_read(&app, &connection_id, |client| async move {
            client.devices().await
        })
        .await
}

#[tauri::command]
pub async fn server_invitations(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<Vec<Invitation>> {
    manager
        .management_read(&app, &connection_id, |client| async move {
            client.invitations().await
        })
        .await
}

#[tauri::command]
pub async fn server_access_sources(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<AccessSources> {
    manager
        .management_read(&app, &connection_id, |client| async move {
            client.access_sources().await
        })
        .await
}

#[tauri::command]
pub async fn server_backup_run(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    profile: String,
    intent_id: String,
) -> Result<BackupJob> {
    let payload = json!({"profile":profile});
    let journal_intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &journal_intent,
            "backups/run",
            payload.clone(),
            false,
            |client| async move { client.backup_submit("run", payload, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_backup_verify(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    profile: String,
    intent_id: String,
) -> Result<BackupJob> {
    let payload = json!({"profile":profile});
    let journal_intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &journal_intent,
            "backups/verify",
            payload.clone(),
            false,
            |client| async move { client.backup_submit("verify", payload, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_backup_restore_copy(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    profile: String,
    snapshot: String,
    paths: Vec<String>,
    intent_id: String,
) -> Result<BackupJob> {
    let payload = json!({"profile":profile,"snapshot":snapshot,"paths":paths});
    let journal_intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &journal_intent,
            "backups/restore",
            payload.clone(),
            false,
            |client| async move { client.backup_submit("restore", payload, &intent_id).await },
        )
        .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn server_backup_restore_prepare(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    profile: String,
    snapshot: String,
    paths: Vec<String>,
    skip_safety_snapshot: bool,
    intent_id: String,
) -> Result<RestorePreparation> {
    let payload = json!({"profile":profile,"snapshot":snapshot,"paths":paths,"skip_safety_snapshot":skip_safety_snapshot});
    let journal_intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &journal_intent,
            "backups/restore-in-place",
            payload.clone(),
            true,
            |client| async move { client.backup_restore_prepare(payload, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_backup_restore_confirm(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    job_id: String,
) -> Result<BackupJob> {
    let intent_id = format!("backup-confirm:{job_id}");
    let payload = json!({"job_id":job_id});
    let journal_intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &journal_intent,
            "backups/confirm",
            payload.clone(),
            true,
            |client| async move { client.backup_restore_confirm(&job_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_backup_resolve_recovery(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    job_id: String,
) -> Result<BackupJob> {
    let intent_id = format!("backup-recovery:{job_id}");
    let payload = json!({"job_id":job_id});
    let journal_intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &journal_intent,
            "backups/resolve-recovery",
            payload.clone(),
            false,
            |client| async move { client.backup_resolve_recovery(&job_id).await },
        )
        .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn server_user_roles(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    user_id: String,
    add: Vec<String>,
    remove: Vec<String>,
    expected_version: String,
    intent_id: String,
) -> Result<ServerUser> {
    let payload =
        json!({"user_id":user_id,"add":add,"remove":remove,"expected_version":expected_version});
    let journal_intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &journal_intent,
            "users/roles",
            payload.clone(),
            false,
            |client| async move {
                client
                    .user_roles(
                        &user_id,
                        json!({"add":add,"remove":remove,"expected_version":expected_version}),
                        &intent_id,
                    )
                    .await
            },
        )
        .await
}

#[tauri::command]
pub async fn server_device_revoke(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    device_id: String,
    intent_id: String,
) -> Result<()> {
    let payload = json!({"device_id":device_id});
    let journal_intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &journal_intent,
            "devices/revoke",
            payload.clone(),
            false,
            |client| async move { client.device_revoke(&device_id, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_invitation_create(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    role_id: String,
    expires_minutes: u16,
    multi_use: Option<bool>,
    max_uses: Option<u32>,
    intent_id: String,
) -> Result<IssuedInvitation> {
    let payload = json!({"role":role_id,"expires_minutes":expires_minutes,"multi_use":multi_use,"max_uses":max_uses});
    let journal_intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &journal_intent,
            "invitations/create",
            payload.clone(),
            false,
            |client| async move {
                client
                    .invitation_create_bulk(
                        &role_id,
                        expires_minutes,
                        &intent_id,
                        multi_use.unwrap_or(false),
                        max_uses,
                    )
                    .await
            },
        )
        .await
}

#[tauri::command]
pub async fn server_invitation_revoke(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    invitation_id: String,
    intent_id: String,
) -> Result<()> {
    let payload = json!({"invitation_id":invitation_id});
    let journal_intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &journal_intent,
            "invitations/revoke",
            payload.clone(),
            false,
            |client| async move { client.invitation_revoke(&invitation_id, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_access_sources_update(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    patch: AccessPatch,
    expected_version: String,
    intent_id: String,
) -> Result<AccessSources> {
    let payload = patch.wire(&expected_version);
    let journal_intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &journal_intent,
            "access-sources",
            payload.clone(),
            false,
            |client| async move {
                client
                    .access_sources_update(&patch, &expected_version, &intent_id)
                    .await
            },
        )
        .await
}

#[tauri::command]
pub async fn server_pack_publish(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    expected_revision: String,
    intent_id: String,
) -> Result<PackOutcome> {
    let payload = json!({"expected_revision":expected_revision});
    let journal_intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &journal_intent,
            "pack/publish",
            payload.clone(),
            false,
            |client| async move { client.pack_publish(&expected_revision, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_pack_minimum(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    expected_revision: String,
    minimum_revision: String,
    intent_id: String,
) -> Result<PackOutcome> {
    let payload =
        json!({"expected_revision":expected_revision,"minimum_revision":minimum_revision});
    let journal_intent = intent_id.clone();
    manager
        .inner()
        .management_write(
            &app,
            &connection_id,
            &journal_intent,
            "pack/minimum",
            payload.clone(),
            false,
            |client| async move {
                client
                    .pack_minimum(&expected_revision, &minimum_revision, &intent_id)
                    .await
            },
        )
        .await
}
