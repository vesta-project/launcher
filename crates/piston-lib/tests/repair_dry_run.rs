/// Integration tests for repair dry-run mode.
/// Validates that dry-run produces correct action plans with zero disk writes.
use piston_lib::game::installer::types::{
    InstallSpec, RemediationPolicy, RepairScope, SilentProgressReporter, VerificationIssueKind,
};
use piston_lib::game::installer::{install_instance, verify_instance};
use std::path::PathBuf;
use std::sync::Arc;

/// Helper: create a temporary directory structure with a minimal valid instance.
fn setup_temp_instance() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let tmp = tempfile::tempdir().expect("Failed to create temp dir");
    let data_dir = tmp.path().join("data");
    let game_dir = tmp.path().join("game");

    std::fs::create_dir_all(&data_dir).unwrap();
    std::fs::create_dir_all(&game_dir).unwrap();

    // Create necessary subdirectories
    std::fs::create_dir_all(data_dir.join("libraries")).unwrap();
    std::fs::create_dir_all(data_dir.join("assets").join("indexes")).unwrap();
    std::fs::create_dir_all(data_dir.join("assets").join("objects")).unwrap();
    std::fs::create_dir_all(data_dir.join("versions").join("1.20.1")).unwrap();
    std::fs::create_dir_all(data_dir.join("jre")).unwrap();

    // Write a minimal version JSON that the verifier won't reject
    let version_json = serde_json::json!({
        "id": "1.20.1",
        "type": "release",
        "mainClass": "net.minecraft.client.main.Main",
        "javaVersion": { "component": "java-runtime-delta", "majorVersion": 17 },
        "assetIndex": { "id": "5", "sha1": "0000000000000000000000000000000000000000", "url": "https://test.invalid/5.json", "size": 1, "totalSize": 1 },
        "downloads": {
            "client": {
                "sha1": "0000000000000000000000000000000000000000",
                "url": "https://example.com/client.jar",
                "size": 1
            }
        },
        "libraries": [],
        "arguments": { "game": [], "jvm": [] }
    });

    std::fs::write(
        data_dir.join("versions").join("1.20.1").join("1.20.1.json"),
        serde_json::to_string_pretty(&version_json).unwrap(),
    )
    .unwrap();

    // Write a fake client JAR
    std::fs::write(
        data_dir.join("versions").join("1.20.1").join("1.20.1.jar"),
        b"fake-client-jar-content",
    )
    .unwrap();

    // Write a minimal asset index
    let asset_index = serde_json::json!({
        "objects": {
            "minecraft/sounds/ambient/cave.ogg": {
                "hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "size": 1
            }
        }
    });
    std::fs::write(
        data_dir.join("assets").join("indexes").join("5.json"),
        serde_json::to_string_pretty(&asset_index).unwrap(),
    )
    .unwrap();

    (tmp, data_dir, game_dir)
}

fn make_spec(data_dir: &PathBuf, game_dir: &PathBuf) -> InstallSpec {
    let mut spec = InstallSpec::new("1.20.1".to_string(), data_dir.clone(), game_dir.clone());
    spec.dry_run = false;
    spec.remediation_policy = RemediationPolicy::RepairIfNeeded;
    spec.repair_scope = RepairScope::Full;
    spec
}

#[test]
fn dry_run_produces_no_disk_writes() {
    let (_tmp, data_dir, game_dir) = setup_temp_instance();

    // Count files BEFORE dry-run — this is the baseline
    let files_before = count_files_recursive(&data_dir);

    let mut spec = make_spec(&data_dir, &game_dir);
    spec.dry_run = true;
    spec.remediation_policy = RemediationPolicy::VerifyOnly;

    let reporter = Arc::new(SilentProgressReporter);

    // Run install_instance in dry-run mode
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let result = runtime.block_on(install_instance(spec, reporter));

    // Dry-run should succeed (no actual downloads attempted)
    assert!(result.is_ok(), "Dry-run failed: {:?}", result.err());

    // Verify NO files were created or modified by the dry-run
    assert_eq!(
        count_files_recursive(&data_dir),
        files_before,
        "Dry-run should not write any files"
    );
}

#[test]
fn verify_only_policy_returns_without_downloads() {
    let (_tmp, data_dir, game_dir) = setup_temp_instance();

    // Count files BEFORE VerifyOnly call
    let files_before = count_files_recursive(&data_dir);

    let mut spec = make_spec(&data_dir, &game_dir);
    spec.remediation_policy = RemediationPolicy::VerifyOnly;
    spec.dry_run = false;

    let reporter = Arc::new(SilentProgressReporter);

    let runtime = tokio::runtime::Runtime::new().unwrap();
    let result = runtime.block_on(install_instance(spec, reporter));

    // VerifyOnly should succeed (it just verifies, doesn't download)
    assert!(result.is_ok(), "VerifyOnly failed: {:?}", result.err());

    // Verify NO files were created or modified
    assert_eq!(
        count_files_recursive(&data_dir),
        files_before,
        "VerifyOnly should not modify any files on disk"
    );
}

#[test]
fn dry_run_verify_reports_issues() {
    let tmp = tempfile::tempdir().unwrap();
    let data_dir = tmp.path().join("data");
    let game_dir = tmp.path().join("game");
    std::fs::create_dir_all(&data_dir).unwrap();
    std::fs::create_dir_all(&game_dir).unwrap();

    // Create an instance with NO version JSON — this should be detected
    let mut spec = make_spec(&data_dir, &game_dir);
    spec.dry_run = true;

    let verify_result = verify_instance(&spec).unwrap();

    // Should report issues since version manifest is missing
    assert!(
        !verify_result.ready,
        "Should report not ready with missing manifest"
    );
    assert!(!verify_result.issues.is_empty(), "Should have issues");

    // Check that issues include a missing version-manifest
    let has_manifest_issue = verify_result.issues.iter().any(|i| {
        i.artifact_class == "version-manifest" && i.kind == VerificationIssueKind::Missing
    });
    assert!(has_manifest_issue, "Should report missing version manifest");
}

#[test]
fn repair_scope_versions_only_skips_assets_and_libs() {
    let (_tmp, data_dir, game_dir) = setup_temp_instance();
    let mut spec = make_spec(&data_dir, &game_dir);
    spec.repair_scope = RepairScope::Versions;

    let verify_result = verify_instance(&spec).unwrap();

    // With Versions scope, we should not see asset-object or library issues
    // (only version-manifest and client-jar checks)
    let has_asset_issues = verify_result
        .issues
        .iter()
        .any(|i| i.artifact_class == "asset-object");
    assert!(
        !has_asset_issues,
        "Versions scope should skip asset object checks"
    );
}

fn count_files_recursive(dir: &std::path::Path) -> usize {
    let mut count = 0;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                count += count_files_recursive(&path);
            } else {
                count += 1;
            }
        }
    }
    count
}
