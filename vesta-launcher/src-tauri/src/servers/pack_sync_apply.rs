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
        verify_admission(&plan)?;
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

fn verify_admission(plan: &Prepared) -> Result<()> {
    if plan.created.elapsed().as_secs() >= 900 {
        return Err(conflict("pack_review_expired"));
    }
    Ok(())
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
    fn review_expiry_is_an_admission_boundary_and_execution_rechecks_identity() {
        let root = tempfile::tempdir().unwrap();
        let mut review = plan(root.path());
        verify_admission(&review).unwrap();
        review.created = Instant::now() - std::time::Duration::from_secs(901);
        assert_eq!(
            verify_admission(&review).unwrap_err().reason.as_deref(),
            Some("pack_review_expired")
        );
        crate::modpack::server_source::verify_release(&review.release, &review).unwrap();
        futures::executor::block_on(crate::modpack::server_source::plan(
            root.path(),
            &review,
            None,
        ))
        .unwrap();
        for field in ["revision", "sha256", "server_id", "fingerprint"] {
            let mut changed = review.release.clone();
            match field {
                "revision" => changed.revision = "3".into(),
                "sha256" => changed.sha256 = "d".repeat(64),
                "server_id" => changed.server_id = "other".into(),
                _ => changed.fingerprint = "e".repeat(64),
            }
            assert_eq!(
                crate::modpack::server_source::verify_release(&changed, &review)
                    .unwrap_err()
                    .reason
                    .as_deref(),
                Some("pack_review_stale"),
                "{field}"
            );
        }
        std::fs::write(root.path().join(RECEIPT), b"{}").unwrap();
        assert!(crate::modpack::server_source::verify_baseline(root.path(), &review).is_err());
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

    #[cfg(target_os = "windows")]
    #[test]
    fn restart_command_database_watcher_and_cancelled_task_use_owned_fixtures() {
        use crate::tasks::manager::{TaskContext, TaskManager};
        use diesel::prelude::*;
        use tauri::Listener;
        let profile = tempfile::tempdir().unwrap();
        crate::utils::db::init_vesta_pool(profile.path().to_path_buf()).unwrap();
        crate::utils::db::init_config_pool(profile.path().to_path_buf()).unwrap();
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        let app = tauri::Builder::default()
            .any_thread()
            .build(context)
            .unwrap();
        let handle = app.handle().clone();
        handle.manage(TaskManager::new(handle.clone()));
        handle.manage(crate::notifications::manager::NotificationManager::new(
            handle.clone(),
        ));
        handle.manage(ServerManager::at_root(profile.path().join("server-state")).unwrap());
        let watcher = crate::resources::watcher::ResourceWatcher::new(handle.clone());
        let root = tempfile::tempdir().unwrap();
        let review = plan(root.path());
        let instance = Instance {
            id: 7,
            name: "Owned pack fixture".into(),
            minecraft_version: "1.21.1".into(),
            modloader: Some("fabric".into()),
            modloader_version: Some("0.16.10".into()),
            modpack_version_id: Some("1".into()),
            game_directory: Some(root.path().to_string_lossy().into_owned()),
            installation_status: Some("installed".into()),
            ..Instance::default()
        };
        diesel::insert_into(crate::schema::instance::table)
            .values(&instance)
            .execute(&mut crate::utils::db::get_vesta_conn().unwrap())
            .unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            // The public command must return the existing target before any
            // network request (this connection deliberately does not exist).
            let manager = handle.state::<Arc<ServerManager>>();
            manager.pack_installs.0.lock().await.insert(
                install_target("no-network", "1", "digest", &instance),
                (7, Instant::now()),
            );
            for _ in 0..2 {
                assert_eq!(
                    crate::commands::servers_pack_sync::server_pack_sync_install(
                        handle.clone(),
                        handle.state::<Arc<ServerManager>>(),
                        "no-network".into(),
                        "1".into(),
                        "digest".into(),
                        true,
                        instance.clone()
                    )
                    .await
                    .unwrap(),
                    7
                );
            }
            assert_eq!(
                crate::schema::instance::table
                    .count()
                    .get_result::<i64>(&mut crate::utils::db::get_vesta_conn().unwrap())
                    .unwrap(),
                1
            );
            let mut expired = plan(tempfile::tempdir().unwrap().path());
            expired.created = Instant::now() - std::time::Duration::from_secs(901);
            handle
                .state::<Arc<ServerManager>>()
                .pack_previews
                .lock()
                .await
                .insert("expired".into(), expired);
            let expired_result = crate::commands::servers_pack_sync::server_pack_sync_apply(
                handle.clone(),
                handle.state::<Arc<ServerManager>>(),
                ApplyRequest {
                    review_id: "expired".into(),
                    consent_revision: Some("2".into()),
                    name: None,
                    link_only: false,
                },
            )
            .await;
            assert_eq!(
                expired_result.unwrap_err().reason.as_deref(),
                Some("pack_review_expired")
            );
            crate::modpack::update::begin(&handle, &instance, root.path(), "2").unwrap();
            let snapshot = apply_files(
                root.path(),
                &review,
                &review.preview.changes,
                &receipt(&review),
            )
            .unwrap();
            std::mem::forget(snapshot); // crash after file apply, before durable publication
            crate::commands::instances::update_installation_status(&handle, 7, "interrupted")
                .unwrap();
            crate::commands::instances::resume_instance_operation(
                handle.clone(),
                handle.state::<TaskManager>(),
                7,
            )
            .await
            .unwrap();
            assert!(!crate::modpack::update::has_pending_recovery(root.path()));
            let restored = crate::commands::instances::get_instance(7).unwrap();
            assert_eq!(restored.modpack_version_id.as_deref(), Some("1"));
            assert_eq!(restored.installation_status.as_deref(), Some("installed"));
            assert_eq!(
                std::fs::read(root.path().join("mods/old.jar")).unwrap(),
                b"old"
            );
            assert!(!root.path().join("mods/new.jar").exists());
            watcher
                .watch_instance_without_scan(7, root.path().to_string_lossy().into_owned())
                .await
                .unwrap();
            watcher.unwatch_instance(7).await.unwrap();

            let events = Arc::new(std::sync::Mutex::new(Vec::<serde_json::Value>::new()));
            let captured = events.clone();
            let listener = handle.listen("core://activity-progress", move |event| {
                captured
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str(event.payload()).unwrap());
            });
            let (cancel, cancel_rx) = tokio::sync::watch::channel(false);
            let (_pause, pause_rx) = tokio::sync::watch::channel(false);
            let ctx = TaskContext {
                app_handle: handle.clone(),
                notification_id: "fixture-pack".into(),
                activity_attempt: "fixture-pack:1".into(),
                notifications_enabled: false,
                cancel_rx,
                pause_rx,
                progress_channel: None,
                overall_range: (0, 100),
            };
            crate::modpack::server_source::plan(
                root.path(),
                &review,
                Some(&ctx.with_overall_range(0, 30)),
            )
            .await
            .unwrap();
            assert!(events
                .lock()
                .unwrap()
                .iter()
                .any(|e| e["stage"] == "analyzing"));
            assert!(events
                .lock()
                .unwrap()
                .iter()
                .any(|e| e["items"]["total"] == 2));
            cancel.send(true).unwrap();
            assert_eq!(
                crate::modpack::server_source::plan(root.path(), &review, Some(&ctx))
                    .await
                    .err()
                    .unwrap(),
                "Update cancelled"
            );
            let details = PackDetails {
                preview: review.preview.clone(),
                version: None,
                author: None,
                description: None,
                icon_url: None,
                format: "vestapack".into(),
                resources: vec![],
            };
            crate::modpack::update::begin(&handle, &instance, root.path(), "2").unwrap();
            let task = crate::tasks::installers::modpack::InstallModpackTask::from_server(
                instance.clone(),
                details,
            );
            assert!(task.cancellable());
            assert_eq!(task.id().as_deref(), Some("install_instance_7_server_pack"));
            assert_eq!(task.run(ctx).await.unwrap_err(), "Installation cancelled");
            let interrupted = crate::commands::instances::get_instance(7).unwrap();
            assert_eq!(
                interrupted.installation_status.as_deref(),
                Some("interrupted")
            );
            assert_eq!(
                interrupted.last_operation.as_deref(),
                Some("server-pack-install")
            );
            assert!(!crate::modpack::update::has_pending_recovery(root.path()));
            assert_eq!(
                std::fs::read(root.path().join("mods/old.jar")).unwrap(),
                b"old"
            );
            // A crash after durable publication must retain the new files/metadata.
            crate::modpack::update::begin(&handle, &instance, root.path(), "2").unwrap();
            let committed = apply_files(
                root.path(),
                &review,
                &review.preview.changes,
                &receipt(&review),
            )
            .unwrap();
            diesel::update(crate::schema::instance::table.find(7))
                .set(crate::schema::instance::modpack_version_id.eq(Some("2".to_string())))
                .execute(&mut crate::utils::db::get_vesta_conn().unwrap())
                .unwrap();
            committed.finalize().unwrap();
            crate::commands::instances::update_installation_status(&handle, 7, "interrupted")
                .unwrap();
            crate::commands::instances::resume_instance_operation(
                handle.clone(),
                handle.state::<TaskManager>(),
                7,
            )
            .await
            .unwrap();
            assert_eq!(
                crate::commands::instances::get_instance(7)
                    .unwrap()
                    .modpack_version_id
                    .as_deref(),
                Some("2")
            );
            assert_eq!(
                std::fs::read(root.path().join("mods/new.jar")).unwrap(),
                b"new"
            );
            assert!(!crate::modpack::update::has_pending_recovery(root.path()));
            handle.unlisten(listener);
        });
    }

    #[test]
    fn signed_update_preserves_local_server_list_and_custom_config() {
        let root = tempfile::tempdir().unwrap();
        let review = plan(root.path());
        crate::settings_sync::servers::ensure_linked_server(
            root.path(),
            "Local favourite",
            "local.example:25565",
        )
        .unwrap();
        crate::settings_sync::servers::ensure_linked_server(root.path(), "Linked", "[::1]:25565")
            .unwrap();
        let servers = std::fs::read(root.path().join("servers.dat")).unwrap();
        std::fs::write(root.path().join("config/user.toml"), b"custom=true").unwrap();
        let snapshot = apply_files(
            root.path(),
            &review,
            &review.preview.changes,
            &receipt(&review),
        )
        .unwrap();
        snapshot.finalize().unwrap();
        crate::settings_sync::servers::ensure_linked_server(
            root.path(),
            "Renamed linked",
            "[::1]:25565",
        )
        .unwrap();
        assert_eq!(
            std::fs::read(root.path().join("servers.dat")).unwrap(),
            servers
        );
        assert_eq!(
            std::fs::read(root.path().join("config/user.toml")).unwrap(),
            b"custom=true"
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
