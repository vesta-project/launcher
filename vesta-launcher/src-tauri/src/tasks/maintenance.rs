use crate::models::instance::{Instance, NewInstance};
use crate::tasks::installers::InstallInstanceTask;
use crate::tasks::manager::{Task, TaskContext};
use crate::utils::db::get_vesta_conn;
use crate::utils::instance_helpers::{compute_unique_name, compute_unique_slug};
use anyhow::Result;
use chrono::Utc;
use diesel::prelude::*;
use futures::future::BoxFuture;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

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
            let existing_instances: Vec<Instance> =
                instance.load(&mut conn).map_err(|e| e.to_string())?;
            let mut seen_names = std::collections::HashSet::new();
            let mut seen_slugs = std::collections::HashSet::new();
            for inst in existing_instances {
                seen_names.insert(inst.name.to_lowercase());
                seen_slugs.insert(inst.slug());
            }

            let base_name = new_name_opt.unwrap_or_else(|| source.name.clone());
            let final_name = compute_unique_name(&base_name, &seen_names);

            let config = crate::utils::config::get_app_config().map_err(|e| e.to_string())?;
            let app_config_dir =
                crate::utils::db_manager::get_app_config_dir().map_err(|e| e.to_string())?;
            let instances_root = config
                .default_game_dir
                .as_ref()
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
                last_operation: None,
            };

            diesel::insert_into(instance)
                .values(&new_inst)
                .execute(&mut conn)
                .map_err(|e| format!("Failed to insert cloned instance: {}", e))?;

            // Fetch the inserted instance and emit created event
            let inserted_inst = instance
                .order(id.desc())
                .first::<Instance>(&mut conn)
                .map_err(|e| format!("Failed to fetch cloned instance: {}", e))?;

            use tauri::Emitter;
            let _ = ctx
                .app_handle
                .emit("core://instance-created", crate::commands::instances::process_instance_icon(inserted_inst));

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
