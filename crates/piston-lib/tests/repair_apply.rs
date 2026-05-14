/// Integration tests for repair application.
/// Simulates corrupt/missing files and verifies the verifier detects them correctly.
use piston_lib::game::installer::types::{
    InstallSpec, RemediationPolicy, RepairScope, VerificationIssueKind,
};
use piston_lib::game::installer::verify_instance;
use std::path::PathBuf;

fn make_spec(data_dir: &PathBuf, game_dir: &PathBuf) -> InstallSpec {
    let mut spec = InstallSpec::new("1.20.1".to_string(), data_dir.clone(), game_dir.clone());
    spec.remediation_policy = RemediationPolicy::RepairIfNeeded;
    spec.repair_scope = RepairScope::Full;
    spec
}

/// Write a minimal valid version.json that parses correctly.
fn write_version_json(versions_dir: &PathBuf, libraries: Vec<serde_json::Value>) {
    std::fs::create_dir_all(versions_dir).unwrap();
    let json = serde_json::json!({
        "id": "1.20.1",
        "type": "release",
        "mainClass": "net.minecraft.client.main.Main",
        "javaVersion": { "component": "java-runtime-delta", "majorVersion": 17 },
        "assetIndex": { "id": "5", "sha1": "0000000000000000000000000000000000000000", "url": "https://test.invalid/5.json", "size": 1, "totalSize": 1 },
        "downloads": {
            "client": { "sha1": "0000000000000000000000000000000000000000", "url": "https://test.invalid/client.jar", "size": 1 }
        },
        "libraries": libraries,
        "arguments": { "game": [], "jvm": [] }
    });
    std::fs::write(
        versions_dir.join("1.20.1.json"),
        serde_json::to_string_pretty(&json).unwrap(),
    )
    .unwrap();
}

#[test]
fn verify_reports_missing_version_json() {
    let tmp = tempfile::tempdir().unwrap();
    let data_dir = tmp.path().join("data");
    let game_dir = tmp.path().join("game");
    std::fs::create_dir_all(&data_dir).unwrap();
    std::fs::create_dir_all(&game_dir).unwrap();

    let spec = make_spec(&data_dir, &game_dir);
    let result = verify_instance(&spec).unwrap();

    assert!(!result.ready, "Should be not ready without version JSON");
    assert!(
        result
            .issues
            .iter()
            .any(|i| i.artifact_class == "version-manifest"
                && i.kind == VerificationIssueKind::Missing),
        "Should detect missing version manifest"
    );
}

#[test]
fn verify_reports_missing_client_jar() {
    let tmp = tempfile::tempdir().unwrap();
    let data_dir = tmp.path().join("data");
    let game_dir = tmp.path().join("game");
    std::fs::create_dir_all(&data_dir).unwrap();
    std::fs::create_dir_all(&game_dir).unwrap();

    let versions_dir = data_dir.join("versions").join("1.20.1");
    write_version_json(&versions_dir, vec![]);
    // Intentionally do NOT write the client JAR

    let spec = make_spec(&data_dir, &game_dir);
    let result = verify_instance(&spec).unwrap();

    assert!(!result.ready, "Should be not ready without client JAR");
    assert!(
        result
            .issues
            .iter()
            .any(|i| i.artifact_class == "client-jar" && i.kind == VerificationIssueKind::Missing),
        "Should detect missing client JAR, got: {:?}",
        result
            .issues
            .iter()
            .map(|i| &i.artifact_class)
            .collect::<Vec<_>>()
    );
}

#[test]
fn verify_reports_missing_asset_index() {
    let tmp = tempfile::tempdir().unwrap();
    let data_dir = tmp.path().join("data");
    let game_dir = tmp.path().join("game");
    std::fs::create_dir_all(&data_dir).unwrap();
    std::fs::create_dir_all(&game_dir).unwrap();

    let versions_dir = data_dir.join("versions").join("1.20.1");
    write_version_json(&versions_dir, vec![]);
    // Write client JAR so that check passes
    std::fs::write(versions_dir.join("1.20.1.jar"), b"fake-jar").unwrap();
    // Intentionally do NOT write the asset index

    let spec = make_spec(&data_dir, &game_dir);
    let result = verify_instance(&spec).unwrap();

    assert!(!result.ready, "Should be not ready without asset index");
    assert!(
        result
            .issues
            .iter()
            .any(|i| i.artifact_class == "asset-index" && i.kind == VerificationIssueKind::Missing),
        "Should detect missing asset index, got: {:?}",
        result
            .issues
            .iter()
            .map(|i| &i.artifact_class)
            .collect::<Vec<_>>()
    );
}

#[test]
fn verify_reports_missing_library() {
    let tmp = tempfile::tempdir().unwrap();
    let data_dir = tmp.path().join("data");
    let game_dir = tmp.path().join("game");
    std::fs::create_dir_all(&data_dir).unwrap();
    std::fs::create_dir_all(&game_dir).unwrap();

    let versions_dir = data_dir.join("versions").join("1.20.1");
    let lib = serde_json::json!({
        "name": "com.example:test-lib:1.0",
        "downloads": {
            "artifact": {
                "path": "com/example/test-lib/1.0/test-lib-1.0.jar",
                "sha1": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "url": "https://test.invalid/lib.jar",
                "size": 100
            }
        }
    });
    write_version_json(&versions_dir, vec![lib]);
    std::fs::write(versions_dir.join("1.20.1.jar"), b"fake-jar").unwrap();
    // Write asset index so that check passes
    let indexes_dir = data_dir.join("assets").join("indexes");
    std::fs::create_dir_all(&indexes_dir).unwrap();
    std::fs::write(indexes_dir.join("5.json"), "{\"objects\":{}}").unwrap();
    // Intentionally do NOT write the library file

    let spec = make_spec(&data_dir, &game_dir);
    let result = verify_instance(&spec).unwrap();

    assert!(!result.ready, "Should be not ready with missing library");
    assert!(
        result
            .issues
            .iter()
            .any(|i| i.artifact_class == "library" && i.kind == VerificationIssueKind::Missing),
        "Should detect missing library, got: {:?}",
        result
            .issues
            .iter()
            .map(|i| format!("{}:{:?}", i.artifact_class, i.kind))
            .collect::<Vec<_>>()
    );
}

#[test]
fn verify_reports_corrupt_library_sha1() {
    let tmp = tempfile::tempdir().unwrap();
    let data_dir = tmp.path().join("data");
    let game_dir = tmp.path().join("game");
    std::fs::create_dir_all(&data_dir).unwrap();
    std::fs::create_dir_all(&game_dir).unwrap();

    let versions_dir = data_dir.join("versions").join("1.20.1");
    let lib = serde_json::json!({
        "name": "com.example:test-lib:1.0",
        "downloads": {
            "artifact": {
                "path": "com/example/test-lib/1.0/test-lib-1.0.jar",
                "sha1": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "url": "https://test.invalid/lib.jar",
                "size": 100
            }
        }
    });
    write_version_json(&versions_dir, vec![lib]);
    std::fs::write(versions_dir.join("1.20.1.jar"), b"fake-jar").unwrap();
    let indexes_dir = data_dir.join("assets").join("indexes");
    std::fs::create_dir_all(&indexes_dir).unwrap();
    std::fs::write(indexes_dir.join("5.json"), "{\"objects\":{}}").unwrap();

    // Write the library with WRONG content (will have wrong SHA1)
    let lib_path = data_dir
        .join("libraries")
        .join("com/example/test-lib/1.0/test-lib-1.0.jar");
    std::fs::create_dir_all(lib_path.parent().unwrap()).unwrap();
    std::fs::write(&lib_path, b"this-is-corrupted-content-with-wrong-sha1").unwrap();

    let spec = make_spec(&data_dir, &game_dir);
    let result = verify_instance(&spec).unwrap();

    assert!(!result.ready, "Should be not ready with corrupt library");
    assert!(
        result
            .issues
            .iter()
            .any(|i| i.kind == VerificationIssueKind::Mismatch && i.artifact_class == "library"),
        "Should detect library SHA1 mismatch, got: {:?}",
        result
            .issues
            .iter()
            .map(|i| format!("{}:{:?}", i.artifact_class, i.kind))
            .collect::<Vec<_>>()
    );
}

#[test]
fn verify_idempotent_on_consistent_instance() {
    let tmp = tempfile::tempdir().unwrap();
    let data_dir = tmp.path().join("data");
    let game_dir = tmp.path().join("game");
    std::fs::create_dir_all(&data_dir).unwrap();
    std::fs::create_dir_all(&game_dir).unwrap();

    let versions_dir = data_dir.join("versions").join("1.20.1");
    write_version_json(&versions_dir, vec![]);
    std::fs::write(versions_dir.join("1.20.1.jar"), b"fake-jar").unwrap();
    let indexes_dir = data_dir.join("assets").join("indexes");
    std::fs::create_dir_all(&indexes_dir).unwrap();
    std::fs::write(indexes_dir.join("5.json"), "{\"objects\":{}}").unwrap();

    let spec = make_spec(&data_dir, &game_dir);

    let result1 = verify_instance(&spec).unwrap();
    let result2 = verify_instance(&spec).unwrap();

    // Verify the instance is actually healthy
    assert!(result1.ready, "Instance should be fully verified");
    assert!(
        result1.issues.is_empty(),
        "Instance should have no issues, got: {:?}",
        result1.issues
    );
    // And that verification is idempotent
    assert_eq!(result1.ready, result2.ready);
    assert_eq!(result1.checked, result2.checked);
    assert_eq!(result1.issues.len(), result2.issues.len());
}

#[test]
fn repair_scope_libraries_does_not_flag_version_issues() {
    let tmp = tempfile::tempdir().unwrap();
    let data_dir = tmp.path().join("data");
    let game_dir = tmp.path().join("game");
    std::fs::create_dir_all(&data_dir).unwrap();
    std::fs::create_dir_all(&game_dir).unwrap();

    let versions_dir = data_dir.join("versions").join("1.20.1");
    let lib = serde_json::json!({
        "name": "com.example:test-lib:1.0",
        "downloads": {
            "artifact": {
                "path": "com/example/test-lib/1.0/test-lib-1.0.jar",
                "sha1": "cccccccccccccccccccccccccccccccccccccccc",
                "url": "https://test.invalid/lib.jar",
                "size": 100
            }
        }
    });
    write_version_json(&versions_dir, vec![lib]);
    std::fs::write(versions_dir.join("1.20.1.jar"), b"fake-jar").unwrap();
    let indexes_dir = data_dir.join("assets").join("indexes");
    std::fs::create_dir_all(&indexes_dir).unwrap();
    std::fs::write(indexes_dir.join("5.json"), "{\"objects\":{}}").unwrap();
    // Intentionally do NOT write the library file

    let mut spec = make_spec(&data_dir, &game_dir);
    spec.repair_scope = RepairScope::Libraries;

    let result = verify_instance(&spec).unwrap();

    // With Libraries scope, should detect missing library
    assert!(
        !result.ready,
        "Libraries scope should detect missing library"
    );
    // Should NOT have version-manifest, client-jar, or asset-index issues
    assert!(
        !result
            .issues
            .iter()
            .any(|i| i.artifact_class == "version-manifest"),
        "Libraries scope should not flag version-manifest"
    );
    assert!(
        !result
            .issues
            .iter()
            .any(|i| i.artifact_class == "client-jar"),
        "Libraries scope should not flag client-jar"
    );
    assert!(
        !result
            .issues
            .iter()
            .any(|i| i.artifact_class == "asset-index"),
        "Libraries scope should not flag asset-index"
    );
}

#[test]
fn verify_reports_missing_asset_objects() {
    let tmp = tempfile::tempdir().unwrap();
    let data_dir = tmp.path().join("data");
    let game_dir = tmp.path().join("game");
    std::fs::create_dir_all(&data_dir).unwrap();
    std::fs::create_dir_all(&game_dir).unwrap();

    let versions_dir = data_dir.join("versions").join("1.20.1");
    write_version_json(&versions_dir, vec![]);
    std::fs::write(versions_dir.join("1.20.1.jar"), b"fake-jar").unwrap();

    // Write asset index with objects that don't exist on disk
    let indexes_dir = data_dir.join("assets").join("indexes");
    std::fs::create_dir_all(&indexes_dir).unwrap();
    let asset_index = serde_json::json!({
        "objects": {
            "minecraft/sounds/test1.ogg": {
                "hash": "cccccccccccccccccccccccccccccccccccccccc",
                "size": 100
            },
            "minecraft/sounds/test2.ogg": {
                "hash": "dddddddddddddddddddddddddddddddddddddddd",
                "size": 200
            }
        }
    });
    std::fs::write(
        indexes_dir.join("5.json"),
        serde_json::to_string_pretty(&asset_index).unwrap(),
    )
    .unwrap();

    let spec = make_spec(&data_dir, &game_dir);
    let result = verify_instance(&spec).unwrap();

    // Should detect missing asset objects
    assert!(
        !result.ready,
        "Should be not ready with missing asset objects"
    );
    assert!(
        result
            .issues
            .iter()
            .any(|i| i.artifact_class == "asset-object"),
        "Should have asset-object issues, got: {:?}",
        result
            .issues
            .iter()
            .map(|i| &i.artifact_class)
            .collect::<Vec<_>>()
    );
}
