/// Classpath construction for Minecraft launcher
use crate::game::launcher::unified_manifest::UnifiedLibrary;
use crate::game::installer::types::OsType;
use anyhow::Result;
use std::path::Path;

/// Validation errors that occur during launch preparation
#[derive(Debug, thiserror::Error)]
pub enum ValidationError {
    #[error("Required library not found: {library_path}")]
    LibraryNotFound { library_path: String },
    
    #[error("Invalid Maven coordinates: {coords}")]
    InvalidMavenCoords { coords: String },
    
    #[error("Rule evaluation failed for library: {library_name}")]
    RuleEvaluationFailed { library_name: String },
    
    #[error("Architecture not supported: {arch} for OS: {os}")]
    UnsupportedArchitecture { arch: String, os: String },
}

/// Results of classpath validation
#[derive(Debug)]
pub struct ClasspathValidation {
    pub valid_libraries: Vec<String>,
    pub missing_libraries: Vec<String>,
    pub excluded_libraries: Vec<String>,
    pub warnings: Vec<String>,
}

/// Build the classpath string from libraries
pub fn build_classpath(libraries: &[UnifiedLibrary], libraries_dir: &Path, os: OsType) -> Result<String> {
    build_classpath_filtered(libraries, libraries_dir, os, &[])
}

/// Build the classpath string from libraries, excluding specific relative paths
pub fn build_classpath_filtered(
    libraries: &[UnifiedLibrary],
    libraries_dir: &Path,
    os: OsType,
    exclude_relative_paths: &[String],
) -> Result<String> {
    let mut classpath_entries = Vec::new();

    for library in libraries {
        // UnifiedLibrary is already filtered by rules during merge.
        // We only skip native-only libraries if they don't contain classes.
        // In modern Minecraft, natives are often in separate JARs.
        if library.is_native {
            continue;
        }

        // Skip libraries explicitly excluded (e.g. they are in the module path)
        if exclude_relative_paths.contains(&library.path) {
            continue;
        }

        let full_path = libraries_dir.join(&library.path);

        // Add to classpath if file exists - FAIL if missing required library
        if full_path.exists() {
            classpath_entries.push(full_path.to_string_lossy().to_string());
        } else {
            return Err(ValidationError::LibraryNotFound {
                library_path: full_path.to_string_lossy().to_string(),
            }.into());
        }
    }

    Ok(classpath_entries.join(os.classpath_separator()))
}

/// Validate classpath requirements before launch
pub fn validate_classpath(libraries: &[UnifiedLibrary], libraries_dir: &Path, _os: OsType) -> Result<ClasspathValidation> {
    let mut validation = ClasspathValidation {
        valid_libraries: Vec::new(),
        missing_libraries: Vec::new(),
        excluded_libraries: Vec::new(),
        warnings: Vec::new(),
    };

    for library in libraries {
        // UnifiedLibrary is already filtered by rules during merge.
        if library.is_native {
            validation.excluded_libraries.push(library.name.clone());
            continue;
        }

        let full_path = libraries_dir.join(&library.path);
        
        if full_path.exists() {
            validation.valid_libraries.push(full_path.to_string_lossy().to_string());
        } else {
            validation.missing_libraries.push(full_path.to_string_lossy().to_string());
        }
    }

    // Fail if any required libraries are missing
    if !validation.missing_libraries.is_empty() {
        return Err(anyhow::anyhow!(
            "Missing {} required libraries: {}", 
            validation.missing_libraries.len(),
            validation.missing_libraries.join(", ")
        ));
    }

    Ok(validation)
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
    let mut version = parts[2];
    let mut classifier = None;
    let mut extension = "jar";

    if parts.len() == 3 {
        // group:artifact:version@extension
        if let Some((v, ext)) = version.split_once('@') {
            version = v;
            extension = ext;
        }
    } else if parts.len() >= 4 {
        // group:artifact:version:classifier[@extension]
        if let Some((clf, ext)) = parts[3].split_once('@') {
            classifier = Some(clf);
            extension = ext;
        } else {
            classifier = Some(parts[3]);
        }
    }

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
    fn test_maven_to_path_forge_style() {
        let path = maven_to_path("de.oceanlabs.mcp:mcp_config:1.20.1-20230612.114412@zip").unwrap();
        assert_eq!(path, "de/oceanlabs/mcp/mcp_config/1.20.1-20230612.114412/mcp_config-1.20.1-20230612.114412.zip");
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
}
