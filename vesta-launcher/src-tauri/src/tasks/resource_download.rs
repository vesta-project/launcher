use crate::models::installed_resource::{InstalledResource, NewInstalledResource};
use crate::models::resource::{ResourceType, ResourceVersion, SourcePlatform};
use crate::notifications::manager::NotificationManager;
use crate::schema::installed_resource::dsl as installed_dsl;
use crate::schema::instance::dsl as instances_dsl;
use crate::tasks::manager::{Task, TaskContext};
use crate::utils::db::get_vesta_conn;
use crate::utils::instance_helpers::normalize_path;
use chrono::Utc;
use diesel::prelude::*;
use reqwest::Url;
use sha1::{Digest, Sha1};
use std::path::PathBuf;
use tauri::Manager;
use tokio::fs;
use tokio::io::AsyncWriteExt;

pub struct ResourceDownloadTask {
    pub instance_id: i32,
    pub platform: SourcePlatform,
    pub project_id: String,
    pub project_name: String,
    pub version: ResourceVersion,
    pub resource_type: ResourceType,
    pub dependency_for: Option<String>,
}

impl Task for ResourceDownloadTask {
    fn name(&self) -> String {
        format!("Installing {}", self.project_name)
    }

    fn id(&self) -> Option<String> {
        Some(format!(
            "download_{}_{}_{}",
            self.instance_id, self.project_id, self.version.id
        ))
    }

    fn cancellable(&self) -> bool {
        true
    }

    fn show_completion_notification(&self) -> bool {
        true
    }

    fn completion_description(&self) -> String {
        if let Some(ref parent) = self.dependency_for {
            format!(
                "{} installed successfully (Required by {})",
                self.project_name, parent
            )
        } else {
            format!("{} installed successfully", self.project_name)
        }
    }

    fn starting_description(&self) -> String {
        if let Some(ref parent) = self.dependency_for {
            format!("Required by {}", parent)
        } else {
            "Starting...".to_string()
        }
    }

    fn run(
        &self,
        ctx: TaskContext,
    ) -> crate::tasks::manager::BoxFuture<'static, Result<(), String>> {
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

            ctx.set_title(format!("Installing {}", project_name));

            // 1. Get instance path
            let instance_path_str: String = tauri::async_runtime::spawn_blocking(move || {
                let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
                instances_dsl::instance
                    .filter(instances_dsl::id.eq(instance_id))
                    .select(instances_dsl::game_directory)
                    .first::<Option<String>>(&mut conn)
                    .map_err(|e| format!("Instance not found: {}", e))?
                    .ok_or_else(|| "Instance has no game directory set".to_string())
            })
            .await
            .map_err(|e| format!("Failed to query instance: {}", e))??;

            let instance_path = PathBuf::from(instance_path_str);

            // 2. Determine target directory
            let target_dir_name = match resource_type {
                ResourceType::Mod => "mods",
                ResourceType::ResourcePack => "resourcepacks",
                ResourceType::Shader => "shaderpacks",
                ResourceType::DataPack => "datapacks",
                ResourceType::World => "saves",
                ResourceType::Modpack => {
                    return Err("Modpack installation not supported yet".to_string())
                }
            };

            let target_dir = instance_path.join(target_dir_name);
            if !target_dir.exists() {
                fs::create_dir_all(&target_dir)
                    .await
                    .map_err(|e| e.to_string())?;
            }

            // 3. Download the file
            log::info!(
                "Starting download of '{}' from URL: '{}'",
                project_name,
                version.download_url
            );

            if version.download_url.is_empty() {
                return Err("Download URL is empty. This resource may not be available for direct download.".to_string());
            }

            let url = Url::parse(&version.download_url)
                .map_err(|e| format!("Invalid download URL '{}': {}", version.download_url, e))?;

            let client = piston_lib::client::shared_client();

            let mut response = client
                .get(url)
                .send()
                .await
                .map_err(|e| format!("Failed to send download request: {}", e))?;

            if !response.status().is_success() {
                return Err(format!(
                    "Download failed with status {}: {}",
                    response.status(),
                    version.download_url
                ));
            }

            let total_size = response.content_length().unwrap_or(0);
            let mut downloaded: u64 = 0;
            let mut last_update = std::time::Instant::now();
            let mut last_downloaded: u64 = 0;

            let temp_file_path = target_dir.join(format!("{}.tmp", version.file_name));
            let mut file = fs::File::create(&temp_file_path)
                .await
                .map_err(|e| e.to_string())?;

            let mut hasher = Sha1::new();

            while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
                // Check for cancellation
                if *ctx.cancel_rx.borrow() {
                    let _ = fs::remove_file(&temp_file_path).await;
                    return Err("Installation cancelled".to_string());
                }

                file.write_all(&chunk).await.map_err(|e| e.to_string())?;
                hasher.update(&chunk);
                downloaded += chunk.len() as u64;

                let now = std::time::Instant::now();
                if now.duration_since(last_update).as_millis() > 250 {
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
                        let _ = ctx.update_full(percent, desc, None, None);
                    } else {
                        let desc = format!("{} units downloaded ({})", downloaded, speed_fmt);
                        let _ = ctx.update_description(desc);
                    }

                    last_update = now;
                    last_downloaded = downloaded;
                }
            }

            file.flush().await.map_err(|e| e.to_string())?;
            drop(file);

            // 4. Verification (Hash check)
            if !version.hash.is_empty() {
                let computed = hex::encode(hasher.finalize());
                if computed.to_lowercase() != version.hash.to_lowercase() {
                    let _ = fs::remove_file(&temp_file_path).await;
                    return Err(format!(
                        "SHA1 mismatch: expected {}, got {}",
                        version.hash, computed
                    ));
                }
            }

            // 5. Finalize file placement
            let final_path = target_dir.join(&version.file_name);
            let final_path_str = normalize_path(&final_path);

            // Get metadata from temp file before move
            let (file_size, file_mtime) = if let Ok(meta) = tokio::fs::metadata(&temp_file_path).await {
                (
                    meta.len() as i64,
                    meta.modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0),
                )
            } else {
                (0, 0)
            };

            // Check for existing database entry to find old file path
            let existing_resource = tauri::async_runtime::spawn_blocking({
                let project_id = project_id.clone();
                move || {
                    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
                    installed_dsl::installed_resource
                        .filter(installed_dsl::instance_id.eq(instance_id))
                        .filter(installed_dsl::remote_id.eq(project_id))
                        .first::<InstalledResource>(&mut conn)
                        .optional()
                        .map_err(|e| e.to_string())
                }
            })
            .await
            .map_err(|e| format!("Failed to query installed resource: {}", e))??;

            if let Some(res) = existing_resource {
                if res.local_path != final_path_str {
                    let old_path = std::path::PathBuf::from(&res.local_path);
                    if tokio::fs::metadata(&old_path).await.is_ok() {
                        log::info!(
                            "[ResourceDownload] Deleting old version file: {:?}",
                            old_path
                        );
                        let _ = fs::remove_file(&old_path).await;
                    }
                }

                let res_id = res.id;
                let version_id = version.id.clone();
                let project_name = project_name.clone();
                let final_path_str = final_path_str.clone();
                let version_number = version.version_number.clone();
                let release_type = format!("{:?}", version.release_type).to_lowercase();
                let version_hash = version.hash.clone();

                tauri::async_runtime::spawn_blocking(move || {
                    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
                    diesel::update(
                        installed_dsl::installed_resource.filter(installed_dsl::id.eq(res_id)),
                    )
                    .set((
                        installed_dsl::platform.eq(match platform {
                            SourcePlatform::Modrinth => "modrinth",
                            SourcePlatform::CurseForge => "curseforge",
                        }),
                        installed_dsl::remote_version_id.eq(version_id),
                        installed_dsl::resource_type.eq(match resource_type {
                            ResourceType::Mod => "mod",
                            ResourceType::ResourcePack => "resourcepack",
                            ResourceType::Shader => "shader",
                            ResourceType::DataPack => "datapack",
                            ResourceType::Modpack => "modpack",
                            ResourceType::World => "world",
                        }),
                        installed_dsl::local_path.eq(final_path_str),
                        installed_dsl::display_name.eq(project_name),
                        installed_dsl::current_version.eq(version_number),
                        installed_dsl::release_type.eq(release_type),
                        installed_dsl::is_manual.eq(false),
                        installed_dsl::is_enabled.eq(true),
                        installed_dsl::last_updated.eq(Utc::now().to_rfc3339()),
                        installed_dsl::file_size.eq(file_size),
                        installed_dsl::file_mtime.eq(file_mtime),
                        installed_dsl::hash.eq(Some(version_hash)),
                    ))
                    .execute(&mut conn)
                    .map_err(|e| e.to_string())
                })
                .await
                .map_err(|e| format!("Failed to update installed resource: {}", e))??;
            } else {
                if tokio::fs::metadata(&final_path).await.is_ok() {
                    fs::remove_file(&final_path)
                        .await
                        .map_err(|e| e.to_string())?;
                }

                fs::rename(&temp_file_path, &final_path)
                    .await
                    .map_err(|e| e.to_string())?;

                let new_installed = NewInstalledResource {
                    instance_id,
                    platform: match platform {
                        SourcePlatform::Modrinth => "modrinth",
                        SourcePlatform::CurseForge => "curseforge",
                    }
                    .to_string(),
                    remote_id: project_id.clone(),
                    remote_version_id: version.id.clone(),
                    resource_type: match resource_type {
                        ResourceType::Mod => "mod",
                        ResourceType::ResourcePack => "resourcepack",
                        ResourceType::Shader => "shader",
                        ResourceType::DataPack => "datapack",
                        ResourceType::Modpack => "modpack",
                        ResourceType::World => "world",
                    }
                    .to_string(),
                    local_path: final_path_str.clone(),
                    display_name: project_name.clone(),
                    current_version: version.version_number.clone(),
                    release_type: format!("{:?}", version.release_type).to_lowercase(),
                    is_manual: false,
                    is_enabled: true,
                    last_updated: Utc::now().to_rfc3339(),
                    hash: Some(version.hash.clone()),
                    file_size,
                    file_mtime,
                };

                tauri::async_runtime::spawn_blocking(move || {
                    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
                    diesel::insert_into(installed_dsl::installed_resource)
                        .values(&new_installed)
                        .execute(&mut conn)
                        .map_err(|e| e.to_string())
                })
                .await
                .map_err(|e| format!("Failed to insert installed resource: {}", e))??;
            }

            if tokio::fs::metadata(&temp_file_path).await.is_ok() {
                let _ = fs::rename(&temp_file_path, &final_path).await;
            }

            // 7. Handle dependencies (Special case for Shaders)
            if resource_type == ResourceType::Shader {
                // TODO: Auto-install Iris/Sodium or Oculus/Embeddium
            }

            Ok(())
        })
    }
}
