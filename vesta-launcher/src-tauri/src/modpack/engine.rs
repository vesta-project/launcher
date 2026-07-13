use std::path::{Path, PathBuf};

use crate::models::instance::Instance;
use crate::models::SourcePlatform;
use crate::resources::ResourceManager;
use crate::sync::action_tree::{ActionTree, FileSource, SkipReason, SyncAction};
use crate::sync::differ::ThreeWayDiffer;
use crate::sync::manifest;
use crate::sync::manifest_bootstrap::{self, TaskBootstrapProgress};
use crate::sync::merger::{merge_config, MergeResult};
use crate::sync::safeguards;
use crate::sync::staging::StagingDir;
use crate::tasks::installers::modpack::enrich_manifest_platform_hashes;
use crate::tasks::manager::TaskContext;
use piston_lib::game::modpack::manifest::ModpackManifest;
use piston_lib::game::modpack::parser::{read_zip_override_entry, read_zip_override_text};
use piston_lib::game::modpack::types::ModpackFormat;
use tauri::{Manager, State};

pub struct UpdatePlan {
    pub old_manifest: ModpackManifest,
    pub new_manifest: ModpackManifest,
    pub zip_path: PathBuf,
    pub format: ModpackFormat,
    pub actions: ActionTree,
}

pub struct ApplyOutcome {
    pub skipped_deletions: u32,
    pub preserved_worlds: u32,
}

pub async fn plan(
    app_handle: &tauri::AppHandle,
    instance: &Instance,
    game_dir: &Path,
    target_version_id: &str,
    ctx: &TaskContext,
) -> Result<UpdatePlan, String> {
    ctx.update_full(5, "Loading old manifest...".to_string(), Some(0), Some(6));
    let progress = TaskBootstrapProgress(ctx);
    let mut old_manifest =
        manifest_bootstrap::ensure_old_manifest(app_handle, instance, game_dir, Some(&progress))
            .await
            .map_err(|error| format!("Cannot update: no modpack manifest found. {}", error))?;
    manifest::backfill_manifest_hashes(&mut old_manifest, game_dir, instance.id)
        .map_err(|error| format!("Failed to backfill old manifest hashes: {}", error))?;

    ctx.update_full(
        10,
        "Fetching new modpack version...".to_string(),
        Some(0),
        Some(6),
    );
    let (new_manifest, zip_path) =
        fetch_target_manifest(app_handle, instance, target_version_id).await?;
    let format = new_manifest.source;

    ctx.update_full(
        15,
        "Scanning current files...".to_string(),
        Some(0),
        Some(6),
    );
    let current_hashes = manifest::hash_current_directory(game_dir, &old_manifest);

    ctx.update_full(
        20,
        "Computing update plan (three-way diff)...".to_string(),
        Some(0),
        Some(6),
    );
    let actions = ThreeWayDiffer::diff(&old_manifest, &current_hashes, &new_manifest);

    Ok(UpdatePlan {
        old_manifest,
        new_manifest,
        zip_path,
        format,
        actions,
    })
}

pub async fn apply(
    app_handle: &tauri::AppHandle,
    game_dir: &Path,
    plan: &mut UpdatePlan,
    ctx: &TaskContext,
) -> Result<ApplyOutcome, String> {
    ctx.update_full(
        25,
        "Evaluating conflicts and merging configs...".to_string(),
        Some(1),
        Some(6),
    );
    resolve_merges(
        &mut plan.actions,
        game_dir,
        &plan.old_manifest,
        &plan.zip_path,
        plan.format,
    );
    resolve_missing_zip_overrides(&mut plan.actions, game_dir, &plan.zip_path, plan.format);

    ctx.update_full(
        30,
        "Preparing update staging area...".to_string(),
        Some(2),
        Some(6),
    );
    let staging = StagingDir::new(game_dir).map_err(|error| error.to_string())?;
    let stage_count = plan
        .actions
        .actions
        .iter()
        .filter(|action| {
            matches!(
                action,
                SyncAction::Add { .. } | SyncAction::Update { .. } | SyncAction::Merge { .. }
            )
        })
        .count();
    let mut staged = 0usize;

    for action in &plan.actions.actions {
        if *ctx.cancel_rx.borrow() {
            staging.rollback();
            return Err("Update cancelled".to_string());
        }

        let stage_result = match action {
            SyncAction::Add { path, source, .. } | SyncAction::Update { path, source, .. } => {
                staged += 1;
                update_stage_progress(ctx, staged, stage_count, format!("Downloading: {}", path));
                stage_file(
                    app_handle,
                    source,
                    path,
                    &staging,
                    &plan.zip_path,
                    plan.format,
                )
                .await
                .map_err(|error| format!("Failed to download {}: {}", path, error))
            }
            SyncAction::Merge {
                path,
                merged_content,
                ..
            } => {
                staged += 1;
                update_stage_progress(
                    ctx,
                    staged,
                    stage_count,
                    format!("Staging merged config: {}", path),
                );
                staging
                    .write_staged(path, merged_content.as_bytes())
                    .map_err(|error| format!("Failed to stage merged config {}: {}", path, error))
            }
            _ => Ok(()),
        };

        if let Err(error) = stage_result {
            staging.rollback();
            return Err(error);
        }
    }

    ctx.update_full(
        65,
        "Preserving existing world saves...".to_string(),
        Some(3),
        Some(6),
    );
    let mut preserved_worlds = 0u32;
    for (original, quarantine) in &plan.actions.world_collisions {
        match safeguards::rotate_world_save(game_dir, original, quarantine) {
            Ok(()) => preserved_worlds += 1,
            Err(error) => log::error!(
                "[modpack-engine] Failed to rotate world {}: {}",
                original,
                error
            ),
        }
    }
    for config_path in &plan.actions.corrupted_configs {
        let _ = safeguards::quarantine_corrupted_config(game_dir, config_path);
    }

    ctx.update_full(
        70,
        "Cleaning up removed files...".to_string(),
        Some(4),
        Some(6),
    );
    let mut skipped_deletions = 0u32;
    for action in &plan.actions.actions {
        if let SyncAction::Remove {
            path, last_hash, ..
        } = action
        {
            match safeguards::safe_delete_if_unchanged(game_dir, path, last_hash.as_deref()) {
                Ok(true) => {}
                Ok(false) => skipped_deletions += 1,
                Err(error) => {
                    log::warn!("[modpack-engine] Failed to delete {}: {}", path, error)
                }
            }
        }
    }

    ctx.update_full(
        80,
        "Applying update (atomic swap)...".to_string(),
        Some(5),
        Some(6),
    );
    staging.commit().map_err(|error| {
        format!(
            "Failed to commit update: {}. Your game directory is unchanged.",
            error
        )
    })?;

    Ok(ApplyOutcome {
        skipped_deletions,
        preserved_worlds,
    })
}

fn update_stage_progress(ctx: &TaskContext, staged: usize, total: usize, message: String) {
    let progress = 30 + ((staged as f64 / total.max(1) as f64) * 30.0) as i32;
    ctx.update_full(progress, message, Some(2), Some(6));
}

fn resolve_merges(
    actions: &mut ActionTree,
    game_dir: &Path,
    old_manifest: &ModpackManifest,
    new_zip_path: &Path,
    new_format: ModpackFormat,
) {
    let old_format = old_manifest.source;
    let old_zip_path = old_manifest.source_zip_path.as_deref();
    let mut corrupted_paths = Vec::new();
    let mut merge_updates = Vec::new();
    let mut unsupported_paths = Vec::new();

    for (index, action) in actions.actions.iter().enumerate() {
        let SyncAction::Merge { path, .. } = action else {
            continue;
        };
        let current = std::fs::read_to_string(game_dir.join(path)).ok();
        let new = read_zip_override_text(new_zip_path, new_format, path).ok();
        let old = old_zip_path.and_then(|zip| read_zip_override_text(zip, old_format, path).ok());
        if new.is_none() || old.is_none() {
            unsupported_paths.push(path.clone());
            continue;
        }

        match merge_config(path, old.as_deref(), current.as_deref(), new.as_deref()) {
            MergeResult::Merged(content) => merge_updates.push((index, content)),
            MergeResult::Corrupted(reason) => {
                log::warn!("[modpack-engine] Config {} is corrupted: {}", path, reason);
                corrupted_paths.push(path.clone());
            }
            MergeResult::Unsupported => unsupported_paths.push(path.clone()),
        }
    }

    for (index, content) in merge_updates {
        if let Some(SyncAction::Merge { merged_content, .. }) = actions.actions.get_mut(index) {
            *merged_content = content;
        }
    }
    actions.actions.retain(|action| {
        !matches!(action, SyncAction::Merge { path, .. } if unsupported_paths.contains(path))
    });
    for path in corrupted_paths {
        actions.add_corrupted_config(path);
    }
}

fn resolve_missing_zip_overrides(
    actions: &mut ActionTree,
    game_dir: &Path,
    new_zip_path: &Path,
    new_format: ModpackFormat,
) {
    let mut preserved = 0usize;
    for action in &mut actions.actions {
        let (path, source) = match action {
            SyncAction::Add { path, source, .. } | SyncAction::Update { path, source, .. } => {
                (path.as_str(), source)
            }
            _ => continue,
        };
        let FileSource::ZipOverride { relative_path } = source else {
            continue;
        };
        if read_zip_override_entry(new_zip_path, new_format, relative_path).is_ok() {
            continue;
        }

        let preserved_path = path.to_string();
        if !game_dir.join(&preserved_path).is_file() {
            log::info!(
                "[modpack-engine] {} is absent from both ZIP and disk",
                preserved_path
            );
        }
        *action = SyncAction::Skip {
            path: preserved_path,
            reason: SkipReason::NotInNewVersionZip,
        };
        preserved += 1;
    }
    actions.protected_count += preserved;
}

async fn stage_file(
    app_handle: &tauri::AppHandle,
    source: &FileSource,
    path: &str,
    staging: &StagingDir,
    zip_path: &Path,
    format: ModpackFormat,
) -> Result<(), String> {
    crate::sync::paths::validate_staged_relative_path(path).map_err(|error| error.to_string())?;
    let data = match source {
        FileSource::Modrinth { url, sha1, .. } => {
            if url.is_empty() {
                return Err("Empty Modrinth download URL".to_string());
            }
            download_bytes(url, sha1.as_deref()).await?
        }
        FileSource::CurseForge {
            url,
            project_id,
            file_id,
            sha1,
            ..
        } => {
            let (download_url, expected_hash) = if url.is_empty() {
                let project_id = project_id.map(|id| id.to_string()).unwrap_or_default();
                let version = app_handle
                    .state::<ResourceManager>()
                    .get_version(
                        SourcePlatform::CurseForge,
                        &project_id,
                        &file_id.to_string(),
                    )
                    .await
                    .map_err(|error| format!("Failed to resolve CurseForge URL: {}", error))?;
                let hash = sha1
                    .clone()
                    .or_else(|| (!version.hash.is_empty()).then_some(version.hash.clone()));
                (version.download_url, hash)
            } else {
                (url.clone(), sha1.clone())
            };
            download_bytes(&download_url, expected_hash.as_deref()).await?
        }
        FileSource::ZipOverride { relative_path } => {
            match read_zip_override_entry(zip_path, format, relative_path) {
                Ok(data) => data,
                Err(error) => {
                    log::warn!(
                        "[modpack-engine] Override {} missing during staging: {}",
                        path,
                        error
                    );
                    return Ok(());
                }
            }
        }
    };
    staging
        .write_staged(path, &data)
        .map_err(|error| error.to_string())
}

async fn download_bytes(url: &str, expected_sha1: Option<&str>) -> Result<Vec<u8>, String> {
    let response = piston_lib::client::shared_client()
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Download failed: {}", error))?;
    if !response.status().is_success() {
        return Err(format!("Download returned status {}", response.status()));
    }
    let data = response
        .bytes()
        .await
        .map_err(|error| format!("Download read failed: {}", error))?;
    if let Some(expected) = expected_sha1 {
        let actual = crate::utils::hash::calculate_sha1_from_bytes(&data);
        if !actual.eq_ignore_ascii_case(expected) {
            return Err(format!(
                "SHA1 mismatch for download: expected {}, got {}",
                expected, actual
            ));
        }
    }
    Ok(data.to_vec())
}

async fn fetch_target_manifest(
    app_handle: &tauri::AppHandle,
    instance: &Instance,
    target_version_id: &str,
) -> Result<(ModpackManifest, PathBuf), String> {
    let resource_manager: State<'_, ResourceManager> = app_handle.state();
    let platform = match instance.modpack_platform.as_deref() {
        Some("modrinth") => SourcePlatform::Modrinth,
        _ => SourcePlatform::CurseForge,
    };
    let project_id = instance
        .modpack_id
        .as_deref()
        .ok_or("Instance is not linked to a modpack")?;
    let version = resource_manager
        .get_version(platform, project_id, target_version_id)
        .await
        .map_err(|error| format!("Failed to fetch modpack version info: {}", error))?;

    let modpacks_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("modpacks");
    let _ = std::fs::create_dir_all(&modpacks_dir);
    let file_stem = format!("{}-{}", project_id, target_version_id).replace(
        |character: char| !character.is_ascii_alphanumeric() && character != '-',
        "_",
    );
    let zip_path = modpacks_dir.join(format!("{}.zip", file_stem));

    if !zip_path.exists() {
        let url = reqwest::Url::parse(&version.download_url)
            .map_err(|error| format!("Invalid download URL: {}", error))?;
        let response = piston_lib::client::shared_client()
            .get(url)
            .send()
            .await
            .map_err(|error| format!("Download failed: {}", error))?;
        if !response.status().is_success() {
            return Err(format!(
                "Failed to download modpack: HTTP {}",
                response.status()
            ));
        }
        let data = response
            .bytes()
            .await
            .map_err(|error| format!("Download read failed: {}", error))?;
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
            .map_err(|error| format!("Failed to write modpack ZIP: {}", error))?;
    }

    let mut manifest = manifest::build_new_manifest(&zip_path, instance.modpack_id.clone())
        .map_err(|error| format!("Failed to parse new modpack manifest: {}", error))?;
    enrich_manifest_platform_hashes(app_handle, &mut manifest).await;
    Ok((manifest, zip_path))
}
