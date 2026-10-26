use super::*;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRequest {
    pub review_id: String,
    pub consent_revision: Option<String>,
    pub name: Option<String>,
    #[serde(default)]
    pub link_only: bool,
}

impl ServerManager {
    pub async fn pack_sync_apply(&self, app: &AppHandle, request: ApplyRequest) -> Result<i32> {
        use crate::tasks::manager::*;
        let _gate = self.pack_gate.lock().await;
        let plan = self
            .pack_previews
            .lock()
            .await
            .remove(&request.review_id)
            .ok_or_else(|| conflict("pack_review_expired"))?;
        if plan.created.elapsed().as_secs() >= 900 {
            return Err(conflict("pack_review_expired"));
        }
        if plan.preview.consent_required
            && request.consent_revision.as_deref() != Some(plan.preview.revision.as_str())
            && !request.link_only
        {
            return Err(conflict("pack_executable_consent_required"));
        }
        let existing = plan
            .preview
            .instance_id
            .map(crate::commands::instances::get_instance)
            .transpose()
            .map_err(io)?;
        let (active, old) = self
            .verified_release(&plan.preview.connection_id, existing.as_ref())
            .await?;
        if active.revision != plan.release.revision
            || active.sha256 != plan.release.sha256
            || active.server_id != plan.release.server_id
            || active.fingerprint != plan.release.fingerprint
        {
            return Err(conflict("pack_review_stale"));
        }
        if old.as_ref().map(|r| (&r.revision, &r.sha256))
            != plan.old.as_ref().map(|r| (&r.revision, &r.sha256))
        {
            return Err(conflict("pack_review_stale"));
        }
        if request.link_only && existing.is_none() {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        let instance = if let Some(i) = existing {
            i
        } else {
            let t = &plan.preview.runtime;
            let i = Instance {
                name: request
                    .name
                    .filter(|n| !n.trim().is_empty())
                    .unwrap_or_else(|| plan.preview.name.clone()),
                minecraft_version: t.minecraft_version.clone(),
                modloader: Some(t.loader.clone()),
                modloader_version: t.loader_version.clone(),
                installation_status: Some("skip-initial-watch".into()),
                ..Instance::default()
            };
            let id = crate::commands::instances::create_instance(
                app.clone(),
                i,
                app.state::<crate::resources::watcher::ResourceWatcher>(),
            )
            .await
            .map_err(io)?;
            crate::commands::instances::get_instance(id).map_err(io)?
        };
        let tasks = app.state::<TaskManager>();
        let _play = tasks
            .acquire_conflicts([
                instance_play_conflict_key(instance.id),
                mods_conflict_key(instance.id),
                resourcepacks_conflict_key(instance.id),
                shaderpacks_conflict_key(instance.id),
                saves_conflict_key(instance.id),
            ])
            .await;
        let instance = crate::commands::instances::get_instance(instance.id).map_err(io)?;
        if piston_lib::game::launcher::is_instance_running(&instance.slug())
            .await
            .map_err(io)?
        {
            return Err(conflict("pack_instance_running"));
        }
        if runtime(&instance) != plan.preview.runtime {
            return Err(conflict("pack_incompatible_runtime"));
        }
        let root = game_dir(&instance)?;
        std::fs::create_dir_all(&root).map_err(io)?;
        if crate::modpack::update::has_pending_recovery(&root) {
            return Err(conflict("pack_recovery_required"));
        }
        let changes = diff(&root, old.as_ref(), &plan.files)?;
        if request.link_only && !changes.is_empty() {
            return Err(conflict("pack_existing_files_mismatch"));
        }
        // A changed file set after review needs another review, including when a
        // previously matching local executable has been removed in the meantime.
        if plan.preview.instance_id.is_some()
            && serde_json::to_value(&changes).map_err(io)?
                != serde_json::to_value(&plan.preview.changes).map_err(io)?
        {
            return Err(conflict("pack_review_stale"));
        }
        let receipt = Receipt {
            revision: plan.release.revision.clone(),
            sha256: plan.release.sha256.clone(),
            runtime: plan.preview.runtime.clone(),
            files: plan.files.clone(),
        };
        let previously_linked = self.pack_link(instance.id).await?.is_some();
        crate::modpack::update::begin(app, &instance, &root, &plan.release.revision).map_err(io)?;
        let mut status_guard =
            crate::modpack::update::StatusGuard::new(app.clone(), instance.id, root.clone());
        let result: Result<()> = async {
            // The existing installer owns Minecraft, loader, Java and shared
            // artifact verification. Pack code never implements a second runtime.
            if !request.link_only {
                let reporter = Arc::new(piston_lib::game::installer::types::SilentProgressReporter);
                let java = crate::utils::java::ensure_java_for_instance(
                    app,
                    &instance,
                    Some(reporter.as_ref()),
                    None,
                )
                .await
                .map_err(io)?;
                let mut spec = piston_lib::game::installer::types::InstallSpec::new(
                    instance.minecraft_version.clone(),
                    self.root.join("data"),
                    root.clone(),
                );
                use piston_lib::game::installer::types::ModloaderType;
                spec.modloader = match plan.preview.runtime.loader.as_str() {
                    "fabric" => Some(ModloaderType::Fabric),
                    "quilt" => Some(ModloaderType::Quilt),
                    "forge" => Some(ModloaderType::Forge),
                    "neoforge" => Some(ModloaderType::NeoForge),
                    _ => None,
                };
                spec.modloader_version = instance.modloader_version.clone();
                spec.java_path = Some(java.into());
                piston_lib::game::installer::install_instance(spec, reporter)
                    .await
                    .map_err(io)?;
            }
            let snapshot = apply_files(&root, &plan, &changes, &receipt)?;
            self.remember_release(instance.id, &plan.preview.connection_id, &active)?;
            // Commit marker is the point after which recovery preserves the new
            // receipt. DB/status refresh may be retried after an app crash.
            snapshot.finalize().map_err(io)?;
            Ok(())
        }
        .await;
        if let Err(error) = result {
            let recovery = status_guard.recover_failure();
            if !previously_linked && read_json::<Receipt>(&root.join(RECEIPT))?.is_none() {
                let _ = std::fs::remove_file(link_path(&self.root, instance.id));
            }
            recovery.map_err(io)?;
            return Err(error);
        }
        // Existing recovery also clears pending metadata and marks installed.
        status_guard.recover_failure().map_err(io)?;
        let updated = crate::commands::instances::get_instance(instance.id).map_err(io)?;
        let _ = app.emit("core://instance-updated", updated);
        let _ = app.emit("core://pack-sync-changed", instance.id);
        Ok(instance.id)
    }
}

fn apply_files(
    root: &Path,
    plan: &Prepared,
    changes: &[Change],
    receipt: &Receipt,
) -> Result<crate::sync::staging::RollbackSnapshot> {
    use crate::sync::staging::{RollbackSnapshot, StagingDir};
    let stage = StagingDir::new(root).map_err(io)?;
    for change in changes {
        confined(root, &change.path)?;
        if change.operation != "remove" {
            let source = plan.stage.path().join(&change.path);
            let bytes = std::fs::read(source).map_err(io)?;
            if plan.files.get(&change.path) != Some(&digest(&bytes)) {
                return Err(conflict("pack_integrity_failure"));
            }
            stage.write_staged(&change.path, &bytes).map_err(io)?;
        }
    }
    stage
        .write_staged(RECEIPT, &serde_json::to_vec(receipt).map_err(io)?)
        .map_err(io)?;
    let snapshot = RollbackSnapshot::capture(
        root,
        changes
            .iter()
            .map(|c| c.path.clone())
            .chain(std::iter::once(RECEIPT.into())),
        std::iter::empty(),
    )
    .map_err(io)?;
    // capture moves originals into the journal. Staging only contains the diff,
    // leaving every unrelated user mod and world in place.
    stage.commit().map_err(io)?;
    Ok(snapshot)
}
