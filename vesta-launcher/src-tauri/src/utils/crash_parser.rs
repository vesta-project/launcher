use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// A structured suspect extracted from crash logs
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CrashSuspect {
    pub display_name: String,
    pub mod_id: Option<String>,
    pub reason: Option<String>,
    pub suspect_kind: String, // "affected_mod" | "missing_dependency"
}

/// Crash details extracted from logs and files
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CrashDetails {
    pub crash_id: String,
    pub crash_type: String, // "runtime", "launch_mod", "launch_other", "jvm"
    pub category: String,
    pub title: String,
    pub message: String,
    pub evidence: Option<String>,
    pub suspected_resources: Vec<String>,
    pub suspects: Vec<CrashSuspect>,
    pub suggested_fixes: Vec<String>,
    pub affected_mod_count: Option<u32>,
    pub report_path: Option<String>, // Path to crash report file
    pub log_path: Option<String>,
    pub timestamp: String,
    pub confidence: f32,
    pub mclogs_url: Option<String>,
    pub analysis: Option<serde_json::Value>,
}

struct FabricCrashParse {
    message: String,
    suspects: Vec<CrashSuspect>,
    evidence: Option<String>,
    affected_mod_count: Option<u32>,
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
        if let Some(crash) =
            check_runtime_crash(&log_content, game_dir, log_file, launch_start_time)
        {
            return Some(crash);
        }

        // Check for mod/launch crashes
        if let Some(crash) = check_launch_crash(&log_content, log_file) {
            return Some(crash);
        }
    }

    None
}

/// Check for runtime exceptions in latest.log
fn check_runtime_crash(
    log_content: &str,
    game_dir: &Path,
    log_file: &Path,
    launch_start_time: SystemTime,
) -> Option<CrashDetails> {
    if log_content.contains("[Render thread/ERROR]: Reported exception thrown!") {
        let lines: Vec<&str> = log_content.lines().collect();
        let mut message = "Game crashed while running".to_string();

        for (i, line) in lines.iter().enumerate() {
            if line.contains("Reported exception thrown!") && i + 1 < lines.len() {
                message = lines[i + 1].trim().to_string();
                break;
            }
        }

        let crash_reports_dir = game_dir.join("crash-reports");
        let report_path = find_latest_crash_report(&crash_reports_dir, Some(launch_start_time));
        let evidence = extract_evidence(log_content, &["Reported exception thrown", &message]);
        let suspects = generic_suspects(log_content);

        return Some(build_crash(
            "runtime",
            "runtime",
            "Runtime crash",
            message,
            evidence,
            suspects,
            vec![
                "Disable recently added mods and retry.".to_string(),
                "Check the crash report for the first mod-owned stack frame.".to_string(),
            ],
            None,
            report_path,
            Some(log_file.to_string_lossy().to_string()),
            0.82,
        ));
    }

    None
}

/// Check for launch failures (mod incompatibilities, loader errors)
fn check_launch_crash(log_content: &str, log_file: &Path) -> Option<CrashDetails> {
    let lower = log_content.to_lowercase();
    let mod_markers = [
        "incompatible mods found",
        "formattedexception",
        "modloadingexception",
        "missing or unsupported mandatory dependencies",
        "missing mandatory dependencies",
        "duplicatemodsfoundexception",
        "duplicate mods",
        "wrong minecraft version",
        "requires version",
        "requires any version",
        "requires mod",
        "depends on",
        "bad mixin config",
        "mixin apply failed",
    ];

    if mod_markers.iter().any(|marker| lower.contains(marker)) {
        let category = if lower.contains("duplicate") {
            "duplicate_mod"
        } else if lower.contains("mixin") {
            "mixin"
        } else if lower.contains("missing")
            || lower.contains("requires")
            || lower.contains("depends on")
        {
            "missing_dependency"
        } else {
            "mod_incompatibility"
        };

        let fabric_parse = parse_fabric_formatted_exception(log_content);
        let (message, suspects, evidence, affected_mod_count) = if let Some(parsed) = fabric_parse {
            (
                parsed.message,
                parsed.suspects,
                parsed.evidence,
                parsed.affected_mod_count,
            )
        } else {
            let message = extract_mod_error_message(log_content).unwrap_or_else(|| {
                "Mod loader stopped launch because the mod set is incompatible".to_string()
            });
            let evidence = extract_launch_mod_evidence(log_content, &mod_markers);
            (message, generic_suspects(log_content), evidence, None)
        };

        return Some(build_crash(
            "launch_mod",
            category,
            "Mod compatibility problem",
            message,
            evidence,
            suspects,
            mod_suggestions(category),
            affected_mod_count,
            None,
            Some(log_file.to_string_lossy().to_string()),
            0.9,
        ));
    }

    if lower.contains("unsupportedclassversionerror")
        || lower.contains("compiled by a more recent version of the java runtime")
        || lower.contains("class file version")
    {
        let message = extract_line(
            log_content,
            &["UnsupportedClassVersionError", "more recent version"],
        )
        .unwrap_or_else(|| "A mod or loader needs a newer Java runtime".to_string());

        return Some(build_crash(
            "launch_other",
            "java_version",
            "Java version mismatch",
            message,
            extract_evidence(
                log_content,
                &["UnsupportedClassVersionError", "more recent version"],
            ),
            generic_suspects(log_content),
            vec![
                "Switch this instance to the Java version required by its loader/mods.".to_string(),
                "Update the managed Java runtime and launch again.".to_string(),
            ],
            None,
            None,
            Some(log_file.to_string_lossy().to_string()),
            0.88,
        ));
    }

    if log_content.contains("[main/ERROR]:") && !log_content.contains("[Render thread/ERROR]") {
        let message = extract_line(log_content, &["[main/ERROR]:"])
            .unwrap_or_else(|| "Game failed before the window finished launching".to_string());

        return Some(build_crash(
            "launch_other",
            "launch",
            "Launch failed",
            message,
            extract_evidence(log_content, &["[main/ERROR]:"]),
            generic_suspects(log_content),
            vec!["Open the log and check the first error above the stack trace.".to_string()],
            None,
            None,
            Some(log_file.to_string_lossy().to_string()),
            0.62,
        ));
    }

    None
}

/// Parse Fabric FormattedException mod-resolution failures
fn parse_fabric_formatted_exception(log_content: &str) -> Option<FabricCrashParse> {
    if !log_content.contains("Incompatible mods found!")
        && !log_content.contains("FormattedException")
    {
        return None;
    }

    let mut missing_deps: Vec<CrashSuspect> = Vec::new();
    let mut affected_mods: Vec<CrashSuspect> = Vec::new();
    let mut evidence_lines: Vec<String> = Vec::new();
    let mut in_evidence = false;
    let mut in_details = false;
    let mut solution_bullets: Vec<String> = Vec::new();

    for line in log_content.lines() {
        let trimmed = strip_log_prefix(line);
        let trimmed_lower = trimmed.to_lowercase();

        if trimmed_lower.contains("a potential solution has been determined") {
            in_evidence = true;
            evidence_lines.push(trimmed.to_string());
            continue;
        }

        if trimmed_lower.contains("more details:") {
            in_details = true;
            in_evidence = true;
            evidence_lines.push(trimmed.to_string());
            continue;
        }

        if in_evidence {
            if trimmed.starts_with("at net.fabricmc")
                || trimmed.starts_with("at java.")
                || trimmed.is_empty() && in_details
            {
                if in_details && trimmed.is_empty() {
                    continue;
                }
                if trimmed.starts_with("at ") {
                    break;
                }
            }
            if !trimmed.is_empty() {
                evidence_lines.push(trimmed.to_string());
            }
        }

        if let Some(bullet) = parse_install_bullet(trimmed) {
            solution_bullets.push(bullet.clone());
            if let Some(suspect) = missing_dep_from_install_bullet(&bullet) {
                push_unique_suspect(&mut missing_deps, suspect);
            }
        }

        if in_details || trimmed.contains("Mod '") {
            if let Some((display_name, mod_id, reason)) = parse_fabric_mod_line(trimmed) {
                push_unique_suspect(
                    &mut affected_mods,
                    CrashSuspect {
                        display_name,
                        mod_id: Some(mod_id),
                        reason,
                        suspect_kind: "affected_mod".to_string(),
                    },
                );
            }

            if let Some((dep_id, version_clause)) =
                parse_missing_dependency_from_detail_line(trimmed)
            {
                push_unique_suspect(
                    &mut missing_deps,
                    CrashSuspect {
                        display_name: humanize_mod_id(&dep_id),
                        mod_id: Some(dep_id),
                        reason: Some(version_clause),
                        suspect_kind: "missing_dependency".to_string(),
                    },
                );
            }
        }
    }

    if missing_deps.is_empty() && affected_mods.is_empty() && solution_bullets.is_empty() {
        return None;
    }

    collapse_fabric_api_dependencies(&mut missing_deps);

    let affected_mod_count = if affected_mods.is_empty() {
        None
    } else {
        Some(affected_mods.len() as u32)
    };

    let message =
        build_fabric_primary_message(&solution_bullets, &missing_deps, affected_mods.len());

    let single_root_cause = missing_deps.len() == 1;

    let mut suspects = missing_deps;
    for affected in affected_mods {
        push_unique_suspect(&mut suspects, affected);
    }

    // Keep missing deps intact; only cap affected mods when the list is unusually large.
    if !single_root_cause {
        suspects.truncate(32);
    }

    let evidence = if evidence_lines.is_empty() {
        None
    } else {
        Some(evidence_lines.join("\n"))
    };

    Some(FabricCrashParse {
        message,
        suspects,
        evidence,
        affected_mod_count,
    })
}

fn build_fabric_primary_message(
    solution_bullets: &[String],
    missing_deps: &[CrashSuspect],
    affected_count: usize,
) -> String {
    let base = if missing_deps.len() == 1 {
        let missing = &missing_deps[0];
        let version = missing
            .reason
            .as_deref()
            .unwrap_or("any compatible version");
        format!("Install {}, {}", missing.display_name, version)
    } else if let Some(bullet) = solution_bullets
        .iter()
        .find(|bullet| !bullet.to_lowercase().starts_with("replace mod"))
    {
        format!("Install {}", bullet)
    } else if !missing_deps.is_empty() {
        let names: Vec<String> = missing_deps
            .iter()
            .map(|m| m.display_name.clone())
            .collect();
        format!("Install missing dependencies: {}", names.join(", "))
    } else {
        "Some mods are incompatible or missing dependencies.".to_string()
    };

    if affected_count > 1 && missing_deps.len() == 1 {
        format!("{} ({} mods affected)", base, affected_count)
    } else {
        base
    }
}

fn parse_missing_dependency_from_detail_line(line: &str) -> Option<(String, String)> {
    if !line.contains("which is missing") {
        return None;
    }

    let requires_marker = " requires ";
    let requires_idx = line.find(requires_marker)?;
    let after_requires = &line[requires_idx + requires_marker.len()..];
    let of_marker = " of ";
    let of_idx = after_requires.find(of_marker)?;
    let version_clause = after_requires[..of_idx].trim().trim_end_matches(',');
    let after_of = &after_requires[of_idx + of_marker.len()..];
    let end_marker = ", which is missing";
    let end_idx = after_of.find(end_marker)?;
    let dep_id = after_of[..end_idx].trim();

    if dep_id.is_empty() || version_clause.is_empty() {
        return None;
    }

    Some((dep_id.to_string(), version_clause.to_string()))
}

fn parse_install_bullet(line: &str) -> Option<String> {
    let trimmed = line.trim();
    let rest = trimmed.strip_prefix("- Install ")?;
    let cleaned = rest.trim_end_matches('.').trim();
    if cleaned.is_empty() {
        return None;
    }
    Some(cleaned.to_string())
}

fn extract_mod_id_from_install(bullet: &str) -> Option<String> {
    // "fabric-api, version 0.149.0 or later" -> "fabric-api"
    let id = bullet.split(',').next()?.trim();
    if id.is_empty() {
        None
    } else {
        Some(id.to_string())
    }
}

fn missing_dep_from_install_bullet(bullet: &str) -> Option<CrashSuspect> {
    let mod_id = extract_mod_id_from_install(bullet)?;
    let (display_name, reason) = split_install_bullet(bullet, &mod_id);
    Some(CrashSuspect {
        display_name,
        mod_id: Some(mod_id),
        reason: Some(reason),
        suspect_kind: "missing_dependency".to_string(),
    })
}

fn split_install_bullet(bullet: &str, mod_id: &str) -> (String, String) {
    let display_name = humanize_mod_id(mod_id);
    let reason = bullet
        .split_once(',')
        .map(|(_, rest)| rest.trim().to_string())
        .filter(|rest| !rest.is_empty())
        .unwrap_or_else(|| "required but not installed".to_string());
    (display_name, reason)
}

fn humanize_mod_id(mod_id: &str) -> String {
    match mod_id {
        "fabric-api" => return "Fabric API".to_string(),
        "sodium" => return "Sodium".to_string(),
        _ => {}
    }

    mod_id
        .split('-')
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn collapse_fabric_api_dependencies(suspects: &mut Vec<CrashSuspect>) {
    let has_fabric_api = suspects.iter().any(|s| {
        s.suspect_kind == "missing_dependency" && s.mod_id.as_deref() == Some("fabric-api")
    });

    if !has_fabric_api {
        return;
    }

    suspects.retain(|s| {
        if s.suspect_kind != "missing_dependency" {
            return true;
        }
        let mod_id = s.mod_id.as_deref().unwrap_or("");
        mod_id == "fabric-api" || !mod_id.starts_with("fabric-")
    });
}

fn parse_fabric_mod_line(line: &str) -> Option<(String, String, Option<String>)> {
    let mod_start = line.find("Mod '")?;
    let after_mod = &line[mod_start + 5..];
    let name_end = after_mod.find('\'')?;
    let display_name = after_mod[..name_end].to_string();

    let after_name = &after_mod[name_end + 1..];
    let paren_start = after_name.find('(')?;
    let paren_end = after_name.find(')')?;
    let mod_id = after_name[paren_start + 1..paren_end].trim().to_string();

    if display_name.is_empty() || mod_id.is_empty() {
        return None;
    }

    let reason = if line.contains("which is missing") || line.contains("requires") {
        line.split("requires")
            .nth(1)
            .map(|r| format!("requires {}", r.trim().trim_end_matches('!')))
    } else {
        None
    };

    Some((display_name, mod_id, reason))
}

fn strip_log_prefix(line: &str) -> &str {
    if let Some(idx) = line.find("]: ") {
        return &line[idx + 3..];
    }
    line.trim_start()
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
                                        crash_id: new_crash_id(),
                                        crash_type: "jvm".to_string(),
                                        category: "jvm".to_string(),
                                        title: "Java virtual machine crash".to_string(),
                                        message: "Java Virtual Machine crashed".to_string(),
                                        evidence: None,
                                        suspected_resources: Vec::new(),
                                        suspects: Vec::new(),
                                        suggested_fixes: vec![
                                            "Try another Java runtime for this instance.".to_string(),
                                            "Lower memory settings if the crash repeats immediately.".to_string(),
                                        ],
                                        affected_mod_count: None,
                                        report_path: path.to_string_lossy().to_string().into(),
                                        log_path: None,
                                        timestamp: chrono::Utc::now().to_rfc3339(),
                                        confidence: 0.98,
                                        mclogs_url: None,
                                        analysis: None,
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
    if let Some(parsed) = parse_fabric_formatted_exception(log_content) {
        return Some(parsed.message);
    }

    let lines: Vec<&str> = log_content.lines().collect();

    for line in &lines {
        if is_warn_line(line) {
            continue;
        }
        if line.contains("[main/ERROR]:") {
            return Some(strip_log_prefix(line).to_string());
        }
    }

    for line in &lines {
        if is_warn_line(line) {
            continue;
        }
        let lower = line.to_lowercase();
        if lower.contains("requires")
            || lower.contains("missing")
            || lower.contains("duplicate")
            || lower.contains("incompatible mods")
            || lower.contains("unsupported")
            || lower.contains("depends on")
        {
            return Some(strip_log_prefix(line).to_string());
        }
    }

    None
}

fn is_warn_line(line: &str) -> bool {
    line.contains("/WARN]:") || line.contains("/WARN]: ")
}

/// Find the most recent crash report in crash-reports directory
fn find_latest_crash_report(
    crash_reports_dir: &Path,
    launch_start_time: Option<SystemTime>,
) -> Option<String> {
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
                                if launch_start_time.is_some_and(|start| modified_time < start) {
                                    continue;
                                }
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

fn build_crash(
    crash_type: &str,
    category: &str,
    title: &str,
    message: String,
    evidence: Option<String>,
    suspects: Vec<CrashSuspect>,
    suggested_fixes: Vec<String>,
    affected_mod_count: Option<u32>,
    report_path: Option<String>,
    log_path: Option<String>,
    confidence: f32,
) -> CrashDetails {
    let suspected_resources: Vec<String> =
        suspects.iter().map(|s| s.display_name.clone()).collect();

    CrashDetails {
        crash_id: new_crash_id(),
        crash_type: crash_type.to_string(),
        category: category.to_string(),
        title: title.to_string(),
        message,
        evidence,
        suspected_resources,
        suspects,
        suggested_fixes,
        affected_mod_count,
        report_path,
        log_path,
        timestamp: chrono::Utc::now().to_rfc3339(),
        confidence,
        mclogs_url: None,
        analysis: None,
    }
}

fn new_crash_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn extract_line(log_content: &str, needles: &[&str]) -> Option<String> {
    log_content
        .lines()
        .find(|line| needles.iter().any(|needle| line.contains(needle)))
        .map(|line| line.trim().to_string())
}

fn extract_evidence(log_content: &str, needles: &[&str]) -> Option<String> {
    let lines: Vec<&str> = log_content.lines().collect();
    let index = lines.iter().position(|line| {
        let lower = line.to_lowercase();
        needles
            .iter()
            .any(|needle| lower.contains(&needle.to_lowercase()))
    })?;
    let start = index.saturating_sub(3);
    let end = (index + 7).min(lines.len());
    Some(lines[start..end].join("\n"))
}

fn extract_launch_mod_evidence(log_content: &str, _mod_markers: &[&str]) -> Option<String> {
    if let Some(parsed) = parse_fabric_formatted_exception(log_content) {
        return parsed.evidence;
    }

    let priority_needles = [
        "incompatible mods found",
        "formattedexception",
        "modloadingexception",
        "duplicate mods",
        "mixin apply failed",
    ];

    extract_evidence(log_content, &priority_needles)
}

fn generic_suspects(text: &str) -> Vec<CrashSuspect> {
    let mut found: Vec<CrashSuspect> = Vec::new();

    for line in text.lines() {
        if let Some((display_name, mod_id, reason)) = parse_fabric_mod_line(line) {
            push_unique_suspect(
                &mut found,
                CrashSuspect {
                    display_name,
                    mod_id: Some(mod_id),
                    reason,
                    suspect_kind: "affected_mod".to_string(),
                },
            );
        }
    }

    for token in text.split_whitespace() {
        let clean = token.trim_matches(|c: char| {
            matches!(
                c,
                '"' | '\'' | ',' | ';' | ':' | ')' | '(' | '[' | ']' | '{' | '}'
            )
        });
        if clean.ends_with(".jar") || clean.ends_with(".toml") || clean.ends_with(".json") {
            push_unique_suspect(
                &mut found,
                CrashSuspect {
                    display_name: clean.to_string(),
                    mod_id: None,
                    reason: None,
                    suspect_kind: "affected_mod".to_string(),
                },
            );
        }
    }

    found.truncate(8);
    found
}

fn push_unique_suspect(values: &mut Vec<CrashSuspect>, value: CrashSuspect) {
    let key = value
        .mod_id
        .as_deref()
        .unwrap_or(value.display_name.as_str())
        .to_lowercase();
    if !values.iter().any(|existing| {
        let existing_key = existing
            .mod_id
            .as_deref()
            .unwrap_or(existing.display_name.as_str())
            .to_lowercase();
        existing_key == key && existing.suspect_kind == value.suspect_kind
    }) {
        values.push(value);
    }
}

fn mod_suggestions(category: &str) -> Vec<String> {
    match category {
        "missing_dependency" => vec![
            "Install the missing required dependency listed above.".to_string(),
            "Use the Resources tab to update the modpack or matching mod versions.".to_string(),
        ],
        "duplicate_mod" => vec![
            "Remove one copy of the duplicated mod from the mods folder.".to_string(),
            "Keep the copy that matches this Minecraft and loader version.".to_string(),
        ],
        "mixin" => vec![
            "Update the suspected mod and its dependencies.".to_string(),
            "Disable the suspected mod to confirm the crash source.".to_string(),
        ],
        _ => vec![
            "Update or remove the mod named in the error.".to_string(),
            "Check that all mods match this Minecraft version and loader.".to_string(),
        ],
    }
}

/// Parse launch-time crash details from raw log content (fixtures / dev simulation).
pub fn parse_launch_log_content(log_content: &str) -> Option<CrashDetails> {
    let log_path = PathBuf::from("/tmp/vesta-crash-fixture/latest.log");
    check_launch_crash(log_content, &log_path)
}

/// Parse runtime crash details from raw log content (fixtures / dev simulation).
pub fn parse_runtime_log_content(log_content: &str) -> Option<CrashDetails> {
    let game_dir = PathBuf::from("/tmp/vesta-crash-fixture");
    let log_path = game_dir.join("latest.log");
    check_runtime_crash(log_content, &game_dir, &log_path, SystemTime::UNIX_EPOCH)
}

/// Representative JVM crash for dev simulation (no hs_err file required).
pub fn build_jvm_fixture_crash() -> CrashDetails {
    build_crash(
        "jvm",
        "jvm",
        "Java virtual machine crash",
        "Java Virtual Machine crashed (simulated)".to_string(),
        None,
        Vec::new(),
        vec![
            "Try another Java runtime for this instance.".to_string(),
            "Lower memory settings if the crash repeats immediately.".to_string(),
        ],
        None,
        None,
        None,
        0.98,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn log_path() -> PathBuf {
        PathBuf::from("/tmp/vesta-test/latest.log")
    }

    const FABULOUSLY_OPTIMIZED_LOG: &str = r#"[13:22:19] [main/ERROR]: Incompatible mods found!
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
A potential solution has been determined, this may resolve your problem:
	 - Install fabric-api, version 0.149.0 or later.
	 - Install fabric-resource-conditions-api-v1, version 6.0.5+00a1fba6b3 or later.
	 - Install fabric-events-interaction-v0, any version.
	 - Install fabric-networking-api-v1, any version.
	 - Install fabric-command-api-v2, any version.
More details:
	 - Mod 'BetterGrassify' (bettergrass) 1.8.6+fabric.26.1.2 requires any version of fabric-api, which is missing!
	 - Mod 'Continuity' (continuity) 3.0.1-beta.2+26.1 requires version 0.145.4 or later of fabric-api, which is missing!
	 - Mod 'YetAnotherConfigLib' (yet_another_config_lib_v3) 3.9.4+26.1-fabric requires version 0.144.3+26.1 or later of fabric-api, which is missing!
	 - Mod 'e4mc' (e4mc) 6.1.1+modern requires any version of fabric-api, which is missing!
	 - Mod 'EntityCulling' (entityculling) 1.10.2 requires any version of fabric-api, which is missing!
	 - Mod 'Fabrishot' (fabrishot) 1.17.0 requires any version of fabric-api, which is missing!
	 - Mod 'Forge Config API Port' (forgeconfigapiport) 26.1.5 requires version 0.149.0 or later of fabric-api, which is missing!
	 - Mod 'LambDynamicLights' (lambdynlights) 4.10.2+26.1.2 requires version 6.0.5+00a1fba6b3 or later of fabric-resource-conditions-api-v1, which is missing!
	 - Mod 'No Chat Reports' (nochatreports) 26.1-v2.19.0 requires any version of fabric-api, which is missing!
	 - Mod 'OptiGUI' (optigui) 2.3.0-beta.10+26.1 requires any version of fabric-events-interaction-v0, which is missing!
	 - Mod 'OptiGUI' (optigui) 2.3.0-beta.10+26.1 requires any version of fabric-networking-api-v1, which is missing!
	 - Mod 'Paginated Advancements' (paginatedadvancements) 2.8.0+26.1 requires any version of fabric-api, which is missing!
	 - Mod 'Puzzle' (puzzle) 2.3.1 requires any version of fabric-api, which is missing!
	 - Mod 'Skyboxify' (skyboxify) 2.8 requires any version of fabric-command-api-v2, which is missing!
	 - Mod 'TRansition' (transition) 1.0.19 requires any version of fabric-api, which is missing!
	 - Mod 'TRender' (trender) 1.0.13 requires any version of fabric-api, which is missing!
	at net.fabricmc.loader.impl.FormattedException.ofLocalized(FormattedException.java:51)"#;

    const SODIUM_MISSING_LOG: &str = r#"[18:35:59] [main/ERROR]: Incompatible mods found!
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
A potential solution has been determined, this may resolve your problem:
	 - Replace mod 'Iris' (iris) 1.10.9+mc26.1.1 with any version that is compatible with:
		 - Other constraints that can''t be automatically determined
	 - Replace mod 'Sodium Shadowy Path Blocks' (sspb) 7.0.0 with any version that is compatible with:
		 - Other constraints that can''t be automatically determined
	 - Replace mod 'Sodium Extra' (sodium-extra) 0.8.7+mc26.1.1 with any version that is compatible with:
		 - iris, any version
		 - reeses-sodium-options, any version
	 - Replace mod 'Reese's Sodium Options' (reeses-sodium-options) 2.0.5+mc26.1.1 with any version that is compatible with:
		 - iris, any version
		 - sodium-extra, any version
	 - Replace mod 'BBE' (betterblockentities) 1.3.4+mc26.1.2 with any version that is compatible with:
		 - Other constraints that can''t be automatically determined
More details:
	 - Mod 'BBE' (betterblockentities) 1.3.4+mc26.1.2 requires version 0.8.7 or later of sodium, which is missing!
	 - Mod 'Iris' (iris) 1.10.9+mc26.1.1 requires any 0.8.x version of sodium, which is missing!
	 - Mod 'Reese's Sodium Options' (reeses-sodium-options) 2.0.5+mc26.1.1 requires version 0.8.7 or later of sodium, which is missing!
	 - Mod 'Sodium Extra' (sodium-extra) 0.8.7+mc26.1.1 requires version 0.8.7 or later of sodium, which is missing!
	 - Mod 'Sodium Shadowy Path Blocks' (sspb) 7.0.0 requires version 0.8.7 or later of sodium, which is missing!
	at net.fabricmc.loader.impl.FormattedException.ofLocalized(FormattedException.java:51)"#;

    #[test]
    fn detects_fabric_missing_dependency() {
        let log = "[main/ERROR]: Incompatible mods found!\nMod 'Example' requires mod 'fabric-api' 0.91.0 or later.";
        let crash = check_launch_crash(log, &log_path()).expect("crash");
        assert_eq!(crash.category, "missing_dependency");
        assert_eq!(crash.crash_type, "launch_mod");
        assert!(crash.message.contains("fabric-api") || crash.message.contains("requires"));
    }

    #[test]
    fn parses_fabulously_optimized_log() {
        let crash = check_launch_crash(FABULOUSLY_OPTIMIZED_LOG, &log_path()).expect("crash");
        assert!(
            crash.message.contains("fabric-api"),
            "message: {}",
            crash.message
        );
        assert!(
            !crash.message.to_lowercase().contains("loader"),
            "message should not mention Loader warn: {}",
            crash.message
        );
        assert!(
            crash
                .suspects
                .iter()
                .any(|s| s.display_name == "BetterGrassify"
                    && s.mod_id.as_deref() == Some("bettergrass")),
            "suspects: {:?}",
            crash.suspects
        );
        assert!(
            !crash
                .suspects
                .iter()
                .any(|s| s.display_name == "release" || s.display_name.contains("Loader")),
            "suspects: {:?}",
            crash.suspects
        );
        let evidence = crash.evidence.expect("evidence");
        assert!(
            evidence.contains("Mod 'BetterGrassify'"),
            "evidence: {}",
            evidence
        );

        let missing_deps: Vec<_> = crash
            .suspects
            .iter()
            .filter(|s| s.suspect_kind == "missing_dependency")
            .collect();
        assert_eq!(missing_deps.len(), 1, "missing deps: {:?}", missing_deps);
        assert_eq!(missing_deps[0].display_name, "Fabric API");
        assert_eq!(missing_deps[0].mod_id.as_deref(), Some("fabric-api"));

        let bettergrass = crash
            .suspects
            .iter()
            .find(|s| s.mod_id.as_deref() == Some("bettergrass"))
            .expect("bettergrass suspect");
        assert!(
            bettergrass
                .reason
                .as_deref()
                .is_some_and(|r| r.starts_with("requires ")),
            "reason: {:?}",
            bettergrass.reason
        );

        assert_eq!(crash.affected_mod_count, Some(16));

        let affected: Vec<_> = crash
            .suspects
            .iter()
            .filter(|s| s.suspect_kind == "affected_mod")
            .collect();
        assert_eq!(affected.len(), 15, "unique affected mods: {:?}", affected);
    }

    #[test]
    fn parses_sodium_missing_from_detail_lines() {
        let crash = check_launch_crash(SODIUM_MISSING_LOG, &log_path()).expect("crash");
        assert!(
            crash.message.contains("Install Sodium"),
            "message: {}",
            crash.message
        );
        assert!(
            crash.message.contains("0.8.7 or later"),
            "message should include version: {}",
            crash.message
        );
        assert!(
            crash.message.contains("5 mods affected"),
            "message: {}",
            crash.message
        );
        assert!(
            !crash.message.to_lowercase().starts_with("replace mod"),
            "should not suggest replacing mods: {}",
            crash.message
        );

        let missing_deps: Vec<_> = crash
            .suspects
            .iter()
            .filter(|s| s.suspect_kind == "missing_dependency")
            .collect();
        assert_eq!(missing_deps.len(), 1, "missing deps: {:?}", missing_deps);
        assert_eq!(missing_deps[0].display_name, "Sodium");
        assert_eq!(missing_deps[0].mod_id.as_deref(), Some("sodium"));

        let affected: Vec<_> = crash
            .suspects
            .iter()
            .filter(|s| s.suspect_kind == "affected_mod")
            .collect();
        assert_eq!(affected.len(), 5, "affected mods: {:?}", affected);
        assert_eq!(crash.affected_mod_count, Some(5));
    }

    #[test]
    fn fabric_mod_line_reason_has_space_after_requires() {
        let line = "\t - Mod 'BetterGrassify' (bettergrass) 1.8.6+fabric.26.1.2 requires any version of fabric-api, which is missing!";
        let (_, _, reason) = parse_fabric_mod_line(line).expect("parsed");
        assert_eq!(
            reason.as_deref(),
            Some("requires any version of fabric-api, which is missing")
        );
    }

    #[test]
    fn detects_forge_missing_dependency() {
        let log = "net.minecraftforge.fml.ModLoadingException: Missing or unsupported mandatory dependencies:\n\tMod ID: curios, Requested by: jei";
        let crash = check_launch_crash(log, &log_path()).expect("crash");
        assert_eq!(crash.category, "missing_dependency");
        assert!(crash.title.contains("Mod compatibility"));
    }

    #[test]
    fn detects_duplicate_mods() {
        let log = "net.minecraftforge.fml.loading.DuplicateModsFoundException: Duplicate mods found\n\tmod file: appleskin.jar";
        let crash = check_launch_crash(log, &log_path()).expect("crash");
        assert_eq!(crash.category, "duplicate_mod");
        assert!(crash
            .suspected_resources
            .iter()
            .any(|m| m == "appleskin.jar"));
    }

    #[test]
    fn detects_java_class_version_mismatch() {
        let log = "java.lang.UnsupportedClassVersionError: com/example/Mod has been compiled by a more recent version of the Java Runtime";
        let crash = check_launch_crash(log, &log_path()).expect("crash");
        assert_eq!(crash.category, "java_version");
        assert_eq!(crash.crash_type, "launch_other");
    }

    #[test]
    fn detects_runtime_crash() {
        let dir = tempfile::tempdir().expect("tempdir");
        let log = "[Render thread/ERROR]: Reported exception thrown!\njava.lang.IllegalStateException: boom";
        let crash = check_runtime_crash(log, dir.path(), &log_path(), SystemTime::UNIX_EPOCH)
            .expect("crash");
        assert_eq!(crash.crash_type, "runtime");
        assert!(crash.message.contains("boom"));
    }

    #[test]
    fn detects_generic_early_launch_error() {
        let log = "[main/ERROR]: Failed to bootstrap Minecraft";
        let crash = check_launch_crash(log, &log_path()).expect("crash");
        assert_eq!(crash.category, "launch");
        assert_eq!(crash.crash_type, "launch_other");
    }
}
