//! Accepted work outlives UI subscriptions. One bounded observer per server.
use super::*;
use tauri::Manager;

fn activity(app: &AppHandle, id: &str, operation: &ServerOperation, initial: bool) {
    let activity_id = format!("server:{id}:{}", operation.operation_id);
    if initial {
        crate::tasks::activity::publish(
            app,
            "core://task-state",
            json!({"id":activity_id,"attempt":operation.operation_id,"state":"queued","kind":"task","title":"Remote server operation","name":"Remote server operation","source":"server","visibility":"foreground","cancellable":false,"pausable":false,"subject":{"id":id,"name":"Vesta server","instanceId":null,"iconUrl":null}}),
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
        activity(app, id, operation, true);
        self.ensure_operation_tracker(app, id)
    }

    pub(super) fn tracks_operations(&self, id: &str) -> bool {
        self.trackers.lock().is_ok_and(|tasks| {
            tasks
                .get(id)
                .is_some_and(|task| !task.inner().is_finished())
        })
    }

    fn ensure_operation_tracker(self: &Arc<Self>, app: &AppHandle, id: &str) -> Result<()> {
        let mut trackers = self.trackers.lock().map_err(|_| internal())?;
        trackers.retain(|_, t| !t.inner().is_finished());
        if trackers.contains_key(id) {
            return Ok(());
        }
        if trackers.len() >= 32 {
            return Err(Error::new(ErrorCode::ServerBusy));
        }
        let manager = Arc::downgrade(self);
        let app = app.clone();
        let id = id.to_owned();
        trackers.insert(
            id.clone(),
            tauri::async_runtime::spawn(async move {
                use vesta_server_client::observation::OperationObservation;
                let mut observation = OperationObservation::default();
                let mut delay = Duration::from_secs(2);
                let mut list_supported = true;
                let mut selected_supported = true;
                loop {
                    tokio::time::sleep(delay).await;
                    let Some(manager) = manager.upgrade() else {
                        break;
                    };
                    if manager.record(&id).await.is_err() {
                        break;
                    }
                    let store = manager.store.lock().await;
                    let active: Vec<String> = store
                        .intents
                        .iter()
                        .filter(|intent| intent.connection_id == id && !intent.terminal)
                        .filter_map(|intent| intent.operation_id.clone())
                        .collect::<std::collections::BTreeSet<_>>()
                        .into_iter()
                        .collect();
                    if active.is_empty() {
                        // Admission journals under this same store lock before it
                        // looks for a tracker, closing the last-job/new-job race.
                        if let Ok(mut tasks) = manager.trackers.lock() {
                            tasks.remove(&id);
                        }
                        break;
                    }
                    drop(store);
                    let active = observation.active_window(&active);
                    let client = match manager.client(&id).await {
                        Ok(c) => c,
                        Err(error) => {
                            if tracking_blocked(error.code) {
                                break;
                            }
                            delay = observation.delay(false, false, error.retry_after_ms);
                            continue;
                        }
                    };
                    let selected = if selected_supported {
                        match client.operations_selected(&active).await {
                            Err(error)
                                if matches!(
                                    error.code,
                                    ErrorCode::InvalidInput
                                        | ErrorCode::Forbidden
                                        | ErrorCode::Unsupported
                                        | ErrorCode::NotFound
                                ) =>
                            {
                                selected_supported = false;
                                None
                            }
                            result => Some(result),
                        }
                    } else {
                        None
                    };
                    let page = if let Some(selected) = selected {
                        selected
                    } else if list_supported {
                        client.operations_with_priority(None, false).await
                    } else {
                        Ok(Page {
                            items: Vec::new(),
                            next_cursor: None,
                        })
                    };
                    let mut observations = match page {
                        Ok(page) => page
                            .items
                            .into_iter()
                            .filter(|op| active.contains(&op.operation_id))
                            .collect::<Vec<_>>(),
                        Err(error) => {
                            if matches!(
                                error.code,
                                ErrorCode::Forbidden | ErrorCode::NotFound | ErrorCode::Unsupported
                            ) {
                                // Older or own-task-only agents may allow known
                                // operation IDs without permitting history listing.
                                list_supported = false;
                                Vec::new()
                            } else {
                                if tracking_blocked(error.code) {
                                    manager.deliver(
                                        &id,
                                        ServerTopic::Operations,
                                        ServerEvent::Resync {
                                            topic: ServerTopic::Operations,
                                        },
                                    );
                                    break;
                                }
                                delay = observation.delay(
                                    false,
                                    manager.demanded(&id, ServerTopic::Operations),
                                    error.retry_after_ms,
                                );
                                continue;
                            }
                        }
                    };
                    let mut present = observations
                        .iter()
                        .map(|op| op.operation_id.clone())
                        .collect::<Vec<_>>();
                    let mut retry_after = None;
                    for _ in 0..if list_supported { 1 } else { 4 } {
                        let Some(missing) = observation.missing(&active, &present) else {
                            break;
                        };
                        present.push(missing.to_owned());
                        match client.operation(missing).await {
                            Ok(operation) => observations.push(operation),
                            Err(error) => {
                                // A pruned/missing record is unresolved evidence, never success.
                                // Keep its durable intent; rotating fallback prevents starvation.
                                retry_after = error.retry_after_ms;
                                if tracking_blocked(error.code) && error.code != ErrorCode::NotFound
                                {
                                    manager.deliver(
                                        &id,
                                        ServerTopic::Operations,
                                        ServerEvent::Resync {
                                            topic: ServerTopic::Operations,
                                        },
                                    );
                                    return;
                                }
                                if retry_after.is_some() {
                                    break;
                                }
                            }
                        }
                    }
                    let mut changed = false;
                    let mut finished = Vec::new();
                    for mut operation in observations {
                        manager.decorate_operation(&id, &mut operation).await;
                        if operation.terminal() && !operation.reconciling {
                            finished.push(operation.operation_id.clone());
                        }
                        let initial = !observation.known(&operation.operation_id);
                        if !observation.changed(&operation) {
                            continue;
                        }
                        changed = true;
                        activity(&app, &id, &operation, initial);
                        if operation.terminal() {
                            notify_failure(&app, &id, &operation);
                        }
                        manager.deliver(
                            &id,
                            ServerTopic::Operations,
                            ServerEvent::Operation { operation },
                        );
                    }
                    if !finished.is_empty() {
                        // One durable journal commit per observed batch, not per job or poll.
                        let saved = manager
                            .edit_store(|store| {
                                for intent in store.intents.iter_mut().filter(|intent| {
                                    intent.connection_id == id
                                        && intent
                                            .operation_id
                                            .as_ref()
                                            .is_some_and(|op| finished.contains(op))
                                }) {
                                    intent.terminal = true;
                                    intent.uncertain = false;
                                }
                                Ok(())
                            })
                            .await;
                        if saved.is_err() {
                            observation = OperationObservation::default();
                        }
                        let _ = manager.refresh(&app, &id, false).await;
                    }
                    delay = observation.delay(
                        changed,
                        manager.demanded(&id, ServerTopic::Operations),
                        retry_after,
                    );
                }
            }),
        );
        Ok(())
    }
    pub(super) async fn resume_operations(self: &Arc<Self>, app: &AppHandle, id: &str) {
        let pending = self
            .store
            .lock()
            .await
            .intents
            .iter()
            .any(|i| i.connection_id == id && !i.terminal && i.operation_id.is_some());
        if pending {
            let _ = self.ensure_operation_tracker(app, id);
        }
    }
}

fn tracking_blocked(code: ErrorCode) -> bool {
    matches!(
        code,
        ErrorCode::Forbidden
            | ErrorCode::CredentialsRejected
            | ErrorCode::CredentialsUnavailable
            | ErrorCode::FingerprintMismatch
            | ErrorCode::NotFound
            | ErrorCode::Unsupported
            | ErrorCode::NoManagementAccess
    )
}
