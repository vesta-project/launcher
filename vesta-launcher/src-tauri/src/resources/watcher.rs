use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use notify::{Watcher, RecursiveMode, Event, Config};
use walkdir::WalkDir;
use tauri::{AppHandle, Manager, Emitter};
use std::collections::HashMap;
use crate::resources::ResourceManager;
use crate::models::installed_resource::InstalledResource;
use crate::models::resource::SourcePlatform;
use anyhow::Result;
use crate::schema::installed_resource::dsl as ir_dsl;
use crate::utils::hash::{calculate_sha1, calculate_curseforge_fingerprint};

pub struct ResourceWatcher {
    app_handle: AppHandle,
    // Map of db_id -> watcher
    watchers: Arc<Mutex<HashMap<i32, notify::RecommendedWatcher>>>,
}

impl ResourceWatcher {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Recursively scan and watch an instance's resource folders
    pub async fn watch_instance(&self, _slug: String, db_id: i32, game_dir: String) -> anyhow::Result<()> {
        let mut watchers = self.watchers.lock().await;
        
        if watchers.contains_key(&db_id) {
            return Ok(());
        }

        let game_path = PathBuf::from(&game_dir);
        let folders_to_watch = ["mods", "resourcepacks", "shaderpacks"];
        
        let app_handle = self.app_handle.clone();
        let watchers_ptr = self.watchers.clone();

        // Initial scan
        for folder in folders_to_watch {
            let path = game_path.join(folder);
            if path.exists() {
                self.scan_folder(db_id, &path).await?;
                // Cleanup any resources in database that no longer exist on disk
                let _ = self.cleanup_missing_resources(db_id, &path).await;
            }
        }

        let (tx, mut rx) = tokio::sync::mpsc::channel(100);

        let mut watcher = notify::RecommendedWatcher::new(move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                let _ = tx.blocking_send(event);
            }
        }, Config::default())?;

        for folder in folders_to_watch {
            let path = game_path.join(folder);
            if path.exists() {
                watcher.watch(&path, RecursiveMode::NonRecursive)?;
                log::info!("[ResourceWatcher] Watching: {:?}", path);
            }
        }

        // Handle events in a separate task
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                // Check if still watched before handling
                let is_watched = {
                    let w = watchers_ptr.lock().await;
                    w.contains_key(&db_id)
                };
                if is_watched {
                    handle_event(&app_handle, db_id, event, watchers_ptr.clone()).await;
                } else {
                    log::debug!("[ResourceWatcher] Dropping event for db_id {} as it is no longer watched", db_id);
                    break;
                }
            }
        });

        watchers.insert(db_id, watcher);
        Ok(())
    }

    /// Stop watching an instance's resource folders
    pub async fn unwatch_instance(&self, db_id: i32) -> anyhow::Result<()> {
        let mut watchers = self.watchers.lock().await;
        if watchers.remove(&db_id).is_some() {
            log::info!("[ResourceWatcher] Unwatched instance ID: {}", db_id);
        }
        Ok(())
    }

    async fn scan_folder(&self, db_id: i32, folder_path: &Path) -> Result<()> {
        log::info!("[ResourceWatcher] Scanning folder: {:?}", folder_path);
        let watchers_ptr = self.watchers.clone();
        for entry in WalkDir::new(folder_path).max_depth(1).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() && is_resource_file(entry.path()) {
                let path = entry.path().to_path_buf();
                let app = self.app_handle.clone();
                let watchers_spawn = watchers_ptr.clone();
                tauri::async_runtime::spawn(async move {
                    // Check if still watched
                    let is_watched = {
                        let w = watchers_spawn.lock().await;
                        w.contains_key(&db_id)
                    };
                    if is_watched {
                        if let Err(e) = identify_and_link_resource(&app, db_id, &path, watchers_spawn).await {
                            // If it's a FK error, it might be a race condition where it was deleted right after we checked.
                            // We already check, but let's be safe.
                            if !e.to_string().contains("FOREIGN KEY") {
                                log::error!("[ResourceWatcher] Failed to identify {:?}: {}", path, e);
                            }
                        }
                    }
                });
            }
        }
        Ok(())
    }

    async fn cleanup_missing_resources(&self, db_id: i32, folder_path: &Path) -> Result<()> {
        use crate::utils::db::get_vesta_conn;
        use diesel::prelude::*;
        
        let mut conn = get_vesta_conn()?;
        let folder_prefix = folder_path.to_string_lossy().to_string();

        log::debug!("[ResourceWatcher] Cleaning up missing resources in: {:?}", folder_path);

        // Get all resources for this instance
        let resources = ir_dsl::installed_resource
            .filter(ir_dsl::instance_id.eq(db_id))
            .load::<InstalledResource>(&mut conn)?;

        for res in resources {
            // If the resource is in the folder we just scanned, check if it exists
            if res.local_path.starts_with(&folder_prefix) {
                if !Path::new(&res.local_path).exists() {
                    log::info!("[ResourceWatcher] Removing dead resource from DB: {}", res.local_path);
                    diesel::delete(ir_dsl::installed_resource.filter(ir_dsl::id.eq(res.id.unwrap())))
                        .execute(&mut conn)?;
                }
            }
        }
        
        Ok(())
    }

    pub async fn stop_watching(&self, db_id: i32) {
        let mut watchers = self.watchers.lock().await;
        watchers.remove(&db_id);
    }

    pub async fn refresh_instance(&self, db_id: i32, game_dir: String) -> anyhow::Result<()> {
        let game_path = PathBuf::from(&game_dir);
        let folders_to_watch = ["mods", "resourcepacks", "shaderpacks"];

        for folder in folders_to_watch {
            let path = game_path.join(folder);
            if path.exists() {
                self.scan_folder(db_id, &path).await?;
                let _ = self.cleanup_missing_resources(db_id, &path).await;
            }
        }
        Ok(())
    }
}

async fn handle_event(app: &AppHandle, db_id: i32, event: Event, watchers: Arc<Mutex<HashMap<i32, notify::RecommendedWatcher>>>) {
    use notify::EventKind;

    match event.kind {
        EventKind::Create(_) | EventKind::Modify(_) => {
            for path in event.paths {
                if is_resource_file(&path) {
                    log::info!("[ResourceWatcher] Resource changed in instance {}: {:?}", db_id, path);
                    let app_clone = app.clone();
                    let watchers_clone = watchers.clone();
                    tauri::async_runtime::spawn(async move {
                        let is_watched = {
                            let w = watchers_clone.lock().await;
                            w.contains_key(&db_id)
                        };
                        if is_watched {
                            if let Err(e) = identify_and_link_resource(&app_clone, db_id, &path, watchers_clone).await {
                                if !e.to_string().contains("FOREIGN KEY") {
                                    log::error!("[ResourceWatcher] Failed to identify {:?}: {}", path, e);
                                }
                            }
                        }
                    });
                }
            }
        }
        EventKind::Remove(_) => {
            for path in event.paths {
                log::info!("[ResourceWatcher] Resource removed from instance {}: {:?}", db_id, path);
                let app_clone = app.clone();
                let watchers_clone = watchers.clone();
                tauri::async_runtime::spawn(async move {
                    let is_watched = {
                        let w = watchers_clone.lock().await;
                        w.contains_key(&db_id)
                    };
                    if is_watched {
                        if let Err(e) = unlink_resource_from_db(&app_clone, db_id, &path).await {
                            if !e.to_string().contains("FOREIGN KEY") {
                                log::error!("[ResourceWatcher] Failed to unlink {:?}: {}", path, e);
                            }
                        }
                    }
                });
            }
        }
        _ => {}
    }
}

fn is_resource_file(path: &Path) -> bool {
    let s = path.to_string_lossy().to_lowercase();
    s.ends_with(".jar") || s.ends_with(".zip") || s.ends_with(".jar.disabled") || s.ends_with(".zip.disabled")
}

fn is_enabled_path(path: &Path) -> bool {
    !path.to_string_lossy().to_lowercase().ends_with(".disabled")
}

async fn identify_and_link_resource(
    app: &AppHandle,
    instance_db_id: i32,
    path: &Path,
    watchers: Arc<Mutex<HashMap<i32, notify::RecommendedWatcher>>>,
) -> Result<()> {
    // Check if still watched before doing heavy work
    {
        let w = watchers.lock().await;
        if !w.contains_key(&instance_db_id) {
            return Ok(());
        }
    }

    if !path.exists() {
        return Ok(());
    }

    let hash = calculate_sha1(path)?;
    log::debug!("[ResourceWatcher] Identified hash for {:?}: {}", path, hash);

    let resource_manager = app.state::<ResourceManager>();
    
    // Check if we HAVE a record in the DB already with a specific platform.
    // If we installed it from CurseForge, we should prefer checking CurseForge first
    // so we don't "Modrinth-ify" a CurseForge-provided file.
    let mut preferred_platform = None;
    {
        use crate::utils::db::get_vesta_conn;
        use diesel::prelude::*;
        if let Ok(mut conn) = get_vesta_conn() {
            let path_str = path.to_string_lossy().to_string();
            if let Ok(Some(existing)) = ir_dsl::installed_resource
                .filter(ir_dsl::local_path.eq(&path_str))
                .first::<InstalledResource>(&mut conn)
                .optional() {
                    preferred_platform = Some(match existing.platform.as_str() {
                        "modrinth" => SourcePlatform::Modrinth,
                        "curseforge" => SourcePlatform::CurseForge,
                        _ => SourcePlatform::Modrinth,
                    });
                }
        }
    }

    let search_order = if let Some(pref) = preferred_platform {
        if pref == SourcePlatform::CurseForge {
            vec![SourcePlatform::CurseForge, SourcePlatform::Modrinth]
        } else {
            vec![SourcePlatform::Modrinth, SourcePlatform::CurseForge]
        }
    } else {
        vec![SourcePlatform::Modrinth, SourcePlatform::CurseForge]
    };

    for platform in search_order {
        match platform {
            SourcePlatform::Modrinth => {
                if let Ok((project, version)) = resource_manager.get_by_hash(SourcePlatform::Modrinth, &hash).await {
                    log::info!("[ResourceWatcher] Found Modrinth resource: {} ({})", project.name, version.version_number);
                    link_resource_to_db(app, instance_db_id, path, project, version, SourcePlatform::Modrinth, Some(hash)).await?;
                    return Ok(());
                }
            },
            SourcePlatform::CurseForge => {
                if let Ok(fp) = calculate_curseforge_fingerprint(path) {
                    if let Ok((project, version)) = resource_manager.get_by_hash(SourcePlatform::CurseForge, &fp.to_string()).await {
                        log::info!("[ResourceWatcher] Found CurseForge resource: {} ({})", project.name, version.version_number);
                        link_resource_to_db(app, instance_db_id, path, project, version, SourcePlatform::CurseForge, Some(hash)).await?;
                        return Ok(());
                    }
                }
            }
        }
    }

    // If no match found, link as manual/unknown resource
    link_manual_resource_to_db(app, instance_db_id, path, Some(hash)).await?;

    Ok(())
}

async fn link_manual_resource_to_db(
    app: &AppHandle,
    instance_id: i32,
    path: &Path,
    hash: Option<String>,
) -> Result<()> {
    use crate::utils::db::get_vesta_conn;
    use diesel::prelude::*;
    use crate::models::installed_resource::InstalledResource;

    let mut conn = get_vesta_conn()?;
    let path_str = path.to_string_lossy().to_string();
    let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("Unknown Resource").to_string();
    let is_enabled = is_enabled_path(path);

    // Check if path already exists
    let existing = ir_dsl::installed_resource
        .filter(ir_dsl::instance_id.eq(instance_id))
        .filter(ir_dsl::local_path.eq(&path_str))
        .first::<InstalledResource>(&mut conn)
        .optional()?;

    if let Some(res) = existing {
        // If it was already manual, maybe we just update last_updated or is_enabled
        diesel::update(ir_dsl::installed_resource.filter(ir_dsl::id.eq(res.id.unwrap())))
            .set((
                ir_dsl::is_enabled.eq(is_enabled),
                ir_dsl::last_updated.eq(chrono::Utc::now().naive_utc()),
                ir_dsl::hash.eq(hash),
            ))
            .execute(&mut conn)?;
        return Ok(());
    }

    diesel::insert_into(ir_dsl::installed_resource)
        .values((
            ir_dsl::instance_id.eq(instance_id),
            ir_dsl::platform.eq("manual"),
            ir_dsl::remote_id.eq(""),
            ir_dsl::remote_version_id.eq(""),
            ir_dsl::resource_type.eq("unknown"),
            ir_dsl::local_path.eq(&path_str),
            ir_dsl::display_name.eq(&file_name),
            ir_dsl::current_version.eq("unknown"),
            ir_dsl::release_type.eq("release"),
            ir_dsl::is_manual.eq(true),
            ir_dsl::is_enabled.eq(is_enabled),
            ir_dsl::last_updated.eq(chrono::Utc::now().naive_utc()),
            ir_dsl::hash.eq(hash),
        ))
        .execute(&mut conn)?;

    app.emit("resources-updated", instance_id)?;

    Ok(())
}

async fn link_resource_to_db(
    app: &AppHandle, 
    instance_db_id: i32, 
    path: &Path, 
    project: crate::models::resource::ResourceProject, 
    version: crate::models::resource::ResourceVersion,
    platform: SourcePlatform,
    hash: Option<String>,
) -> Result<()> {
    use crate::utils::db::get_vesta_conn;
    use diesel::prelude::*;

    let mut conn = get_vesta_conn()?;
    let path_str = path.to_string_lossy().to_string();
    let platform_str = match platform {
        SourcePlatform::Modrinth => "modrinth",
        SourcePlatform::CurseForge => "curseforge",
    };

    let release_type_str = format!("{:?}", version.release_type).to_lowercase();
    let res_type_str = format!("{:?}", project.resource_type);
    let is_enabled = is_enabled_path(path);

    // 1. Try to find by path first (exact file match)
    let existing_by_path = ir_dsl::installed_resource
        .filter(ir_dsl::instance_id.eq(instance_db_id))
        .filter(ir_dsl::local_path.eq(&path_str))
        .first::<InstalledResource>(&mut conn)
        .optional()?;

    // 2. If not found by path, try by remote_id (the same mod but maybe different file name)
    let existing_by_id = if existing_by_path.is_none() {
        ir_dsl::installed_resource
            .filter(ir_dsl::instance_id.eq(instance_db_id))
            .filter(ir_dsl::remote_id.eq(&project.id))
            .first::<InstalledResource>(&mut conn)
            .optional()?
    } else {
        None
    };

    let existing = existing_by_path.or(existing_by_id);

    if let Some(res) = existing {
        // Update
        diesel::update(ir_dsl::installed_resource.filter(ir_dsl::id.eq(res.id.unwrap())))
            .set((
                ir_dsl::platform.eq(platform_str),
                ir_dsl::remote_id.eq(&project.id),
                ir_dsl::remote_version_id.eq(&version.id),
                ir_dsl::local_path.eq(&path_str),
                ir_dsl::display_name.eq(&project.name),
                ir_dsl::current_version.eq(&version.version_number),
                ir_dsl::release_type.eq(&release_type_str),
                ir_dsl::is_manual.eq(false),
                ir_dsl::is_enabled.eq(is_enabled),
                ir_dsl::last_updated.eq(chrono::Utc::now().naive_utc()),
                ir_dsl::hash.eq(hash),
            ))
            .execute(&mut conn)?;
    } else {
        // Insert
        diesel::insert_into(ir_dsl::installed_resource)
            .values((
                ir_dsl::instance_id.eq(instance_db_id),
                ir_dsl::platform.eq(platform_str),
                ir_dsl::remote_id.eq(&project.id),
                ir_dsl::remote_version_id.eq(&version.id),
                ir_dsl::resource_type.eq(res_type_str),
                ir_dsl::local_path.eq(path_str),
                ir_dsl::display_name.eq(&project.name),
                ir_dsl::current_version.eq(&version.version_number),
                ir_dsl::release_type.eq(&release_type_str),
                ir_dsl::is_manual.eq(false),
                ir_dsl::is_enabled.eq(is_enabled),
                ir_dsl::last_updated.eq(chrono::Utc::now().naive_utc()),
                ir_dsl::hash.eq(hash),
            ))
            .execute(&mut conn)?;
    }

    // Emit event to frontend
    app.emit("resources-updated", instance_db_id)?;

    Ok(())
}

async fn unlink_resource_from_db(
    app: &AppHandle,
    instance_db_id: i32,
    path: &Path,
) -> Result<()> {
    use crate::utils::db::get_vesta_conn;
    use diesel::prelude::*;

    let mut conn = get_vesta_conn()?;
    let path_str = path.to_string_lossy().to_string();

    diesel::delete(ir_dsl::installed_resource
        .filter(ir_dsl::instance_id.eq(instance_db_id))
        .filter(ir_dsl::local_path.eq(&path_str)))
        .execute(&mut conn)?;

    app.emit("resources-updated", instance_db_id)?;

    Ok(())
}
