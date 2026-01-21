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

            // 3. Strict: Identity-backed cleanup
            let mods_dir = gd_path.join("mods");
            if mods_dir.exists() {
                ctx.update_description("Cleaning non-manifest mods...".to_string());
                
                let mut allowed_hashes = HashSet::new();
                let mut allowed_cf_identities = HashSet::new(); // (project_id, file_id)

                for m in &metadata.mods {
                    match m {
                        ModpackMod::Modrinth { hashes, .. } => {
                            if let Some(sha1) = hashes.get("sha1") {
                                allowed_hashes.insert(sha1.clone());
                            }
                        }
                        ModpackMod::CurseForge { project_id, file_id, .. } => {
                            allowed_cf_identities.insert((project_id.unwrap_or(0), *file_id));
                        }
                    }
                }

                // Get all installed resources for this instance
                use crate::schema::installed_resource::dsl as ir_dsl;
                use crate::models::installed_resource::InstalledResource;
                let installed: Vec<InstalledResource> = ir_dsl::installed_resource
                    .filter(ir_dsl::instance_id.eq(inst_id))
                    .load::<InstalledResource>(&mut conn)
                    .map_err(|e| e.to_string())?;

                let mut protected_paths = HashSet::new();
                let mut db_ids_to_delete = Vec::new();

                for res in installed {
                    let mut is_allowed = false;
                    
                    if res.platform == "modpack" {
                        is_allowed = true; // Protect files that were part of modpack overrides
                    } else if res.platform == "modrinth" {
                        if let Some(h) = &res.hash {
                            if allowed_hashes.contains(h) {
                                is_allowed = true;
                            }
                        }
                    } else if res.platform == "curseforge" {
                        let pid = res.remote_id.parse::<u32>().unwrap_or(0);
                        let fid = res.remote_version_id.parse::<u32>().unwrap_or(0);
                        
                        // Check exact (pid, fid)
                        if allowed_cf_identities.contains(&(pid, fid)) {
                            is_allowed = true;
                        } 
                        // Fallback: Check just fid if pid is 0 in manifest or db
                        else if allowed_cf_identities.iter().any(|(_, mfid)| *mfid == fid) {
                             is_allowed = true;
                             log::debug!("[StrictSync] Allowed CF mod {} (RemoteID: {}) via file_id match", res.display_name, res.remote_id);
                        }
                    }

                    if is_allowed {
                        let p = PathBuf::from(&res.local_path);
                        protected_paths.insert(p.clone());
                        
                        // Also protect the toggled variant (e.g. .jar <-> .jar.disabled)
                        let p_str = res.local_path.clone();
                        if p_str.ends_with(".disabled") {
                            protected_paths.insert(PathBuf::from(&p_str[..p_str.len() - 9]));
                        } else {
                            protected_paths.insert(PathBuf::from(format!("{}.disabled", p_str)));
                        }
                    } else {
                        log::info!("[StrictSync] Resource {} (ID: {}) not in manifest, marking for deletion", res.display_name, res.remote_id);
                        db_ids_to_delete.push(res.id.unwrap());
                        let path = PathBuf::from(&res.local_path);
                        if path.exists() {
                            let _ = std::fs::remove_file(&path);
                        }
                    }
                }

                // Final filesystem sweep for untracked files in mods/
                if let Ok(entries) = std::fs::read_dir(&mods_dir) {
                    for entry in entries.filter_map(|e| e.ok()) {
                        let path = entry.path();
                        if path.is_file() {
                            // Check if this file path is protected
                            let is_protected = protected_paths.iter().any(|pp| {
                                // Try to match by canonical path or simple string equality
                                if let (Ok(p1), Ok(p2)) = (std::fs::canonicalize(&path), std::fs::canonicalize(pp)) {
                                    p1 == p2
                                } else {
                                    path == *pp
                                }
                            });

                            if !is_protected {
                                log::info!("[StrictSync] Deleting untracked mod file: {:?}", path.file_name().unwrap_or_default());
                                let _ = std::fs::remove_file(path);
                            }
                        }
                    }
                }

                // Cleanup database
                if !db_ids_to_delete.is_empty() {
                    let _ = diesel::delete(ir_dsl::installed_resource.filter(ir_dsl::id.eq_any(db_ids_to_delete)))
                        .execute(&mut conn);
                }
            }

            Ok(())
        })
    }
}
