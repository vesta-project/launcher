use crate::game::installer::types::{
    InstallSpec, VerificationIssue, VerificationIssueKind, VerificationResult,
};
use anyhow::Result;
use std::path::{Path, PathBuf};

pub fn verify_instance_readiness(spec: &InstallSpec) -> Result<VerificationResult> {
    let mut checked = 0usize;
    let mut issues = Vec::new();
    let installed_id = spec.installed_version_id();
    let installed_manifest = spec
        .versions_dir()
        .join(&installed_id)
        .join(format!("{}.json", installed_id));
    let vanilla_manifest = spec
        .versions_dir()
        .join(&spec.version_id)
        .join(format!("{}.json", spec.version_id));
    let manifest_path = if installed_manifest.exists() {
        installed_manifest
    } else {
        vanilla_manifest
    };

    checked += 1;
    if !manifest_path.exists() {
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

    let manifest_json = match std::fs::read_to_string(&manifest_path) {
        Ok(raw) => raw,
        Err(e) => {
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

    let parsed: serde_json::Value = match serde_json::from_str(&manifest_json) {
        Ok(v) => v,
        Err(e) => {
            issues.push(VerificationIssue {
                kind: VerificationIssueKind::Mismatch,
                artifact_class: "version-manifest".to_string(),
                path: manifest_path.to_string_lossy().to_string(),
                detail: format!("Version manifest is invalid JSON: {}", e),
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
        issues.push(VerificationIssue {
            kind: VerificationIssueKind::Missing,
            artifact_class: "client-jar".to_string(),
            path: installed_jar.to_string_lossy().to_string(),
            detail: "Neither installed-version nor vanilla client jar exists".to_string(),
        });
    }

    // Asset index is required for normal runtime.
    if let Some(asset_index_id) = parsed
        .get("assetIndex")
        .and_then(|v| v.get("id"))
        .and_then(|v| v.as_str())
    {
        let index_path = spec
            .assets_dir()
            .join("indexes")
            .join(format!("{}.json", asset_index_id));
        checked += 1;
        if !index_path.exists() {
            issues.push(VerificationIssue {
                kind: VerificationIssueKind::Missing,
                artifact_class: "asset-index".to_string(),
                path: index_path.to_string_lossy().to_string(),
                detail: "Asset index file is missing".to_string(),
            });
        }
    }

    // Lightweight library check: verify manifest-listed artifacts exist on disk.
    if let Some(libs) = parsed.get("libraries").and_then(|v| v.as_array()) {
        for lib in libs {
            if let Some(path) = library_artifact_path(lib) {
                checked += 1;
                let full = spec.libraries_dir().join(path);
                if !full.exists() {
                    issues.push(VerificationIssue {
                        kind: VerificationIssueKind::Missing,
                        artifact_class: "library".to_string(),
                        path: full.to_string_lossy().to_string(),
                        detail: "Library artifact missing".to_string(),
                    });
                }
            }
        }
    }

    Ok(VerificationResult {
        ready: issues.is_empty(),
        checked,
        issues,
    })
}

fn library_artifact_path(lib: &serde_json::Value) -> Option<PathBuf> {
    lib.get("downloads")
        .and_then(|v| v.get("artifact"))
        .and_then(|v| v.get("path"))
        .and_then(|v| v.as_str())
        .map(Path::new)
        .map(Path::to_path_buf)
}
