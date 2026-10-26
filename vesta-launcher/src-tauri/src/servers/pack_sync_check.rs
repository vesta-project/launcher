use super::*;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub instance_id: i32,
    pub connection_id: String,
    pub installed_revision: Option<String>,
    pub published_revision: String,
    pub minimum_revision: String,
    pub status: Option<SyncStatus>,
    pub availability: String,
    pub can_launch: bool,
    pub checked_at_ms: i64,
    pub error: Option<Error>,
}
impl ServerManager {
    /// Cheap fresh status only: no artifact or provider downloads.
    pub async fn pack_sync_check(
        &self,
        app: &AppHandle,
        instance_id: i32,
    ) -> Result<Option<Check>> {
        let _gate = self.pack_gate.lock().await;
        let Some(link) = self.pack_link(instance_id).await? else {
            return Ok(None);
        };
        let instance = crate::commands::instances::get_instance(instance_id).map_err(io)?;
        let installed =
            read_json::<Receipt>(&game_dir(&instance)?.join(RECEIPT))?.map(|r| r.revision);
        let mut check = Check {
            instance_id,
            connection_id: link.connection_id.clone(),
            installed_revision: installed,
            published_revision: link.highest_revision.clone(),
            minimum_revision: link.highest_minimum.clone(),
            status: None,
            availability: "online".into(),
            can_launch: false,
            checked_at_ms: vesta_server_client::now_ms(),
            error: None,
        };
        match self
            .verified_release(&link.connection_id, Some(&instance))
            .await
        {
            Ok((release, Some(_))) => {
                check.published_revision = release.revision;
                check.minimum_revision = release.minimum_revision;
                check.can_launch = release.status != SyncStatus::UpdateRequired;
                check.status = Some(release.status);
            }
            Ok((_, None)) => {
                check.availability = "verification_failed".into();
                check.error = Some(conflict("pack_receipt_missing"));
            }
            Err(error) => {
                check.availability = if matches!(
                    error.code,
                    ErrorCode::Unreachable
                        | ErrorCode::Timeout
                        | ErrorCode::ServerBusy
                        | ErrorCode::RateLimited
                ) {
                    "server_offline"
                } else {
                    "verification_failed"
                }
                .into();
                check.error = Some(error);
            }
        }
        let _ = app.emit("core://pack-sync-status", &check);
        Ok(Some(check))
    }
    pub async fn pack_sync_enforce_launch(
        &self,
        app: &AppHandle,
        instance_id: i32,
    ) -> std::result::Result<(), String> {
        match self.pack_sync_check(app, instance_id).await {
            Ok(Some(check)) if !check.can_launch => Err(format!(
                "pack_sync:{}",
                serde_json::to_string(&check).map_err(|e| e.to_string())?
            )),
            Ok(_) => Ok(()),
            Err(error) => Err(format!(
                "pack_sync:{}",
                serde_json::to_string(&error).map_err(|e| e.to_string())?
            )),
        }
    }
    pub fn start_pack_sync_polling(self: &Arc<Self>, app: AppHandle) {
        let weak = Arc::downgrade(self);
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                interval.tick().await;
                let Some(manager) = weak.upgrade() else {
                    break;
                };
                // Only linked live instances are polled; one sequential read per
                // minute per link, through native request budgets and backoff.
                if let Ok(instances) = crate::commands::instances::list_instances() {
                    for instance in instances {
                        if link_path(&manager.root, instance.id).is_file() {
                            let _ = manager.pack_sync_check(&app, instance.id).await;
                        }
                    }
                }
            }
        });
    }
}
