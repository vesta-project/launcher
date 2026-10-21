//! Accepted remote work outlives UI subscriptions. Poll only non-terminal IDs.
use super::*;
use tauri::Manager;

fn activity(app: &AppHandle, id: &str, operation: &ServerOperation, initial: bool) {
    let activity_id = format!("server:{id}:{}", operation.operation_id);
    if initial {
        crate::tasks::activity::publish(
            app,
            "core://task-state",
            json!({"id":activity_id,"attempt":operation.operation_id,"state":"queued","kind":"task","name":"Remote server operation","source":"server","visibility":"foreground","cancellable":false,"pausable":false,"subject":{"id":id,"name":"Vesta server","instanceId":null,"iconUrl":null}}),
        );
    }
    let state = match operation.state.as_str() {
        "succeeded" => "done",
        "failed" | "recovery_required" => "failed",
        "cancelled" => "cancelled",
        _ => "running",
    };
    crate::tasks::activity::publish(
        app,
        "core://task-state",
        json!({"id":activity_id,"attempt":operation.operation_id,"state":state,"step":operation.state,"progress":operation.progress_percent.map(i32::from).unwrap_or(-1),"cancellable":false}),
    );
}
fn notify_failure(app: &AppHandle, id: &str, operation: &ServerOperation) {
    if !matches!(operation.state.as_str(), "failed" | "recovery_required") {
        return;
    }
    use crate::notifications::{
        manager::NotificationManager,
        models::{CreateNotificationInput, NotificationType},
    };
    if let Some(notifications) = app.try_state::<NotificationManager>() {
        let _=notifications.create(CreateNotificationInput {client_key:Some(format!("server:{id}:{}",operation.operation_id)),title:Some("Server operation needs attention".into()),description:Some("The agent reported a failed or recovery-required operation. Review its console and activity.".into()),severity:Some("warning".into()),notification_type:Some(NotificationType::Patient),..Default::default()});
    }
}

impl ServerManager {
    pub(super) async fn decorate_operation(&self, id: &str, operation: &mut ServerOperation) {
        if let Some(intent) = self.store.lock().await.intents.iter().find(|i| {
            i.connection_id == id
                && i.operation_id.as_deref() == Some(operation.operation_id.as_str())
        }) {
            operation.intent = Some(intent.action.replace('/', "."));
            operation.reconciling =
                operation.reconciling || (intent.uncertain && !operation.terminal());
        }
    }
    pub(super) async fn existing_operation(
        &self,
        id: &str,
        intent: &str,
        action: &str,
        payload: &Value,
    ) -> Result<Option<ServerOperation>> {
        let key = intent_key(intent)?;
        let digest = vesta_server_client::trust::leaf_fingerprint(
            serde_json::to_vec(payload)
                .map_err(|_| internal())?
                .as_slice(),
        );
        let existing = self
            .store
            .lock()
            .await
            .intents
            .iter()
            .find(|i| i.connection_id == id && i.key == key)
            .cloned();
        if existing
            .as_ref()
            .is_some_and(|i| i.action != action || i.payload_hash != digest)
        {
            return Err(Error::new(ErrorCode::Conflict));
        }
        let operation_id = existing.and_then(|i| i.operation_id);
        if let Some(operation_id) = operation_id {
            let mut operation = self.client(id).await?.operation(&operation_id).await?;
            self.decorate_operation(id, &mut operation).await;
            return Ok(Some(operation));
        }
        Ok(None)
    }
    pub(super) async fn track(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
        intent: &str,
        operation: &ServerOperation,
    ) -> Result<()> {
        let key = intent_key(intent)?;
        self.edit_store(|s| {
            if let Some(i) = s
                .intents
                .iter_mut()
                .find(|i| i.connection_id == id && i.key == key)
            {
                i.operation_id = Some(operation.operation_id.clone());
                i.terminal = operation.terminal();
                i.uncertain = operation.reconciling;
            }
            Ok(())
        })
        .await?;
        self.deliver(
            id,
            ServerTopic::Operations,
            ServerEvent::Operation {
                operation: operation.clone(),
            },
        );
        match self.start_tracker(app, id, operation) {
            Err(e) if e.code == ErrorCode::ServerBusy => {
                // The remote acceptance and its durable ID are already known.
                // Tracking pressure must not turn that receipt into a refusal.
                self.deliver(
                    id,
                    ServerTopic::Operations,
                    ServerEvent::Resync {
                        topic: ServerTopic::Operations,
                    },
                );
                Ok(())
            }
            other => other,
        }
    }
    fn start_tracker(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
        operation: &ServerOperation,
    ) -> Result<()> {
        if operation.terminal() {
            activity(app, id, operation, true);
            notify_failure(app, id, operation);
            return Ok(());
        }
        let tracker_key = format!("{id}:{}", operation.operation_id);
        let mut trackers = self.trackers.lock().map_err(|_| internal())?;
        trackers.retain(|_, t| !t.inner().is_finished());
        if trackers.contains_key(&tracker_key) {
            return Ok(());
        }
        if trackers.len() >= 32 {
            return Err(Error::new(ErrorCode::ServerBusy));
        }
        activity(app, id, operation, true);
        let manager = self.clone();
        let app = app.clone();
        let id = id.to_owned();
        let op_id = operation.operation_id.clone();
        trackers.insert(
            tracker_key,
            tauri::async_runtime::spawn(async move {
                let mut delay = 2_u64;
                loop {
                    tokio::time::sleep(Duration::from_secs(delay)).await;
                    let client = match manager.client(&id).await {
                        Ok(c) => c,
                        Err(_) => break,
                    };
                    match client.operation(&op_id).await {
                        Ok(mut operation) => {
                            manager.decorate_operation(&id, &mut operation).await;
                            let terminal = operation.terminal();
                            activity(&app, &id, &operation, false);
                            if terminal {
                                notify_failure(&app, &id, &operation);
                            }
                            manager.deliver(
                                &id,
                                ServerTopic::Operations,
                                ServerEvent::Operation { operation },
                            );
                            if terminal {
                                let _ = manager
                                    .edit_store(|s| {
                                        for i in s.intents.iter_mut().filter(|i| {
                                            i.connection_id == id
                                                && i.operation_id.as_deref() == Some(op_id.as_str())
                                        }) {
                                            i.terminal = true;
                                            i.uncertain = false;
                                        }
                                        Ok(())
                                    })
                                    .await;
                                let _ = manager.refresh(&app, &id, false).await;
                                break;
                            }
                        }
                        Err(e)
                            if matches!(
                                e.code,
                                ErrorCode::Forbidden
                                    | ErrorCode::CredentialsRejected
                                    | ErrorCode::FingerprintMismatch
                                    | ErrorCode::NotFound
                                    | ErrorCode::Unsupported
                            ) =>
                        {
                            manager.deliver(
                                &id,
                                ServerTopic::Operations,
                                ServerEvent::Resync {
                                    topic: ServerTopic::Operations,
                                },
                            );
                            break;
                        }
                        Err(e) => {
                            if e.code == ErrorCode::RateLimited {
                                tokio::time::sleep(Duration::from_millis(
                                    e.retry_after_ms.unwrap_or(60_000).min(3_600_000),
                                ))
                                .await;
                            }
                        }
                    }
                    delay = (delay + 2).min(10);
                }
            }),
        );
        Ok(())
    }
    pub(super) async fn resume_operations(self: &Arc<Self>, app: &AppHandle, id: &str) {
        let ids: Vec<String> = self
            .store
            .lock()
            .await
            .intents
            .iter()
            .filter(|i| i.connection_id == id && !i.terminal)
            .filter_map(|i| i.operation_id.clone())
            .take(32)
            .collect();
        if ids.is_empty() {
            return;
        }
        if let Ok(client) = self.client(id).await {
            for op_id in ids {
                if let Ok(mut operation) = client.operation(&op_id).await {
                    self.decorate_operation(id, &mut operation).await;
                    let _ = self.start_tracker(app, id, &operation);
                }
            }
        }
    }
}
