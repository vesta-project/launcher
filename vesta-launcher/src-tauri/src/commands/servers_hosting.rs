//! Thin owner-hosting IPC; paths, software tokens and SFTP URLs stay native.
use crate::servers::ServerManager;
use serde_json::json;
use std::sync::Arc;
use tauri::{AppHandle, State};
use vesta_server_client::{Error, ErrorCode, Result, hosting::*};
type Manager<'a> = State<'a, Arc<ServerManager>>;
macro_rules! read_command {
    ($name:ident,$ty:ty,$method:ident) => {
        #[tauri::command]
        pub async fn $name(
            app: AppHandle,
            manager: Manager<'_>,
            connection_id: String,
        ) -> Result<$ty> {
            manager
                .management_read(&app, &connection_id, |client| async move {
                    client.$method().await
                })
                .await
        }
    };
}
read_command!(server_world, ServerWorld, world);
read_command!(server_software, SoftwareState, software);
read_command!(server_sftp, SftpStatus, sftp);
read_command!(server_sftp_keys, Vec<SftpKey>, sftp_keys);
#[tauri::command]
pub async fn server_software_jobs(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<Vec<SoftwareJob>> {
    manager
        .management_read(&app, &connection_id, |client| async move {
            client.software_jobs(true).await
        })
        .await
}
#[tauri::command]
pub async fn server_software_versions(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    software: String,
) -> Result<SoftwareVersions> {
    manager
        .management_read(&app, &connection_id, |client| async move {
            client.software_versions(&software).await
        })
        .await
}
#[tauri::command]
pub async fn server_software_plan(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: SoftwarePlanRequest,
) -> Result<SoftwarePlan> {
    manager
        .management_read(&app, &connection_id, |client| async move {
            client.software_plan(request).await
        })
        .await
}
#[tauri::command]
pub async fn server_software_apply(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    plan_id: String,
    acknowledge_warnings: bool,
    acknowledge_legacy_checksum: bool,
    intent_id: String,
) -> Result<SoftwareJob> {
    let payload = json!({"planId":plan_id,"acknowledgeWarnings":acknowledge_warnings,"acknowledgeLegacyChecksum":acknowledge_legacy_checksum});
    let journal = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &journal,
            "software/apply",
            payload,
            false,
            |client| async move {
                client
                    .software_apply(
                        plan_id,
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
pub async fn server_software_rollback(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    expected_revision: String,
    intent_id: String,
) -> Result<SoftwareJob> {
    let payload = json!({"expectedRevision":expected_revision});
    let journal = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &journal,
            "software/rollback",
            payload,
            false,
            |client| async move {
                client
                    .software_rollback(expected_revision, &intent_id)
                    .await
            },
        )
        .await
}
#[tauri::command]
pub async fn server_sftp_update(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    patch: SftpConfigPatch,
    intent_id: String,
) -> Result<SftpStatus> {
    let payload = serde_json::to_value(&patch).map_err(|_| Error::new(ErrorCode::InvalidInput))?;
    let journal = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &journal,
            "sftp",
            payload,
            false,
            |client| async move { client.sftp_update(patch, &intent_id).await },
        )
        .await
}
#[tauri::command]
pub async fn server_sftp_key_add(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    principal_id: String,
    label: String,
    public_key: String,
    expires_at_ms: Option<i64>,
    intent_id: String,
) -> Result<SftpKey> {
    let payload = json!({"principalId":principal_id,"label":label,"publicKey":public_key,"expiresAtMs":expires_at_ms});
    let journal = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &journal,
            "sftp/keys",
            payload,
            false,
            |client| async move {
                client
                    .sftp_key_add(principal_id, label, public_key, expires_at_ms, &intent_id)
                    .await
            },
        )
        .await
}
#[tauri::command]
pub async fn server_sftp_key_revoke(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    key_id: String,
    intent_id: String,
) -> Result<()> {
    let payload = json!({"keyId":key_id});
    let journal = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &journal,
            "sftp/keys/revoke",
            payload,
            false,
            |client| async move { client.sftp_key_revoke(key_id, &intent_id).await },
        )
        .await
}
#[tauri::command]
pub async fn server_sftp_open(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<SftpTarget> {
    let status = manager
        .management_read(
            &app,
            &connection_id,
            |client| async move { client.sftp().await },
        )
        .await?;
    let (url, target) = manager.sftp_target(&connection_id, &status).await?;
    tauri::async_runtime::spawn_blocking(move || open::that(url))
        .await
        .map_err(|_| Error::new(ErrorCode::Internal))?
        .map_err(|_| {
            let mut error = Error::new(ErrorCode::Unsupported);
            error.reason = Some("sftp_no_handler".into());
            error
        })?;
    Ok(target)
}

read_command!(server_java_inventory,ServerJavaInventory,java_inventory);
#[tauri::command]
pub async fn server_java_select(app:AppHandle,manager:Manager<'_>,connection_id:String,runtime_id:Option<String>,custom_path:Option<String>,intent_id:String)->Result<SoftwareJob>{
    let payload=json!({"runtimeId":runtime_id,"customPath":custom_path});let journal=intent_id.clone();
    manager.management_write(&app,&connection_id,&journal,"java/select",payload,false,|client|async move{client.java_select(runtime_id,custom_path,&intent_id).await}).await
}
#[tauri::command]
pub async fn server_java_download(app:AppHandle,manager:Manager<'_>,connection_id:String,major:u32,intent_id:String)->Result<SoftwareJob>{
    let journal=intent_id.clone();manager.management_write(&app,&connection_id,&journal,"java/download",json!({"major":major}),false,|client|async move{client.java_download(major,&intent_id).await}).await
}

#[tauri::command]
pub async fn server_world_datapack_toggle(app:AppHandle,manager:Manager<'_>,connection_id:String,pack_id:String,enabled:bool,expected_generation:String,intent_id:String)->Result<vesta_server_client::model::ServerOperation>{
    let journal=intent_id.clone();let payload=json!({"packId":pack_id,"enabled":enabled,"expectedGeneration":expected_generation});
    manager.management_write(&app,&connection_id,&journal,"world/datapacks/toggle",payload,false,|client|async move{client.world_datapack_toggle(pack_id,enabled,expected_generation,&intent_id).await}).await
}
