use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// Structured launch intent queued until the frontend signals ready.
/// Uses a global queue so macOS `RunEvent::Opened` can enqueue before managed state exists.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum QueuedIntent {
    Argv { args: Vec<String> },
    Path { path: String },
}

static INTENT_QUEUE: OnceLock<Mutex<Vec<QueuedIntent>>> = OnceLock::new();

fn queue() -> &'static Mutex<Vec<QueuedIntent>> {
    INTENT_QUEUE.get_or_init(|| Mutex::new(Vec::new()))
}

fn push_intent(intent: QueuedIntent) {
    match queue().lock() {
        Ok(mut intents) => intents.push(intent),
        Err(error) => {
            log::warn!("Failed to lock launch intent queue: {error}");
        }
    }
}

fn drain_queue() -> Vec<QueuedIntent> {
    queue()
        .lock()
        .map(|mut intents| std::mem::take(&mut *intents))
        .unwrap_or_else(|error| {
            log::warn!("Failed to drain launch intent queue: {error}");
            Vec::new()
        })
}

/// Tracks whether the frontend has registered listeners and is ready to receive intents.
pub struct PendingLaunchIntents {
    frontend_ready: AtomicBool,
}

impl PendingLaunchIntents {
    pub fn new() -> Self {
        Self {
            frontend_ready: AtomicBool::new(false),
        }
    }

    pub fn mark_frontend_ready(&self) -> bool {
        self.frontend_ready
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    pub fn is_frontend_ready(&self) -> bool {
        self.frontend_ready.load(Ordering::SeqCst)
    }
}

impl Default for PendingLaunchIntents {
    fn default() -> Self {
        Self::new()
    }
}

/// Returns true when a bare string looks like a file path rather than a CLI token.
pub fn is_plausible_file_path(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return false;
    }

    trimmed.ends_with(".mrpack")
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || (trimmed.len() >= 2 && trimmed.as_bytes()[1] == b':')
}

/// Normalize a single opened URL/path into a local filesystem path when applicable.
pub fn normalize_opened_path(arg: &str) -> Option<String> {
    let trimmed = arg.trim();
    if trimmed.is_empty() || trimmed.starts_with('-') {
        return None;
    }

    if trimmed.starts_with("vesta://") {
        return None;
    }

    if trimmed.contains('\\') || (trimmed.len() >= 2 && trimmed.as_bytes()[1] == b':') {
        return Some(trimmed.to_string());
    }

    if let Ok(url) = url::Url::parse(trimmed) {
        if url.scheme() == "file" {
            return url
                .to_file_path()
                .ok()
                .map(|path| path.to_string_lossy().into_owned());
        }
        return None;
    }

    if is_plausible_file_path(trimmed) {
        return Some(trimmed.to_string());
    }

    None
}

pub fn ingest_launch_args(args: &[String]) {
    if args.len() <= 1 {
        return;
    }

    let tail = args[1..].to_vec();
    let has_cli_or_deeplink = tail
        .iter()
        .any(|arg| arg.starts_with('-') || arg.starts_with("vesta://"));

    if has_cli_or_deeplink {
        push_intent(QueuedIntent::Argv { args: tail });
        return;
    }

    for arg in tail {
        if let Some(path) = normalize_opened_path(&arg) {
            push_intent(QueuedIntent::Path { path });
        }
    }
}

pub fn ingest_opened_urls(urls: &[tauri::Url]) {
    for url in urls {
        if let Some(path) = normalize_opened_path(url.as_str()) {
            push_intent(QueuedIntent::Path { path });
            continue;
        }
        if let Ok(path) = url.to_file_path() {
            push_intent(QueuedIntent::Path {
                path: path.to_string_lossy().into_owned(),
            });
        }
    }
}

pub fn flush_pending_intents(app: &AppHandle) {
    let drained = drain_queue();
    if drained.is_empty() {
        return;
    }

    let _ = crate::utils::windows::ensure_main_window_visible(app);
    let _ = app.emit("core://handle-launch-intents", drained);
}

#[tauri::command]
pub fn consume_pending_intents(_app: tauri::AppHandle) -> Vec<QueuedIntent> {
    drain_queue()
}

#[tauri::command]
pub fn signal_frontend_ready(app: tauri::AppHandle) {
    let state = app.state::<PendingLaunchIntents>();
    if state.mark_frontend_ready() {
        flush_pending_intents(&app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reset_queue() {
        if let Ok(mut intents) = queue().lock() {
            intents.clear();
        }
    }

    #[test]
    fn ingest_launch_args_preserves_cli_argv() {
        reset_queue();
        ingest_launch_args(&[
            "vesta".to_string(),
            "--open-resource".to_string(),
            "modrinth".to_string(),
            "fabric-api".to_string(),
        ]);

        let drained = drain_queue();
        assert_eq!(drained.len(), 1);
        assert_eq!(
            drained[0],
            QueuedIntent::Argv {
                args: vec![
                    "--open-resource".to_string(),
                    "modrinth".to_string(),
                    "fabric-api".to_string(),
                ],
            }
        );
    }

    #[test]
    fn ingest_launch_args_queues_file_paths_individually() {
        reset_queue();
        ingest_launch_args(&["vesta".to_string(), "/tmp/pack.mrpack".to_string()]);

        let drained = drain_queue();
        assert_eq!(
            drained,
            vec![QueuedIntent::Path {
                path: "/tmp/pack.mrpack".to_string(),
            }]
        );
    }

    #[test]
    fn normalize_opened_path_rejects_bare_tokens() {
        assert_eq!(normalize_opened_path("modrinth"), None);
        assert_eq!(normalize_opened_path("fabric-api"), None);
    }

    #[test]
    fn normalize_opened_path_accepts_mrpack_and_separators() {
        assert_eq!(
            normalize_opened_path("/tmp/pack.mrpack"),
            Some("/tmp/pack.mrpack".to_string())
        );
        assert_eq!(
            normalize_opened_path(r"C:\Users\pack.mrpack"),
            Some(r"C:\Users\pack.mrpack".to_string())
        );
    }
}
