use crate::game::launcher::classpath::OsType;
use anyhow::Result;
use std::path::Path;

/// Convert OsType to the canonical name used in manifests/rules
pub(crate) fn os_name(os: &OsType) -> &'static str {
    match os {
        OsType::Windows => "windows",
        OsType::Linux => "linux",
        OsType::MacOS => "osx",
    }
}

/// Get arch bits used in manifest templates like ${arch}
pub(crate) fn arch_bits(os: &OsType) -> &'static str {
    match os {
        OsType::Windows => "64",
        OsType::MacOS => "64",
        OsType::Linux => "64",
    }
}

/// Permissive classifier-key match: checks if classifier key references the OS name
pub(crate) fn classifier_key_matches_os(key: &str, os_name: &str) -> bool {
    let key_lower = key.to_lowercase();
    if key_lower.contains(os_name) {
        return true;
    }

    // Permissive mapping: treat "osx"/"macos" as interchangeable
    if os_name == "osx" && key_lower.contains("macos") {
        return true;
    }

    false
}

/// Resolve a classifier string from a library's natives or classifiers metadata.
/// This does not check the presence of any local files; it only computes a candidate
/// classifier string (with ${arch} replaced) suitable for downloading the artifact.
/// Resolve the classifier string, given an OS name (like "windows", "linux", "osx") and
/// arch ("32"/"64").
pub(crate) fn resolve_classifier_string<T>(
    _lib_name: &str,
    natives: Option<&std::collections::HashMap<String, String>>,
    classifiers: Option<&std::collections::HashMap<String, T>>,
    os_name: &str,
    arch: &str,
) -> Option<String> {
    // 1. Try natives[os]
    if let Some(natives) = natives {
        if let Some(v) = natives.get(os_name) {
            return Some(v.replace("${arch}", arch));
        }

        if let Some(v) = natives.get("natives") {
            return Some(v.replace("${arch}", arch));
        }
    }

    // 2. Try classifiers keys that look like they match OS
    if let Some(classifiers) = classifiers {
        for key in classifiers.keys() {
            if classifier_key_matches_os(key, os_name) {
                return Some(key.replace("${arch}", arch));
            }
        }
    }

    None
}

/// Find a classifier JAR on disk for a library and OS by scanning possible candidates.
/// Returns (classifier_string, path_to_jar) if found.
pub(crate) fn find_classifier_jar_on_disk<T>(
    lib_name: &str,
    natives: Option<&std::collections::HashMap<String, String>>,
    classifiers: Option<&std::collections::HashMap<String, T>>,
    os_name: &str,
    arch: &str,
    libraries_dir: &Path,
) -> Result<Option<(String, std::path::PathBuf)>> {
    // Helper closure for building jar path
    let build = |classifier: &str| -> Option<std::path::PathBuf> {
        let coords = format!("{}:{}", lib_name, classifier);
        if let Ok(p) = crate::game::launcher::classpath::maven_to_path(&coords) {
            return Some(libraries_dir.join(p));
        }
        None
    };

    // 1. Use resolve_classifier_string first
    if let Some(candidate) =
        resolve_classifier_string(lib_name, natives, classifiers, os_name, arch)
    {
        if let Some(path) = build(&candidate) {
            if path.exists() {
                return Ok(Some((candidate, path)));
            }
        }
    }

    // 2. Scan classifiers map and look for OS-matching keys
    if let Some(classifiers) = classifiers {
        for key in classifiers.keys() {
            if classifier_key_matches_os(key, os_name) {
                let candidate = key.replace("${arch}", arch);
                if let Some(path) = build(&candidate) {
                    if path.exists() {
                        return Ok(Some((candidate, path)));
                    }
                }
            }
        }
    }

    // 3. Finally try all natives values with ${arch} replaced
    if let Some(natives) = natives {
        for val in natives.values() {
            let candidate = val.replace("${arch}", arch);
            if let Some(path) = build(&candidate) {
                if path.exists() {
                    return Ok(Some((candidate, path)));
                }
            }
        }
    }

    Ok(None)
}

/// Determine whether a given library has native artifacts for the supplied OS name
pub(crate) fn library_has_natives_for_os(
    library: &crate::game::launcher::version_parser::Library,
    os_name: &str,
) -> bool {
    if let Some(natives) = &library.natives {
        if natives.contains_key(os_name) || natives.contains_key("natives") {
            return true;
        }

        // If any natives values look like they target this OS, consider it a match
        for val in natives.values() {
            if classifier_key_matches_os(val, os_name) {
                return true;
            }
        }
    }

    if let Some(downloads) = &library.downloads {
        if let Some(classifiers) = &downloads.classifiers {
            for key in classifiers.keys() {
                if classifier_key_matches_os(key, os_name) {
                    return true;
                }
            }
        }
    }

    false
}

/// Check whether any library in the manifest includes native artifacts for the given OS
pub(crate) fn manifest_has_natives_for_os(
    manifest: &crate::game::launcher::version_parser::VersionManifest,
    os_name: &str,
) -> bool {
    for lib in &manifest.libraries {
        if library_has_natives_for_os(lib, os_name) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_matching() {
        assert!(classifier_key_matches_os("natives-windows-64", "windows"));
        assert!(classifier_key_matches_os("natives-windows", "windows"));
        assert!(classifier_key_matches_os("natives-osx", "osx"));
        assert!(classifier_key_matches_os("natives-macos", "osx"));
        assert!(!classifier_key_matches_os("something-else", "linux"));
    }

    #[test]
    fn test_manifest_has_natives_for_os() {
        use crate::game::launcher::version_parser::{
            Artifact, Library, LibraryDownloads, VersionManifest,
        };
        use std::collections::HashMap;

        // manifest with no libraries -> false
        let manifest = VersionManifest {
            id: "test".to_string(),
            main_class: None,
            inherits_from: None,
            arguments: None,
            minecraft_arguments: None,
            libraries: vec![],
            asset_index: None,
            assets: None,
            java_version: None,
            version_type: None,
            release_time: None,
            time: None,
        };

        assert!(!manifest_has_natives_for_os(&manifest, "windows"));

        // manifest with a library that has a classifier matching windows
        let mut classifiers = HashMap::new();
        classifiers.insert(
            "natives-windows-64".to_string(),
            Artifact {
                path: "".to_string()?,
                url: "".to_string()?,
                sha1: "".to_string()?,
                size: Some(0),
            },
        );

        let downloads = LibraryDownloads {
            artifact: None,
            classifiers: Some(classifiers),
        };

        let lib = Library {
            name: "com.example:lib:1.0".to_string(),
            downloads: Some(downloads),
            url: None,
            rules: None,
            natives: None,
            extract: None,
        };

        let manifest2 = VersionManifest {
            libraries: vec![lib],
            ..manifest
        };
        assert!(manifest_has_natives_for_os(&manifest2, "windows"));
    }
}
