use crate::models::instance::{Instance, NewInstance};
use crate::schema::instance::dsl::*;
use crate::tasks::installers::InstallInstanceTask;
use crate::tasks::maintenance::{CloneInstanceTask, ResetInstanceTask, RepairInstanceTask};
use crate::tasks::manager::TaskManager;
use crate::tasks::manifest::GenerateManifestTask;
use crate::utils::db::get_vesta_conn;
use crate::resources::ResourceWatcher;
use diesel::prelude::*;
use std::sync::Arc;
use tauri::{Manager, State};

/// Compute canonical instance game directory path under the given instances root
fn compute_instance_game_dir(root: &std::path::Path, slug: &str) -> String {
    root.join(slug).to_string_lossy().to_string()
}

/// Update playtime for an instance in the database
fn update_instance_playtime(
    app_handle: &tauri::AppHandle,
    instance_id_slug: &str,
    started_at_str: &str,
    exited_at_str: &str,
) -> Result<(), String> {
    use crate::schema::instance::dsl::*;
    // Parse timestamps
    let started = chrono::DateTime::parse_from_rfc3339(started_at_str)
        .map_err(|e| format!("Failed to parse started_at: {}", e))?;
    let exited = chrono::DateTime::parse_from_rfc3339(exited_at_str)
        .map_err(|e| format!("Failed to parse exited_at: {}", e))?;

    // Calculate duration in minutes
    let duration = exited.signed_duration_since(started);
    let minutes = (duration.num_seconds() / 60).max(0) as i32;

    log::info!(
        "Updating playtime for instance {}: {} minutes (from {} to {})",
        instance_id_slug,
        minutes,
        started_at_str,
        exited_at_str
    );

    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    // Find instance by slug
    let instances_list = instance
        .load::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?;

    for inst in instances_list {
        if inst.slug() == instance_id_slug {
            let new_playtime = inst.total_playtime_minutes + minutes;
            let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

            diesel::update(instance.filter(id.eq(inst.id)))
                .set((
                    total_playtime_minutes.eq(new_playtime),
                    last_played.eq(&now),
                    updated_at.eq(&now),
                ))
                .execute(&mut conn)
                .map_err(|e| format!("Failed to update playtime: {}", e))?;

            log::info!(
                "Updated playtime for instance {} (id {}): {} -> {} minutes",
                instance_id_slug,
                inst.id,
                inst.total_playtime_minutes,
                new_playtime
            );

            // Fetch the updated instance to emit
            if let Ok(updated_inst) = instance.find(inst.id).first::<Instance>(&mut conn) {
                use tauri::Emitter;
                let _ = app_handle.emit("core://instance-updated", updated_inst);
            }

            return Ok(());
        }
    }

    log::warn!(
        "Instance {} not found in database for playtime update",
        instance_id_slug
    );
    Ok(())
}

/// Store crash details in the database for an instance
fn store_crash_details(
    instance_id_slug: &str,
    crash_info: &crate::utils::crash_parser::CrashDetails,
) -> Result<(), String> {
    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    let all_instances = instance
        .load::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?;

    for inst in all_instances {
        if inst.slug() == instance_id_slug {
            // Create crash details JSON
            let crash_details_json = serde_json::json!({
                "crash_type": crash_info.crash_type,
                "message": crash_info.message,
                "report_path": crash_info.report_path,
                "timestamp": crash_info.timestamp,
            });

            diesel::update(instance.filter(id.eq(inst.id)))
                .set((
                    crashed.eq(true),
                    crash_details.eq(crash_details_json.to_string()),
                ))
                .execute(&mut conn)
                .map_err(|e| format!("Failed to update crash details: {}", e))?;

            log::info!(
                "Stored crash details for instance {} (id {})",
                instance_id_slug,
                inst.id
            );
            return Ok(());
        }
    }

    Err(format!(
        "Instance {} not found in database",
        instance_id_slug
    ))
}

/// Clear the crashed flag for an instance when it successfully launches
fn clear_crash_flag(instance_id_slug: &str) -> Result<(), String> {
    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    let all_instances = instance
        .load::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?;

    for inst in all_instances {
        if inst.slug() == instance_id_slug {
            diesel::update(instance.filter(id.eq(inst.id)))
                .set((crashed.eq(false), crash_details.eq::<Option<String>>(None)))
                .execute(&mut conn)
                .map_err(|e| format!("Failed to clear crash flag: {}", e))?;

            log::info!(
                "Cleared crash flag for instance {} (id {})",
                instance_id_slug,
                inst.id
            );
            return Ok(());
        }
    }

    Err(format!(
        "Instance {} not found in database",
        instance_id_slug
    ))
}

#[tauri::command]
pub async fn install_instance(
    app_handle: tauri::AppHandle,
    task_manager: State<'_, TaskManager>,
    instance_data: Instance,
    dry_run: Option<bool>,
) -> Result<(), String> {
    log::info!(
        "[install_instance] Command invoked for instance: {} (dry_run={:?})",
        instance_data.name,
        dry_run
    );
    log::info!(
        "[install_instance] Instance details - version: {}, modloader: {:?}, modloader_version: {:?}",
        instance_data.minecraft_version,
        instance_data.modloader,
        instance_data.modloader_version
    );

    log::info!("[install_instance] Creating InstallInstanceTask");
    let mut task = InstallInstanceTask::new(instance_data.clone());
    if let Some(dr) = dry_run {
        task.set_dry_run(dr);
    }

    log::info!("[install_instance] Submitting task to TaskManager");
    match task_manager.submit(Box::new(task)).await {
        Ok(_) => {
            // Immediately update DB to 'installing' so UI shows progress without waiting
            if instance_data.id > 0 {
                let _ = crate::commands::instances::update_instance_operation(
                    &app_handle,
                    instance_data.id,
                    "install",
                );
                let _ = crate::commands::instances::update_installation_status(
                    &app_handle,
                    instance_data.id,
                    "installing",
                );
            }
            // Emit an early update so UI homescreen refreshes as soon as installation starts
            // (Note: update_installation_status already emits core://instance-updated now)

            log::info!(
                "[install_instance] Task submitted successfully for: {}",
                instance_data.name
            );
            Ok(())
        }
        Err(e) => {
            log::error!("[install_instance] Failed to submit task: {}", e);
            Err(e)
        }
    }
}

fn process_instance_icon(mut inst: Instance) -> Instance {
    // If we have icon_data, we should prefer serving it via base64 for offline compatibility,
    // unless the icon_path is a gradient (which doesn't use icon_data).
    let is_gradient = inst.icon_path.as_ref().map(|p| p.starts_with("linear-gradient")).unwrap_or(false);
    
    if !is_gradient {
        if let Some(ref data) = inst.icon_data {
            use base64::{Engine as _, engine::general_purpose};
            let b64 = general_purpose::STANDARD.encode(data);
            inst.icon_path = Some(format!("data:image/png;base64,{}", b64));
        } else if let Some(ref url) = inst.modpack_icon_url {
             // Fallback to URL if we have one but no data yet
             inst.icon_path = Some(url.clone());
        }
    }
    inst
}

#[tauri::command]
pub fn list_instances() -> Result<Vec<Instance>, String> {
    log::info!("Fetching all instances from database");

    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    let instances = instance
        .order((last_played.desc(), created_at.desc()))
        .load::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?;

    log::info!("Retrieved {} instances", instances.len());
    
    let processed = instances.into_iter().map(process_instance_icon).collect();
    Ok(processed)
}

#[tauri::command]
pub async fn create_instance(
    app_handle: tauri::AppHandle,
    instance_data: Instance,
    resource_watcher: State<'_, ResourceWatcher>,
) -> Result<i32, String> {
    log::info!(
        "[create_instance] Command invoked for instance: {}",
        instance_data.name
    );
    log::info!(
        "[create_instance] Instance details - version: {}, modloader: {:?}, modloader_version: {:?}",
        instance_data.minecraft_version,
        instance_data.modloader,
        instance_data.modloader_version
    );

    log::info!("[create_instance] Getting database connection");
    let mut conn = get_vesta_conn().map_err(|e| {
        log::error!("[create_instance] Failed to get database: {}", e);
        format!("Failed to get database: {}", e)
    })?;

    log::info!("[create_instance] Determining unique slug and game directory");

    // Make a mutable copy so we can set defaults (game_directory) before inserting
    let mut inst = instance_data;

    // Get app config to check for custom instances directory
    let config = crate::utils::config::get_app_config().map_err(|e| e.to_string())?;

    // Determine config data dir
    let app_config_dir = crate::utils::db_manager::get_app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;

    // Use custom directory if set, otherwise default to %APPDATA%/.VestaLauncher/instances
    let instances_root = if let Some(ref dir) = config.default_game_dir {
        if !dir.is_empty() && dir != "/" {
            std::path::PathBuf::from(dir)
        } else {
            app_config_dir.join("instances")
        }
    } else {
        app_config_dir.join("instances")
    };

    log::info!("[create_instance] Using instances root: {:?}", instances_root);

    // Fetch existing instance names and compute their slugs
    let existing_names: Vec<String> = instance
        .select(name)
        .load::<String>(&mut conn)
        .map_err(|e| format!("Failed to query existing instance names: {}", e))?;

    let mut seen_names = std::collections::HashSet::new();
    let mut seen_slugs = std::collections::HashSet::new();
    for existing_name in existing_names {
        seen_names.insert(existing_name.to_lowercase());
        seen_slugs.insert(crate::utils::sanitize::sanitize_instance_name(
            &existing_name,
        ));
    }

    // Check for duplicate name (case-insensitive) and make it unique
    inst.name = crate::utils::instance_helpers::compute_unique_name(&inst.name, &seen_names);

    // Handle Icon: If it's a base64 data URL, convert to icon_data and set icon_path to reflect it's stored
    if let Some(ref path) = inst.icon_path {
        if path.starts_with("data:image/") {
            log::info!("[create_instance] Converting base64 icon to binary data");
            if let Some(base64_part) = path.split(",").collect::<Vec<&str>>().get(1) {
                use base64::{Engine as _, engine::general_purpose};
                if let Ok(bytes) = general_purpose::STANDARD.decode(base64_part) {
                    inst.icon_data = Some(bytes);
                    inst.icon_path = Some("internal://icon".to_string());
                }
            }
        } else if !path.starts_with("internal://") && !path.starts_with("linear-gradient") {
            log::debug!("[create_instance] Setting preset icon, ensuring icon_data is fresh if modpack icon exists");
            // If it's a preset, we don't clear icon_data YET because it might be the modpack icon being downloaded.
            // But if it's NOT a modpack, we should clear it.
            if inst.modpack_icon_url.is_none() {
                inst.icon_data = None;
            }
        }
    }

    // If we have a modpack icon URL but no bytes, try to download them now
    if inst.modpack_icon_url.is_some() && inst.icon_data.is_none() {
        if let Ok(bytes) = crate::utils::instance_helpers::download_icon_as_bytes(inst.modpack_icon_url.as_ref().unwrap()).await {
            log::info!("[create_instance] Successfully downloaded icon for offline use ({} bytes)", bytes.len());
            inst.icon_data = Some(bytes);
        }
    }

    // Fetch existing instance names and compute their slugs
    let slug = crate::utils::instance_helpers::compute_unique_slug(
        &inst.name,
        &seen_slugs,
        &instances_root,
    );

    // Always set the instance game_directory to the configured instances root
    // using the computed instance id (slug).
    let gd = compute_instance_game_dir(&instances_root, &slug);
    if inst.game_directory.is_some() {
        log::info!(
            "[create_instance] Overriding supplied game_directory with instances root path: {}",
            gd
        );
    }
    inst.game_directory = Some(gd.clone());

    // Ensure common directories exist - specifically "mods" for modloader instances
    if let Err(e) = std::fs::create_dir_all(&gd) {
        log::error!("[create_instance] Failed to create game directory: {}", e);
    } else if inst.modloader.is_some() {
        let mods_dir = std::path::PathBuf::from(&gd).join("mods");
        if let Err(e) = std::fs::create_dir_all(&mods_dir) {
            log::error!("[create_instance] Failed to create mods directory: {}", e);
        } else {
            log::info!("[create_instance] Created mods directory for modloader instance: {}", inst.name);
        }
    }

    log::info!("[create_instance] Inserting instance into database");

    // Create NewInstance from Instance (excluding ID which works automatically)
    let new_instance = NewInstance {
        name: inst.name,
        minecraft_version: inst.minecraft_version,
        modloader: inst.modloader,
        modloader_version: inst.modloader_version,
        java_path: inst.java_path,
        java_args: inst.java_args,
        game_directory: inst.game_directory,
        width: inst.width,
        height: inst.height,
        min_memory: inst.min_memory,
        max_memory: inst.max_memory,
        icon_path: inst.icon_path,
        last_played: inst.last_played,
        total_playtime_minutes: inst.total_playtime_minutes,
        created_at: Some(chrono::Utc::now().to_rfc3339()),
        updated_at: Some(chrono::Utc::now().to_rfc3339()),
        installation_status: Some("installed".to_string()),
        crashed: None,
        crash_details: None,
        modpack_id: inst.modpack_id,
        modpack_version_id: inst.modpack_version_id,
        modpack_platform: inst.modpack_platform,
        modpack_icon_url: inst.modpack_icon_url,
        icon_data: inst.icon_data,
        last_operation: None,
    };

    diesel::insert_into(instance)
        .values(&new_instance)
        .execute(&mut conn)
        .map_err(|e| {
            log::error!("[create_instance] Failed to insert instance: {}", e);
            format!("Failed to insert instance: {}", e)
        })?;

    // Get the ID of the inserted row
    let inserted_id: i32 = instance
        .select(id)
        .order(id.desc())
        .first(&mut conn)
        .map_err(|e| format!("Failed to get inserted instance ID: {}", e))?;

    // Fetch the full instance and emit created event
    if let Ok(full_instance) = instance.find(inserted_id).first::<Instance>(&mut conn) {
        use tauri::Emitter;
        let _ = app_handle.emit("core://instance-created", full_instance);
    }

    // Set initial installation_status to "pending"
    let _ = crate::commands::instances::update_installation_status(&app_handle, inserted_id, "installing");

    // Start watching the new instance's folders for mods/packs
    log::info!(
        "[create_instance] Initializing resource watcher for instance: {} ({})",
        slug,
        inserted_id
    );
    if let Err(e) = resource_watcher.watch_instance(slug.clone(), inserted_id, gd).await {
        log::error!("[create_instance] Failed to start resource watcher: {}", e);
    }

    log::info!(
        "[create_instance] Instance created successfully with ID: {} and slug: {}",
        inserted_id,
        slug
    );

    Ok(inserted_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn compute_game_dir_uses_slug() {
        let root = PathBuf::from("C:/Users/test/.VestaLauncher/instances");
        let slug = "my-instance";
        let got = compute_instance_game_dir(&root, slug);
        assert_eq!(got, root.join(slug).to_string_lossy().to_string());
    }
}

#[tauri::command]
pub async fn update_instance(
    app_handle: tauri::AppHandle,
    instance_data: Instance,
    resource_watcher: tauri::State<'_, crate::resources::watcher::ResourceWatcher>,
) -> Result<(), String> {
    log::info!(
        "[update_instance] Updating instance: {:?}",
        instance_data.id
    );

    let mut final_instance = instance_data.clone();

    // Handle Icon: If it's a base64 data URL, convert to icon_data and set icon_path to reflect it's stored
    if let Some(ref path) = final_instance.icon_path {
        if path.starts_with("data:image/") {
            log::info!("[update_instance] Converting base64 icon to binary data");
            if let Some(base64_part) = path.split(",").collect::<Vec<&str>>().get(1) {
                use base64::{Engine as _, engine::general_purpose};
                if let Ok(bytes) = general_purpose::STANDARD.decode(base64_part) {
                    final_instance.icon_data = Some(bytes);
                    final_instance.icon_path = Some("internal://icon".to_string());
                }
            }
        } else if !path.starts_with("internal://") && !path.starts_with("linear-gradient") {
            // If it's a preset or something else, clear the custom icon data
            log::debug!("[update_instance] Clearing binary icon data as path is now a preset: {}", path);
            final_instance.icon_data = None;
        }
    }

    // Download icon for offline use if we have a URL but no bytes (e.g. newly linked or recently updated)
    if final_instance.modpack_icon_url.is_some() && final_instance.icon_data.is_none() {
        if let Ok(bytes) = crate::utils::instance_helpers::download_icon_as_bytes(final_instance.modpack_icon_url.as_ref().unwrap()).await {
            log::info!("[update_instance] Successfully downloaded icon for offline use ({} bytes)", bytes.len());
            final_instance.icon_data = Some(bytes);
        }
    }

    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    let update_id = instance_data.id;
    if update_id <= 0 {
        return Err("Cannot update instance with uninitialized ID".to_string());
    }

    // Fetch the existing row so we can detect name changes and old game_directory
    let existing_row: (String, Option<String>) = instance
        .find(update_id)
        .select((name, game_directory))
        .first(&mut conn)
        .map_err(|e| format!("Failed to query existing instance: {}", e))?;

    let old_name = existing_row.0;

    let old_slug = crate::utils::sanitize::sanitize_instance_name(&old_name);
    let mut new_slug = instance_data.slug();

    // If slug changes, compute unique slug against other instances and filesystem
    if old_slug != new_slug {
        // Get app config to check for custom instances directory
        let config = crate::utils::config::get_app_config().map_err(|e| e.to_string())?;

        let app_config_dir = crate::utils::db_manager::get_app_config_dir()
            .map_err(|e| format!("Failed to get app config dir: {}", e))?;

        // Use custom directory if set, otherwise default to %APPDATA%/.VestaLauncher/instances
        let instances_root = if let Some(ref dir) = config.default_game_dir {
            if !dir.is_empty() && dir != "/" {
                std::path::PathBuf::from(dir)
            } else {
                app_config_dir.join("instances")
            }
        } else {
            app_config_dir.join("instances")
        };

        // Build set of seen slugs excluding current row
        let existing_instances: Vec<(i32, String)> = instance
            .select((id, name))
            .load(&mut conn)
            .map_err(|e| format!("Failed to query existing instances: {}", e))?;

        let mut seen = std::collections::HashSet::new();
        for (rid, rname) in existing_instances {
            if rid != update_id {
                seen.insert(crate::utils::sanitize::sanitize_instance_name(&rname));
            }
        }

        // Avoid filesystem collisions using shared helper
        new_slug = crate::utils::instance_helpers::compute_unique_slug(
            &final_instance.name,
            &seen,
            &instances_root,
        );

        // Attempt to rename the instance directory if it exists
        let old_dir = instances_root.join(&old_slug);
        let new_dir = instances_root.join(&new_slug);

        if old_dir.exists() {
            if let Err(e) = std::fs::rename(&old_dir, &new_dir) {
                log::warn!(
                    "[update_instance] Failed to rename instance dir: {} -> {} : {}",
                    old_dir.display(),
                    new_dir.display(),
                    e
                );
                if let Err(e2) = std::fs::create_dir_all(&new_dir) {
                    return Err(format!("Failed to create new instance directory: {}", e2));
                }
            }
        } else if !new_dir.exists() {
            // Old dir doesn't exist — create new directory
            if let Err(e) = std::fs::create_dir_all(&new_dir) {
                return Err(format!("Failed to create instance directory: {}", e));
            }
        }

        // Update the instance.game_directory to the canonical instances root
        let new_game_dir = compute_instance_game_dir(&instances_root, &new_slug);
        final_instance.game_directory = Some(new_game_dir);

        // Move log file if exists
        let app_config_dir = crate::utils::db_manager::get_app_config_dir()
            .map_err(|e| format!("Failed to get app config dir: {}", e))?;
        let old_log = app_config_dir
            .join("data")
            .join("logs")
            .join(format!("{}.log", old_slug));
        let new_log = app_config_dir
            .join("data")
            .join("logs")
            .join(format!("{}.log", new_slug));

        if old_log.exists() {
            if let Err(e) = std::fs::rename(&old_log, &new_log) {
                log::warn!("[update_instance] Failed to move log file: {}", e);
            }
        }

        // Need to update registry if running associated with old slug
        // logic moved to background task to avoid blocking db connection
        let old_slug_clone = old_slug.clone();
        let new_slug_clone = new_slug.clone();
        let logpath = new_log.clone();
        let dirpath = final_instance.game_directory.clone().unwrap_or_default();

        tauri::async_runtime::spawn(async move {
            if let Ok(Some(running)) =
                piston_lib::game::launcher::get_instance(&old_slug_clone).await
            {
                log::info!("[update_instance] Instance currently running; updating registry id from {} to {}", old_slug_clone, new_slug_clone);
                if let Err(e) =
                    piston_lib::game::launcher::unregister_instance(&old_slug_clone).await
                {
                    log::warn!("Failed to unregister: {}", e);
                }
                let mut updated = running.clone();
                updated.instance_id = new_slug_clone;
                updated.game_dir = std::path::PathBuf::from(dirpath);
                updated.log_file = logpath;
                if let Err(e) = piston_lib::game::launcher::register_instance(updated).await {
                    log::warn!("Failed to re-register: {}", e);
                }
            }
        });

        log::info!(
            "[update_instance] Renamed/updated instance id from {} -> {}",
            old_slug,
            new_slug
        );

        // Restart watcher for new path
        if let Err(e) = resource_watcher.unwatch_instance(update_id).await {
            log::warn!("[update_instance] Failed to unwatch during rename: {}", e);
        }
        if let Some(ref gd) = final_instance.game_directory {
            if let Err(e) = resource_watcher.watch_instance(new_slug, update_id, gd.clone()).await {
                log::warn!("[update_instance] Failed to re-watch after rename: {}", e);
            }
        }
    }

    // Perform Update
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    diesel::update(instance.find(update_id))
        .set((
            name.eq(&final_instance.name),
            minecraft_version.eq(&final_instance.minecraft_version),
            modloader.eq(&final_instance.modloader),
            modloader_version.eq(&final_instance.modloader_version),
            java_path.eq(&final_instance.java_path),
            java_args.eq(&final_instance.java_args),
            game_directory.eq(&final_instance.game_directory),
            width.eq(final_instance.width),
            height.eq(final_instance.height),
            min_memory.eq(final_instance.min_memory),
            max_memory.eq(final_instance.max_memory),
            icon_path.eq(&final_instance.icon_path),
            icon_data.eq(&final_instance.icon_data),
            last_played.eq(&final_instance.last_played),
            total_playtime_minutes.eq(final_instance.total_playtime_minutes),
            modpack_id.eq(&final_instance.modpack_id),
            modpack_version_id.eq(&final_instance.modpack_version_id),
            modpack_platform.eq(&final_instance.modpack_platform),
            modpack_icon_url.eq(&final_instance.modpack_icon_url),
            icon_data.eq(&final_instance.icon_data),
            updated_at.eq(&now),
        ))
        .execute(&mut conn)
        .map_err(|e| format!("Failed to update instance: {}", e))?;

    log::info!("Updated instance ID: {}", update_id);

    // Fetch the full updated instance to emit it
    let updated: crate::models::instance::Instance = instance
        .find(update_id)
        .first(&mut conn)
        .map_err(|e| format!("Failed to fetch updated instance: {}", e))?;

    // Notify frontend
    use tauri::Emitter;
    let _ = app_handle.emit("core://instance-updated", updated);

    Ok(())
}

#[tauri::command]
pub async fn delete_instance(
    app_handle: tauri::AppHandle, 
    instance_id: i32,
    task_manager: tauri::State<'_, TaskManager>,
    resource_watcher: tauri::State<'_, crate::resources::watcher::ResourceWatcher>,
) -> Result<(), String> {
    log::info!("Deleting instance ID: {}", instance_id);

    // 0. Cancel any active tasks (install/download) for this instance
    task_manager.cancel_instance_tasks(instance_id);

    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    // 1. Fetch instance to get slug and directory before deleting
    let inst = instance.find(instance_id)
        .first::<Instance>(&mut conn)
        .map_err(|e| format!("Instance not found: {}", e))?;

    let slug_val = inst.slug();
    let game_dir = inst.game_directory.clone();

    // 2. Unwatch from resource watcher
    if let Err(e) = resource_watcher.unwatch_instance(instance_id).await {
        log::error!("Failed to unwatch instance {}: {}", instance_id, e);
    }

    // 3. Delete from database
    diesel::delete(instance.find(instance_id))
        .execute(&mut conn)
        .map_err(|e| format!("Failed to delete instance from database: {}", e))?;

    // 4. Clean up files on disk (optional but recommended since user asked)
    if let Some(gd) = game_dir {
        let gd_path = std::path::PathBuf::from(gd);
        if gd_path.exists() {
            log::info!("Removing instance directory: {:?}", gd_path);
            if let Err(e) = std::fs::remove_dir_all(&gd_path) {
                log::error!("Failed to delete instance directory at {:?}: {}", gd_path, e);
            }
        }
    }

    log::info!("Deleted instance ID: {} (slug: {})", instance_id, slug_val);

    // Notify frontend
    use tauri::Emitter;
    let _ = app_handle.emit(
        "core://instance-deleted",
        serde_json::json!({ "id": instance_id }),
    );
    Ok(())
}

#[tauri::command]
pub fn get_instance(instance_id: i32) -> Result<Instance, String> {
    log::info!("Fetching instance ID: {}", instance_id);

    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    let fetched_instance = instance
        .find(instance_id)
        .first::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to fetch instance: {}", e))?;

    log::info!("Retrieved instance: {}", fetched_instance.name);
    Ok(process_instance_icon(fetched_instance))
}

#[tauri::command]
pub fn get_instance_by_slug(slug_val: String) -> Result<Instance, String> {
    log::info!("Fetching instance by slug: {}", slug_val);

    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    // Inefficient but compatible: fetch all and matching slug
    let instances_list = instance
        .load::<Instance>(&mut conn)
        .map_err(|e| format!("Failed to query instances: {}", e))?;

    for inst in instances_list {
        if inst.slug() == slug_val {
            log::info!("Found instance by slug {}: {}", slug_val, inst.name);
            return Ok(process_instance_icon(inst));
        }
    }

    Err(format!("Instance with slug '{}' not found", slug_val))
}

#[tauri::command]
pub async fn launch_instance(
    app_handle: tauri::AppHandle,
    instance_data: Instance,
) -> Result<(), String> {
    log::info!(
        "[launch_instance] Launch requested for instance: {} (ID: {})",
        instance_data.name,
        instance_data.id
    );
    log::info!(
        "[launch_instance] Instance data: MC: {}, Loader: {:?}, Loader Version: {:?}",
        instance_data.minecraft_version,
        instance_data.modloader,
        instance_data.modloader_version
    );

    // Derive a filesystem-safe runtime instance id (slug) from the instance name
    let instance_id = instance_data.slug();

    // Get app config directory
    let data_dir = crate::utils::db_manager::get_app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;

    // Determine Java path
    let java_path_str = instance_data.java_path.clone().unwrap_or_else(|| {
        // Try to find java in PATH
        #[cfg(windows)]
        let default_java = "java.exe";
        #[cfg(not(windows))]
        let default_java = "java";

        which::which(default_java)
            .ok()
            .and_then(|p| p.to_str().map(|s| s.to_string()))
            .unwrap_or_else(|| default_java.to_string())
    });

    // Determine which data_dir to use
    let spec_data_dir = if data_dir.join("data").exists() {
        data_dir.join("data")
    } else {
        data_dir.clone()
    };

    // Derive game directory
    let config = crate::utils::config::get_app_config().map_err(|e| e.to_string())?;
    let instances_root = if let Some(ref dir) = config.default_game_dir {
        if !dir.is_empty() && dir != "/" {
            std::path::PathBuf::from(dir)
        } else {
            data_dir.join("instances")
        }
    } else {
        data_dir.join("instances")
    };

    let game_dir = instance_data.game_directory.clone().unwrap_or_else(|| {
        instances_root
            .join(&instance_id)
            .to_string_lossy()
            .to_string()
    });

    // Parse modloader type
    let modloader_type = instance_data
        .modloader
        .as_ref()
        .and_then(|m| m.parse::<piston_lib::game::ModloaderType>().ok());

    // Attempt to read the current active account
    let mut active_account = match crate::auth::get_active_account() {
        Ok(Some(acc)) => Some(acc),
        Ok(None) => None,
        Err(e) => {
            log::warn!("[launch_instance] Failed to read active account: {}", e);
            None
        }
    };

    // If we have an active account, ensure token validity
    if let Some(acc) = active_account.clone() {
        if let Err(e) = crate::auth::ensure_account_tokens_valid(acc.uuid.clone()).await {
            log::error!("[launch_instance] Failed to refresh token: {}", e);
            return Err(format!("Failed to refresh authentication: {}", e));
        }

        // Re-fetch
        active_account = match crate::auth::get_active_account() {
            Ok(Some(acc)) => Some(acc),
            Ok(None) => None,
            Err(_) => None,
        };
    }

    // Build launch spec
    let exit_handler_jar = app_handle
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("exit-handler.jar"))
        .filter(|p| p.exists())
        .or_else(|| {
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent() // src-tauri -> vesta-launcher
                .map(|p| {
                    p.join("resources")
                        .join("exit-handler")
                        .join("exit-handler.jar")
                })
                .filter(|p| p.exists())
        });

    // Determine log file path
    let log_file = spec_data_dir
        .join("logs")
        .join(format!("{}.log", instance_id));

    let spec = piston_lib::game::launcher::LaunchSpec {
        instance_id: instance_id.clone(),
        version_id: instance_data.minecraft_version.clone(),
        modloader: modloader_type,
        modloader_version: instance_data.modloader_version.clone(),
        data_dir: spec_data_dir.clone(),
        game_dir: std::path::PathBuf::from(&game_dir),
        java_path: std::path::PathBuf::from(&java_path_str),
        min_memory: Some(instance_data.min_memory as u32),
        max_memory: Some(instance_data.max_memory as u32),
        username: active_account
            .as_ref()
            .map(|a| a.username.clone())
            .unwrap_or_else(|| "Player".to_string()),
        uuid: active_account
            .as_ref()
            .map(|a| a.uuid.clone())
            .unwrap_or_else(|| "00000000-0000-0000-0000-000000000000".to_string()),
        access_token: active_account
            .as_ref()
            .and_then(|a| a.access_token.clone())
            .unwrap_or_else(|| "0".to_string()),
        xuid: None,
        client_id: piston_lib::auth::CLIENT_ID.to_string(),
        user_type: "msa".to_string(),
        jvm_args: instance_data
            .java_args
            .map(|args| args.split_whitespace().map(|s| s.to_string()).collect())
            .unwrap_or_default(),
        game_args: vec![],
        window_width: Some(instance_data.width as u32),
        window_height: Some(instance_data.height as u32),
        exit_handler_jar,
        log_file: Some(log_file),
    };

    log::info!(
        "[launch_instance] Launching game: {} {}",
        spec.instance_id,
        spec.version_id
    );

    // Log batching setup
    let (log_tx, mut log_rx) = tokio::sync::mpsc::unbounded_channel::<(String, String, String)>();
    let app_for_batcher = app_handle.clone();
    tokio::spawn(async move {
        use tauri::Emitter;
        let mut batch: Vec<serde_json::Value> = Vec::new();
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(50));

        loop {
            tokio::select! {
                _ = interval.tick() => {
                    if !batch.is_empty() {
                         let _ = app_for_batcher.emit("core://instance-log", serde_json::json!({ "lines": batch.clone() }));
                         batch.clear();
                    }
                }
                msg = log_rx.recv() => {
                    match msg {
                        Some((iid, line, stream)) => {
                            batch.push(serde_json::json!({ "instance_id": iid, "line": line, "stream": stream }));
                            if batch.len() >= 50 {
                                let _ = app_for_batcher.emit("core://instance-log", serde_json::json!({ "lines": batch.clone() }));
                                batch.clear();
                            }
                        }
                        None => {
                            if !batch.is_empty() {
                                let _ = app_for_batcher.emit("core://instance-log", serde_json::json!({ "lines": batch }));
                            }
                            break;
                        }
                    }
                }
            }
        }
    });

    let log_callback: piston_lib::game::launcher::LogCallback =
        Arc::new(move |iid, line, stream| {
            let _ = log_tx.send((iid, line, stream));
        });

    let join = tokio::task::spawn_blocking(move || {
        futures::executor::block_on(piston_lib::game::launcher::launch_game(
            spec,
            Some(log_callback),
        ))
    })
    .await
    .map_err(|e| format!("Failed to spawn blocking task: {}", e))?;

    match join {
        Ok(result) => {
            log::info!("[launch_instance] Started PID: {}", result.instance.pid);
            if let Err(e) = clear_crash_flag(&instance_id) {
                log::error!("Failed to clear crash flag: {}", e);
            }

            let run_state = crate::utils::process_state::InstanceRunState {
                instance_id: instance_id.clone(),
                pid: result.instance.pid,
                log_file: result.log_file.clone(),
                game_dir: result.instance.game_dir.clone(),
                version_id: result.instance.version_id.clone(),
                modloader: result.instance.modloader.as_ref().map(|m| m.to_string()),
                started_at: result.instance.started_at.to_rfc3339(),
            };

            if let Err(e) = crate::utils::process_state::add_running_process(run_state.clone()) {
                log::warn!("Failed to persist process state: {}", e);
            }

            use tauri::Emitter;
            let _ = app_handle.emit(
                "core://instance-launched",
                serde_json::json!({ "instance_id": instance_id, "name": instance_data.name, "pid": result.instance.pid }),
            );

            // Monitor process
            let app_handle_monitor = app_handle.clone();
            let instance_id_monitor = instance_id.clone();
            let pid_monitor = result.instance.pid;
            let started_at_monitor = result.instance.started_at.to_rfc3339();
            let game_dir_monitor = result.instance.game_dir.clone();

            tokio::spawn(async move {
                use sysinfo::System;
                let mut sys = System::new_all();
                let launch_time = std::time::SystemTime::now();

                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                    sys.refresh_all();
                    if sys.process(sysinfo::Pid::from_u32(pid_monitor)).is_none() {
                        log::info!("Process exited");

                        // Check exit status
                        let exit_status_path =
                            game_dir_monitor.join(".vesta").join("exit_status.json");
                        let (exited_at_ts, exit_code) = if exit_status_path.exists() {
                            // Simplified read logic
                            if let Ok(content) = std::fs::read_to_string(&exit_status_path) {
                                if let Ok(status) =
                                    serde_json::from_str::<serde_json::Value>(&content)
                                {
                                    let ex = status
                                        .get("exited_at")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    let code = status
                                        .get("exit_code")
                                        .and_then(|v| v.as_i64())
                                        .unwrap_or(0)
                                        as i32;
                                    (
                                        if ex.is_empty() {
                                            chrono::Utc::now().to_rfc3339()
                                        } else {
                                            ex
                                        },
                                        code,
                                    )
                                } else {
                                    (chrono::Utc::now().to_rfc3339(), 0)
                                }
                            } else {
                                (chrono::Utc::now().to_rfc3339(), 0)
                            }
                        } else {
                            (chrono::Utc::now().to_rfc3339(), 0)
                        };

                        let mut is_crashed = false;
                        if exit_code != 0 {
                            let log_file = game_dir_monitor.join("logs").join("latest.log");
                            if let Some(crash_info) = crate::utils::crash_parser::detect_crash(
                                &game_dir_monitor,
                                &log_file,
                                launch_time,
                            ) {
                                if let Err(e) =
                                    store_crash_details(&instance_id_monitor, &crash_info)
                                {
                                    log::error!("Failed to store crash: {}", e);
                                }
                                is_crashed = true;
                            }
                        }

                        // Update playtime in database (only if not crashed)
                        if !is_crashed {
                            if let Err(e) = update_instance_playtime(
                                &app_handle_monitor,
                                &instance_id_monitor,
                                &started_at_monitor,
                                &exited_at_ts,
                            ) {
                                log::error!(
                                    "Failed to update playtime for {}: {}",
                                    instance_id_monitor,
                                    e
                                );
                            }
                        }

                        // Remove from running processes
                        if let Err(e) = crate::utils::process_state::remove_running_process(
                            &instance_id_monitor,
                        ) {
                            log::error!("Failed to remove running process: {}", e);
                        }

                        // Notify frontend
                        use tauri::Emitter;
                        // Use app_handle_monitor
                        let _ = app_handle_monitor.emit("core://instance-exited", serde_json::json!({
                             "instance_id": instance_id_monitor, "pid": pid_monitor, "crashed": is_crashed
                        }));
                        break;
                    }
                }
            });

            Ok(())
        }
        Err(e) => Err(format!("Failed to launch game: {}", e)),
    }
}

#[tauri::command]
pub async fn kill_instance(app_handle: tauri::AppHandle, inst: Instance) -> Result<String, String> {
    log::info!("[kill_instance] Kill requested for instance: {}", inst.name);
    let instance_id = inst.slug();

    match piston_lib::game::launcher::kill_instance(&instance_id).await {
        Ok(message) => {
            let _ = crate::utils::process_state::remove_running_process(&instance_id);
            use tauri::Emitter;
            let _ = app_handle.emit(
                "core://instance-killed",
                serde_json::json!({ "instance_id": instance_id, "name": inst.name, "message": message }),
            );
            Ok(message)
        }
        Err(e) => Err(format!("Failed to kill instance: {}", e)),
    }
}

#[tauri::command]
pub async fn get_running_instances() -> Result<Vec<piston_lib::game::launcher::GameInstance>, String>
{
    piston_lib::game::launcher::get_running_instances()
        .await
        .map_err(|e| format!("Failed to get running instances: {}", e))
}

#[tauri::command]
pub async fn is_instance_running(instance_data: Instance) -> Result<bool, String> {
    piston_lib::game::launcher::is_instance_running(&instance_data.slug())
        .await
        .map_err(|e| format!("Failed to check instance status: {}", e))
}

#[tauri::command]
pub async fn get_minecraft_versions(
    app_handle: tauri::AppHandle,
) -> Result<piston_lib::game::metadata::PistonMetadata, String> {
    if let Some(cache) = app_handle.try_state::<crate::metadata_cache::MetadataCache>() {
        if let Some(meta) = cache.get() {
            if let Err(e) = check_and_notify_new_versions(&meta, &app_handle).await {
                log::warn!("Failed to check for new versions: {}", e);
            }
            return Ok(meta);
        }
    }

    let data_dir = crate::utils::db_manager::get_app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;
    let manifest_path = data_dir.join("piston_manifest.json");

    let metadata = if manifest_path.exists() {
        if let Ok(contents) = tokio::fs::read_to_string(&manifest_path).await {
            if let Ok(parsed) =
                serde_json::from_str::<piston_lib::game::metadata::PistonMetadata>(&contents)
            {
                if !parsed.game_versions.is_empty() {
                    parsed
                } else {
                    piston_lib::game::metadata::cache::load_or_fetch_metadata(&data_dir)
                        .await
                        .map_err(|e| e.to_string())?
                }
            } else {
                piston_lib::game::metadata::cache::load_or_fetch_metadata(&data_dir)
                    .await
                    .map_err(|e| e.to_string())?
            }
        } else {
            piston_lib::game::metadata::cache::load_or_fetch_metadata(&data_dir)
                .await
                .map_err(|e| e.to_string())?
        }
    } else {
        piston_lib::game::metadata::cache::load_or_fetch_metadata(&data_dir)
            .await
            .map_err(|e| e.to_string())?
    };

    // Save cache
    let _ = tokio::fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&metadata).unwrap_or_default(),
    )
    .await;

    if let Err(e) = check_and_notify_new_versions(&metadata, &app_handle).await {
        log::warn!("Failed to check for new versions: {}", e);
    }

    if let Some(cache) = app_handle.try_state::<crate::metadata_cache::MetadataCache>() {
        cache.set(&metadata);
    }

    Ok(metadata)
}

#[tauri::command]
pub async fn regenerate_piston_manifest(app_handle: tauri::AppHandle) -> Result<(), String> {
    let task_manager = app_handle.state::<TaskManager>();
    task_manager
        .submit(Box::new(GenerateManifestTask::new_force_refresh()))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Update the operation type for an instance
pub fn update_instance_operation(
    app_handle: &tauri::AppHandle,
    instance_id: i32,
    operation: &str,
) -> Result<(), String> {
    log::info!(
        "Updating last operation for instance {} to: {}",
        instance_id,
        operation
    );
    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    diesel::update(instance.find(instance_id))
        .set(last_operation.eq(operation))
        .execute(&mut conn)
        .map_err(|e| format!("Failed to update last operation: {}", e))?;

    // Fetch the updated instance to emit it
    let updated: crate::models::instance::Instance = instance
        .find(instance_id)
        .first(&mut conn)
        .map_err(|e| format!("Failed to fetch updated instance: {}", e))?;

    use tauri::Emitter;
    let _ = app_handle.emit("core://instance-updated", updated);

    Ok(())
}

/// Update the installation status for an instance
pub fn update_installation_status(
    app_handle: &tauri::AppHandle,
    instance_id: i32,
    status: &str,
) -> Result<(), String> {
    log::info!(
        "Updating installation status for instance {} to: {}",
        instance_id,
        status
    );
    let mut conn =
        get_vesta_conn().map_err(|e| format!("Failed to get database connection: {}", e))?;

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    diesel::update(instance.find(instance_id))
        .set((installation_status.eq(status), updated_at.eq(now)))
        .execute(&mut conn)
        .map_err(|e| format!("Failed to update installation status: {}", e))?;

    // Fetch the updated instance to emit it
    let updated: crate::models::instance::Instance = instance
        .find(instance_id)
        .first(&mut conn)
        .map_err(|e| format!("Failed to fetch updated instance: {}", e))?;

    use tauri::Emitter;
    let _ = app_handle.emit("core://instance-updated", updated);

    Ok(())
}

#[tauri::command]
pub fn read_instance_log(
    instance_id_slug: String,
    last_lines: Option<usize>,
) -> Result<Vec<String>, String> {
    let data_dir = crate::utils::db_manager::get_app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;
    let log_file = data_dir
        .join("data")
        .join("logs")
        .join(format!("{}.log", instance_id_slug));

    if !log_file.exists() {
        return Ok(vec![]);
    }

    let file =
        std::fs::File::open(&log_file).map_err(|e| format!("Failed to open log file: {}", e))?;
    let reader = std::io::BufReader::new(file);
    use std::io::BufRead;

    let lines: Vec<String> = reader.lines().filter_map(Result::ok).collect();
    if let Some(n) = last_lines {
        if lines.len() > n {
            return Ok(lines[lines.len() - n..].to_vec());
        }
    }
    Ok(lines)
}

/// Check for new Minecraft versions and create notifications if found
async fn check_and_notify_new_versions(
    metadata: &piston_lib::game::metadata::PistonMetadata,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    use crate::utils::version_tracking::VersionTrackingRepository;

    // Initialize version tracking if this is the first run
    if let Err(e) = VersionTrackingRepository::initialize_defaults() {
        log::warn!("Failed to initialize version tracking defaults: {}", e);
    }

    // Check release version
    let current_release = &metadata.latest.release;
    if VersionTrackingRepository::is_version_newer("minecraft_release", current_release)
        .map_err(|e| format!("Failed to check release version: {}", e))?
    {
        log::info!("New Minecraft release detected: {}", current_release);
        create_version_notification(
            app_handle,
            "New Minecraft Release Available",
            &format!(
                "Minecraft {} is now available for download!",
                current_release
            ),
            "minecraft_release",
            current_release,
        )
        .await?;
    }

    // Check snapshot version
    let current_snapshot = &metadata.latest.snapshot;
    if VersionTrackingRepository::is_version_newer("minecraft_snapshot", current_snapshot)
        .map_err(|e| format!("Failed to check snapshot version: {}", e))?
    {
        log::info!("New Minecraft snapshot detected: {}", current_snapshot);
        create_version_notification(
            app_handle,
            "New Minecraft Snapshot Available",
            &format!(
                "Minecraft snapshot {} is now available for testing!",
                current_snapshot
            ),
            "minecraft_snapshot",
            current_snapshot,
        )
        .await?;
    }

    Ok(())
}

/// Create a notification for a new version
async fn create_version_notification(
    app_handle: &tauri::AppHandle,
    title: &str,
    description: &str,
    version_type: &str,
    version: &str,
) -> Result<(), String> {
    use crate::notifications::models::{CreateNotificationInput, NotificationType};
    use crate::utils::version_tracking::VersionTrackingRepository;

    let notification_manager =
        app_handle.state::<crate::notifications::manager::NotificationManager>();

    let input = CreateNotificationInput {
        client_key: Some(format!("version_update_{}", version_type)),
        title: Some(title.to_string()),
        description: Some(description.to_string()),
        severity: Some("info".to_string()),
        notification_type: Some(NotificationType::Patient),
        dismissible: Some(true),
        progress: None,
        current_step: None,
        total_steps: None,
        actions: None,
        metadata: Some(
            serde_json::json!({
                "version_type": version_type,
                "version": version,
                "notification_type": "version_update"
            })
            .to_string(),
        ),
        show_on_completion: None,
    };

    // Create notification through the manager
    notification_manager
        .create(input)
        .map_err(|e| format!("Failed to create notification: {}", e))?;

    // Update version tracking to mark as notified
    VersionTrackingRepository::mark_notified(version_type, version)
        .map_err(|e| format!("Failed to update version tracking: {}", e))?;

    log::info!(
        "Created version update notification for {}: {}",
        version_type,
        version
    );
    Ok(())
}

#[tauri::command]
pub async fn duplicate_instance(
    _app_handle: tauri::AppHandle,
    task_manager: tauri::State<'_, TaskManager>,
    instance_id: i32,
    new_name: Option<String>,
) -> Result<(), String> {
    let task = CloneInstanceTask::new(instance_id, new_name);
    let _ = task_manager.submit(Box::new(task)).await;
    Ok(())
}

#[tauri::command]
pub async fn repair_instance(
    app_handle: tauri::AppHandle,
    task_manager: tauri::State<'_, TaskManager>,
    instance_id: i32,
) -> Result<(), String> {
    // Set status to 'installing' so UI shows progress
    let _ = crate::commands::instances::update_instance_operation(
        &app_handle,
        instance_id,
        "repair",
    );
    let _ = crate::commands::instances::update_installation_status(
        &app_handle,
        instance_id,
        "installing",
    );

    let task = RepairInstanceTask::new(instance_id);
    let _ = task_manager.submit(Box::new(task)).await;
    Ok(())
}

#[tauri::command]
pub async fn reset_instance(
    app_handle: tauri::AppHandle,
    task_manager: tauri::State<'_, TaskManager>,
    instance_id: i32,
) -> Result<(), String> {
    // Set status to 'installing' so UI shows progress
    let _ = crate::commands::instances::update_instance_operation(
        &app_handle,
        instance_id,
        "hard-reset",
    );
    let _ = crate::commands::instances::update_installation_status(
        &app_handle,
        instance_id,
        "installing",
    );

    let task = ResetInstanceTask::new(instance_id);
    let _ = task_manager.submit(Box::new(task)).await;
    Ok(())
}

#[tauri::command]
pub async fn resume_instance_operation(
    app_handle: tauri::AppHandle,
    task_manager: State<'_, TaskManager>,
    instance_id: i32,
) -> Result<(), String> {
    log::info!("[resume_instance_operation] Resuming operation for instance ID: {}", instance_id);
    
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let inst: Instance = instance
        .find(instance_id)
        .first(&mut conn)
        .map_err(|e| format!("Instance not found: {}", e))?;

    let op = inst.last_operation.as_deref().unwrap_or("install");
    log::info!("[resume_instance_operation] Detected last operation: {}", op);

    match op {
        "repair" => repair_instance(app_handle, task_manager, instance_id).await,
        "hard-reset" => reset_instance(app_handle, task_manager, instance_id).await,
        "install" | _ => install_instance(app_handle, task_manager, inst, None).await,
    }
}

#[tauri::command]
pub async fn update_instance_modpack_version(
    app_handle: tauri::AppHandle,
    instance_id: i32,
    version_id: String,
) -> Result<(), String> {
    use crate::schema::instance::dsl::*;
    use tauri::Emitter;
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;

    diesel::update(instance.filter(id.eq(instance_id)))
        .set(modpack_version_id.eq(Some(version_id)))
        .execute(&mut conn)
        .map_err(|e| e.to_string())?;

    // Fetch updated instance to notify UI
    let updated: Instance = instance.find(instance_id).first(&mut conn).map_err(|e| e.to_string())?;
    let _ = app_handle.emit("core://instance-updated", updated);

    Ok(())
}

