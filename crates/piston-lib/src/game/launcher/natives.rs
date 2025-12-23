/// Native library extraction for Minecraft launcher
use crate::game::launcher::classpath::OsType;
use crate::game::launcher::version_parser::Library;
use anyhow::{Context, Result};
use std::env;
use std::path::Path;

/// Extract native libraries from JARs
pub async fn extract_natives(
    libraries: &[Library],
    libraries_dir: &Path,
    natives_dir: &Path,
    os: OsType,
) -> Result<()> {
    // Create natives directory
    tokio::fs::create_dir_all(natives_dir).await?;

    for library in libraries {
        // If there's no natives section and no classifier information at all, skip
        if library.natives.is_none()
            && library
                .downloads
                .as_ref()
                .and_then(|d| d.classifiers.as_ref())
                .is_none()
        {
            continue;
        }

        // Use shared classifier helper to find a classifier jar on disk

        // Helper: arch bits (32/64) based on host arch
        fn arch_bits() -> String {
            match env::consts::ARCH {
                "x86" | "i386" => "32".to_string(),
                "x86_64" | "aarch64" | "amd64" => "64".to_string(),
                "arm" | "armv7l" => "32".to_string(),
                _ => "64".to_string(),
            }
        }

        // Helper: permissive OS match for classifier keys (handles "osx" vs "macos")
        fn check_native_key(k: &str, os: OsType) -> bool {
            let key = k.to_lowercase();
            let os_name = os.as_str();

            if key.contains(os_name) {
                return true;
            }

            // Some manifests or classifier names may use "macos" while our OS name is "osx".
            // Be permissive and consider both forms equivalent.
            if os_name == "osx" && key.contains("macos") {
                return true;
            }

            false
        }

        // Helper to build a jar path from classifier candidate and test existence
        fn build_jar_path(
            libraries_dir: &Path,
            name: &str,
            classifier: &str,
        ) -> Option<std::path::PathBuf> {
            let coords = format!("{}:{}", name, classifier);
            if let Ok(p) = super::classpath::maven_to_path(&coords) {
                return Some(libraries_dir.join(p));
            }
            None
        }

        let arch = if cfg!(target_pointer_width = "32") {
            "32"
        } else {
            "64"
        };

        match crate::game::launcher::classifier::find_classifier_jar_on_disk(
            &library.name,
            library.natives.as_ref(),
            library
                .downloads
                .as_ref()
                .and_then(|d| d.classifiers.as_ref()),
            os.as_str(),
            arch,
            libraries_dir,
        )? {
            Some((classifier, path)) => {
                log::debug!(
                    "Resolved classifier '{}' -> {:?}",
                    classifier,
                    path.display()
                );
                extract_jar(&path, natives_dir, library).await?;
                continue;
            }
            None => {
                log::warn!(
                    "Native library not found for {} (no candidate found)",
                    library.name
                );
            }
        }
    }

    Ok(())
}

/// Extract a JAR file to a directory
async fn extract_jar(jar_path: &Path, output_dir: &Path, library: &Library) -> Result<()> {
    log::debug!("Extracting natives from: {:?}", jar_path);

    let file =
        std::fs::File::open(jar_path).context(format!("Failed to open JAR: {:?}", jar_path))?;

    let mut archive =
        zip::ZipArchive::new(file).context(format!("Failed to read JAR: {:?}", jar_path))?;

    // Get exclusion patterns
    let exclusions = library
        .extract
        .as_ref()
        .map(|e| &e.exclude)
        .map(|v| v.as_slice())
        .unwrap_or(&[]);

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let file_path = file.name();

        // Skip if excluded
        if should_exclude(file_path, exclusions) {
            continue;
        }

        // Skip directories
        if file.is_dir() {
            continue;
        }

        // Extract file
        let output_path = output_dir.join(file_path);

        // Create parent directories
        if let Some(parent) = output_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        // Write file
        let mut output_file = std::fs::File::create(&output_path)?;
        std::io::copy(&mut file, &mut output_file)?;
    }

    Ok(())
}

/// Check if a file should be excluded
fn should_exclude(file_path: &str, exclusions: &[String]) -> bool {
    for exclusion in exclusions {
        if file_path.starts_with(exclusion) {
            return true;
        }
    }
    false
}

/// Get the natives directory path for a version
pub fn get_natives_dir(data_dir: &Path, version_id: &str) -> std::path::PathBuf {
    data_dir.join("natives").join(version_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_exclude() {
        let exclusions = vec!["META-INF/".to_string(), "module-info.class".to_string()];

        assert!(should_exclude("META-INF/MANIFEST.MF", &exclusions));
        assert!(should_exclude("module-info.class", &exclusions));
        assert!(!should_exclude("org/lwjgl/Library.class", &exclusions));
    }

    #[test]
    fn test_get_natives_dir() {
        let data_dir = Path::new("/data");
        let natives_dir = get_natives_dir(data_dir, "1.8.9");

        assert_eq!(natives_dir, Path::new("/data/natives/1.8.9"));
    }

    // Async tests that operate on the filesystem to exercise extract_natives behaviour
    #[tokio::test]
    async fn test_extract_natives_replaces_arch_and_extracts() {
        use crate::game::launcher::version_parser::{ExtractRules, Library};
        use std::collections::HashMap;
        use std::io::Write;
        use tempfile::TempDir;

        let libs_tmp = TempDir::new().expect("tmpdir");
        let natives_tmp = TempDir::new().expect("tmpdir2");

        let libraries_dir = libs_tmp.path();
        let natives_dir = natives_tmp.path();

        // Create a fake library which references a templated classifier
        let mut natives_map = HashMap::new();
        natives_map.insert("windows".to_string(), "natives-windows-${arch}".to_string());

        let lib = Library {
            name: "com.example:libtest:1.0".to_string(),
            downloads: None,
            url: None,
            rules: None,
            natives: Some(natives_map),
            extract: Some(ExtractRules { exclude: vec![] }),
        };

        // Build the expected jar path using our classifier replacement (use 64-bit on test host)
        let arch = if cfg!(target_pointer_width = "32") {
            "32"
        } else {
            "64"
        };
        let coords = format!("{}:natives-windows-{}", lib.name, arch);
        let rel = crate::game::launcher::classpath::maven_to_path(&coords).unwrap();
        let full_path = libraries_dir.join(rel);

        // Create parent directories and a simple zip file with one entry
        if let Some(p) = full_path.parent() {
            std::fs::create_dir_all(p).unwrap();
        }

        {
            let f = std::fs::File::create(&full_path).unwrap();
            let mut zip = zip::ZipWriter::new(f);
            use zip::write::FileOptions;
            zip.start_file::<&str, ()>("native-file.bin", FileOptions::default())
                .unwrap();
            zip.write_all(b"hello").unwrap();
            zip.finish().unwrap();
        }

        // Ensure extraction succeeds
        extract_natives(&[lib], libraries_dir, natives_dir, OsType::Windows)
            .await
            .expect("extract failed");

        // Confirm the extracted file exists
        let extracted = natives_dir.join("native-file.bin");
        assert!(
            extracted.exists(),
            "Expected extracted native file to exist"
        );
    }

    #[tokio::test]
    async fn test_extract_natives_permissive_classifier_scan() {
        use crate::game::launcher::version_parser::{
            Artifact, ExtractRules, Library, LibraryDownloads,
        };
        use std::collections::HashMap;
        use std::io::Write;
        use tempfile::TempDir;

        let libs_tmp = TempDir::new().expect("tmpdir");
        let natives_tmp = TempDir::new().expect("tmpdir2");

        let libraries_dir = libs_tmp.path();
        let natives_dir = natives_tmp.path();

        // Library has no direct mapping for Windows in natives, but downloads.classifiers has a key matching windows
        let natives_map: HashMap<String, String> = HashMap::new();

        let mut classifiers = HashMap::new();
        classifiers.insert(
            "natives-windows-64".to_string(),
            Artifact {
                path: Some("placeholder".to_string()),
                url: Some("https://example.com/fake.jar".to_string()),
                sha1: Some("deadbeef".to_string()),
                size: Some(123),
            },
        );

        let downloads = LibraryDownloads {
            artifact: None,
            classifiers: Some(classifiers),
        };

        let lib = Library {
            name: "com.example:libperm:2.0".to_string(),
            downloads: Some(downloads),
            url: None,
            rules: None,
            natives: Some(natives_map),
            extract: Some(ExtractRules { exclude: vec![] }),
        };

        // Create an actual jar for the permissive classifier so extract_natives can find it
        let coords = format!("{}:natives-windows-64", lib.name);
        let rel = crate::game::launcher::classpath::maven_to_path(&coords).unwrap();
        let full_path = libraries_dir.join(rel);

        if let Some(p) = full_path.parent() {
            std::fs::create_dir_all(p).unwrap();
        }

        {
            let f = std::fs::File::create(&full_path).unwrap();
            let mut zip = zip::ZipWriter::new(f);
            use zip::write::FileOptions;
            zip.start_file::<&str, ()>("native-perm.bin", FileOptions::default())
                .unwrap();
            zip.write_all(b"perm").unwrap();
            zip.finish().unwrap();
        }

        // Should succeed by scanning classifiers map
        extract_natives(&[lib], libraries_dir, natives_dir, OsType::Windows)
            .await
            .expect("permissive extract failed");

        let ext = natives_dir.join("native-perm.bin");
        assert!(
            ext.exists(),
            "Expected permissive-extracted native file to exist"
        );
    }
}
