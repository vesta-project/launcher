use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::utils::paths::{join_validated, path_is_within};
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
    /// sha1 hashes for override files (lowercase relative path → hex hash)
    #[serde(default)]
    pub hashes: HashMap<String, String>,
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
            hashes: HashMap::new(),
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

    /// Backfill missing hashes from disk before diffing or persisting after repair.
    /// Covers mods (including `.disabled`) and override files. Platform-hosted mods
    /// may still need API enrichment afterward; local override-only files do not.
    pub fn prepare_for_repair(&mut self, game_dir: &Path) {
        self.backfill_mod_sha1(game_dir);
        self.backfill_override_hashes(game_dir);
    }

    /// Snapshot sha1 hashes for mod files on disk when the manifest entry is missing one.
    /// Checks both the enabled path and the `.disabled` variant.
    pub fn backfill_mod_sha1(&mut self, game_dir: &Path) {
        for m in &mut self.mods {
            if m.sha1.as_ref().is_some_and(|h| !h.is_empty()) {
                continue;
            }
            if let Some(disk_path) = resolve_mod_path_on_disk(game_dir, &m.path) {
                if let Ok(sha1) = compute_file_sha1(&disk_path) {
                    m.sha1 = Some(sha1);
                }
            }
        }
    }

    /// Snapshot sha1 hashes for override files on disk.
    pub fn backfill_override_hashes(&mut self, game_dir: &Path) {
        for ov in &self.overrides.extracted {
            let Ok(full_path) = join_validated(game_dir, ov) else {
                continue;
            };
            if full_path.is_file() {
                match compute_file_sha1(&full_path) {
                    Ok(sha1) => {
                        self.overrides.hashes.insert(ov.to_lowercase(), sha1);
                    }
                    Err(e) => {
                        log::warn!(
                            "[modpack-manifest] Failed to backfill override hash for {}: {}",
                            ov,
                            e
                        );
                    }
                }
            }
        }
    }

    /// Expected sha1 content hash for update diff (mods from index, overrides from hashes).
    pub fn expected_content_hash(
        &self,
        path: &str,
        mod_entry: Option<&ModpackManifestMod>,
    ) -> Option<String> {
        if let Some(m) = mod_entry {
            return m.sha1.clone();
        }
        self.overrides.hashes.get(&path.to_lowercase()).cloned()
    }

    /// Diff the manifest against the current state of the game directory.
    /// Returns what needs to be fixed.
    pub fn diff(&self, game_dir: &Path) -> ManifestDiff {
        let mut resources_to_fix = Vec::new();
        let mut overrides_to_fix = Vec::new();
        let mut configs_would_overwrite = Vec::new();
        let extra_files = Vec::new();

        // Check mods (enabled path or `.disabled` variant)
        for m in &self.mods {
            match resolve_mod_path_on_disk(game_dir, &m.path) {
                None => resources_to_fix.push(m.clone()),
                Some(disk_path) => {
                    if let Some(ref expected_sha1) = m.sha1 {
                        match compute_file_sha1(&disk_path) {
                            Ok(computed)
                                if computed.to_lowercase() == expected_sha1.to_lowercase() => {}
                            Ok(_) => resources_to_fix.push(m.clone()),
                            Err(e) => {
                                log::warn!(
                                    "[modpack-manifest] Failed to hash mod {}: {}",
                                    m.path,
                                    e
                                );
                                resources_to_fix.push(m.clone());
                            }
                        }
                    }
                    // Missing manifest sha1 but file present: prepare_for_repair should fill it.
                }
            }
        }

        // Check overrides (existence + hash when known)
        for ov in &self.overrides.extracted {
            let full_path = match join_validated(game_dir, ov) {
                Ok(p) => p,
                Err(e) => {
                    log::warn!("[modpack-manifest] Invalid override path {}: {}", ov, e);
                    overrides_to_fix.push(ov.clone());
                    continue;
                }
            };
            if !full_path.is_file() {
                if is_config_path(ov) {
                    configs_would_overwrite.push(ov.clone());
                } else {
                    overrides_to_fix.push(ov.clone());
                }
                continue;
            }

            if let Some(expected) = self.overrides.hashes.get(&ov.to_lowercase()) {
                let hash_ok = match compute_file_sha1(&full_path) {
                    Ok(computed) => computed.to_lowercase() == expected.to_lowercase(),
                    Err(e) => {
                        log::warn!(
                            "[modpack-manifest] Failed to hash override {}: {}",
                            ov,
                            e
                        );
                        false
                    }
                };
                if !hash_ok {
                    if is_config_path(ov) {
                        configs_would_overwrite.push(ov.clone());
                    } else {
                        overrides_to_fix.push(ov.clone());
                    }
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

/// Path for a disabled mod (`mods/foo.jar` → `mods/foo.jar.disabled`).
pub fn disabled_mod_path(manifest_path: &str) -> String {
    format!("{}.disabled", manifest_path)
}

/// Resolve where a manifest mod actually lives on disk (enabled or `.disabled`).
pub fn resolve_mod_path_on_disk(game_dir: &Path, manifest_path: &str) -> Option<PathBuf> {
    let enabled = join_validated(game_dir, manifest_path).ok()?;
    if enabled.is_file() {
        return Some(enabled);
    }
    let disabled = join_validated(game_dir, &disabled_mod_path(manifest_path)).ok()?;
    if disabled.is_file() {
        return Some(disabled);
    }
    None
}

/// Target path for re-downloading a mod during repair (preserves disabled state).
pub fn mod_repair_target_path(
    game_dir: &Path,
    manifest_path: &str,
) -> anyhow::Result<PathBuf> {
    if let Some(disk_path) = resolve_mod_path_on_disk(game_dir, manifest_path) {
        path_is_within(game_dir, &disk_path)?;
        return Ok(disk_path);
    }
    join_validated(game_dir, manifest_path)
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

/// Compute SHA1 hash of a file (for mod diff comparison — matches modpack index).
pub fn compute_file_sha1(path: &Path) -> Result<String, anyhow::Error> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::modpack::types::ModpackFormat;

    fn sample_mod(path: &str, sha1: Option<&str>) -> ModpackManifestMod {
        ModpackManifestMod {
            source: ModSource::Modrinth {
                project_id: "proj".into(),
                version_id: "ver".into(),
                url: "https://cdn.modrinth.com/data/proj/versions/ver/mod.jar".into(),
            },
            path: path.into(),
            sha1: sha1.map(|s| s.to_string()),
            size: None,
        }
    }

    fn empty_manifest(mods: Vec<ModpackManifestMod>) -> ModpackManifest {
        ModpackManifest {
            source: ModpackFormat::Modrinth,
            modpack_id: None,
            name: "Test".into(),
            version: "1.0".into(),
            installed_at: "2024-01-01T00:00:00Z".into(),
            minecraft_version: "1.20.1".into(),
            modloader: ModpackManifestModloader {
                loader_type: "fabric".into(),
                version: None,
            },
            mods,
            overrides: ModpackManifestOverrides {
                extracted: vec![],
                skipped_configs: vec![],
                hashes: HashMap::new(),
            },
            source_zip_path: None,
        }
    }

    #[test]
    fn diff_accepts_disabled_mod_with_matching_hash() {
        let dir = tempfile::tempdir().unwrap();
        let game_dir = dir.path();
        let sha1 = compute_file_sha1(&{
            let p = game_dir.join("mods/foo.jar.disabled");
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, b"mod-bytes").unwrap();
            p
        })
        .unwrap();

        let manifest = empty_manifest(vec![sample_mod("mods/foo.jar", Some(&sha1))]);
        let diff = manifest.diff(game_dir);
        assert!(diff.resources_to_fix.is_empty());
    }

    #[test]
    fn diff_flags_missing_mod_when_neither_variant_exists() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = empty_manifest(vec![sample_mod("mods/foo.jar", Some("abc"))]);
        let diff = manifest.diff(dir.path());
        assert_eq!(diff.resources_to_fix.len(), 1);
    }

    #[test]
    fn backfill_mod_sha1_reads_disabled_variant() {
        let dir = tempfile::tempdir().unwrap();
        let game_dir = dir.path();
        std::fs::create_dir_all(game_dir.join("mods")).unwrap();
        std::fs::write(game_dir.join("mods/foo.jar.disabled"), b"mod-bytes").unwrap();

        let mut manifest = empty_manifest(vec![sample_mod("mods/foo.jar", None)]);
        manifest.backfill_mod_sha1(game_dir);
        assert!(manifest.mods[0].sha1.is_some());
    }
}

// TODO: Support mixed-format modpack export/repair — a single modpack containing
// resources from both Modrinth and CurseForge. Currently each manifest is
// single-source. A mixed format would allow exporting/repairing modpacks that
// aggregate resources from multiple platforms.
