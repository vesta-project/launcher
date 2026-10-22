//! Stage-4 IPC. Local destinations/sources originate only in native dialogs.
use crate::servers::ServerManager;
use std::{collections::BTreeMap, sync::Arc};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use vesta_server_client::{files::*, model::Page, Error, ErrorCode, Result};
type Manager<'a> = State<'a, Arc<ServerManager>>;
type Transfers<'a> = State<'a, FileTransfers>;
fn internal() -> Error {
    Error::new(ErrorCode::Internal)
}

#[tauri::command]
pub async fn server_files_list(
    manager: Manager<'_>,
    connection_id: String,
    path: String,
    cursor: Option<String>,
) -> Result<Page<FileEntry>> {
    manager
        .files_client(&connection_id)
        .await?
        .files_list(&path, cursor.as_deref())
        .await
}
#[tauri::command]
pub async fn server_file_read_text(
    manager: Manager<'_>,
    connection_id: String,
    path: String,
) -> Result<TextFile> {
    manager
        .files_client(&connection_id)
        .await?
        .file_read_text(&path)
        .await
}
#[tauri::command]
pub async fn server_file_write_text(
    manager: Manager<'_>,
    connection_id: String,
    path: String,
    text: String,
    expected_sha256: Option<String>,
    intent_id: String,
) -> Result<FileChange> {
    manager
        .files_client(&connection_id)
        .await?
        .file_write_text(&path, text, expected_sha256.as_deref(), &intent_id)
        .await
}
#[tauri::command]
pub async fn server_file_mkdir(
    manager: Manager<'_>,
    connection_id: String,
    path: String,
    intent_id: String,
) -> Result<()> {
    manager
        .files_client(&connection_id)
        .await?
        .file_mkdir(&path, &intent_id)
        .await
}
#[tauri::command]
pub async fn server_file_rename(
    manager: Manager<'_>,
    connection_id: String,
    from: String,
    to: String,
    expected_sha256: Option<String>,
    intent_id: String,
) -> Result<FileChange> {
    manager
        .files_client(&connection_id)
        .await?
        .file_rename(&from, &to, expected_sha256.as_deref(), &intent_id)
        .await
}
#[tauri::command]
pub async fn server_file_delete(
    manager: Manager<'_>,
    connection_id: String,
    path: String,
    expected_sha256: Option<String>,
    intent_id: String,
) -> Result<Deleted> {
    manager
        .files_client(&connection_id)
        .await?
        .file_delete(&path, expected_sha256.as_deref(), &intent_id)
        .await
}
#[tauri::command]
pub async fn server_trash_list(
    manager: Manager<'_>,
    connection_id: String,
    cursor: Option<String>,
) -> Result<Page<TrashEntry>> {
    manager
        .files_client(&connection_id)
        .await?
        .trash_list(cursor.as_deref())
        .await
}
#[tauri::command]
pub async fn server_trash_restore(
    manager: Manager<'_>,
    connection_id: String,
    trash_id: String,
    intent_id: String,
) -> Result<FileChange> {
    manager
        .files_client(&connection_id)
        .await?
        .trash_restore(&trash_id, &intent_id)
        .await
}
#[tauri::command]
pub async fn server_file_upload_pick(
    app: AppHandle,
    window: WebviewWindow,
    transfers: Transfers<'_>,
) -> Result<Vec<UploadCandidate>> {
    let (send, recv) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Upload files to server")
        .pick_files(move |files| {
            let _ = send.send(files);
        });
    let Some(files) = recv.await.map_err(|_| internal())? else {
        return Ok(Vec::new());
    };
    if files.len() > 64 {
        return Err(Error::new(ErrorCode::InvalidInput));
    }
    let mut candidates = Vec::new();
    for file in files {
        let path = file.into_path().map_err(|_| internal())?;
        let name = path
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or_else(internal)?
            .to_owned();
        let file = tokio::fs::File::open(path)
            .await
            .map_err(|_| internal())?
            .into_std()
            .await;
        candidates.push(transfers.pick(window.label(), file, name).await?);
    }
    Ok(candidates)
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn server_file_upload_begin(
    app: AppHandle,
    window: WebviewWindow,
    manager: Manager<'_>,
    transfers: Transfers<'_>,
    connection_id: String,
    local_id: String,
    path: String,
    expected_sha256: Option<String>,
    intent_id: String,
) -> Result<UploadProgress> {
    let client = manager.files_client(&connection_id).await?;
    let progress = transfers
        .begin(
            &client,
            window.label(),
            &connection_id,
            &local_id,
            &path,
            expected_sha256.as_deref(),
            &intent_id,
        )
        .await?;
    transfer_activity(
        &app,
        &connection_id,
        &progress.upload_id,
        "Upload server file",
        "running",
        Some((&progress.offset, &progress.total_size)),
    );
    Ok(progress)
}
#[tauri::command]
pub async fn server_file_upload_chunk(
    app: AppHandle,
    window: WebviewWindow,
    manager: Manager<'_>,
    transfers: Transfers<'_>,
    connection_id: String,
    upload_id: String,
) -> Result<UploadProgress> {
    let client = manager.files_client(&connection_id).await?;
    let result = transfers
        .chunk(&client, window.label(), &connection_id, &upload_id)
        .await;
    if let Ok(progress) = &result {
        transfer_activity(
            &app,
            &connection_id,
            &upload_id,
            "Upload server file",
            "running",
            Some((&progress.offset, &progress.total_size)),
        );
    }
    result
}
#[tauri::command]
pub async fn server_file_upload_finish(
    app: AppHandle,
    window: WebviewWindow,
    manager: Manager<'_>,
    transfers: Transfers<'_>,
    connection_id: String,
    upload_id: String,
) -> Result<FileChange> {
    let client = manager.files_client(&connection_id).await?;
    let result = transfers
        .finish(&client, window.label(), &connection_id, &upload_id)
        .await;
    transfer_activity(
        &app,
        &connection_id,
        &upload_id,
        "Upload server file",
        if result.is_ok() { "done" } else { "failed" },
        None,
    );
    result
}
#[tauri::command]
pub async fn server_file_upload_abort(
    app: AppHandle,
    window: WebviewWindow,
    manager: Manager<'_>,
    transfers: Transfers<'_>,
    connection_id: String,
    upload_id: String,
) -> Result<()> {
    let client = manager.files_client(&connection_id).await?;
    let result = transfers
        .abort(&client, window.label(), &connection_id, &upload_id)
        .await;
    transfer_activity(
        &app,
        &connection_id,
        &upload_id,
        "Upload server file",
        if result.is_ok() {
            "cancelled"
        } else {
            "failed"
        },
        None,
    );
    result
}
#[tauri::command]
pub async fn server_file_download(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    path: String,
    decompress: bool,
) -> Result<DownloadResult> {
    validate_path(&path, false)?;
    let name = path.rsplit('/').next().ok_or_else(internal)?;
    let name = if decompress && name.to_ascii_lowercase().ends_with(".gz") {
        &name[..name.len() - 3]
    } else {
        name
    };
    let (send, recv) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Save server file")
        .set_file_name(name)
        .save_file(move |file| {
            let _ = send.send(file);
        });
    let Some(file) = recv.await.map_err(|_| internal())? else {
        return Ok(DownloadResult::Cancelled);
    };
    let destination = file.into_path().map_err(|_| internal())?;
    let client = manager.files_client(&connection_id).await?;
    let transfer = uuid::Uuid::new_v4().to_string();
    transfer_activity(
        &app,
        &connection_id,
        &transfer,
        "Download server file",
        "running",
        None,
    );
    let result = client
        .file_download_with_progress(&path, decompress, &destination, |offset, total| {
            transfer_activity(
                &app,
                &connection_id,
                &transfer,
                "Download server file",
                "running",
                Some((&offset.to_string(), &total.to_string())),
            );
        })
        .await;
    transfer_activity(
        &app,
        &connection_id,
        &transfer,
        "Download server file",
        if result.is_ok() { "done" } else { "failed" },
        None,
    );
    Ok(DownloadResult::Saved { size: result? })
}
#[tauri::command]
pub async fn server_log_tail(
    manager: Manager<'_>,
    connection_id: String,
    path: String,
    lines: u16,
    decompress: bool,
) -> Result<LogPage> {
    manager
        .files_client(&connection_id)
        .await?
        .log_tail(&path, lines, decompress)
        .await
}
#[tauri::command]
pub async fn server_log_lines(
    manager: Manager<'_>,
    connection_id: String,
    path: String,
    from_byte: Option<String>,
    limit: u16,
    direction: String,
    decompress: bool,
) -> Result<LogPage> {
    manager
        .files_client(&connection_id)
        .await?
        .log_lines(&path, from_byte.as_deref(), limit, &direction, decompress)
        .await
}
#[tauri::command]
pub async fn server_properties_get(
    manager: Manager<'_>,
    connection_id: String,
) -> Result<ServerProperties> {
    manager
        .files_client(&connection_id)
        .await?
        .properties_get()
        .await
}
#[tauri::command]
pub async fn server_properties_update(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    changes: BTreeMap<String, serde_json::Value>,
    expected_sha256: String,
    confirmation_token: Option<String>,
    intent_id: String,
) -> Result<PropertiesUpdateResult> {
    manager
        .files_properties_update(
            &app,
            &connection_id,
            changes,
            &expected_sha256,
            confirmation_token.as_deref(),
            &intent_id,
        )
        .await
}
fn transfer_activity(
    app: &AppHandle,
    connection: &str,
    transfer: &str,
    name: &str,
    state: &str,
    bytes: Option<(&str, &str)>,
) {
    let progress = bytes
        .and_then(|(offset, total)| Some((offset.parse::<u64>().ok()?, total.parse::<u64>().ok()?)))
        .map(|(offset, total)| {
            if total == 0 {
                100
            } else {
                (offset.saturating_mul(100) / total).min(100) as i32
            }
        })
        .unwrap_or(-1);
    crate::tasks::activity::publish(
        app,
        "core://task-state",
        serde_json::json!({"id":format!("server-file:{connection}:{transfer}"),"attempt":transfer,"state":state,"kind":"task","name":name,"source":"server","visibility":"foreground","progress":progress,"cancellable":false,"pausable":false,"subject":{"id":connection,"name":"Vesta server","instanceId":null,"iconUrl":null}}),
    );
}
