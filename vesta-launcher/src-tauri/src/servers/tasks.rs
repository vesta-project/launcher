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
                        .filter(|intent| {
                            intent.connection_id == id
                                && !intent.terminal
                                && intent.action != "players.whitelist.desired"
                        })
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
        let pending = self.store.lock().await.intents.iter().any(|i| {
            i.connection_id == id
                && !i.terminal
                && i.operation_id.is_some()
                && i.action != "players.whitelist.desired"
        });
        if pending {
            let _ = self.ensure_operation_tracker(app, id);
        }
        if self.store.lock().await.intents.iter().any(|i| {
            i.connection_id == id
                && i.action == "players.whitelist.desired"
                && !i.terminal
                && !i.uncertain
                && i.operation_id.is_some()
        }) {
            let _ = self.ensure_whitelist_tracker(app, id);
        }
    }
    pub(super) fn ensure_whitelist_tracker(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
    ) -> Result<()> {
        let tracker_key = format!("{id}:whitelist");
        let mut tasks = self.trackers.lock().map_err(|_| internal())?;
        tasks.retain(|_, t| !t.inner().is_finished());
        if tasks.contains_key(&tracker_key) {
            return Ok(());
        }
        if tasks.len() >= 32 {
            return Ok(());
        } // Accepted durable work remains on the agent.
        let weak = Arc::downgrade(self);
        let app = app.clone();
        let id = id.to_owned();
        tasks.insert(tracker_key.clone(),tauri::async_runtime::spawn(async move {
            let mut delay=2u64;
            loop {
                tokio::time::sleep(Duration::from_secs(delay)).await;
                let Some(manager)=weak.upgrade() else {break};
                let store=manager.store.lock().await;
                let pending=store.intents.iter().filter(|i|i.connection_id==id && i.action=="players.whitelist.desired" && !i.terminal && !i.uncertain).filter_map(|i|i.operation_id.clone()).take(32).collect::<Vec<_>>();
                if pending.is_empty() {
                    if let Ok(mut tasks)=manager.trackers.lock() {tasks.remove(&tracker_key);}
                    break;
                }
                drop(store);
                let client=match manager.client(&id).await {Ok(c)=>c,Err(e)=>{if tracking_blocked(e.code){break}delay=(delay+2).min(15);continue}};
                let receipts=match client.startup_whitelist_receipts(&pending).await {
                    Ok(rows)=>rows,
                    Err(e)=>{if tracking_blocked(e.code){break} delay=(delay+2).min(15).max(e.retry_after_ms.unwrap_or(0).div_ceil(1000).min(3600));continue;}
                };
                let unknown=receipts.iter().filter(|r|r.status=="unknown").map(|r|r.id.clone()).collect::<Vec<_>>();
                if !unknown.is_empty() {
                    let _=manager.edit_store(|s| {for i in s.intents.iter_mut().filter(|i|i.connection_id==id && i.action=="players.whitelist.desired") {if i.operation_id.as_ref().is_some_and(|receipt|unknown.contains(receipt)) {i.uncertain=true;}}Ok(())}).await;
                    client.retire_player_reads();
                    let topic=if manager.demanded(&id,ServerTopic::Status) {ServerTopic::Status} else {ServerTopic::Operations};
                    manager.deliver(&id,topic,ServerEvent::PlayerListsChanged);
                    use crate::notifications::{manager::NotificationManager,models::{CreateNotificationInput,NotificationType}};
                    if let Some(notifications)=app.try_state::<NotificationManager>() {
                        let _=notifications.create(CreateNotificationInput {client_key:Some(format!("whitelist-unknown:{id}:{}",unknown[0])),title:Some("Whitelist result is unknown".into()),description:Some("The agent no longer has a receipt for a whitelist change. Review the refreshed list before retrying.".into()),severity:Some("warning".into()),notification_type:Some(NotificationType::Patient),..Default::default()});
                    }
                }
                let finished=receipts.iter().filter(|r|pending.contains(&r.id)&&matches!(r.status.as_str(),"applied"|"cancelled"|"superseded"|"failed")).collect::<Vec<_>>();
                if !finished.is_empty() {
                    let saved=manager.edit_store(|s|{for i in s.intents.iter_mut().filter(|i|i.connection_id==id&&i.action=="players.whitelist.desired") {if finished.iter().any(|r|i.operation_id.as_deref()==Some(&r.id)) {i.terminal=true;i.uncertain=false;}}Ok(())}).await;
                    if saved.is_ok() {
                        client.retire_player_reads();
                        let topic=if manager.demanded(&id,ServerTopic::Status) {ServerTopic::Status} else {ServerTopic::Operations};
                        manager.deliver(&id,topic,ServerEvent::PlayerListsChanged);
                        use crate::notifications::{manager::NotificationManager,models::{CreateNotificationInput,NotificationType}};
                        if let Some(notifications)=app.try_state::<NotificationManager>() {
                            for r in finished.iter().filter(|r|r.status=="failed") {
                                let _=notifications.create(CreateNotificationInput {client_key:Some(format!("whitelist:{id}:{}",r.id)),title:Some("Whitelist change needs attention".into()),description:Some(format!("The change for {} could not be verified. The whitelist has been refreshed.",r.player)),severity:Some("warning".into()),notification_type:Some(NotificationType::Patient),..Default::default()});
                            }
                        }
                        delay=2;continue;
                    }
                }
                delay=(delay+2).min(15);
            }
        }));
        Ok(())
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
