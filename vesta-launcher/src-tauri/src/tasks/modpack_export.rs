use crate::tasks::manager::{Task, TaskContext, BoxFuture};
use piston_lib::game::modpack::exporter::{export_modpack, ExportSpec, ExportEntry};
use piston_lib::game::modpack::types::ModpackFormat;
use crate::tasks::installers::TauriProgressReporter;
use piston_lib::game::installer::types::{CancelToken, ProgressReporter};
use crate::resources::ResourceManager;
use crate::models::resource::SourcePlatform;
use std::sync::Arc;
use tokio::sync::RwLock;
use std::path::PathBuf;

pub struct ModpackExportTask {
    pub instance_name: String,
    pub game_dir: String,
    pub output_path: String,
    pub modpack_format: ModpackFormat,
    pub spec: ExportSpec,
    pub resource_manager: ResourceManager,
}

impl Task for ModpackExportTask {
    fn name(&self) -> String {
        format!("Exporting Modpack: {}", self.instance_name)
    }

    fn id(&self) -> Option<String> {
        Some(format!("export_{}", self.instance_name))
    }

    fn cancellable(&self) -> bool {
        true
    }

    fn show_completion_notification(&self) -> bool {
        true
    }

    fn starting_description(&self) -> String {
        format!("Creating {} modpack for {}...", 
            match self.modpack_format {
                ModpackFormat::Modrinth => "Modrinth",
                ModpackFormat::CurseForge => "CurseForge",
            },
            self.instance_name
        )
    }

    fn completion_description(&self) -> String {
        format!("Successfully exported to {}", self.output_path)
    }

    fn run(&self, ctx: TaskContext) -> BoxFuture<'static, Result<(), String>> {
        let game_dir = self.game_dir.clone();
        let output_path = self.output_path.clone();
        let format = self.modpack_format;
        let mut spec = self.spec.clone();
        let rm = self.resource_manager.clone();

        let reporter = Arc::new(TauriProgressReporter {
            app_handle: ctx.app_handle.clone(),
            notification_id: ctx.notification_id.clone(),
            cancel_token: CancelToken::new(ctx.cancel_rx.clone()),
            pause_rx: ctx.pause_rx.clone(),
            current_step: Arc::new(RwLock::new(String::new())),
            dry_run: false,
            last_emit: Arc::new(std::sync::Mutex::new(std::time::Instant::now())),
            last_percent: std::sync::atomic::AtomicI32::new(0),
        });

        Box::pin(async move {
            // If exporting to CurseForge, we need to ensure we have numeric IDs for linking.
            // If IDs are non-numeric (e.g. from Modrinth), we try to resolve them via hash.
            if format == ModpackFormat::CurseForge {
                reporter.set_message("Resolving CurseForge identifiers...");
                reporter.set_percent(-1); // Indeterminate during resolution
                let mut resolved_count = 0;

                for entry in spec.entries.iter_mut() {
                    if reporter.is_cancelled() {
                        return Err("Export cancelled".to_string());
                    }

                    if let ExportEntry::Mod { path, source_id, version_id, external_ids, .. } = entry {
                        let is_numeric = !version_id.is_empty() && version_id.chars().all(|c| c.is_ascii_digit());
                        
                        // If not numeric, try to resolve via CurseForge fingerprint
                        if !is_numeric {
                            let full_path = PathBuf::from(&game_dir).join(&path);
                            if full_path.exists() {
                                if let Ok(fp) = crate::utils::hash::calculate_curseforge_fingerprint(&full_path) {
                                    if let Ok((p, v)) = rm.get_by_hash(SourcePlatform::CurseForge, &fp.to_string()).await {
                                        *source_id = p.id;
                                        *version_id = v.id;
                                        *external_ids = p.external_ids;
                                        resolved_count += 1;
                                    }
                                }
                            }
                        }
                    }
                }
                log::info!("[ModpackExportTask] Resolved {} CurseForge identifiers via hash lookup", resolved_count);
            }

            // Run the export in a blocking thread since it's a CPU/IO intensive sync operation
            tokio::task::spawn_blocking(move || {
                export_modpack(game_dir, spec, output_path, format, reporter.as_ref())
                    .map_err(|e| format!("Export failed: {}", e))
            })
            .await
            .map_err(|e| e.to_string())?
        })
    }
}

