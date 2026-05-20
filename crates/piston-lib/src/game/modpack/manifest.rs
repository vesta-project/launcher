use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use super::types::{ModpackFormat, ModpackMetadata, ModpackMod};

/// Persisted manifest recording what a modpack install placed on disk.
/// This is the source of truth for repair: diff the current directory
/// against this manifest to find missing, extra, or modified files.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModpackManifest {
    /// Platform the modpack came from ("modrinth" or "curseforge")
    #[serde(alias = "format")]
    pub source: ModpackFormat,
    /// Platform-specific modpack project ID (e.g. Modrinth project slug, CF project ID)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modpack_id: Option<String>,
    pub name: String,
    pub version: String,
    pub installed_at: String,
    pub minecraft_version: String,
    pub modloader: ModpackManifestModloader,
    pub mods: Vec<ModpackManifestMod>,
    pub overrides: ModpackManifestOverrides,
    /// Absolute path to the original ZIP file (if still available)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_zip_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModpackManifestModloader {
    #[serde(rename = "type")]
    pub loader_type: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModpackManifestMod {
    pub source: ModSource,
    /// Path relative to game_dir
    pub path: String,
    pub sha1: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "lowercase")]
pub enum ModSource {
    Modrinth {
        /// Project ID (extracted from the download URL)
        project_id: String,
        /// Version ID (extracted from the download URL)
        version_id: String,
        /// Direct download URL
        url: String,
    },
    CurseForge {
        project_id: Option<u32>,
        file_id: u32,
        /// Resolved download URL
        url: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModpackManifestOverrides {
    /// Files that were extracted from the overrides
    pub extracted: Vec<String>,
    /// Config files that were intentionally skipped (preserved user changes)
    #[serde(default)]
    pub skipped_configs: Vec<String>,
}

/// Result of diffing the current directory against the manifest.
#[derive(Debug, Clone)]
pub struct ManifestDiff {
    /// Resources in the manifest that are missing or have wrong SHA1 on disk
    pub resources_to_fix: Vec<ModpackManifestMod>,
    /// Override files that are missing or have wrong content
    pub overrides_to_fix: Vec<String>,
    /// Config files that would be overwritten by a repair (skipped by default)
    pub configs_would_overwrite: Vec<String>,
    /// Files on disk that aren't in the manifest (user-added)
    pub extra_files: Vec<String>,
}

impl ModpackManifest {
    pub const FILE_NAME: &'static str = "modpack_manifest.json";

    /// Build a manifest from the metadata and the list of files that were
    /// extracted/installed during modpack installation.
    pub fn from_install(
        metadata: &ModpackMetadata,
        extracted_overrides: &[PathBuf],
        skipped_configs: &[String],
        source_zip_path: Option<PathBuf>,
        modpack_id: Option<String>,
    ) -> Self {
        let now = chrono::Utc::now().to_rfc3339();

        let mods: Vec<ModpackManifestMod> = metadata
            .mods
            .iter()
            .map(|m| match m {
                ModpackMod::Modrinth {
                    path,
                    urls,
                    hashes,
                    size,
                } => {
                    let url = urls.first().cloned().unwrap_or_default();
                    // Extract project_id and version_id from the Modrinth CDN URL.
                    // Format: https://cdn.modrinth.com/data/{project_id}/versions/{version_id}/{filename}
                    let (project_id, version_id) = parse_modrinth_url(&url);
                    ModpackManifestMod {
                        source: ModSource::Modrinth {
                            project_id,
                            version_id,
                            url,
                        },
                        path: path.clone(),
                        sha1: hashes.get("sha1").cloned(),
                        sha256: None,
                        size: Some(*size),
                    }
                }
                ModpackMod::CurseForge {
                    project_id,
                    file_id,
                    hash,
                    ..
                } => ModpackManifestMod {
                    source: ModSource::CurseForge {
                        project_id: *project_id,
                        file_id: *file_id,
                        url: String::new(), // URL resolved at download time
                    },
                    path: format!("mods/{}.jar", file_id), // best-effort; actual path resolved at download
                    sha1: hash.clone(),
                    sha256: None,
                    size: None,
                },
            })
            .collect();

        let overrides = ModpackManifestOverrides {
            extracted: extracted_overrides
                .iter()
                .filter_map(|p| p.to_string_lossy().into_owned().into())
                .collect::<Vec<String>>()
                .into_iter()
                .map(|s| s.to_string())
                .collect(),
            skipped_configs: skipped_configs.to_vec(),
        };

        Self {
            source: metadata.format,
            modpack_id,
            name: metadata.name.clone(),
            version: metadata.version.clone(),
            installed_at: now,
            minecraft_version: metadata.minecraft_version.clone(),
            modloader: ModpackManifestModloader {
                loader_type: metadata.modloader_type.clone(),
                version: metadata.modloader_version.clone(),
            },
            mods,
            overrides,
            source_zip_path,
        }
    }

    /// Load a manifest from an instance's game directory.
    pub fn load(game_dir: &Path) -> Result<Self, anyhow::Error> {
        let path = game_dir.join(Self::FILE_NAME);
        let content = std::fs::read_to_string(&path)?;
        let manifest: Self = serde_json::from_str(&content)?;
        Ok(manifest)
    }

    /// Persist the manifest to an instance's game directory.
    pub fn persist(&self, game_dir: &Path) -> Result<(), anyhow::Error> {
        let path = game_dir.join(Self::FILE_NAME);
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, json)?;
        log::info!(
            "[modpack-manifest] Persisted manifest: {} mods, {} overrides -> {}",
            self.mods.len(),
            self.overrides.extracted.len(),
            path.display()
        );
        Ok(())
    }

    /// Diff the manifest against the current state of the game directory.
    /// Returns what needs to be fixed.
    pub fn diff(&self, game_dir: &Path) -> ManifestDiff {
        let mut resources_to_fix = Vec::new();
        let mut overrides_to_fix = Vec::new();
        let mut configs_would_overwrite = Vec::new();
        let extra_files = Vec::new();

        // Check mods
        for m in &self.mods {
            let full_path = game_dir.join(&m.path);
            if !full_path.exists() {
                resources_to_fix.push(m.clone());
            } else if let Some(ref expected_sha1) = m.sha1 {
                // Verify SHA1
                match compute_file_sha1(&full_path) {
                    Ok(computed) if computed.to_lowercase() == expected_sha1.to_lowercase() => {
                        // OK
                    }
                    _ => {
                        // Also try SHA-256 if available
                        if let Some(ref expected_sha256) = m.sha256 {
                            match compute_file_sha256(&full_path) {
                                Ok(computed)
                                    if computed.to_lowercase()
                                        == expected_sha256.to_lowercase() =>
                                {
                                    // SHA-256 matched
                                }
                                _ => {
                                    resources_to_fix.push(m.clone());
                                }
                            }
                        } else {
                            resources_to_fix.push(m.clone());
                        }
                    }
                }
            }
        }

        // Check overrides
        for ov in &self.overrides.extracted {
            let full_path = game_dir.join(ov);
            if !full_path.exists() {
                // Determine if this is a config file
                if is_config_path(ov) {
                    configs_would_overwrite.push(ov.clone());
                } else {
                    overrides_to_fix.push(ov.clone());
                }
            }
        }

        ManifestDiff {
            resources_to_fix,
            overrides_to_fix,
            configs_would_overwrite,
            extra_files,
        }
    }
}

/// Check if a path refers to a config file/directory.
fn is_config_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    // Check if it's in the config/ directory
    if lower.starts_with("config/") || lower.starts_with("config\\") {
        return true;
    }
    // Check for common config extensions
    let config_extensions = [
        ".cfg",
        ".config",
        ".json",
        ".toml",
        ".yml",
        ".yaml",
        ".properties",
        ".txt",
    ];
    config_extensions.iter().any(|ext| lower.ends_with(ext))
}

/// Compute SHA1 hash of a file (for diff comparison).
fn compute_file_sha1(path: &Path) -> Result<String, anyhow::Error> {
    use sha1::{Digest, Sha1};
    use std::io::Read;

    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha1::new();
    let mut buffer = [0u8; 8192];
    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Compute SHA-256 hash of a file (for diff comparison — stronger than SHA-1).
fn compute_file_sha256(path: &Path) -> Result<String, anyhow::Error> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];
    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Parse a Modrinth CDN URL to extract project_id and version_id.
/// Format: https://cdn.modrinth.com/data/{project_id}/versions/{version_id}/{filename}
fn parse_modrinth_url(url: &str) -> (String, String) {
    let project_id = url
        .split("/data/")
        .nth(1)
        .and_then(|s| s.split('/').next())
        .unwrap_or("unknown")
        .to_string();
    let version_id = url
        .split("/versions/")
        .nth(1)
        .and_then(|s| s.split('/').next())
        .unwrap_or("unknown")
        .to_string();
    (project_id, version_id)
}

// TODO: Support mixed-format modpack export/repair — a single modpack containing
// resources from both Modrinth and CurseForge. Currently each manifest is
// single-source. A mixed format would allow exporting/repairing modpacks that
// aggregate resources from multiple platforms.
