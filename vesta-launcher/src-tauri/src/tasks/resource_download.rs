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

                if total_size > 0 {
                    let percent = (downloaded as f64 / total_size as f64 * 100.0) as i32;
                    let _ = manager.update_progress(notification_id.clone(), percent, None, None);
                }
            }

            file.flush().await.map_err(|e| e.to_string())?;
            drop(file);

            // 4. Verification (Hash check)
            // Skip for now, implement if needed later

            // 5. Finalize file placement
            let final_path = target_dir.join(&version.file_name);
            
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

            let new_installed = InstalledResource {
                id: None,
                instance_id,
                platform: platform_str.to_string(),
                remote_id: project_id,
                remote_version_id: version.id,
                resource_type: res_type_str.to_string(),
                local_path: version.file_name,
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

            // 7. Handle dependencies (Special case for Shaders)
            if resource_type == ResourceType::Shader {
                // TODO: Auto-install Iris/Sodium or Oculus/Embeddium
            }

            Ok(())
        })
    }
}
