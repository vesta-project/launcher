//! Native author-theme IPC. A renderer can request a preview, never authorize a
//! commit. Only the OS dialog callback can keep an unexpired owner-bound ticket.
use super::author_theme_store::{self as store, AppearanceSnapshot, Store};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

static AUTHORITY: Mutex<()> = Mutex::new(());
static PREVIEWS: LazyLock<Mutex<HashMap<PathBuf, Preview>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
#[derive(Default)]
struct RevisionWatermark {
    revision: u64,
    fallback: bool,
}
static REVISIONS: LazyLock<Mutex<HashMap<PathBuf, RevisionWatermark>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}
// Caller holds AUTHORITY. Corruption and on-disk rollback allocate one stable
// safe revision above every response issued during this host's lifetime.
fn observe(path: &PathBuf, mut snapshot: AppearanceSnapshot) -> AppearanceSnapshot {
    let mut revisions = REVISIONS.lock().unwrap_or_else(|e| e.into_inner());
    let high = revisions.entry(path.clone()).or_default();
    if snapshot.safe_fallback || snapshot.revision < high.revision {
        if !high.fallback || snapshot.revision >= high.revision {
            high.revision = high.revision.max(snapshot.revision) + 1;
        }
        high.fallback = true;
        snapshot.revision = high.revision;
        snapshot.safe_fallback = true;
        snapshot.selected = None;
        if snapshot.warning.is_none() {
            snapshot.warning = Some("Appearance store revision regressed; safe built-in fallback is active. Reset to repair.".into());
        }
    } else {
        high.revision = snapshot.revision;
        high.fallback = false;
    }
    snapshot
}
fn authoritative_snapshot(path: &PathBuf) -> AppearanceSnapshot {
    observe(path, store::load_snapshot(path))
}
fn checked_store(path: &PathBuf, expected: u64) -> Result<Store, String> {
    let state = Store::read(path)?;
    let current = observe(path, state.snapshot());
    if current.revision != state.revision {
        return Err(
            "Appearance revision conflict: store regressed or needs recovery; refetch and reset"
                .into(),
        );
    }
    state.check(expected)?;
    Ok(state)
}
const PREVIEW_DURATION: Duration = Duration::from_secs(30);
struct Preview {
    token: String,
    id: String,
    revision: u64,
    owner: String,
    deadline: Instant,
    dialog_open: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewTicket {
    token: String,
    expires_at: u64,
    candidate: AppearanceSnapshot,
}
#[derive(Clone, Serialize)]
struct PreviewEnded {
    token: String,
}
#[derive(Clone, Serialize)]
struct Invalidation {
    revision: u64,
}
fn root() -> Result<PathBuf, String> {
    crate::utils::db_manager::get_app_config_dir().map_err(|e| e.to_string())
}
fn end(app: &tauri::AppHandle, preview: Preview) {
    let _ = app.emit_to(
        preview.owner.as_str(),
        "author-theme-preview-ended",
        PreviewEnded {
            token: preview.token,
        },
    );
}
fn invalidate_preview(app: &tauri::AppHandle, path: &PathBuf) {
    if let Ok(mut previews) = PREVIEWS.lock() {
        if let Some(p) = previews.remove(path) {
            end(app, p);
        }
    }
}
fn publish(app: &tauri::AppHandle, path: &PathBuf, snapshot: &AppearanceSnapshot) {
    // All persisted mutations pass through the same in-memory high-water mark.
    let _ = observe(path, snapshot.clone());
    invalidate_preview(app, path);
    let _ = app.emit(
        "rewrite-theme-updated",
        Invalidation {
            revision: snapshot.revision,
        },
    );
}
fn mutate(
    app: &tauri::AppHandle,
    expected: u64,
    operation: impl FnOnce(&mut Store) -> Result<(), String>,
) -> Result<AppearanceSnapshot, String> {
    let _guard = AUTHORITY.lock().map_err(|e| e.to_string())?;
    let path = root()?;
    let mut state = checked_store(&path, expected)?;
    operation(&mut state)?;
    let snapshot = state.persist(&path)?;
    publish(app, &path, &snapshot);
    Ok(snapshot)
}
#[tauri::command]
pub async fn get_author_theme_state() -> Result<AppearanceSnapshot, String> {
    blocking(|| {
        let _guard = AUTHORITY.lock().map_err(|e| e.to_string())?;
        Ok(authoritative_snapshot(&root()?))
    })
    .await
}
#[tauri::command]
pub async fn import_author_theme(
    app: tauri::AppHandle,
    contents: String,
    expected_revision: u64,
) -> Result<AppearanceSnapshot, String> {
    if contents.len() > store::MAX_INPUT {
        return Err("Theme file exceeds 256 KiB".into());
    }
    blocking(move || mutate(&app, expected_revision, |s| s.import(&contents))).await
}
#[tauri::command]
pub async fn remove_author_theme(
    app: tauri::AppHandle,
    id: String,
    expected_revision: u64,
) -> Result<AppearanceSnapshot, String> {
    blocking(move || mutate(&app, expected_revision, |s| s.remove(&id))).await
}
#[tauri::command]
pub async fn disable_author_theme(
    app: tauri::AppHandle,
    expected_revision: u64,
) -> Result<AppearanceSnapshot, String> {
    blocking(move || mutate(&app, expected_revision, |s| s.select(None))).await
}
#[tauri::command]
pub async fn reset_author_theme_state(
    app: tauri::AppHandle,
    expected_revision: u64,
) -> Result<AppearanceSnapshot, String> {
    blocking(move || {
        let _guard = AUTHORITY.lock().map_err(|e| e.to_string())?;
        let path = root()?;
        let current = authoritative_snapshot(&path);
        if current.revision != expected_revision {
            return Err(format!(
                "Appearance revision conflict: expected {expected_revision}, current {}",
                current.revision
            ));
        }
        let snapshot = store::reset(&path, expected_revision, current.revision)?;
        publish(&app, &path, &snapshot);
        Ok(snapshot)
    })
    .await
}
pub async fn update_builtin(
    app: tauri::AppHandle,
    updates: HashMap<String, serde_json::Value>,
    expected_revision: u64,
) -> Result<AppearanceSnapshot, String> {
    blocking(move || mutate(&app, expected_revision, |s| s.update_builtin(updates))).await
}

#[tauri::command]
pub async fn begin_author_theme_preview(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    expected_revision: u64,
) -> Result<PreviewTicket, String> {
    blocking(move || {
        let _guard = AUTHORITY.lock().map_err(|e| e.to_string())?;
        let path = root()?;
        let mut state = checked_store(&path, expected_revision)?;
        state.select(Some(id.clone()))?;
        let mut previews = PREVIEWS.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = previews.get(&path) {
            if existing.deadline > Instant::now() {
                return Err("Another author theme preview is already active".into());
            }
        }
        if let Some(expired) = previews.remove(&path) {
            end(&app, expired);
        }
        let token = uuid::Uuid::new_v4().to_string();
        let deadline = Instant::now() + PREVIEW_DURATION;
        let expires_at = (SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            + PREVIEW_DURATION)
            .as_millis() as u64;
        previews.insert(
            path.clone(),
            Preview {
                token: token.clone(),
                id,
                revision: expected_revision,
                owner: window.label().to_owned(),
                deadline,
                dialog_open: false,
            },
        );
        drop(previews);
        let timer_token = token.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(PREVIEW_DURATION).await;
            // Native deadline is authoritative even if the WebView is unresponsive.
            if let Ok(mut previews) = PREVIEWS.lock() {
                if previews.get(&path).is_some_and(|p| p.token == timer_token) {
                    if let Some(p) = previews.remove(&path) {
                        end(&app, p);
                    }
                }
            }
        });
        Ok(PreviewTicket {
            token,
            expires_at,
            candidate: state.snapshot(),
        })
    })
    .await
}

fn owner_matches(p: &Preview, token: &str, owner: &str) -> bool {
    p.token == token && p.owner == owner
}
fn committable(p: &Preview, token: &str, owner: &str, revision: u64, now: Instant) -> bool {
    owner_matches(p, token, owner) && p.revision == revision && now < p.deadline
}
#[tauri::command]
pub async fn confirm_author_theme_preview(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    token: String,
) -> Result<AppearanceSnapshot, String> {
    let owner = window.label().to_owned();
    let initial_token = token.clone();
    let (path, deadline) = blocking(move || {
        let path = root()?;
        let deadline = {
            let _guard = AUTHORITY.lock().map_err(|e| e.to_string())?;
            let mut previews = PREVIEWS.lock().map_err(|e| e.to_string())?;
            let p = previews
                .get_mut(&path)
                .ok_or("Preview is no longer active")?;
            if !owner_matches(p, &initial_token, owner.as_str())
                || Instant::now() >= p.deadline
                || p.dialog_open
            {
                return Err(
                "Preview is expired, already awaiting confirmation, or belongs to another window"
                    .into(),
            );
            }
            p.dialog_open = true;
            p.deadline
        };
        Ok((path, deadline))
    })
    .await?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().message("Keep this author theme? Choose Revert if the launcher is unreadable. This preview expires after 30 seconds; a late Keep is ignored.")
        .title("Keep author theme?").parent(&window)
        .buttons(MessageDialogButtons::OkCancelCustom("Keep".into(), "Revert".into()))
        .show(move |keep| { let _ = tx.send(keep); });
    // Never hold either mutex while the native dialog is open. Timeout completes
    // IPC even on platforms where an already-open OS dialog cannot be dismissed.
    let remaining = deadline.saturating_duration_since(Instant::now());
    let keep = matches!(tokio::time::timeout(remaining, rx).await, Ok(Ok(true)));
    let owner = window.label().to_owned();
    blocking(move || {
        let _guard = AUTHORITY.lock().map_err(|e| e.to_string())?;
        let mut previews = PREVIEWS.lock().map_err(|e| e.to_string())?;
        let ours = previews
            .get(&path)
            .is_some_and(|p| owner_matches(p, &token, owner.as_str()));
        if !ours {
            return Ok(authoritative_snapshot(&path));
        }
        let p = previews
            .remove(&path)
            .ok_or("Preview is no longer active")?;
        drop(previews);
        let result = (|| {
            if !keep {
                return Ok(authoritative_snapshot(&path));
            }
            let mut state = checked_store(&path, p.revision)?;
            if keep
                && committable(&p, &token, owner.as_str(), state.revision, Instant::now())
                && app.get_webview_window(owner.as_str()).is_some()
            {
                state.select(Some(p.id.clone()))?;
                let snapshot = state.persist(&path)?;
                publish(&app, &path, &snapshot);
                Ok(snapshot)
            } else {
                Ok(state.snapshot())
            }
        })();
        end(&app, p);
        result
    })
    .await
}

#[tauri::command]
pub async fn cancel_author_theme_preview(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    token: String,
) -> Result<AppearanceSnapshot, String> {
    blocking(move || {
        let _guard = AUTHORITY.lock().map_err(|e| e.to_string())?;
        let path = root()?;
        let mut previews = PREVIEWS.lock().map_err(|e| e.to_string())?;
        if previews
            .get(&path)
            .is_some_and(|p| owner_matches(p, &token, window.label()))
        {
            if let Some(p) = previews.remove(&path) {
                end(&app, p);
            }
        }
        drop(previews);
        Ok(authoritative_snapshot(&path))
    })
    .await
}

/// Called on page navigation, window close and destruction.
pub fn abort_window_preview(app: &tauri::AppHandle, owner: &str) {
    if let Ok(mut previews) = PREVIEWS.lock() {
        let paths: Vec<_> = previews
            .iter()
            .filter(|(_, p)| p.owner == owner)
            .map(|(path, _)| path.clone())
            .collect();
        for path in paths {
            if let Some(p) = previews.remove(&path) {
                end(app, p);
            }
        }
    }
}
/// Run in startup setup before IPC hydration and in the single-instance callback before showing windows.
/// Only the exact switch is consumed; launch-intent arguments remain untouched.
pub fn recover_from_args(app: Option<&tauri::AppHandle>, args: &[String]) -> Result<(), String> {
    if !args.iter().any(|arg| arg == "--disable-custom-theme") {
        return Ok(());
    }
    let _guard = AUTHORITY.lock().map_err(|e| e.to_string())?;
    let path = root()?;
    let current = authoritative_snapshot(&path);
    let snapshot = observe(&path, store::recover(&path, current.revision)?);
    if let Some(app) = app {
        // Always invalidate existing windows, even if another recovery already
        // cleared selection or only a transient preview was present.
        publish(app, &path, &snapshot);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn corrupt_fallback_and_reset_advance_past_every_inflight_snapshot() {
        let _guard = AUTHORITY.lock().unwrap();
        let root = tempfile::tempdir().unwrap();
        let path = root.path().to_owned();
        let mut state = Store::read(&path).unwrap();
        state.revision = 8;
        let old_response = state.persist(&path).unwrap();
        observe(&path, old_response.clone());
        std::fs::write(path.join(store::FILE), "corrupt").unwrap();
        let fallback = authoritative_snapshot(&path);
        assert_eq!(old_response.revision, 9);
        assert_eq!(fallback.revision, 10);
        assert!(fallback.selected.is_none());
        assert!(fallback.warning.is_some());
        assert_eq!(authoritative_snapshot(&path).revision, 10);
        let reset = store::reset(&path, fallback.revision, fallback.revision).unwrap();
        observe(&path, reset.clone());
        assert_eq!(reset.revision, 11);
        assert_eq!(authoritative_snapshot(&path).revision, 11);
        assert!(old_response.revision < reset.revision);
    }
    #[test]
    fn native_ticket_rejects_timeout_stale_revision_and_other_owners() {
        let now = Instant::now();
        let p = Preview {
            token: "ticket".into(),
            id: "id".into(),
            revision: 4,
            owner: "main".into(),
            deadline: now + Duration::from_secs(1),
            dialog_open: false,
        };
        assert!(committable(&p, "ticket", "main", 4, now));
        assert!(!committable(&p, "ticket", "other", 4, now));
        assert!(!committable(&p, "other", "main", 4, now));
        assert!(!committable(&p, "ticket", "main", 5, now));
        assert!(!committable(&p, "ticket", "main", 4, p.deadline));
        assert!(!committable(
            &p,
            "ticket",
            "main",
            4,
            p.deadline + Duration::from_secs(60)
        ));
    }
}
