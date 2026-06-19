use crate::models::installed_resource::{InstalledResource, NewInstalledResource};
use crate::models::instance::{Instance, NewInstance};
use crate::resources::watcher::ResourceWatcher;
use crate::tasks::installers::InstallInstanceTask;
use crate::tasks::manager::{Task, TaskContext};
use crate::utils::db::get_vesta_conn;
use crate::utils::instance_helpers::{
    compute_unique_name, compute_unique_slug, copy_directory_recursive, count_files_in_directory,
    remap_path_under_root, resolve_clone_source_directory, resolve_instances_root,
};
use anyhow::Result;
use chrono::Utc;
use diesel::dsl::sql;
use diesel::prelude::*;
use diesel::sql_types::BigInt;
use futures::future::BoxFuture;
use std::path::{Path, PathBuf};
use tauri::Manager;

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

    fn id(&self) -> Option<String> {
        Some(format!("clone_instance_{}", self.source_id))
    }

    fn cancellable(&self) -> bool {
        false
    }

    fn show_completion_notification(&self) -> bool {
        true
    }

    fn total_steps(&self) -> i32 {
        4
    }

    fn starting_description(&self) -> String {
        "Preparing to duplicate instance...".to_string()
    }

    fn completion_description(&self) -> String {
        "Successfully duplicated instance".to_string()
    }

    fn run(&self, ctx: TaskContext) -> BoxFuture<'static, Result<(), String>> {
        let source_id = self.source_id;
        let new_name_opt = self.new_name.clone();

        ctx.set_title("Duplicating Instance".to_string());

        Box::pin(async move {
            let mut created_instance_id: Option<i32> = None;
            let mut new_dir = PathBuf::new();

            let result: Result<(), String> = async {
                let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;

                use crate::schema::instance::dsl::*;
                let source = instance
                    .find(source_id)
                    .first::<Instance>(&mut conn)
                    .map_err(|e| format!("Source instance not found: {}", e))?;

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
                let data_dir = app_config_dir.join("data");
                let instances_root =
                    resolve_instances_root(&app_config_dir, config.default_game_dir.as_deref());

                let final_slug = compute_unique_slug(&final_name, &seen_slugs, &instances_root);
                new_dir = instances_root.join(&final_slug);

                ctx.update_full(
                    10,
                    "Locating source instance files...".to_string(),
                    Some(1),
                    Some(4),
                );

                let source_dir =
                    resolve_clone_source_directory(&source, &instances_root, &data_dir)?;

                let source_file_count = count_files_in_directory(&source_dir);
                ctx.update_full(
                    25,
                    format!("Copying files for {}...", final_name),
                    Some(2),
                    Some(4),
                );

                let source_dir_for_copy = source_dir.clone();
                let new_dir_for_copy = new_dir.clone();
                let copied_files = tokio::task::spawn_blocking(move || {
                    copy_directory_recursive(&source_dir_for_copy, &new_dir_for_copy)
                })
                .await
                .map_err(|e| format!("File copy task panicked: {}", e))??;

                if source_file_count > 0 && copied_files == 0 {
                    return Err(
                        "File copy finished but no files were copied from the source instance."
                            .to_string(),
                    );
                }

                ctx.update_full(
                    55,
                    "Creating database record...".to_string(),
                    Some(3),
                    Some(4),
                );

                let new_inst = NewInstance {
                    name: final_name.clone(),
                    minecraft_version: source.minecraft_version.clone(),
                    modloader: source.modloader.clone(),
                    modloader_version: source.modloader_version.clone(),
                    java_path: source.java_path.clone(),
                    java_args: source.java_args.clone(),
                    game_directory: Some(new_dir.to_string_lossy().to_string()),
                    game_width: source.game_width,
                    game_height: source.game_height,
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
                    import_source_game_directory: None,
                    import_launcher_kind: None,
                    import_instance_path: None,
                    use_global_resolution: source.use_global_resolution,
                    use_global_java_args: source.use_global_java_args,
                    use_global_java_path: source.use_global_java_path,
                    use_global_hooks: source.use_global_hooks,
                    use_global_environment_variables: source.use_global_environment_variables,
                    use_global_game_dir: source.use_global_game_dir,
                    use_global_launcher_action: source.use_global_launcher_action,
                    launcher_action_on_launch: source.launcher_action_on_launch.clone(),
                    environment_variables: source.environment_variables.clone(),
                    pre_launch_hook: source.pre_launch_hook.clone(),
                    wrapper_command: source.wrapper_command.clone(),
                    post_exit_hook: source.post_exit_hook.clone(),
                };

                diesel::insert_into(instance)
                    .values(&new_inst)
                    .execute(&mut conn)
                    .map_err(|e| format!("Failed to insert cloned instance: {}", e))?;

                let inserted_id: i64 = diesel::select(sql::<BigInt>("last_insert_rowid()"))
                    .get_result(&mut conn)
                    .map_err(|e| format!("Failed to read inserted instance id: {}", e))?;
                let inserted_id = inserted_id as i32;
                created_instance_id = Some(inserted_id);

                clone_installed_resources(
                    &mut conn,
                    source_id,
                    inserted_id,
                    &source_dir,
                    &new_dir,
                )?;

                ctx.update_full(
                    85,
                    "Indexing duplicated resources...".to_string(),
                    Some(4),
                    Some(4),
                );

                let inserted_inst = instance
                    .find(inserted_id)
                    .first::<Instance>(&mut conn)
                    .map_err(|e| format!("Failed to fetch cloned instance: {}", e))?;

                let watcher = ctx.app_handle.state::<ResourceWatcher>();
                if let Err(e) = watcher
                    .watch_instance(
                        final_slug.clone(),
                        inserted_id,
                        new_dir.to_string_lossy().to_string(),
                    )
                    .await
                {
                    log::warn!(
                        "[CloneInstanceTask] Failed to start resource watcher for {}: {}",
                        final_name,
                        e
                    );
                }

                use tauri::Emitter;
                let _ = ctx.app_handle.emit(
                    "core://instance-created",
                    crate::commands::instances::process_instance_icon(inserted_inst),
                );

                Ok(())
            }
            .await;

            if let Err(error) = result {
                rollback_failed_clone(&ctx.app_handle, created_instance_id, &new_dir).await;
                return Err(format!(
                    "{error} The incomplete copy was removed automatically."
                ));
            }

            Ok(())
        })
    }
}

fn clone_installed_resources<C>(
    conn: &mut C,
    source_instance_id: i32,
    dest_instance_id: i32,
    source_root: &Path,
    dest_root: &Path,
) -> Result<(), String>
where
    C: diesel::Connection<Backend = diesel::sqlite::Sqlite> + diesel::connection::LoadConnection,
{
    use crate::schema::installed_resource::dsl as ir_dsl;

    let source_resources = ir_dsl::installed_resource
        .filter(ir_dsl::instance_id.eq(source_instance_id))
        .load::<InstalledResource>(conn)
        .map_err(|e| format!("Failed to load source resources: {}", e))?;

    for resource in source_resources {
        let new_local_path = remap_path_under_root(&resource.local_path, source_root, dest_root);

        if !new_local_path.is_empty() && !Path::new(&new_local_path).exists() {
            log::warn!(
                "[CloneInstanceTask] Skipping missing cloned resource file: {}",
                new_local_path
            );
            continue;
        }

        let new_resource = NewInstalledResource {
            instance_id: dest_instance_id,
            platform: resource.platform,
            remote_id: resource.remote_id,
            remote_version_id: resource.remote_version_id,
            resource_type: resource.resource_type,
            local_path: new_local_path,
            display_name: resource.display_name,
            current_version: resource.current_version,
            is_manual: resource.is_manual,
            is_enabled: resource.is_enabled,
            last_updated: Utc::now().to_rfc3339(),
            release_type: resource.release_type,
            hash: resource.hash,
            file_size: resource.file_size,
            file_mtime: resource.file_mtime,
            source_kind: resource.source_kind,
            source_modpack_id: resource.source_modpack_id,
            source_modpack_version_id: resource.source_modpack_version_id,
            source_modpack_platform: resource.source_modpack_platform,
        };

        diesel::insert_into(ir_dsl::installed_resource)
            .values(&new_resource)
            .execute(conn)
            .map_err(|e| format!("Failed to clone installed resource: {}", e))?;
    }

    Ok(())
}

async fn rollback_failed_clone(
    app_handle: &tauri::AppHandle,
    instance_id: Option<i32>,
    game_dir: &Path,
) {
    if instance_id.is_none() && !game_dir.exists() {
        return;
    }

    log::warn!(
        "[CloneInstanceTask] Rolling back failed duplicate instance_id={:?} path={}",
        instance_id,
        game_dir.display()
    );

    if let Some(instance_id) = instance_id {
        let watcher = app_handle.state::<ResourceWatcher>();
        if let Err(e) = tokio::time::timeout(
            tokio::time::Duration::from_secs(5),
            watcher.unwatch_instance(instance_id),
        )
        .await
        {
            log::warn!(
                "[CloneInstanceTask] Watcher unwatch timed out during rollback: {}",
                e
            );
        }
    }

    if game_dir.exists() {
        let game_dir = game_dir.to_path_buf();
        if let Err(e) =
            tokio::task::spawn_blocking(move || std::fs::remove_dir_all(&game_dir)).await
        {
            log::warn!(
                "[CloneInstanceTask] Failed to await directory removal during rollback: {}",
                e
            );
        }
    }

    if let Some(instance_id) = instance_id {
        if let Ok(mut conn) = get_vesta_conn() {
            use crate::schema::installed_resource::dsl as ir_dsl;
            use crate::schema::instance::dsl::*;

            let db_result = conn.transaction::<_, diesel::result::Error, _>(|conn| {
                diesel::delete(
                    ir_dsl::installed_resource.filter(ir_dsl::instance_id.eq(instance_id)),
                )
                .execute(conn)?;
                diesel::delete(instance.find(instance_id)).execute(conn)?;
                Ok(())
            });

            if let Err(e) = db_result {
                log::error!(
                    "[CloneInstanceTask] Failed to roll back database records for instance {}: {}",
                    instance_id,
                    e
                );
            } else {
                use tauri::Emitter;
                let _ = app_handle.emit(
                    "core://instance-deleted",
                    serde_json::json!({ "id": instance_id }),
                );
            }
        }
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

    fn id(&self) -> Option<String> {
        Some(format!("reset_instance_{}", self.instance_id))
    }

    fn cancellable(&self) -> bool {
        false
    }

    fn show_completion_notification(&self) -> bool {
        true
    }

    fn starting_description(&self) -> String {
        "Preparing hard reset...".to_string()
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
                    let gd_path_clone = gd_path.clone();
                    tokio::task::spawn_blocking(move || {
                        let _ = std::fs::remove_dir_all(&gd_path_clone);
                    })
                    .await
                    .map_err(|e| format!("Failed to remove instance directory: {}", e))?;
                    std::fs::create_dir_all(&gd_path)
                        .map_err(|e| format!("Failed to recreate instance directory: {}", e))?;
                }
            }

            ctx.update_description("Reinstalling...".to_string());
            let mut install_task = InstallInstanceTask::new(inst);
            install_task.set_update_notification_title(false);
            install_task.run(ctx).await?;

            Ok(())
        })
    }
}

pub struct RepairInstanceTask {
    instance_id: i32,
    scope: Option<String>,
}

impl RepairInstanceTask {
    pub fn new(instance_id: i32) -> Self {
        Self {
            instance_id,
            scope: None,
        }
    }

    pub fn with_scope(instance_id: i32, scope: String) -> Self {
        Self {
            instance_id,
            scope: Some(scope),
        }
    }
}

impl Task for RepairInstanceTask {
    fn name(&self) -> String {
        "Repairing Instance".to_string()
    }

    fn id(&self) -> Option<String> {
        Some(format!("repair_instance_{}", self.instance_id))
    }

    fn cancellable(&self) -> bool {
        true
    }

    fn show_completion_notification(&self) -> bool {
        true
    }

    fn starting_description(&self) -> String {
        "Preparing repair...".to_string()
    }

    fn completion_description(&self) -> String {
        "Repair completed".to_string()
    }

    fn run(&self, ctx: TaskContext) -> BoxFuture<'static, Result<(), String>> {
        let inst_id = self.instance_id;
        let scope = self.scope.clone();

        Box::pin(async move {
            let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
            use crate::schema::instance::dsl::*;

            let mut inst = instance
                .find(inst_id)
                .first::<Instance>(&mut conn)
                .map_err(|e| format!("Instance not found: {}", e))?;
            let app_handle = ctx.app_handle.clone();

            let config_dir =
                crate::utils::db_manager::get_app_config_dir().map_err(|e| e.to_string())?;
            let data_dir = config_dir.join("data");
            let game_dir = inst
                .game_directory
                .as_ref()
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| data_dir.join("instances").join(&inst.slug()));

            if let Ok(modpack_manifest) =
                piston_lib::game::modpack::manifest::ModpackManifest::load(&game_dir)
            {
                if crate::utils::instance_runtime::runtime_drifts_from_manifest(
                    &inst,
                    &modpack_manifest,
                ) {
                    log::info!(
                        "[RepairInstanceTask] Syncing instance runtime from modpack manifest (MC {} → {}, loader {:?} → {} {:?})",
                        inst.minecraft_version,
                        modpack_manifest.minecraft_version,
                        inst.modloader,
                        modpack_manifest.modloader.loader_type,
                        modpack_manifest.modloader.version,
                    );
                    inst = crate::utils::instance_runtime::sync_fields(
                        inst.id,
                        &crate::utils::instance_runtime::InstanceRuntimeFields::from_manifest(
                            &modpack_manifest,
                        ),
                    )?;
                }
            }

            // Resolve repair scope
            let repair_scope = match scope.as_deref() {
                Some("versions") => "versions",
                Some("libraries") => "libraries",
                Some("resources") => "resources",
                _ => "full",
            };

            // Phase 1: Verification with progress
            ctx.update_full(
                5,
                format!("Verifying instance integrity (scope: {})...", repair_scope),
                Some(0),
                Some(3),
            );

            let version_id = inst.minecraft_version.clone();

            let mut spec = piston_lib::game::installer::types::InstallSpec::new(
                version_id,
                data_dir,
                game_dir.clone(),
            );
            spec.java_path = inst.java_path.as_ref().map(std::path::PathBuf::from);
            // Pass modloader info so the verifier uses the correct manifest
            // (e.g. fabric-loader-X-1.20.1 instead of vanilla 1.20.1)
            spec.modloader = inst.modloader.as_deref().and_then(|m| match m {
                "fabric" => Some(piston_lib::game::installer::types::ModloaderType::Fabric),
                "quilt" => Some(piston_lib::game::installer::types::ModloaderType::Quilt),
                "forge" => Some(piston_lib::game::installer::types::ModloaderType::Forge),
                "neoforge" => Some(piston_lib::game::installer::types::ModloaderType::NeoForge),
                _ => None,
            });
            spec.modloader_version = inst.modloader_version.clone();
            spec.remediation_policy =
                piston_lib::game::installer::types::RemediationPolicy::RepairIfNeeded;
            spec.repair_scope = match repair_scope {
                "versions" => piston_lib::game::installer::types::RepairScope::Versions,
                "libraries" => piston_lib::game::installer::types::RepairScope::Libraries,
                "resources" => piston_lib::game::installer::types::RepairScope::Resources,
                _ => piston_lib::game::installer::types::RepairScope::Full,
            };

            if repair_scope == "full" || repair_scope == "versions" {
                let installed_id = spec.installed_version_id();
                let version_manifest_path = spec
                    .versions_dir()
                    .join(&installed_id)
                    .join(format!("{installed_id}.json"));
                if version_manifest_path.exists() {
                    if let Err(e) = piston_lib::game::launcher::unified_manifest::UnifiedManifest::normalize_and_save_if_stale(
                        &version_manifest_path,
                    ) {
                        log::warn!(
                            "[RepairInstanceTask] Failed to normalize version manifest at {:?}: {}",
                            version_manifest_path,
                            e
                        );
                    }
                }
            }

            // Run verification (blocking — may take a moment for SHA1 checks)
            ctx.update_progress(20, Some(0), Some(3));
            let verify_result = piston_lib::game::installer::verify_instance(&spec)
                .map_err(|e| format!("Verification failed: {}", e))?;

            log::info!(
                "[RepairInstanceTask] Verification: ready={}, issues={}",
                verify_result.ready,
                verify_result.issues.len()
            );

            // Phase 2: If not ready, run installer to fix version/lib issues
            if !verify_result.ready && repair_scope != "resources" {
                ctx.update_full(
                    30,
                    "Repairing instance files...".to_string(),
                    Some(1),
                    Some(3),
                );
                let mut install_task = InstallInstanceTask::new(inst.clone());
                install_task.set_update_notification_title(false);
                install_task.run(ctx.clone()).await?;
                ctx.update_progress(80, Some(1), Some(3));
            } else if verify_result.ready {
                ctx.update_full(
                    50,
                    "Instance files verified — no issues found.".to_string(),
                    Some(2),
                    Some(3),
                );
            }

            // Phase 3: Modpack repair (if applicable)
            let manifest_path = game_dir.join("modpack_manifest.json");
            let mut repair_error: Option<String> = None;
            if repair_scope == "full" || repair_scope == "resources" {
                if manifest_path.exists() {
                    log::info!(
                        "[RepairInstanceTask] Found modpack manifest, running modpack repair"
                    );
                    if let Ok(mut manifest) =
                        piston_lib::game::modpack::manifest::ModpackManifest::load(&game_dir)
                    {
                        if let Err(e) = crate::sync::manifest::backfill_manifest_hashes(
                            &mut manifest,
                            &game_dir,
                            inst_id,
                        ) {
                            log::warn!(
                                "[RepairInstanceTask] Failed to backfill manifest hashes: {}",
                                e
                            );
                        } else if let Err(e) = manifest.persist(&game_dir) {
                            log::warn!(
                                "[RepairInstanceTask] Failed to persist backfilled manifest: {}",
                                e
                            );
                        }
                    }
                    ctx.update_full(
                        85,
                        "Repairing modpack files...".to_string(),
                        Some(2),
                        Some(3),
                    );
                    let repair_reporter: std::sync::Arc<
                        dyn piston_lib::game::installer::types::ProgressReporter,
                    > = std::sync::Arc::new(
                        piston_lib::game::installer::types::SilentProgressReporter,
                    );
                    let resolver: std::sync::Arc<
                        dyn piston_lib::game::installer::core::modpack_installer::ModpackResolver,
                    > = std::sync::Arc::new(
                        crate::tasks::installers::modpack::PistonModpackResolver::new(
                            app_handle.clone(),
                        ),
                    );
                    match piston_lib::game::installer::core::modpack_installer::ModpackInstaller::repair_modpack(
                        &game_dir,
                        false,
                        repair_reporter,
                        Some(resolver),
                    ).await {
                        Ok(repaired) => {
                            log::info!("[RepairInstanceTask] Modpack repair complete");
                            crate::tasks::installers::modpack::spawn_manifest_resource_linking(
                                &app_handle,
                                inst_id,
                                &game_dir,
                                &repaired,
                            );
                        }
                        Err(e) => {
                            log::warn!("[RepairInstanceTask] Modpack repair failed: {}", e);
                            repair_error = Some(e.to_string());
                        }
                    }
                } else if inst.modpack_id.is_some()
                    && inst.modpack_version_id.is_some()
                    && inst.modpack_platform.is_some()
                {
                    log::info!(
                        "[RepairInstanceTask] No manifest found, but instance is linked to modpack {}/{} — bootstrapping",
                        inst.modpack_platform.as_deref().unwrap_or("?"),
                        inst.modpack_id.as_deref().unwrap_or("?")
                    );
                    ctx.update_full(
                        85,
                        "Reconstructing modpack manifest...".to_string(),
                        Some(2),
                        Some(3),
                    );

                    let progress = crate::sync::manifest_bootstrap::TaskBootstrapProgress(&ctx);
                    match crate::sync::manifest_bootstrap::ensure_old_manifest(
                        &app_handle,
                        &inst,
                        &game_dir,
                        Some(&progress),
                    )
                    .await
                    {
                        Ok(_) => {
                            let repair_reporter: std::sync::Arc<
                                dyn piston_lib::game::installer::types::ProgressReporter,
                            > = std::sync::Arc::new(
                                piston_lib::game::installer::types::SilentProgressReporter,
                            );
                            let resolver: std::sync::Arc<
                                dyn piston_lib::game::installer::core::modpack_installer::ModpackResolver,
                            > = std::sync::Arc::new(
                                crate::tasks::installers::modpack::PistonModpackResolver::new(
                                    app_handle.clone(),
                                ),
                            );
                            match piston_lib::game::installer::core::modpack_installer::ModpackInstaller::repair_modpack(
                                &game_dir,
                                false,
                                repair_reporter,
                                Some(resolver),
                            ).await {
                                Ok(repaired) => {
                                    log::info!("[RepairInstanceTask] Modpack repair complete");
                                    crate::tasks::installers::modpack::spawn_manifest_resource_linking(
                                        &app_handle,
                                        inst_id,
                                        &game_dir,
                                        &repaired,
                                    );
                                }
                                Err(e) => {
                                    log::warn!("[RepairInstanceTask] Modpack repair failed: {}", e);
                                    repair_error = Some(e.to_string());
                                }
                            }
                        }
                        Err(e) => {
                            log::warn!(
                                "[RepairInstanceTask] Failed to bootstrap modpack manifest: {}",
                                e
                            );
                            repair_error = Some(e);
                        }
                    }
                } else {
                    log::info!(
                        "[RepairInstanceTask] No modpack manifest at {:?} and instance is not linked — resource repair skipped",
                        manifest_path
                    );
                }
            }

            let total_issues = verify_result.issues.len();
            let final_desc = match (&repair_error, total_issues, verify_result.ready) {
                (Some(err), _, _) => format!(
                    "Repair completed with warnings: modpack repair failed — {}",
                    err
                ),
                (None, 0, true) => "All files verified — no issues found.".to_string(),
                (None, _, _) => format!(
                    "Repair complete. {} issue(s) were found and fixed.",
                    total_issues
                ),
            };
            ctx.update_full(95, final_desc, Some(3), Some(3));

            ctx.update_description("Setting up Java runtime...".to_string());
            if let Err(e) =
                crate::utils::java::ensure_java_for_instance(&app_handle, &inst, None, None).await
            {
                return Err(format!("Java setup failed after repair: {}", e));
            }

            // Update instance status to installed (same as InstallInstanceTask)
            if inst.id > 0 {
                if let Err(e) = crate::commands::instances::update_installation_status(
                    &app_handle,
                    inst.id,
                    "installed",
                ) {
                    log::error!("[RepairInstanceTask] Failed to update status: {}", e);
                }

                // Emit event so frontend refreshes the instance card
                use tauri::Emitter;
                match crate::commands::instances::get_instance(inst.id) {
                    Ok(updated_instance) => {
                        let _ = app_handle.emit("core://instance-installed", updated_instance);
                    }
                    Err(e) => {
                        log::warn!(
                            "[RepairInstanceTask] Failed to fetch instance payload: {}",
                            e
                        );
                    }
                }
            }

            ctx.update_progress(100, Some(3), Some(3));
            Ok(())
        })
    }
}

pub struct DeleteInstanceTask {
    instance_id: i32,
}

impl DeleteInstanceTask {
    pub fn new(instance_id: i32) -> Self {
        Self { instance_id }
    }
}

impl Task for DeleteInstanceTask {
    fn name(&self) -> String {
        "Deleting Instance".to_string()
    }

    fn id(&self) -> Option<String> {
        Some(format!("delete_instance_{}", self.instance_id))
    }

    fn cancellable(&self) -> bool {
        false
    }

    fn show_completion_notification(&self) -> bool {
        true
    }

    fn starting_description(&self) -> String {
        "Preparing uninstall...".to_string()
    }

    fn completion_description(&self) -> String {
        "Instance deleted".to_string()
    }

    fn run(&self, ctx: TaskContext) -> BoxFuture<'static, Result<(), String>> {
        let instance_id = self.instance_id;

        Box::pin(async move {
            log::info!("[delete_instance_task] start instance_id={}", instance_id);
            ctx.update_full(5, "Stopping watcher...".to_string(), Some(1), Some(5));
            let watcher = ctx
                .app_handle
                .state::<crate::resources::watcher::ResourceWatcher>();
            if let Err(e) = tokio::time::timeout(
                tokio::time::Duration::from_secs(5),
                watcher.unwatch_instance(instance_id),
            )
            .await
            {
                log::warn!(
                    "[delete_instance_task] unwatch timeout instance_id={} error={}",
                    instance_id,
                    e
                );
            }

            ctx.update_full(
                25,
                "Resolving instance details...".to_string(),
                Some(2),
                Some(5),
            );
            let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
            use crate::schema::instance::dsl::*;

            let inst = instance
                .find(instance_id)
                .first::<Instance>(&mut conn)
                .map_err(|e| format!("Instance not found: {}", e))?;
            let slug_val = inst.slug();
            let game_dir = inst.game_directory.clone();

            if let Some(gd) = game_dir {
                ctx.update_full(
                    55,
                    "Removing instance files...".to_string(),
                    Some(3),
                    Some(5),
                );
                let gd_path = std::path::PathBuf::from(gd);
                if gd_path.exists() {
                    tokio::task::spawn_blocking({
                        let path = gd_path.clone();
                        move || std::fs::remove_dir_all(&path)
                    })
                    .await
                    .map_err(|e| format!("Failed to await instance removal task: {}", e))?
                    .map_err(|e| {
                        format!(
                            "Failed to remove instance files at '{}': {}",
                            gd_path.display(),
                            e
                        )
                    })?;
                }
            }

            ctx.update_full(
                80,
                "Removing database references...".to_string(),
                Some(4),
                Some(5),
            );
            conn.transaction::<_, diesel::result::Error, _>(|conn| {
                diesel::delete(
                    crate::schema::installed_resource::dsl::installed_resource.filter(
                        crate::schema::installed_resource::dsl::instance_id.eq(instance_id),
                    ),
                )
                .execute(conn)?;

                diesel::delete(instance.find(instance_id)).execute(conn)?;
                Ok(())
            })
            .map_err(|e| format!("Failed to delete instance from database: {}", e))?;

            ctx.update_full(95, "Finalizing...".to_string(), Some(5), Some(5));
            use tauri::Emitter;
            let _ = ctx.app_handle.emit(
                "core://instance-deleted",
                serde_json::json!({ "id": instance_id }),
            );
            log::info!(
                "[delete_instance_task] completed instance_id={} slug={}",
                instance_id,
                slug_val
            );
            Ok(())
        })
    }
}
