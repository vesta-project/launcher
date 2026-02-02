use piston_lib::game::installer::core::jre_manager;
use std::path::PathBuf;
use crate::utils::db_manager::get_app_config_dir;

pub fn get_managed_jre_dir() -> Result<PathBuf, String> {
    get_app_config_dir()
        .map(|d| d.join("data").join("jre"))
        .map_err(|e| e.to_string())
}

pub fn scan_system_javas_filtered() -> Vec<jre_manager::DetectedJava> {
    let mut javas = jre_manager::scan_system_javas();
    
    // Filter out javas that are in our managed directory
    if let Ok(managed_dir) = get_managed_jre_dir() {
        if managed_dir.exists() {
            javas.retain(|java| {
                !java.path.starts_with(&managed_dir)
            });
        }
    }
    
    javas
}

pub fn get_managed_javas() -> Vec<jre_manager::DetectedJava> {
    let mut managed_javas = Vec::new();
    if let Ok(managed_dir) = get_managed_jre_dir() {
        if managed_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&managed_dir) {
                for entry in entries.flatten() {
                    let entry_path = entry.path();
                    if entry_path.is_dir() {
                        if let Some(java_exe) = jre_manager::find_java_executable(&entry_path) {
                            if let Ok(info) = jre_manager::verify_java(&java_exe) {
                                managed_javas.push(info);
                            }
                        }
                    }
                }
            }
        }
    }
    managed_javas
}

pub fn get_required_java_for_version(mc_version: &str) -> u32 {
    // Simple heuristic for common versions
    // 1.20.5+ -> 21
    // 1.18 - 1.20.4 -> 17
    // 1.17 -> 16
    // < 1.17 -> 8
    
    if mc_version.contains("1.21") || mc_version.contains("1.20.5") || mc_version.contains("1.20.6") || mc_version.starts_with("24w") || mc_version.starts_with("25w") {
        return 21;
    }
    
    if mc_version.contains("1.18") || mc_version.contains("1.19") || mc_version.contains("1.20") {
        return 17;
    }
    
    if mc_version.contains("1.17") {
        return 16;
    }
    
    8
}
