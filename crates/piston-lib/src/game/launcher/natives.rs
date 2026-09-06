/// Native library extraction for Minecraft launcher
use crate::game::installer::types::OsType;
use crate::game::launcher::unified_manifest::UnifiedLibrary;
use anyhow::{Context, Result};
use std::path::Path;

/// Extract native libraries from JARs
pub async fn extract_natives(
    libraries: &[UnifiedLibrary],
    libraries_dir: &Path,
    natives_dir: &Path,
    _os: OsType,
) -> Result<()> {
    // Create natives directory
    tokio::fs::create_dir_all(natives_dir).await?;

    for library in libraries {
        if !library.is_native {
            continue;
        }

        let path = libraries_dir.join(&library.path);
        if !path.exists() {
            log::warn!("Native library JAR not found: {:?}", path);
            continue;
        }

        extract_jar(&path, natives_dir, library).await?;
    }

    Ok(())
}

/// Extract a JAR file to a directory
async fn extract_jar(jar_path: &Path, output_dir: &Path, library: &UnifiedLibrary) -> Result<()> {
    log::debug!("Extracting natives from: {:?}", jar_path);

    let jar_path = jar_path.to_path_buf();
    let output_dir = output_dir.to_path_buf();
    let library = library.clone();
    let exclusions = library
        .extract_rules
        .as_ref()
        .map(|e| e.exclude.clone())
        .unwrap_or_default();
    tokio::task::spawn_blocking(move || -> Result<()> {
        let output_root = std::fs::canonicalize(&output_dir)
            .with_context(|| format!("Failed to canonicalize natives directory: {output_dir:?}"))?;
        let exclusions: Vec<&str> = exclusions.iter().map(|s| s.as_str()).collect();
        let file = std::fs::File::open(&jar_path)
            .with_context(|| format!("Failed to open JAR: {:?}", jar_path))?;
        let mut archive = zip::ZipArchive::new(file)
            .with_context(|| format!("Failed to read JAR: {:?}", jar_path))?;

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i)?;
            let entry_name = entry.name().to_string();
            let enclosed = entry
                .enclosed_name()
                .ok_or_else(|| anyhow::anyhow!("Native JAR contains unsafe path: {entry_name}"))?;
            let file_path = enclosed.to_string_lossy().to_string();

            // Skip if excluded
            if should_exclude(&file_path, &exclusions) {
                continue;
            }

            // Skip directories
            if entry.is_dir() {
                continue;
            }

            // Extract file
            let output_path = output_root.join(enclosed);

            // Walk one component at a time. `create_dir_all` would follow an
            // existing symlink and could create directories outside the native
            // root before a post-creation canonicalization noticed the escape.
            if let Some(parent) = output_path.parent() {
                let relative_parent = parent.strip_prefix(&output_root)?;
                let mut current = output_root.clone();
                for component in relative_parent.components() {
                    current.push(component);
                    match std::fs::symlink_metadata(&current) {
                        Ok(metadata) if metadata.file_type().is_symlink() => {
                            anyhow::bail!(
                                "Native extraction refuses symlinked directory: {}",
                                current.display()
                            );
                        }
                        Ok(metadata) if !metadata.is_dir() => {
                            anyhow::bail!(
                                "Native extraction parent is not a directory: {}",
                                current.display()
                            );
                        }
                        Ok(_) => {}
                        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                            std::fs::create_dir(&current)?;
                        }
                        Err(err) => return Err(err.into()),
                    }
                }
                let canonical_parent = std::fs::canonicalize(parent)?;
                if !canonical_parent.starts_with(&output_root) {
                    anyhow::bail!(
                        "Native extraction path escapes output directory: {}",
                        entry_name
                    );
                }
            }
            if std::fs::symlink_metadata(&output_path)
                .map(|metadata| metadata.file_type().is_symlink())
                .unwrap_or(false)
            {
                anyhow::bail!(
                    "Native extraction refuses existing symlink: {}",
                    output_path.display()
                );
            }

            // Write file
            let mut output_file = std::fs::File::create(&output_path)?;
            std::io::copy(&mut entry, &mut output_file)?;
        }

        Ok(())
    })
    .await
    .context("spawn_blocking panicked")??;

    Ok(())
}

/// Check if a file should be excluded
fn should_exclude(file_path: &str, exclusions: &[&str]) -> bool {
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
        let exclusions = vec!["META-INF/", "module-info.class"];

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
            include_in_classpath: true,
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
        let unified = UnifiedLibrary::from_library(&lib, None, OsType::Windows);
        extract_natives(&unified, libraries_dir, natives_dir, OsType::Windows)
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

        let coords = "com.example:libperm:2.0:natives-windows-64";
        let rel_path = crate::game::launcher::classpath::maven_to_path(coords).unwrap();

        let mut classifiers = HashMap::new();
        classifiers.insert(
            "natives-windows-64".to_string(),
            Artifact {
                path: Some(rel_path.clone()),
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
            include_in_classpath: true,
        };

        // Create an actual jar for the permissive classifier so extract_natives can find it
        let full_path = libraries_dir.join(&rel_path);

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
        let unified = UnifiedLibrary::from_library(&lib, None, OsType::Windows);
        extract_natives(&unified, libraries_dir, natives_dir, OsType::Windows)
            .await
            .expect("permissive extract failed");

        let ext = natives_dir.join("native-perm.bin");
        assert!(
            ext.exists(),
            "Expected permissive-extracted native file to exist"
        );
    }

    #[tokio::test]
    async fn rejects_native_jar_path_traversal() {
        use crate::game::launcher::version_parser::{ExtractRules, Library};
        use std::io::Write;
        use tempfile::TempDir;

        let libs_tmp = TempDir::new().unwrap();
        let natives_tmp = TempDir::new().unwrap();
        let mut natives_map = std::collections::HashMap::new();
        natives_map.insert("windows".to_string(), "natives-windows-${arch}".to_string());
        let lib = Library {
            name: "com.example:unsafe:1.0".to_string(),
            downloads: None,
            url: None,
            rules: None,
            natives: Some(natives_map),
            extract: Some(ExtractRules { exclude: vec![] }),
            include_in_classpath: true,
        };
        let arch = if cfg!(target_pointer_width = "32") {
            "32"
        } else {
            "64"
        };
        let coords = format!("{}:natives-windows-{}", lib.name, arch);
        let jar_path = libs_tmp
            .path()
            .join(crate::game::launcher::classpath::maven_to_path(&coords).unwrap());
        std::fs::create_dir_all(jar_path.parent().unwrap()).unwrap();
        let file = std::fs::File::create(&jar_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file::<&str, ()>("../escaped.bin", zip::write::FileOptions::default())
            .unwrap();
        zip.write_all(b"escape").unwrap();
        zip.finish().unwrap();

        let unified = UnifiedLibrary::from_library(&lib, None, OsType::Windows);
        let error = extract_natives(
            &unified,
            libs_tmp.path(),
            natives_tmp.path(),
            OsType::Windows,
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("unsafe path"));
        assert!(!natives_tmp
            .path()
            .parent()
            .unwrap()
            .join("escaped.bin")
            .exists());
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn rejects_symlinked_native_parent_before_creating_outside() {
        use crate::game::launcher::version_parser::{ExtractRules, Library};
        use std::io::Write;
        use std::os::unix::fs::symlink;
        use tempfile::TempDir;

        let libs_tmp = TempDir::new().unwrap();
        let natives_tmp = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        symlink(outside.path(), natives_tmp.path().join("link")).unwrap();

        let mut natives_map = std::collections::HashMap::new();
        natives_map.insert("windows".to_string(), "natives-windows-${arch}".to_string());
        let lib = Library {
            name: "com.example:symlink:1.0".to_string(),
            downloads: None,
            url: None,
            rules: None,
            natives: Some(natives_map),
            extract: Some(ExtractRules { exclude: vec![] }),
            include_in_classpath: true,
        };
        let arch = if cfg!(target_pointer_width = "32") {
            "32"
        } else {
            "64"
        };
        let coords = format!("{}:natives-windows-{}", lib.name, arch);
        let jar_path = libs_tmp
            .path()
            .join(crate::game::launcher::classpath::maven_to_path(&coords).unwrap());
        std::fs::create_dir_all(jar_path.parent().unwrap()).unwrap();
        let file = std::fs::File::create(&jar_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file::<&str, ()>("link/new/native.bin", zip::write::FileOptions::default())
            .unwrap();
        zip.write_all(b"escape").unwrap();
        zip.finish().unwrap();

        let unified = UnifiedLibrary::from_library(&lib, None, OsType::Windows);
        let error = extract_natives(
            &unified,
            libs_tmp.path(),
            natives_tmp.path(),
            OsType::Windows,
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("symlinked directory"));
        assert!(!outside.path().join("new").exists());
    }
}
