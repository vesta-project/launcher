use super::downloader::extract_zip;
use crate::game::installer::track_artifact_from_path;
use crate::game::installer::types::{Arch, OsType, ProgressReporter};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const ZULU_API_BASE: &str = "https://api.azul.com/metadata/v1/zulu/packages";

/// Java version requirement
#[derive(Debug, Clone)]
pub struct JavaVersion {
    pub major: u32,
    pub minor: Option<u32>,
    pub patch: Option<u32>,
}

impl JavaVersion {
    pub fn new(major: u32) -> Self {
        Self {
            major,
            minor: None,
            patch: None,
        }
    }

    pub fn from_component(component: &str) -> Result<Self> {
        // Parse strings like "java-runtime-gamma", "jre-legacy", "java-runtime-alpha"
        let major = match component {
            "jre-legacy" => 8,
            "java-runtime-alpha" => 8,
            "java-runtime-beta" => 16,
            "java-runtime-gamma" => 17,
            "java-runtime-delta" => 21,
            "java-runtime-epsilon" => 25,
            _ => {
                // Try to parse as number
                component.parse().unwrap_or(17)
            }
        };
        Ok(Self::new(major))
    }
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ZuluPackage {
    download_url: String,
    java_version: Vec<u32>,
    openjdk_build_number: Option<u32>,
}

/// Get or install the required JRE version
/// Returns the path to the java executable
pub async fn get_or_install_jre(
    jre_dir: &Path,
    required_version: &JavaVersion,
    reporter: &dyn ProgressReporter,
) -> Result<PathBuf> {
    log::info!("Ensuring JRE {} is available", required_version.major);

    if reporter.is_dry_run() {
        log::info!("[Dry-Run] Would ensure JRE {} is available", required_version.major);
        let dummy_path = jre_dir.join(format!("zulu-{}/bin/java.exe", required_version.major));
        return Ok(dummy_path);
    }

    // Check if already installed
    let install_dir = jre_dir.join(format!("zulu-{}", required_version.major));
    if let Some(java_path) = find_java_executable(&install_dir) {
        log::info!("Found existing JRE installation: {:?}", java_path);
        if let Some(label) = relative_jre_label(jre_dir, &java_path) {
            track_artifact_from_path(label, &java_path, None, None).await?;
        }
        return Ok(java_path);
    }

    // Download and install
    log::info!("Downloading Zulu JRE {}...", required_version.major);
    install_zulu_jre(jre_dir, required_version, reporter).await
}

/// Install a Zulu JRE
async fn install_zulu_jre(
    jre_dir: &Path,
    required_version: &JavaVersion,
    reporter: &dyn ProgressReporter,
) -> Result<PathBuf> {
    let os = OsType::current();
    let arch = Arch::current();

    // Build API query
    let os_param = match os {
        OsType::Windows | OsType::WindowsArm64 => "windows",
        OsType::MacOS | OsType::MacOSArm64 => "macos",
        OsType::Linux | OsType::LinuxArm32 | OsType::LinuxArm64 => "linux",
    };

    let arch_param = match arch {
        Arch::X64 => "x86",
        Arch::Arm64 => "arm",
        Arch::Arm32 => "arm",
    };

    let hw_bitness = match arch {
        Arch::X64 | Arch::Arm64 => "64",
        Arch::Arm32 => "32",
    };

    let bundle_type = "jre"; // JRE only, not full JDK
    let javafx = "false";
    let ext = match os {
        OsType::Windows | OsType::WindowsArm64 => "zip",
        _ => "tar.gz",
    };

    let url = format!(
        "{}/?os={}&arch={}&hw_bitness={}&bundle_type={}&javafx_bundled={}&java_version={}&ext={}&archive_type={}&latest=true&release_status=ga&availability_types=CA&certifications=tck&page=1&page_size=1",
        ZULU_API_BASE,
        os_param,
        arch_param,
        hw_bitness,
        bundle_type,
        javafx,
        required_version.major,
        ext,
        ext
    );

    log::debug!("Querying Zulu API: {}", url);

    // Query API
    let client = reqwest::Client::new();
    let response = client.get(&url).send().await?;

    if !response.status().is_success() {
        anyhow::bail!("Failed to query Zulu API: HTTP {}", response.status());
    }

    let packages: Vec<ZuluPackage> = response.json().await?;
    let package = packages
        .first()
        .context("No Zulu JRE package found for this platform")?;

    log::info!("Downloading Zulu JRE from: {}", package.download_url);

    // Download archive (reuse the client created above)
    let archive_bytes = super::downloader::download_to_memory_with_client(
        &client,
        &package.download_url,
        None,
        Some(reporter),
    )
    .await?;

    // Extract
    let install_dir = jre_dir.join(format!("zulu-{}", required_version.major));
    std::fs::create_dir_all(&install_dir)?;

    log::info!("Extracting JRE to: {:?}", install_dir);

    if ext == "zip" {
        extract_zip(&archive_bytes, &install_dir).await?;
    } else {
        extract_tar_gz(&archive_bytes, &install_dir).await?;
    }

    // Find the java executable
    let java_path = find_java_executable(&install_dir)
        .context("Could not find java executable after extraction")?;

    // Set executable permissions on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&java_path)?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&java_path, perms)?;
    }

    if let Some(label) = relative_jre_label(jre_dir, &java_path) {
        track_artifact_from_path(label, &java_path, None, Some(package.download_url.clone()))
            .await?;
    }

    log::info!("JRE installed successfully: {:?}", java_path);
    Ok(java_path)
}

/// Extract a tar.gz archive
async fn extract_tar_gz(data: &[u8], dest: &Path) -> Result<()> {
    use flate2::read::GzDecoder;
    use std::io::Cursor;
    use tar::Archive;

    let cursor = Cursor::new(data);
    let decoder = GzDecoder::new(cursor);
    let mut archive = Archive::new(decoder);

    archive.unpack(dest)?;

    Ok(())
}

/// Find the java executable in a JRE installation directory
pub fn find_java_executable(dir: &Path) -> Option<PathBuf> {
    // Common JRE structures:
    // - zulu-{version}/bin/java (direct extraction)
    // - zulu-{version}/zulu-{full-version}/bin/java (nested)
    // - zulu-{version}/Contents/Home/bin/java (macOS)

    let executable_name = if cfg!(windows) { "java.exe" } else { "java" };

    // Try direct bin/
    let direct = dir.join("bin").join(executable_name);
    if direct.exists() {
        return Some(direct);
    }

    // Try nested (first subdirectory)
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let nested = entry.path().join("bin").join(executable_name);
                if nested.exists() {
                    return Some(nested);
                }

                // Try macOS structure
                let macos = entry.path().join("Contents/Home/bin").join(executable_name);
                if macos.exists() {
                    return Some(macos);
                }
            }
        }
    }

    // Try macOS structure at root
    let macos = dir.join("Contents/Home/bin").join(executable_name);
    if macos.exists() {
        return Some(macos);
    }

    None
}

/// Information about a detected Java installation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedJava {
    pub path: PathBuf,
    pub major_version: u32,
    pub is_64bit: bool,
}

/// Scan for Java installations in common system locations
pub fn scan_system_javas() -> Vec<DetectedJava> {
    let mut results = Vec::new();
    let mut scanned_paths = std::collections::HashSet::new();

    // 1. Check PATH
    if let Some(path) = detect_system_java_from_path() {
        if let Ok(info) = verify_java(&path) {
            if scanned_paths.insert(path.clone()) {
                results.push(info);
            }
        }
    }

    // 2. common OS-specific directories
    let mut search_roots = Vec::new();

    #[cfg(windows)]
    {
        search_roots.push(PathBuf::from("C:\\Program Files\\Java"));
        search_roots.push(PathBuf::from("C:\\Program Files (x86)\\Java"));
        
        // Also check Eclipse Temurin / Adoptium
        search_roots.push(PathBuf::from("C:\\Program Files\\Eclipse Foundation"));
    }

    #[cfg(target_os = "macos")]
    {
        search_roots.push(PathBuf::from("/Library/Java/JavaVirtualMachines"));
    }

    #[cfg(target_os = "linux")]
    {
        search_roots.push(PathBuf::from("/usr/lib/jvm"));
        search_roots.push(PathBuf::from("/usr/java"));
    }

    for root in search_roots {
        if !root.exists() {
            continue;
        }

        if let Ok(entries) = std::fs::read_dir(root) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    if let Some(java_path) = find_java_executable(&entry.path()) {
                        if scanned_paths.insert(java_path.clone()) {
                            if let Ok(info) = verify_java(&java_path) {
                                results.push(info);
                            }
                        }
                    }
                }
            }
        }
    }

    results
}

fn detect_system_java_from_path() -> Option<PathBuf> {
    // Try to find the java executable path
    #[cfg(windows)]
    {
        if let Ok(output) = std::process::Command::new("where").arg("java").output() {
            if let Ok(path_str) = String::from_utf8(output.stdout) {
                if let Some(first_line) = path_str.lines().next() {
                    return Some(PathBuf::from(first_line.trim()));
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        if let Ok(output) = std::process::Command::new("which").arg("java").output() {
            if let Ok(path_str) = String::from_utf8(output.stdout) {
                return Some(PathBuf::from(path_str.trim()));
            }
        }
    }
    None
}

/// Verify a Java path and return information about it
pub fn verify_java(path: &Path) -> Result<DetectedJava> {
    if !path.exists() {
        anyhow::bail!("Java path does not exist: {:?}", path);
    }

    // Run java -version
    // Note: java -version outputs to STDERR unusually
    let output = std::process::Command::new(path)
        .arg("-version")
        .output()
        .context("Failed to run java -version")?;

    let version_str = String::from_utf8_lossy(&output.stderr);
    
    // Parse version string like 'openjdk version "17.0.1" 2021-10-19' or 'java version "1.8.0_311"'
    let major_version = parse_major_version(&version_str)
        .context(format!("Could not parse Java version from: {}", version_str))?;

    // Check if 64-bit
    let is_64bit = version_str.contains("64-Bit") || version_str.contains("x86_64") || version_str.contains("amd64");

    Ok(DetectedJava {
        path: path.to_path_buf(),
        major_version,
        is_64bit,
    })
}

fn parse_major_version(version_output: &str) -> Option<u32> {
    // Look for patterns like "1.8.0", "17.0.1", "21-ea"
    let re = regex::Regex::new(r"version\s+?.\s*?(\d+)(\.(\d+))?").ok()?;
    if let Some(caps) = re.captures(version_output) {
        let major = caps.get(1)?.as_str().parse::<u32>().ok()?;
        if major == 1 {
            // Handle 1.8.x -> 8
            return caps.get(3)?.as_str().parse::<u32>().ok();
        }
        return Some(major);
    }
    None
}

/// Detect system Java installations
pub fn detect_system_java() -> Option<PathBuf> {
    detect_system_java_from_path()
}

fn relative_jre_label(root: &Path, target: &Path) -> Option<String> {
    target
        .strip_prefix(root)
        .ok()
        .map(|rel| format!("jre/{}", rel.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn parses_java_version_from_component() {
        assert_eq!(JavaVersion::from_component("jre-legacy").unwrap().major, 8);
        assert_eq!(
            JavaVersion::from_component("java-runtime-alpha")
                .unwrap()
                .major,
            8
        );
        assert_eq!(
            JavaVersion::from_component("java-runtime-beta")
                .unwrap()
                .major,
            16
        );
        assert_eq!(
            JavaVersion::from_component("java-runtime-gamma")
                .unwrap()
                .major,
            17
        );
        assert_eq!(
            JavaVersion::from_component("java-runtime-delta")
                .unwrap()
                .major,
            21
        );
        assert_eq!(JavaVersion::from_component("17").unwrap().major, 17);
    }

    #[test]
    fn finds_java_executable_in_common_layouts() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("zulu-17");
        fs::create_dir_all(root.join("bin")).unwrap();

        let exe = if cfg!(windows) { "java.exe" } else { "java" };
        let java_path = root.join("bin").join(exe);
        fs::write(&java_path, b"").unwrap();

        let found = find_java_executable(&root).expect("should find java in bin/");
        assert_eq!(found, java_path);

        // Nested layout
        let nested_root = tmp.path().join("zulu-21");
        let nested_inner = nested_root.join("zulu-21.0.1");
        fs::create_dir_all(nested_inner.join("bin")).unwrap();
        let nested_java = nested_inner.join("bin").join(exe);
        fs::write(&nested_java, b"").unwrap();
        let found_nested = find_java_executable(&nested_root).expect("should find nested java");
        assert_eq!(found_nested, nested_java);
    }
}
