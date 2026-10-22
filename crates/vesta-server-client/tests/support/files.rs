//! Stage-4 fixtures use the same pinned TLS/session machinery as other commands.
use super::*;
use std::collections::{BTreeMap, HashMap};
use vesta_server_client::files::{FileTransfers, PropertiesUpdateResult, CHUNK_BYTES};
#[derive(Default)]
pub(super) struct Files {
    begins: AtomicUsize,
    begin_ids: Mutex<HashMap<String, String>>,
    lost_begin: AtomicBool,
    content: Mutex<HashMap<String, Vec<u8>>>,
    upload: Mutex<Vec<u8>>,
    upload_size: AtomicUsize,
    upload_hash: Mutex<String>,
    chunks: Mutex<Vec<(usize, String)>>,
    lost_chunk: AtomicBool,
    slow_chunk: AtomicBool,
    aborts: AtomicUsize,
    failures: AtomicUsize,
    resumes: AtomicUsize,
    force_restart: AtomicBool,
    invalid_download_etag: AtomicBool,
    wrong_resume_etag: AtomicBool,
    property_key: Mutex<Option<String>>,
}
pub(super) fn handles(path: &str) -> bool {
    path.starts_with("/api/v3/manage/files")
        || path.starts_with("/api/v3/manage/trash")
        || path == "/api/v3/manage/config/server-properties"
}
fn binary(
    bytes: Vec<u8>,
    size: usize,
    tag: &str,
    partial: Option<usize>,
    sha: bool,
) -> Response<Body> {
    let mut reply = Response::builder()
        .status(if partial.is_some() { 206 } else { 200 })
        .header("x-vesta-api-version", "3")
        .header("etag", tag)
        .header("content-length", bytes.len())
        .header("x-vesta-file-size", size);
    if let Some(start) = partial {
        reply = reply.header(
            "content-range",
            format!("bytes {start}-{}/{size}", size - 1),
        );
    }
    if sha {
        reply = reply.header("x-vesta-sha256", leaf_fingerprint(&bytes));
    }
    reply.body(Body::from(bytes)).unwrap()
}
fn change(bytes: &[u8]) -> Response<Body> {
    envelope(
        json!({"outcome":"succeeded","sha256":leaf_fingerprint(bytes),"size":bytes.len().to_string(),"trash_id":null}),
    )
}
pub(super) fn route(
    req: &Request<Body>,
    bytes: &[u8],
    body: &Value,
    state: &Files,
) -> Response<Body> {
    assert!(req.headers()["authorization"]
        .to_str()
        .unwrap()
        .starts_with("Bearer token-"));
    let path = req.uri().path();
    let query: HashMap<String, String> =
        url::form_urlencoded::parse(req.uri().query().unwrap_or("").as_bytes())
            .into_owned()
            .collect();
    let name = query.get("path").map(String::as_str).unwrap_or("");
    match (req.method().as_str(), path) {
        ("GET", "/api/v3/manage/files") => envelope(
            json!({"items":[{"name":"config","kind":"directory","size":"0","modified_at":123}],"next_cursor":"next.page"}),
        ),
        ("GET", "/api/v3/manage/files/content") => {
            let content = state.content.lock().unwrap();
            let Some(data) = content.get(name) else {
                return error(StatusCode::NOT_FOUND, "resource_not_found");
            };
            if let Some(range) = req.headers().get("range") {
                assert_eq!(range, "bytes=0-1048575");
                return binary(
                    data[..CHUNK_BYTES.min(data.len())].to_vec(),
                    data.len(),
                    "\"metadata-not-sha\"",
                    Some(0),
                    false,
                );
            }
            if data.len() > CHUNK_BYTES {
                return error(StatusCode::PAYLOAD_TOO_LARGE, "request_too_large");
            }
            binary(
                data.clone(),
                data.len(),
                &format!("\"{}\"", leaf_fingerprint(data)),
                None,
                true,
            )
        }
        ("PUT", "/api/v3/manage/files/content") => {
            let mut content = state.content.lock().unwrap();
            if let Some(hash) = req.headers().get("if-match") {
                if content.get(name).map(|v| leaf_fingerprint(v)).as_deref() != hash.to_str().ok() {
                    return error(StatusCode::PRECONDITION_FAILED, "precondition_failed");
                }
            } else {
                assert_eq!(req.headers()["if-none-match"], "*");
                if content.contains_key(name) {
                    return error(StatusCode::PRECONDITION_FAILED, "precondition_failed");
                }
            }
            content.insert(name.into(), bytes.into());
            change(bytes)
        }
        ("GET", "/api/v3/manage/files/download") => {
            if name.ends_with(".gz") {
                assert_eq!(query.get("decompress").map(String::as_str), Some("1"));
            }
            let content = state.content.lock().unwrap();
            let Some(data) = content.get(name) else {
                return error(StatusCode::NOT_FOUND, "resource_not_found");
            };
            if state.invalid_download_etag.load(Ordering::SeqCst) {
                return binary(data.clone(), data.len(), "W/\"weak\"", None, false);
            }
            let start = req.headers().get("range").map(|v| {
                v.to_str()
                    .unwrap()
                    .strip_prefix("bytes=")
                    .unwrap()
                    .strip_suffix('-')
                    .unwrap()
                    .parse::<usize>()
                    .unwrap()
            });
            if start.is_some() {
                state.resumes.fetch_add(1, Ordering::SeqCst);
                assert_eq!(req.headers()["if-range"], "\"download-tag\"");
            }
            let start = if state.force_restart.load(Ordering::SeqCst) {
                None
            } else {
                start
            };
            if state
                .failures
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| v.checked_sub(1))
                .is_ok()
            {
                let (mut tx, stream) = Body::channel();
                let prefix = data[start.unwrap_or(0)..start.unwrap_or(0) + 65536].to_vec();
                tokio::spawn(async move {
                    tx.send_data(prefix.into()).await.unwrap();
                    tokio::time::sleep(std::time::Duration::from_millis(40)).await;
                    tx.abort();
                });
                let mut reply = binary(Vec::new(), data.len(), "\"download-tag\"", start, false);
                reply
                    .headers_mut()
                    .insert("content-length", (data.len() - start.unwrap_or(0)).into());
                *reply.body_mut() = stream;
                return reply;
            }
            let tag = if start.is_some() && state.wrong_resume_etag.load(Ordering::SeqCst) {
                "\"different-version\""
            } else {
                "\"download-tag\""
            };
            binary(
                data[start.unwrap_or(0)..].to_vec(),
                data.len(),
                tag,
                start,
                false,
            )
        }
        ("POST", "/api/v3/manage/files/mkdir") => {
            assert_eq!(body["path"], "config/new");
            envelope(json!({"outcome":"succeeded"}))
        }
        ("POST", "/api/v3/manage/files/rename") => {
            let mut content = state.content.lock().unwrap();
            let data = content.remove(body["from"].as_str().unwrap()).unwrap();
            assert_eq!(body["expected_sha256"], leaf_fingerprint(&data));
            content.insert(body["to"].as_str().unwrap().into(), data.clone());
            change(&data)
        }
        ("DELETE", "/api/v3/manage/files") => {
            assert_eq!(
                req.headers()["if-match"],
                leaf_fingerprint(state.content.lock().unwrap().get(name).unwrap())
            );
            envelope(json!({"outcome":"succeeded","trash_id":"trash-1"}))
        }
        ("GET", "/api/v3/manage/trash") => envelope(
            json!({"items":[{"id":"trash-1","path":"config/a.txt","size":"3","sha256":"ab".repeat(32),"trashed_at_ms":5,"expires_at_ms":6}],"next_cursor":null}),
        ),
        ("POST", "/api/v3/manage/trash/trash-1/restore") => change(b"abc"),
        ("POST", "/api/v3/manage/files/uploads") => {
            assert_eq!(req.headers()["if-none-match"], "*");
            state.upload_size.store(
                body["total_size"].as_str().unwrap().parse().unwrap(),
                Ordering::SeqCst,
            );
            *state.upload_hash.lock().unwrap() = body["sha256"].as_str().unwrap().into();
            let mut ids = state.begin_ids.lock().unwrap();
            let id = ids
                .entry(req.headers()["idempotency-key"].to_str().unwrap().into())
                .or_insert_with(|| {
                    if state.begins.fetch_add(1, Ordering::SeqCst) == 0 {
                        "0123456789abcdef0123456789abcdef".into()
                    } else {
                        "fedcba9876543210fedcba9876543210".into()
                    }
                });
            if state.lost_begin.swap(false, Ordering::SeqCst) {
                return error(StatusCode::GATEWAY_TIMEOUT, "lost_begin_reply");
            }
            envelope(json!({"upload_id":id,"offset":"0"}))
        }
        ("PUT", "/api/v3/manage/files/uploads/0123456789abcdef0123456789abcdef") => {
            assert!(!bytes.is_empty() && bytes.len() <= CHUNK_BYTES);
            let offset = query["offset"].parse::<usize>().unwrap();
            state.chunks.lock().unwrap().push((
                offset,
                req.headers()["idempotency-key"].to_str().unwrap().into(),
            ));
            let mut upload = state.upload.lock().unwrap();
            assert!(offset <= upload.len());
            let overlap = bytes.len().min(upload.len() - offset);
            assert_eq!(&upload[offset..offset + overlap], &bytes[..overlap]);
            if state.lost_chunk.swap(false, Ordering::SeqCst) {
                upload.extend_from_slice(&bytes[overlap..65536]);
                return error(StatusCode::BAD_GATEWAY, "lost_after_partial_append");
            }
            upload.extend_from_slice(&bytes[overlap..]);
            let mut reply = envelope(json!({"offset":upload.len().to_string()}));
            if state.slow_chunk.swap(false, Ordering::SeqCst) {
                let body = serde_json::to_vec(
                    &json!({"api_version":"3","data":{"offset":upload.len().to_string()}}),
                )
                .unwrap();
                let (mut send, stream) = Body::channel();
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    let _ = send.send_data(body.into()).await;
                });
                *reply.body_mut() = stream;
            }
            reply
        }
        ("POST", "/api/v3/manage/files/uploads/0123456789abcdef0123456789abcdef/finish") => {
            let upload = state.upload.lock().unwrap();
            assert_eq!(upload.len(), state.upload_size.load(Ordering::SeqCst));
            assert_eq!(
                leaf_fingerprint(&upload),
                *state.upload_hash.lock().unwrap()
            );
            change(&upload)
        }
        (
            "DELETE",
            "/api/v3/manage/files/uploads/0123456789abcdef0123456789abcdef"
            | "/api/v3/manage/files/uploads/fedcba9876543210fedcba9876543210",
        ) => {
            assert!(bytes.is_empty());
            state.aborts.fetch_add(1, Ordering::SeqCst);
            envelope(json!({"outcome":"succeeded"}))
        }
        ("GET", "/api/v3/manage/files/tail" | "/api/v3/manage/files/lines") => {
            assert_eq!(query.get("decompress").map(String::as_str), Some("1"));
            let text = "a".repeat(CHUNK_BYTES + 100);
            envelope(
                json!({"bytes_base64":base64::engine::general_purpose::STANDARD.encode(text.as_bytes()),"encoding":"utf-8","start_byte":"0","cursor":text.len().to_string(),"next_byte":null,"prev_byte":null,"size":text.len().to_string(),"etag":"\"gz-view\""}),
            )
        }
        ("GET", "/api/v3/manage/config/server-properties") => envelope(
            json!({"values":{"online-mode":true,"max-players":20,"motd":"Hello","custom_key":"[redacted]","rcon.password":"[redacted]"},"sha256":"ab".repeat(32)}),
        ),
        ("PATCH", "/api/v3/manage/config/server-properties") => {
            assert!(!req.headers().contains_key("if-match"));
            assert_eq!(
                body["changes"],
                json!({"online-mode":false,"max-players":24,"motd":"New"})
            );
            let key = req.headers()["idempotency-key"]
                .to_str()
                .unwrap()
                .to_owned();
            if body.get("confirmation_token").is_none() {
                *state.property_key.lock().unwrap() = Some(key);
                let mut reply = envelope(
                    json!({"state":"awaiting_confirmation","operation_id":"prop-op","confirmation_token":"properties-confirm","expires_at_ms":vesta_server_client::now_ms()+120000}),
                );
                *reply.status_mut() = StatusCode::ACCEPTED;
                reply
            } else {
                assert_eq!(
                    state.property_key.lock().unwrap().as_deref(),
                    Some(key.as_str())
                );
                if body["confirmation_token"] != "properties-confirm" {
                    return error(StatusCode::CONFLICT, "confirmation_invalid");
                }
                envelope(
                    json!({"outcome":"succeeded","sha256":"cd".repeat(32),"size":"123","trash_id":null,"restart_needed":true}),
                )
            }
        }
        _ => error(StatusCode::NOT_FOUND, "resource_not_found"),
    }
}

#[tokio::test]
async fn files_validators_prefix_binary_trash_and_properties() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    let client = agent.paired().await;
    for path in ["config/dotted..txt", "config/a+b#c%.txt"] {
        client
            .file_write_text(path, "encoded path".into(), None, path)
            .await
            .unwrap();
        assert_eq!(
            client.file_read_text(path).await.unwrap().text,
            "encoded path"
        );
    }
    let entries = client.files_list("", None).await.unwrap();
    assert_eq!(entries.items[0].modified_at_ms, Some(123));
    assert_eq!(entries.next_cursor.as_deref(), Some("next.page"));
    let change = client
        .file_write_text("config/a.txt", "abc".into(), None, "create")
        .await
        .unwrap();
    let text = client.file_read_text("config/a.txt").await.unwrap();
    assert_eq!(text.text, "abc");
    assert_eq!(text.sha256, Some(change.sha256.clone()));
    assert_eq!(
        client
            .file_write_text(
                "config/a.txt",
                "wrong".into(),
                Some(&"00".repeat(32)),
                "stale"
            )
            .await
            .unwrap_err()
            .code,
        ErrorCode::StaleTarget
    );
    client.file_mkdir("config/new", "mkdir").await.unwrap();
    client
        .file_rename("config/a.txt", "config/b.txt", None, "rename")
        .await
        .unwrap();
    client
        .file_delete("config/b.txt", None, "delete")
        .await
        .unwrap();
    assert_eq!(
        client.trash_list(None).await.unwrap().items[0].trashed_at_ms,
        5
    );
    client.trash_restore("trash-1", "restore").await.unwrap();
    agent
        .state
        .files
        .content
        .lock()
        .unwrap()
        .insert("large.log".into(), vec![b'a'; CHUNK_BYTES + 1]);
    let preview = client.file_read_text("large.log").await.unwrap();
    assert!(preview.truncated);
    assert!(preview.sha256.is_none());
    assert_eq!(preview.text.len(), CHUNK_BYTES);
    agent
        .state
        .files
        .content
        .lock()
        .unwrap()
        .insert("binary.bin".into(), vec![0, 255]);
    let binary = client.file_read_text("binary.bin").await.unwrap();
    assert!(binary.binary && binary.text.is_empty());
    assert!(
        client
            .log_tail("logs/old.log.gz", 100, true)
            .await
            .unwrap()
            .text
            .len()
            > CHUNK_BYTES
    );
    assert!(client
        .log_lines("logs/old.log.gz", Some("0"), 100, "forward", true)
        .await
        .unwrap()
        .next_byte
        .is_none());
    let properties = client.properties_get().await.unwrap();
    assert_eq!(properties.values["custom_key"], "[redacted]");
    assert_eq!(properties.values["online-mode"], true);
    assert_eq!(properties.values["max-players"], 20);
    let changes: BTreeMap<String, Value> =
        serde_json::from_value(json!({"online-mode":false,"max-players":24,"motd":"New"})).unwrap();
    let prepared = client
        .properties_update(changes.clone(), &properties.sha256, None, "props")
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(&prepared).unwrap()["confirmationToken"],
        "properties-confirm"
    );
    let PropertiesUpdateResult::AwaitingConfirmation {
        confirmation_token, ..
    } = prepared
    else {
        panic!("expected confirmation")
    };
    assert_eq!(
        client
            .properties_update(
                changes.clone(),
                &properties.sha256,
                Some("expired"),
                "props"
            )
            .await
            .unwrap_err()
            .code,
        ErrorCode::ConfirmationExpired
    );
    let applied = client
        .properties_update(
            changes,
            &properties.sha256,
            Some(&confirmation_token),
            "props",
        )
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(applied).unwrap(),
        json!({"kind":"applied","sha256":"cd".repeat(32),"restartNeeded":true})
    );
}

#[tokio::test]
async fn uploads_snapshot_chunk_resume_abort_and_window_binding() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    let client = agent.paired().await;
    let transfers = FileTransfers::default();
    let data: Vec<u8> = (0..2 * CHUNK_BYTES + 101)
        .map(|i| (i % 251) as u8)
        .collect();
    let source = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(source.path(), &data).unwrap();
    let candidate = transfers
        .pick(
            "window",
            std::fs::File::open(source.path()).unwrap(),
            "chosen.bin".into(),
        )
        .await
        .unwrap();
    let ipc = serde_json::to_value(&candidate).unwrap();
    assert_eq!(ipc.as_object().unwrap().len(), 3);
    assert!(!ipc
        .to_string()
        .contains(&source.path().to_string_lossy().to_string()));
    std::fs::write(source.path(), "changed after pick").unwrap();
    assert_eq!(
        transfers
            .begin(
                &client,
                "other",
                "conn",
                &candidate.local_id,
                "config/upload.bin",
                None,
                "upload"
            )
            .await
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
    agent.state.files.lost_begin.store(true, Ordering::SeqCst);
    assert_eq!(
        transfers
            .begin(
                &client,
                "window",
                "conn",
                &candidate.local_id,
                "config/upload.bin",
                None,
                "upload"
            )
            .await
            .unwrap_err()
            .code,
        ErrorCode::OutcomeUnknown
    );
    let start = transfers
        .begin(
            &client,
            "window",
            "conn",
            &candidate.local_id,
            "config/upload.bin",
            None,
            "upload",
        )
        .await
        .unwrap();
    assert_eq!(start.total_size, data.len().to_string());
    assert_eq!(
        transfers
            .begin(
                &client,
                "window",
                "conn",
                &candidate.local_id,
                "config/changed.bin",
                None,
                "upload"
            )
            .await
            .unwrap_err()
            .code,
        ErrorCode::Conflict
    );
    assert_eq!(
        transfers
            .chunk(&client, "window", "other-conn", &start.upload_id)
            .await
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
    agent.state.files.lost_chunk.store(true, Ordering::SeqCst);
    assert_eq!(
        transfers
            .chunk(&client, "window", "conn", &start.upload_id)
            .await
            .unwrap_err()
            .code,
        ErrorCode::OutcomeUnknown
    );
    let first = transfers
        .chunk(&client, "window", "conn", &start.upload_id)
        .await
        .unwrap();
    assert_eq!(first.offset, CHUNK_BYTES.to_string());
    let chunks = agent.state.files.chunks.lock().unwrap().clone();
    assert_eq!(chunks[0], chunks[1]);
    for _ in 0..2 {
        transfers
            .chunk(&client, "window", "conn", &start.upload_id)
            .await
            .unwrap();
    }
    let change = transfers
        .finish(&client, "window", "conn", &start.upload_id)
        .await
        .unwrap();
    assert_eq!(change.sha256, leaf_fingerprint(&data));
    assert_eq!(*agent.state.files.upload.lock().unwrap(), data);
    let second = transfers
        .begin(
            &client,
            "window",
            "conn",
            &candidate.local_id,
            "config/abort.bin",
            None,
            "upload-abort",
        )
        .await
        .unwrap();
    transfers
        .abort(&client, "window", "conn", &second.upload_id)
        .await
        .unwrap();
    assert_eq!(agent.state.files.aborts.load(Ordering::SeqCst), 1);
    let oversized = tempfile::NamedTempFile::new().unwrap();
    oversized
        .as_file()
        .set_len(16 * CHUNK_BYTES as u64 + 1)
        .unwrap();
    assert_eq!(
        transfers
            .pick("window", oversized.reopen().unwrap(), "large".into())
            .await
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
}

#[tokio::test]
async fn a_slow_bulk_transfer_preserves_control_and_other_server_progress() {
    let _owner = TEST_OWNER.lock().await;
    let first = Agent::start().await;
    let second = Agent::start().await;
    let first_client = first.paired().await;
    let second_client = second.paired().await;
    let transfers = Arc::new(FileTransfers::default());
    let source = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(source.path(), vec![b'x'; 65536]).unwrap();
    let candidate = transfers
        .pick("window", source.reopen().unwrap(), "selected.bin".into())
        .await
        .unwrap();
    let a = transfers
        .begin(
            &first_client,
            "window",
            "first",
            &candidate.local_id,
            "config/a.bin",
            None,
            "first",
        )
        .await
        .unwrap();
    let b = transfers
        .begin(
            &second_client,
            "window",
            "second",
            &candidate.local_id,
            "config/b.bin",
            None,
            "second",
        )
        .await
        .unwrap();
    // The same wire upload ID on distinct servers must remain independently addressable.
    assert_eq!(a.upload_id, b.upload_id);
    first.state.files.slow_chunk.store(true, Ordering::SeqCst);
    let task = {
        let transfers = transfers.clone();
        let client = first_client.clone();
        tokio::spawn(async move {
            transfers
                .chunk(&client, "window", "first", &a.upload_id)
                .await
        })
    };
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        loop {
            if !first.state.files.chunks.lock().unwrap().is_empty() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let status = tokio::time::timeout(std::time::Duration::from_secs(1), first_client.status(true))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(status.state, "stopped");
    let progress = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        transfers.chunk(&second_client, "window", "second", &b.upload_id),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(progress.offset, "65536");
    task.await.unwrap().unwrap();
}

#[tokio::test]
async fn downloads_resume_atomic_publication_gzip_and_failure_cleanup() {
    let _owner = TEST_OWNER.lock().await;
    let agent = Agent::start().await;
    let client = agent.paired().await;
    let data = vec![b'x'; 17 * CHUNK_BYTES + 123];
    agent
        .state
        .files
        .content
        .lock()
        .unwrap()
        .insert("logs/big.log.gz".into(), data.clone());
    let dir = tempfile::tempdir().unwrap();
    let destination = dir.path().join("saved.log");
    std::fs::write(&destination, b"old destination").unwrap();
    agent.state.files.failures.store(1, Ordering::SeqCst);
    let result = client
        .file_download_with_progress("logs/big.log.gz", true, &destination, |_, _| {
            assert_eq!(std::fs::read(&destination).unwrap(), b"old destination");
        })
        .await
        .unwrap();
    assert_eq!(result, data.len().to_string());
    assert_eq!(std::fs::read(&destination).unwrap(), data);
    assert_eq!(agent.state.files.resumes.load(Ordering::SeqCst), 1);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    agent
        .state
        .files
        .invalid_download_etag
        .store(true, Ordering::SeqCst);
    assert_eq!(
        client
            .file_download("logs/big.log.gz", true, &destination)
            .await
            .unwrap_err()
            .code,
        ErrorCode::Unsupported
    );
    agent
        .state
        .files
        .invalid_download_etag
        .store(false, Ordering::SeqCst);
    agent.state.files.failures.store(1, Ordering::SeqCst);
    agent
        .state
        .files
        .wrong_resume_etag
        .store(true, Ordering::SeqCst);
    assert_eq!(
        client
            .file_download("logs/big.log.gz", true, &destination)
            .await
            .unwrap_err()
            .code,
        ErrorCode::Unsupported
    );
    agent
        .state
        .files
        .wrong_resume_etag
        .store(false, Ordering::SeqCst);
    assert_eq!(std::fs::read(&destination).unwrap(), data);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    agent.state.files.failures.store(3, Ordering::SeqCst);
    assert!(client
        .file_download("logs/big.log.gz", true, &destination)
        .await
        .is_err());
    assert_eq!(std::fs::read(&destination).unwrap(), data);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    agent.state.files.failures.store(1, Ordering::SeqCst);
    agent
        .state
        .files
        .force_restart
        .store(true, Ordering::SeqCst);
    client
        .file_download("logs/big.log.gz", true, &destination)
        .await
        .unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), data);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}
