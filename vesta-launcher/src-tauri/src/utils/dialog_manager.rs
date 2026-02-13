use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DialogAction {
    pub id: String,
    pub label: String,
    pub color: Option<String>,
    pub variant: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DialogInputConfig {
    pub placeholder: Option<String>,
    pub default_value: Option<String>,
    pub is_password: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum DialogSeverity {
    Info,
    Warning,
    Error,
    Success,
    Question,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DialogRequest {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub severity: DialogSeverity,
    pub actions: Vec<DialogAction>,
    pub input: Option<DialogInputConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DialogResponse {
    pub id: Uuid,
    pub action_id: String,
    pub input_value: Option<String>,
}

pub struct DialogManager {
    pending_dialogs: Arc<Mutex<HashMap<Uuid, oneshot::Sender<DialogResponse>>>>,
}

impl DialogManager {
    pub fn new() -> Self {
        Self {
            pending_dialogs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn show_dialog<R: Runtime>(
        &self,
        app_handle: &AppHandle<R>,
        mut request: DialogRequest,
    ) -> anyhow::Result<DialogResponse> {
        let (tx, rx) = oneshot::channel();
        let id = Uuid::new_v4();
        request.id = id;

        // Store the sender in the map first
        {
            let mut pending = self.pending_dialogs.lock().await;
            pending.insert(id, tx);
        }

        // Try to emit the event
        if let Err(emit_error) = app_handle.emit("core://dialog-request", &request) {
            // If emit fails, remove the entry and return error
            let mut pending = self.pending_dialogs.lock().await;
            pending.remove(&id);
            return Err(anyhow::anyhow!(
                "Failed to emit dialog request: {}",
                emit_error
            ));
        }

        // Wait for response
        match rx.await {
            Ok(response) => Ok(response),
            Err(_) => {
                // If receiver is dropped or sender is gone, clean up and return error
                let mut pending = self.pending_dialogs.lock().await;
                pending.remove(&id);
                Err(anyhow::anyhow!(
                    "Dialog request cancelled or sender dropped"
                ))
            }
        }
    }

    pub async fn submit_response(&self, response: DialogResponse) -> bool {
        let mut pending = self.pending_dialogs.lock().await;
        if let Some(tx) = pending.remove(&response.id) {
            let _ = tx.send(response);
            true
        } else {
            false
        }
    }
}

#[tauri::command]
pub async fn submit_dialog_response(
    state: tauri::State<'_, DialogManager>,
    response: DialogResponse,
) -> Result<bool, String> {
    Ok(state.submit_response(response).await)
}
