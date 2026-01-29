/// Core types for game launching
use crate::game::metadata::ModloaderType;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Specification for launching a game instance
#[derive(Debug, Clone)]
pub struct LaunchSpec {
    /// Unique identifier for this instance
    pub instance_id: String,

    /// Minecraft version ID (e.g., "1.20.1")
    pub version_id: String,

    /// Modloader type (if any)
    pub modloader: Option<ModloaderType>,

    /// Modloader version (if applicable)
    pub modloader_version: Option<String>,

    /// Root data directory
    pub data_dir: PathBuf,

    /// Instance-specific game directory
    pub game_dir: PathBuf,

    /// Java executable path
    pub java_path: PathBuf,

    /// Player username
    pub username: String,

    /// Player UUID
    pub uuid: String,

    /// Access token for authentication
    pub access_token: String,

    /// User type ("msa" or "legacy")
    pub user_type: String,

    /// Xbox User ID (optional, but recommended for MSA)
    pub xuid: Option<String>,

    /// Custom JVM arguments (overrides defaults)
    pub jvm_args: Vec<String>,

    /// Custom game arguments (appended to defaults)
    pub game_args: Vec<String>,

    /// Window width (optional)
    pub window_width: Option<u32>,

    /// Window height (optional)
    pub window_height: Option<u32>,

    /// Minimum memory in MB (optional)
    pub min_memory: Option<u32>,

    /// Maximum memory in MB (optional)
    pub max_memory: Option<u32>,

    /// Client ID (used by OAuth flows / launcher arguments)
    pub client_id: String,

    /// Path to exit handler JAR for tracking game exit (optional)
    pub exit_handler_jar: Option<PathBuf>,

    /// Path to log file for this instance
    pub log_file: Option<PathBuf>,
}

impl LaunchSpec {
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

    /// Get the path to the natives directory for this version (natives are shared per version)
    pub fn natives_dir(&self) -> PathBuf {
        // Keep the layout consistent with the installer (which uses version_id)
        self.data_dir.join("natives").join(&self.version_id)
    }

    /// Compute the canonical installed version id to use on-disk when launching
    /// a modloader-installed version. Example: "fabric-loader-0.38.2-1.20.1".
    /// For vanilla launches this returns the raw minecraft version id.
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

/// Result of launching a game
#[derive(Debug)]
pub struct LaunchResult {
    /// The running game instance
    pub instance: GameInstance,

    /// Path to the log file
    pub log_file: PathBuf,
}

/// Handle to a running process
#[derive(Debug)]
pub struct ProcessHandle {
    /// Process ID
    pub pid: u32,

    /// Child process handle (optional for reattachment scenarios)
    pub child: Option<tokio::process::Child>,
}

/// Represents a running game instance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameInstance {
    /// Unique instance identifier
    pub instance_id: String,

    /// Minecraft version ID
    pub version_id: String,

    /// Modloader type (if any)
    pub modloader: Option<ModloaderType>,

    /// Process ID
    pub pid: u32,

    /// When the instance was started
    #[serde(with = "chrono::serde::ts_seconds")]
    pub started_at: chrono::DateTime<chrono::Utc>,

    /// Path to the log file
    pub log_file: PathBuf,

    /// Game directory
    pub game_dir: PathBuf,
}

/// Serializable state for persistence
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceState {
    /// Unique instance identifier
    pub instance_id: String,

    /// Minecraft version ID
    pub version_id: String,

    /// Modloader type as string
    pub modloader: Option<String>,

    /// Process ID
    pub pid: u32,

    /// ISO 8601 timestamp
    pub started_at: String,

    /// Path to the log file
    pub log_file: PathBuf,

    /// Game directory
    pub game_dir: PathBuf,
}

impl From<&GameInstance> for InstanceState {
    fn from(instance: &GameInstance) -> Self {
        Self {
            instance_id: instance.instance_id.clone(),
            version_id: instance.version_id.clone(),
            modloader: instance.modloader.as_ref().map(|m| m.to_string()),
            pid: instance.pid,
            started_at: instance.started_at.to_rfc3339(),
            log_file: instance.log_file.clone(),
            game_dir: instance.game_dir.clone(),
        }
    }
}

impl TryFrom<InstanceState> for GameInstance {
    type Error = anyhow::Error;

    fn try_from(state: InstanceState) -> Result<Self, Self::Error> {
        Ok(Self {
            instance_id: state.instance_id,
            version_id: state.version_id,
            modloader: state.modloader.map(|s| s.parse()).transpose()?,
            pid: state.pid,
            started_at: chrono::DateTime::parse_from_rfc3339(&state.started_at)?
                .with_timezone(&chrono::Utc),
            log_file: state.log_file,
            game_dir: state.game_dir,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launchspec_installed_id_vanilla() {
        let spec = LaunchSpec {
            instance_id: "x".to_string(),
            version_id: "1.20.1".to_string(),
            modloader: None,
            modloader_version: None,
            data_dir: std::path::PathBuf::from("/tmp"),
            game_dir: std::path::PathBuf::from("/tmp/g"),
            java_path: std::path::PathBuf::from("/tmp/java"),
            username: "player".to_string(),
            uuid: "0000".to_string(),
            access_token: "tok".to_string(),
            user_type: "msa".to_string(),
            xuid: None,
            jvm_args: vec![],
            game_args: vec![],
            window_width: None,
            window_height: None,
            min_memory: None,
            max_memory: None,
            client_id: "cid".to_string(),
            exit_handler_jar: None,
            log_file: None,
        };

        assert_eq!(spec.installed_version_id(), "1.20.1");
    }

    #[test]
    fn launchspec_installed_id_modloader() {
        let spec = LaunchSpec {
            instance_id: "x".to_string(),
            version_id: "1.20.1".to_string(),
            modloader: Some(crate::game::metadata::ModloaderType::Forge),
            modloader_version: Some("47.2.0".to_string()),
            data_dir: std::path::PathBuf::from("/tmp"),
            game_dir: std::path::PathBuf::from("/tmp/g"),
            java_path: std::path::PathBuf::from("/tmp/java"),
            username: "player".to_string(),
            uuid: "0000".to_string(),
            access_token: "tok".to_string(),
            user_type: "msa".to_string(),
            xuid: None,
            jvm_args: vec![],
            game_args: vec![],
            window_width: None,
            window_height: None,
            min_memory: None,
            max_memory: None,
            client_id: "cid".to_string(),
            exit_handler_jar: None,
            log_file: None,
        };

        assert_eq!(spec.installed_version_id(), "forge-loader-47.2.0-1.20.1");
    }
}
