use crate::resources::ResourceWatcher;
use crate::schema::instance::dsl::instance;
use crate::tasks::manager::{Task, TaskContext};
use crate::utils::db::get_vesta_conn;
use diesel::prelude::*;
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::Manager;

pub struct ImportResourceResyncTask {
    pub instance_id: i32,
    pub instance_name: String,
    pub target_game_directory: String,
}

impl ImportResourceResyncTask {
    pub fn new(instance_id: i32, instance_name: String, target_game_directory: String) -> Self {
        Self {
            instance_id,
            instance_name,
            target_game_directory,
        }
    }
}

impl Task for ImportResourceResyncTask {
    fn name(&self) -> String {
        format!("Resync imported resources for {}", self.instance_name)
    }

    fn id(&self) -> Option<String> {
        Some(format!("import_resync_instance_{}", self.instance_id))
    }

    fn cancellable(&self) -> bool {
        true
    }

    fn show_completion_notification(&self) -> bool {
        false
    }

    fn starting_description(&self) -> String {
        format!("Starting resource resync for {}...", self.instance_name)
    }

    fn completion_description(&self) -> String {
        format!("Resync completed for {}", self.instance_name)
    }

    fn run(&self, ctx: TaskContext) -> futures::future::BoxFuture<'static, Result<(), String>> {
        let instance_id = self.instance_id;
        let target_dir = self.target_game_directory.clone();
        let app_handle = ctx.app_handle.clone();

        Box::pin(async move {
            log::info!(
                "[external_import_resync] start instance_id={} target={}",
                instance_id,
                target_dir
            );

            if *ctx.cancel_rx.borrow() {
                return Err("Resync cancelled".to_string());
            }

            let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
            let target_instance = instance
                .find(instance_id)
                .first::<crate::models::instance::Instance>(&mut conn)
                .map_err(|e| format!("Failed to load instance for resync: {e}"))?;
            if target_instance.id <= 0 {
                return Err(format!(
                    "Cannot resync imported resources: instance {} no longer exists",
                    instance_id
                ));
            }

            if let Err(err) = seed_launcher_linkage_hints(
                &app_handle,
                &target_instance,
                &target_dir,
            )
            .await
            {
                log::warn!(
                    "[external_import_resync] launcher hint seeding skipped instance_id={} reason={}",
                    instance_id,
                    err
                );
            }

            let watcher = app_handle.state::<ResourceWatcher>();
            watcher
                .watch_instance_without_scan(instance_id, target_dir.clone())
                .await
                .map_err(|e| format!("Failed to start watcher before resync: {e}"))?;

            let (progress_tx, mut progress_rx) =
                tokio::sync::mpsc::unbounded_channel::<crate::resources::watcher::ScanProgressSnapshot>();
            let app_for_resync = app_handle.clone();
            let target_dir_for_refresh = target_dir.clone();
            let refresh_task = tauri::async_runtime::spawn(async move {
                let watcher = app_for_resync.state::<ResourceWatcher>();
                watcher
                    .refresh_instance_with_progress(
                        instance_id,
                        target_dir_for_refresh,
                        Some(progress_tx),
                    )
                    .await
            });

            let mut last_heartbeat = std::time::Instant::now();
            loop {
                tokio::select! {
                    maybe_progress = progress_rx.recv() => {
                        if let Some(progress) = maybe_progress {
                            let denom = progress.total.max(1);
                            let pct = ((progress.processed.saturating_mul(100)) / denom) as i32;
                            ctx.update_full(
                                pct.min(99),
                                format!(
                                    "Resyncing imported resources... [{}] {}/{} (skipped {}, failed {})",
                                    progress.folder,
                                    progress.processed,
                                    progress.total,
                                    progress.skipped,
                                    progress.failed
                                ),
                                Some(progress.processed as i32),
                                Some(progress.total as i32),
                            );
                        } else {
                            break;
                        }
                    }
                    _ = tokio::time::sleep(tokio::time::Duration::from_secs(3)) => {
                        if last_heartbeat.elapsed().as_secs() >= 3 {
                            ctx.update_description("Resyncing imported resources... still working".to_string());
                            last_heartbeat = std::time::Instant::now();
                        }
                    }
                }
            }

            let refresh_summary = refresh_task
                .await
                .map_err(|e| format!("Resync worker failed: {e}"))?
                .map_err(|e| format!("Resync failed: {e}"))?;
            log::info!(
                "[external_import_resync] done instance_id={} processed={} total={} failed={}",
                instance_id,
                refresh_summary.processed,
                refresh_summary.total,
                refresh_summary.failed
            );

            if *ctx.cancel_rx.borrow() {
                return Err("Resync cancelled".to_string());
            }

            ctx.update_progress(100, None, None);
            Ok(())
        })
    }
}

async fn seed_launcher_linkage_hints(
    app_handle: &tauri::AppHandle,
    inst: &crate::models::instance::Instance,
    target_dir: &str,
) -> Result<(), String> {
    let Some(launcher_kind) = inst.import_launcher_kind.as_deref() else {
        return Ok(());
    };
    let Some(source_instance_root) = inst.import_instance_path.as_deref() else {
        return Ok(());
    };

    let source_root = PathBuf::from(source_instance_root);
    if launcher_kind == "atlauncher" {
        normalize_atlauncher_disabledmods(target_dir)?;
    }

    let hints = collect_launcher_hints(launcher_kind, &source_root);
    log::info!(
        "[external_import_resync] hint-discovered instance_id={} launcher={} count={}",
        inst.id,
        launcher_kind,
        hints.len()
    );
    if hints.is_empty() {
        return Ok(());
    }

    let (seeded, skipped_missing_file) = apply_launcher_hints(app_handle, inst.id, target_dir, hints).await?;
    log::info!(
        "[external_import_resync] hint-applied instance_id={} seeded={} skipped_missing_file={}",
        inst.id,
        seeded,
        skipped_missing_file
    );

    Ok(())
}

#[derive(Debug, Clone)]
struct LocalHint {
    project_id: String,
    version_id: String,
    platform: crate::models::resource::SourcePlatform,
    file_name: Option<String>,
}

fn collect_launcher_hints(launcher_kind: &str, source_root: &PathBuf) -> Vec<LocalHint> {
    match launcher_kind {
        "curseforgeFlame" | "prism" | "multimc" => crate::launcher_import::providers::flame_metadata::extract_flame_resource_hints(source_root)
            .into_iter()
            .map(|hint| LocalHint {
                project_id: hint.project_id,
                version_id: hint.version_id,
                platform: crate::models::resource::SourcePlatform::CurseForge,
                file_name: hint.file_name,
            })
            .collect(),
        "modrinthApp" => {
            let launcher_root = resolve_modrinth_launcher_root(source_root);
            crate::launcher_import::providers::modrinth_app::extract_modrinth_resource_hints(
                &launcher_root,
                source_root,
            )
            .into_iter()
            .map(|hint| LocalHint {
                project_id: hint.project_id,
                version_id: hint.version_id,
                platform: crate::models::resource::SourcePlatform::Modrinth,
                file_name: hint.file_name,
            })
            .collect()
        }
        "gdlauncher" => {
            let launcher_root = resolve_gdlauncher_root(source_root);
            crate::launcher_import::providers::gdlauncher::extract_gdlauncher_resource_hints(
                &launcher_root,
                source_root,
            )
            .into_iter()
            .filter_map(|hint| {
                let platform = match hint.platform.as_str() {
                    "curseforge" => crate::models::resource::SourcePlatform::CurseForge,
                    "modrinth" => crate::models::resource::SourcePlatform::Modrinth,
                    _ => return None,
                };
                Some(LocalHint {
                    project_id: hint.project_id,
                    version_id: hint.version_id,
                    platform,
                    file_name: hint.file_name,
                })
            })
            .collect()
        }
        "atlauncher" => crate::launcher_import::providers::atlauncher::extract_atlauncher_resource_hints(source_root)
            .into_iter()
            .filter_map(|hint| {
                let platform = match hint.platform.as_str() {
                    "curseforge" => crate::models::resource::SourcePlatform::CurseForge,
                    "modrinth" => crate::models::resource::SourcePlatform::Modrinth,
                    _ => return None,
                };
                Some(LocalHint {
                    project_id: hint.project_id,
                    version_id: hint.version_id,
                    platform,
                    file_name: hint.file_name,
                })
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn resolve_modrinth_launcher_root(source_root: &PathBuf) -> PathBuf {
    if source_root.ends_with("profiles") {
        return source_root
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| source_root.clone());
    }
    if source_root
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("profiles"))
        .unwrap_or(false)
    {
        return source_root
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| source_root.clone());
    }
    source_root.clone()
}

fn resolve_gdlauncher_root(source_root: &PathBuf) -> PathBuf {
    if source_root.ends_with("instances") {
        return source_root
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| source_root.clone());
    }
    if source_root
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("instances"))
        .unwrap_or(false)
    {
        return source_root
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| source_root.clone());
    }
    source_root.clone()
}

async fn apply_launcher_hints(
    app_handle: &tauri::AppHandle,
    instance_id: i32,
    target_dir: &str,
    hints: Vec<LocalHint>,
) -> Result<(usize, usize), String> {
    let resource_manager = app_handle.state::<crate::resources::ResourceManager>();
    let mut seen_pairs = HashSet::new();
    let mut seeded = 0usize;
    let mut skipped_missing_file = 0usize;

    for hint in hints {
        let key = format!("{:?}:{}:{}", hint.platform, hint.project_id, hint.version_id);
        if !seen_pairs.insert(key) {
            continue;
        }
        let Some(file_name) = hint.file_name else {
            continue;
        };
        let local_path = PathBuf::from(target_dir).join("mods").join(file_name);
        if !local_path.exists() {
            skipped_missing_file += 1;
            continue;
        }

        let project = resource_manager
            .get_project(hint.platform, &hint.project_id)
            .await
            .map_err(|e| format!("Failed to load hinted project {}: {}", hint.project_id, e))?;
        let version = resource_manager
            .get_version(hint.platform, &hint.project_id, &hint.version_id)
            .await
            .map_err(|e| format!("Failed to load hinted version {}: {}", hint.version_id, e))?;

        let meta = std::fs::metadata(&local_path)
            .map_err(|e| format!("Failed to stat hinted file {:?}: {}", local_path, e))?;
        let file_size = meta.len() as i64;
        let file_mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let hash = crate::utils::hash::calculate_sha1(&local_path).ok();

        crate::resources::watcher::link_resource_to_db(
            app_handle,
            instance_id,
            &local_path,
            project,
            version,
            hint.platform,
            hash,
            (file_size, file_mtime),
        )
        .await
        .map_err(|e| format!("Failed to seed hinted linkage for {:?}: {}", local_path, e))?;
        seeded += 1;
    }

    Ok((seeded, skipped_missing_file))
}

fn normalize_atlauncher_disabledmods(target_dir: &str) -> Result<(), String> {
    let game_dir = PathBuf::from(target_dir);
    let disabled_dir = game_dir.join("disabledmods");
    if !disabled_dir.is_dir() {
        return Ok(());
    }
    let mods_dir = game_dir.join("mods");
    std::fs::create_dir_all(&mods_dir)
        .map_err(|e| format!("Failed to create mods dir for AT normalization: {}", e))?;

    let entries = std::fs::read_dir(&disabled_dir)
        .map_err(|e| format!("Failed to read disabledmods dir: {}", e))?;
    for entry in entries.flatten() {
        let src_path = entry.path();
        if !src_path.is_file() {
            continue;
        }
        let file_name = src_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("resource")
            .to_string();
        let dst_name = if file_name.ends_with(".disabled") {
            file_name
        } else {
            format!("{}.disabled", file_name)
        };
        let dst_path = mods_dir.join(dst_name);
        if dst_path.exists() {
            continue;
        }
        if let Err(rename_err) = std::fs::rename(&src_path, &dst_path) {
            // Cross-device or permission edge cases fallback to copy+remove.
            std::fs::copy(&src_path, &dst_path).map_err(|e| {
                format!(
                    "Failed to normalize disabled mod {:?}: rename={} copy={}",
                    src_path, rename_err, e
                )
            })?;
            let _ = std::fs::remove_file(&src_path);
        }
    }
    Ok(())
}
