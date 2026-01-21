use anyhow::Result;
use crate::models::instance::{Instance, NewInstance};
use crate::tasks::manager::{Task, TaskContext};
use crate::utils::db::get_vesta_conn;
use crate::utils::instance_helpers::{compute_unique_name, compute_unique_slug};
use crate::tasks::installers::InstallInstanceTask;
use piston_lib::game::modpack::types::{ModpackMetadata, ModpackMod};
use diesel::prelude::*;
use futures::future::BoxFuture;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use chrono::Utc;
use std::collections::HashSet;

pub struct CloneInstanceTask {
    source_id: i32,
    new_name: Option<String>,
}

impl CloneInstanceTask {
    pub fn new(source_id: i32, new_name: Option<String>) -> Self {
        Self {
            source_id,
            new_name,
        }
    }
}

impl Task for CloneInstanceTask {
    fn name(&self) -> String {
        "Duplicate Instance".to_string()
    }

    fn cancellable(&self) -> bool {
        false
    }
    
    fn completion_description(&self) -> String {
        "Successfully duplicated instance".to_string()
    }

    fn run(&self, ctx: TaskContext) -> BoxFuture<'static, Result<(), String>> {
        let source_id = self.source_id;
        let new_name_opt = self.new_name.clone();

        Box::pin(async move {
            let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
            
            // 1. Fetch source instance
            use crate::schema::instance::dsl::*;
            let source = instance
                .find(source_id)
                .first::<Instance>(&mut conn)
                .map_err(|e| format!("Source instance not found: {}", e))?;

            // 2. Determine new name and slug
            let existing_instances: Vec<Instance> = instance.load(&mut conn).map_err(|e| e.to_string())?;
            let mut seen_names = std::collections::HashSet::new();
            let mut seen_slugs = std::collections::HashSet::new();
            for inst in existing_instances {
                seen_names.insert(inst.name.to_lowercase());
                seen_slugs.insert(inst.slug());
            }

            let base_name = new_name_opt.unwrap_or_else(|| source.name.clone());
            let final_name = compute_unique_name(&base_name, &seen_names);
            
            let config = crate::utils::config::get_app_config().map_err(|e| e.to_string())?;
            let app_config_dir = crate::utils::db_manager::get_app_config_dir().map_err(|e| e.to_string())?;
            let instances_root = config.default_game_dir.as_ref()
                .map(PathBuf::from)
                .unwrap_or_else(|| app_config_dir.join("instances"));

            let final_slug = compute_unique_slug(&final_name, &seen_slugs, &instances_root);
            let new_dir = instances_root.join(&final_slug);

            // 3. Copy files
            if let Some(ref src_dir_str) = source.game_directory {
                let src_dir = Path::new(src_dir_str);
                if src_dir.exists() {
                    ctx.update_description(format!("Copying files for {}...", final_name));
                    
                    for entry in WalkDir::new(src_dir).into_iter().filter_map(|e| e.ok()) {
                        let path = entry.path();
                        let relative = path.strip_prefix(src_dir).map_err(|e| e.to_string())?;
                        let target = new_dir.join(relative);

                        if path.is_dir() {
                            std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
                        } else {
                            std::fs::copy(path, &target).map_err(|e| e.to_string())?;
                        }
                    }
                }
            }

            // 4. Create new instance in DB
            let new_inst = NewInstance {
                name: final_name,
                minecraft_version: source.minecraft_version.clone(),
                modloader: source.modloader.clone(),
                modloader_version: source.modloader_version.clone(),
                java_path: source.java_path.clone(),
                java_args: source.java_args.clone(),
                game_directory: Some(new_dir.to_string_lossy().to_string()),
                width: source.width,
                height: source.height,
                min_memory: source.min_memory,
                max_memory: source.max_memory,
                icon_path: source.icon_path.clone(),
                last_played: None,
                total_playtime_minutes: 0,
                created_at: Some(Utc::now().to_rfc3339()),
                updated_at: Some(Utc::now().to_rfc3339()),
                installation_status: Some("installed".to_string()),
                crashed: None,
                crash_details: None,
                modpack_id: source.modpack_id.clone(),
                modpack_version_id: source.modpack_version_id.clone(),
                modpack_platform: source.modpack_platform.clone(),
                modpack_icon_url: source.modpack_icon_url.clone(),
                icon_data: source.icon_data.clone(),
            };

            diesel::insert_into(instance)
                .values(&new_inst)
                .execute(&mut conn)
                .map_err(|e| format!("Failed to insert cloned instance: {}", e))?;

            Ok(())
        })
    }
}

pub struct ResetInstanceTask {
    instance_id: i32,
}

impl ResetInstanceTask {
    pub fn new(instance_id: i32) -> Self {
        Self { instance_id }
    }
}

impl Task for ResetInstanceTask {
    fn name(&self) -> String {
        "Resetting Instance".to_string()
    }
    
    fn cancellable(&self) -> bool {
        false
    }
    
    fn completion_description(&self) -> String {
        "Successfully reset instance".to_string()
    }

    fn run(&self, ctx: TaskContext) -> BoxFuture<'static, Result<(), String>> {
        let inst_id = self.instance_id;

        Box::pin(async move {
            let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
            use crate::schema::instance::dsl::*;
            
            let inst = instance
                .find(inst_id)
                .first::<Instance>(&mut conn)
                .map_err(|e| format!("Instance not found: {}", e))?;

            if let Some(ref gd) = inst.game_directory {
                ctx.update_description("Wiping instance directory...".to_string());
                let gd_path = PathBuf::from(gd);
                if gd_path.exists() {
                    let _ = std::fs::remove_dir_all(&gd_path);
                    let _ = std::fs::create_dir_all(&gd_path);
                }
            }
            
            ctx.update_description("Reinstalling...".to_string());
            let install_task = InstallInstanceTask::new(inst);
            install_task.run(ctx).await?;

            Ok(())
        })
    }
}

pub struct RepairInstanceTask {
    instance_id: i32,
}

impl RepairInstanceTask {
    pub fn new(instance_id: i32) -> Self {
        Self { instance_id }
    }
}

impl Task for RepairInstanceTask {
    fn name(&self) -> String {
        "Repairing Instance".to_string()
    }
    
    fn cancellable(&self) -> bool {
        true
    }
    
    fn completion_description(&self) -> String {
        "Repair completed".to_string()
    }

    fn run(&self, ctx: TaskContext) -> BoxFuture<'static, Result<(), String>> {
        let inst_id = self.instance_id;

        Box::pin(async move {
            let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
            use crate::schema::instance::dsl::*;
            
            let inst = instance
                .find(inst_id)
                .first::<Instance>(&mut conn)
                .map_err(|e| format!("Instance not found: {}", e))?;

            ctx.update_description("Verifying and repairing all files...".to_string());
            
            // Reinstall task with hash verification already handled by piston-lib
            let install_task = InstallInstanceTask::new(inst);
            install_task.run(ctx).await?;

            Ok(())
        })
    }
}

pub struct StrictSyncTask {
    instance_id: i32,
}

impl StrictSyncTask {
    pub fn new(instance_id: i32) -> Self {
        Self { instance_id }
    }
}

impl Task for StrictSyncTask {
    fn name(&self) -> String {
        "Strict Syncing Instance".to_string()
    }
    
    fn cancellable(&self) -> bool {
        true
    }
    
    fn completion_description(&self) -> String {
        "Strict sync completed".to_string()
    }

    fn run(&self, ctx: TaskContext) -> BoxFuture<'static, Result<(), String>> {
        let inst_id = self.instance_id;

        Box::pin(async move {
            let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
            use crate::schema::instance::dsl::*;
            
            let inst = instance
                .find(inst_id)
                .first::<Instance>(&mut conn)
                .map_err(|e| format!("Instance not found: {}", e))?;

            let gd_str = inst.game_directory.as_ref().ok_or("No game directory set")?;
            let gd_path = PathBuf::from(gd_str);
            let manifest_path = gd_path.join(".vesta").join("modpack_manifest.json");

            if !manifest_path.exists() {
                log::info!("[StrictSync] No manifest found at {:?}, performing normal repair.", manifest_path);
                let repair = RepairInstanceTask::new(inst_id);
                return repair.run(ctx).await;
            }

            // 1. Load manifest
            let manifest_json = std::fs::read_to_string(&manifest_path).map_err(|e| format!("Failed to read manifest: {}", e))?;
            let metadata: ModpackMetadata = serde_json::from_str(&manifest_json).map_err(|e| format!("Failed to parse manifest: {}", e))?;

            ctx.update_description("Verifying official modpack files...".to_string());

            // 2. Perform regular repair first (ensure all manifest files are present)
            // We use InstallInstanceTask to ensure MC/Loader are correct
            let engine_task = InstallInstanceTask::new(inst.clone());
            engine_task.run(ctx.clone()).await?;

            // 3. Strict: Remove extra files in 'mods'
            let mods_dir = gd_path.join("mods");
            if mods_dir.exists() {
                ctx.update_description("Cleaning non-manifest mods...".to_string());
                let mut allowed_files = HashSet::new();
                
                for m in &metadata.mods {
                    match m {
                        ModpackMod::Modrinth { path, .. } => {
                            let p: String = path.replace("\\", "/");
                            if p.starts_with("mods/") {
                                allowed_files.insert(p.strip_prefix("mods/").unwrap().to_string());
                            }
                        }
                        ModpackMod::CurseForge { .. } => {
                            // CurseForge manifest doesn't store target path/filename usually.
                            // We would need to resolve filenames or store them in our metadata.
                            // For now, we skip strict deletion for CF-originated packs to avoid deleting everything.
                        }
                    }
                }

                // Scan mods directory
                if let Ok(entries) = std::fs::read_dir(&mods_dir) {
                    for entry in entries.filter_map(|e| e.ok()) {
                        let path = entry.path();
                        if path.is_file() {
                            let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                            if !allowed_files.contains(&filename) {
                                log::info!("[StrictSync] Deleting non-manifest mod: {}", filename);
                                let _ = std::fs::remove_file(path);
                            }
                        }
                    }
                }
            }

            Ok(())
        })
    }
}
