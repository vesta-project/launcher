//! Native management journaling contains hashes and receipts, never invitation codes or tokens.
use super::*;
use serde::Serialize;

impl ServerManager {
    /// Re-read the authoritative flag after a configuration save, including a replay.
    pub async fn refresh_backups_configured(&self, app: &AppHandle, id: &str) {
        let Ok(slot) = self.slot(id) else {
            return;
        };
        let _gate = slot.refresh.lock().await;
        let Ok(client) = self.client(id).await else {
            return;
        };
        client.transport.invalidate_reads();
        match client.info().await {
            Ok(info) => {
                if let Ok(mut record) = self.record(id).await {
                    record.snapshot.backups_configured = info.backups_configured;
                    record.snapshot.info = Some(info);
                    let _ = self.publish(app, record.snapshot).await;
                }
            }
            Err(_) => {
                slot.info_loaded
                    .store(false, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }

    /// Explicit refresh must retire native GETs as well as the frontend cache.
    /// With no client there are no projections to retire; never construct a
    /// session or issue a request just to discard local cached observations.
    pub async fn retire_reads(&self, id: &str) -> Result<()> {
        self.record(id).await?;
        let slot = self.slot(id)?;
        if let Some(client) = slot.client.lock().await.as_ref() {
            client.transport.invalidate_reads();
        }
        Ok(())
    }
    pub async fn management_read<T, F, Fut>(&self, app: &AppHandle, id: &str, read: F) -> Result<T>
    where
        F: FnOnce(Arc<Client>) -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        let result = read(self.client(id).await?).await;
        if let Err(e) = &result {
            self.synchronize_failure(app, id, e).await;
        }
        result
    }
    #[allow(clippy::too_many_arguments)]
    pub async fn management_write<T, F, Fut>(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
        intent: &str,
        action: &str,
        payload: Value,
        once: bool,
        write: F,
    ) -> Result<T>
    where
        T: Serialize,
        F: FnOnce(Arc<Client>) -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        let client = self.client(id).await?;
        let slot = self.slot(id)?;
        let _gate = slot.management.lock().await;
        let key = intent_key(intent)?;
        let digest = vesta_server_client::trust::leaf_fingerprint(
            &serde_json::to_vec(&payload).map_err(|_| internal())?,
        );
        self.edit_store(|store| {
            store.reserve_management_intent(
                PendingIntent {
                    connection_id: id.into(),
                    key: key.clone(),
                    key_version: 2,
                    action: action.into(),
                    payload_hash: digest,
                    operation_id: None,
                    created_at_ms: vesta_server_client::now_ms(),
                    terminal: false,
                    uncertain: true,
                },
                once,
            )
        })
        .await?;
        let result = write(client).await;
        match &result {
            Ok(value) => {
                // Serialize only the IPC allowlist. Activity never includes its contents.
                let value = serde_json::to_value(value).map_err(|_| internal())?;
                let job = value.get("job").unwrap_or(&value);
                let state = job.get("state").and_then(Value::as_str);
                let job_id = state.and_then(|_| job.get("id").and_then(Value::as_str));
                // A content receipt completes the request even when its live file
                // effect is queued. Inventory owns that queue; it is not a backup job.
                let content = action.starts_with("content/");
                let terminal = content || state.is_none_or(backup_terminal);
                // Acceptance is already known: a local bookkeeping failure cannot undo it.
                let _ = self
                    .edit_store(|s| {
                        if let Some(i) = s
                            .intents
                            .iter_mut()
                            .find(|i| i.connection_id == id && i.key == key)
                        {
                            i.terminal = terminal;
                            i.uncertain = false;
                        }
                        Ok(())
                    })
                    .await;
                let activity_id = job_id.map(str::to_owned).unwrap_or(key);
                management_activity(
                    app,
                    id,
                    &activity_id,
                    action,
                    if content {
                        "succeeded"
                    } else {
                        state.unwrap_or("succeeded")
                    },
                    true,
                );
                if let Some(job_id) = job_id {
                    if !terminal && state != Some("awaiting_confirmation") {
                        if action.starts_with("software/") {
                            self.track_software(app, id, job_id, action);
                        } else {
                            self.track_backup(app, id, job_id, action);
                        }
                    }
                }
                self.changed(app);
            }
            Err(error) => {
                self.synchronize_failure(app, id, error).await;
                // Retain every preparation marker, even a refusal. It is never replay-safe.
                if !once
                    && !matches!(
                        error.code,
                        ErrorCode::OutcomeUnknown
                            | ErrorCode::Timeout
                            | ErrorCode::Unreachable
                            | ErrorCode::Internal
                    )
                {
                    let _ = self
                        .edit_store(|s| {
                            s.intents.retain(|i| i.connection_id != id || i.key != key);
                            Ok(())
                        })
                        .await;
                }
            }
        }
        result
    }
    fn track_backup(self: &Arc<Self>, app: &AppHandle, id: &str, job_id: &str, action: &str) {
        let tracker_key = format!("{id}:backup:{job_id}");
        let Ok(mut trackers) = self.trackers.lock() else {
            return;
        };
        trackers.retain(|_, t| !t.inner().is_finished());
        if trackers.len() >= 32 || trackers.contains_key(&tracker_key) {
            return;
        }
        let manager = self.clone();
        let app = app.clone();
        let id = id.to_owned();
        let job_id = job_id.to_owned();
        let action = action.to_owned();
        trackers.insert(
            tracker_key,
            tauri::async_runtime::spawn(async move {
                let mut delay = 2;
                loop {
                    tokio::time::sleep(Duration::from_secs(delay)).await;
                    let Ok(client) = manager.client(&id).await else {
                        break;
                    };
                    match client.backup_job_with_priority(&job_id, false).await {
                        Ok(job) => {
                            management_activity(&app, &id, &job_id, &action, &job.state, false);
                            if backup_terminal(&job.state) {
                                manager.changed(&app);
                                break;
                            }
                        }
                        Err(e)
                            if matches!(
                                e.code,
                                ErrorCode::RateLimited
                                    | ErrorCode::ServerBusy
                                    | ErrorCode::Timeout
                                    | ErrorCode::Unreachable
                            ) => {}
                        Err(_) => break,
                    }
                    delay = (delay + 2).min(15);
                }
            }),
        );
    }
}
fn backup_terminal(state: &str) -> bool {
    matches!(
        state,
        "succeeded" | "failed" | "uncertain" | "recovery_required"
    )
}
pub(super) fn management_activity(
    app: &AppHandle,
    connection: &str,
    receipt: &str,
    action: &str,
    state: &str,
    initial: bool,
) {
    let id = format!("server:{connection}:manage:{receipt}");
    if initial {
        crate::tasks::activity::publish(
            app,
            "core://task-state",
            json!({"id":id,"attempt":receipt,"state":"queued","kind":"task",
            "name":format!("Server {action}"),"source":"server","visibility":"foreground","cancellable":false,"pausable":false,
            "subject":{"id":connection,"name":"Vesta server","instanceId":null,"iconUrl":null}}),
        );
    }
    let activity_state = match state {
        "succeeded" => "done",
        "failed" | "uncertain" | "recovery_required" => "failed",
        _ => "running",
    };
    crate::tasks::activity::publish(
        app,
        "core://task-state",
        json!({"id":id,"attempt":receipt,"state":activity_state,"step":state,"progress":-1,"cancellable":false}),
    );
}
