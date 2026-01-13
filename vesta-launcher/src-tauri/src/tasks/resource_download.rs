use crate::models::resource::{ResourceType, SourcePlatform, ResourceVersion};
use crate::models::InstalledResource;
use crate::notifications::manager::NotificationManager;
use crate::tasks::manager::{Task, TaskContext};
use crate::utils::db::{get_vesta_conn};
use crate::schema::instance::dsl as instances_dsl;
use crate::schema::installed_resource::dsl as installed_dsl;
use diesel::prelude::*;
use std::path::PathBuf;
use tauri::Manager;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use reqwest::{Client, Url};
use chrono::Utc;

pub struct ResourceDownloadTask {
    pub instance_id: i32,
    pub platform: SourcePlatform,
    pub project_id: String,
    pub project_name: String,
    pub version: ResourceVersion,
    pub resource_type: ResourceType,
}

impl Task for ResourceDownloadTask {
    fn name(&self) -> String {
        format!("Installing {} ({})", self.project_name, self.version.version_number)
    }

    fn cancellable(&self) -> bool {
        true
    }

    fn run(&self, ctx: TaskContext) -> crate::tasks::manager::BoxFuture<'static, Result<(), String>> {
        let instance_id = self.instance_id;
        let platform = self.platform;
        let project_id = self.project_id.clone();
        let project_name = self.project_name.clone();
        let version = self.version.clone();
        let resource_type = self.resource_type;

        Box::pin(async move {
            let app_handle = ctx.app_handle.clone();
            let notification_id = ctx.notification_id.clone();
            let manager = app_handle.state::<NotificationManager>();

            // 1. Get instance path
            let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
            let instance_path_str: String = instances_dsl::instance
                .filter(instances_dsl::id.eq(instance_id))
                .select(instances_dsl::game_directory)
                .first::<Option<String>>(&mut conn)
                .map_err(|e| format!("Instance not found: {}", e))?
                .ok_or_else(|| "Instance has no game directory set".to_string())?;
            
            let instance_path = PathBuf::from(instance_path_str);
            
            // 2. Determine target directory
            let target_dir_name = match resource_type {
                ResourceType::Mod => "mods",
                ResourceType::ResourcePack => "resourcepacks",
                ResourceType::Shader => "shaderpacks",
                ResourceType::DataPack => "datapacks",
                ResourceType::Modpack => return Err("Modpack installation not supported yet".to_string()),
            };
            
            let target_dir = instance_path.join(target_dir_name);
            if !target_dir.exists() {
                fs::create_dir_all(&target_dir).await.map_err(|e| e.to_string())?;
            }

            // 3. Download the file
            log::info!("Starting download of '{}' from URL: '{}'", project_name, version.download_url);
            
            if version.download_url.is_empty() {
                return Err("Download URL is empty. This resource may not be available for direct download.".to_string());
            }

            let url = Url::parse(&version.download_url)
                .map_err(|e| format!("Invalid download URL '{}': {}", version.download_url, e))?;

            let client = Client::builder()
                .user_agent("VestaLauncher/0.1.0")
                .build()
                .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
                
            let mut response = client.get(url)
                .send()
                .await
                .map_err(|e| format!("Failed to send download request: {}", e))?;

            if !response.status().is_success() {
                return Err(format!("Download failed with status {}: {}", response.status(), version.download_url));
            }

            let total_size = response.content_length().unwrap_or(0);
            let mut downloaded: u64 = 0;
            let mut last_update = std::time::Instant::now();
            let mut last_downloaded: u64 = 0;
            
            let temp_file_path = target_dir.join(format!("{}.tmp", version.file_name));
            let mut file = fs::File::create(&temp_file_path).await.map_err(|e| e.to_string())?;

            while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
                // Check for cancellation
                if *ctx.cancel_rx.borrow() {
                    let _ = fs::remove_file(&temp_file_path).await;
                    return Err("Installation cancelled".to_string());
                }

                file.write_all(&chunk).await.map_err(|e| e.to_string())?;
                downloaded += chunk.len() as u64;

                let now = std::time::Instant::now();
                if now.duration_since(last_update).as_millis() > 500 {
                    let elapsed = now.duration_since(last_update).as_secs_f64();
                    let speed = (downloaded - last_downloaded) as f64 / elapsed; // bytes/sec
                    
                    let speed_fmt = if speed > 1024.0 * 1024.0 {
                        format!("{:.2} MB/s", speed / (1024.0 * 1024.0))
                    } else {
                        format!("{:.2} KB/s", speed / 1024.0)
                    };

                    let downloaded_fmt = format!("{:.1} MB", downloaded as f64 / (1024.0 * 1024.0));
                    let total_fmt = format!("{:.1} MB", total_size as f64 / (1024.0 * 1024.0));

                    if total_size > 0 {
                        let percent = (downloaded as f64 / total_size as f64 * 100.0) as i32;
                        let desc = format!("{} / {} ({})", downloaded_fmt, total_fmt, speed_fmt);
                        let _ = manager.update_progress_with_description(notification_id.clone(), percent, None, None, desc);
                    } else {
                        let desc = format!("{} units downloaded ({})", downloaded, speed_fmt);
                        let _ = manager.update_progress_with_description(notification_id.clone(), -1, None, None, desc);
                    }

                    last_update = now;
                    last_downloaded = downloaded;
                }
            }

            file.flush().await.map_err(|e| e.to_string())?;
            drop(file);

            // 4. Verification (Hash check)
            // Skip for now, implement if needed later

            // 5. Finalize file placement
            let final_path = target_dir.join(&version.file_name);
            let final_path_str = final_path.to_string_lossy().to_string();
            
            // Handle existing file (Check if it's the same or different)
            if final_path.exists() {
                fs::remove_file(&final_path).await.map_err(|e| e.to_string())?;
            }
            
            fs::rename(&temp_file_path, &final_path).await.map_err(|e| e.to_string())?;

            // 6. Update database
            let platform_str = match platform {
                SourcePlatform::Modrinth => "modrinth",
                SourcePlatform::CurseForge => "curseforge",
            };

            let res_type_str = match resource_type {
                ResourceType::Mod => "mod",
                ResourceType::ResourcePack => "resourcepack",
                ResourceType::Shader => "shader",
                ResourceType::DataPack => "datapack",
                ResourceType::Modpack => "modpack",
            };

            // Check for existing entry with same remote_id for this instance
            let existing_id = installed_dsl::installed_resource
                .filter(installed_dsl::instance_id.eq(instance_id))
                .filter(installed_dsl::remote_id.eq(&project_id))
                .select(installed_dsl::id)
                .first::<Option<i32>>(&mut conn)
                .optional()
                .map_err(|e| e.to_string())?
                .flatten();

            if let Some(eid) = existing_id {
                diesel::update(installed_dsl::installed_resource.filter(installed_dsl::id.eq(eid)))
                    .set((
                        installed_dsl::platform.eq(platform_str),
                        installed_dsl::remote_version_id.eq(&version.id),
                        installed_dsl::resource_type.eq(res_type_str),
                        installed_dsl::local_path.eq(&final_path_str),
                        installed_dsl::display_name.eq(&project_name),
                        installed_dsl::current_version.eq(&version.version_number),
                        installed_dsl::is_manual.eq(false),
                        installed_dsl::is_enabled.eq(true),
                        installed_dsl::last_updated.eq(Utc::now().naive_utc()),
                    ))
                    .execute(&mut conn)
                    .map_err(|e| e.to_string())?;
            } else {
                let new_installed = InstalledResource {
                    id: None,
                    instance_id,
                    platform: platform_str.to_string(),
                    remote_id: project_id,
                    remote_version_id: version.id,
                    resource_type: res_type_str.to_string(),
                    local_path: final_path_str,
                    display_name: project_name,
                    current_version: version.version_number,
                    is_manual: false,
                    is_enabled: true,
                    last_updated: Utc::now().naive_utc(),
                };

                diesel::insert_into(installed_dsl::installed_resource)
                    .values(&new_installed)
                    .execute(&mut conn)
                    .map_err(|e| e.to_string())?;
            }

            // 7. Handle dependencies (Special case for Shaders)
            if resource_type == ResourceType::Shader {
                // TODO: Auto-install Iris/Sodium or Oculus/Embeddium
            }

            Ok(())
        })
    }
}
