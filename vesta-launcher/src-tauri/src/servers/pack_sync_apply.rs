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
    pub(crate) async fn apply_instance_modpack_review(
        &self,
        app: &AppHandle,
        instance_id: i32,
        review_id: String,
        consent_revision: Option<String>,
    ) -> Result<i32> {
        {
            let previews = self.pack_previews.lock().await;
            let review = previews
                .get(&review_id)
                .ok_or_else(|| conflict("pack_review_expired"))?;
            if review.preview.instance_id != Some(instance_id) {
                return Err(conflict("pack_server_binding_mismatch"));
            }
        }
        self.pack_sync_apply(
            app,
            ApplyRequest {
                review_id,
                consent_revision,
                name: None,
                link_only: false,
            },
        )
        .await
    }

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
        let root = game_dir(&instance)?;
        if crate::modpack::update::has_pending_recovery(&root) {
            return Err(conflict("pack_recovery_required"));
        }
        // Compatibility entry point: all execution, metadata finalization and recovery
        // now belong to the instance update task/engine, with Server as a source kind.
        self.remember_release(instance.id, &plan.preview.connection_id, &plan.release)?;
        crate::modpack::update::begin(app, &instance, &root, &plan.release.revision).map_err(io)?;
        let task = crate::tasks::update_modpack::UpdateModpackTask::from_server(
            instance.id,
            instance.name.clone(),
            root.clone(),
            plan,
            request.link_only,
        );
        drop(_gate);
        if let Err(error) = app.state::<TaskManager>().submit(Box::new(task)).await {
            crate::modpack::update::rollback_start(app, instance.id, &root);
            return Err(io(error));
        }
        Ok(instance.id)
    }
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
            allow_custom_content: false,
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
            provider_pack: None,
            preview,
            release,
            files,
            stage,
            created: Instant::now(),
            old: Some(old),
        }
    }
    fn apply_files(
        root: &Path,
        review: &Prepared,
        _changes: &[Change],
        _receipt: &Receipt,
    ) -> Result<crate::sync::staging::RollbackSnapshot> {
        let plan =
            futures::executor::block_on(crate::modpack::server_source::plan(root, review, None))
                .map_err(io)?;
        let staging = crate::sync::staging::StagingDir::new(root).map_err(io)?;
        let mut paths = vec![
            RECEIPT.into(),
            piston_lib::game::modpack::manifest::ModpackManifest::FILE_NAME.into(),
        ];
        for change in &review.preview.changes {
            paths.push(change.path.clone());
            if change.operation != "remove" {
                let bytes = piston_lib::game::modpack::parser::read_zip_override_entry(
                    &plan.zip_path,
                    plan.format,
                    &change.path,
                )
                .map_err(io)?;
                staging.write_staged(&change.path, &bytes).map_err(io)?;
            }
        }
        staging
            .write_staged(
                piston_lib::game::modpack::manifest::ModpackManifest::FILE_NAME,
                &serde_json::to_vec(&plan.new_manifest).unwrap(),
            )
            .map_err(io)?;
        staging
            .write_staged(RECEIPT, plan.server_receipt.as_ref().unwrap())
            .map_err(io)?;
        crate::modpack::engine::commit_staged(root, staging, paths, vec![]).map_err(io)
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
        assert!(!root
            .path()
            .join(piston_lib::game::modpack::manifest::ModpackManifest::FILE_NAME)
            .exists());
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
    fn server_source_migrates_manifest_and_staged_digest_refuses_post_review_tamper() {
        let root = tempfile::tempdir().unwrap();
        let review = plan(root.path());
        let converted = futures::executor::block_on(crate::modpack::server_source::plan(
            root.path(),
            &review,
            None,
        ))
        .unwrap();
        assert_eq!(converted.new_manifest.modpack_id.as_deref(), Some("server"));
        assert!(converted
            .new_manifest
            .overrides
            .extracted
            .contains(&"mods/new.jar".to_string()));
        let staging = crate::sync::staging::StagingDir::new(root.path()).unwrap();
        for change in &review.preview.changes {
            if change.operation != "remove" {
                staging
                    .write_staged(
                        &change.path,
                        &std::fs::read(review.stage.path().join(&change.path)).unwrap(),
                    )
                    .unwrap();
            }
        }
        crate::modpack::server_source::verify_staged(&staging, &review).unwrap();
        staging
            .write_staged("mods/new.jar", b"modified after ZIP creation")
            .unwrap();
        assert!(crate::modpack::server_source::verify_staged(&staging, &review).is_err());
        assert_eq!(
            std::fs::read(root.path().join("mods/old.jar")).unwrap(),
            b"old"
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
