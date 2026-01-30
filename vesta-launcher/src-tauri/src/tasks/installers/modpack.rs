use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Manager};
use tokio::sync::RwLock;

use crate::models::instance::Instance;
use crate::models::SourcePlatform;
use crate::resources::ResourceManager;
use crate::tasks::installers::{ProgressReporter, TauriProgressReporter};
use crate::tasks::manager::{Task, TaskContext};

use piston_lib::game::installer::core::modpack_installer::{ModpackInstaller, ModpackResolver, ModpackResolvedCF};
use piston_lib::game::installer::types::CancelToken;
use anyhow::Result;
use tokio::fs;

#[derive(Clone)]
pub enum ModpackSource {
    Path(PathBuf),
    Url(String),
}

pub struct InstallModpackTask {
    instance: Instance,
    source: ModpackSource,
}

struct PistonModpackResolver {
    app_handle: tauri::AppHandle,
}

impl ModpackResolver for PistonModpackResolver {
    fn resolve_curseforge(
        &self,
        project_id: Option<u32>,
        file_id: u32,
        hash: Option<String>
    ) -> futures::future::BoxFuture<'static, Result<ModpackResolvedCF>> {
        let handle = self.app_handle.clone();
        Box::pin(async move {
            let rm = handle.state::<ResourceManager>();
            
            // If we have a hash, we can try to find the project_id via fingerprint API first
            let mut resolved_pid_str = project_id.map(|id| id.to_string());
            
            if resolved_pid_str.is_none() {
                if let Some(h) = hash {
                    // Try to resolve by hash
                    if let Ok((project, _version)) = rm.get_by_hash(SourcePlatform::CurseForge, &h).await {
                        resolved_pid_str = Some(project.id);
                    }
                }
            }
            
            let pid_str = resolved_pid_str.unwrap_or_else(|| "".to_string());
            
            let version = rm.get_version(
                SourcePlatform::CurseForge,
                &pid_str,
                &file_id.to_string()
            ).await.map_err(|e| anyhow::anyhow!("Failed to resolve CF mod {} {}: {}", pid_str, file_id, e))?;
            
            // Re-fetch project to get its resource type (to determine folder)
            let project = rm.get_project(SourcePlatform::CurseForge, &version.project_id).await
                .map_err(|e| anyhow::anyhow!("Failed to fetch project for CF resource type: {}", e))?;

            log::debug!("[PistonModpackResolver] Resolved CF project {}: {:?} (Class ID logic)", 
                project.name, project.resource_type);

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

            log::debug!("[PistonModpackResolver] {} resolved to subfolder: {}", project.name, subfolder);

            Ok(ModpackResolvedCF {
                url: version.download_url,
                filename: version.file_name,
                subfolder,
                sha1: Some(version.hash),
            })
        })
    }
}

impl InstallModpackTask {
    pub fn new(instance: Instance, source: ModpackSource) -> Self {
        Self {
            instance,
            source,
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
        let app_handle = ctx.app_handle.clone();
        let notification_id = ctx.notification_id.clone();
        let cancel_rx = ctx.cancel_rx.clone();
        let pause_rx = ctx.pause_rx.clone();

        Box::pin(async move {
            // Initialize reporter
            let reporter: std::sync::Arc<dyn ProgressReporter> = std::sync::Arc::new(TauriProgressReporter {
                app_handle: app_handle.clone(),
                notification_id: notification_id.clone(),
                cancel_token: CancelToken::new(cancel_rx),
                pause_rx: pause_rx.clone(),
                current_step: Arc::new(RwLock::new(String::new())),
                dry_run: false,
                last_emit: Arc::new(std::sync::Mutex::new(
                    std::time::Instant::now() - std::time::Duration::from_secs(1),
                )),
                last_percent: std::sync::atomic::AtomicI32::new(-1),
            });

            let modpack_path = match source {
                ModpackSource::Path(p) => p,
                ModpackSource::Url(u) => {
                    reporter.set_message("Downloading modpack zip...");
                    
                    let client = reqwest::Client::builder()
                        .user_agent("VestaLauncher/0.1.0")
                        .build()
                        .map_err(|e| e.to_string())?;
                    
                    let response = client.get(&u).send().await.map_err(|e| e.to_string())?;
                    let total_size = response.content_length();
                    
                    let temp_dir = app_handle.path().app_cache_dir().unwrap().join("modpacks");
                    if !temp_dir.exists() {
                        fs::create_dir_all(&temp_dir).await.map_err(|e| e.to_string())?;
                    }
                    
                    let path = temp_dir.join(format!("modpack_{}.zip", uuid::Uuid::new_v4().simple()));
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

            log::info!("[ModpackTask] Starting modpack installation from {:?}", modpack_path);
            
            let data_dir = crate::utils::db_manager::get_app_config_dir().map_err(|e| e.to_string())?.join("data");
            let game_dir = PathBuf::from(instance.game_directory.as_ref().ok_or("No game directory")?);
            
            if !game_dir.exists() {
                fs::create_dir_all(&game_dir).await.map_err(|e| e.to_string())?;
            }

            let resolver = Arc::new(PistonModpackResolver {
                app_handle: app_handle.clone(),
            });

            let java_path = instance.java_path.as_ref().map(PathBuf::from);

            let (metadata, override_mods) = ModpackInstaller::install_from_zip(
                &modpack_path,
                &game_dir,
                &data_dir,
                reporter,
                Some(resolver),
                java_path,
            ).await.map_err(|e| e.to_string())?;

            // 1. Ensure the instance has the correct modloader info from the actual modpack metadata
            // This acts as a recovery if the frontend failed to send the correct metadata.
            let mut conn = crate::utils::db::get_vesta_conn().map_err(|e| e.to_string())?;
            use crate::schema::instance::dsl as inst_dsl;
            use diesel::prelude::*;

            let updated_modloader = metadata.modloader_type.to_lowercase();
            let updated_modloader_version = metadata.modloader_version.clone();

            log::info!("[ModpackTask] Finalizing instance metadata: loader={}, loader_version={:?}", 
                updated_modloader, updated_modloader_version);

            if let Err(e) = diesel::update(inst_dsl::instance.filter(inst_dsl::id.eq(instance.id)))
                .set((
                    inst_dsl::modloader.eq(Some(updated_modloader)),
                    inst_dsl::modloader_version.eq(updated_modloader_version),
                    inst_dsl::installation_status.eq(Some("installed".to_string())),
                ))
                .execute(&mut conn) {
                    log::error!("[ModpackTask] Failed to update instance metadata: {}", e);
                }

            // Fetch the updated instance to emit it
            let final_instance: Instance = inst_dsl::instance
                .find(instance.id)
                .first(&mut conn)
                .map_err(|e| e.to_string())?;

            // Emit update event
            use tauri::Emitter;
            let _ = app_handle.emit("core://instance-updated", final_instance);

            // POST-INSTALL: Link resources to database automatically
            // This prevents the ResourceWatcher from needing to hit the network for every mod
            let mc_ver = metadata.minecraft_version.clone();
            let loader_type = metadata.modloader_type.clone();
            let mods = metadata.mods.clone();
            let instance_id = instance.id;
            let game_dir_clone = game_dir.clone();
            let app_handle_clone = app_handle.clone();
            
            tauri::async_runtime::spawn(async move {
                let rm = app_handle_clone.state::<ResourceManager>();
                log::info!("[ModpackTask] Background linking {} resources and {} overrides for instance {}", mods.len(), override_mods.len(), instance_id);
                
                // Handle Overrides first (local files from ZIP)
                for override_path in override_mods {
                    // Only link resources in known directories
                    let is_resource = override_path.starts_with("mods") || 
                                     override_path.starts_with("resourcepacks") || 
                                     override_path.starts_with("shaderpacks") ||
                                     override_path.starts_with("datapacks");
                    
                    if !is_resource {
                        continue;
                    }

                    let local_path = game_dir_clone.join(&override_path);
                    if local_path.exists() {
                        let hash = crate::utils::hash::calculate_sha1(&local_path).ok();
                        let meta = if let Ok(m) = std::fs::metadata(&local_path) {
                            (m.len() as i64, m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0))
                        } else { (0, 0) };

                        let _ = crate::resources::watcher::link_manual_resource_to_db(
                            &app_handle_clone, 
                            instance_id, 
                            &local_path, 
                            hash, 
                            meta,
                            "modpack"
                        ).await;
                    }
                }

                for res_entry in mods {
                    match res_entry {
                        piston_lib::game::modpack::types::ModpackMod::Modrinth { path, hashes, .. } => {
                            if let Some(sha1) = hashes.get("sha1") {
                                let local_path = game_dir_clone.join(path.replace("\\", "/"));
                                if local_path.exists() {
                                    if let Ok((project, version)) = rm.get_by_hash(crate::models::SourcePlatform::Modrinth, sha1).await {
                                        let meta = if let Ok(m) = std::fs::metadata(&local_path) {
                                            (m.len() as i64, m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0))
                                        } else { (0, 0) };
                                        
                                        let _ = crate::resources::watcher::link_resource_to_db(
                                            &app_handle_clone, 
                                            instance_id, 
                                            &local_path, 
                                            project, 
                                            version, 
                                            crate::models::SourcePlatform::Modrinth, 
                                            Some(sha1.clone()),
                                            meta
                                        ).await;
                                    }
                                }
                            }
                        }
                        piston_lib::game::modpack::types::ModpackMod::CurseForge { project_id, file_id, hash, .. } => {
                            // Resolver might have already cached this, or we fetch it now
                            // Typically CurseForge mods from modpacks end up in "mods/" with the filename from the API
                            // We need both project and version to link
                            let pid_str = project_id.map(|id| id.to_string()).unwrap_or_default();
                            let fid_str = file_id.to_string();
                            
                            if let Ok(version) = rm.get_version(crate::models::SourcePlatform::CurseForge, &pid_str, &fid_str).await {
                                // We might need the project info too
                                if let Ok(project) = rm.get_project(crate::models::SourcePlatform::CurseForge, &version.project_id).await {
                                    let subfolder = match project.resource_type {
                                        crate::models::resource::ResourceType::Mod => "mods",
                                        crate::models::resource::ResourceType::ResourcePack => "resourcepacks",
                                        crate::models::resource::ResourceType::Shader => "shaderpacks",
                                        crate::models::resource::ResourceType::DataPack => "datapacks",
                                        crate::models::resource::ResourceType::World => "saves",
                                        _ => "mods",
                                    };
                                    let local_path = game_dir_clone.join(subfolder).join(&version.file_name);
                                    if local_path.exists() {
                                        let meta = if let Ok(m) = std::fs::metadata(&local_path) {
                                            (m.len() as i64, m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0))
                                        } else { (0, 0) };

                                        let _ = crate::resources::watcher::link_resource_to_db(
                                            &app_handle_clone, 
                                            instance_id, 
                                            &local_path, 
                                            project, 
                                            version, 
                                            crate::models::SourcePlatform::CurseForge, 
                                            hash,
                                            meta
                                        ).await;
                                    }
                                }
                            }
                        }
                    }
                }
                
                // Finally, refresh latest version statuses in background
                let _ = rm.refresh_resources_for_instance(instance_id, &mc_ver, &loader_type).await;
                log::info!("[ModpackTask] Finished linking resources for instance {}", instance_id);
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
