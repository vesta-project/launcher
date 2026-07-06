use anyhow::{Context, Result};
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

/// Rotate a world save folder: rename the active directory to a timestamped
/// quarantine folder so the user's data is preserved and the pack can place
/// a clean copy in the original location.
///
/// Example: `saves/MyWorld` → `saves/MyWorld_user_20260520_1337`
pub fn rotate_world_save(game_dir: &Path, world_path: &str, quarantine_path: &str) -> Result<()> {
    let source = game_dir.join(world_path);
    let target = game_dir.join(quarantine_path);

    // The world_path might point to level.dat; we want the parent folder
    let source_dir = if source.is_file() {
        source
            .parent()
            .context("World path has no parent directory")?
            .to_path_buf()
    } else {
        source.clone()
    };

    let target_dir = if target.is_file() {
        target
            .parent()
            .context("Quarantine path has no parent directory")?
            .to_path_buf()
    } else {
        target.clone()
    };

    if !source_dir.exists() {
        return Ok(());
    }

    // Ensure parent of target exists
    if let Some(parent) = target_dir.parent() {
        std::fs::create_dir_all(parent)?;
    }

    log::info!(
        "[safeguards] Rotating world save: {:?} → {:?}",
        source_dir,
        target_dir
    );

    std::fs::rename(&source_dir, &target_dir).with_context(|| {
        format!(
            "Failed to rotate world save {:?} to {:?}",
            source_dir, target_dir
        )
    })?;

    Ok(())
}

/// Handle a corrupted config file: rename it to `.corrupted` so the user can
/// inspect it later, and return the path to the corrupted backup.
pub fn quarantine_corrupted_config(game_dir: &Path, path: &str) -> Result<String> {
    let source = game_dir.join(path);
    let corrupted_path = format!("{}.corrupted", path);
    let target = game_dir.join(&corrupted_path);

    if source.exists() {
        std::fs::rename(&source, &target).with_context(|| {
            format!(
                "Failed to quarantine corrupted config {:?} to {:?}",
                source, target
            )
        })?;
    }

    Ok(corrupted_path)
}

/// Delete a file only if it still matches the expected content hash.
/// Expects sha1 (40 hex chars).
/// Returns true if the file was deleted.
pub fn safe_delete_if_unchanged(
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

    log::info!("[safeguards] Deleting {:?} (removed from modpack)", path);
    std::fs::remove_file(&full_path)
        .with_context(|| format!("Failed to delete {:?}", full_path))?;

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
