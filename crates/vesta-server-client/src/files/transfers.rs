use super::*;
use std::{
    collections::HashMap,
    path::Path,
    sync::Arc,
    time::{Duration, Instant},
};
use tempfile::{NamedTempFile, TempPath};
use tokio::{
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    sync::{Mutex, OwnedSemaphorePermit, Semaphore},
};
const STAGING_BYTES: usize = 64 * 1024 * 1024;
const STAGING_TTL: Duration = Duration::from_secs(3600);

struct Candidate {
    stage: TempPath,
    name: String,
    size: u64,
    hash: String,
    owner: String,
    created: Instant,
    _reservation: OwnedSemaphorePermit,
}
struct Upload {
    owner: String,
    connection: String,
    binding: String,
    candidate: Option<Arc<Candidate>>,
    size: u64,
    hash: String,
    finished: Option<FileChange>,
    id: Option<String>,
    offset: u64,
    intent: String,
    created: Instant,
    aborted: bool,
}
pub struct FileTransfers {
    candidates: Mutex<HashMap<String, Arc<Candidate>>>,
    uploads: Mutex<HashMap<String, Arc<Mutex<Upload>>>>,
    by_id: Mutex<HashMap<String, Arc<Mutex<Upload>>>>,
    staging: Arc<Semaphore>,
}
impl Default for FileTransfers {
    fn default() -> Self {
        Self {
            candidates: Default::default(),
            uploads: Default::default(),
            by_id: Default::default(),
            staging: Arc::new(Semaphore::new(STAGING_BYTES)),
        }
    }
}
impl FileTransfers {
    /// Idle cleanup must not require another picker action. Busy transfers retain
    /// their ownership until their bounded request finishes; the next sweep reaps them.
    pub async fn prune_expired(&self) {
        self.uploads.lock().await.retain(|_, state| {
            state
                .try_lock()
                .map_or(true, |s| s.created.elapsed() < STAGING_TTL)
        });
        self.by_id.lock().await.retain(|_, state| {
            state
                .try_lock()
                .map_or(true, |s| s.created.elapsed() < STAGING_TTL)
        });
        self.candidates
            .lock()
            .await
            .retain(|_, candidate| candidate.created.elapsed() < STAGING_TTL);
    }
    async fn release_candidate(&self, upload: &mut Upload) {
        if let Some(candidate) = upload.candidate.take() {
            self.candidates
                .lock()
                .await
                .retain(|_, staged| !Arc::ptr_eq(staged, &candidate));
        }
    }
    /// Called only after a native picker. Snapshot to an owner-only temporary
    /// file so later local edits cannot change bytes under an upload's hash/key.
    /// The UI receives only name/size and a random, window-bound handle.
    pub async fn pick(
        &self,
        owner: &str,
        file: std::fs::File,
        name: String,
    ) -> Result<UploadCandidate> {
        let meta = file.metadata().map_err(io_error)?;
        if !meta.is_file() || meta.len() > MAX_WRITE_BYTES {
            return Err(invalid());
        }
        self.prune_expired().await;
        let mut reservation = self
            .staging
            .clone()
            .try_acquire_many_owned(meta.len() as u32)
            .map_err(|_| Error::new(ErrorCode::ServerBusy).local_pressure())?;
        let mut source = tokio::fs::File::from_std(file);
        let (file, stage) = NamedTempFile::new().map_err(io_error)?.into_parts();
        let mut output = tokio::fs::File::from_std(file);
        let mut hash = Sha256::new();
        let mut size = 0u64;
        let mut buffer = vec![0; 64 * 1024];
        loop {
            let count = source.read(&mut buffer).await.map_err(io_error)?;
            if count == 0 {
                break;
            }
            size += count as u64;
            if size > MAX_WRITE_BYTES {
                return Err(invalid());
            }
            if size > reservation.num_permits() as u64 {
                let extra = self
                    .staging
                    .clone()
                    .try_acquire_many_owned((size - reservation.num_permits() as u64) as u32)
                    .map_err(|_| Error::new(ErrorCode::ServerBusy).local_pressure())?;
                reservation.merge(extra);
            }
            output.write_all(&buffer[..count]).await.map_err(io_error)?;
            hash.update(&buffer[..count]);
        }
        output.flush().await.map_err(io_error)?;
        drop(output);
        let candidate = Arc::new(Candidate {
            stage,
            name,
            size,
            hash: format!("{:x}", hash.finalize()),
            owner: owner.into(),
            created: Instant::now(),
            _reservation: reservation,
        });
        let id = uuid::Uuid::new_v4().to_string();
        let result = UploadCandidate {
            local_id: id.clone(),
            name: candidate.name.clone(),
            size: size.to_string(),
        };
        let mut candidates = self.candidates.lock().await;
        candidates.retain(|_, v| v.created.elapsed() < Duration::from_secs(3600));
        if candidates.len() >= 64 {
            return Err(Error::new(ErrorCode::ServerBusy));
        }
        candidates.insert(id, candidate);
        Ok(result)
    }
    #[allow(clippy::too_many_arguments)]
    pub async fn begin(
        &self,
        client: &Client,
        owner: &str,
        connection: &str,
        local: &str,
        path: &str,
        expected: Option<&str>,
        intent: &str,
    ) -> Result<UploadProgress> {
        validate_path(path, false)?;
        intent_key(intent)?;
        if let Some(hash) = expected {
            validate_sha256(hash)?;
        }
        let binding = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&(local, path, expected)).map_err(|_| invalid())?)
        );
        let key = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&(owner, connection, intent)).map_err(|_| invalid())?
            )
        );
        let state = {
            let mut uploads = self.uploads.lock().await;
            uploads.retain(|_, v| {
                v.try_lock()
                    .map_or(true, |v| v.created.elapsed() < Duration::from_secs(3600))
            });
            if uploads.len() >= 64 {
                // Terminal receipts carry no staged data. Their count is bounded;
                // active/uncertain uploads are never discarded to make room.
                uploads.retain(|_, state| {
                    state
                        .try_lock()
                        .map_or(true, |s| !s.aborted && s.finished.is_none())
                });
                self.by_id.lock().await.retain(|_, state| {
                    state
                        .try_lock()
                        .map_or(true, |s| !s.aborted && s.finished.is_none())
                });
            }
            if let Some(upload) = uploads.get(&key) {
                upload.clone()
            } else {
                if uploads.len() >= 64 {
                    return Err(Error::new(ErrorCode::ServerBusy));
                }
                let candidate = self
                    .candidates
                    .lock()
                    .await
                    .get(local)
                    .filter(|v| v.owner == owner && v.created.elapsed() < Duration::from_secs(3600))
                    .cloned()
                    .ok_or_else(invalid)?;
                let upload = Arc::new(Mutex::new(Upload {
                    owner: owner.into(),
                    connection: connection.into(),
                    binding: binding.clone(),
                    size: candidate.size,
                    hash: candidate.hash.clone(),
                    candidate: Some(candidate),
                    finished: None,
                    id: None,
                    offset: 0,
                    intent: intent.into(),
                    created: Instant::now(),
                    aborted: false,
                }));
                uploads.insert(key, upload.clone());
                upload
            }
        };
        let mut upload = state.lock().await;
        if upload.binding != binding || upload.aborted {
            return Err(Error::new(ErrorCode::Conflict));
        }
        if upload.id.is_none() {
            let mut input = request(
                Method::POST,
                route("files/uploads", &[]),
                Some(intent),
                true,
            )?;
            conditional(&mut input, expected)?;
            json_body(
                &mut input,
                json!({"path":path,"total_size":upload.size.to_string(),"sha256":upload.hash}),
            )?;
            let value = client.file_request(input).await?.json(CHUNK_BYTES).await?;
            let id = field(&value, "upload_id")?;
            opaque(&id)?;
            let offset = decimal(&field(&value, "offset")?)?;
            if offset > upload.size {
                return Err(unsupported());
            }
            upload.id = Some(id);
            upload.offset = offset;
        }
        let lookup = upload_key(
            owner,
            connection,
            upload.id.as_deref().ok_or_else(unsupported)?,
        )?;
        let mut by_id = self.by_id.lock().await;
        by_id.retain(|_, state| {
            state
                .try_lock()
                .map_or(true, |v| v.created.elapsed() < Duration::from_secs(3600))
        });
        by_id.insert(lookup, state.clone());
        progress(&upload)
    }
    async fn upload(&self, owner: &str, connection: &str, id: &str) -> Result<Arc<Mutex<Upload>>> {
        opaque(id)?;
        // Look up without locking unrelated transfers: a slow server must not
        // block another server's chunk/abort before bulk admission is reached.
        let state = self
            .by_id
            .lock()
            .await
            .get(&upload_key(owner, connection, id)?)
            .cloned()
            .ok_or_else(|| Error::new(ErrorCode::NotFound))?;
        let upload = state.lock().await;
        if upload.owner != owner
            || upload.connection != connection
            || upload.created.elapsed() >= Duration::from_secs(3600)
        {
            return Err(Error::new(ErrorCode::NotFound));
        }
        drop(upload);
        Ok(state)
    }
    pub async fn chunk(
        &self,
        client: &Client,
        owner: &str,
        connection: &str,
        id: &str,
    ) -> Result<UploadProgress> {
        let state = self.upload(owner, connection, id).await?;
        let mut upload = state.lock().await;
        if upload.aborted {
            return Err(Error::new(ErrorCode::Conflict));
        }
        if upload.offset == upload.size {
            return progress(&upload);
        }
        let mut file = tokio::fs::File::open(&upload.candidate.as_ref().ok_or_else(invalid)?.stage)
            .await
            .map_err(io_error)?;
        file.seek(std::io::SeekFrom::Start(upload.offset))
            .await
            .map_err(io_error)?;
        let count = (upload.size - upload.offset).min(CHUNK_BYTES as u64) as usize;
        let mut bytes = vec![0; count];
        file.read_exact(&mut bytes).await.map_err(io_error)?;
        let offset = upload.offset.to_string();
        let key = chunk_intent(&upload.intent, upload.offset);
        let mut input = request(
            Method::PUT,
            route(&format!("files/uploads/{id}"), &[("offset", &offset)]),
            Some(&key),
            true,
        )?;
        input.body = bytes;
        input.headers.insert(
            "content-type",
            HeaderValue::from_static("application/octet-stream"),
        );
        let value = client.file_request(input).await?.json(CHUNK_BYTES).await?;
        let actual = decimal(&field(&value, "offset")?)?;
        // A replay can report more than this chunk: the agent owns staged length.
        if actual < upload.offset + count as u64 || actual > upload.size {
            return Err(unsupported());
        }
        upload.offset = actual;
        progress(&upload)
    }
    pub async fn finish(
        &self,
        client: &Client,
        owner: &str,
        connection: &str,
        id: &str,
    ) -> Result<FileChange> {
        let state = self.upload(owner, connection, id).await?;
        let mut upload = state.lock().await;
        if let Some(change) = &upload.finished {
            return Ok(change.clone());
        }
        if upload.aborted || upload.offset != upload.size {
            return Err(invalid());
        }
        let mut input = request(
            Method::POST,
            route(&format!("files/uploads/{id}/finish"), &[]),
            Some(&upload.intent),
            true,
        )?;
        json_body(&mut input, json!({}))?;
        let change: FileChange =
            decode(client.file_request(input).await?.json(CHUNK_BYTES).await?)?;
        if change.sha256 != upload.hash || decimal(&change.size)? != upload.size {
            return Err(unsupported());
        }
        upload.finished = Some(change.clone());
        self.release_candidate(&mut upload).await;
        Ok(change)
    }
    pub async fn abort(
        &self,
        client: &Client,
        owner: &str,
        connection: &str,
        id: &str,
    ) -> Result<()> {
        let state = self.upload(owner, connection, id).await?;
        let mut upload = state.lock().await;
        if upload.aborted {
            return Ok(());
        }
        if upload.finished.is_some() {
            return Err(Error::new(ErrorCode::Conflict));
        }
        let input = request(
            Method::DELETE,
            route(&format!("files/uploads/{id}"), &[]),
            Some(&upload.intent),
            true,
        )?;
        client.file_request(input).await?.json(CHUNK_BYTES).await?;
        upload.aborted = true;
        self.release_candidate(&mut upload).await;
        Ok(())
    }
}
fn progress(upload: &Upload) -> Result<UploadProgress> {
    Ok(UploadProgress {
        upload_id: upload.id.clone().ok_or_else(unsupported)?,
        offset: upload.offset.to_string(),
        total_size: upload.size.to_string(),
    })
}
fn upload_key(owner: &str, connection: &str, id: &str) -> Result<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(owner, connection, id)).map_err(|_| invalid())?)
    ))
}
fn chunk_intent(intent: &str, offset: u64) -> String {
    format!("{:x}", Sha256::digest(format!("{intent}:chunk:{offset}")))
}

impl Client {
    /// Destination originates exclusively from a native save dialog. A same-
    /// directory temporary file makes publication atomic and RAII removes it on
    /// any failure/cancellation. No fixed total-size limit: disk is the budget.
    pub async fn file_download(
        &self,
        path: &str,
        decompress: bool,
        destination: &Path,
    ) -> Result<String> {
        self.file_download_with_progress(path, decompress, destination, |_, _| {})
            .await
    }
    pub async fn file_download_with_progress(
        &self,
        path: &str,
        decompress: bool,
        destination: &Path,
        progress: impl Fn(u64, u64) + Send + Sync,
    ) -> Result<String> {
        self.download_inner(
            path,
            decompress,
            destination,
            &DownloadCancellation::default(),
            progress,
        )
        .await?
        .ok_or_else(|| Error::new(ErrorCode::Internal))
    }
    /// `None` means cancellation won before publication. Once publication owns
    /// the destination, cancellation is refused and the actual result is awaited.
    pub async fn file_download_cancellable(
        &self,
        path: &str,
        decompress: bool,
        destination: &Path,
        cancellation: &DownloadCancellation,
        progress: impl Fn(u64, u64) + Send + Sync,
    ) -> Result<Option<String>> {
        tokio::select! {
            biased;
            () = cancellation.cancelled() => Ok(None),
            result = self.download_inner(path, decompress, destination, cancellation, progress) => result,
        }
    }
    async fn download_inner(
        &self,
        path: &str,
        decompress: bool,
        destination: &Path,
        cancellation: &DownloadCancellation,
        progress: impl Fn(u64, u64) + Send + Sync,
    ) -> Result<Option<String>> {
        validate_path(path, false)?;
        let parent = destination
            .parent()
            .filter(|v| !v.as_os_str().is_empty())
            .ok_or_else(invalid)?;
        let stage = NamedTempFile::new_in(parent).map_err(io_error)?;
        let (file, stage) = stage.into_parts();
        let mut output = tokio::fs::File::from_std(file);
        let mut offset = 0u64;
        let mut total = None;
        let mut etag = None::<String>;
        let mut attempts = 0;
        loop {
            let mut pairs = vec![("path", path)];
            if decompress {
                pairs.push(("decompress", "1"));
            }
            let mut input = request(Method::GET, route("files/download", &pairs), None, true)?;
            if offset > 0 {
                input.headers.insert(
                    "range",
                    HeaderValue::from_str(&format!("bytes={offset}-")).map_err(|_| invalid())?,
                );
                input.headers.insert(
                    "if-range",
                    HeaderValue::from_str(etag.as_deref().ok_or_else(unsupported)?)
                        .map_err(|_| unsupported())?,
                );
            }
            let mut response = self.file_request(input).await?;
            binary_version(&response)?;
            let new_tag = response.header("etag")?.to_owned();
            if !strong_etag(&new_tag) {
                return Err(unsupported());
            }
            let size = decimal(response.header("x-vesta-file-size")?)?;
            if response.raw.status() == reqwest::StatusCode::PARTIAL_CONTENT {
                if offset == 0
                    || etag.as_deref() != Some(new_tag.as_str())
                    || total != Some(size)
                    || response.header("content-range")?
                        != format!(
                            "bytes {offset}-{}/{size}",
                            size.checked_sub(1).ok_or_else(unsupported)?
                        )
                {
                    return Err(unsupported());
                }
            } else if response.raw.status() == reqwest::StatusCode::OK {
                offset = 0;
                output.set_len(0).await.map_err(io_error)?;
                output
                    .seek(std::io::SeekFrom::Start(0))
                    .await
                    .map_err(io_error)?;
            } else {
                return Err(unsupported());
            }
            if response.raw.content_length() != Some(size - offset) {
                return Err(unsupported());
            }
            // Preflight and per-write checks are observations, not reservations.
            if fs2::available_space(parent).map_err(io_error)? < size - offset {
                return Err(Error::new(ErrorCode::ServerBusy));
            }
            total = Some(size);
            etag = Some(new_tag);
            progress(offset, size);
            let mut reported = offset;
            let mut interrupted = None;
            loop {
                let bytes = match response.chunk().await {
                    Ok(Some(bytes)) => bytes,
                    Ok(None) => break,
                    Err(e) => {
                        interrupted = Some(e);
                        break;
                    }
                };
                if bytes.len() as u64 > size.saturating_sub(offset) {
                    return Err(unsupported());
                }
                if fs2::available_space(parent).map_err(io_error)? < bytes.len() as u64 {
                    return Err(Error::new(ErrorCode::ServerBusy));
                }
                output.write_all(&bytes).await.map_err(io_error)?;
                offset += bytes.len() as u64;
                if offset - reported >= 512 * 1024 || offset == size {
                    progress(offset, size);
                    reported = offset;
                }
            }
            drop(response); // release bulk admission before a resume attempt
            if let Some(error) = interrupted {
                if attempts < 2
                    && offset > 0
                    && offset < size
                    && matches!(
                        error.code,
                        ErrorCode::Timeout | ErrorCode::Unreachable | ErrorCode::OutcomeUnknown
                    )
                {
                    attempts += 1;
                    continue;
                }
                return Err(error);
            }
            if offset != size {
                return Err(Error::new(ErrorCode::OutcomeUnknown));
            }
            break;
        }
        output.sync_all().await.map_err(io_error)?;
        drop(output);
        if !cancellation.begin_commit() {
            return if cancellation.is_cancelled() {
                Ok(None)
            } else {
                Err(Error::new(ErrorCode::Conflict))
            };
        }
        let destination = destination.to_owned();
        tokio::task::spawn_blocking(move || {
            stage
                .persist(destination)
                .map_err(|_| Error::new(ErrorCode::Internal))
        })
        .await
        .map_err(|_| Error::new(ErrorCode::Internal))??;
        Ok(Some(offset.to_string()))
    }
}
fn strong_etag(tag: &str) -> bool {
    tag.len() >= 3
        && tag.len() <= 128
        && tag.starts_with('"')
        && tag.ends_with('"')
        && !tag[1..tag.len() - 1].contains(['"', '\r', '\n'])
}

#[cfg(test)]
mod staging_tests {
    use super::*;
    #[tokio::test]
    async fn abandoned_staging_is_byte_bounded_and_idle_sweeps_release_files() {
        let transfers = FileTransfers::default();
        let source = NamedTempFile::new().unwrap();
        source.as_file().set_len(MAX_WRITE_BYTES).unwrap();
        for index in 0..4 {
            transfers
                .pick("window", source.reopen().unwrap(), format!("{index}.bin"))
                .await
                .unwrap();
        }
        let error = transfers
            .pick("window", source.reopen().unwrap(), "excess.bin".into())
            .await
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::ServerBusy);
        assert!(error.local_pressure);
        assert_eq!(transfers.staging.available_permits(), 0);
        let paths: Vec<_> = {
            let mut candidates = transfers.candidates.lock().await;
            candidates
                .values_mut()
                .map(|candidate| {
                    let candidate = Arc::get_mut(candidate).unwrap();
                    candidate.created = Instant::now() - STAGING_TTL;
                    candidate.stage.to_path_buf()
                })
                .collect()
        };
        // No further picker or begin call is needed, matching the app's idle sweep.
        transfers.prune_expired().await;
        assert!(paths.iter().all(|path| !path.exists()));
        assert_eq!(transfers.staging.available_permits(), STAGING_BYTES);
        assert!(transfers.candidates.lock().await.is_empty());
    }

    #[tokio::test]
    async fn releasing_terminal_upload_keeps_only_receipt_metadata_and_shared_owners() {
        let transfers = FileTransfers::default();
        let source = NamedTempFile::new().unwrap();
        std::fs::write(source.path(), b"staged bytes").unwrap();
        let selected = transfers
            .pick("window", source.reopen().unwrap(), "file.bin".into())
            .await
            .unwrap();
        let candidate = transfers
            .candidates
            .lock()
            .await
            .get(&selected.local_id)
            .unwrap()
            .clone();
        let path = candidate.stage.to_path_buf();
        let mut upload = Upload {
            owner: "window".into(),
            connection: "server".into(),
            binding: "binding".into(),
            size: candidate.size,
            hash: candidate.hash.clone(),
            candidate: Some(candidate.clone()),
            finished: None,
            id: Some("upload".into()),
            offset: candidate.size,
            intent: "intent".into(),
            created: Instant::now(),
            aborted: true,
        };
        transfers.release_candidate(&mut upload).await;
        assert!(transfers.candidates.lock().await.is_empty());
        assert!(upload.candidate.is_none());
        assert!(
            path.exists(),
            "a different in-flight owner still needs these bytes"
        );
        drop(candidate);
        assert!(!path.exists());
        assert_eq!(transfers.staging.available_permits(), STAGING_BYTES);
        assert_eq!(progress(&upload).unwrap().total_size, "12");
    }
}
