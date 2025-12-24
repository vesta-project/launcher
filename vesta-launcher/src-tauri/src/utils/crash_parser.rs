use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Crash details extracted from logs and files
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CrashDetails {
    pub crash_type: String, // "runtime", "launch_mod", "launch_other", "jvm"
    pub message: String,
    pub report_path: Option<String>, // Path to crash report file
    pub timestamp: String,
}

/// Parse crash information from game logs and files
///
/// Checks for:
/// 1. Runtime crashes: "Reported exception thrown!" in latest.log
/// 2. Mod launch crashes: "Incompatible mods found!" or "FormattedException" in latest.log
/// 3. JVM crashes: hs_err_pidXXXXX.log files modified after launch
/// 4. Other launch errors: "[main/ERROR]:" early in latest.log
pub fn detect_crash(
    game_dir: &Path,
    log_file: &Path,
    launch_start_time: SystemTime,
) -> Option<CrashDetails> {
    // First check for JVM crash files (highest priority - indicates severe crash)
    if let Some(crash) = check_jvm_crash(game_dir, launch_start_time) {
        return Some(crash);
    }

    // Then check log file for runtime or launch crashes
    if let Ok(log_content) = fs::read_to_string(log_file) {
        // Check for runtime crash
        if let Some(crash) = check_runtime_crash(&log_content, game_dir) {
            return Some(crash);
        }

        // Check for mod/launch crashes
        if let Some(crash) = check_launch_crash(&log_content) {
            return Some(crash);
        }
    }

    None
}

/// Check for runtime exceptions in latest.log
fn check_runtime_crash(log_content: &str, game_dir: &Path) -> Option<CrashDetails> {
    if log_content.contains("[Render thread/ERROR]: Reported exception thrown!") {
        // Extract the exception message
        let lines: Vec<&str> = log_content.lines().collect();
        let mut message = "Game crashed with an exception".to_string();

        for (i, line) in lines.iter().enumerate() {
            if line.contains("Reported exception thrown!") && i + 1 < lines.len() {
                // Next line typically has the exception type
                message = lines[i + 1].trim().to_string();
                break;
            }
        }

        // Look for crash report file in crash-reports directory
        let crash_reports_dir = game_dir.join("crash-reports");
        let report_path = find_latest_crash_report(&crash_reports_dir);

        return Some(CrashDetails {
            crash_type: "runtime".to_string(),
            message,
            report_path,
            timestamp: chrono::Utc::now().to_rfc3339(),
        });
    }

    None
}

/// Check for launch failures (mod incompatibilities, loader errors)
fn check_launch_crash(log_content: &str) -> Option<CrashDetails> {
    // Check for mod incompatibility errors (Fabric/Quilt)
    if log_content.contains("[main/ERROR]: Incompatible mods found!") {
        let message = extract_mod_error_message(log_content)
            .unwrap_or_else(|| "Incompatible mods detected".to_string());

        return Some(CrashDetails {
            crash_type: "launch_mod".to_string(),
            message,
            report_path: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        });
    }

    // Check for Fabric FormattedException
    if log_content.contains("net.fabricmc.loader.impl.FormattedException") {
        let message = extract_mod_error_message(log_content)
            .unwrap_or_else(|| "Mod loader error - check mod compatibility".to_string());

        return Some(CrashDetails {
            crash_type: "launch_mod".to_string(),
            message,
            report_path: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        });
    }

    // Check for Quilt loader errors
    if log_content.contains("net.quiltmc.loader.impl.FormattedException") {
        let message = extract_mod_error_message(log_content)
            .unwrap_or_else(|| "Mod loader error - check mod compatibility".to_string());

        return Some(CrashDetails {
            crash_type: "launch_mod".to_string(),
            message,
            report_path: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        });
    }

    // Check for other early main thread errors (before rendering)
    if log_content.contains("[main/ERROR]:") && !log_content.contains("[Render thread/ERROR]") {
        let message = "Game failed to launch - check logs for details".to_string();

        return Some(CrashDetails {
            crash_type: "launch_other".to_string(),
            message,
            report_path: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        });
    }

    None
}

/// Check for JVM crash files (hs_err_pidXXXXX.log) created after launch start
fn check_jvm_crash(game_dir: &Path, launch_start_time: SystemTime) -> Option<CrashDetails> {
    // Look for hs_err files in game directory
    if let Ok(entries) = fs::read_dir(game_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(filename) = path.file_name() {
                if let Some(name_str) = filename.to_str() {
                    if name_str.starts_with("hs_err_pid") && name_str.ends_with(".log") {
                        // Check if this file was modified after launch
                        if let Ok(metadata) = fs::metadata(&path) {
                            if let Ok(modified_time) = metadata.modified() {
                                if modified_time > launch_start_time {
                                    log::error!("JVM crash detected: {:?}", path);

                                    return Some(CrashDetails {
                                        crash_type: "jvm".to_string(),
                                        message: "Java Virtual Machine crashed".to_string(),
                                        report_path: path.to_string_lossy().to_string().into(),
                                        timestamp: chrono::Utc::now().to_rfc3339(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

/// Extract a meaningful error message from mod error logs
fn extract_mod_error_message(log_content: &str) -> Option<String> {
    let lines: Vec<&str> = log_content.lines().collect();

    for (i, line) in lines.iter().enumerate() {
        // Look for "Mod" or "requires" patterns that indicate the error
        if line.contains("requires") || line.contains("missing") || line.contains("Missing") {
            return Some(line.trim().to_string());
        }

        // Look for error descriptions after "Reason:" or "Fix:"
        if line.contains("Reason:") && i + 1 < lines.len() {
            return Some(lines[i + 1].trim().to_string());
        }
    }

    // Fallback: return the first ERROR line after main/ERROR
    for line in lines {
        if line.contains("[main/ERROR]:") {
            return Some(line.trim().to_string());
        }
    }

    None
}

/// Find the most recent crash report in crash-reports directory
fn find_latest_crash_report(crash_reports_dir: &Path) -> Option<String> {
    let mut latest_file: Option<(PathBuf, SystemTime)> = None;

    if let Ok(entries) = fs::read_dir(crash_reports_dir) {
        for entry in entries.flatten() {
            let path = entry.path();

            // Look for crash-YYYY-MM-DD_HH.MM.SS-client.txt pattern
            if let Some(filename) = path.file_name() {
                if let Some(name_str) = filename.to_str() {
                    if name_str.starts_with("crash-") && name_str.ends_with(".txt") {
                        if let Ok(metadata) = fs::metadata(&path) {
                            if let Ok(modified_time) = metadata.modified() {
                                match latest_file {
                                    None => latest_file = Some((path, modified_time)),
                                    Some((_, prev_time)) if modified_time > prev_time => {
                                        latest_file = Some((path, modified_time))
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    latest_file.map(|(path, _)| path.to_string_lossy().to_string())
}
