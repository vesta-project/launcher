use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const ARTIFACTS_FILE: &str = "cache/artifacts.json";
const INDEX_FILE: &str = "cache/install_index.json";
const LABEL_INDEX_FILE: &str = "cache/label_index.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactRecord {
    pub sha256: String,
    pub size: u64,
    #[serde(default)]
    pub signature: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub refs: u32,
    #[serde(default)]
    pub last_used: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InstallIndexRecord {
    pub version_id: String,
    pub loader: Option<String>,
    #[serde(default)]
    pub components: HashMap<String, String>,
    #[serde(default)]
    pub libraries: HashSet<String>,
}

#[derive(Debug, Clone)]
pub struct InstallArtifactRef {
    pub label: String,
    pub sha256: String,
}

impl InstallArtifactRef {
    pub fn new(label: impl Into<String>, sha256: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            sha256: sha256.into(),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ArtifactUsageSummary {
    pub total_bytes: u64,
    pub prunable_bytes: u64,
    pub pinned_bytes: u64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ArtifactPruneSummary {
    pub removed_artifacts: usize,
    pub removed_bytes: u64,
    pub total_bytes: u64,
    pub prunable_bytes: u64,
    pub pinned_bytes: u64,
}

#[derive(Debug, Clone)]
struct UntrackedBlob {
    sha256: String,
    path: PathBuf,
    size: u64,
    last_used: u64,
}

#[derive(Debug, Clone, Copy, Default)]
struct ArtifactRemovalSummary {
    removed_artifacts: usize,
    removed_bytes: u64,
}

#[derive(Debug)]
pub struct ArtifactCache {
    root: PathBuf,
    artifacts: HashMap<String, ArtifactRecord>,
    install_index: HashMap<String, InstallIndexRecord>,
    label_index: HashMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct ArtifactRestoreCandidate {
    pub sha256: String,
    pub blob_path: PathBuf,
}

impl ArtifactCache {
    pub fn load(root: &Path) -> Result<Self> {
        let artifacts_path = root.join(ARTIFACTS_FILE);
        let index_path = root.join(INDEX_FILE);

        let artifacts = if artifacts_path.exists() {
            let data = fs::read_to_string(&artifacts_path)
                .with_context(|| format!("Read artifacts file {:?}", artifacts_path))?;
            serde_json::from_str(&data)
                .with_context(|| format!("Parse artifacts file {:?}", artifacts_path))?
        } else {
            HashMap::new()
        };

        let install_index = if index_path.exists() {
            let data = fs::read_to_string(&index_path)
                .with_context(|| format!("Read install index file {:?}", index_path))?;
            serde_json::from_str(&data)
                .with_context(|| format!("Parse install index file {:?}", index_path))?
        } else {
            HashMap::new()
        };

        let mut cache = Self {
            root: root.to_path_buf(),
            artifacts,
            install_index,
            label_index: HashMap::new(),
        };
        cache.reconcile_with_disk();
        Ok(cache)
    }

    pub fn load_with_labels(root: &Path) -> Result<Self> {
        let mut cache = Self::load(root)?;
        let label_path = root.join(LABEL_INDEX_FILE);
        if label_path.exists() {
            let data = fs::read_to_string(&label_path)
                .with_context(|| format!("Read label index {:?}", label_path))?;
            cache.label_index = serde_json::from_str(&data)
                .with_context(|| format!("Parse label index {:?}", label_path))?;
        }
        cache
            .label_index
            .retain(|_, sha| cache.artifacts.contains_key(sha));
        Ok(cache)
    }

    pub fn save(&self) -> Result<()> {
        let artifacts_path = self.root.join(ARTIFACTS_FILE);
        if let Some(parent) = artifacts_path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("Create cache directory {:?}", parent))?;
        }
        fs::write(&artifacts_path, serde_json::to_vec_pretty(&self.artifacts)?)
            .with_context(|| format!("Write artifacts file {:?}", artifacts_path))?;

        let index_path = self.root.join(INDEX_FILE);
        if let Some(parent) = index_path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("Create cache directory {:?}", parent))?;
        }
        fs::write(&index_path, serde_json::to_vec_pretty(&self.install_index)?)
            .with_context(|| format!("Write install index file {:?}", index_path))?;

        let label_path = self.root.join(LABEL_INDEX_FILE);
        fs::write(&label_path, serde_json::to_vec_pretty(&self.label_index)?)
            .with_context(|| format!("Write label index {:?}", label_path))?;

        Ok(())
    }

    pub fn has_artifact(&self, sha256: &str) -> bool {
        self.artifacts.contains_key(sha256)
    }

    pub fn get_artifact_path(&self, sha256: &str) -> PathBuf {
        artifact_path(&self.root, sha256)
    }

    pub fn add_artifact(
        &mut self,
        sha256: String,
        size: u64,
        signature: Option<String>,
        source_url: Option<String>,
    ) {
        let record = self
            .artifacts
            .entry(sha256.clone())
            .or_insert(ArtifactRecord {
                sha256,
                size,
                signature: signature.clone(),
                source_url: source_url.clone(),
                refs: 0,
                last_used: timestamp(),
            });
        record.size = size;
        if signature.is_some() {
            record.signature = signature;
        }
        if source_url.is_some() {
            record.source_url = source_url;
        }
        record.last_used = timestamp();
    }

    pub fn release_artifact(&mut self, sha256: &str) {
        if let Some(record) = self.artifacts.get_mut(sha256) {
            record.refs = record.refs.saturating_sub(1);
        }
    }

    pub fn add_ref(&mut self, sha256: &str) {
        if let Some(record) = self.artifacts.get_mut(sha256) {
            record.refs = record.refs.saturating_add(1);
            record.last_used = timestamp();
        }
    }

    pub fn ingest_file(
        &mut self,
        path: &Path,
        signature: Option<String>,
        source_url: Option<String>,
    ) -> Result<String> {
        let (sha256, size) = hash_file(path)
            .with_context(|| format!("Hash artifact for cache ingestion: {:?}", path))?;
        let blob_path = self.get_artifact_path(&sha256);
        if !blob_path.exists() {
            if let Some(parent) = blob_path.parent() {
                fs::create_dir_all(parent)
                    .with_context(|| format!("Create cache blob dir {:?}", parent))?;
            }
            fs::copy(path, &blob_path).with_context(|| {
                format!("Copy artifact into cache {:?} -> {:?}", path, blob_path)
            })?;
        }
        self.add_artifact(sha256.clone(), size, signature, source_url);
        Ok(sha256)
    }

    pub fn record_install(
        &mut self,
        version_id: &str,
        loader: Option<String>,
        artifacts: &[InstallArtifactRef],
    ) {
        {
            let entry = self
                .install_index
                .entry(version_id.to_string())
                .or_insert_with(|| InstallIndexRecord {
                    version_id: version_id.to_string(),
                    loader: loader.clone(),
                    components: HashMap::new(),
                    libraries: HashSet::new(),
                });
            entry.loader = loader;
            for artifact in artifacts {
                entry
                    .components
                    .insert(artifact.label.clone(), artifact.sha256.clone());
                entry.libraries.insert(artifact.sha256.clone());
            }
        }
        for artifact in artifacts {
            self.add_ref(&artifact.sha256);
        }
        self.rebuild_refs_from_install_index();
    }

    pub fn remove_install(&mut self, version_id: &str) {
        if self.install_index.remove(version_id).is_some() {
            self.rebuild_refs_from_install_index();
        }
    }

    pub fn prune_unused(&mut self) {
        let reachable = self.reachable_artifacts();
        let removable = self
            .artifacts
            .iter()
            .filter(|(sha, rec)| rec.refs == 0 && !reachable.contains(*sha))
            .map(|(sha, _)| sha.clone())
            .collect::<Vec<_>>();
        self.remove_artifacts(&removable);
    }

    pub fn usage_summary(&self) -> ArtifactUsageSummary {
        let reachable = self.reachable_artifacts();
        let mut summary = ArtifactUsageSummary {
            total_bytes: 0,
            prunable_bytes: 0,
            pinned_bytes: 0,
        };

        for (sha, record) in &self.artifacts {
            summary.total_bytes = summary.total_bytes.saturating_add(record.size);
            if record.refs == 0 && !reachable.contains(sha) {
                summary.prunable_bytes = summary.prunable_bytes.saturating_add(record.size);
            } else {
                summary.pinned_bytes = summary.pinned_bytes.saturating_add(record.size);
            }
        }

        for blob in self.untracked_blobs() {
            summary.total_bytes = summary.total_bytes.saturating_add(blob.size);
            summary.prunable_bytes = summary.prunable_bytes.saturating_add(blob.size);
        }

        summary
    }

    pub fn prune_to_limit(&mut self, max_bytes: u64) -> ArtifactPruneSummary {
        self.reconcile_with_disk();
        let reachable = self.reachable_artifacts();
        let usage = self.usage_summary();
        let mut summary = ArtifactPruneSummary {
            total_bytes: usage.total_bytes,
            prunable_bytes: usage.prunable_bytes,
            pinned_bytes: usage.pinned_bytes,
            ..ArtifactPruneSummary::default()
        };

        if usage.total_bytes <= max_bytes {
            return summary;
        }

        let mut candidates = self
            .artifacts
            .values()
            .filter(|record| record.refs == 0 && !reachable.contains(&record.sha256))
            .cloned()
            .collect::<Vec<_>>();
        candidates.sort_by_key(|record| (record.last_used, record.sha256.clone()));

        let mut current_total = usage.total_bytes;
        let mut to_remove = Vec::new();

        for record in candidates {
            if current_total <= max_bytes {
                break;
            }

            current_total = current_total.saturating_sub(record.size);
            summary.removed_artifacts += 1;
            summary.removed_bytes = summary.removed_bytes.saturating_add(record.size);
            to_remove.push(record.sha256);
        }

        let indexed_removal = self.remove_artifacts(&to_remove);
        summary.removed_artifacts = indexed_removal.removed_artifacts;
        summary.removed_bytes = indexed_removal.removed_bytes;
        current_total = self.usage_summary().total_bytes;

        if current_total > max_bytes {
            let mut untracked = self.untracked_blobs();
            untracked.sort_by_key(|blob| (blob.last_used, blob.sha256.clone()));

            for blob in untracked {
                if current_total <= max_bytes {
                    break;
                }

                match fs::remove_file(&blob.path) {
                    Ok(()) => {
                        current_total = current_total.saturating_sub(blob.size);
                        summary.removed_artifacts += 1;
                        summary.removed_bytes = summary.removed_bytes.saturating_add(blob.size);
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        current_total = current_total.saturating_sub(blob.size);
                        summary.removed_artifacts += 1;
                        summary.removed_bytes = summary.removed_bytes.saturating_add(blob.size);
                    }
                    Err(error) => {
                        log::warn!(
                            "[artifact-cache] Failed to remove untracked blob {} at {:?}: {}",
                            blob.sha256,
                            blob.path,
                            error
                        );
                    }
                }
            }
        }

        let updated = self.usage_summary();
        summary.total_bytes = updated.total_bytes;
        summary.prunable_bytes = updated.prunable_bytes;
        summary.pinned_bytes = updated.pinned_bytes;
        summary
    }

    pub fn iter_artifacts(&self) -> impl Iterator<Item = &ArtifactRecord> {
        self.artifacts.values()
    }

    pub fn find_component(&self, label: &str) -> Option<String> {
        if let Some(sha) = self.label_index.get(label) {
            return Some(sha.clone());
        }
        self.install_index
            .values()
            .find_map(|record| record.components.get(label).cloned())
    }

    pub fn set_label(&mut self, label: impl Into<String>, sha256: impl Into<String>) {
        self.label_index.insert(label.into(), sha256.into());
    }

    pub fn restore_candidate(&self, label: &str) -> Option<ArtifactRestoreCandidate> {
        let sha256 = self.find_component(label)?;
        let blob_path = self.get_artifact_path(&sha256);
        blob_path.exists().then_some(ArtifactRestoreCandidate {
            sha256,
            blob_path,
        })
    }

    pub fn restore_artifact(&self, sha256: &str, destination: &Path) -> Result<bool> {
        let blob_path = self.get_artifact_path(sha256);
        Self::restore_blob_to_path(&blob_path, destination)
    }

    pub fn restore_blob_to_path(blob_path: &Path, destination: &Path) -> Result<bool> {
        if !blob_path.exists() {
            return Ok(false);
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("Create destination parent {:?}", parent))?;
        }
        if destination.exists() {
            fs::remove_file(destination)
                .with_context(|| format!("Remove existing destination {:?}", destination))?;
        }
        fs::copy(&blob_path, destination)
            .with_context(|| format!("Restore artifact {:?} -> {:?}", blob_path, destination))?;
        Ok(true)
    }

    fn reachable_artifacts(&self) -> HashSet<String> {
        self.install_index
            .values()
            .flat_map(|idx| idx.libraries.iter().cloned())
            .collect()
    }

    fn reconcile_with_disk(&mut self) {
        let missing = self
            .artifacts
            .keys()
            .filter(|sha| !self.get_artifact_path(sha).exists())
            .cloned()
            .collect::<Vec<_>>();
        self.remove_artifacts(&missing);
        self.remove_install_references(&missing.iter().cloned().collect::<HashSet<_>>());
        self.rebuild_refs_from_install_index();
    }

    fn remove_artifacts(&mut self, shas: &[String]) -> ArtifactRemovalSummary {
        if shas.is_empty() {
            return ArtifactRemovalSummary::default();
        }

        let removals = shas.iter().cloned().collect::<HashSet<_>>();
        let mut removed = HashSet::new();
        let mut summary = ArtifactRemovalSummary::default();

        for sha in &removals {
            let blob_path = self.get_artifact_path(sha);
            let size = self
                .artifacts
                .get(sha)
                .map(|record| record.size)
                .unwrap_or_else(|| file_size(&blob_path));

            match fs::remove_file(&blob_path) {
                Ok(()) => {
                    removed.insert(sha.clone());
                    summary.removed_artifacts += 1;
                    summary.removed_bytes = summary.removed_bytes.saturating_add(size);
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    removed.insert(sha.clone());
                }
                Err(error) => {
                    log::warn!(
                        "[artifact-cache] Failed to remove indexed blob {} at {:?}: {}",
                        sha,
                        blob_path,
                        error
                    );
                }
            }
        }

        self.artifacts.retain(|sha, _| !removed.contains(sha));
        self.label_index.retain(|_, sha| !removed.contains(sha));
        self.remove_install_references(&removed);
        self.rebuild_refs_from_install_index();
        summary
    }

    fn remove_install_references(&mut self, removals: &HashSet<String>) {
        if removals.is_empty() {
            return;
        }

        for record in self.install_index.values_mut() {
            record.libraries.retain(|sha| !removals.contains(sha));
            record.components.retain(|_, sha| !removals.contains(sha));
        }
    }

    fn rebuild_refs_from_install_index(&mut self) {
        for record in self.artifacts.values_mut() {
            record.refs = 0;
        }

        let mut refs = HashMap::<String, u32>::new();
        for sha in self.reachable_artifacts() {
            *refs.entry(sha).or_insert(0) += 1;
        }

        for (sha, count) in refs {
            if let Some(record) = self.artifacts.get_mut(&sha) {
                record.refs = count;
            }
        }
    }

    fn untracked_blobs(&self) -> Vec<UntrackedBlob> {
        let mut blobs = Vec::new();
        collect_untracked_blobs(
            &self.root.join("cache").join("blobs"),
            &self.artifacts,
            &mut blobs,
        );
        blobs
    }
}

fn artifact_path(root: &Path, sha256: &str) -> PathBuf {
    let prefix = sha256.get(..2).unwrap_or(sha256);
    root.join("cache").join("blobs").join(prefix).join(sha256)
}

fn file_size(path: &Path) -> u64 {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

fn file_lru_timestamp(path: &Path) -> u64 {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.accessed().or_else(|_| metadata.modified()).ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn is_valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.as_bytes().iter().all(|byte| byte.is_ascii_hexdigit())
}

fn collect_untracked_blobs(
    path: &Path,
    indexed: &HashMap<String, ArtifactRecord>,
    blobs: &mut Vec<UntrackedBlob>,
) {
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };

    for entry in entries.flatten() {
        let entry_path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };

        if metadata.is_dir() {
            collect_untracked_blobs(&entry_path, indexed, blobs);
            continue;
        }

        if !metadata.is_file() {
            continue;
        }

        let Some(file_name) = entry_path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        if !is_valid_sha256(file_name) || indexed.contains_key(file_name) {
            continue;
        }

        blobs.push(UntrackedBlob {
            sha256: file_name.to_string(),
            path: entry_path.clone(),
            size: metadata.len(),
            last_used: file_lru_timestamp(&entry_path),
        });
    }
}

fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn hash_file(path: &Path) -> Result<(String, u64)> {
    let file =
        fs::File::open(path).with_context(|| format!("Open file for hashing: {:?}", path))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];
    let mut total = 0u64;

    loop {
        let read = reader
            .read(&mut buffer)
            .with_context(|| format!("Read bytes while hashing: {:?}", path))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        total += read as u64;
    }

    Ok((format!("{:x}", hasher.finalize()), total))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::tempdir;

    fn ingest_test_artifact(
        cache: &mut ArtifactCache,
        root: &Path,
        name: &str,
        contents: &[u8],
    ) -> (String, u64) {
        let file_path = root.join(name);
        fs::write(&file_path, contents).unwrap();
        let sha = cache.ingest_file(&file_path, None, None).unwrap();
        (sha, contents.len() as u64)
    }

    fn write_untracked_blob(root: &Path, sha: &str, contents: &[u8]) -> PathBuf {
        let path = artifact_path(root, sha);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, contents).unwrap();
        path
    }

    #[test]
    fn test_cache_ingest_and_restore() {
        let tmp = tempdir().unwrap();
        let mut cache = ArtifactCache::load_with_labels(tmp.path()).unwrap();

        // Create a dummy file
        let file_path = tmp.path().join("test.txt");
        {
            let mut f = File::create(&file_path).unwrap();
            write!(f, "hello world").unwrap();
        }

        // Ingest it
        let sha = cache.ingest_file(&file_path, None, None).unwrap();
        cache.set_label("test-label", sha.clone());
        cache.save().unwrap();

        // Delete original
        fs::remove_file(&file_path).unwrap();

        // Restore it
        let restored_path = tmp.path().join("restored.txt");
        let found_sha = cache.find_component("test-label").unwrap();
        assert_eq!(found_sha, sha);

        let candidate = cache.restore_candidate("test-label").unwrap();
        assert_eq!(candidate.sha256, sha);

        let success = ArtifactCache::restore_blob_to_path(&candidate.blob_path, &restored_path)
            .unwrap();
        assert!(success);
        assert!(restored_path.exists());

        let content = fs::read_to_string(restored_path).unwrap();
        assert_eq!(content, "hello world");

        let restored_again = tmp.path().join("restored-again.txt");
        let success = cache.restore_artifact(&found_sha, &restored_again).unwrap();
        assert!(success);
        assert_eq!(fs::read_to_string(restored_again).unwrap(), "hello world");
    }

    #[test]
    fn test_cache_persistence() {
        let tmp = tempdir().unwrap();

        {
            let mut cache = ArtifactCache::load_with_labels(tmp.path()).unwrap();
            let file_path = tmp.path().join("test.txt");
            fs::write(&file_path, "persistent content").unwrap();

            let sha = cache.ingest_file(&file_path, None, None).unwrap();
            cache.set_label("p-label", sha);
            cache.save().unwrap();
        }

        // Reload cache
        let cache = ArtifactCache::load_with_labels(tmp.path()).unwrap();
        assert!(cache.find_component("p-label").is_some());
    }

    #[test]
    fn test_prune_to_limit_removes_lru_unused_artifacts_only() {
        let tmp = tempdir().unwrap();
        let mut cache = ArtifactCache::load_with_labels(tmp.path()).unwrap();

        let (sha_oldest, oldest_size) =
            ingest_test_artifact(&mut cache, tmp.path(), "oldest.bin", b"1234");
        let (sha_middle, middle_size) =
            ingest_test_artifact(&mut cache, tmp.path(), "middle.bin", b"5678");
        let (sha_newest, newest_size) =
            ingest_test_artifact(&mut cache, tmp.path(), "newest.bin", b"90ab");

        cache.artifacts.get_mut(&sha_oldest).unwrap().last_used = 10;
        cache.artifacts.get_mut(&sha_middle).unwrap().last_used = 20;
        cache.artifacts.get_mut(&sha_newest).unwrap().last_used = 30;

        let total = oldest_size + middle_size + newest_size;
        let summary = cache.prune_to_limit(total - oldest_size);

        assert_eq!(summary.removed_artifacts, 1);
        assert_eq!(summary.removed_bytes, oldest_size);
        assert!(!cache.has_artifact(&sha_oldest));
        assert!(cache.has_artifact(&sha_middle));
        assert!(cache.has_artifact(&sha_newest));
        assert_eq!(summary.total_bytes, total - oldest_size);
        assert_eq!(summary.prunable_bytes, middle_size + newest_size);
        assert_eq!(summary.pinned_bytes, 0);
    }

    #[test]
    fn test_prune_to_limit_keeps_referenced_artifacts_even_if_over_limit() {
        let tmp = tempdir().unwrap();
        let mut cache = ArtifactCache::load_with_labels(tmp.path()).unwrap();

        let (sha_pinned, pinned_size) =
            ingest_test_artifact(&mut cache, tmp.path(), "pinned.bin", b"12345");
        let (sha_unused, unused_size) =
            ingest_test_artifact(&mut cache, tmp.path(), "unused.bin", b"67890");

        cache.artifacts.get_mut(&sha_pinned).unwrap().last_used = 1;
        cache.artifacts.get_mut(&sha_unused).unwrap().last_used = 2;
        cache.record_install(
            "instance-1",
            None,
            &[InstallArtifactRef::new("client", sha_pinned.clone())],
        );

        let summary = cache.prune_to_limit(0);

        assert_eq!(summary.removed_artifacts, 1);
        assert_eq!(summary.removed_bytes, unused_size);
        assert!(cache.has_artifact(&sha_pinned));
        assert!(!cache.has_artifact(&sha_unused));
        assert_eq!(summary.total_bytes, pinned_size);
        assert_eq!(summary.prunable_bytes, 0);
        assert_eq!(summary.pinned_bytes, pinned_size);

        let usage = cache.usage_summary();
        assert_eq!(usage.total_bytes, pinned_size);
        assert_eq!(usage.prunable_bytes, 0);
        assert_eq!(usage.pinned_bytes, pinned_size);
    }

    #[test]
    fn test_reconcile_removes_missing_artifacts_from_install_indexes_and_labels() {
        let tmp = tempdir().unwrap();
        let mut cache = ArtifactCache::load_with_labels(tmp.path()).unwrap();

        let (sha, size) = ingest_test_artifact(&mut cache, tmp.path(), "missing.bin", b"12345");
        cache.set_label("missing-label", sha.clone());
        cache.record_install(
            "instance-1",
            Some("fabric".to_string()),
            &[InstallArtifactRef::new("client", sha.clone())],
        );
        cache.save().unwrap();
        fs::remove_file(cache.get_artifact_path(&sha)).unwrap();

        let cache = ArtifactCache::load_with_labels(tmp.path()).unwrap();
        let usage = cache.usage_summary();

        assert!(!cache.has_artifact(&sha));
        assert_eq!(cache.find_component("missing-label"), None);
        assert!(!cache
            .install_index
            .get("instance-1")
            .unwrap()
            .libraries
            .contains(&sha));
        assert_eq!(usage.total_bytes, 0);
        assert_ne!(usage.pinned_bytes, size);
    }

    #[test]
    fn test_refs_are_rebuilt_from_install_index_on_load() {
        let tmp = tempdir().unwrap();
        let mut cache = ArtifactCache::load_with_labels(tmp.path()).unwrap();

        let (sha, _) = ingest_test_artifact(&mut cache, tmp.path(), "refs.bin", b"12345");
        cache.record_install(
            "instance-1",
            None,
            &[InstallArtifactRef::new("client", sha.clone())],
        );
        cache.artifacts.get_mut(&sha).unwrap().refs = 42;
        cache.save().unwrap();

        let cache = ArtifactCache::load_with_labels(tmp.path()).unwrap();

        assert_eq!(cache.artifacts.get(&sha).unwrap().refs, 1);
    }

    #[test]
    fn test_prune_to_limit_counts_and_removes_untracked_blobs() {
        let tmp = tempdir().unwrap();
        let mut cache = ArtifactCache::load_with_labels(tmp.path()).unwrap();

        let (sha_indexed, indexed_size) =
            ingest_test_artifact(&mut cache, tmp.path(), "indexed.bin", b"12345");
        cache.artifacts.get_mut(&sha_indexed).unwrap().last_used = 30;
        cache.record_install(
            "instance-1",
            None,
            &[InstallArtifactRef::new("client", sha_indexed.clone())],
        );

        let sha_untracked = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let untracked_size = 4;
        let untracked_path = write_untracked_blob(tmp.path(), sha_untracked, b"6789");

        let usage = cache.usage_summary();
        assert_eq!(usage.total_bytes, indexed_size + untracked_size);
        assert_eq!(usage.prunable_bytes, untracked_size);
        assert_eq!(usage.pinned_bytes, indexed_size);

        let summary = cache.prune_to_limit(indexed_size);

        assert_eq!(summary.total_bytes, indexed_size);
        assert_eq!(summary.removed_bytes, untracked_size);
        assert!(cache.has_artifact(&sha_indexed));
        assert!(!untracked_path.exists());
    }

    #[test]
    fn test_failed_indexed_blob_delete_keeps_indexed_usage() {
        let tmp = tempdir().unwrap();
        let mut cache = ArtifactCache::load_with_labels(tmp.path()).unwrap();

        let (sha, size) = ingest_test_artifact(&mut cache, tmp.path(), "directory.bin", b"12345");
        let blob_path = cache.get_artifact_path(&sha);
        fs::remove_file(&blob_path).unwrap();
        fs::create_dir_all(&blob_path).unwrap();

        let summary = cache.prune_to_limit(0);

        assert_eq!(summary.removed_artifacts, 0);
        assert_eq!(summary.removed_bytes, 0);
        assert_eq!(summary.total_bytes, size);
        assert!(cache.has_artifact(&sha));
    }
}
