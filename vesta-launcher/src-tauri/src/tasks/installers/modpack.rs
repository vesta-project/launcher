use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;

use crate::models::instance::Instance;
use crate::models::SourcePlatform;
use crate::resources::ResourceManager;
use crate::tasks::installers::{ProgressReporter, TauriProgressReporter};
use crate::tasks::manager::{Task, TaskContext};

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

            reporter.set_message("Setting up Java runtime...");
            crate::utils::java::ensure_java_for_instance(
                &app_handle,
                &final_instance,
                Some(reporter.as_ref()),
                None,
            )
            .await
            .map_err(|e| format!("Java setup failed after modpack install: {}", e))?;

            if let Err(e) = diesel::update(inst_dsl::instance.filter(inst_dsl::id.eq(instance.id)))
                .set(inst_dsl::installation_status.eq(Some("installed".to_string())))
                .execute(&mut conn)
            {
                log::error!("[ModpackTask] Failed to update installation status: {}", e);
            } else {
                final_instance = inst_dsl::instance
                    .find(instance.id)
                    .first(&mut conn)
                    .map_err(|e| e.to_string())?;
            }

            // Emit update event
            use tauri::Emitter;
            let emitted =
                crate::commands::instances::get_instance(instance.id).unwrap_or(final_instance);
            let _ = app_handle.emit("core://instance-updated", emitted.clone());
            let _ = app_handle.emit("core://instance-installed", emitted);

            // POST-INSTALL: Link resources to database automatically
            // This prevents the ResourceWatcher from needing to hit the network for every mod
            let mc_ver = metadata.minecraft_version.clone();
            let loader_type = metadata.modloader_type.clone();
            let mods = metadata.mods.clone();
            let instance_id = instance.id;
            let game_dir_clone = game_dir.clone();
            let app_handle_clone = app_handle.clone();
            let resolver_for_linking = resolver.clone();

            tauri::async_runtime::spawn(async move {
                let rm = app_handle_clone.state::<ResourceManager>();
                log::info!("[ModpackTask] Background linking {} resources and {} overrides for instance {}", mods.len(), override_mods.len(), instance_id);

                // Handle Overrides first (local files from ZIP)
                for override_path in override_mods {
                    // Only link resources in known directories
                    let is_resource = override_path.starts_with("mods")
                        || override_path.starts_with("resourcepacks")
                        || override_path.starts_with("shaderpacks")
                        || override_path.starts_with("datapacks");

                    if !is_resource {
                        continue;
                    }

                    let local_path = game_dir_clone.join(&override_path);
                    if local_path.exists() {
                        let hash = crate::utils::hash::calculate_sha1(&local_path).ok();
                        let path_meta = local_path.clone();
                        let meta =
                            tokio::task::spawn_blocking(move || std::fs::metadata(&path_meta))
                                .await
                                .ok()
                                .and_then(|r| r.ok())
                                .map_or((0, 0), |m| {
                                    (
                                        m.len() as i64,
                                        m.modified()
                                            .ok()
                                            .and_then(|t| {
                                                t.duration_since(std::time::UNIX_EPOCH).ok()
                                            })
                                            .map(|d| d.as_secs() as i64)
                                            .unwrap_or(0),
                                    )
                                });

                        let _ = crate::resources::watcher::link_manual_resource_to_db(
                            &app_handle_clone,
                            instance_id,
                            &local_path,
                            hash,
                            meta,
                            "modpack",
                        )
                        .await;
                    }
                }

                for res_entry in mods {
                    match res_entry {
                        piston_lib::game::modpack::types::ModpackMod::Modrinth {
                            path,
                            hashes,
                            ..
                        } => {
                            if let Some(sha1) = hashes.get("sha1") {
                                let local_path = game_dir_clone.join(path.replace("\\", "/"));
                                if local_path.exists() {
                                    if let Ok((project, version)) = rm
                                        .get_by_hash(crate::models::SourcePlatform::Modrinth, sha1)
                                        .await
                                    {
                                        let path_meta = local_path.clone();
                                        let meta = tokio::task::spawn_blocking(move || {
                                            std::fs::metadata(&path_meta)
                                        })
                                        .await
                                        .ok()
                                        .and_then(|r| r.ok())
                                        .map_or((0, 0), |m| {
                                            (
                                                m.len() as i64,
                                                m.modified()
                                                    .ok()
                                                    .and_then(|t| {
                                                        t.duration_since(std::time::UNIX_EPOCH).ok()
                                                    })
                                                    .map(|d| d.as_secs() as i64)
                                                    .unwrap_or(0),
                                            )
                                        });

                                        let _ = crate::resources::watcher::link_resource_to_db(
                                            &app_handle_clone,
                                            instance_id,
                                            &local_path,
                                            project,
                                            version,
                                            crate::models::SourcePlatform::Modrinth,
                                            Some(sha1.clone()),
                                            meta,
                                        )
                                        .await;
                                    }
                                }
                            }
                        }
                        piston_lib::game::modpack::types::ModpackMod::CurseForge {
                            project_id,
                            file_id,
                            hash,
                            ..
                        } => {
                            // Reuse resolver cache from install phase to avoid repetitive API calls.
                            let cached = resolver_for_linking
                                .get_cached(project_id, file_id, hash.as_deref())
                                .await;

                            let (project, version, subfolder) = if let Some(c) = cached {
                                (c.project, c.version, c.subfolder)
                            } else {
                                let pid_str =
                                    project_id.map(|id| id.to_string()).unwrap_or_default();
                                let fid_str = file_id.to_string();
                                let version = match rm
                                    .get_version(
                                        crate::models::SourcePlatform::CurseForge,
                                        &pid_str,
                                        &fid_str,
                                    )
                                    .await
                                {
                                    Ok(v) => v,
                                    Err(_) => continue,
                                };
                                let project = match rm
                                    .get_project(
                                        crate::models::SourcePlatform::CurseForge,
                                        &version.project_id,
                                    )
                                    .await
                                {
                                    Ok(p) => p,
                                    Err(_) => continue,
                                };
                                let subfolder = match project.resource_type {
                                    crate::models::resource::ResourceType::Mod => "mods",
                                    crate::models::resource::ResourceType::ResourcePack => {
                                        "resourcepacks"
                                    }
                                    crate::models::resource::ResourceType::Shader => "shaderpacks",
                                    crate::models::resource::ResourceType::DataPack => "datapacks",
                                    crate::models::resource::ResourceType::World => "saves",
                                    _ => "mods",
                                }
                                .to_string();
                                (project, version, subfolder)
                            };

                            let local_path =
                                game_dir_clone.join(subfolder).join(&version.file_name);
                            if local_path.exists() {
                                let path_meta = local_path.clone();
                                let meta = tokio::task::spawn_blocking(move || {
                                    std::fs::metadata(&path_meta)
                                })
                                .await
                                .ok()
                                .and_then(|r| r.ok())
                                .map_or((0, 0), |m| {
                                    (
                                        m.len() as i64,
                                        m.modified()
                                            .ok()
                                            .and_then(|t| {
                                                t.duration_since(std::time::UNIX_EPOCH).ok()
                                            })
                                            .map(|d| d.as_secs() as i64)
                                            .unwrap_or(0),
                                    )
                                });

                                let _ = crate::resources::watcher::link_resource_to_db(
                                    &app_handle_clone,
                                    instance_id,
                                    &local_path,
                                    project,
                                    version,
                                    crate::models::SourcePlatform::CurseForge,
                                    hash,
                                    meta,
                                )
                                .await;
                            }
                        }
                    }
                }

                // Finally, refresh latest version statuses in background
                let _ = rm
                    .refresh_resources_for_instance(instance_id, &mc_ver, &loader_type)
                    .await;
                log::info!(
                    "[ModpackTask] Finished linking resources for instance {}",
                    instance_id
                );
            });

            // Step 6: Save manifest for future syncs
            let vesta_dir = game_dir.join(".vesta");
            if let Err(e) = fs::create_dir_all(&vesta_dir).await {
                log::error!("[InstallModpackTask] Failed to create .vesta dir: {}", e);
            } else {
                let manifest_path = vesta_dir.join("modpack_manifest.json");
                if let Ok(json) = serde_json::to_string_pretty(&metadata) {
                    if let Err(e) = fs::write(manifest_path, json).await {
                        log::error!("[InstallModpackTask] Failed to save manifest: {}", e);
                    }
                }
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

/// Pre-link manifest mods into `installed_resource` so ResourceWatcher can skip API calls.
pub fn spawn_manifest_resource_linking(
    app_handle: &tauri::AppHandle,
    instance_id: i32,
    game_dir: &std::path::Path,
    manifest: &piston_lib::game::modpack::manifest::ModpackManifest,
) {
    use piston_lib::game::modpack::manifest::{resolve_mod_path_on_disk, ModSource};

    let app_handle = app_handle.clone();
    let game_dir = game_dir.to_path_buf();
    let mods = manifest.mods.clone();

    tauri::async_runtime::spawn(async move {
        let rm = app_handle.state::<ResourceManager>();

        for m in mods {
            let Some(local_path) = resolve_mod_path_on_disk(&game_dir, &m.path) else {
                continue;
            };

            let path_meta = local_path.clone();
            let meta = tokio::task::spawn_blocking(move || std::fs::metadata(&path_meta))
                .await
                .ok()
                .and_then(|r| r.ok())
                .map_or((0, 0), |file_meta| {
                    (
                        file_meta.len() as i64,
                        file_meta
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as i64)
                            .unwrap_or(0),
                    )
                });

            match &m.source {
                ModSource::Modrinth { .. } => {
                    let Some(sha1) = m.sha1.clone() else {
                        continue;
                    };
                    if let Ok((project, version)) =
                        rm.get_by_hash(SourcePlatform::Modrinth, &sha1).await
                    {
                        let _ = crate::resources::watcher::link_resource_to_db(
                            &app_handle,
                            instance_id,
                            &local_path,
                            project,
                            version,
                            SourcePlatform::Modrinth,
                            Some(sha1),
                            meta,
                        )
                        .await;
                    }
                }
                ModSource::CurseForge {
                    project_id,
                    file_id,
                    ..
                } => {
                    let pid = project_id.map(|p| p.to_string()).unwrap_or_default();
                    let Ok(version) = rm
                        .get_version(SourcePlatform::CurseForge, &pid, &file_id.to_string())
                        .await
                    else {
                        continue;
                    };
                    let Ok(project) = rm
                        .get_project(SourcePlatform::CurseForge, &version.project_id)
                        .await
                    else {
                        continue;
                    };
                    let hash = m.sha1.clone().or_else(|| {
                        if version.hash.is_empty() {
                            None
                        } else {
                            Some(version.hash.clone())
                        }
                    });
                    let _ = crate::resources::watcher::link_resource_to_db(
                        &app_handle,
                        instance_id,
                        &local_path,
                        project,
                        version,
                        SourcePlatform::CurseForge,
                        hash,
                        meta,
                    )
                    .await;
                }
            }
        }
    });
}
