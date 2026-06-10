/// Represents the classification of a file for sync decision-making.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileClass {
    /// Binary files that can only be matched by hash (.jar, .zip, .png, etc.)
    Binary,
    /// Structured text files that support key-value delta merging
    Text,
}

/// Classify a file path into one of the three sync categories.
pub fn classify(path: &str) -> FileClass {
    let lower = path.to_lowercase();

    // World saves — special handling for level.dat collisions
    if lower.starts_with("saves/") || lower.starts_with("saves\\") {
        return FileClass::Binary;
    }

    // Tracked structured text configs
    if is_config_text(&lower) {
        return FileClass::Text;
    }

    // Everything else tracked is binary
    FileClass::Binary
}

/// Check if a file path represents a structured text config format
/// that supports key-value level merging.
fn is_config_text(lower_path: &str) -> bool {
    // Config directory files
    let in_config_dir = lower_path.starts_with("config/") || lower_path.starts_with("config\\");

    // Known config extensions
    let has_config_ext = lower_path.ends_with(".properties")
        || lower_path.ends_with(".toml")
        || lower_path.ends_with(".json")
        || lower_path.ends_with(".cfg")
        || lower_path.ends_with(".config")
        || lower_path.ends_with(".yml")
        || lower_path.ends_with(".yaml")
        || lower_path.ends_with(".txt");

    // options.txt and servers.dat are user files, not pack configs
    let is_user_file = lower_path == "options.txt"
        || lower_path == "servers.dat"
        || lower_path == "optionsof.txt"
        || lower_path == "hotbar.nbt";

    in_config_dir || (has_config_ext && !is_user_file)
}

/// Determine if a path should be treated as a world save that needs rotation.
/// World folder path from a `level.dat` path (e.g. `saves/MyWorld/level.dat` → `saves/MyWorld`).
pub fn world_folder_from_level_dat(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    if !normalized.ends_with("level.dat") {
        return None;
    }
    std::path::Path::new(&normalized)
        .parent()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}

pub fn is_world_save(path: &str) -> bool {
    let lower = path.to_lowercase();
    (lower.starts_with("saves/") || lower.starts_with("saves\\")) && lower.ends_with("level.dat")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_binary() {
        assert_eq!(classify("mods/jei.jar"), FileClass::Binary);
        assert_eq!(classify("resourcepacks/faithful.zip"), FileClass::Binary);
        assert_eq!(classify("shaderpacks/shader.zip"), FileClass::Binary);
        assert_eq!(classify("saves/MyWorld/level.dat"), FileClass::Binary);
    }

    #[test]
    fn test_classify_text() {
        assert_eq!(classify("config/modmenu.properties"), FileClass::Text);
        assert_eq!(classify("config/sodium-options.json"), FileClass::Text);
        assert_eq!(classify("config/modpack.toml"), FileClass::Text);
        assert_eq!(classify("config/forge.cfg"), FileClass::Text);
    }

    #[test]
    fn test_classify_user_files_not_text() {
        assert_eq!(classify("options.txt"), FileClass::Binary);
        assert_eq!(classify("servers.dat"), FileClass::Binary);
    }

    #[test]
    fn test_world_folder_from_level_dat() {
        assert_eq!(
            world_folder_from_level_dat("saves/MyWorld/level.dat").as_deref(),
            Some("saves/MyWorld")
        );
    }

    fn test_is_world_save() {
        assert!(is_world_save("saves/MyWorld/level.dat"));
        assert!(!is_world_save("mods/level.dat"));
    }
}
