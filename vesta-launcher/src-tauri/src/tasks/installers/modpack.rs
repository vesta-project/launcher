use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Manager};
use tokio::sync::RwLock;

use crate::models::instance::Instance;
use crate::models::SourcePlatform;
use crate::resources::ResourceManager;
use crate::tasks::installers::{ProgressReporter, TauriProgressReporter};
use crate::tasks::manager::{Task, TaskContext};

use piston_lib::game::installer::core::modpack_installer::{ModpackInstaller, ModpackResolver};
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
    ) -> futures::future::BoxFuture<'static, anyhow::Result<(String, String)>> {
        let handle = self.app_handle.clone();
        Box::pin(async move {
            let rm = handle.state::<ResourceManager>();
            
            // If we have a hash, we can try to find the project_id via fingerprint API first
            let mut resolved_pid = project_id;
            
            if resolved_pid.is_none() {
                if let Some(h) = hash {
                    // Try to resolve by hash
                    if let Ok((project, _version)) = rm.get_by_hash(SourcePlatform::CurseForge, &h).await {
                        resolved_pid = Some(project.id.parse().unwrap_or(0));
                    }
                }
            }
            
            let pid_str = resolved_pid.map(|id| id.to_string()).unwrap_or_else(|| "".to_string());
            
            let version = rm.get_version(
                SourcePlatform::CurseForge,
                &pid_str,
                &file_id.to_string()
            ).await.map_err(|e| anyhow::anyhow!("Failed to resolve CF mod {:?} {}: {}", resolved_pid, file_id, e))?;
            
            Ok((version.download_url, version.file_name))
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

            let metadata = ModpackInstaller::install_from_zip(
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
