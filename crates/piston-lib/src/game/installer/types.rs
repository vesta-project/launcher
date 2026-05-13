use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::sync::watch;

/// Policy for native library selection on ARM architectures.
///
/// When on ARM64 (e.g., macOS arm64), we may encounter libraries with:
/// - Architecture-specific classifier (e.g., "natives-osx-arm64")
/// - Generic classifier without architecture (e.g., "natives-osx")
///
/// The generic classifier typically contains only x86/x64 binaries.
/// This policy controls whether to exclude generic classifiers when
/// a pure-ARM variant exists, or to permit fallback to generic x86.
///
/// **To reverse this policy**: Change to `AllowGenericNativeFallback` if ARM
/// installs fail due to missing libraries on newer Java/platform versions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeArchitecturePolicy {
    /// Reject generic natives (e.g., "natives-osx") on ARM64 if a specific ARM variant exists.
    /// This prevents x86/x64-only binaries on ARM. Safe for platforms with full ARM support.
    /// (Current: enabled for Apple Silicon with Java 21+)
    PreferArchSpecificOnly,

    /// Allow fallback to generic natives on ARM64 when no specific variant exists.
    /// Safer for platforms with mixed or incomplete ARM support.
    AllowGenericNativeFallback,
}

/// Current native architecture policy.
/// Change this constant to control behavior on ARM platforms.
pub const NATIVE_ARCH_POLICY: NativeArchitecturePolicy =
    NativeArchitecturePolicy::PreferArchSpecificOnly;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VerificationIssueKind {
    Missing,
    Mismatch,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationIssue {
    pub kind: VerificationIssueKind,
    pub artifact_class: String,
    pub path: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationResult {
    pub ready: bool,
    pub checked: usize,
    pub issues: Vec<VerificationIssue>,
}

impl VerificationResult {
    pub fn missing_count(&self) -> usize {
        self.issues
            .iter()
            .filter(|issue| issue.kind == VerificationIssueKind::Missing)
            .count()
    }

    pub fn mismatch_count(&self) -> usize {
        self.issues
            .iter()
            .filter(|issue| issue.kind == VerificationIssueKind::Mismatch)
            .count()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RemediationPolicy {
    VerifyOnly,
    RepairIfNeeded,
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
    fn is_cancelled(&self) -> bool {
        false
    }
    fn is_paused(&self) -> bool {
        false
    }
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
    pub fn new(version_id: String, data_dir: PathBuf, game_dir: PathBuf) -> Self {
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

    /// Get the OS name as a string (for rule matching, matches Modrinth/daedalus Os enum).
    /// ARM variants return distinct names so rules like {"action": "disallow", "os": {"name": "osx"}}
    /// only match Intel Macs and don't exclude ARM-compatible libraries.
    pub fn as_str(&self) -> &'static str {
        match self {
            OsType::Windows => "windows",
            OsType::WindowsArm64 => "windows-arm64",
            OsType::MacOS => "osx",
            OsType::MacOSArm64 => "osx-arm64",
            OsType::Linux => "linux",
            OsType::LinuxArm64 => "linux-arm64",
            OsType::LinuxArm32 => "linux-arm32",
        }
    }

    /// Get the full OS name including architecture (for Modrinth rule matching)
    pub fn as_str_full(&self) -> &'static str {
        match self {
            OsType::Windows => "windows",
            OsType::WindowsArm64 => "windows-arm64",
            OsType::MacOS => "osx",
            OsType::MacOSArm64 => "osx-arm64",
            OsType::Linux => "linux",
            OsType::LinuxArm64 => "linux-arm64",
            OsType::LinuxArm32 => "linux-arm32",
        }
    }

    /// Get the classpath separator for this OS
    pub fn classpath_separator(&self) -> &'static str {
        match self {
            OsType::Windows | OsType::WindowsArm64 => ";",
            _ => ":",
        }
    }

    /// Get the architecture string compatible with Rust's std::env::consts::ARCH
    pub fn rust_arch_str(&self) -> &'static str {
        match self {
            OsType::Windows | OsType::MacOS | OsType::Linux => "x86_64",
            OsType::WindowsArm64 | OsType::MacOSArm64 | OsType::LinuxArm64 => "aarch64",
            OsType::LinuxArm32 => "arm",
        }
    }

    /// Get the architecture enum for this OS
    pub fn arch(&self) -> Arch {
        match self {
            OsType::Windows | OsType::MacOS | OsType::Linux => Arch::X64,
            OsType::WindowsArm64 | OsType::MacOSArm64 | OsType::LinuxArm64 => Arch::Arm64,
            OsType::LinuxArm32 => Arch::Arm32,
        }
    }

    /// Get the canonical OS name used in classifier/rule matching.
    /// Returns "windows", "linux", or "osx" (Mojang convention).
    pub fn os_name(&self) -> &'static str {
        match self {
            OsType::Windows | OsType::WindowsArm64 => "windows",
            OsType::Linux | OsType::LinuxArm32 | OsType::LinuxArm64 => "linux",
            OsType::MacOS | OsType::MacOSArm64 => "osx",
        }
    }

    /// Check whether an OS name from a version rule matches this runtime OS.
    ///
    /// Rules often use base names ("osx", "windows", "linux") even on ARM,
    /// but may also use arch-specific names (e.g. "osx-arm64").
    ///
    /// Base names like `"osx"` match ALL variants of that OS (Intel + ARM64).
    /// Architecture selection is handled via the library's classifier (e.g.
    /// `natives-macos-arm64`), not via rule names. Arch-qualified names like
    /// `"osx-arm64"` match only the specific ARM variant.
    pub fn matches_rule_os_name(&self, rule_name: &str) -> bool {
        let name = rule_name.to_lowercase();
        match self {
            OsType::Windows => name == "windows",
            OsType::WindowsArm64 => name == "windows" || name == "windows-arm64",
            OsType::MacOS => name == "osx" || name == "macos",
            OsType::MacOSArm64 => {
                name == "osx" || name == "macos" || name == "osx-arm64" || name == "macos-arm64"
            }
            OsType::Linux => name == "linux",
            OsType::LinuxArm32 => name == "linux" || name == "linux-arm32",
            OsType::LinuxArm64 => name == "linux" || name == "linux-arm64",
        }
    }

    /// Check whether this is an ARM architecture variant.
    pub fn is_arm(&self) -> bool {
        matches!(
            self,
            OsType::WindowsArm64 | OsType::MacOSArm64 | OsType::LinuxArm64 | OsType::LinuxArm32
        )
    }

    /// Check whether a native library classifier string matches this OS.
    ///
    /// Handles the "osx"/"macos" interchangeability found in real-world
    /// manifests, as well as architecture-specific suffixes (arm64, x86_64, etc.).
    /// Non-native classifiers (those without "natives" or "native" in the string)
    /// are always considered applicable.
    pub fn classifier_matches(&self, classifier: &str) -> bool {
        let cl = classifier.to_lowercase();

        // Non-native classifiers are always applicable
        let is_native = cl.contains("natives") || cl.contains("native");
        if !is_native {
            return true;
        }

        // --- OS matching ---
        let is_macos = matches!(self, OsType::MacOS | OsType::MacOSArm64);
        let is_windows = matches!(self, OsType::Windows | OsType::WindowsArm64);
        let is_linux = matches!(
            self,
            OsType::Linux | OsType::LinuxArm32 | OsType::LinuxArm64
        );

        let os_match = if is_macos {
            cl.contains("osx") || cl.contains("macos")
        } else if is_windows {
            cl.contains("windows") || cl.contains("win")
        } else if is_linux {
            cl.contains("linux")
        } else {
            false
        };

        if !os_match {
            return false;
        }

        // --- Architecture matching ---
        let target_is_arm64 = matches!(
            self,
            OsType::MacOSArm64 | OsType::LinuxArm64 | OsType::WindowsArm64
        );
        let target_is_arm32 = matches!(self, OsType::LinuxArm32);
        let target_is_x64 = matches!(self, OsType::Windows | OsType::MacOS | OsType::Linux);

        if cl.contains("arm64") || cl.contains("aarch64") || cl.contains("aarch_64") {
            return target_is_arm64;
        }
        if cl.contains("arm32") || cl.contains("armv7") || cl.contains("armhf") {
            return target_is_arm32;
        }
        if cl.contains("x86_64") || cl.contains("x64") || cl.contains("amd64") {
            return target_is_x64;
        }
        // Plain x86 (32-bit) — allow on Windows/Linux x64 as fallback
        if cl.contains("x86") && !cl.contains("x86_64") {
            return matches!(self, OsType::Windows | OsType::Linux);
        }

        // No arch specifier in classifier → matches any arch for this OS
        true
    }

    /// Check if a native classifier should be rejected based on architecture policy.
    /// Used to filter libraries during selection when architecture-specific variants exist.
    ///
    /// # Parameters
    /// - `classifier`: The native classifier string (e.g., "natives-osx")
    /// - `has_arch_specific_variant`: Whether an architecture-specific variant exists (e.g., "natives-osx-arm64")
    ///
    /// # Returns
    /// true if the library should be skipped, false if it should be included.
    pub fn should_skip_generic_native(
        &self,
        classifier: &str,
        has_arch_specific_variant: bool,
    ) -> bool {
        // Only filter on ARM64 with PreferArchSpecificOnly policy
        if NATIVE_ARCH_POLICY != NativeArchitecturePolicy::PreferArchSpecificOnly {
            return false;
        }

        let target_is_arm64 = matches!(
            self,
            OsType::MacOSArm64 | OsType::LinuxArm64 | OsType::WindowsArm64
        );

        if !target_is_arm64 || !has_arch_specific_variant {
            return false;
        }

        // On ARM64 with arch-specific variant available, skip generic classifiers
        let cl = classifier.to_lowercase();
        let has_arch_specifier = cl.contains("arm64")
            || cl.contains("aarch64")
            || cl.contains("aarch_64")
            || cl.contains("x86_64")
            || cl.contains("x64")
            || cl.contains("amd64");

        !has_arch_specifier
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
