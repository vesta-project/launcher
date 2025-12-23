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

#[derive(Debug)]
pub struct ArtifactCache {
    root: PathBuf,
    artifacts: HashMap<String, ArtifactRecord>,
    install_index: HashMap<String, InstallIndexRecord>,
    label_index: HashMap<String, String>,
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

        Ok(Self {
            root: root.to_path_buf(),
            artifacts,
            install_index,
            label_index: HashMap::new(),
        })
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
        self.root
            .join("cache")
            .join("blobs")
            .join(&sha256[..2])
            .join(sha256)
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
    }

    pub fn remove_install(&mut self, version_id: &str) {
        if let Some(entry) = self.install_index.remove(version_id) {
            for sha in entry.libraries {
                self.release_artifact(&sha);
            }
        }
    }

    pub fn prune_unused(&mut self) {
        let reachable: HashSet<String> = self
            .install_index
            .values()
            .flat_map(|idx| idx.libraries.iter().cloned())
            .collect();
        self.artifacts
            .retain(|sha, rec| rec.refs > 0 || reachable.contains(sha));
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

    pub fn restore_artifact(&self, sha256: &str, destination: &Path) -> Result<bool> {
        let blob_path = self.get_artifact_path(sha256);
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
