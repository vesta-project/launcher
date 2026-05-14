use crate::game::installer::types::{
    InstallSpec, RepairScope, VerificationIssue, VerificationIssueKind, VerificationResult,
};
use anyhow::Result;
use sha1::{Digest, Sha1};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Maximum number of asset objects to spot-check (randomly sampled).
/// Set to 0 to disable spot-checking entirely.
const ASSET_SPOT_CHECK_COUNT: usize = 20;

/// Compute SHA1 hash of a file. Returns hex string.
fn compute_sha1(path: &Path) -> Result<String> {
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

/// Verify that a file's SHA1 matches the expected hash (case-insensitive compare).
/// Returns Ok(true) if match, Ok(false) if mismatch, Err if file can't be read.
fn verify_sha1(path: &Path, expected_sha1: &str) -> Result<bool> {
    let computed = compute_sha1(path)?;
    Ok(computed.to_lowercase() == expected_sha1.to_lowercase())
}

/// Verify JRE executable at the given path is runnable.
/// Returns `true` if `java -version` succeeds, `false` if the binary doesn't exist or fails.
fn verify_jre_executable(java_path: &Path) -> bool {
    if !java_path.exists() {
        return false;
    }
    Command::new(java_path)
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Verify asset objects exist and spot-check their SHA1 hashes.
/// Returns a list of VerificationIssues found.
fn verify_asset_objects(assets_dir: &Path, spec: &InstallSpec) -> Vec<VerificationIssue> {
    let mut issues = Vec::new();

    // Find the asset index to know what objects are expected
    let installed_id = spec.installed_version_id();
    let version_json_path = spec
        .versions_dir()
        .join(&installed_id)
        .join(format!("{}.json", installed_id));

    let index_content = match std::fs::read_to_string(&version_json_path) {
        Ok(c) => c,
        Err(_) => {
            // Try vanilla version path
            let vanilla_path = spec
                .versions_dir()
                .join(&spec.version_id)
                .join(format!("{}.json", spec.version_id));
            match std::fs::read_to_string(&vanilla_path) {
                Ok(c) => c,
                Err(_) => return issues, // Can't verify assets without version JSON
            }
        }
    };

    let parsed: serde_json::Value = match serde_json::from_str(&index_content) {
        Ok(v) => v,
        Err(_) => return issues,
    };

    let asset_index_id = parsed
        .get("assetIndex")
        .and_then(|a| a.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("legacy");

    let index_path = assets_dir
        .join("indexes")
        .join(format!("{}.json", asset_index_id));

    let index_content = match std::fs::read_to_string(&index_path) {
        Ok(c) => c,
        Err(_) => {
            issues.push(VerificationIssue {
                kind: VerificationIssueKind::Missing,
                artifact_class: "asset-index".to_string(),
                path: index_path.to_string_lossy().to_string(),
                detail: "Asset index file is missing; cannot verify asset objects".to_string(),
            });
            return issues;
        }
    };

    let index: serde_json::Value = match serde_json::from_str(&index_content) {
        Ok(v) => v,
        Err(_) => {
            issues.push(VerificationIssue {
                kind: VerificationIssueKind::Mismatch,
                artifact_class: "asset-index".to_string(),
                path: index_path.to_string_lossy().to_string(),
                detail: "Asset index is corrupt (unparseable)".to_string(),
            });
            return issues;
        }
    };

    let objects = match index.get("objects").and_then(|o| o.as_object()) {
        Some(o) => o,
        None => return issues, // Legacy format without objects
    };

    let total_expected = objects.len();
    let objects_dir = assets_dir.join("objects");
    let mut present_count = 0usize;
    let mut missing_count = 0usize;
    let mut mismatch_count = 0usize;

    // Collect entries for spot-check sampling
    let entries: Vec<(&String, &serde_json::Value)> = objects.iter().collect();

    // If spot-checking, randomly select a subset
    let check_set: Vec<usize> =
        if ASSET_SPOT_CHECK_COUNT > 0 && entries.len() > ASSET_SPOT_CHECK_COUNT {
            use std::collections::HashSet;
            use std::time::{SystemTime, UNIX_EPOCH};
            let seed = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos() as u64)
                .unwrap_or(42);
            // Simple deterministic sampling based on time seed
            let mut indices = HashSet::new();
            let mut rng = seed;
            while indices.len() < ASSET_SPOT_CHECK_COUNT {
                rng = rng
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                indices.insert((rng as usize) % entries.len());
            }
            indices.into_iter().collect()
        } else {
            (0..entries.len()).collect()
        };

    let is_full_check = check_set.len() == entries.len();

    for idx in &check_set {
        let (asset_name, asset_obj) = entries[*idx];
        let hash = match asset_obj.get("hash").and_then(|h| h.as_str()) {
            Some(h) => h,
            None => continue,
        };
        let Some(hash_prefix) = hash.get(..2) else {
            log::warn!(
                "[verifier] Asset object hash too short to derive path: name={} hash={}",
                asset_name,
                hash
            );
            issues.push(VerificationIssue {
                kind: VerificationIssueKind::Mismatch,
                artifact_class: "asset-object".to_string(),
                path: assets_dir.to_string_lossy().to_string(),
                detail: format!(
                    "Asset object hash is too short to derive its path: {} (hash={})",
                    asset_name, hash
                ),
            });
            continue;
        };
        let asset_path = objects_dir.join(hash_prefix).join(hash);

        if !asset_path.exists() {
            missing_count += 1;
            issues.push(VerificationIssue {
                kind: VerificationIssueKind::Missing,
                artifact_class: "asset-object".to_string(),
                path: asset_path.to_string_lossy().to_string(),
                detail: format!("Asset object missing: {}", asset_name),
            });
        } else {
            present_count += 1;
            // SHA1 spot-check
            match compute_sha1(&asset_path) {
                Ok(computed) => {
                    if computed.to_lowercase() != hash.to_lowercase() {
                        mismatch_count += 1;
                        issues.push(VerificationIssue {
                            kind: VerificationIssueKind::Mismatch,
                            artifact_class: "asset-object".to_string(),
                            path: asset_path.to_string_lossy().to_string(),
                            detail: format!(
                                "Asset object hash mismatch: {} (expected {}, got {})",
                                asset_name, hash, computed
                            ),
                        });
                    }
                }
                Err(e) => {
                    mismatch_count += 1;
                    issues.push(VerificationIssue {
                        kind: VerificationIssueKind::Mismatch,
                        artifact_class: "asset-object".to_string(),
                        path: asset_path.to_string_lossy().to_string(),
                        detail: format!("Cannot read asset object {}: {}", asset_name, e),
                    });
                }
            }
        }
    }

    // Also do a quick count check against the objects directory
    if objects_dir.exists() {
        if let Ok(dir_entries) = std::fs::read_dir(objects_dir) {
            let on_disk_count: usize = dir_entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .flat_map(|prefix_dir| {
                    std::fs::read_dir(prefix_dir.path())
                        .into_iter()
                        .flat_map(|dir| dir.filter_map(|e| e.ok()))
                })
                .count();

            if is_full_check && on_disk_count != total_expected {
                log::warn!(
                    "[verifier] Asset object count mismatch: expected {} objects, found {} on disk",
                    total_expected,
                    on_disk_count
                );
            }
        }
    }

    if !is_full_check {
        log::info!(
            "[verifier] Asset spot-check: {}/{} checked, {} present, {} missing, {} mismatch",
            check_set.len(),
            total_expected,
            present_count,
            missing_count,
            mismatch_count
        );
    } else {
        log::info!(
            "[verifier] Asset full check: {} total, {} present, {} missing, {} mismatch",
            total_expected,
            present_count,
            missing_count,
            mismatch_count
        );
    }

    issues
}

pub fn verify_instance_readiness(spec: &InstallSpec) -> Result<VerificationResult> {
    let mut checked = 0usize;
    let mut skipped_native = 0usize;
    let mut skipped_no_path = 0usize;
    let mut expected_native_libraries = 0usize;
    let mut present_native_artifacts = 0usize;
    let mut issues = Vec::new();
    let current_os = crate::game::installer::types::OsType::current();
    let installed_id = spec.installed_version_id();
    let installed_manifest = spec
        .versions_dir()
        .join(&installed_id)
        .join(format!("{}.json", installed_id));
    let vanilla_manifest = spec
        .versions_dir()
        .join(&spec.version_id)
        .join(format!("{}.json", spec.version_id));

    // Determine which manifest to use
    let (manifest_path, manifest_source) = if installed_manifest.exists() {
        (installed_manifest, "installed")
    } else if spec.modloader.is_none()
        || spec.modloader == Some(crate::game::installer::types::ModloaderType::Vanilla)
    {
        (vanilla_manifest, "vanilla")
    } else {
        log::error!(
            "[verifier] Modloader version manifest is missing: {}",
            spec.installed_version_id()
        );
        issues.push(VerificationIssue {
            kind: VerificationIssueKind::Missing,
            artifact_class: "version-manifest".to_string(),
            path: installed_manifest.to_string_lossy().to_string(),
            detail: format!(
                "Modloader version manifest is missing: {}",
                spec.installed_version_id()
            ),
        });
        return Ok(VerificationResult {
            ready: false,
            checked,
            issues,
        });
    };

    log::info!(
        "[verifier] Reading manifest: source={} path={} version={} modloader={:?}",
        manifest_source,
        manifest_path.display(),
        spec.version_id,
        spec.modloader,
    );

    checked += 1;
    if !manifest_path.exists() {
        log::error!(
            "[verifier] Version manifest does not exist: {}",
            manifest_path.display()
        );
        issues.push(VerificationIssue {
            kind: VerificationIssueKind::Missing,
            artifact_class: "version-manifest".to_string(),
            path: manifest_path.to_string_lossy().to_string(),
            detail: "Version manifest is missing".to_string(),
        });
        return Ok(VerificationResult {
            ready: false,
            checked,
            issues,
        });
    }

    let _manifest_json = match std::fs::read_to_string(&manifest_path) {
        Ok(raw) => raw,
        Err(e) => {
            log::error!(
                "[verifier] Version manifest unreadable: {} — {}",
                manifest_path.display(),
                e
            );
            issues.push(VerificationIssue {
                kind: VerificationIssueKind::Mismatch,
                artifact_class: "version-manifest".to_string(),
                path: manifest_path.to_string_lossy().to_string(),
                detail: format!("Version manifest is unreadable: {}", e),
            });
            return Ok(VerificationResult {
                ready: false,
                checked,
                issues,
            });
        }
    };

    // Try to load a UnifiedManifest (handles both VersionManifest and UnifiedManifest)
    let unified = match crate::game::launcher::unified_manifest::UnifiedManifest::load_from_path(
        &manifest_path,
    ) {
        Ok(u) => u,
        Err(e) => {
            log::error!(
                "[verifier] Failed to parse manifest into unified manifest: {} — {}",
                manifest_path.display(),
                e
            );
            issues.push(VerificationIssue {
                kind: VerificationIssueKind::Mismatch,
                artifact_class: "version-manifest".to_string(),
                path: manifest_path.to_string_lossy().to_string(),
                detail: format!("Version manifest could not be parsed: {}", e),
            });
            return Ok(VerificationResult {
                ready: false,
                checked,
                issues,
            });
        }
    };

    let installed_jar = spec
        .versions_dir()
        .join(&installed_id)
        .join(format!("{}.jar", installed_id));
    let vanilla_jar = spec
        .versions_dir()
        .join(&spec.version_id)
        .join(format!("{}.jar", spec.version_id));
    checked += 1;
    if !installed_jar.exists() && !vanilla_jar.exists() {
        log::warn!(
            "[verifier] Client JAR missing: installed_path={} vanilla_path={}",
            installed_jar.display(),
            vanilla_jar.display()
        );
        issues.push(VerificationIssue {
            kind: VerificationIssueKind::Missing,
            artifact_class: "client-jar".to_string(),
            path: installed_jar.to_string_lossy().to_string(),
            detail: "Neither installed-version nor vanilla client jar exists".to_string(),
        });
    } else {
        log::info!(
            "[verifier] Client JAR found: {}",
            if installed_jar.exists() {
                "installed"
            } else {
                "vanilla"
            }
        );
    }

    // Asset index check (use unified manifest representation)
    if let Some(ai) = &unified.asset_index {
        let asset_index_id = &ai.id;
        let index_path = spec
            .assets_dir()
            .join("indexes")
            .join(format!("{}.json", asset_index_id));
        checked += 1;
        if !index_path.exists() {
            log::warn!(
                "[verifier] Asset index missing: id={} path={}",
                asset_index_id,
                index_path.display()
            );
            issues.push(VerificationIssue {
                kind: VerificationIssueKind::Missing,
                artifact_class: "asset-index".to_string(),
                path: index_path.to_string_lossy().to_string(),
                detail: "Asset index file is missing".to_string(),
            });
        } else {
            log::info!("[verifier] Asset index found: id={}", asset_index_id);
            // Deep check: verify asset objects (only in Full scope)
            if spec.repair_scope == RepairScope::Full {
                let asset_issues = verify_asset_objects(&spec.assets_dir(), spec);
                checked += asset_issues.len();
                issues.extend(asset_issues);
            }
        }
    } else {
        log::debug!("[verifier] No asset index in manifest");
    }

    // Use UnifiedManifest libraries so verifier and installer pipeline agree on
    // which libraries are native and what their artifact paths are.
    log::info!(
        "[verifier] Checking {} library entries in manifest",
        unified.libraries.len()
    );

    for lib in &unified.libraries {
        let name = &lib.name;

        if !lib.include_in_classpath {
            log::debug!("[verifier] Skip (no classpath): {}", name);
            continue;
        }

        if lib.is_native {
            expected_native_libraries += 1;
            skipped_native += 1;

            if !lib.path.is_empty() {
                checked += 1;
                let full = spec.libraries_dir().join(&lib.path);
                if full.exists() {
                    present_native_artifacts += 1;
                    log::debug!(
                        "[verifier] Found native artifact: {} at {}",
                        name,
                        full.display()
                    );
                } else {
                    log::warn!(
                        "[verifier] Native artifact missing from libraries dir: name={} path={}",
                        name,
                        full.display()
                    );
                }
            } else {
                skipped_no_path += 1;
                log::warn!(
                    "[verifier] Native library has no artifact path metadata: {}",
                    name
                );
            }

            continue;
        }

        if !lib.path.is_empty() {
            checked += 1;
            let full = spec.libraries_dir().join(&lib.path);
            if !full.exists() {
                log::warn!(
                    "[verifier] Missing library: name={} path={}",
                    name,
                    full.display()
                );
                issues.push(VerificationIssue {
                    kind: VerificationIssueKind::Missing,
                    artifact_class: "library".to_string(),
                    path: full.to_string_lossy().to_string(),
                    detail: format!("Library artifact missing: {}", name),
                });
            } else if let Some(ref expected_sha1) = lib.sha1 {
                // Deep check: verify SHA1 hash
                match verify_sha1(&full, expected_sha1) {
                    Ok(true) => {
                        log::debug!(
                            "[verifier] Library verified (SHA1): {} at {}",
                            name,
                            full.display()
                        );
                    }
                    Ok(false) => {
                        log::warn!(
                            "[verifier] Library SHA1 mismatch: name={} path={}",
                            name,
                            full.display()
                        );
                        issues.push(VerificationIssue {
                            kind: VerificationIssueKind::Mismatch,
                            artifact_class: "library".to_string(),
                            path: full.to_string_lossy().to_string(),
                            detail: format!(
                                "Library SHA1 mismatch: {} (expected {})",
                                name, expected_sha1
                            ),
                        });
                    }
                    Err(e) => {
                        log::warn!(
                            "[verifier] Cannot read library for SHA1 check: name={} path={} err={}",
                            name,
                            full.display(),
                            e
                        );
                        issues.push(VerificationIssue {
                            kind: VerificationIssueKind::Mismatch,
                            artifact_class: "library".to_string(),
                            path: full.to_string_lossy().to_string(),
                            detail: format!("Cannot verify library {}: {}", name, e),
                        });
                    }
                }
            } else {
                log::debug!(
                    "[verifier] Found library (no SHA1): {} at {}",
                    name,
                    full.display()
                );
            }
        } else {
            log::warn!("[verifier] No path for library: {} — cannot verify", name);
            skipped_no_path += 1;
        }
    }

    if expected_native_libraries > 0 {
        checked += 1;
        let natives_dir = spec.natives_dir();
        let extracted_native_binaries = count_native_binaries(&natives_dir, current_os);
        if extracted_native_binaries > 0 {
            present_native_artifacts += extracted_native_binaries;
            log::info!(
                "[verifier] Native runtime files found in natives dir: count={} dir={}",
                extracted_native_binaries,
                natives_dir.display()
            );
        }

        if present_native_artifacts == 0 {
            log::warn!(
                "[verifier] Native runtime missing: expected_native_libraries={} natives_dir={}",
                expected_native_libraries,
                natives_dir.display()
            );
            issues.push(VerificationIssue {
                kind: VerificationIssueKind::Missing,
                artifact_class: "native-runtime".to_string(),
                path: natives_dir.to_string_lossy().to_string(),
                detail: format!(
                    "Native runtime artifacts are missing for current OS (expected {} native libraries but found none in libraries/ or natives/).",
                    expected_native_libraries
                ),
            });
        }
    }

    // ------------------------------------------------------------------
    // JRE verification
    // ------------------------------------------------------------------
    if spec.repair_scope == RepairScope::Full || spec.repair_scope == RepairScope::Versions {
        let jre_dir = spec.jre_dir();
        let java_bin = jre_dir.join("bin").join(if cfg!(target_os = "windows") {
            "java.exe"
        } else {
            "java"
        });
        if java_bin.exists() {
            checked += 1;
            if !verify_jre_executable(&java_bin) {
                log::warn!(
                    "[verifier] JRE executable exists but fails to run: {}",
                    java_bin.display()
                );
                issues.push(VerificationIssue {
                    kind: VerificationIssueKind::Mismatch,
                    artifact_class: "jre".to_string(),
                    path: java_bin.to_string_lossy().to_string(),
                    detail: "JRE executable exists but failed to execute (may be corrupt)"
                        .to_string(),
                });
            } else {
                log::info!("[verifier] JRE executable verified: {}", java_bin.display());
            }
        } else {
            log::debug!(
                "[verifier] No JRE found at expected path; will be installed during repair"
            );
        }
    }

    log::info!(
        "[verifier] verify-summary ready={} checked={} missing={} mismatch={} skipped_native={} skipped_no_path={}",
        issues.is_empty(),
        checked,
        issues.iter().filter(|i| matches!(i.kind, VerificationIssueKind::Missing)).count(),
        issues.iter().filter(|i| matches!(i.kind, VerificationIssueKind::Mismatch)).count(),
        skipped_native,
        skipped_no_path,
    );

    Ok(VerificationResult {
        ready: issues.is_empty(),
        checked,
        issues,
    })
}

fn library_is_native(lib: &serde_json::Value, name: &str) -> bool {
    if lib.get("is_native").and_then(|v| v.as_bool()) == Some(true) {
        return true;
    }

    let name_lower = name.to_lowercase();
    let parts_count = name.split(':').count();
    name_lower.contains(":natives-")
        || name_lower.contains(":native-")
        || (name_lower.contains("natives-") && parts_count > 3)
        || (name_lower.contains("native-") && parts_count > 3)
        || (parts_count > 3 && {
            let cl = name.split(':').nth(3).unwrap_or("").to_lowercase();
            cl.starts_with("osx-")
                || cl.starts_with("macos-")
                || cl.starts_with("linux-")
                || cl.starts_with("windows-")
                || cl.starts_with("win-")
        })
}

fn count_native_binaries(dir: &Path, os: crate::game::installer::types::OsType) -> usize {
    let mut count = 0usize;
    let mut stack = vec![dir.to_path_buf()];

    while let Some(path) = stack.pop() {
        let entries = match std::fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                stack.push(entry_path);
                continue;
            }

            if is_native_binary_for_os(&entry_path, os) {
                count += 1;
            }
        }
    }

    count
}

fn is_native_binary_for_os(path: &Path, os: crate::game::installer::types::OsType) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    match os {
        crate::game::installer::types::OsType::Windows
        | crate::game::installer::types::OsType::WindowsArm64 => ext == "dll",
        crate::game::installer::types::OsType::MacOS
        | crate::game::installer::types::OsType::MacOSArm64 => ext == "dylib" || ext == "jnilib",
        crate::game::installer::types::OsType::Linux
        | crate::game::installer::types::OsType::LinuxArm32
        | crate::game::installer::types::OsType::LinuxArm64 => ext == "so",
    }
}

fn library_artifact_path(lib: &serde_json::Value) -> Option<PathBuf> {
    // UnifiedManifest format: path is directly on the library object
    if let Some(path) = lib.get("path").and_then(|v| v.as_str()) {
        return Some(Path::new(path).to_path_buf());
    }

    // Mojang/VersionManifest format: path is under downloads.artifact.path
    lib.get("downloads")
        .and_then(|v| v.get("artifact"))
        .and_then(|v| v.get("path"))
        .and_then(|v| v.as_str())
        .map(Path::new)
        .map(Path::to_path_buf)
}

/// Check whether a library's `rules` field allows it on the given OS.
/// This mirrors Modrinth's `parse_rules` + `parse_rule` but operates on raw
/// JSON so the verifier doesn't need to parse the full typed manifest.
///
/// Rule evaluation:
/// - No rules → always included
/// - Allow + match → include
/// - Allow + no match → exclude (rule says "only include if...")
/// - Disallow + match → exclude
/// - Disallow + no match → neutral (rule doesn't apply)
/// - ALL rules are Disallow and NONE match → include (default-allow)
fn library_allowed_by_rules(
    lib: &serde_json::Value,
    os: crate::game::installer::types::OsType,
) -> bool {
    let Some(rules) = lib.get("rules").and_then(|v| v.as_array()) else {
        return true; // No rules → include
    };

    let os_name = os.os_name();
    let target_arch = os.rust_arch_str();

    let mut results: Vec<Option<bool>> = rules
        .iter()
        .map(|rule| {
            let matches = rule_matches_os_json(rule, os_name, target_arch);
            match rule.get("action").and_then(|v| v.as_str()) {
                Some("allow") => Some(matches),
                Some("disallow") => {
                    if matches {
                        Some(false)
                    } else {
                        None
                    }
                }
                _ => None,
            }
        })
        .collect();

    // If every rule is a disallow, add a synthetic allow (default-allow)
    let all_disallow = rules
        .iter()
        .all(|r| r.get("action").and_then(|v| v.as_str()) == Some("disallow"));
    if all_disallow {
        results.push(Some(true));
    }

    // Include if: at least one explicit true AND no explicit false
    !(results.iter().any(|r| r == &Some(false)) || results.iter().all(|r| r.is_none()))
}

/// Check whether a single rule object matches the current OS + arch.
/// Mirrors `rule_matches`.
fn rule_matches_os_json(rule: &serde_json::Value, os_name: &str, target_arch: &str) -> bool {
    // Check OS constraints
    if let Some(os_rule) = rule.get("os") {
        if let Some(name) = os_rule.get("name").and_then(|v| v.as_str()) {
            // Handle "osx"/"macos" interchangeability in rule definitions
            let name_matches = name == os_name
                || (os_name == "osx" && name == "macos")
                || (name == "osx" && os_name == "macos");
            if !name_matches {
                return false;
            }
        }
        if let Some(arch) = os_rule.get("arch").and_then(|v| v.as_str()) {
            // Normalize arch: "x64"/"amd64" → "x86_64", "arm64" → "aarch64"
            let normalized = match arch {
                "x64" | "amd64" => "x86_64",
                "arm64" => "aarch64",
                other => other,
            };
            if normalized != target_arch {
                return false;
            }
        }
    }

    // Check feature constraints — is_demo_user / has_custom_resolution
    // are always false for normal launchers, so any feature requirement
    // means the rule does NOT match.
    if let Some(features) = rule.get("features").and_then(|v| v.as_object()) {
        if features.contains_key("is_demo_user") || features.contains_key("has_custom_resolution") {
            return false;
        }
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::installer::types::OsType;
    use serde_json::json;

    fn native_classifier_for_os(os: OsType) -> &'static str {
        match os {
            OsType::Windows | OsType::WindowsArm64 => "natives-windows",
            OsType::MacOS | OsType::MacOSArm64 => "natives-macos",
            OsType::Linux | OsType::LinuxArm32 | OsType::LinuxArm64 => "natives-linux",
        }
    }

    fn native_extension_for_os(os: OsType) -> &'static str {
        match os {
            OsType::Windows | OsType::WindowsArm64 => "dll",
            OsType::MacOS | OsType::MacOSArm64 => "dylib",
            OsType::Linux | OsType::LinuxArm32 | OsType::LinuxArm64 => "so",
        }
    }

    fn os_rule_name(os: OsType) -> &'static str {
        match os {
            OsType::Windows | OsType::WindowsArm64 => "windows",
            OsType::MacOS | OsType::MacOSArm64 => "osx",
            OsType::Linux | OsType::LinuxArm32 | OsType::LinuxArm64 => "linux",
        }
    }

    fn setup_spec_with_manifest(include_extracted_native: bool) -> InstallSpec {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.into_path();

        let version_id = "1.20.1-test".to_string();
        let versions_dir = root.join("versions").join(&version_id);
        let assets_indexes = root.join("assets").join("indexes");
        let game_dir = root.join("instances").join("x");
        std::fs::create_dir_all(&versions_dir).expect("create versions");
        std::fs::create_dir_all(&assets_indexes).expect("create assets");
        std::fs::create_dir_all(&game_dir).expect("create game dir");

        std::fs::write(assets_indexes.join("30.json"), "{}").expect("write asset index");
        std::fs::write(versions_dir.join(format!("{}.jar", version_id)), "jar").expect("write jar");

        let os = OsType::current();
        let classifier = native_classifier_for_os(os);
        let library_name = format!("org.lwjgl:lwjgl:3.4.1:{}", classifier);
        let artifact_path = format!("org/lwjgl/lwjgl/3.4.1/lwjgl-3.4.1-{}.jar", classifier);

        let manifest = json!({
            "id": version_id,
            "assetIndex": { "id": "30" },
            "libraries": [
                {
                    "name": "org.lwjgl:lwjgl:3.4.1",
                    "downloads": {
                        "artifact": {
                            "path": "org/lwjgl/lwjgl/3.4.1/lwjgl-3.4.1.jar"
                        }
                    }
                },
                {
                    "name": library_name,
                    "downloads": {
                        "artifact": {
                            "path": artifact_path
                        }
                    },
                    "rules": [
                        { "action": "allow", "os": { "name": os_rule_name(os) } }
                    ]
                }
            ]
        });
        std::fs::write(
            versions_dir.join(format!("{}.json", "1.20.1-test")),
            serde_json::to_string(&manifest).expect("serialize"),
        )
        .expect("write manifest");

        if include_extracted_native {
            let natives_dir = root.join("natives").join("1.20.1-test");
            std::fs::create_dir_all(&natives_dir).expect("create natives dir");
            std::fs::write(
                natives_dir.join(format!("liblwjgl.{}", native_extension_for_os(os))),
                "native",
            )
            .expect("write native");
        }

        InstallSpec {
            version_id: "1.20.1-test".to_string(),
            modloader: None,
            modloader_version: None,
            data_dir: root,
            game_dir,
            java_path: None,
            dry_run: false,
            concurrency: 4,
            force_overwrite_configs: false,
            repair_scope: piston_lib::game::installer::types::RepairScope::Full,
            remediation_policy:
                piston_lib::game::installer::types::RemediationPolicy::RepairIfNeeded,
        }
    }

    fn setup_spec_with_asset_hash(hash: &str) -> InstallSpec {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.into_path();

        let version_id = "1.20.1-test-short-hash".to_string();
        let versions_dir = root.join("versions").join(&version_id);
        let assets_indexes = root.join("assets").join("indexes");
        let game_dir = root.join("instances").join("x");
        std::fs::create_dir_all(&versions_dir).expect("create versions");
        std::fs::create_dir_all(&assets_indexes).expect("create assets");
        std::fs::create_dir_all(&game_dir).expect("create game dir");

        let manifest = json!({
            "id": version_id,
            "assetIndex": { "id": "30" },
            "libraries": []
        });
        std::fs::write(
            assets_indexes.join("30.json"),
            json!({
                "objects": {
                    "bad-object": { "hash": hash }
                }
            })
            .to_string(),
        )
        .expect("write asset index");
        std::fs::write(
            versions_dir.join(format!("{}.json", version_id)),
            serde_json::to_string(&manifest).expect("serialize"),
        )
        .expect("write manifest");
        std::fs::write(versions_dir.join(format!("{}.jar", version_id)), "jar").expect("write jar");

        InstallSpec {
            version_id,
            modloader: None,
            modloader_version: None,
            data_dir: root,
            game_dir,
            java_path: None,
            dry_run: false,
            concurrency: 4,
            force_overwrite_configs: false,
            repair_scope: piston_lib::game::installer::types::RepairScope::Full,
            remediation_policy:
                piston_lib::game::installer::types::RemediationPolicy::RepairIfNeeded,
        }
    }

    #[test]
    fn verify_reports_missing_native_runtime() {
        let spec = setup_spec_with_manifest(false);
        let result = verify_instance_readiness(&spec).expect("verification");
        assert!(
            result
                .issues
                .iter()
                .any(|i| i.artifact_class == "native-runtime"),
            "expected native-runtime issue, got: {:?}",
            result.issues
        );
    }

    #[test]
    fn verify_accepts_existing_extracted_native_runtime() {
        let spec = setup_spec_with_manifest(true);
        let result = verify_instance_readiness(&spec).expect("verification");
        assert!(
            !result
                .issues
                .iter()
                .any(|i| i.artifact_class == "native-runtime"),
            "did not expect native-runtime issue, got: {:?}",
            result.issues
        );
    }

    #[test]
    fn verify_handles_short_asset_hash_without_panicking() {
        let spec = setup_spec_with_asset_hash("a");
        let result = verify_instance_readiness(&spec).expect("verification");
        assert!(
            result
                .issues
                .iter()
                .any(|i| i.artifact_class == "asset-object"),
            "expected asset-object issue, got: {:?}",
            result.issues
        );
    }
}
