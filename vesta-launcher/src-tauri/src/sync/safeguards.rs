use anyhow::Result;
use std::path::Path;

/// Check if the instance's game directory is currently in use by a running
/// Java/Minecraft process. Returns Ok(()) if safe to proceed, or an error
/// describing why the update is blocked.
pub fn check_instance_not_running(game_dir: &Path) -> Result<()> {
    let game_dir_str = game_dir.to_string_lossy().to_lowercase();

    // Use sysinfo to enumerate all processes
    let mut system = sysinfo::System::new_all();
    system.refresh_all();

    let java_processes: Vec<String> = system
        .processes()
        .iter()
        .filter(|(_, proc)| {
            let name = proc.name().to_string_lossy().to_lowercase();
            name.contains("java") || name.contains("javaw")
        })
        .filter(|(_, proc)| {
            // Check if this process has the game directory open
            // We check the process's CWD and command line
            let cwd = proc
                .cwd()
                .map(|p| p.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            let cmd: String = proc
                .cmd()
                .iter()
                .map(|s| s.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase();

            cwd.contains(&game_dir_str) || cmd.contains(&game_dir_str) || cmd.contains("minecraft")
        })
        .map(|(pid, proc)| format!("{} ({})", proc.name().to_string_lossy(), pid))
        .collect();

    if !java_processes.is_empty() {
        anyhow::bail!(
            "Cannot update while Minecraft is running. Running processes: {}",
            java_processes.join(", ")
        );
    }

    Ok(())
}

/// Normalize a file path to lowercase for case-insensitive comparison.
/// This prevents duplicate mod files on Linux/macOS when a modpack author
/// changes casing (e.g., JEI.jar → jei.jar).
#[cfg(test)]
pub fn normalize_path(path: &str) -> String {
    path.to_lowercase()
}

/// Return whether a removal candidate still matches its expected content hash.
/// The update transaction moves approved paths into its rollback directory
/// rather than deleting them directly.
pub fn can_delete_if_unchanged(
    game_dir: &Path,
    path: &str,
    expected_hash: Option<&str>,
) -> Result<bool> {
    let full_path = game_dir.join(path);

    if !full_path.exists() {
        return Ok(false);
    }

    if let Some(expected) = expected_hash {
        let matches = super::hash_util::file_matches_hash(&full_path, expected)?;
        if !matches {
            log::info!(
                "[safeguards] Not deleting {:?}: hash changed (user modified)",
                path
            );
            return Ok(false);
        }
    }

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_path() {
        assert_eq!(normalize_path("Mods/JEI.jar"), "mods/jei.jar");
        assert_eq!(
            normalize_path("CONFIG/TEST.PROPERTIES"),
            "config/test.properties"
        );
    }

    #[test]
    fn test_check_instance_not_running_no_java() {
        // This test just verifies the function doesn't panic
        // with non-existent directories
        let result = check_instance_not_running(Path::new("/tmp/nonexistent_game_dir_12345"));
        // May succeed (no java process) or error on Windows with weird path
        // Just verify it doesn't panic
        let _ = result;
    }
}
