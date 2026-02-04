//! Process state persistence for console streaming and app reattachment
//!
//! When a game instance is launched, we persist minimal metadata (instance_id, pid, log_path)
//! so that if the app is closed and reopened while the game is still running, we can
//! automatically re-attach to it and resume console streaming.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Minimal state for a running instance, persisted to allow re-attachment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceRunState {
    /// Instance slug (unique identifier)
    pub instance_id: String,

    /// Process ID
    pub pid: u32,

    /// Path to the log file
    pub log_file: PathBuf,

    /// Game directory
    pub game_dir: PathBuf,

    /// Minecraft version
    pub version_id: String,

    /// Modloader type (if any)
    pub modloader: Option<String>,

    /// Timestamp when the process was started
    pub started_at: String,
}

/// Get the path to the process state file in app data
fn get_process_state_file() -> Result<PathBuf> {
    let app_dir = crate::utils::db_manager::get_app_config_dir()?;
    Ok(app_dir.join("running_processes.json"))
}

/// Load all persisted running process states
pub fn load_running_processes() -> Result<Vec<InstanceRunState>> {
    let path = get_process_state_file()?;

    if !path.exists() {
        return Ok(Vec::new());
    }

    let data = std::fs::read_to_string(&path).context("Failed to read running processes file")?;

    serde_json::from_str(&data).context("Failed to parse running processes JSON")
}

/// Save or update process states
pub fn save_running_processes(processes: &[InstanceRunState]) -> Result<()> {
    let path = get_process_state_file()?;

    let data =
        serde_json::to_string_pretty(processes).context("Failed to serialize running processes")?;

    std::fs::write(&path, data).context("Failed to write running processes file")?;

    Ok(())
}

/// Add a new running process to the persistent state
pub fn add_running_process(state: InstanceRunState) -> Result<()> {
    let mut processes = load_running_processes().unwrap_or_default();

    // Remove duplicate if exists
    processes.retain(|p| p.instance_id != state.instance_id);

    // Add new
    processes.push(state);

    save_running_processes(&processes)?;

    Ok(())
}

/// Remove a running process from persistent state
pub fn remove_running_process(instance_id: &str) -> Result<()> {
    let mut processes = load_running_processes().unwrap_or_default();

    processes.retain(|p| p.instance_id != instance_id);

    save_running_processes(&processes)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_state_serde() {
        let state = InstanceRunState {
            instance_id: "test-instance".to_string(),
            pid: 1234,
            log_file: PathBuf::from("/tmp/test.log"),
            game_dir: PathBuf::from("/tmp/game"),
            version_id: "1.20.1".to_string(),
            modloader: None,
            started_at: "2025-12-17T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&state).unwrap();
        let deserialized: InstanceRunState = serde_json::from_str(&json).unwrap();

        assert_eq!(state.instance_id, deserialized.instance_id);
        assert_eq!(state.pid, deserialized.pid);
    }
}
