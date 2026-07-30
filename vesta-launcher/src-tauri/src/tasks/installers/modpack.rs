use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;

use crate::models::instance::Instance;
use crate::models::SourcePlatform;
use crate::notifications::models::PROGRESS_INDETERMINATE;
use crate::resources::ResourceManager;
use crate::tasks::installers::{ProgressReporter, TauriProgressReporter};
use crate::tasks::manager::{Task, TaskContext, TaskManager};
use crate::tasks::resource_reconciliation::ResourceEnrichmentTask;

use anyhow::Result;
use piston_lib::game::installer::core::modpack_installer::{
    ModpackInstaller, ModpackResolvedCF, ModpackResolvedModrinth, ModpackResolver,
};
use tokio::fs;

#[derive(Clone)]
pub enum ModpackSource {
    Path(PathBuf),
    Url(String),
}

pub struct InstallModpackTask {
    instance: Instance,
    source: ModpackSource,
    metadata: Option<piston_lib::game::modpack::types::ModpackMetadata>,
}

pub(crate) struct PistonModpackResolver {
    app_handle: tauri::AppHandle,
    cf_cache: Arc<RwLock<HashMap<String, CachedCurseForgeResolution>>>,
}

impl PistonModpackResolver {
    pub(crate) fn new(app_handle: tauri::AppHandle) -> Self {
        Self {
            app_handle,
            cf_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

#[derive(Clone)]
struct CachedCurseForgeResolution {
    project: crate::models::resource::ResourceProject,
    version: crate::models::resource::ResourceVersion,
    url: String,
    filename: String,
    subfolder: String,
    sha1: Option<String>,
}

impl PistonModpackResolver {
    fn key_for(project_id: Option<u32>, file_id: u32, hash: Option<&str>) -> String {
        if let Some(pid) = project_id {
            format!("pid:{}:fid:{}", pid, file_id)
        } else if let Some(h) = hash {
            format!("hash:{}:fid:{}", h, file_id)
        } else {
            format!("fid:{}", file_id)
        }
    }

    async fn get_cached(
        &self,
        project_id: Option<u32>,
        file_id: u32,
        hash: Option<&str>,
    ) -> Option<CachedCurseForgeResolution> {
        let key = Self::key_for(project_id, file_id, hash);
        self.cf_cache.read().await.get(&key).cloned()
    }
}

impl ModpackResolver for PistonModpackResolver {
    fn resolve_curseforge(
        &self,
        project_id: Option<u32>,
        file_id: u32,
        hash: Option<String>,
    ) -> futures::future::BoxFuture<'static, Result<ModpackResolvedCF>> {
        let handle = self.app_handle.clone();
        let cf_cache = self.cf_cache.clone();
        Box::pin(async move {
            let rm = handle.state::<ResourceManager>();
            let cache_key = PistonModpackResolver::key_for(project_id, file_id, hash.as_deref());
            if let Some(cached) = cf_cache.read().await.get(&cache_key).cloned() {
                return Ok(ModpackResolvedCF {
                    url: cached.url,
                    filename: cached.filename,
                    subfolder: cached.subfolder,
                    sha1: cached.sha1,
                });
            }

            // If we have a hash, we can try to find the project_id via fingerprint API first
            let mut resolved_pid_str = project_id.map(|id| id.to_string());

            if resolved_pid_str.is_none() {
                if let Some(h) = hash {
                    // Try to resolve by hash
                    if let Ok((project, _version)) =
                        rm.get_by_hash(SourcePlatform::CurseForge, &h).await
                    {
                        resolved_pid_str = Some(project.id);
                    }
                }
            }

            let pid_str = resolved_pid_str.unwrap_or_else(|| "".to_string());

            let version = rm
                .get_version(SourcePlatform::CurseForge, &pid_str, &file_id.to_string())
                .await
                .map_err(|e| {
                    anyhow::anyhow!("Failed to resolve CF mod {} {}: {}", pid_str, file_id, e)
                })?;

            // Re-fetch project to get its resource type (to determine folder)
            let project = rm
                .get_project(SourcePlatform::CurseForge, &version.project_id)
                .await
                .map_err(|e| {
                    anyhow::anyhow!("Failed to fetch project for CF resource type: {}", e)
                })?;

            log::debug!(
                "[PistonModpackResolver] Resolved CF project {}: {:?} (Class ID logic)",
                project.name,
                project.resource_type
            );

            let subfolder = match project.resource_type {
                crate::models::resource::ResourceType::Mod => "mods",
                crate::models::resource::ResourceType::ResourcePack => "resourcepacks",
                crate::models::resource::ResourceType::Shader => "shaderpacks",
                crate::models::resource::ResourceType::DataPack => "datapacks",
                crate::models::resource::ResourceType::World => "saves",
                crate::models::resource::ResourceType::Modpack => {
                    log::warn!("[PistonModpackResolver] Found nested modpack in manifest: {}. Mapping to mods folder.", project.name);
                    "mods"
                },
            }.to_string();

            log::debug!(
                "[PistonModpackResolver] {} resolved to subfolder: {}",
                project.name,
                subfolder
            );

            let resolved = ModpackResolvedCF {
                url: version.download_url.clone(),
                filename: version.file_name.clone(),
                subfolder: subfolder.clone(),
                sha1: Some(version.hash.clone()),
            };

            cf_cache.write().await.insert(
                cache_key,
                CachedCurseForgeResolution {
                    project,
                    version,
                    url: resolved.url.clone(),
                    filename: resolved.filename.clone(),
                    subfolder: resolved.subfolder.clone(),
                    sha1: resolved.sha1.clone(),
                },
            );

            Ok(resolved)
        })
    }

    fn resolve_modrinth(
        &self,
        project_id: &str,
        version_id: &str,
    ) -> futures::future::BoxFuture<'static, Result<ModpackResolvedModrinth>> {
        let handle = self.app_handle.clone();
        let project_id = project_id.to_string();
        let version_id = version_id.to_string();
        Box::pin(async move {
            let rm = handle.state::<ResourceManager>();
            let version = rm
                .get_version(SourcePlatform::Modrinth, &project_id, &version_id)
                .await
                .map_err(|e| {
                    anyhow::anyhow!(
                        "Failed to resolve Modrinth mod {}/{}: {}",
                        project_id,
                        version_id,
                        e
                    )
                })?;
            Ok(ModpackResolvedModrinth {
                url: version.download_url,
                sha1: if version.hash.is_empty() {
                    None
                } else {
                    Some(version.hash)
                },
            })
        })
    }
}

impl InstallModpackTask {
    pub fn new(
        instance: Instance,
        source: ModpackSource,
        metadata: Option<piston_lib::game::modpack::types::ModpackMetadata>,
    ) -> Self {
        Self {
            instance,
            source,
            metadata,
        }
    }
}

impl Task for InstallModpackTask {
    fn name(&self) -> String {
        format!("Install Modpack {}", self.instance.name)
    }

    fn starting_description(&self) -> String {
        format!("Preparing to install modpack: {}", self.instance.name)
    }

    fn completion_description(&self) -> String {
        format!("Successfully installed modpack: {}", self.instance.name)
    }

    fn show_completion_notification(&self) -> bool {
        true
    }

    fn run(&self, ctx: TaskContext) -> futures::future::BoxFuture<'static, Result<(), String>> {
        let instance = self.instance.clone();
        let source = self.source.clone();
        let metadata = self.metadata.clone();
        let app_handle = ctx.app_handle.clone();

        Box::pin(async move {
            // Initialize reporter
            let reporter: std::sync::Arc<dyn ProgressReporter> =
                std::sync::Arc::new(TauriProgressReporter {
                    ctx: ctx.clone(),
                    current_step: Arc::new(RwLock::new(String::new())),
                    dry_run: false,
                    last_emit: Arc::new(std::sync::Mutex::new(
                        std::time::Instant::now() - std::time::Duration::from_secs(1),
                    )),
                    last_percent: std::sync::atomic::AtomicI32::new(-1),
                    last_step_current: std::sync::atomic::AtomicI32::new(-1),
                    last_step_total: std::sync::atomic::AtomicI32::new(-1),
                });

            let modpack_path = match source {
                ModpackSource::Path(p) => p,
                ModpackSource::Url(u) => {
                    reporter.set_message("Downloading modpack zip...");

                    let client = piston_lib::client::shared_client();

                    let response = client.get(&u).send().await.map_err(|e| e.to_string())?;
                    let total_size = response.content_length();

                    let temp_dir = app_handle.path().app_cache_dir().unwrap().join("modpacks");
                    if !temp_dir.exists() {
                        fs::create_dir_all(&temp_dir)
                            .await
                            .map_err(|e| e.to_string())?;
                    }

                    let path =
                        temp_dir.join(format!("modpack_{}.zip", uuid::Uuid::new_v4().simple()));
                    let mut file = fs::File::create(&path).await.map_err(|e| e.to_string())?;
                    let mut stream = response.bytes_stream();

                    let mut downloaded: u64 = 0;
                    use futures_util::StreamExt;
                    use tokio::io::AsyncWriteExt;

                    while let Some(item) = stream.next().await {
                        let chunk = item.map_err(|e| e.to_string())?;
                        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
                        downloaded += chunk.len() as u64;

                        if let Some(total) = total_size {
                            let percent = (downloaded as f32 / total as f32) * 100.0;
                            reporter.set_percent(percent as i32);
                        }
                    }
                    path
                }
            };

            log::info!(
                "[ModpackTask] Starting modpack installation from {:?}",
                modpack_path
            );

            let data_dir = crate::utils::db_manager::get_app_config_dir()
                .map_err(|e| e.to_string())?
                .join("data");
            let game_dir = PathBuf::from(
                instance
                    .game_directory
                    .as_ref()
                    .ok_or("No game directory")?,
            );

            if !game_dir.exists() {
                fs::create_dir_all(&game_dir)
                    .await
                    .map_err(|e| e.to_string())?;
            }

            let resolver = Arc::new(PistonModpackResolver::new(app_handle.clone()));

            let java_path = instance.java_path.as_ref().map(PathBuf::from);

            let (metadata, override_mods) = match ModpackInstaller::install_from_zip_with_metadata(
                &modpack_path,
                metadata,
                &game_dir,
                &data_dir,
                reporter.clone(),
                Some(resolver.clone()),
                java_path,
            )
            .await
            {
                Ok(res) => res,
                Err(e) => {
                    log::error!("[ModpackTask] Installation failed: {}", e);

                    // Update database status to 'failed' with reason
                    let mut conn = crate::utils::db::get_vesta_conn().map_err(|e| e.to_string())?;
                    use crate::schema::instance::dsl as inst_dsl;
                    use diesel::prelude::*;

                    let status_val = format!("failed:{}", e);
                    let _ = diesel::update(inst_dsl::instance.filter(inst_dsl::id.eq(instance.id)))
                        .set(inst_dsl::installation_status.eq(Some(status_val)))
                        .execute(&mut conn);

                    // Emit update event to refresh UI with failure reason
                    if let Ok(updated_inst) = crate::commands::instances::get_instance(instance.id)
                    {
                        use tauri::Emitter;
                        let _ = app_handle.emit("core://instance-updated", updated_inst);
                    }

                    return Err(e.to_string());
                }
            };

            // Sync MC/loader from parsed modpack metadata (recovery if frontend sent stale data).
            let runtime_fields =
                crate::utils::instance_runtime::InstanceRuntimeFields::from_metadata(&metadata);
            log::info!(
                "[ModpackTask] Finalizing instance runtime: MC {}, loader={:?}",
                runtime_fields.minecraft_version,
                runtime_fields.modloader,
            );

            let mut final_instance =
                crate::utils::instance_runtime::sync_fields(instance.id, &runtime_fields).map_err(
                    |e| {
                        log::error!("[ModpackTask] Failed to sync instance runtime: {}", e);
                        e
                    },
                )?;

            let mut conn = crate::utils::db::get_vesta_conn().map_err(|e| e.to_string())?;
            use crate::schema::instance::dsl as inst_dsl;
            use diesel::prelude::*;

            ctx.update_full(
                PROGRESS_INDETERMINATE,
                "Downloads complete. Setting up Java runtime…".to_string(),
                None,
                None,
            );
            crate::utils::java::ensure_java_for_instance(
                &app_handle,
                &final_instance,
                Some(reporter.as_ref()),
                None,
            )
            .await
            .map_err(|e| format!("Java setup failed after modpack install: {}", e))?;

            // Persist the manifest before publishing resource rows. It is the source of truth
            // used to assign provenance and recover interrupted enrichment.
            let mut root_manifest =
                piston_lib::game::modpack::manifest::ModpackManifest::from_install(
                    &metadata,
                    &override_mods,
                    &[],
                    None,
                    instance.modpack_id.clone(),
                );
            let mut known_resolutions = HashMap::new();
            for resource in &mut root_manifest.mods {
                if let piston_lib::game::modpack::manifest::ModSource::CurseForge {
                    project_id,
                    file_id,
                    ..
                } = &resource.source
                {
                    if let Some(cached) = resolver
                        .get_cached(*project_id, *file_id, resource.sha1.as_deref())
                        .await
                    {
                        resource.path = format!("{}/{}", cached.subfolder, cached.filename);
                        if let Some(local_path) =
                            piston_lib::game::modpack::manifest::resolve_mod_path_on_disk(
                                &game_dir,
                                &resource.path,
                            )
                        {
                            known_resolutions.insert(
                                crate::utils::instance_helpers::normalize_path(&local_path),
                                crate::resources::reconciliation::KnownResourceResolution {
                                    project: cached.project,
                                    version: cached.version,
                                    platform: SourcePlatform::CurseForge,
                                },
                            );
                        }
                    }
                }
            }
            root_manifest.installed_at = chrono::Utc::now().to_rfc3339();
            root_manifest
                .persist(&game_dir)
                .map_err(|error| format!("Failed to save root modpack manifest: {error}"))?;

            let prepared = prepare_manifest_resource_rows(
                &app_handle,
                instance.id,
                &game_dir,
                &root_manifest,
                &known_resolutions,
                Some(&ctx),
            )
            .await?;

            ctx.update_description("Attaching resource watcher…".to_string());
            let watcher = app_handle.state::<crate::resources::watcher::ResourceWatcher>();
            watcher
                .watch_instance_without_scan(instance.id, game_dir.to_string_lossy().into_owned())
                .await
                .map_err(|error| format!("Failed to attach resource watcher: {error}"))?;

            ctx.update_description("Finalizing installed instance…".to_string());
            diesel::update(inst_dsl::instance.filter(inst_dsl::id.eq(instance.id)))
                .set(inst_dsl::installation_status.eq(Some("installed".to_string())))
                .execute(&mut conn)
                .map_err(|error| format!("Failed to update installation status: {error}"))?;
            final_instance = inst_dsl::instance
                .find(instance.id)
                .first(&mut conn)
                .map_err(|error| error.to_string())?;

            use tauri::Emitter;
            let emitted =
                crate::commands::instances::get_instance(instance.id).unwrap_or(final_instance);
            let _ = app_handle.emit("core://instance-updated", emitted.clone());
            let _ = app_handle.emit("core://instance-installed", emitted);

            if let Err(error) = app_handle
                .state::<TaskManager>()
                .submit(Box::new(ResourceEnrichmentTask::new(
                    instance.id,
                    instance.name.clone(),
                    prepared,
                    "modpack-install-enrichment",
                )))
                .await
            {
                log::warn!(
                    "[ResourceReconciliation] Installed {} but could not enqueue enrichment: {}",
                    instance.name,
                    error
                );
            }

            Ok(())
        })
    }
}

/// Enrich missing platform mod hashes/urls via [`ModpackResolver`] (Modrinth or CurseForge per entry).
pub async fn enrich_manifest_platform_hashes(
    app_handle: &tauri::AppHandle,
    manifest: &mut piston_lib::game::modpack::manifest::ModpackManifest,
) {
    let resolver = PistonModpackResolver::new(app_handle.clone());
    piston_lib::game::installer::core::modpack_installer::enrich_platform_mod_hashes(
        manifest,
        Some(&resolver),
    )
    .await;
}

fn manifest_resource_candidates(
    instance_id: i32,
    game_dir: &std::path::Path,
    manifest: &piston_lib::game::modpack::manifest::ModpackManifest,
    known_resolutions: &HashMap<String, crate::resources::reconciliation::KnownResourceResolution>,
) -> Vec<crate::resources::reconciliation::ResourceCandidate> {
    use piston_lib::game::modpack::manifest::resolve_mod_path_on_disk;
    use piston_lib::game::modpack::types::ModpackFormat;
    use std::collections::HashSet;

    let provenance = crate::resources::watcher::modpack_provenance_for_instance(instance_id).ok();
    let preferred_platform = Some(match manifest.source {
        ModpackFormat::Modrinth => SourcePlatform::Modrinth,
        ModpackFormat::CurseForge => SourcePlatform::CurseForge,
    });
    let mut seen = HashSet::new();
    let mut paths = manifest
        .mods
        .iter()
        .filter_map(|resource| resolve_mod_path_on_disk(game_dir, &resource.path))
        .collect::<Vec<_>>();
    paths.extend(manifest.overrides.extracted.iter().filter_map(|relative| {
        let normalized = relative.replace('\\', "/");
        let is_resource = ["mods/", "resourcepacks/", "shaderpacks/", "datapacks/"]
            .iter()
            .any(|prefix| normalized.to_lowercase().starts_with(prefix));
        if !is_resource {
            return None;
        }
        let path = std::path::PathBuf::from(relative);
        let path = if path.is_absolute() {
            path
        } else {
            game_dir.join(path)
        };
        path.is_file().then_some(path)
    }));

    paths
        .into_iter()
        .filter(|path| seen.insert(crate::utils::instance_helpers::normalize_path(path)))
        .map(|path| crate::resources::reconciliation::ResourceCandidate {
            resolved: known_resolutions
                .get(&crate::utils::instance_helpers::normalize_path(&path))
                .cloned(),
            path,
            provenance: provenance.clone(),
            preferred_platform,
        })
        .collect()
}

async fn prepare_manifest_resource_rows(
    app_handle: &tauri::AppHandle,
    instance_id: i32,
    game_dir: &std::path::Path,
    manifest: &piston_lib::game::modpack::manifest::ModpackManifest,
    known_resolutions: &HashMap<String, crate::resources::reconciliation::KnownResourceResolution>,
    progress_context: Option<&TaskContext>,
) -> Result<Vec<crate::resources::reconciliation::PreparedResourceCandidate>, String> {
    let candidates =
        manifest_resource_candidates(instance_id, game_dir, manifest, known_resolutions);
    let total = candidates.len();
    let progress = progress_context.map(|context| {
        context.update_full(
            PROGRESS_INDETERMINATE,
            indexing_progress_description(0, total),
            Some(0),
            Some(total as i32),
        );
        let context = context.clone();
        std::sync::Arc::new(move |processed, total| {
            if should_report_indexing_progress(processed, total) {
                context.update_full(
                    PROGRESS_INDETERMINATE,
                    indexing_progress_description(processed, total),
                    Some(processed as i32),
                    Some(total as i32),
                );
            }
        }) as crate::resources::reconciliation::LocalFactProgress
    });
    let prepared = crate::resources::reconciliation::prepare_candidates_with_progress(
        instance_id,
        candidates,
        progress,
    )
    .await;

    if let Some(context) = progress_context {
        context.update_full(
            PROGRESS_INDETERMINATE,
            format!("Saving {total} indexed resources…"),
            Some(total as i32),
            Some(total as i32),
        );
    }
    crate::resources::reconciliation::publish_local_rows(
        app_handle,
        instance_id,
        &prepared,
        "modpack-install-local-rows",
    )
    .map_err(|error| error.to_string())?;
    Ok(prepared)
}

fn indexing_progress_description(processed: usize, total: usize) -> String {
    if total == 0 {
        "No modpack resources need indexing…".to_string()
    } else {
        format!("Indexing installed resources… {processed}/{total}")
    }
}

fn should_report_indexing_progress(processed: usize, total: usize) -> bool {
    if total == 0 {
        return false;
    }
    let interval = (total / 20).max(1);
    processed == 1 || processed == total || processed.is_multiple_of(interval)
}

/// Publish manifest resources locally, then enqueue one deduplicated enrichment task.
pub fn spawn_manifest_resource_linking(
    app_handle: &tauri::AppHandle,
    instance_id: i32,
    game_dir: &std::path::Path,
    manifest: &piston_lib::game::modpack::manifest::ModpackManifest,
) {
    let app_handle = app_handle.clone();
    let game_dir = game_dir.to_path_buf();
    let manifest = manifest.clone();
    let instance_name = crate::commands::instances::get_instance(instance_id)
        .map(|instance| instance.name)
        .unwrap_or_else(|_| "this instance".to_string());

    tauri::async_runtime::spawn(async move {
        let prepared = match prepare_manifest_resource_rows(
            &app_handle,
            instance_id,
            &game_dir,
            &manifest,
            &HashMap::new(),
            None,
        )
        .await
        {
            Ok(prepared) => prepared,
            Err(error) => {
                log::warn!(
                    "[ResourceReconciliation] Failed to publish rows for {}: {}",
                    instance_name,
                    error
                );
                return;
            }
        };
        if let Err(error) = app_handle
            .state::<TaskManager>()
            .submit(Box::new(ResourceEnrichmentTask::new(
                instance_id,
                instance_name.clone(),
                prepared,
                "modpack-update-enrichment",
            )))
            .await
        {
            log::warn!(
                "[ResourceReconciliation] Failed to enqueue enrichment for {}: {}",
                instance_name,
                error
            );
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{indexing_progress_description, should_report_indexing_progress};

    #[test]
    fn indexing_progress_is_human_readable() {
        assert_eq!(
            indexing_progress_description(125, 500),
            "Indexing installed resources… 125/500"
        );
        assert_eq!(
            indexing_progress_description(0, 0),
            "No modpack resources need indexing…"
        );
    }

    #[test]
    fn large_indexing_jobs_limit_notification_updates() {
        let updates = (1..=500)
            .filter(|processed| should_report_indexing_progress(*processed, 500))
            .collect::<Vec<_>>();

        assert!(updates.len() <= 21);
        assert_eq!(updates.first(), Some(&1));
        assert_eq!(updates.last(), Some(&500));
    }
}
