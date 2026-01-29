use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::sync::watch;

/// Progress reporter trait for installer operations
/// Implementations forward updates to the UI/notification system
pub trait ProgressReporter: Send + Sync {
    /// Start a new step with optional total steps
    fn start_step(&self, name: &str, total_steps: Option<u32>);

    /// Update bytes transferred for download progress
    fn update_bytes(&self, transferred: u64, total: Option<u64>);

    /// Set overall percentage (0-100, or -1 for indeterminate)
    fn set_percent(&self, percent: i32);

    /// Set a short status message
    fn set_message(&self, message: &str);

    /// Set a numeric step count for the current step (e.g. "3/12").
    /// `total` may be None when unknown.
    fn set_step_count(&self, current: u32, total: Option<u32>);

    /// Set a sub-step with optional name and progress (e.g., "Downloading lwjgl-3.3.1.jar (3/12)")
    /// This provides more granular progress within a step.
    fn set_substep(&self, name: Option<&str>, current: Option<u32>, total: Option<u32>);

    /// Set action buttons (e.g., cancel)
    fn set_actions(&self, actions: Option<Vec<NotificationActionSpec>>);

    /// Mark operation as complete
    fn done(&self, success: bool, message: Option<&str>);

    /// Check if operation has been cancelled
    fn is_cancelled(&self) -> bool;

    /// Check if operation is currently paused
    fn is_paused(&self) -> bool;

    /// Check if this is a dry run (no disk writes)
    fn is_dry_run(&self) -> bool {
        false
    }
}

/// Notification action specification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationActionSpec {
    pub id: String,
    pub label: String,
    pub action_type: String, // "primary", "secondary", "destructive"
}

/// A progress reporter that does nothing (silent).
/// Useful for background verification or tests.
pub struct SilentProgressReporter;

impl ProgressReporter for SilentProgressReporter {
    fn start_step(&self, _name: &str, _total_steps: Option<u32>) {}
    fn update_bytes(&self, _transferred: u64, _total: Option<u64>) {}
    fn set_percent(&self, _percent: i32) {}
    fn set_message(&self, _message: &str) {}
    fn set_step_count(&self, _current: u32, _total: Option<u32>) {}
    fn set_substep(&self, _name: Option<&str>, _current: Option<u32>, _total: Option<u32>) {}
    fn set_actions(&self, _actions: Option<Vec<NotificationActionSpec>>) {}
    fn done(&self, _success: bool, _message: Option<&str>) {}
    fn is_cancelled(&self) -> bool { false }
    fn is_paused(&self) -> bool { false }
}

/// Cancellation token wrapper
#[derive(Clone)]
pub struct CancelToken {
    rx: watch::Receiver<bool>,
}

impl CancelToken {
    pub fn new(rx: watch::Receiver<bool>) -> Self {
        Self { rx }
    }

    pub fn is_cancelled(&self) -> bool {
        *self.rx.borrow()
    }
}

/// Installation specification
#[derive(Debug, Clone)]
pub struct InstallSpec {
    /// Minecraft version ID (e.g., "1.20.1")
    pub version_id: String,

    /// Modloader type (vanilla, fabric, quilt, forge, neoforge)
    pub modloader: Option<ModloaderType>,

    /// Modloader version (if applicable)
    pub modloader_version: Option<String>,

    /// Root data directory (%appdata%/.VestaLauncher/data/)
    pub data_dir: PathBuf,

    /// Instance-specific game directory
    pub game_dir: PathBuf,

    /// Java installation path (if already known)
    pub java_path: Option<PathBuf>,

    /// If true, don't actually download or write files, just verify what's needed
    pub dry_run: bool,

    /// Number of concurrent downloads
    pub concurrency: usize,
}

impl InstallSpec {
    pub fn new(
        version_id: String,
        data_dir: PathBuf,
        game_dir: PathBuf,
    ) -> Self {
        Self {
            version_id,
            modloader: None,
            modloader_version: None,
            data_dir,
            game_dir,
            java_path: None,
            dry_run: false,
            concurrency: 8,
        }
    }

    /// Get the root data directory
    pub fn data_dir(&self) -> &PathBuf {
        &self.data_dir
    }

    /// Get the path to the libraries directory
    pub fn libraries_dir(&self) -> PathBuf {
        self.data_dir.join("libraries")
    }

    /// Get the path to the assets directory
    pub fn assets_dir(&self) -> PathBuf {
        self.data_dir.join("assets")
    }

    /// Get the path to the versions directory
    pub fn versions_dir(&self) -> PathBuf {
        self.data_dir.join("versions")
    }

    /// Get the path to the JRE directory
    pub fn jre_dir(&self) -> PathBuf {
        self.data_dir.join("jre")
    }

    /// Get the path to the natives directory for this version
    pub fn natives_dir(&self) -> PathBuf {
        self.data_dir.join("natives").join(&self.version_id)
    }

    /// Compute the canonical installed version id to use on-disk when this spec
    /// represents a modloader variant. Example: "forge-loader-47.2.0-1.20.1".
    /// When no modloader is present this returns the raw minecraft version id.
    pub fn installed_version_id(&self) -> String {
        match (&self.modloader, &self.modloader_version) {
            (Some(loader), Some(loader_ver)) => {
                format!(
                    "{}-loader-{}-{}",
                    loader.as_str(),
                    loader_ver,
                    self.version_id
                )
            }
            _ => self.version_id.clone(),
        }
    }
}

// Re-export ModloaderType from metadata module for consistency
pub use crate::game::metadata::ModloaderType;

/// Operating system types
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OsType {
    Windows,
    WindowsArm64,
    MacOS,
    MacOSArm64,
    Linux,
    LinuxArm32,
    LinuxArm64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installed_version_id_vanilla() {
        let spec = InstallSpec {
            version_id: "1.20.1".to_string(),
            modloader: None,
            modloader_version: None,
            data_dir: std::path::PathBuf::from("/tmp"),
            game_dir: std::path::PathBuf::from("/tmp/g"),
            java_path: None,
            dry_run: false,
            concurrency: 8,
        };

        assert_eq!(spec.installed_version_id(), "1.20.1");
    }

    #[test]
    fn installed_version_id_modloader() {
        let spec = InstallSpec {
            version_id: "1.20.1".to_string(),
            modloader: Some(ModloaderType::Fabric),
            modloader_version: Some("0.38.2".to_string()),
            data_dir: std::path::PathBuf::from("/tmp"),
            game_dir: std::path::PathBuf::from("/tmp/g"),
            java_path: None,
            dry_run: false,
            concurrency: 8,
        };

        assert_eq!(spec.installed_version_id(), "fabric-loader-0.38.2-1.20.1");
    }
}

impl OsType {
    /// Detect the current OS
    pub fn current() -> Self {
        #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
        return OsType::Windows;

        #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
        return OsType::WindowsArm64;

        #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
        return OsType::MacOS;

        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        return OsType::MacOSArm64;

        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        return OsType::Linux;

        #[cfg(all(target_os = "linux", target_arch = "arm"))]
        return OsType::LinuxArm32;

        #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
        return OsType::LinuxArm64;

        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        compile_error!("Unsupported operating system");
    }

    /// Get the native classifier string for Minecraft libraries
    pub fn native_classifier(&self) -> &'static str {
        match self {
            OsType::Windows | OsType::WindowsArm64 => "natives-windows",
            OsType::MacOS | OsType::MacOSArm64 => "natives-macos",
            OsType::Linux | OsType::LinuxArm32 | OsType::LinuxArm64 => "natives-linux",
        }
    }

    /// Get the OS name as a string (for rule matching)
    pub fn as_str(&self) -> &'static str {
        match self {
            OsType::Windows | OsType::WindowsArm64 => "windows",
            OsType::Linux | OsType::LinuxArm32 | OsType::LinuxArm64 => "linux",
            OsType::MacOS | OsType::MacOSArm64 => "osx",
        }
    }

    /// Get the classpath separator for this OS
    pub fn classpath_separator(&self) -> &'static str {
        match self {
            OsType::Windows | OsType::WindowsArm64 => ";",
            _ => ":",
        }
    }
}

/// Architecture types
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Arch {
    X64,
    Arm64,
    Arm32,
}

impl Arch {
    /// Detect the current architecture
    pub fn current() -> Self {
        #[cfg(target_arch = "x86_64")]
        return Arch::X64;

        #[cfg(target_arch = "aarch64")]
        return Arch::Arm64;

        #[cfg(target_arch = "arm")]
        return Arch::Arm32;

        #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "arm")))]
        compile_error!("Unsupported architecture");
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Arch::X64 => "64",
            Arch::Arm64 => "arm64",
            Arch::Arm32 => "arm32",
        }
    }
}
