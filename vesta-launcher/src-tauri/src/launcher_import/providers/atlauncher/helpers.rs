use std::path::{Path, PathBuf};

use base64::{engine::general_purpose, Engine as _};

use crate::launcher_import::root_normalization::strip_known_suffixes;

use super::types::{ATInstance, ATLauncherData, ATLauncherSourceLink, ATResourceHint};

pub(super) fn encode_png_as_data_url(path: &Path) -> Option<String> {
    if !path.exists() || !path.is_file() {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let encoded = general_purpose::STANDARD.encode(bytes);
    Some(format!("data:image/png;base64,{encoded}"))
}

pub(super) fn extract_instance_link(instance: &ATInstance) -> Option<ATLauncherSourceLink> {
    extract_launcher_link(&instance.launcher)
}

pub fn resolve_launcher_root(base_path: &Path) -> PathBuf {
    strip_known_suffixes(base_path, &["instances", "data", "java", "contents"])
}

pub fn resolve_instances_root(launcher_root: &Path) -> PathBuf {
    let candidates = [
        launcher_root.join("Contents/Java/instances"),
        launcher_root.join("Data/instances"),
        launcher_root.join("instances"),
        launcher_root.to_path_buf(),
    ];

    candidates
        .into_iter()
        .find(|candidate| candidate.is_dir())
        .unwrap_or_else(|| launcher_root.to_path_buf())
}

pub fn extract_atlauncher_resource_hints(instance_root: &Path) -> Vec<ATResourceHint> {
    let cfg_path = if instance_root.is_file() {
        instance_root.to_path_buf()
    } else {
        instance_root.join("instance.json")
    };
    let Ok(raw) = std::fs::read_to_string(cfg_path) else {
        log::debug!(
            "[ATLauncher] extract_atlauncher_resource_hints: instance.json not found at {}",
            instance_root.display()
        );
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<ATInstance>(&raw) else {
        log::warn!(
            "[ATLauncher] extract_atlauncher_resource_hints: failed to parse instance.json at {}",
            instance_root.display()
        );
        return Vec::new();
    };

    let launcher = &parsed.launcher;

    if let (Some(project), Some(version)) = (&launcher.modrinth_project, &launcher.modrinth_version)
    {
        log::debug!(
            "[ATLauncher] extracted modrinth hint: {}/{}",
            project.id,
            version.id
        );
        return vec![ATResourceHint {
            project_id: project.id.clone(),
            version_id: version.id.clone(),
            platform: "modrinth".to_string(),
            file_name: version.file_name.clone(),
        }];
    }

    if let (Some(project), Some(version)) =
        (&launcher.curseforge_project, &launcher.curseforge_file)
    {
        log::debug!(
            "[ATLauncher] extracted curseforge hint: {}/{}",
            project.id,
            version.id
        );
        return vec![ATResourceHint {
            project_id: project.id.clone(),
            version_id: version.id.clone(),
            platform: "curseforge".to_string(),
            file_name: version.file_name.clone(),
        }];
    }

    Vec::new()
}

pub(super) fn extract_launcher_link(launcher: &ATLauncherData) -> Option<ATLauncherSourceLink> {
    if let (Some(project), Some(version)) = (&launcher.modrinth_project, &launcher.modrinth_version)
    {
        return Some(ATLauncherSourceLink::Modrinth {
            project_id: project.id.clone(),
            version_id: version.id.clone(),
        });
    }

    if let (Some(project), Some(version)) =
        (&launcher.curseforge_project, &launcher.curseforge_file)
    {
        return Some(ATLauncherSourceLink::Curseforge {
            project_id: project.id.clone(),
            version_id: version.id.clone(),
        });
    }

    None
}

#[cfg(test)]
mod tests {
    use super::{
        extract_atlauncher_resource_hints, extract_instance_link, extract_launcher_link,
        resolve_instances_root,
    };
    use crate::launcher_import::providers::atlauncher::types::{
        ATInstance, ATLauncherData, ATLauncherSourceLink, ATPackProject, ATPackVersion,
    };
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn modrinth_launcher() -> ATLauncherData {
        ATLauncherData {
            name: "Pack".to_string(),
            loader_version: None,
            modrinth_project: Some(ATPackProject {
                id: "project-1".to_string(),
            }),
            modrinth_version: Some(ATPackVersion {
                id: "version-1".to_string(),
                file_name: Some("pack.zip".to_string()),
            }),
            curseforge_project: None,
            curseforge_file: None,
        }
    }

    fn curseforge_launcher() -> ATLauncherData {
        ATLauncherData {
            name: "Pack".to_string(),
            loader_version: None,
            modrinth_project: None,
            modrinth_version: None,
            curseforge_project: Some(ATPackProject {
                id: "885460".to_string(),
            }),
            curseforge_file: Some(ATPackVersion {
                id: "7870055".to_string(),
                file_name: Some("All of Create 1.21.1-v1.7.zip".to_string()),
            }),
        }
    }

    fn write_instance_json(content: &str) -> NamedTempFile {
        let mut file = NamedTempFile::new().expect("temp file");
        write!(file, "{content}").expect("write temp file");
        file
    }

    #[test]
    fn resolves_nested_atlauncher_instance_roots_before_parent_directory() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let launcher_root = temp_dir.path().join("ATLauncher");
        let nested_instances = launcher_root.join("Data/instances");
        std::fs::create_dir_all(&nested_instances).expect("create nested instances");

        let resolved = resolve_instances_root(&launcher_root);
        assert_eq!(resolved, nested_instances);
    }

    #[test]
    fn extracts_modrinth_link_when_present() {
        let link = extract_launcher_link(&modrinth_launcher()).unwrap();
        assert_eq!(
            link,
            ATLauncherSourceLink::Modrinth {
                project_id: "project-1".to_string(),
                version_id: "version-1".to_string(),
            }
        );
    }

    #[test]
    fn extracts_curseforge_link_when_present() {
        let link = extract_launcher_link(&curseforge_launcher()).unwrap();
        assert_eq!(
            link,
            ATLauncherSourceLink::Curseforge {
                project_id: "885460".to_string(),
                version_id: "7870055".to_string(),
            }
        );
    }

    #[test]
    fn returns_none_for_unsupported_source() {
        let launcher = ATLauncherData {
            name: "Pack".to_string(),
            loader_version: None,
            modrinth_project: None,
            modrinth_version: None,
            curseforge_project: None,
            curseforge_file: None,
        };

        assert!(extract_launcher_link(&launcher).is_none());
    }

    #[test]
    fn instance_link_prefers_supported_data() {
        let instance = ATInstance {
            id: "1.21.1".to_string(),
            launcher: modrinth_launcher(),
        };

        assert!(matches!(
            extract_instance_link(&instance),
            Some(ATLauncherSourceLink::Modrinth { .. })
        ));
    }

    #[test]
    fn parses_modrinth_instance_json_with_real_field_names() {
        let file = write_instance_json(
            r#"{
                "id": "1.21.1",
                "launcher": {
                    "name": "Fabulously Optimized",
                    "loaderVersion": { "type": "Fabric", "version": "0.16.7" },
                    "modrinthProject": { "id": "mr-pack" },
                    "modrinthVersion": { "id": "mr-version", "fileName": "pack.zip" }
                }
            }"#,
        );
        let raw = std::fs::read_to_string(file.path()).expect("read temp file");
        let parsed: ATInstance = serde_json::from_str(&raw).expect("parse instance json");

        assert_eq!(parsed.id, "1.21.1");
        assert_eq!(parsed.launcher.name, "Fabulously Optimized");
        assert!(matches!(
            extract_instance_link(&parsed),
            Some(ATLauncherSourceLink::Modrinth { project_id, version_id }) if project_id == "mr-pack" && version_id == "mr-version"
        ));
        assert_eq!(extract_atlauncher_resource_hints(file.path()).len(), 1);
    }

    #[test]
    fn parses_curseforge_instance_json_with_real_field_names() {
        let file = write_instance_json(
            r#"{
                "id": "1.21.1",
                "launcher": {
                    "name": "All of Create",
                    "loaderVersion": { "type": "NeoForge", "version": "21.1.221" },
                    "curseForgeProject": { "id": "885460" },
                    "curseForgeFile": { "id": "7870055", "fileName": "All of Create 1.21.1-v1.7.zip" }
                }
            }"#,
        );
        let raw = std::fs::read_to_string(file.path()).expect("read temp file");
        let parsed: ATInstance = serde_json::from_str(&raw).expect("parse instance json");

        assert_eq!(parsed.launcher.name, "All of Create");
        assert!(matches!(
            extract_instance_link(&parsed),
            Some(ATLauncherSourceLink::Curseforge { project_id, version_id }) if project_id == "885460" && version_id == "7870055"
        ));
        let hints = extract_atlauncher_resource_hints(file.path());
        assert_eq!(hints.len(), 1);
        assert_eq!(hints[0].platform, "curseforge");
        assert_eq!(hints[0].project_id, "885460");
        assert_eq!(hints[0].version_id, "7870055");
    }

    #[test]
    fn unsupported_source_does_not_create_link_or_hints() {
        let file = write_instance_json(
            r#"{
                "id": "1.7.10",
                "launcher": {
                    "name": "Minecraft SKY (Official)",
                    "loaderVersion": { "type": "Forge", "version": "1.7.10-10.13.4.1558-1.7.10" }
                }
            }"#,
        );
        let raw = std::fs::read_to_string(file.path()).expect("read temp file");
        let parsed: ATInstance = serde_json::from_str(&raw).expect("parse instance json");

        assert!(extract_instance_link(&parsed).is_none());
        assert!(extract_atlauncher_resource_hints(file.path()).is_empty());
    }

    #[test]
    fn parses_curseforge_numeric_id() {
        let file = write_instance_json(
            r#"{
                "id": "1.21.1",
                "launcher": {
                    "name": "All of Create",
                    "loaderVersion": { "type": "NeoForge", "version": "21.1.221" },
                    "curseForgeProject": { "id": 885460 },
                    "curseForgeFile": { "id": 7870055, "fileName": "All of Create 1.21.1-v1.7.zip" }
                }
            }"#,
        );
        let raw = std::fs::read_to_string(file.path()).expect("read temp file");
        let parsed: ATInstance =
            serde_json::from_str(&raw).expect("parse instance json with numeric ids");

        assert!(matches!(
            extract_instance_link(&parsed),
            Some(ATLauncherSourceLink::Curseforge { project_id, version_id }) if project_id == "885460" && version_id == "7870055"
        ));
        let hints = extract_atlauncher_resource_hints(file.path());
        assert_eq!(hints.len(), 1);
        assert_eq!(hints[0].project_id, "885460");
        assert_eq!(hints[0].version_id, "7870055");
    }
}
