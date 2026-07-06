use crate::models::installed_resource::{InstalledResource, NewInstalledResource};
use crate::models::resource::{ResourceType, ResourceVersion, SourcePlatform};
use crate::notifications::models::PROGRESS_INDETERMINATE;
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

fn format_download_size(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
}

fn format_download_speed(bytes_per_second: f64) -> String {
    if bytes_per_second > 1024.0 * 1024.0 {
        format!("{:.2} MB/s", bytes_per_second / (1024.0 * 1024.0))
    } else {
        format!("{:.2} KB/s", bytes_per_second / 1024.0)
    }
}

fn download_progress_percent(downloaded: u64, total_size: u64) -> i32 {
    if total_size == 0 {
        return PROGRESS_INDETERMINATE;
    }

    ((downloaded as f64 / total_size as f64 * 100.0) as i32).clamp(0, 99)
}

fn known_size_download_description(downloaded: u64, total_size: u64, speed: &str) -> String {
    format!(
        "{} / {} ({})",
        format_download_size(downloaded),
        format_download_size(total_size),
        speed
    )
}

fn unknown_size_download_description(downloaded: u64, speed: &str) -> String {
    format!(
        "{} downloaded ({})",
        format_download_size(downloaded),
        speed
    )
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

            ctx.update_full(0, "Starting download...".to_string(), Some(0), Some(1));

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
            if total_size == 0 {
                ctx.update_full(
                    PROGRESS_INDETERMINATE,
                    "Downloading...".to_string(),
                    Some(0),
                    Some(1),
                );
            }

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

                    let speed_fmt = format_download_speed(speed);

                    if total_size > 0 {
                        ctx.update_full(
                            download_progress_percent(downloaded, total_size),
                            known_size_download_description(downloaded, total_size, &speed_fmt),
                            Some(0),
                            Some(1),
                        );
                    } else {
                        ctx.update_full(
                            PROGRESS_INDETERMINATE,
                            unknown_size_download_description(downloaded, &speed_fmt),
                            Some(0),
                            Some(1),
                        );
                    }

                    last_update = now;
                    last_downloaded = downloaded;
                }
            }

            if downloaded > 0 {
                if total_size > 0 {
                    ctx.update_full(
                        download_progress_percent(downloaded, total_size),
                        known_size_download_description(downloaded, total_size, "finalizing"),
                        Some(0),
                        Some(1),
                    );
                } else {
                    ctx.update_full(
                        PROGRESS_INDETERMINATE,
                        unknown_size_download_description(downloaded, "finalizing"),
                        Some(0),
                        Some(1),
                    );
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
            let (file_size, file_mtime) =
                if let Ok(meta) = tokio::fs::metadata(&temp_file_path).await {
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
                        .filter(installed_dsl::source_kind.eq("custom"))
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
                        installed_dsl::source_kind.eq("custom"),
                        installed_dsl::source_modpack_id.eq(Option::<String>::None),
                        installed_dsl::source_modpack_version_id.eq(Option::<String>::None),
                        installed_dsl::source_modpack_platform.eq(Option::<String>::None),
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
                    source_kind: "custom".to_string(),
                    source_modpack_id: None,
                    source_modpack_version_id: None,
                    source_modpack_platform: None,
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

            if let Err(e) =
                crate::resources::update_cache::invalidate_instance_update_snapshot(instance_id)
            {
                log::warn!(
                    "[update_cache] Failed to invalidate snapshot for instance {}: {}",
                    instance_id,
                    e
                );
            }

            // 7. Handle dependencies (Special case for Shaders)
            if resource_type == ResourceType::Shader {
                // TODO: Auto-install Iris/Sodium or Oculus/Embeddium
            }

            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_size_progress_is_visible_but_reserved_for_task_completion() {
        assert_eq!(download_progress_percent(0, 100), 0);
        assert_eq!(download_progress_percent(50, 100), 50);
        assert_eq!(download_progress_percent(100, 100), 99);
        assert_eq!(download_progress_percent(120, 100), 99);
    }

    #[test]
    fn unknown_size_progress_is_indeterminate() {
        assert_eq!(download_progress_percent(10, 0), PROGRESS_INDETERMINATE);
    }

    #[test]
    fn download_descriptions_use_byte_progress_text() {
        assert_eq!(
            known_size_download_description(1024 * 1024, 2 * 1024 * 1024, "12.00 MB/s"),
            "1.0 MB / 2.0 MB (12.00 MB/s)"
        );
        assert_eq!(
            unknown_size_download_description(1024 * 1024, "finalizing"),
            "1.0 MB downloaded (finalizing)"
        );
    }
}
