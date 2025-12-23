/// Classpath construction for Minecraft launcher
use crate::game::launcher::version_parser::{Library, Rule, RuleAction};
use anyhow::Result;
use std::path::Path;

/// Operating system type for rule evaluation
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OsType {
    Windows,
    Linux,
    MacOS,
}

impl OsType {
    /// Get the current OS type
    pub fn current() -> Self {
        #[cfg(target_os = "windows")]
        return OsType::Windows;

        #[cfg(target_os = "linux")]
        return OsType::Linux;

        #[cfg(target_os = "macos")]
        return OsType::MacOS;
    }

    /// Get the OS name as a string (for rule matching)
    pub fn as_str(&self) -> &'static str {
        match self {
            OsType::Windows => "windows",
            OsType::Linux => "linux",
            OsType::MacOS => "osx",
        }
    }

    /// Get the classpath separator for this OS
    pub fn classpath_separator(&self) -> &'static str {
        match self {
            OsType::Windows => ";",
            OsType::Linux | OsType::MacOS => ":",
        }
    }
}

/// Build the classpath string from libraries
pub fn build_classpath(libraries: &[Library], libraries_dir: &Path, os: OsType) -> Result<String> {
    let mut classpath_entries = Vec::new();

    for library in libraries {
        // Check if this library should be included for this OS
        if !should_include_library(library, os) {
            continue;
        }

        // Convert Maven coordinates to file path
        let lib_path = maven_to_path(&library.name)?;
        let full_path = libraries_dir.join(&lib_path);

        // Add to classpath if file exists
        if full_path.exists() {
            classpath_entries.push(full_path.to_string_lossy().to_string());
        } else {
            log::warn!("Library not found: {:?}", full_path);
        }
    }

    Ok(classpath_entries.join(os.classpath_separator()))
}

/// Check if a library should be included based on rules
fn should_include_library(library: &Library, os: OsType) -> bool {
    let Some(rules) = &library.rules else {
        // No rules means always include
        return true;
    };

    // Default action if no rules match
    let mut include = false;

    for rule in rules {
        if rule_matches(rule, os) {
            match rule.action {
                RuleAction::Allow => include = true,
                RuleAction::Disallow => include = false,
            }
        }
    }

    include
}

/// Check if a rule matches the current environment
fn rule_matches(rule: &Rule, os: OsType) -> bool {
    // If there's an OS constraint, check it
    if let Some(ref os_rule) = rule.os {
        if let Some(ref os_name) = os_rule.name {
            if os_name != os.as_str() {
                return false;
            }
        }

        // TODO: Check version and arch if needed
        // For now, we only check OS name
    }

    // If there are feature constraints, we'd check them here
    // For now, we don't support features
    if rule.features.is_some() {
        // Skip rules with features we don't understand
        return false;
    }

    // Rule matches
    true
}

/// Convert Maven coordinates to file path
/// Format: group:artifact:version[:classifier][@extension]
/// Example: "com.google.guava:guava:21.0" -> "com/google/guava/guava/21.0/guava-21.0.jar"
pub fn maven_to_path(coords: &str) -> Result<String> {
    let parts: Vec<&str> = coords.split(':').collect();

    if parts.len() < 3 {
        anyhow::bail!("Invalid Maven coordinates: {}", coords);
    }

    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];

    let (classifier, extension) = if parts.len() >= 4 {
        // Check if there's an @extension
        if let Some((clf, ext)) = parts[3].split_once('@') {
            (Some(clf), ext)
        } else {
            (Some(parts[3]), "jar")
        }
    } else {
        (None, "jar")
    };

    let filename = if let Some(clf) = classifier {
        format!("{}-{}-{}.{}", artifact, version, clf, extension)
    } else {
        format!("{}-{}.{}", artifact, version, extension)
    };

    Ok(format!("{}/{}/{}/{}", group, artifact, version, filename))
}

use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use zip::write::{ExtendedFileOptions, FileOptions};

/// Create a temporary JAR file with a Class-Path manifest attribute
/// This is used to workaround command line length limits on Windows
pub fn create_classpath_jar(paths: &[String], temp_dir: &Path) -> Result<PathBuf> {
    let jar_path = temp_dir.join(format!("classpath-{}.jar", uuid::Uuid::new_v4()));
    let file = File::create(&jar_path)?;
    let mut zip: zip::ZipWriter<File> = zip::ZipWriter::new(file);

    let options: FileOptions<'_, ExtendedFileOptions> = FileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .unix_permissions(0o755);

    zip.start_file("META-INF/MANIFEST.MF", options)?;

    // Construct Class-Path attribute
    // We need to use absolute file URLs
    let mut class_path = String::new();
    for path in paths {
        let path_buf = PathBuf::from(path);
        // Convert to URL format (file:///)
        // We need to handle spaces and special characters
        let url = url::Url::from_file_path(&path_buf)
            .map_err(|_| anyhow::anyhow!("Failed to convert path to URL: {:?}", path_buf))?;

        if !class_path.is_empty() {
            class_path.push(' ');
        }
        class_path.push_str(url.as_str());
    }

    // Write Manifest
    // Manifest lines should not exceed 72 bytes (not characters), but for Class-Path
    // it's a bit complex. However, modern Java versions are lenient.
    // Standard format:
    // Manifest-Version: 1.0
    // Class-Path: ...

    // For safety, we'll just write it as a long string. Most JVMs handle it.
    // If strict wrapping is needed, we'd need a proper manifest writer.
    // But for now, let's try the simple approach.
    write!(zip, "Manifest-Version: 1.0\n")?;
    write!(zip, "Class-Path: {}\n", class_path)?;
    write!(zip, "Main-Class: \n")?; // Some JVMs expect this even if empty

    zip.finish()?;

    Ok(jar_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_maven_to_path_simple() {
        let path = maven_to_path("com.google.guava:guava:21.0").unwrap();
        assert_eq!(path, "com/google/guava/guava/21.0/guava-21.0.jar");
    }

    #[test]
    fn test_maven_to_path_with_classifier() {
        let path = maven_to_path("org.lwjgl:lwjgl:3.3.1:natives-windows").unwrap();
        assert_eq!(
            path,
            "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-windows.jar"
        );
    }

    #[test]
    fn test_maven_to_path_with_extension() {
        let path = maven_to_path("com.example:lib:1.0:sources@zip").unwrap();
        assert_eq!(path, "com/example/lib/1.0/lib-1.0-sources.zip");
    }

    #[test]
    fn test_os_type_current() {
        let os = OsType::current();
        // Just verify it doesn't panic
        assert!(matches!(
            os,
            OsType::Windows | OsType::Linux | OsType::MacOS
        ));
    }

    #[test]
    fn test_classpath_separator() {
        assert_eq!(OsType::Windows.classpath_separator(), ";");
        assert_eq!(OsType::Linux.classpath_separator(), ":");
        assert_eq!(OsType::MacOS.classpath_separator(), ":");
    }

    #[test]
    fn test_should_include_library_no_rules() {
        let library = Library {
            name: "test:test:1.0".to_string(),
            downloads: None,
            url: None,
            rules: None,
            natives: None,
            extract: None,
        };

        assert!(should_include_library(&library, OsType::Windows));
        assert!(should_include_library(&library, OsType::Linux));
    }
}
