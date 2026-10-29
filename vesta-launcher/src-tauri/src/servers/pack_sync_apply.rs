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
        verify_consent(&plan.preview, &request)?;
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
        // Launch takes the play guard before checking pack policy. Release the
        // pack gate before waiting for play to preserve that lock order.
        drop(_gate);
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
        let _gate = self.pack_gate.lock().await;
        let instance = crate::commands::instances::get_instance(instance.id).map_err(io)?;
        let (active, old) = self
            .verified_release(&plan.preview.connection_id, Some(&instance))
            .await?;
        if active.revision != plan.release.revision
            || active.sha256 != plan.release.sha256
            || active.server_id != plan.release.server_id
            || active.fingerprint != plan.release.fingerprint
            || old.as_ref().map(|r| (&r.revision, &r.sha256))
                != plan.old.as_ref().map(|r| (&r.revision, &r.sha256))
        {
            return Err(conflict("pack_review_stale"));
        }
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
        drop(_gate);
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
            // Runtime downloads do not monopolize the signed-status gate.
            // Recheck the selected publication after that potentially slow work.
            let _gate = self.pack_gate.lock().await;
            let (latest, latest_old) = self
                .verified_release(&plan.preview.connection_id, Some(&instance))
                .await?;
            if latest.revision != plan.release.revision
                || latest.sha256 != plan.release.sha256
                || latest.server_id != plan.release.server_id
                || latest.fingerprint != plan.release.fingerprint
                || latest_old.as_ref().map(|r| (&r.revision, &r.sha256))
                    != plan.old.as_ref().map(|r| (&r.revision, &r.sha256))
            {
                return Err(conflict("pack_review_stale"));
            }
            let final_changes = diff(&root, old.as_ref(), &plan.files)?;
            if serde_json::to_value(&final_changes).map_err(io)?
                != serde_json::to_value(&changes).map_err(io)?
            {
                return Err(conflict("pack_review_stale"));
            }
            let snapshot = apply_files(&root, &plan, &final_changes, &receipt)?;
            self.remember_release(instance.id, &plan.preview.connection_id, &latest)?;
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
        // Reconciliation acquires the same resource guards. The transaction is
        // durable now; release exclusion before registering/scanning watchers.
        drop(_play);
        // A new pack instance deferred its initial scan until the durable commit.
        // Existing watchers already queue their reconciliation behind our guards.
        let watcher = app.state::<crate::resources::watcher::ResourceWatcher>();
        if let Err(error) = watcher.unwatch_instance(instance.id).await {
            log::warn!(
                "Pack instance {} watcher reset failed: {}",
                instance.id,
                error
            );
        }
        if let Err(error) = app
            .state::<crate::resources::watcher::ResourceWatcher>()
            .watch_instance(
                instance.slug(),
                instance.id,
                root.to_string_lossy().into_owned(),
            )
            .await
        {
            log::warn!(
                "Pack instance {} watcher registration failed: {}",
                instance.id,
                error
            );
        }
        {
            use crate::schema::instance::dsl as fields;
            use diesel::prelude::*;
            let mut conn = crate::utils::db::get_vesta_conn().map_err(io)?;
            diesel::update(fields::instance.find(instance.id))
                .set((
                    fields::modpack_platform.eq(Some("server")),
                    fields::modpack_id.eq(Some(&plan.release.server_id)),
                    fields::modpack_version_id.eq(Some(&plan.release.revision)),
                ))
                .execute(&mut conn)
                .map_err(io)?;
        }
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

fn verify_consent(preview: &Preview, request: &ApplyRequest) -> Result<()> {
    if preview.consent_required
        && request.consent_revision.as_deref() != Some(preview.revision.as_str())
        && !request.link_only
    {
        return Err(conflict("pack_executable_consent_required"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn plan(root: &Path) -> Prepared {
        let stage = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(stage.path().join("mods")).unwrap();
        std::fs::create_dir_all(stage.path().join("config")).unwrap();
        std::fs::write(stage.path().join("mods/new.jar"), b"new").unwrap();
        std::fs::write(stage.path().join("config/test.toml"), b"new config").unwrap();
        let old = Receipt {
            revision: "1".into(),
            sha256: "a".repeat(64),
            runtime: Runtime {
                minecraft_version: "1.21.1".into(),
                loader: "fabric".into(),
                loader_version: Some("0.16.10".into()),
            },
            files: BTreeMap::from([
                ("mods/old.jar".into(), digest(b"old")),
                ("config/test.toml".into(), digest(b"old config")),
            ]),
        };
        std::fs::create_dir_all(root.join("mods")).unwrap();
        std::fs::create_dir_all(root.join("config")).unwrap();
        std::fs::write(root.join("mods/old.jar"), b"old").unwrap();
        std::fs::write(root.join("mods/user.jar"), b"user").unwrap();
        std::fs::write(root.join("config/test.toml"), b"old config").unwrap();
        std::fs::write(root.join(RECEIPT), serde_json::to_vec(&old).unwrap()).unwrap();
        let files = BTreeMap::from([
            ("mods/new.jar".into(), digest(b"new")),
            ("config/test.toml".into(), digest(b"new config")),
        ]);
        let release = Release {
            server_id: "server".into(),
            fingerprint: "b".repeat(64),
            revision: "2".into(),
            minimum_revision: "1".into(),
            sha256: "c".repeat(64),
            size: "1".into(),
            format: "vestapack".into(),
            installed_revision: "1".into(),
            status: SyncStatus::UpdateAvailable,
            nonce: "n".into(),
        };
        let changes = diff(root, Some(&old), &files).unwrap();
        let preview = Preview {
            review_id: "review".into(),
            connection_id: "connection".into(),
            instance_id: Some(7),
            server_id: release.server_id.clone(),
            fingerprint: release.fingerprint.clone(),
            revision: "2".into(),
            minimum_revision: "1".into(),
            artifact_sha256: release.sha256.clone(),
            name: "pack".into(),
            runtime: old.runtime.clone(),
            executable_changes: changes
                .iter()
                .filter(|c| c.executable)
                .map(|c| c.path.clone())
                .collect(),
            consent_required: true,
            changes,
        };
        Prepared {
            preview,
            release,
            files,
            stage,
            created: Instant::now(),
            old: Some(old),
        }
    }
    fn receipt(plan: &Prepared) -> Receipt {
        Receipt {
            revision: plan.release.revision.clone(),
            sha256: plan.release.sha256.clone(),
            runtime: plan.preview.runtime.clone(),
            files: plan.files.clone(),
        }
    }
    #[test]
    fn diff_tracks_only_pack_files_and_commit_preserves_user_mods() {
        let root = tempfile::tempdir().unwrap();
        let plan = plan(root.path());
        assert_eq!(plan.preview.changes.len(), 3);
        assert!(plan
            .preview
            .executable_changes
            .contains(&"mods/old.jar".into()));
        assert!(plan
            .preview
            .executable_changes
            .contains(&"mods/new.jar".into()));
        let snapshot =
            apply_files(root.path(), &plan, &plan.preview.changes, &receipt(&plan)).unwrap();
        snapshot.finalize().unwrap();
        crate::sync::staging::RollbackSnapshot::cleanup_committed(root.path()).unwrap();
        assert!(!root.path().join("mods/old.jar").exists());
        assert_eq!(
            std::fs::read(root.path().join("mods/new.jar")).unwrap(),
            b"new"
        );
        assert_eq!(
            std::fs::read(root.path().join("mods/user.jar")).unwrap(),
            b"user"
        );
        assert_eq!(
            read_json::<Receipt>(&root.path().join(RECEIPT))
                .unwrap()
                .unwrap()
                .revision,
            "2"
        );
        assert!(diff(root.path(), Some(&receipt(&plan)), &plan.files)
            .unwrap()
            .is_empty());
    }
    #[test]
    fn failed_finalization_restores_removed_updated_added_files_and_receipt() {
        let root = tempfile::tempdir().unwrap();
        let plan = plan(root.path());
        let snapshot =
            apply_files(root.path(), &plan, &plan.preview.changes, &receipt(&plan)).unwrap();
        drop(snapshot);
        assert_eq!(
            std::fs::read(root.path().join("mods/old.jar")).unwrap(),
            b"old"
        );
        assert!(!root.path().join("mods/new.jar").exists());
        assert_eq!(
            std::fs::read(root.path().join("config/test.toml")).unwrap(),
            b"old config"
        );
        assert_eq!(
            read_json::<Receipt>(&root.path().join(RECEIPT))
                .unwrap()
                .unwrap()
                .revision,
            "1"
        );
        assert_eq!(
            std::fs::read(root.path().join("mods/user.jar")).unwrap(),
            b"user"
        );
    }
    #[test]
    fn interrupted_journal_recovers_before_commit_and_retains_after_commit() {
        let root = tempfile::tempdir().unwrap();
        let plan = plan(root.path());
        let snapshot =
            apply_files(root.path(), &plan, &plan.preview.changes, &receipt(&plan)).unwrap();
        std::mem::forget(snapshot);
        crate::sync::staging::RollbackSnapshot::restore_pending(root.path()).unwrap();
        assert_eq!(
            read_json::<Receipt>(&root.path().join(RECEIPT))
                .unwrap()
                .unwrap()
                .revision,
            "1"
        );
        let snapshot =
            apply_files(root.path(), &plan, &plan.preview.changes, &receipt(&plan)).unwrap();
        snapshot.finalize().unwrap();
        crate::sync::staging::RollbackSnapshot::restore_pending(root.path()).unwrap();
        assert_eq!(
            read_json::<Receipt>(&root.path().join(RECEIPT))
                .unwrap()
                .unwrap()
                .revision,
            "2"
        );
    }
    #[test]
    fn modified_owned_or_colliding_user_file_refuses_without_changes() {
        let root = tempfile::tempdir().unwrap();
        let plan = plan(root.path());
        std::fs::write(root.path().join("config/test.toml"), b"user edit").unwrap();
        assert_eq!(
            diff(root.path(), plan.old.as_ref(), &plan.files)
                .unwrap_err()
                .reason
                .as_deref(),
            Some("pack_owned_file_modified")
        );
        std::fs::write(root.path().join("config/test.toml"), b"old config").unwrap();
        std::fs::write(root.path().join("mods/new.jar"), b"user collision").unwrap();
        assert_eq!(
            diff(root.path(), plan.old.as_ref(), &plan.files)
                .unwrap_err()
                .reason
                .as_deref(),
            Some("pack_user_file_collision")
        );
    }
    #[test]
    fn staged_tamper_cannot_modify_live_files_and_consent_is_per_revision() {
        let root = tempfile::tempdir().unwrap();
        let plan = plan(root.path());
        let mut request = ApplyRequest {
            review_id: "review".into(),
            consent_revision: Some("1".into()),
            name: None,
            link_only: false,
        };
        assert!(verify_consent(&plan.preview, &request).is_err());
        request.consent_revision = Some("2".into());
        verify_consent(&plan.preview, &request).unwrap();
        std::fs::write(plan.stage.path().join("mods/new.jar"), b"tamper").unwrap();
        assert!(apply_files(root.path(), &plan, &plan.preview.changes, &receipt(&plan)).is_err());
        assert_eq!(
            std::fs::read(root.path().join("mods/old.jar")).unwrap(),
            b"old"
        );
        assert_eq!(
            std::fs::read(root.path().join("config/test.toml")).unwrap(),
            b"old config"
        );
    }
    #[test]
    fn portable_paths_and_runtime_identity_are_strict() {
        for path in [
            "../mods/a.jar",
            "mods/../a.jar",
            "mods\\a.jar",
            "/mods/a.jar",
            "mods/CON.jar",
            "mods/a.jar.",
            "mods/a:b.jar",
            ".vesta-server-pack.json",
            "libraries/a.jar",
        ] {
            assert!(safe_path(path).is_err(), "{path}");
        }
        for path in ["mods/a.jar", "config/a.toml", "options.txt"] {
            safe_path(path).unwrap();
        }
        let root = tempfile::tempdir().unwrap();
        let plan = plan(root.path());
        let mut instance = Instance {
            minecraft_version: "1.21.1".into(),
            modloader: Some("fabric".into()),
            modloader_version: Some("0.16.10".into()),
            ..Instance::default()
        };
        assert_runtime(&instance, plan.old.as_ref().unwrap()).unwrap();
        instance.modloader = Some("forge".into());
        assert!(assert_runtime(&instance, plan.old.as_ref().unwrap()).is_err());
        safe_path("pack-icon.png").unwrap();
        assert_eq!(
            read_matching_file(root.path(), "mods/old.jar", 3, &digest(b"old")).unwrap(),
            Some(b"old".to_vec())
        );
        assert!(
            read_matching_file(root.path(), "mods/old.jar", 3, &digest(b"new"))
                .unwrap()
                .is_none()
        );
    }
}
