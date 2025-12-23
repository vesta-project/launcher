/// Utilities for parsing Forge/NeoForge installer JARs
use super::installer::{ForgeVersionInfo, InstallProfile};
use anyhow::{Context, Result};
use std::io::Read;
use std::path::Path;

/// Extract and parse install_profile.json from installer JAR
pub async fn parse_install_profile(installer_path: &Path) -> Result<InstallProfile> {
    log::debug!("Parsing install_profile.json from {:?}", installer_path);

    let file = std::fs::File::open(installer_path).context("Failed to open installer JAR")?;

    let mut archive = zip::ZipArchive::new(file).context("Failed to read installer JAR as ZIP")?;

    let mut profile_file = archive
        .by_name("install_profile.json")
        .context("install_profile.json not found in installer JAR")?;

    let mut profile_json = String::new();
    profile_file
        .read_to_string(&mut profile_json)
        .context("Failed to read install_profile.json")?;

    let profile: InstallProfile =
        serde_json::from_str(&profile_json).context("Failed to parse install_profile.json")?;

    log::debug!(
        "Parsed install profile: spec={}, processors={}",
        profile.spec,
        profile.processors.len()
    );

    Ok(profile)
}

/// Extract and parse version.json from installer JAR
pub async fn parse_version_json(installer_path: &Path) -> Result<ForgeVersionInfo> {
    log::debug!("Parsing version.json from {:?}", installer_path);

    let file = std::fs::File::open(installer_path).context("Failed to open installer JAR")?;

    let mut archive = zip::ZipArchive::new(file).context("Failed to read installer JAR as ZIP")?;

    let mut version_file = archive
        .by_name("version.json")
        .context("version.json not found in installer JAR")?;

    let mut version_json = String::new();
    version_file
        .read_to_string(&mut version_json)
        .context("Failed to read version.json")?;

    let version_info: ForgeVersionInfo =
        serde_json::from_str(&version_json).context("Failed to parse version.json")?;

    log::debug!(
        "Parsed version info: id={}, inheritsFrom={}",
        version_info.id,
        version_info.inherits_from
    );

    Ok(version_info)
}

/// Extract embedded Maven libraries from installer JAR
pub async fn extract_maven_libraries(
    installer_path: &Path,
    libraries_dir: &Path,
) -> Result<Vec<String>> {
    log::debug!("Extracting embedded Maven libraries from installer");

    let file = std::fs::File::open(installer_path).context("Failed to open installer JAR")?;

    let mut archive = zip::ZipArchive::new(file).context("Failed to read installer JAR as ZIP")?;

    let mut extracted_libs = Vec::new();

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let file_path = file.name().to_string();

        // Look for files in maven/ directory
        if file_path.starts_with("maven/") && !file.is_dir() {
            let rel_path = &file_path[6..]; // Remove "maven/" prefix
            let output_path = libraries_dir.join(rel_path);

            // Create parent directories
            if let Some(parent) = output_path.parent() {
                std::fs::create_dir_all(parent)?;
            }

            // Extract file
            let mut output_file = std::fs::File::create(&output_path)?;
            std::io::copy(&mut file, &mut output_file)?;

            extracted_libs.push(rel_path.to_string());
        }
    }

    log::debug!("Extracted {} embedded libraries", extracted_libs.len());
    Ok(extracted_libs)
}

/// Extract Main-Class from JAR manifest
pub fn extract_main_class_from_jar(jar_path: &Path) -> Result<String> {
    let file = std::fs::File::open(jar_path).context("Failed to open JAR file")?;
    let mut archive = zip::ZipArchive::new(file).context("Failed to read JAR as ZIP")?;

    let mut manifest_file = archive
        .by_name("META-INF/MANIFEST.MF")
        .context("MANIFEST.MF not found in JAR")?;

    let mut manifest_content = String::new();
    manifest_file
        .read_to_string(&mut manifest_content)
        .context("Failed to read MANIFEST.MF")?;

    for line in manifest_content.lines() {
        if line.starts_with("Main-Class: ") {
            return Ok(line["Main-Class: ".len()..].trim().to_string());
        }
    }

    anyhow::bail!("Main-Class attribute not found in manifest")
}
