use crate::worlds::archive::WorldArchiveCandidate;
use chrono::{Duration, Utc};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;
use tokio::sync::oneshot;
use uuid::Uuid;

const SELECTION_TIMEOUT_MINUTES: i64 = 15;

static PENDING: OnceLock<Mutex<HashMap<String, oneshot::Sender<Vec<String>>>>> = OnceLock::new();

fn pending() -> &'static Mutex<HashMap<String, oneshot::Sender<Vec<String>>>> {
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectionRequiredEvent {
    install_id: String,
    project: serde_json::Value,
    candidates: Vec<WorldArchiveCandidate>,
    expires_at: String,
}

pub async fn request_selection(
    app_handle: &tauri::AppHandle,
    project: serde_json::Value,
    candidates: Vec<WorldArchiveCandidate>,
    mut cancel_rx: tokio::sync::watch::Receiver<bool>,
) -> Result<Vec<String>, String> {
    let install_id = Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    pending()
        .lock()
        .map_err(|_| "World archive selection is unavailable".to_string())?
        .insert(install_id.clone(), sender);

    let expires_at = Utc::now() + Duration::minutes(SELECTION_TIMEOUT_MINUTES);
    if let Err(error) = app_handle.emit(
        "core://world-install-selection-required",
        SelectionRequiredEvent {
            install_id: install_id.clone(),
            project,
            candidates,
            expires_at: expires_at.to_rfc3339(),
        },
    ) {
        pending()
            .lock()
            .ok()
            .and_then(|mut map| map.remove(&install_id));
        return Err(format!("Failed to request world selection: {error}"));
    }

    let response = tokio::select! {
        response = tokio::time::timeout(
            std::time::Duration::from_secs((SELECTION_TIMEOUT_MINUTES * 60) as u64),
            receiver,
        ) => response,
        _ = cancel_rx.changed() => {
            pending().lock().ok().and_then(|mut map| map.remove(&install_id));
            return Err("World installation cancelled".to_string());
        }
    };
    match response {
        Ok(Ok(selected)) if !selected.is_empty() => Ok(selected),
        Ok(Ok(_)) => Err("World installation was cancelled".to_string()),
        Ok(Err(_)) => Err("World archive selection was cancelled".to_string()),
        Err(_) => {
            pending()
                .lock()
                .ok()
                .and_then(|mut map| map.remove(&install_id));
            Err("World archive selection expired".to_string())
        }
    }
}

pub fn submit_selection(
    install_id: &str,
    selected_candidate_ids: Vec<String>,
) -> Result<(), String> {
    let sender = pending()
        .lock()
        .map_err(|_| "World archive selection is unavailable".to_string())?
        .remove(install_id)
        .ok_or_else(|| "World archive selection is no longer pending".to_string())?;
    sender
        .send(selected_candidate_ids)
        .map_err(|_| "World archive selection is no longer pending".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_selection_id_is_rejected() {
        assert!(submit_selection("missing", vec!["candidate-1".into()]).is_err());
    }
}
