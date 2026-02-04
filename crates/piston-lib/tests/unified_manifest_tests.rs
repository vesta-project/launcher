use piston_lib::game::launcher::unified_manifest::UnifiedManifest;
use piston_lib::game::launcher::version_parser::{VersionManifest, Library, LibraryDownloads, Artifact};
use piston_lib::game::installer::types::OsType;

#[test]
fn test_library_deduplication_with_natives() {
    let manifest = VersionManifest {
        id: "test".to_string(),
        main_class: Some("Main".to_string()),
        libraries: vec![
            Library {
                name: "org.lwjgl:lwjgl:3.3.1".to_string(),
                downloads: Some(LibraryDownloads {
                    artifact: Some(Artifact {
                        path: Some("org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar".to_string()),
                        sha1: Some("abc".to_string()),
                        size: Some(100),
                        url: Some("http://example.com/lwjgl.jar".to_string()),
                    }),
                    ..Default::default()
                }),
                ..Default::default()
            },
            Library {
                name: "org.lwjgl:lwjgl:3.3.1:natives-windows".to_string(),
                downloads: Some(LibraryDownloads {
                    artifact: Some(Artifact {
                        path: Some("org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-windows.jar".to_string()),
                        sha1: Some("def".to_string()),
                        size: Some(50),
                        url: Some("http://example.com/lwjgl-natives.jar".to_string()),
                    }),
                    ..Default::default()
                }),
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let unified = UnifiedManifest::merge(manifest, None, OsType::Windows);
    
    // Check that we have both libraries because they have different keys
    let lwjgl_main = unified.libraries.iter().find(|l| l.name == "org.lwjgl:lwjgl:3.3.1");
    let lwjgl_native = unified.libraries.iter().find(|l| l.name == "org.lwjgl:lwjgl:3.3.1:natives-windows");

    assert!(lwjgl_main.is_some(), "Main LWJGL library should be present");
    assert!(lwjgl_native.is_some(), "Native LWJGL library should be present");
    
    assert_ne!(lwjgl_main.unwrap().path, lwjgl_native.unwrap().path);
}

#[test]
fn test_library_resolution_with_rules() {
    let manifest = VersionManifest {
        id: "test".to_string(),
        main_class: Some("Main".to_string()),
        libraries: vec![
            Library {
                name: "os:specific:1.0".to_string(),
                downloads: Some(LibraryDownloads {
                    artifact: Some(Artifact {
                        path: Some("os/specific/1.0/os-specific-1.0.jar".to_string()),
                        sha1: Some("abc".to_string()),
                        size: Some(100),
                        url: Some("http://example.com/os.jar".to_string()),
                    }),
                    ..Default::default()
                }),
                rules: Some(vec![
                    serde_json::from_value(serde_json::json!({
                        "action": "allow",
                        "os": { "name": "windows" }
                    })).unwrap()
                ]),
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let unified_win = UnifiedManifest::merge(manifest.clone(), None, OsType::Windows);
    let unified_mac = UnifiedManifest::merge(manifest.clone(), None, OsType::MacOS);

    assert_eq!(unified_win.libraries.len(), 1);
    assert_eq!(unified_mac.libraries.len(), 0);
}

#[test]
fn test_arch_rule_matching() {
    let manifest = VersionManifest {
        id: "test".to_string(),
        main_class: Some("Main".to_string()),
        libraries: vec![
            Library {
                name: "arch:specific:1.0".to_string(),
                downloads: Some(LibraryDownloads {
                    artifact: Some(Artifact {
                        path: Some("arch/specific/1.0/arch-specific-1.0.jar".to_string()),
                        sha1: Some("abc".to_string()),
                        size: Some(100),
                        url: Some("http://example.com/arch.jar".to_string()),
                    }),
                    ..Default::default()
                }),
                rules: Some(vec![
                    serde_json::from_value(serde_json::json!({
                        "action": "allow",
                        "os": { "arch": "x86" }
                    })).unwrap()
                ]),
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    // This should NOT match on most modern machines (which are x64)
    let unified = UnifiedManifest::merge(manifest.clone(), None, OsType::Windows);
    assert_eq!(unified.libraries.len(), 0, "Library with x86 rule should not match on x64 host");

    // This SHOULD match on most modern machines
    let mut manifest_x64 = manifest.clone();
    manifest_x64.libraries[0].rules.as_mut().unwrap()[0] = serde_json::from_value(serde_json::json!({
        "action": "allow",
        "os": { "arch": "x64" }
    })).unwrap();

    let unified_x64 = UnifiedManifest::merge(manifest_x64, None, OsType::Windows);
    assert_eq!(unified_x64.libraries.len(), 1, "Library with x64 rule should match on x86_64 host");
}


