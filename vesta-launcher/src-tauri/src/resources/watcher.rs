use crate::models::installed_resource::InstalledResource;
use crate::models::resource::SourcePlatform;
pub use crate::resources::ledger::ResourceProvenance;
use crate::schema::installed_resource::dsl as ir_dsl;
use anyhow::Result;
use notify::{Config, Event, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
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

        let overflowed = Arc::new(AtomicBool::new(false));
        let queue_overflowed = overflowed.clone();
        let mut watcher = notify::RecommendedWatcher::new(
            move |res: notify::Result<Event>| {
                if let Ok(event) = res {
                    if tx.try_send(event).is_err() {
                        queue_overflowed.store(true, Ordering::Release);
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
                let deadline = tokio::time::Instant::now() + Duration::from_millis(180);
                while let Ok(Some(event)) = tokio::time::timeout_at(deadline, rx.recv()).await {
                    events.push(event);
                }
                // Check if still watched before handling
                let is_watched = {
                    let w = watchers_ptr.lock().await;
                    w.contains_key(&db_id)
                };
                if is_watched {
                    let missed_events = overflowed.swap(false, Ordering::AcqRel);
                    let topology_changed = handle_events(&app_handle, db_id, events).await;
                    if missed_events {
                        if let Err(error) = app_handle
                            .state::<ResourceWatcher>()
                            .refresh_instance(db_id, game_path.to_string_lossy().into_owned())
                            .await
                        {
                            log::warn!("[ResourceWatcher] Overflow reconciliation failed: {error}");
                        }
                    }
                    if topology_changed || missed_events {
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

pub async fn resolve_modpack_override_conflicts(app: &AppHandle, instance_id: i32) -> Result<()> {
    resolve_override_conflicts(app, instance_id, false)
}

/// Version switches also reconsider disabled bundled copies. Ordinary scans respect
/// an explicitly disabled pack copy so users can opt into a custom replacement.
pub fn resolve_override_conflicts(
    app: &AppHandle,
    instance_id: i32,
    pack_switched: bool,
) -> Result<()> {
    use crate::notifications::manager::NotificationManager;
    use crate::notifications::models::{CreateNotificationInput, NotificationType};
    use crate::utils::db::get_vesta_conn;
    use diesel::prelude::*;

    let pruned_missing = crate::resources::ledger::remove_missing(instance_id)?;
    let resources = {
        let mut conn = get_vesta_conn()?;
        ir_dsl::installed_resource
            .filter(ir_dsl::instance_id.eq(instance_id))
            .filter(ir_dsl::resource_type.eq("mod"))
            .load::<InstalledResource>(&mut conn)?
    };

    let mut groups: Vec<Vec<InstalledResource>> = Vec::new();
    let enabled = resources
        .iter()
        .filter(|resource| conflict_candidate_enabled(resource, pack_switched))
        .cloned()
        .collect::<Vec<_>>();

    for bundled in enabled
        .iter()
        .filter(|resource| resource.source_kind == "modpack")
    {
        let mut group = Vec::new();
        for candidate in &enabled {
            let peer_matches = cross_provider_peer_matches(bundled, candidate)?;
            if duplicate_candidate(bundled, candidate, peer_matches) {
                group.push(candidate.clone());
            }
        }
        if group
            .iter()
            .any(|resource| resource.source_kind != "modpack")
        {
            let overlapping = groups.iter().position(|existing| {
                existing
                    .iter()
                    .any(|left| group.iter().any(|right| left.id == right.id))
            });
            if let Some(index) = overlapping {
                for resource in group {
                    if !groups[index]
                        .iter()
                        .any(|current| current.id == resource.id)
                    {
                        groups[index].push(resource);
                    }
                }
            } else {
                groups.push(group);
            }
        }
    }

    let mut to_disable: Vec<(InstalledResource, InstalledResource)> = Vec::new();
    for group in groups {
        let winner_id = choose_duplicate_winner(&group);
        let Some(winner) = group
            .iter()
            .find(|resource| resource.id == winner_id)
            .cloned()
        else {
            continue;
        };
        if !winner.is_enabled {
            crate::resources::ledger::set_enabled(winner.id, true)?;
        }
        for loser in group
            .into_iter()
            .filter(|resource| resource.id != winner_id && resource.is_enabled)
        {
            if !to_disable.iter().any(|(queued, _)| queued.id == loser.id) {
                to_disable.push((loser, winner.clone()));
            }
        }
    }

    if to_disable.is_empty() {
        if pruned_missing > 0 {
            crate::resources::reconciliation::emit_rows_changed(
                app,
                instance_id,
                "missing-resource-rows-pruned",
            )?;
        }
        return Ok(());
    }

    let mut disabled: Vec<String> = Vec::new();
    for (loser, winner) in to_disable {
        let result = crate::resources::ledger::disable_resource(instance_id, loser.id)?;
        if result.disabled {
            disabled.push(format!(
                "{} ({} {} → {} {})",
                loser.display_name,
                owner_label(&loser),
                loser.current_version,
                owner_label(&winner),
                winner.current_version
            ));
        }
    }

    crate::resources::reconciliation::emit_rows_changed(
        app,
        instance_id,
        "override-conflicts-resolved",
    )?;

    if disabled.is_empty() {
        return Ok(());
    }

    let visible = disabled
        .iter()
        .take(8)
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");
    let remaining = disabled.len().saturating_sub(8);
    let suffix = if remaining > 0 {
        format!("\n…and {} more.", remaining)
    } else {
        String::new()
    };

    let manager = app.state::<NotificationManager>();
    let _ = manager.create(CreateNotificationInput {
        client_key: Some(format!("modpack_override_conflicts_{}", instance_id)),
        title: Some("Duplicate mod versions resolved".to_string()),
        description: Some(format!(
            "Vesta kept the preferred copy of each duplicate and disabled the others:\n{}{}",
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

fn owner_label(resource: &InstalledResource) -> &'static str {
    if resource.source_kind == "modpack" {
        "bundled"
    } else {
        "custom"
    }
}

fn hashes_match(left: &InstalledResource, right: &InstalledResource) -> bool {
    left.hash.as_deref().is_some_and(|left_hash| {
        !left_hash.is_empty()
            && right
                .hash
                .as_deref()
                .is_some_and(|right_hash| left_hash.eq_ignore_ascii_case(right_hash))
    })
}

fn duplicate_candidate(
    left: &InstalledResource,
    right: &InstalledResource,
    peer_matches: bool,
) -> bool {
    let same_provider_project = !left.remote_id.is_empty()
        && left.platform == right.platform
        && left.remote_id == right.remote_id
        && SourcePlatform::from_str_id(&left.platform).is_some();
    same_provider_project || hashes_match(left, right) || peer_matches
}

fn cross_provider_peer_matches(
    left: &InstalledResource,
    right: &InstalledResource,
) -> Result<bool> {
    if left.platform == right.platform {
        return Ok(false);
    }
    let (Some(left_platform), Some(right_platform)) = (
        SourcePlatform::from_str_id(&left.platform),
        SourcePlatform::from_str_id(&right.platform),
    ) else {
        return Ok(false);
    };
    Ok(
        crate::resources::reconciliation::find_persisted_peer(left_platform, &left.remote_id)?
            .is_some_and(|(platform, project_id)| {
                platform == right_platform && project_id == right.remote_id
            }),
    )
}

fn conflict_candidate_enabled(resource: &InstalledResource, pack_switched: bool) -> bool {
    resource.is_enabled || (pack_switched && resource.source_kind == "modpack")
}

fn choose_duplicate_winner(resources: &[InstalledResource]) -> i32 {
    resources
        .iter()
        .filter(|resource| resource.source_kind == "modpack")
        .min_by_key(|resource| resource.id)
        .expect("duplicate groups always include a bundled resource")
        .id
}

#[cfg(test)]
mod world_datapack_event_tests {
    use super::{
        choose_duplicate_winner, conflict_candidate_enabled, duplicate_candidate,
        world_ref_for_datapack_path,
    };
    use crate::models::installed_resource::InstalledResource;
    use std::path::Path;

    fn resource(
        id: i32,
        platform: &str,
        project: &str,
        version: &str,
        source_kind: &str,
        hash: Option<&str>,
    ) -> InstalledResource {
        InstalledResource {
            id,
            instance_id: 1,
            platform: platform.to_string(),
            remote_id: project.to_string(),
            remote_version_id: version.to_string(),
            resource_type: "mod".to_string(),
            local_path: format!("/mods/{id}.jar"),
            display_name: format!("mod-{id}"),
            current_version: version.to_string(),
            is_manual: false,
            is_enabled: true,
            last_updated: String::new(),
            release_type: "release".to_string(),
            hash: hash.map(str::to_string),
            file_size: 1,
            file_mtime: 1,
            source_kind: source_kind.to_string(),
            source_modpack_id: None,
            source_modpack_version_id: None,
            source_modpack_platform: None,
        }
    }

    #[test]
    fn switch_reconsiders_disabled_pack_but_not_disabled_custom() {
        let mut bundled = resource(1, "modrinth", "project", "old", "modpack", None);
        let mut custom = resource(2, "modrinth", "project", "new", "custom", None);
        bundled.is_enabled = false;
        assert!(!conflict_candidate_enabled(&bundled, false));
        assert!(conflict_candidate_enabled(&bundled, true));
        assert!(conflict_candidate_enabled(&custom, true));
        assert_eq!(choose_duplicate_winner(&[custom.clone(), bundled]), 1);
        custom.is_enabled = false;
        assert!(!conflict_candidate_enabled(&custom, true));
    }

    #[test]
    fn selected_pack_wins_when_custom_is_older() {
        let bundled = resource(2, "modrinth", "project", "new", "modpack", None);
        let custom = resource(1, "modrinth", "project", "old", "custom", None);
        assert_eq!(choose_duplicate_winner(&[custom, bundled]), 2);
    }

    #[test]
    fn selected_pack_wins_even_when_custom_is_newer() {
        let bundled = resource(1, "modrinth", "project", "old", "modpack", None);
        let custom = resource(2, "modrinth", "project", "new", "custom", None);

        assert_eq!(choose_duplicate_winner(&[bundled, custom]), 1);
    }

    #[test]
    fn equal_or_unknown_versions_prefer_the_bundled_copy() {
        let bundled = resource(1, "modrinth", "project", "same", "modpack", None);
        let custom = resource(2, "modrinth", "project", "same", "custom", None);

        assert_eq!(
            choose_duplicate_winner(&[bundled.clone(), custom.clone()]),
            1
        );
        assert_eq!(choose_duplicate_winner(&[bundled, custom]), 1);
    }

    #[test]
    fn cross_provider_identity_uses_hash_or_peer_evidence_and_prefers_bundled() {
        let bundled = resource(
            1,
            "modrinth",
            "project-a",
            "a",
            "modpack",
            Some("same-hash"),
        );
        let identical = resource(
            2,
            "curseforge",
            "project-b",
            "b",
            "custom",
            Some("same-hash"),
        );
        let different = resource(
            3,
            "curseforge",
            "project-b",
            "c",
            "custom",
            Some("different"),
        );

        assert!(duplicate_candidate(&bundled, &identical, false));
        assert!(!duplicate_candidate(&bundled, &different, false));
        assert!(duplicate_candidate(&bundled, &different, true));
        assert_eq!(choose_duplicate_winner(&[bundled, identical]), 1);
    }

    #[test]
    fn unresolved_manual_rows_are_not_duplicates_without_hash_evidence() {
        let bundled = resource(1, "manual", "", "", "modpack", None);
        let custom = resource(2, "manual", "", "", "custom", None);
        let differently_hashed = resource(3, "manual", "", "", "custom", Some("different-hash"));

        assert!(!duplicate_candidate(&bundled, &custom, false));
        assert!(!duplicate_candidate(&bundled, &differently_hashed, false));
    }

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
