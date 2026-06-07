use crate::models::SourcePlatform;
use crate::resources::ResourceManager;
use crate::tasks::manager::TaskManager;
use crate::tasks::update_modpack::UpdateModpackTask;
use piston_lib::game::modpack::manifest::ModpackManifest;
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
    let config_dir =
        crate::utils::db_manager::get_app_config_dir().map_err(|e| e.to_string())?;
    let data_dir = config_dir.join("data");
    let game_dir = inst
        .game_directory
        .as_ref()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| data_dir.join("instances").join(&inst.slug()));
    let manifest_path = game_dir.join(ModpackManifest::FILE_NAME);

    if !manifest_path.exists() {
        return Ok(ModpackUpdateInfo {
            current_version: Some(current_version_id.clone()),
            latest_version: None,
            update_available: false,
        });
    }

    // Ensure manifest is readable (delta update requires a valid persisted manifest)
    if ModpackManifest::load(&game_dir).is_err() {
        return Ok(ModpackUpdateInfo {
            current_version: Some(current_version_id.clone()),
            latest_version: None,
            update_available: false,
        });
    }

    // Fetch the latest versions from the platform
    let resource_manager = app_handle.state::<ResourceManager>();

    let mut versions = resource_manager
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

    versions.sort_by(|a, b| {
        b.published_at
            .cmp(&a.published_at)
            .then_with(|| b.version_number.cmp(&a.version_number))
    });

    let latest = versions
        .first()
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
    task_manager: State<'_, TaskManager>,
    instance_id: i32,
    new_version_id: String,
) -> Result<(), String> {
    let task = UpdateModpackTask::new(instance_id, new_version_id);
    task_manager
        .submit(Box::new(task))
        .await
        .map_err(|e| e.to_string())
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
