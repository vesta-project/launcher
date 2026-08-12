use crate::models::installed_resource::InstalledResource;
use crate::models::resource::SourcePlatform;
pub use crate::resources::ledger::ResourceProvenance;
use crate::resources::ResourceManager;
use crate::schema::installed_resource::dsl as ir_dsl;
use crate::utils::instance_helpers::normalize_path;
use anyhow::Result;
use notify::{Config, Event, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use tokio::time::Duration;
use walkdir::WalkDir;

#[derive(Debug, Clone, Default)]
pub struct ScanSummary {
    pub total: usize,
    pub processed: usize,
    pub skipped: usize,
    pub failed: usize,
}

#[derive(Debug, Clone)]
pub struct ScanProgressSnapshot {
    pub folder: String,
    pub total: usize,
    pub processed: usize,
    pub skipped: usize,
    pub failed: usize,
}

pub struct ResourceWatcher {
    app_handle: AppHandle,
    // Map of db_id -> watcher
    watchers: Arc<Mutex<HashMap<i32, notify::RecommendedWatcher>>>,
}

pub fn modpack_provenance_for_instance(instance_id: i32) -> Result<ResourceProvenance> {
    crate::resources::ledger::modpack_provenance_for_instance(instance_id)
}

impl ResourceWatcher {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Recursively scan and watch an instance's resource folders
    pub async fn watch_instance(
        &self,
        _slug: String,
        db_id: i32,
        game_dir: String,
    ) -> anyhow::Result<()> {
        self.watch_instance_internal(db_id, game_dir, true).await
    }

    pub async fn watch_instance_without_scan(
        &self,
        db_id: i32,
        game_dir: String,
    ) -> anyhow::Result<()> {
        self.watch_instance_internal(db_id, game_dir, false).await
    }

    async fn watch_instance_internal(
        &self,
        db_id: i32,
        game_dir: String,
        initial_scan: bool,
    ) -> anyhow::Result<()> {
        {
            let watchers = self.watchers.lock().await;
            if watchers.contains_key(&db_id) {
                return Ok(());
            }
        }

        let game_path = PathBuf::from(&game_dir);
        let folders_to_watch = ["mods", "resourcepacks", "shaderpacks"];

        let app_handle = self.app_handle.clone();
        let watchers_ptr = self.watchers.clone();

        let (tx, mut rx) = tokio::sync::mpsc::channel(100);

        let mut watcher = notify::RecommendedWatcher::new(
            move |res: notify::Result<Event>| {
                if let Ok(event) = res {
                    if tx.try_send(event).is_err() {
                        log::debug!("[ResourceWatcher] Event queue full, dropping event");
                    }
                }
            },
            Config::default(),
        )?;

        for folder in folders_to_watch {
            let path = game_path.join(folder);
            if path.exists() {
                watcher.watch(&path, RecursiveMode::NonRecursive)?;
                log::info!("[ResourceWatcher] Watching: {:?}", path);
            }
        }
        let saves = game_path.join("saves");
        if saves.exists() {
            watcher.watch(&saves, RecursiveMode::NonRecursive)?;
            log::info!("[ResourceWatcher] Watching world topology: {:?}", saves);
        }
        for datapacks in world_datapack_directories(&game_path) {
            watcher.watch(&datapacks, RecursiveMode::NonRecursive)?;
            log::info!(
                "[ResourceWatcher] Watching world datapacks: {:?}",
                datapacks
            );
        }

        {
            let mut watchers = self.watchers.lock().await;
            // Double-check after watcher creation to avoid duplicate registration races.
            if watchers.contains_key(&db_id) {
                return Ok(());
            }
            watchers.insert(db_id, watcher);
        }

        // Handle events in a separate task
        tauri::async_runtime::spawn(async move {
            while let Some(first_event) = rx.recv().await {
                let mut events = vec![first_event];
                while let Ok(Some(event)) =
                    tokio::time::timeout(Duration::from_millis(180), rx.recv()).await
                {
                    events.push(event);
                }
                // Check if still watched before handling
                let is_watched = {
                    let w = watchers_ptr.lock().await;
                    w.contains_key(&db_id)
                };
                if is_watched {
                    let topology_changed = handle_events(&app_handle, db_id, events).await;
                    if topology_changed {
                        if let Some(watcher) = watchers_ptr.lock().await.get_mut(&db_id) {
                            for datapacks in world_datapack_directories(&game_path) {
                                if let Err(error) =
                                    watcher.watch(&datapacks, RecursiveMode::NonRecursive)
                                {
                                    log::debug!(
                                        "[ResourceWatcher] World datapack watch unchanged for {:?}: {}",
                                        datapacks,
                                        error
                                    );
                                }
                            }
                        }
                    }
                } else {
                    log::debug!(
                        "[ResourceWatcher] Dropping event for db_id {} as it is no longer watched",
                        db_id
                    );
                    break;
                }
            }
        });

        // Initial scan after watcher registration so worker tasks don't block on is_watched checks.
        if initial_scan {
            self.refresh_instance(db_id, game_dir).await?;
        }

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

    async fn cleanup_missing_resources(&self, db_id: i32, folder_path: &Path) -> Result<usize> {
        log::debug!(
            "[ResourceWatcher] Cleaning up missing resources in: {:?}",
            folder_path
        );
        crate::resources::ledger::remove_missing_in_folder(db_id, folder_path)
    }

    pub async fn stop_watching(&self, db_id: i32) {
        let mut watchers = self.watchers.lock().await;
        watchers.remove(&db_id);
    }

    /// Attaches non-recursive watches for datapack directories belonging to
    /// worlds discovered after the instance watcher was first registered.
    pub async fn refresh_world_watches(
        &self,
        db_id: i32,
        game_dir: impl AsRef<Path>,
    ) -> anyhow::Result<()> {
        let mut watchers = self.watchers.lock().await;
        let Some(watcher) = watchers.get_mut(&db_id) else {
            return Ok(());
        };
        for datapacks in world_datapack_directories(game_dir.as_ref()) {
            if let Err(error) = watcher.watch(&datapacks, RecursiveMode::NonRecursive) {
                log::debug!(
                    "[ResourceWatcher] World datapack watch unchanged for {:?}: {}",
                    datapacks,
                    error
                );
            }
        }
        Ok(())
    }

    pub async fn refresh_instance(&self, db_id: i32, game_dir: String) -> anyhow::Result<()> {
        let _ = self
            .refresh_instance_with_progress(db_id, game_dir, None)
            .await?;
        Ok(())
    }

    pub async fn refresh_instance_with_progress(
        &self,
        db_id: i32,
        game_dir: String,
        progress_tx: Option<tokio::sync::mpsc::UnboundedSender<ScanProgressSnapshot>>,
    ) -> anyhow::Result<ScanSummary> {
        let game_path = PathBuf::from(&game_dir);
        let folders_to_watch = ["mods", "resourcepacks", "shaderpacks"];
        let mut paths = Vec::new();
        let mut existing_folders = Vec::new();
        for folder in folders_to_watch {
            let folder_path = game_path.join(folder);
            if !folder_path.exists() {
                continue;
            }
            existing_folders.push(folder_path.clone());
            paths.extend(
                WalkDir::new(&folder_path)
                    .max_depth(1)
                    .into_iter()
                    .filter_map(|entry| entry.ok())
                    .filter(|entry| entry.file_type().is_file() && is_resource_file(entry.path()))
                    .map(|entry| entry.path().to_path_buf()),
            );
        }
        for folder_path in world_datapack_directories(&game_path) {
            existing_folders.push(folder_path.clone());
            paths.extend(
                WalkDir::new(&folder_path)
                    .max_depth(1)
                    .into_iter()
                    .filter_map(|entry| entry.ok())
                    .filter(|entry| entry.file_type().is_file() && is_resource_file(entry.path()))
                    .map(|entry| entry.path().to_path_buf()),
            );
        }

        let total = paths.len();
        if let Some(tx) = progress_tx.as_ref() {
            let _ = tx.send(ScanProgressSnapshot {
                folder: "resources".to_string(),
                total,
                processed: 0,
                skipped: 0,
                failed: 0,
            });
        }
        let mut removed = 0;
        for folder in existing_folders {
            removed += self
                .cleanup_missing_resources(db_id, &folder)
                .await
                .unwrap_or_default();
        }
        let candidates = crate::resources::reconciliation::candidates_from_paths(
            paths,
            None,
            preferred_platform_for_instance(db_id),
        );
        let result = crate::resources::reconciliation::discover_candidates(
            &self.app_handle,
            db_id,
            candidates,
            "filesystem-scan",
        )
        .await?;
        if removed > 0 && result.changed == 0 {
            crate::resources::reconciliation::emit_rows_changed(
                &self.app_handle,
                db_id,
                "filesystem-scan",
            )?;
        }
        let summary = ScanSummary {
            total,
            processed: result.attempted,
            skipped: total.saturating_sub(result.attempted),
            failed: 0,
        };
        if let Some(tx) = progress_tx.as_ref() {
            let _ = tx.send(ScanProgressSnapshot {
                folder: "resources".to_string(),
                total,
                processed: summary.processed,
                skipped: summary.skipped,
                failed: 0,
            });
        }
        Ok(summary)
    }
}

fn preferred_platform_for_instance(instance_id: i32) -> Option<SourcePlatform> {
    use crate::models::instance::Instance;
    use crate::schema::instance::dsl as instance_dsl;
    use crate::utils::db::get_vesta_conn;
    use diesel::prelude::*;

    let mut conn = get_vesta_conn().ok()?;
    let instance = instance_dsl::instance
        .find(instance_id)
        .first::<Instance>(&mut conn)
        .ok()?;
    match instance.modpack_platform.as_deref() {
        Some("modrinth") => Some(SourcePlatform::Modrinth),
        Some("curseforge") => Some(SourcePlatform::CurseForge),
        _ => None,
    }
}

fn instance_name_for_log(instance_id: i32) -> String {
    use crate::models::instance::Instance;
    use crate::schema::instance::dsl as instance_dsl;
    use crate::utils::db::get_vesta_conn;
    use diesel::prelude::*;

    get_vesta_conn()
        .ok()
        .and_then(|mut conn| {
            instance_dsl::instance
                .find(instance_id)
                .first::<Instance>(&mut conn)
                .ok()
        })
        .map(|instance| instance.name)
        .unwrap_or_else(|| "unknown instance".to_string())
}

async fn handle_events(app: &AppHandle, db_id: i32, events: Vec<Event>) -> bool {
    use notify::EventKind;

    let mut changed = HashSet::new();
    let mut removed = HashSet::new();
    let mut world_topology_changed = false;
    let instance = crate::commands::instances::get_instance(db_id).ok();
    let game_path = instance
        .as_ref()
        .and_then(|instance| crate::worlds::instance_game_directory(instance).ok());
    let mut changed_worlds = HashSet::new();
    for event in events {
        if event.paths.iter().any(|path| {
            path.parent()
                .and_then(Path::file_name)
                .is_some_and(|name| name == "saves")
        }) {
            world_topology_changed = true;
        }
        if let Some(game_path) = game_path.as_deref() {
            changed_worlds.extend(
                event
                    .paths
                    .iter()
                    .filter_map(|path| world_ref_for_datapack_path(game_path, db_id, path)),
            );
        }
        match event.kind {
            EventKind::Create(_) | EventKind::Modify(_) => {
                for path in event.paths {
                    if is_resource_file(&path) {
                        changed.insert(path);
                    }
                }
            }
            EventKind::Remove(_) => {
                removed.extend(event.paths);
            }
            _ => {}
        }
    }

    // Debounced rename/staging bursts may contain both remove and create for
    // one path. Reconcile from final disk state so a managed publication does
    // not unlink the newly committed Ledger row.
    for path in removed.clone() {
        if path.exists() {
            removed.remove(&path);
            if is_resource_file(&path) {
                changed.insert(path);
            }
        }
    }
    changed.retain(|path| !removed.contains(path));
    if !changed.is_empty() {
        let candidates = crate::resources::reconciliation::candidates_from_paths(
            changed,
            None,
            preferred_platform_for_instance(db_id),
        );
        if let Err(error) = crate::resources::reconciliation::discover_candidates(
            app,
            db_id,
            candidates,
            "filesystem-burst",
        )
        .await
        {
            log::warn!(
                "[ResourceWatcher] Failed to publish resource burst for {}: {}",
                instance_name_for_log(db_id),
                error
            );
        }
    }

    let mut removed_any = false;
    for path in removed {
        let removed_world = path
            .parent()
            .and_then(Path::file_name)
            .is_some_and(|name| name == "saves");
        let result = if removed_world {
            crate::resources::ledger::unlink_subtree(db_id, &path)
        } else {
            crate::resources::ledger::unlink_path(db_id, &path)
        };
        match result {
            Ok(count) => removed_any |= count > 0,
            Err(error) => log::warn!(
                "[ResourceWatcher] Failed to unlink {:?} for {}: {}",
                path,
                instance_name_for_log(db_id),
                error
            ),
        }
    }
    if removed_any {
        let _ =
            crate::resources::reconciliation::emit_rows_changed(app, db_id, "filesystem-remove");
    }
    if world_topology_changed || !changed_worlds.is_empty() {
        if let Some(world_manager) = app.try_state::<crate::worlds::WorldManager>() {
            world_manager.invalidate(db_id);
        }
    }
    if world_topology_changed {
        let _ = app.emit(
            "core://instance-worlds-changed",
            serde_json::json!({
                "instanceId": db_id,
                "revision": chrono::Utc::now().timestamp_millis(),
                "reason": "filesystem-topology"
            }),
        );
    }
    for world_ref in changed_worlds {
        let _ = crate::worlds::datapacks::emit_world_datapacks_changed(
            app,
            &world_ref,
            "datapack-filesystem",
        );
    }
    world_topology_changed
}

fn world_ref_for_datapack_path(
    game_path: &Path,
    instance_id: i32,
    path: &Path,
) -> Option<crate::worlds::WorldRef> {
    let relative = path.strip_prefix(game_path.join("saves")).ok()?;
    let mut components = relative.components();
    let directory_name = components.next()?.as_os_str().to_str()?.to_string();
    if components.next()?.as_os_str() != "datapacks" {
        return None;
    }
    crate::worlds::validate_directory_name(&directory_name).ok()?;
    Some(crate::worlds::WorldRef {
        instance_id,
        directory_name,
    })
}

fn world_datapack_directories(game_path: &Path) -> Vec<PathBuf> {
    let saves = game_path.join("saves");
    let Ok(entries) = std::fs::read_dir(saves) else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if !file_type.is_dir() || file_type.is_symlink() {
                return None;
            }
            let world = entry.path();
            if !crate::worlds::level_dat::has_level_marker(&world) {
                return None;
            }
            let datapacks = world.join("datapacks");
            datapacks.is_dir().then_some(datapacks)
        })
        .collect()
}

fn is_resource_file(path: &Path) -> bool {
    let s = path.to_string_lossy().to_lowercase();
    s.ends_with(".jar")
        || s.ends_with(".zip")
        || s.ends_with(".jar.disabled")
        || s.ends_with(".zip.disabled")
}

#[cfg(test)]
mod world_datapack_event_tests {
    use super::world_ref_for_datapack_path;
    use std::path::Path;

    #[test]
    fn scopes_datapack_events_to_the_exact_world() {
        let game = Path::new("/instances/example");
        let world = world_ref_for_datapack_path(
            game,
            42,
            Path::new("/instances/example/saves/My World/datapacks/pack.zip"),
        )
        .unwrap();
        assert_eq!(world.instance_id, 42);
        assert_eq!(world.directory_name, "My World");
    }

    #[test]
    fn ignores_non_world_datapack_named_directories() {
        let game = Path::new("/instances/example");
        assert!(world_ref_for_datapack_path(
            game,
            42,
            Path::new("/instances/example/mods/datapacks/pack.zip"),
        )
        .is_none());
        assert!(world_ref_for_datapack_path(
            game,
            42,
            Path::new("/instances/example/saves/My World/data/foo"),
        )
        .is_none());
    }
}

pub async fn resolve_modpack_override_conflicts(app: &AppHandle, instance_id: i32) -> Result<()> {
    use crate::models::resource::SourcePlatform;
    use crate::notifications::manager::NotificationManager;
    use crate::notifications::models::{CreateNotificationInput, NotificationType};
    use crate::utils::db::get_vesta_conn;
    use diesel::prelude::*;

    let resources = {
        let mut conn = get_vesta_conn()?;
        ir_dsl::installed_resource
            .filter(ir_dsl::instance_id.eq(instance_id))
            .filter(ir_dsl::remote_id.ne(""))
            .filter(ir_dsl::platform.eq_any(vec!["modrinth", "curseforge"]))
            .load::<InstalledResource>(&mut conn)?
    };

    let mut disabled_custom: Vec<String> = Vec::new();
    let mut to_disable: Vec<(InstalledResource, InstalledResource)> = Vec::new();
    let rm = app.state::<ResourceManager>();

    for pack_resource in resources
        .iter()
        .filter(|r| r.source_kind == "modpack" && r.is_enabled)
    {
        for custom_resource in resources.iter().filter(|r| {
            r.source_kind != "modpack"
                && r.is_enabled
                && r.platform == pack_resource.platform
                && r.remote_id == pack_resource.remote_id
        }) {
            let pack_should_win = match SourcePlatform::from_str_id(pack_resource.platform.as_str())
            {
                Some(platform) => {
                    version_is_at_least(
                        &rm,
                        platform,
                        &pack_resource.remote_id,
                        &pack_resource.remote_version_id,
                        &custom_resource.remote_version_id,
                    )
                    .await
                }
                None => false,
            };

            if pack_should_win {
                to_disable.push((custom_resource.clone(), pack_resource.clone()));
            }
        }
    }

    if to_disable.is_empty() {
        return Ok(());
    }

    let mut conn = get_vesta_conn()?;
    for (custom_resource, pack_resource) in to_disable {
        let current_path = PathBuf::from(&custom_resource.local_path);
        let disabled_path = if custom_resource.local_path.ends_with(".disabled") {
            current_path.clone()
        } else {
            PathBuf::from(format!("{}.disabled", custom_resource.local_path))
        };

        if current_path.exists() && current_path != disabled_path {
            std::fs::rename(&current_path, &disabled_path)?;
        }

        diesel::update(ir_dsl::installed_resource.filter(ir_dsl::id.eq(custom_resource.id)))
            .set((
                ir_dsl::local_path.eq(normalize_path(&disabled_path)),
                ir_dsl::is_enabled.eq(false),
            ))
            .execute(&mut conn)?;

        disabled_custom.push(format!(
            "{} (custom {} -> pack {})",
            custom_resource.display_name,
            custom_resource.current_version,
            pack_resource.current_version
        ));
    }

    crate::resources::reconciliation::emit_rows_changed(
        app,
        instance_id,
        "override-conflicts-resolved",
    )?;

    let visible = disabled_custom
        .iter()
        .take(8)
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");
    let remaining = disabled_custom.len().saturating_sub(8);
    let suffix = if remaining > 0 {
        format!("\n…and {} more.", remaining)
    } else {
        String::new()
    };

    let manager = app.state::<NotificationManager>();
    let _ = manager.create(CreateNotificationInput {
        client_key: Some(format!("modpack_override_conflicts_{}", instance_id)),
        title: Some("Modpack versions restored".to_string()),
        description: Some(format!(
            "A modpack update supplied active versions for matching custom overrides, so Vesta disabled the custom copies:\n{}{}",
            visible, suffix
        )),
        severity: Some("info".to_string()),
        notification_type: Some(NotificationType::Patient),
        dismissible: Some(true),
        persist: Some(true),
        ..Default::default()
    });

    Ok(())
}

async fn version_is_at_least(
    rm: &ResourceManager,
    platform: SourcePlatform,
    project_id: &str,
    pack_version_id: &str,
    custom_version_id: &str,
) -> bool {
    if pack_version_id == custom_version_id {
        return true;
    }

    let Ok(versions) = rm
        .get_versions(platform, project_id, true, None, None)
        .await
    else {
        return true;
    };

    let pack_index = versions
        .iter()
        .position(|version| String::from(&version.id) == pack_version_id);
    let custom_index = versions
        .iter()
        .position(|version| String::from(&version.id) == custom_version_id);

    match (pack_index, custom_index) {
        (Some(pack), Some(custom)) => pack <= custom,
        _ => true,
    }
}
