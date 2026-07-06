use crate::models::SourcePlatform;
use crate::resources::ResourceManager;
use crate::sync::manifest_bootstrap;
use crate::tasks::manager::TaskManager;
use crate::tasks::update_modpack::UpdateModpackTask;
use tauri::{Manager, State};

/// Check if a modpack update is available for the given instance.
/// Returns the current version id, latest version id, and whether an update is available.
#[tauri::command]
pub async fn check_modpack_update(
    app_handle: tauri::AppHandle,
    instance_id: i32,
) -> Result<ModpackUpdateInfo, String> {
    let mut conn = crate::utils::db::get_vesta_conn().map_err(|e| e.to_string())?;
    use crate::schema::instance::dsl::*;
    use diesel::prelude::*;

    let inst: crate::models::instance::Instance = instance
        .find(instance_id)
        .first(&mut conn)
        .map_err(|e| format!("Instance not found: {}", e))?;

    let current_version_id = match inst.modpack_version_id.as_deref() {
        Some(v) => v.to_string(),
        None => {
            return Ok(ModpackUpdateInfo {
                current_version: None,
                latest_version: None,
                update_available: false,
            })
        }
    };

    let project_id = match inst.modpack_id.as_deref() {
        Some(p) => p.to_string(),
        None => {
            return Ok(ModpackUpdateInfo {
                current_version: Some(current_version_id),
                latest_version: None,
                update_available: false,
            })
        }
    };

    let platform = match inst.modpack_platform.as_deref() {
        Some("modrinth") => SourcePlatform::Modrinth,
        _ => SourcePlatform::CurseForge,
    };

    // Check if the manifest exists — needed for delta update
    let config_dir = crate::utils::db_manager::get_app_config_dir().map_err(|e| e.to_string())?;
    let data_dir = config_dir.join("data");
    let game_dir = inst
        .game_directory
        .as_ref()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| data_dir.join("instances").join(&inst.slug()));
    // Ensure $O$ exists (bootstrap from linked version when missing, e.g. launcher import)
    if let Err(e) =
        manifest_bootstrap::ensure_old_manifest(&app_handle, &inst, &game_dir, None).await
    {
        log::warn!(
            "[check_modpack_update] Manifest unavailable for instance {}: {}",
            instance_id,
            e
        );
        return Ok(ModpackUpdateInfo {
            current_version: Some(current_version_id.clone()),
            latest_version: None,
            update_available: false,
        });
    }

    // Fetch the latest versions from the platform
    let resource_manager = app_handle.state::<ResourceManager>();

    let versions = resource_manager
        .get_versions(platform, &project_id, false, None, None)
        .await
        .map_err(|e| format!("Failed to fetch versions: {}", e))?;

    if versions.is_empty() {
        return Ok(ModpackUpdateInfo {
            current_version: Some(current_version_id),
            latest_version: None,
            update_available: false,
        });
    }

    let latest = versions
        .iter()
        .max_by(|a, b| {
            piston_lib::utils::version::compare_version_candidates(
                a.published_at.as_deref(),
                &a.version_number,
                b.published_at.as_deref(),
                &b.version_number,
            )
            .then_with(|| a.id.cmp(&b.id))
        })
        .expect("versions is non-empty after is_empty check");
    let latest_version_id = latest.id.clone();
    let update_available = latest_version_id != current_version_id;

    Ok(ModpackUpdateInfo {
        current_version: Some(current_version_id),
        latest_version: Some(ModpackVersionInfo {
            id: latest_version_id.clone(),
            version_number: latest.version_number.clone(),
            release_type: format!("{:?}", latest.release_type),
        }),
        update_available,
    })
}

/// Start a modpack update. Submits the UpdateModpackTask to the task manager.
#[tauri::command]
pub async fn start_modpack_update(
    app_handle: tauri::AppHandle,
    task_manager: State<'_, TaskManager>,
    instance_id: i32,
    new_version_id: String,
) -> Result<(), String> {
    let mut conn = crate::utils::db::get_vesta_conn().map_err(|e| e.to_string())?;
    use crate::schema::instance::dsl::*;
    use diesel::prelude::*;

    let inst: crate::models::instance::Instance = instance
        .find(instance_id)
        .first(&mut conn)
        .map_err(|e| format!("Instance not found: {}", e))?;

    let config_dir = crate::utils::db_manager::get_app_config_dir().map_err(|e| e.to_string())?;
    let data_dir = config_dir.join("data");
    let game_dir = inst
        .game_directory
        .as_ref()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| data_dir.join("instances").join(&inst.slug()));

    crate::tasks::update_modpack::write_pending_modpack_update(&game_dir, &new_version_id)?;

    crate::commands::instances::update_instance_operation(&app_handle, instance_id, "update")?;
    crate::commands::instances::update_installation_status(&app_handle, instance_id, "installing")?;

    let task = UpdateModpackTask::new(instance_id, new_version_id);
    if let Err(e) = task_manager.submit(Box::new(task)).await {
        let _ = crate::commands::instances::update_installation_status(
            &app_handle,
            instance_id,
            "installed",
        );
        crate::tasks::update_modpack::clear_pending_modpack_update(&game_dir);
        return Err(e.to_string());
    }

    Ok(())
}

/// Information about an available modpack update.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ModpackUpdateInfo {
    pub current_version: Option<String>,
    pub latest_version: Option<ModpackVersionInfo>,
    pub update_available: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ModpackVersionInfo {
    pub id: String,
    pub version_number: String,
    pub release_type: String,
}
