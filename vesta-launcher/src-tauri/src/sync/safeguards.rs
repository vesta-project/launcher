use anyhow::Result;
use std::path::Path;

/// Check if the instance's game directory is currently in use by a running
/// Java/Minecraft process. Returns Ok(()) if safe to proceed, or an error
/// describing why the update is blocked.
pub fn check_instance_not_running(game_dir: &Path) -> Result<()> {
    let system = sysinfo::System::new_all();

    let java_processes: Vec<String> = system
        .processes()
        .iter()
        .filter(|(_, proc)| {
            let name = proc.name().to_string_lossy().to_lowercase();
            name.contains("java") || name.contains("javaw")
        })
        .filter(|(_, proc)| process_uses_game_dir(game_dir, proc.cwd(), proc.cmd()))
        .map(|(pid, proc)| format!("{} ({})", proc.name().to_string_lossy(), pid))
        .collect();

    if !java_processes.is_empty() {
        anyhow::bail!(
            "Minecraft for this instance is still running. Running processes: {}",
            java_processes.join(", ")
        );
    }

    Ok(())
}

// Match complete path arguments (including --gameDir=... and the split
// `--gameDir /path` form), never arbitrary substrings or the word
// "minecraft", which also match unrelated instances.
fn process_uses_game_dir(game_dir: &Path, cwd: Option<&Path>, args: &[std::ffi::OsString]) -> bool {
    fn same_path(left: &Path, right: &Path) -> bool {
        let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
        let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
        if cfg!(windows) {
            left.to_string_lossy()
                .eq_ignore_ascii_case(&right.to_string_lossy())
        } else {
            left == right
        }
    }
    if cwd.is_some_and(|cwd| same_path(cwd, game_dir)) {
        return true;
    }
    let mut args = args.iter().map(|arg| arg.to_string_lossy());
    while let Some(arg) = args.next() {
        if let Some(path) = arg.strip_prefix("--gameDir=") {
            if same_path(Path::new(path), game_dir) {
                return true;
            }
            continue;
        }
        if arg == "--gameDir" {
            if let Some(path) = args.next() {
                if same_path(Path::new(path.as_ref()), game_dir) {
                    return true;
                }
            }
            continue;
        }
        // Keep exact path-token matching for launchers that put the game
        // directory on the command line without a --gameDir flag.
        if same_path(Path::new(arg.as_ref()), game_dir) {
            return true;
        }
    }
    false
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
    fn process_matching_is_scoped_to_exact_instance_paths() {
        let game = Path::new("/instances/pack");
        let args = |values: &[&str]| {
            values
                .iter()
                .map(std::ffi::OsString::from)
                .collect::<Vec<_>>()
        };
        assert!(process_uses_game_dir(game, Some(game), &[]));
        assert!(process_uses_game_dir(
            game,
            None,
            &args(&["--gameDir", "/instances/pack"])
        ));
        assert!(process_uses_game_dir(
            game,
            None,
            &args(&["--gameDir=/instances/pack"])
        ));
        assert!(!process_uses_game_dir(
            game,
            None,
            &args(&["--gameDir", "/instances/pack-other", "/instances/pack"])
        ));
        assert!(!process_uses_game_dir(
            game,
            Some(Path::new("/instances/pack-other")),
            &args(&["minecraft", "/instances/pack-other"])
        ));
        assert!(!process_uses_game_dir(
            game,
            None,
            &args(&["net.minecraft.client.main.Main"])
        ));
        // Lone --gameDir without a following path must not panic or match.
        assert!(!process_uses_game_dir(game, None, &args(&["--gameDir"])));
    }

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
