use crate::models::instance::Instance;
use crate::tasks::installers::InstallInstanceTask;
use crate::tasks::manager::TaskManager;
use crate::tasks::manifest::GenerateManifestTask;
use crate::utils::db_manager::get_data_db;
use crate::utils::sqlite::{SqlTable, AUTOINCREMENT};
use std::sync::Arc;
use tauri::{Manager, State};

/// Compute canonical instance game directory path under the given instances root
fn compute_instance_game_dir(root: &std::path::Path, slug: &str) -> String {
    root.join(slug).to_string_lossy().to_string()
}

/// Update playtime for an instance in the database (internal helper)
fn update_instance_playtime_internal(instance_id: &str, started_at: &str, exited_at: &str) -> Result<(), String> {
    // Parse timestamps
    let started = chrono::DateTime::parse_from_rfc3339(started_at)
        .map_err(|e| format!("Failed to parse started_at: {}", e))?;
    let exited = chrono::DateTime::parse_from_rfc3339(exited_at)
        .map_err(|e| format!("Failed to parse exited_at: {}", e))?;
    
    // Calculate duration in minutes
    let duration = exited.signed_duration_since(started);
    let minutes = (duration.num_seconds() / 60).max(0) as i32;
    
    log::info!(
        "Updating playtime for instance {}: {} minutes (from {} to {})",
        instance_id, minutes, started_at, exited_at
    );
    
    // Update database - need to find instance by slug
    let db = get_data_db().map_err(|e| format!("Failed to get database: {}", e))?;
    let conn = db.get_connection();
    
    // Get all instances and find by slug
    let mut stmt = conn
        .prepare("SELECT id, name, total_playtime_minutes FROM instance")
        .map_err(|e| format!("Failed to prepare statement: {}", e))?;
    
    let instances: Vec<(i32, String, i32)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| format!("Failed to query instances: {}", e))?
        .filter_map(Result::ok)
        .collect();
    
    for (id, name, current_playtime) in instances {
        let slug = crate::utils::sanitize::sanitize_instance_name(&name);
        if slug == instance_id {
            let new_playtime = current_playtime + minutes;
            let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
            
            conn.execute(
                "UPDATE instance SET total_playtime_minutes = ?1, last_played = ?2, updated_at = ?3 WHERE id = ?4",
                rusqlite::params![new_playtime, now, now, id],
            )
            .map_err(|e| format!("Failed to update playtime: {}", e))?;
            
            log::info!(
                "Updated playtime for instance {} (id {}): {} -> {} minutes",
                instance_id, id, current_playtime, new_playtime
            );
            return Ok(());
        }
    }
    
    log::warn!("Instance {} not found in database for playtime update", instance_id);
    Ok(())
}

#[tauri::command]
pub async fn install_instance(
    app_handle: tauri::AppHandle,
    task_manager: State<'_, TaskManager>,
    instance: Instance,
) -> Result<(), String> {
    log::info!(
        "[install_instance] Command invoked for instance: {}",
        instance.name
    );
    log::info!("[install_instance] Instance details - version: {}, modloader: {:?}, modloader_version: {:?}", 
        instance.minecraft_version, instance.modloader, instance.modloader_version);

    log::info!("[install_instance] Creating InstallInstanceTask");
    let task = InstallInstanceTask::new(instance.clone());

    log::info!("[install_instance] Submitting task to TaskManager");
    match task_manager.submit(Box::new(task)).await {
        Ok(_) => {
            // Immediately update DB to 'installing' so UI shows progress without waiting
            if let AUTOINCREMENT::VALUE(id) = instance.id.clone() {
                let _ = crate::commands::instances::update_installation_status(id, "installing");
            }
            // Emit an early update so UI homescreen refreshes as soon as installation starts
            use tauri::Emitter;
            let _ = app_handle.emit(
                "core://instance-updated",
                serde_json::json!({ "name": instance.name, "instance_id": instance.slug() }),
            );

            log::info!(
                "[install_instance] Task submitted successfully for: {}",
                instance.name
            );
            Ok(())
        }
        Err(e) => {
            log::error!("[install_instance] Failed to submit task: {}", e);
            Err(e)
        }
    }
}

#[tauri::command]
pub fn list_instances() -> Result<Vec<Instance>, String> {
    log::info!("Fetching all instances from database");

    let db = get_data_db().map_err(|e| format!("Failed to get database: {}", e))?;
    let conn = db.get_connection();

    let mut stmt = conn
        .prepare(&format!(
            "SELECT id, name, minecraft_version, modloader, modloader_version, 
                    java_path, java_args, game_directory, width, height, memory_mb, 
                    icon_path, last_played, total_playtime_minutes, created_at, updated_at, 
                    installation_status 
             FROM {} ORDER BY last_played DESC, created_at DESC",
            Instance::name()
        ))
        .map_err(|e| format!("Failed to prepare statement: {}", e))?;

    let instances = stmt
        .query_map([], |row| {
            Ok(Instance {
                id: AUTOINCREMENT::VALUE(row.get(0)?),
                name: row.get(1)?,
                minecraft_version: row.get(2)?,
                modloader: row.get(3)?,
                modloader_version: row.get(4)?,
                java_path: row.get(5)?,
                java_args: row.get(6)?,
                game_directory: row.get(7)?,
                width: row.get(8)?,
                height: row.get(9)?,
                memory_mb: row.get(10)?,
                icon_path: row.get(11)?,
                last_played: row.get(12)?,
                total_playtime_minutes: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
                installation_status: row.get(16)?,
            })
        })
        .map_err(|e| format!("Failed to query instances: {}", e))?
        .collect::<Result<Vec<Instance>, _>>()
        .map_err(|e| format!("Failed to collect instances: {}", e))?;

    log::info!("Retrieved {} instances", instances.len());
    Ok(instances)
}

#[tauri::command]
pub fn create_instance(instance: Instance) -> Result<i32, String> {
    log::info!(
        "[create_instance] Command invoked for instance: {}",
        instance.name
    );
    log::info!("[create_instance] Instance details - version: {}, modloader: {:?}, modloader_version: {:?}", 
        instance.minecraft_version, instance.modloader, instance.modloader_version);

    log::info!("[create_instance] Getting database connection");
    let db = get_data_db().map_err(|e| {
        log::error!("[create_instance] Failed to get database: {}", e);
        format!("Failed to get database: {}", e)
    })?;

    log::info!("[create_instance] Determining unique slug and game directory");

    // Make a mutable copy so we can set defaults (game_directory) before inserting
    let mut instance = instance;

    // Determine config data dir (use nested data folder when available)
    let app_config_dir = crate::utils::db_manager::get_app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;
    // Use app config root for instance folders: %APPDATA%/.VestaLauncher/instances
    let data_dir = app_config_dir.clone();

    // Compute a filesystem-safe slug and ensure uniqueness against existing instances
    let mut slug = instance.slug();

    // Fetch existing instance names and compute their slugs
    let conn = db.get_connection();
    let mut stmt = conn
        .prepare(&format!("SELECT name FROM {}", Instance::name()))
        .map_err(|e| format!("Failed to prepare statement: {}", e))?;

    let names_iter = stmt
        .query_map([], |row| Ok::<String, _>(row.get(0)?))
        .map_err(|e| format!("Failed to query existing instance names: {}", e))?;

    let mut seen_names = std::collections::HashSet::new();
    let mut seen_slugs = std::collections::HashSet::new();
    for r in names_iter {
        if let Ok(existing_name) = r {
            seen_names.insert(existing_name.to_lowercase());
            seen_slugs.insert(crate::utils::sanitize::sanitize_instance_name(
                &existing_name,
            ));
        }
    }

    // Check for duplicate name (case-insensitive) and make it unique
    instance.name = crate::utils::instance_helpers::compute_unique_name(
        &instance.name,
        &seen_names,
    );

    // Recompute slug based on the potentially modified name
    slug = instance.slug();

    // Also ensure that the on-disk path doesn't already exist
    let instances_root = data_dir.join("instances");

    // Use shared helper to compute unique slug (in case the name change wasn't enough)
    slug = crate::utils::instance_helpers::compute_unique_slug(
        &instance.name,
        &seen_slugs,
        &instances_root,
    );

    // Always set the instance game_directory to the configured instances root
    // using the computed instance id (slug). This ensures instances are stored
    // under %APPDATA%/.VestaLauncher/instances/<instance_id> and prevents two
    // instances that share other properties (like version) from mixing their
    // data directories.
    let gd = compute_instance_game_dir(&instances_root, &slug);
    if instance.game_directory.is_some() {
        log::info!(
            "[create_instance] Overriding supplied game_directory with instances root path: {}",
            gd
        );
    }
    instance.game_directory = Some(gd);

    log::info!("[create_instance] Inserting instance into database");

    // Get connection
    let conn = db.get_connection();

    // Log the actual schema of the instance table
    let mut stmt = conn.prepare("PRAGMA table_info(instance)").map_err(|e| {
        log::error!("[create_instance] Failed to get table info: {}", e);
        format!("Failed to get table info: {}", e)
    })?;
    let columns: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Failed to query table info: {}", e))?
        .filter_map(Result::ok)
        .collect();
    log::info!("[create_instance] Instance table columns: {:?}", columns);

    // Insert the instance using explicit column list
    let result = conn.execute(
        "INSERT INTO instance (name, minecraft_version, modloader, modloader_version, java_path, java_args, game_directory, width, height, memory_mb, icon_path, last_played, total_playtime_minutes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, datetime('now'), datetime('now'))",
        rusqlite::params![
            instance.name,
            instance.minecraft_version,
            instance.modloader,
            instance.modloader_version,
            instance.java_path,
            instance.java_args,
            instance.game_directory,
            instance.width,
            instance.height,
            instance.memory_mb,
            instance.icon_path,
            instance.last_played,
            instance.total_playtime_minutes,
        ],
    );

    match result {
        Ok(_) => log::info!("[create_instance] Instance inserted successfully"),
        Err(e) => {
            log::error!("[create_instance] Failed to insert instance: {}", e);
            log::error!(
                "[create_instance] Instance data: name={}, version={}, modloader={:?}",
                instance.name,
                instance.minecraft_version,
                instance.modloader
            );
            return Err(format!("Failed to insert instance: {}", e));
        }
    }

    // Get the last inserted row ID (we still persist in DB but return slug)
    let conn = db.get_connection();
    let id = conn.last_insert_rowid() as i32;

    // Set initial installation_status to "pending"
    let _ = crate::commands::instances::update_installation_status(id, "pending");

    log::info!(
        "[create_instance] Instance created successfully with ID: {} and slug: {}",
        id,
        slug
    );

    Ok(id)
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
pub fn update_instance(instance: Instance) -> Result<(), String> {
    log::info!("[update_instance] Updating instance: {:?}", instance.id);

    let db = get_data_db().map_err(|e| format!("Failed to get database: {}", e))?;
    let conn = db.get_connection();

    // Extract the ID
    let id = match instance.id {
        AUTOINCREMENT::VALUE(id) => id,
        AUTOINCREMENT::INIT => {
            return Err("Cannot update instance with uninitialized ID".to_string())
        }
    };

    // Fetch the existing row so we can detect name changes and old game_directory
    let existing_row = conn
        .query_row(
            &format!(
                "SELECT name, game_directory FROM {} WHERE id = ?1",
                Instance::name()
            ),
            rusqlite::params![id],
            |row| {
                Ok((
                    row.get::<usize, String>(0)?,
                    row.get::<usize, Option<String>>(1)?,
                ))
            },
        )
        .map_err(|e| format!("Failed to query existing instance: {}", e))?;

    let old_name = existing_row.0;
    let old_game_dir = existing_row.1;

    let old_slug = crate::utils::sanitize::sanitize_instance_name(&old_name);
    let mut new_slug = instance.slug();

    // If slug changes, compute unique slug against other instances and filesystem
    if old_slug != new_slug {
        let app_config_dir = crate::utils::db_manager::get_app_config_dir()
            .map_err(|e| format!("Failed to get app config dir: {}", e))?;
        let instances_root = app_config_dir.join("instances");

        // Build set of seen slugs excluding current row
        let mut stmt = conn
            .prepare(&format!("SELECT id, name FROM {}", Instance::name()))
            .map_err(|e| format!("Failed to prepare statement: {}", e))?;

        let rows = stmt
            .query_map([], |row| Ok::<(i32, String), _>((row.get(0)?, row.get(1)?)))
            .map_err(|e| format!("Failed to query existing instances: {}", e))?;

        let mut seen = std::collections::HashSet::new();
        for r in rows {
            if let Ok((rid, rname)) = r {
                if rid != id {
                    seen.insert(crate::utils::sanitize::sanitize_instance_name(&rname));
                }
            }
        }

        // stmt holds non-Send references to the DB connection; drop it so
        // it doesn't remain alive across later await points (we must not hold non-Send
        // types while awaiting async registry ops)
        drop(stmt);

        // Avoid filesystem collisions using shared helper
        new_slug = crate::utils::instance_helpers::compute_unique_slug(
            &instance.name,
            &seen,
            &instances_root,
        );

        // Attempt to rename the instance directory if it exists
        let old_dir = instances_root.join(&old_slug);
        let new_dir = instances_root.join(&new_slug);

        if old_dir.exists() {
            if let Err(e) = std::fs::rename(&old_dir, &new_dir) {
                // If rename fails, try to create the new directory and continue
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
        // path based on the updated slug. We always enforce the app's instance
        // folder layout so instances remain isolated and predictable.
        let new_game_dir = compute_instance_game_dir(&instances_root, &new_slug);
        let updated_game_dir = Some(new_game_dir.clone());

        // Move log file if exists (done here so we do file ops before any await)
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
                log::warn!(
                    "[update_instance] Failed to move log file: {} -> {} : {}",
                    old_log.display(),
                    new_log.display(),
                    e
                );
            }
        }

        // Register updated GameInstance will happen after DB update (so no non-Send DB types live across await)

        // Overwrite instance.game_directory with updated value
        let mut instance = instance;
        instance.game_directory = updated_game_dir;
        // write this modified instance back into DB in the update below

        // Set instance name to stay as provided (we will still update DB)
        // Use new_slug from here

        // Proceed to update DB with new game_directory (we'll commit once below)

        // Commit DB update before doing registry (no DB handles will remain across awaits)
        conn.execute(
            &format!(
                "UPDATE {} SET name = ?1, minecraft_version = ?2, modloader = ?3, 
                        modloader_version = ?4, java_path = ?5, java_args = ?6, 
                        game_directory = ?7, width = ?8, height = ?9, memory_mb = ?10, 
                        icon_path = ?11, last_played = ?12, total_playtime_minutes = ?13, 
                        updated_at = datetime('now') 
                 WHERE id = ?14",
                Instance::name()
            ),
            rusqlite::params![
                instance.name,
                instance.minecraft_version,
                instance.modloader,
                instance.modloader_version,
                instance.java_path,
                instance.java_args,
                instance.game_directory,
                instance.width,
                instance.height,
                instance.memory_mb,
                instance.icon_path,
                instance.last_played,
                instance.total_playtime_minutes,
                id,
            ],
        )
        .map_err(|e| format!("Failed to update instance after rename: {}", e))?;

        log::info!(
            "[update_instance] Renamed/updated instance id from {} -> {}",
            old_slug,
            new_slug
        );

        // Now that DB work is done (no non-Send types are live), update the running registry if needed
        // Spawn an async task to update the registry so we don't hold non-Send DB objects across awaits
        let old = old_slug.clone();
        let new = new_slug.clone();
        let logpath = new_log.clone();
        let dirpath = instance.game_directory.clone().unwrap_or_default();

        tauri::async_runtime::spawn(async move {
            if let Ok(Some(running)) = piston_lib::game::launcher::get_instance(&old).await {
                log::info!("[update_instance] Instance currently running; updating registry id from {} to {}", old, new);
                if let Err(e) = piston_lib::game::launcher::unregister_instance(&old).await {
                    log::warn!(
                        "[update_instance] Failed to unregister old running instance {}: {}",
                        old,
                        e
                    );
                }

                // Register updated GameInstance
                let mut updated = running.clone();
                updated.instance_id = new.clone();
                updated.game_dir = std::path::PathBuf::from(dirpath);
                updated.log_file = logpath;

                if let Err(e) = piston_lib::game::launcher::register_instance(updated).await {
                    log::warn!(
                        "[update_instance] Failed to register new running instance {}: {}",
                        new,
                        e
                    );
                }
            }
        });

        Ok(())
    } else {
        // Slug did not change; perform a normal update
        conn.execute(
            &format!(
                "UPDATE {} SET name = ?1, minecraft_version = ?2, modloader = ?3, 
                    modloader_version = ?4, java_path = ?5, java_args = ?6, 
                    game_directory = ?7, width = ?8, height = ?9, memory_mb = ?10, 
                    icon_path = ?11, last_played = ?12, total_playtime_minutes = ?13, 
                    updated_at = datetime('now') 
             WHERE id = ?14",
                Instance::name()
            ),
            rusqlite::params![
                instance.name,
                instance.minecraft_version,
                instance.modloader,
                instance.modloader_version,
                instance.java_path,
                instance.java_args,
                instance.game_directory,
                instance.width,
                instance.height,
                instance.memory_mb,
                instance.icon_path,
                instance.last_played,
                instance.total_playtime_minutes,
                id,
            ],
        )
        .map_err(|e| format!("Failed to update instance: {}", e))?;

        log::info!("Updated instance ID: {}", id);
        Ok(())
    }
}

#[tauri::command]
pub fn delete_instance(app_handle: tauri::AppHandle, id: i32) -> Result<(), String> {
    log::info!("Deleting instance ID: {}", id);

    let db = get_data_db().map_err(|e| format!("Failed to get database: {}", e))?;
    let conn = db.get_connection();

    conn.execute(
        &format!("DELETE FROM {} WHERE id = ?1", Instance::name()),
        rusqlite::params![id],
    )
    .map_err(|e| format!("Failed to delete instance: {}", e))?;

    log::info!("Deleted instance ID: {}", id);

    // Notify frontend so UI can refresh lists and react to deletion
    use tauri::Emitter;
    let _ = app_handle.emit(
        "core://instance-updated",
        serde_json::json!({ "instance_id": id }),
    );
    Ok(())
}

#[tauri::command]
pub fn get_instance(id: i32) -> Result<Instance, String> {
    log::info!("Fetching instance ID: {}", id);

    let db = get_data_db().map_err(|e| format!("Failed to get database: {}", e))?;
    let conn = db.get_connection();

    let instance = conn
        .query_row(
            &format!(
                "SELECT id, name, minecraft_version, modloader, modloader_version, 
                        java_path, java_args, game_directory, width, height, memory_mb, 
                        icon_path, last_played, total_playtime_minutes, created_at, updated_at, 
                        installation_status 
                 FROM {} WHERE id = ?1",
                Instance::name()
            ),
            rusqlite::params![id],
            |row| {
                Ok(Instance {
                    id: AUTOINCREMENT::VALUE(row.get(0)?),
                    name: row.get(1)?,
                    minecraft_version: row.get(2)?,
                    modloader: row.get(3)?,
                    modloader_version: row.get(4)?,
                    java_path: row.get(5)?,
                    java_args: row.get(6)?,
                    game_directory: row.get(7)?,
                    width: row.get(8)?,
                    height: row.get(9)?,
                    memory_mb: row.get(10)?,
                    icon_path: row.get(11)?,
                    last_played: row.get(12)?,
                    total_playtime_minutes: row.get(13)?,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                    installation_status: row.get(16)?,
                })
            },
        )
        .map_err(|e| format!("Failed to fetch instance: {}", e))?;

    log::info!("Retrieved instance: {}", instance.name);
    Ok(instance)
}

#[tauri::command]
pub fn get_instance_by_slug(slug: String) -> Result<Instance, String> {
    log::info!("Fetching instance by slug: {}", slug);

    let db = get_data_db().map_err(|e| format!("Failed to get database: {}", e))?;
    let conn = db.get_connection();

    // Fetch all instances and find the one with matching slug
    let mut stmt = conn
        .prepare(&format!(
            "SELECT id, name, minecraft_version, modloader, modloader_version, 
                    java_path, java_args, game_directory, width, height, memory_mb, 
                    icon_path, last_played, total_playtime_minutes, created_at, updated_at, 
                    installation_status 
             FROM {}",
            Instance::name()
        ))
        .map_err(|e| format!("Failed to prepare statement: {}", e))?;

    let instances = stmt
        .query_map([], |row| {
            Ok(Instance {
                id: AUTOINCREMENT::VALUE(row.get(0)?),
                name: row.get(1)?,
                minecraft_version: row.get(2)?,
                modloader: row.get(3)?,
                modloader_version: row.get(4)?,
                java_path: row.get(5)?,
                java_args: row.get(6)?,
                game_directory: row.get(7)?,
                width: row.get(8)?,
                height: row.get(9)?,
                memory_mb: row.get(10)?,
                icon_path: row.get(11)?,
                last_played: row.get(12)?,
                total_playtime_minutes: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
                installation_status: row.get(16)?,
            })
        })
        .map_err(|e| format!("Failed to query instances: {}", e))?;

    for inst_result in instances {
        if let Ok(inst) = inst_result {
            if inst.slug() == slug {
                log::info!("Found instance by slug {}: {}", slug, inst.name);
                return Ok(inst);
            }
        }
    }

    Err(format!("Instance with slug '{}' not found", slug))
}

#[tauri::command]
pub async fn launch_instance(
    app_handle: tauri::AppHandle,
    instance: Instance,
) -> Result<(), String> {
    log::info!(
        "[launch_instance] Launch requested for instance: {}",
        instance.name
    );

    // Derive a filesystem-safe runtime instance id (slug) from the instance name
    let instance_id = instance.slug();

    // Get app config directory
    let data_dir = crate::utils::db_manager::get_app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;

    // Determine Java path
    let java_path = instance.java_path.clone().unwrap_or_else(|| {
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

    // Determine which data_dir to use for launch artifacts. Historically the installer
    // used <config>/data as the root for 'versions', 'libraries', 'assets' etc while
    // some code paths used the config root directly. Prefer <config>/data if it exists.
    let spec_data_dir = if data_dir.join("data").exists() {
        let p = data_dir.join("data");
        log::debug!("Using nested data directory for launch spec: {:?}", p);
        p
    } else {
        log::debug!(
            "Using root config directory for launch spec: {:?}",
            data_dir
        );
        data_dir.clone()
    };

    // Derive game directory from the app config root instances folder e.g., %APPDATA%/.VestaLauncher/instances/<slug>
    let instances_root = data_dir.join("instances");
    let game_dir = instance.game_directory.clone().unwrap_or_else(|| {
        instances_root
            .join(&instance_id)
            .to_string_lossy()
            .to_string()
    });

    // Parse modloader type
    let modloader = instance
        .modloader
        .as_ref()
        .and_then(|m| m.parse::<piston_lib::game::ModloaderType>().ok());

    // Attempt to read the current active account from the DB. If present
    // ensure tokens are valid (refresh them if needed) and use the account's username/uuid/access_token; otherwise fall back to
    // safe defaults so launch still proceeds.
    let mut active_account = match crate::auth::get_active_account() {
        Ok(Some(acc)) => Some(acc),
        Ok(None) => None,
        Err(e) => {
            // Non-fatal: log and continue with defaults
            log::warn!("[launch_instance] Failed to read active account: {}", e);
            None
        }
    };

    // If we have an active account, ensure token validity which may refresh tokens
    if let Some(acc) = active_account.clone() {
        if let Err(e) = crate::auth::ensure_account_tokens_valid(acc.uuid.clone()).await {
            log::error!(
                "[launch_instance] Failed to ensure account tokens valid for {}: {}",
                acc.uuid,
                e
            );
            return Err(format!("Failed to refresh authentication: {}", e));
        }

        // Re-fetch the active account after potential refresh
        active_account = match crate::auth::get_active_account() {
            Ok(Some(acc)) => Some(acc),
            Ok(None) => None,
            Err(e) => {
                log::warn!(
                    "[launch_instance] Failed to read active account after refresh: {}",
                    e
                );
                None
            }
        };
    }

    // Build launch spec
    // Resolve exit handler JAR from bundled resources (if available)
    // In production: resources are bundled alongside the binary
    // In dev mode: use the source path directly
    let exit_handler_jar = app_handle
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("exit-handler.jar"))
        .filter(|p| p.exists())
        .or_else(|| {
            // Dev mode fallback: check the source directory
            let dev_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent() // src-tauri -> vesta-launcher
                .map(|p| p.join("resources").join("exit-handler").join("exit-handler.jar"))
                .filter(|p| p.exists());
            if dev_path.is_some() {
                log::info!("[launch_instance] Using dev mode exit handler JAR path");
            }
            dev_path
        });
    
    if exit_handler_jar.is_some() {
        log::info!("[launch_instance] Using exit handler JAR: {:?}", exit_handler_jar);
    } else {
        log::warn!("[launch_instance] Exit handler JAR not found in resources, playtime tracking will be limited");
    }

    // Determine log file path
    let log_file = spec_data_dir.join("logs").join(format!("{}.log", instance_id));
    
    let spec = piston_lib::game::launcher::LaunchSpec {
        instance_id: instance_id.clone(),
        version_id: instance.minecraft_version.clone(),
        modloader,
        modloader_version: instance.modloader_version.clone(),
        data_dir: spec_data_dir.clone(),
        game_dir: std::path::PathBuf::from(&game_dir),
        java_path: std::path::PathBuf::from(&java_path),
        username: active_account
            .as_ref()
            .and_then(|a| Some(a.username.clone()))
            .unwrap_or_else(|| "Player".to_string()),
        uuid: active_account
            .as_ref()
            .and_then(|a| Some(a.uuid.clone()))
            .unwrap_or_else(|| "00000000-0000-0000-0000-000000000000".to_string()),
        access_token: active_account
            .as_ref()
            .and_then(|a| a.access_token.clone())
            .unwrap_or_else(|| "0".to_string()),
        client_id: piston_lib::auth::CLIENT_ID.to_string(),
        user_type: "msa".to_string(),
        jvm_args: instance
            .java_args
            .map(|args| args.split_whitespace().map(|s| s.to_string()).collect())
            .unwrap_or_default(),
        game_args: vec![],
        window_width: Some(instance.width as u32),
        window_height: Some(instance.height as u32),
        exit_handler_jar,
        log_file: Some(log_file),
    };

    // Launch the game
    log::info!(
        "[launch_instance] Launching game with spec: instance_id={}, version={}",
        spec.instance_id,
        spec.version_id
    );

    // Emit an explicit start log before the blocking hand-off so tauri logs
    // clearly show the intent to start a launch operation.
    log::info!(
        "[launch_instance] Starting blocking launch task for instance: {}",
        spec.instance_id
    );

    // Pre-check: ensure the version manifest exists. If it doesn't, return a clear error so the
    // frontend can prompt the user to install the version instead of attempting to launch.
    // Prefer loader-installed manifest if present, otherwise fall back to
    // vanilla manifest. This supports installed ids like
    // "fabric-loader-0.38.2-1.20.1" living in their own folder.
    let installed_id = spec.installed_version_id();
    let installed_manifest = spec
        .versions_dir()
        .join(&installed_id)
        .join(format!("{}.json", installed_id));

    let vanilla_manifest = spec
        .versions_dir()
        .join(&spec.version_id)
        .join(format!("{}.json", spec.version_id));

    let manifest_path = if installed_manifest.exists() {
        installed_manifest
    } else {
        vanilla_manifest
    };

    if !manifest_path.exists() {
        // Provide more diagnostics: report the directory contents so we can see what actually exists.
        let version_dir = spec.versions_dir().join(&spec.version_id);
        let mut listing = vec![];
        match std::fs::read_dir(&version_dir) {
            Ok(rd) => {
                for entry in rd.flatten() {
                    if let Ok(fname) = entry.file_name().into_string() {
                        listing.push(fname);
                    }
                }
            }
            Err(e) => {
                listing.push(format!("<read_dir_error: {}>", e));
            }
        }

        let listing_str = listing.join(", ");
        log::error!(
            "[launch_instance] Version manifest missing for {}: {:?} — dir {:?} contents: {}",
            spec.version_id,
            manifest_path,
            version_dir,
            listing_str
        );

        // As a final attempt, include std::fs::metadata error (if any) for the file itself
        match std::fs::metadata(&manifest_path) {
            Ok(meta) => {
                if meta.is_file() {
                    log::warn!(
                        "[launch_instance] Manifest metadata says file exists but Path::exists() was false: {:?} (len={})",
                        manifest_path,
                        meta.len()
                    );
                } else {
                    log::warn!(
                        "[launch_instance] Manifest path exists but is not a file: {:?}",
                        manifest_path
                    );
                }
            }
            Err(e) => {
                log::error!(
                    "[launch_instance] Could not read metadata for manifest path {:?}: {}",
                    manifest_path,
                    e
                );
            }
        }

        return Err(format!(
            "Version {} is not installed (missing manifest: {:?})",
            spec.version_id, manifest_path
        ));
    }

    // Create a log callback that batches and emits events to the frontend
    // We use a channel-based approach to batch log lines and emit them periodically
    
    // Create a channel for log lines - we'll batch them and emit periodically
    let (log_tx, mut log_rx) = tokio::sync::mpsc::unbounded_channel::<(String, String, String)>();
    
    // Spawn a task to batch and emit log events every 50ms
    let app_for_batcher = app_handle.clone();
    tokio::spawn(async move {
        use tauri::Emitter;
        let mut batch: Vec<serde_json::Value> = Vec::new();
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(50));
        
        loop {
            tokio::select! {
                _ = interval.tick() => {
                    // Emit batched lines if any
                    if !batch.is_empty() {
                        let _ = app_for_batcher.emit("core://instance-log", serde_json::json!({
                            "lines": batch.clone()
                        }));
                        batch.clear();
                    }
                }
                msg = log_rx.recv() => {
                    match msg {
                        Some((instance_id, line, stream)) => {
                            batch.push(serde_json::json!({
                                "instance_id": instance_id,
                                "line": line,
                                "stream": stream
                            }));
                            // Also emit immediately if batch gets large
                            if batch.len() >= 50 {
                                let _ = app_for_batcher.emit("core://instance-log", serde_json::json!({
                                    "lines": batch.clone()
                                }));
                                batch.clear();
                            }
                        }
                        None => {
                            // Channel closed, emit remaining and exit
                            if !batch.is_empty() {
                                let _ = app_for_batcher.emit("core://instance-log", serde_json::json!({
                                    "lines": batch
                                }));
                            }
                            break;
                        }
                    }
                }
            }
        }
    });
    
    // Create the callback that sends to the channel
    let log_callback: piston_lib::game::launcher::LogCallback = Arc::new(move |instance_id, line, stream| {
        let _ = log_tx.send((instance_id, line, stream));
    });

    // piston_lib::game::launcher::launch_game performs blocking / non-Send work
    // (uses non-Send readers internally). Tauri requires command futures to be
    // Send so run that work inside a blocking thread and await the JoinHandle.
    let join = tokio::task::spawn_blocking(move || {
        // Execute the async launch on the blocking thread synchronously.
        futures::executor::block_on(piston_lib::game::launcher::launch_game(spec, Some(log_callback)))
    })
    .await
    .map_err(|e| format!("Failed to spawn blocking task: {}", e))?;

    // Blocking task finished; we now have the launch result (success or error)
    log::info!(
        "[launch_instance] Blocking launch task completed for instance: {}",
        instance_id
    );

    match join {
        Ok(result) => {
            log::info!(
                "[launch_instance] Game launched successfully, PID: {}",
                result.instance.pid
            );

            // Persist the running process state for re-attachment if app closes
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
                log::warn!("[launch_instance] Failed to persist process state: {}", e);
            }

            // Emit success event
            use tauri::Emitter;
            let _ = app_handle.emit(
                "core://instance-launched",
                serde_json::json!({
                    "instance_id": instance_id,
                    "name": instance.name,
                    "pid": result.instance.pid
                }),
            );

            // Spawn a background task to monitor for process exit and emit event
            let app_handle_monitor = app_handle.clone();
            let instance_id_monitor = instance_id.clone();
            let pid_monitor = result.instance.pid;
            let started_at_monitor = result.instance.started_at.to_rfc3339();
            let game_dir_monitor = result.instance.game_dir.clone();
            
            tokio::spawn(async move {
                use sysinfo::System;
                let mut sys = System::new_all();
                
                // Poll every 2 seconds to check if process is still running
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                    
                    sys.refresh_all();
                    
                    if sys.process(sysinfo::Pid::from_u32(pid_monitor)).is_none() {
                        log::info!(
                            "[launch_instance] Process {} (PID {}) has exited, updating playtime",
                            instance_id_monitor, pid_monitor
                        );
                        
                        // Check for exit_status.json for accurate exit time
                        let exit_status_path = game_dir_monitor.join(".vesta").join("exit_status.json");
                        let exited_at = if exit_status_path.exists() {
                            match std::fs::read_to_string(&exit_status_path) {
                                Ok(content) => {
                                    if let Ok(status) = serde_json::from_str::<serde_json::Value>(&content) {
                                        status.get("exited_at")
                                            .and_then(|v| v.as_str())
                                            .map(|s| s.to_string())
                                            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339())
                                    } else {
                                        chrono::Utc::now().to_rfc3339()
                                    }
                                }
                                Err(_) => chrono::Utc::now().to_rfc3339()
                            }
                        } else {
                            chrono::Utc::now().to_rfc3339()
                        };
                        
                        // Update playtime in database
                        if let Err(e) = update_instance_playtime_internal(
                            &instance_id_monitor,
                            &started_at_monitor,
                            &exited_at,
                        ) {
                            log::error!("[launch_instance] Failed to update playtime: {}", e);
                        }
                        
                        // Clean up exit status file
                        if exit_status_path.exists() {
                            let _ = std::fs::remove_file(&exit_status_path);
                        }
                        
                        // Remove from persisted running processes
                        let _ = crate::utils::process_state::remove_running_process(&instance_id_monitor);
                        
                        // Emit exit event
                        let _ = app_handle_monitor.emit(
                            "core://instance-exited",
                            serde_json::json!({
                                "instance_id": instance_id_monitor,
                                "pid": pid_monitor
                            }),
                        );
                        
                        break;
                    }
                }
            });

            Ok(())
        }
        Err(e) => {
            log::error!(
                "[launch_instance] Failed to launch game for version {}: {:#?}",
                instance.minecraft_version,
                e
            );
            Err(format!(
                "Failed to launch game for {}: {}",
                instance.minecraft_version, e
            ))
        }
    }
}

#[tauri::command]
pub async fn kill_instance(app_handle: tauri::AppHandle, instance: Instance) -> Result<(), String> {
    log::info!(
        "[kill_instance] Kill requested for instance: {}",
        instance.name
    );

    // Extract instance ID
    // runtime instance id is derived from the sanitized name
    let instance_id = instance.slug();

    // Kill the instance
    match piston_lib::game::launcher::kill_instance(&instance_id).await {
        Ok(()) => {
            log::info!(
                "[kill_instance] Instance killed successfully: {}",
                instance_id
            );

            // Remove from persisted running processes
            let _ = crate::utils::process_state::remove_running_process(&instance_id);

            // Emit success event
            use tauri::Emitter;
            let _ = app_handle.emit(
                "core://instance-killed",
                serde_json::json!({
                    "instance_id": instance_id,
                    "name": instance.name
                }),
            );

            Ok(())
        }
        Err(e) => {
            log::error!("[kill_instance] Failed to kill instance: {}", e);
            Err(format!("Failed to kill instance: {}", e))
        }
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
pub async fn is_instance_running(instance: Instance) -> Result<bool, String> {
    let instance_id = instance.slug();

    piston_lib::game::launcher::is_instance_running(&instance_id)
        .await
        .map_err(|e| format!("Failed to check instance status: {}", e))
}

#[tauri::command]
pub async fn get_minecraft_versions(
    app_handle: tauri::AppHandle,
) -> Result<piston_lib::game::metadata::PistonMetadata, String> {
    log::info!("get_minecraft_versions: attempting fast-path in-memory cache");

    // Fast path: try in-memory cache first
    if let Some(cache) = app_handle.try_state::<crate::metadata_cache::MetadataCache>() {
        if let Some(meta) = cache.get() {
            log::info!(
                "Serving Minecraft versions from in-memory MetadataCache ({} versions)",
                meta.game_versions.len()
            );
            return Ok(meta);
        } else {
            log::info!("In-memory MetadataCache empty; falling back to file load");
        }
    } else {
        log::info!("MetadataCache state not available; falling back to file load");
    }

    log::info!("Fetching Minecraft versions metadata from disk/cache");

    // Use launcher config dir: %APPDATA%/.VestaLauncher
    let data_dir = crate::utils::db_manager::get_app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;

    // Prefer reading pre-generated piston_manifest.json when available
    let manifest_path = data_dir.join("piston_manifest.json");
    let metadata = if manifest_path.exists() {
        match tokio::fs::read_to_string(&manifest_path).await {
            Ok(contents) => {
                match serde_json::from_str::<piston_lib::game::metadata::PistonMetadata>(&contents)
                {
                    Ok(parsed) => {
                        // Validate the structure
                        if parsed.game_versions.is_empty() {
                            log::warn!("piston_manifest.json is empty or corrupted, refetching...");
                            let meta = piston_lib::game::metadata::cache::load_or_fetch_metadata(
                                &data_dir,
                            )
                            .await
                            .map_err(|e| format!("Failed to load metadata: {}", e))?;
                            let _ = tokio::fs::write(
                                &manifest_path,
                                serde_json::to_string_pretty(&meta).unwrap_or_default(),
                            )
                            .await;
                            meta
                        } else {
                            parsed
                        }
                    }
                    Err(e) => {
                        log::warn!(
                            "Failed to parse piston_manifest.json ({}), refetching...",
                            e
                        );
                        let meta =
                            piston_lib::game::metadata::cache::load_or_fetch_metadata(&data_dir)
                                .await
                                .map_err(|e| format!("Failed to load metadata: {}", e))?;
                        let _ = tokio::fs::write(
                            &manifest_path,
                            serde_json::to_string_pretty(&meta).unwrap_or_default(),
                        )
                        .await;
                        meta
                    }
                }
            }
            Err(e) => {
                log::warn!("Failed to read piston_manifest.json ({}), refetching...", e);
                let meta = piston_lib::game::metadata::cache::load_or_fetch_metadata(&data_dir)
                    .await
                    .map_err(|e| format!("Failed to load metadata: {}", e))?;
                let _ = tokio::fs::write(
                    &manifest_path,
                    serde_json::to_string_pretty(&meta).unwrap_or_default(),
                )
                .await;
                meta
            }
        }
    } else {
        log::info!("piston_manifest.json not found, fetching fresh...");
        let meta = piston_lib::game::metadata::cache::load_or_fetch_metadata(&data_dir)
            .await
            .map_err(|e| format!("Failed to load metadata: {}", e))?;
        let _ = tokio::fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&meta).unwrap_or_default(),
        )
        .await;
        meta
    };

    log::info!(
        "Retrieved metadata with {} game versions",
        metadata.game_versions.len()
    );

    // Populate in-memory cache after disk/path load for future fast-path
    if let Some(cache) = app_handle.try_state::<crate::metadata_cache::MetadataCache>() {
        cache.set(&metadata);
        log::info!("Populated in-memory MetadataCache after disk load");
    }

    Ok(metadata)
}

#[tauri::command]
pub async fn regenerate_piston_manifest(app_handle: tauri::AppHandle) -> Result<(), String> {
    log::info!("Submitting force refresh task to TaskManager");

    let task_manager = app_handle.state::<TaskManager>();

    task_manager
        .submit(Box::new(GenerateManifestTask::new_force_refresh()))
        .await
        .map_err(|e| format!("Failed to submit refresh task: {}", e))?;

    log::info!("Force refresh task submitted successfully");
    Ok(())
}

/// Update the installation status for an instance
pub fn update_installation_status(instance_id: i32, status: &str) -> Result<(), String> {
    log::info!(
        "Updating installation status for instance {} to: {}",
        instance_id,
        status
    );

    let db = get_data_db().map_err(|e| format!("Failed to get database: {}", e))?;
    let conn = db.get_connection();

    conn.execute(
        &format!(
            "UPDATE {} SET installation_status = ?1, updated_at = datetime('now') WHERE id = ?2",
            Instance::name()
        ),
        rusqlite::params![status, instance_id],
    )
    .map_err(|e| format!("Failed to update installation status: {}", e))?;

    log::info!("Installation status updated successfully");
    Ok(())
}

/// Read the last N lines from an instance's log file
#[tauri::command]
pub fn read_instance_log(instance_id: String, last_lines: Option<usize>) -> Result<Vec<String>, String> {
    let data_dir = crate::utils::db_manager::get_app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;
    
    // Log file is stored at <data_dir>/data/logs/<instance_id>.log
    let log_file = data_dir.join("data").join("logs").join(format!("{}.log", instance_id));
    
    if !log_file.exists() {
        log::debug!("Log file not found for instance {}: {:?}", instance_id, log_file);
        return Ok(vec![]);
    }
    
    let content = std::fs::read_to_string(&log_file)
        .map_err(|e| format!("Failed to read log file: {}", e))?;
    
    let lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let limit = last_lines.unwrap_or(500);
    
    if lines.len() > limit {
        Ok(lines[lines.len() - limit..].to_vec())
    } else {
        Ok(lines)
    }
}
