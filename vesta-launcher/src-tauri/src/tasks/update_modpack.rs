use std::path::PathBuf;
use std::sync::Arc;

use crate::models::SourcePlatform;
use crate::resources::ResourceManager;
use crate::tasks::manager::{Task, TaskContext};
use piston_lib::game::modpack::manifest::ModpackManifest;
use crate::tasks::installers::modpack::{
    enrich_manifest_platform_hashes, spawn_manifest_resource_linking,
};
use piston_lib::game::modpack::types::ModpackFormat;
use piston_lib::game::modpack::parser::{
    read_zip_override_entry, read_zip_override_text,
};
use tauri::Manager;
use tokio::sync::RwLock;

use crate::sync::differ::ThreeWayDiffer;
use crate::sync::manifest;
use crate::sync::merger::{merge_config, MergeResult};
use crate::sync::safeguards;
use crate::sync::staging::StagingDir;
use crate::sync::action_tree::{FileSource, SyncAction};

pub struct UpdateModpackTask {
    pub instance_id: i32,
    pub new_version_id: String,
}

impl UpdateModpackTask {
    pub fn new(instance_id: i32, new_version_id: String) -> Self {
        Self {
            instance_id,
            new_version_id,
        }
    }
}

impl Task for UpdateModpackTask {
    fn name(&self) -> String {
        "Updating Modpack".to_string()
    }

    fn id(&self) -> Option<String> {
        Some(format!("update_modpack_{}", self.instance_id))
    }

    fn cancellable(&self) -> bool {
        true
    }

    fn show_completion_notification(&self) -> bool {
        true
    }

    fn starting_description(&self) -> String {
        "Preparing modpack update...".to_string()
    }

    fn completion_description(&self) -> String {
        "Modpack updated successfully".to_string()
    }

    fn run(&self, ctx: TaskContext) -> futures::future::BoxFuture<'static, Result<(), String>> {
        let instance_id = self.instance_id;
        let new_version_id = self.new_version_id.clone();
        let app_handle = ctx.app_handle.clone();

        Box::pin(async move {
            // ─── Load instance ───────────────────────────────────────────
            let mut conn =
                crate::utils::db::get_vesta_conn().map_err(|e| format!("DB error: {}", e))?;
            use crate::schema::instance::dsl::*;
            use diesel::prelude::*;

            let inst: crate::models::instance::Instance = instance
                .find(instance_id)
                .first(&mut conn)
                .map_err(|e| format!("Instance not found: {}", e))?;

            let config_dir =
                crate::utils::db_manager::get_app_config_dir().map_err(|e| e.to_string())?;
            let data_dir = config_dir.join("data");
            let game_dir = inst
                .game_directory
                .as_ref()
                .map(PathBuf::from)
                .unwrap_or_else(|| data_dir.join("instances").join(&inst.slug()));

            // ─── Safeguard: ensure Minecraft is not running ──────────────
            ctx.update_description("Checking that Minecraft is not running...".to_string());
            if let Err(e) = safeguards::check_instance_not_running(&game_dir) {
                return Err(format!("{}", e));
            }

            // ─── Phase 1: Manifest Fetch & Differential Audit ────────────
            ctx.update_full(5, "Loading old manifest...".to_string(), Some(0), Some(6));
            let mut old_manifest = manifest::load_old_manifest(&game_dir)
                .map_err(|e| format!("Cannot update: no modpack manifest found. {}", e))?;
            manifest::backfill_manifest_hashes(&mut old_manifest, &game_dir, instance_id)
                .map_err(|e| format!("Failed to backfill old manifest hashes: {}", e))?;

            ctx.update_full(
                10,
                "Fetching new modpack version...".to_string(),
                Some(0),
                Some(6),
            );
            let (new_manifest, zip_path) =
                fetch_new_manifest(&app_handle, &inst, &new_version_id).await?;
            let modpack_format = new_manifest.source;

            ctx.update_full(
                15,
                "Scanning current files...".to_string(),
                Some(0),
                Some(6),
            );
            let current_hashes = manifest::hash_current_directory(&game_dir, &old_manifest);

            ctx.update_full(
                20,
                "Computing update plan (three-way diff)...".to_string(),
                Some(0),
                Some(6),
            );
            let mut action_tree =
                ThreeWayDiffer::diff(&old_manifest, &current_hashes, &new_manifest);

            let total_actions = action_tree.actionable_count();
            log::info!(
                "[UpdateModpackTask] Action plan: {} actions, {} protected, {} world collisions, {} corrupted",
                total_actions,
                action_tree.protected_count,
                action_tree.world_collisions.len(),
                action_tree.corrupted_configs.len(),
            );

            if action_tree.is_empty() && total_actions == 0 {
                // No changes needed — just update the version metadata
                ctx.update_full(100, "Modpack is already up to date.".to_string(), Some(6), Some(6));
                finish_update(&app_handle, &inst, &new_manifest, &new_version_id, &game_dir, &zip_path)
                    .await?;
                return Ok(());
            }

            // ─── Phase 2: Conflict & Preservation Evaluation ─────────────
            ctx.update_full(
                25,
                "Evaluating conflicts and merging configs...".to_string(),
                Some(1),
                Some(6),
            );

            // Resolve Merge actions — compare old/current/new file contents
            resolve_merges(
                &mut action_tree,
                &game_dir,
                &old_manifest,
                &zip_path,
                modpack_format,
            );

            // ─── Phase 3: Staged Isolation Download ──────────────────────
            ctx.update_full(
                30,
                "Preparing update staging area...".to_string(),
                Some(2),
                Some(6),
            );
            let staging = StagingDir::new(&game_dir).map_err(|e| e.to_string())?;

            let staged_count = Arc::new(RwLock::new(0usize));
            // Download and stage all NEW and UPDATE actions
            let download_count = action_tree
                .actions
                .iter()
                .filter(|a| matches!(a, SyncAction::Add { .. } | SyncAction::Update { .. }))
                .count();

            for action in &action_tree.actions {
                if *ctx.cancel_rx.borrow() {
                    staging.rollback();
                    return Err("Update cancelled".to_string());
                }

                match action {
                    SyncAction::Add { path, source, .. }
                    | SyncAction::Update { path, source, .. } => {
                        let mut count = staged_count.write().await;
                        *count += 1;
                        let progress = 30 + ((*count as f64 / download_count.max(1) as f64) * 30.0) as i32;
                        ctx.update_full(
                            progress,
                            format!("Downloading: {}", path),
                            Some(2),
                            Some(6),
                        );

                        if let Err(e) = stage_file(
                            &app_handle,
                            source,
                            path,
                            &staging,
                            &game_dir,
                            &zip_path,
                            modpack_format,
                        )
                        .await
                        {
                            log::error!("[UpdateModpackTask] Failed to stage {}: {}", path, e);
                            staging.rollback();
                            return Err(format!("Failed to download {}: {}", path, e));
                        }
                    }
                    SyncAction::Merge { path, merged_content, .. } => {
                        let mut count = staged_count.write().await;
                        *count += 1;
                        let progress = 30 + ((*count as f64 / download_count.max(1) as f64) * 30.0) as i32;
                        ctx.update_full(
                            progress,
                            format!("Staging merged config: {}", path),
                            Some(2),
                            Some(6),
                        );

                        staging
                            .write_staged(path, merged_content.as_bytes())
                            .map_err(|e| format!("Failed to stage merged config {}: {}", path, e))?;
                    }
                    _ => {}
                }
            }

            // ─── Phase 4: Safety Quarantines ─────────────────────────────
            ctx.update_full(
                65,
                "Preserving existing world saves...".to_string(),
                Some(3),
                Some(6),
            );
            let mut quarantine_count = 0u32;
            for (original, quarantine) in &action_tree.world_collisions {
                if let Err(e) =
                    safeguards::rotate_world_save(&game_dir, original, quarantine)
                {
                    log::error!(
                        "[UpdateModpackTask] Failed to rotate world {}: {}",
                        original,
                        e
                    );
                } else {
                    quarantine_count += 1;
                }
            }
            if quarantine_count > 0 {
                log::info!(
                    "[UpdateModpackTask] Rotated {} world save(s) to quarantine",
                    quarantine_count
                );
            }

            // Handle corrupted configs
            for config_path in &action_tree.corrupted_configs {
                let _ = safeguards::quarantine_corrupted_config(&game_dir, config_path);
            }

            // ─── Phase 5: Deletion Sweep ─────────────────────────────────
            ctx.update_full(
                70,
                "Cleaning up removed files...".to_string(),
                Some(4),
                Some(6),
            );
            let mut deleted_count = 0u32;
            let mut skipped_delete = 0u32;
            for action in &action_tree.actions {
                if let SyncAction::Remove {
                    path,
                    last_hash, ..
                } = action
                {
                    match safeguards::safe_delete_if_unchanged(
                        &game_dir,
                        path,
                        last_hash.as_deref(),
                    ) {
                        Ok(true) => deleted_count += 1,
                        Ok(false) => skipped_delete += 1,
                        Err(e) => log::warn!(
                            "[UpdateModpackTask] Failed to delete {}: {}",
                            path,
                            e
                        ),
                    }
                }
            }
            log::info!(
                "[UpdateModpackTask] Deleted {} files, skipped {} (user-modified)",
                deleted_count,
                skipped_delete
            );

            // ─── Phase 6: Atomic Swap & Manifest Write ───────────────────
            ctx.update_full(
                80,
                "Applying update (atomic swap)...".to_string(),
                Some(5),
                Some(6),
            );
            staging.commit().map_err(|e| {
                format!("Failed to commit update: {}. Your game directory is unchanged.", e)
            })?;

            ctx.update_full(
                90,
                "Saving manifest and finalizing...".to_string(),
                Some(5),
                Some(6),
            );
            finish_update(
                &app_handle,
                &inst,
                &new_manifest,
                &new_version_id,
                &game_dir,
                &zip_path,
            )
            .await?;

            let skipped_msg = if skipped_delete > 0 {
                format!(
                    " ({} user-modified files were kept)",
                    skipped_delete
                )
            } else {
                String::new()
            };
            let world_msg = if quarantine_count > 0 {
                format!(
                    " {} world save(s) were preserved in timestamped folders.",
                    quarantine_count
                )
            } else {
                String::new()
            };

            ctx.update_full(
                100,
                format!(
                    "Modpack updated to version {} successfully.{}{}",
                    new_manifest.version, skipped_msg, world_msg
                ),
                Some(6),
                Some(6),
            );

            Ok(())
        })
    }
}

/// Fetch the new modpack version ZIP and build the new manifest ($N$).
async fn fetch_new_manifest(
    app_handle: &tauri::AppHandle,
    inst: &crate::models::instance::Instance,
    new_version_id: &str,
) -> Result<(ModpackManifest, PathBuf), String> {
    let resource_manager = app_handle.state::<ResourceManager>();
    let platform = match inst.modpack_platform.as_deref() {
        Some("modrinth") => SourcePlatform::Modrinth,
        _ => SourcePlatform::CurseForge,
    };
    let project_id = inst
        .modpack_id
        .as_deref()
        .ok_or("Instance is not linked to a modpack")?;

    // Fetch version metadata to get the download URL
    let version = resource_manager
        .get_version(platform, project_id, new_version_id)
        .await
        .map_err(|e| format!("Failed to fetch modpack version info: {}", e))?;

    // Download the ZIP to a persistent cache location
    let modpacks_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("modpacks");
    let _ = std::fs::create_dir_all(&modpacks_dir);

    let file_stem = format!("{}-{}", project_id, new_version_id)
        .replace(|c: char| !c.is_ascii_alphanumeric() && c != '-', "_");
    let zip_path = modpacks_dir.join(format!("{}.zip", file_stem));

    // Download if not already cached
    if !zip_path.exists() {
        use reqwest::Url;

        let client = reqwest::Client::builder()
            .user_agent("VestaLauncher/0.1.0")
            .build()
            .map_err(|e| e.to_string())?;

        let url = Url::parse(&version.download_url)
            .map_err(|e| format!("Invalid download URL: {}", e))?;

        let response = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Download failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!(
                "Failed to download modpack: HTTP {}",
                response.status()
            ));
        }

        let data = response
            .bytes()
            .await
            .map_err(|e| format!("Download read failed: {}", e))?;

        // Verify SHA1 if available
        if !version.hash.is_empty() {
            let actual = crate::utils::hash::calculate_sha1_from_bytes(&data);
            if actual.to_lowercase() != version.hash.to_lowercase() {
                return Err(format!(
                    "Modpack ZIP hash mismatch: expected {}, got {}",
                    version.hash, actual
                ));
            }
        }

        std::fs::write(&zip_path, &data)
            .map_err(|e| format!("Failed to write modpack ZIP: {}", e))?;
    }

    // Parse and build the new manifest
    let mut new_manifest = manifest::build_new_manifest(&zip_path, inst.modpack_id.clone())
        .map_err(|e| format!("Failed to parse new modpack manifest: {}", e))?;
    enrich_manifest_platform_hashes(app_handle, &mut new_manifest).await;

    Ok((new_manifest, zip_path))
}

/// Resolve all Merge actions by loading file contents and running the config merger.
fn resolve_merges(
    action_tree: &mut crate::sync::action_tree::ActionTree,
    game_dir: &std::path::Path,
    old_manifest: &ModpackManifest,
    new_zip_path: &std::path::Path,
    new_format: ModpackFormat,
) {
    let old_format = old_manifest.source;
    let old_zip_path = old_manifest.source_zip_path.as_deref();

    let mut corrupted_paths: Vec<String> = Vec::new();
    let mut merge_updates: Vec<(usize, String)> = Vec::new();
    let mut unsupported_paths: Vec<String> = Vec::new();

    for (i, action) in action_tree.actions.iter().enumerate() {
        if let SyncAction::Merge { path, .. } = action {
            let current_content = std::fs::read_to_string(game_dir.join(path)).ok();

            let new_content = read_zip_override_text(new_zip_path, new_format, path).ok();
            let old_content = old_zip_path.and_then(|zip| {
                read_zip_override_text(zip, old_format, path).ok()
            });

            if new_content.is_none() {
                log::warn!(
                    "[UpdateModpackTask] Cannot merge {}: new version content missing from ZIP",
                    path
                );
                unsupported_paths.push(path.clone());
                continue;
            }

            if old_content.is_none() {
                log::warn!(
                    "[UpdateModpackTask] Cannot merge {}: old version ZIP unavailable — preserving user file",
                    path
                );
                unsupported_paths.push(path.clone());
                continue;
            }

            let result = merge_config(
                path,
                old_content.as_deref(),
                current_content.as_deref(),
                new_content.as_deref(),
            );

            match result {
                MergeResult::Merged(content) => {
                    merge_updates.push((i, content));
                }
                MergeResult::Corrupted(reason) => {
                    log::warn!(
                        "[UpdateModpackTask] Config {} is corrupted: {} — quarantining",
                        path,
                        reason
                    );
                    corrupted_paths.push(path.clone());
                }
                MergeResult::Unsupported => {
                    log::info!(
                        "[UpdateModpackTask] Config {} format not supported for merging — using fallback",
                        path
                    );
                    unsupported_paths.push(path.clone());
                }
            }
        }
    }

    // Apply merge results after collecting (avoids borrow conflicts)
    for (i, content) in merge_updates {
        if let Some(action) = action_tree.actions.get_mut(i) {
            if let SyncAction::Merge {
                path,
                merged_content,
                ..
            } = action
            {
                *merged_content = content;
                let _ = path;
            }
        }
    }

    // Remove merge actions that could not be resolved safely
    action_tree.actions.retain(|action| {
        if let SyncAction::Merge { path, .. } = action {
            !unsupported_paths.contains(path)
        } else {
            true
        }
    });

    // Add corrupted configs
    for path in corrupted_paths {
        action_tree.add_corrupted_config(path);
    }
}

/// Stage a file: download from platform or extract from ZIP.
async fn stage_file(
    app_handle: &tauri::AppHandle,
    source: &FileSource,
    path: &str,
    staging: &StagingDir,
    _game_dir: &std::path::Path,
    zip_path: &std::path::Path,
    modpack_format: ModpackFormat,
) -> Result<(), String> {
    crate::sync::paths::validate_staged_relative_path(path).map_err(|e| e.to_string())?;

    match source {
        FileSource::Modrinth { url, sha1, filename: _ } => {
            if url.is_empty() {
                return Err("Empty Modrinth download URL".to_string());
            }
            let data = download_bytes(url, sha1.as_deref()).await?;
            staging
                .write_staged(path, &data)
                .map_err(|e| e.to_string())?;
        }
        FileSource::CurseForge {
            url,
            project_id,
            file_id,
            subfolder: _,
            sha1,
            ..
        } => {
            let rm = app_handle.state::<ResourceManager>();
            let (download_url, verify_sha1) = if url.is_empty() {
                let pid = project_id.map(|p| p.to_string()).unwrap_or_default();
                let version = rm
                    .get_version(SourcePlatform::CurseForge, &pid, &file_id.to_string())
                    .await
                    .map_err(|e| format!("Failed to resolve CurseForge URL: {}", e))?;
                let verify = sha1.clone().or_else(|| {
                    if version.hash.is_empty() {
                        None
                    } else {
                        Some(version.hash.clone())
                    }
                });
                (version.download_url, verify)
            } else {
                (url.clone(), sha1.clone())
            };

            let data = download_bytes(&download_url, verify_sha1.as_deref()).await?;
            staging
                .write_staged(path, &data)
                .map_err(|e| e.to_string())?;
        }
        FileSource::ZipOverride { zip_entry: _ } => {
            let data = read_zip_override_entry(zip_path, modpack_format, path)
                .map_err(|e| format!("Failed to extract override {} from ZIP: {}", path, e))?;
            staging
                .write_staged(path, &data)
                .map_err(|e| e.to_string())?;
        }
        FileSource::Generated => {
            // Content is generated in-memory (e.g., merged configs)
            // Already handled by the Merge action
        }
    }
    Ok(())
}

/// Download a file's bytes from a URL with optional SHA1 verification.
async fn download_bytes(url: &str, expected_sha1: Option<&str>) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .user_agent("VestaLauncher/0.1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download returned status {}", response.status()));
    }

    let data = response
        .bytes()
        .await
        .map_err(|e| format!("Download read failed: {}", e))?;

    // Verify SHA1 if expected
    if let Some(expected) = expected_sha1 {
        let actual = crate::utils::hash::calculate_sha1_from_bytes(&data);
        if actual.to_lowercase() != expected.to_lowercase() {
            return Err(format!(
                "SHA1 mismatch for download: expected {}, got {}",
                expected,
                actual
            ));
        }
    }

    Ok(data.to_vec())
}

/// Finalize the update: persist manifest, update DB, emit events.
async fn finish_update(
    app_handle: &tauri::AppHandle,
    inst: &crate::models::instance::Instance,
    new_manifest: &ModpackManifest,
    new_version_id: &str,
    game_dir: &std::path::Path,
    source_zip_path: &std::path::Path,
) -> Result<(), String> {
    // Persist the new manifest as $O$ for next update
    // Update the installed_at timestamp to now
    let mut manifest = new_manifest.clone();
    manifest.installed_at = chrono::Utc::now().to_rfc3339();
    manifest.source_zip_path = Some(source_zip_path.to_path_buf());
    manifest::backfill_manifest_hashes(&mut manifest, game_dir, inst.id)
        .map_err(|e| format!("Failed to backfill manifest hashes: {}", e))?;
    manifest
        .persist(game_dir)
        .map_err(|e| format!("Failed to persist manifest: {}", e))?;

    spawn_manifest_resource_linking(app_handle, inst.id, game_dir, &manifest);

    // Update the database
    let mut conn = crate::utils::db::get_vesta_conn().map_err(|e| e.to_string())?;
    use crate::schema::instance::dsl as inst_dsl;
    use diesel::prelude::*;

    diesel::update(inst_dsl::instance.filter(inst_dsl::id.eq(inst.id)))
        .set((
            inst_dsl::modpack_version_id.eq(Some(new_version_id.to_string())),
            inst_dsl::installation_status.eq(Some("installed".to_string())),
        ))
        .execute(&mut conn)
        .map_err(|e| format!("Failed to update instance: {}", e))?;

    // Emit update event
    let updated: crate::models::instance::Instance = inst_dsl::instance
        .find(inst.id)
        .first(&mut conn)
        .map_err(|e| format!("Failed to fetch updated instance: {}", e))?;

    use tauri::Emitter;
    let _ = app_handle.emit("core://instance-installed", updated);

    log::info!(
        "[UpdateModpackTask] Update complete: {} → {}",
        inst.modpack_version_id.as_deref().unwrap_or("?"),
        new_version_id
    );

    Ok(())
}
