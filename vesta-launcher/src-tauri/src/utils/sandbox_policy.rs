//! Resolve persisted sandbox settings into values for `vesta-sandbox`.
//!
//! Global defaults live in `AppConfig`; per-instance overrides follow the
//! existing `use_global_*` pattern. Extra paths merge global defaults with
//! instance-only additions.

use crate::models::instance::Instance;
use crate::utils::config::AppConfig;
use std::path::{Path, PathBuf};
use vesta_sandbox::{
    canonicalize_path_access, PathAccess, SandboxPolicy, SandboxPreset, WrapperNesting,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedSandboxSettings {
    pub preset: SandboxPreset,
    pub wrapper_nesting: WrapperNesting,
    pub extra_paths: Vec<PathBuf>,
}

pub fn parse_sandbox_preset(raw: &str) -> Option<SandboxPreset> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "trusted" => Some(SandboxPreset::Trusted),
        "modded" => Some(SandboxPreset::Modded),
        "paranoid" => Some(SandboxPreset::Paranoid),
        _ => None,
    }
}

pub fn parse_wrapper_nesting(raw: &str) -> Option<WrapperNesting> {
    match raw.trim().to_ascii_lowercase().replace('-', "_").as_str() {
        "sandbox_outside" => Some(WrapperNesting::SandboxOutside),
        "wrapper_outside" => Some(WrapperNesting::WrapperOutside),
        _ => None,
    }
}

pub fn parse_extra_paths_json(raw: &str) -> Result<Vec<PathBuf>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let paths: Vec<String> = serde_json::from_str(trimmed)
        .map_err(|e| format!("Invalid sandbox extra paths JSON: {e}"))?;

    Ok(paths.into_iter().map(PathBuf::from).collect())
}

pub fn merge_extra_paths(global: &[PathBuf], instance: &[PathBuf]) -> Vec<PathBuf> {
    let mut merged = global.to_vec();
    for path in instance {
        if !merged.contains(path) {
            merged.push(path.clone());
        }
    }
    merged
}

/// Reject a selected Java executable that a sandboxed game could replace and
/// then cause the launcher to execute during the next trusted Java check.
pub fn validate_java_path_for_play(
    resolved: &ResolvedSandboxSettings,
    java_path: &Path,
    game_dir: &Path,
) -> Result<(), String> {
    if !vesta_sandbox::resolve_preset(resolved.preset).enabled {
        return Ok(());
    }

    let java_path = if java_path.is_absolute() {
        java_path.to_path_buf()
    } else {
        which::which(java_path)
            .map_err(|e| format!("Java executable could not be resolved: {e}"))?
    };
    let canonical_java = vesta_sandbox::canonicalize_allowlist(&[java_path])
        .map_err(|e| format!("Sandbox Java path invalid: {e}"))?
        .remove(0);

    validate_protected_paths_for_play(resolved, &[canonical_java], game_dir, "Java executable")
}

/// Reject a launcher-trusted executable/resource root that overlaps a location
/// writable by the previous sandboxed game. This runs before trusted Java
/// discovery or verification executes anything from managed storage.
pub fn validate_protected_paths_for_play(
    resolved: &ResolvedSandboxSettings,
    protected_paths: &[PathBuf],
    game_dir: &Path,
    label: &str,
) -> Result<(), String> {
    if !vesta_sandbox::resolve_preset(resolved.preset).enabled {
        return Ok(());
    }

    let mut writable_roots = vec![game_dir.to_path_buf()];
    writable_roots.extend(resolved.extra_paths.iter().cloned());
    let canonical_writable = vesta_sandbox::canonicalize_allowlist(&writable_roots)
        .map_err(|e| format!("Sandbox writable path invalid: {e}"))?;
    let canonical_protected = vesta_sandbox::canonicalize_allowlist(protected_paths)
        .map_err(|e| format!("Sandbox protected path invalid: {e}"))?;

    for writable in &canonical_writable {
        if let Some(protected) = canonical_protected
            .iter()
            .find(|protected| protected.starts_with(writable) || writable.starts_with(protected))
        {
            return Err(format!(
                "Sandboxed Play cannot use {label} {} because it overlaps writable path {}. Remove that extra read-write folder or choose a protected location.",
                protected.display(),
                writable.display()
            ));
        }
    }

    Ok(())
}

pub fn validate_wrapper_path_for_play(
    resolved: &ResolvedSandboxSettings,
    wrapper_command: Option<&str>,
    game_dir: &Path,
) -> Result<(), String> {
    if !vesta_sandbox::resolve_preset(resolved.preset).enabled
        || resolved.wrapper_nesting != WrapperNesting::WrapperOutside
    {
        return Ok(());
    }
    let Some(wrapper) = wrapper_command.filter(|value| !value.trim().is_empty()) else {
        return Ok(());
    };
    validate_protected_paths_for_play(
        resolved,
        &sandboxed_wrapper_executables(wrapper)?,
        game_dir,
        "unsandboxed wrapper executable",
    )
}

/// Resolve the executable token once and persist that exact absolute path into
/// the command later consumed by piston-lib. This prevents validation under
/// one cwd/PATH followed by execution of a different writable executable.
pub fn normalize_wrapper_command_for_play(
    resolved: &ResolvedSandboxSettings,
    wrapper_command: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(wrapper) = wrapper_command else {
        return Ok(None);
    };
    if !vesta_sandbox::resolve_preset(resolved.preset).enabled || wrapper.trim().is_empty() {
        return Ok(Some(wrapper.to_string()));
    }

    let mut parts = shlex::split(wrapper)
        .ok_or_else(|| "Sandboxed wrapper command has invalid quoting".to_string())?;
    let executable = parts
        .first()
        .ok_or_else(|| "Sandboxed wrapper command is empty".to_string())?;
    let resolved_executable = which::which(executable).map_err(|e| {
        format!("Sandboxed wrapper executable could not be resolved ({executable}): {e}")
    })?;
    let canonical = std::fs::canonicalize(&resolved_executable).map_err(|e| {
        format!(
            "Sandboxed wrapper executable could not be canonicalized ({}): {e}",
            resolved_executable.display()
        )
    })?;
    parts[0] = canonical
        .to_str()
        .ok_or_else(|| "Sandboxed wrapper executable path is not valid UTF-8".to_string())?
        .to_string();
    shlex::try_join(parts.iter().map(String::as_str))
        .map(Some)
        .map_err(|e| format!("Sandboxed wrapper command could not be normalized: {e}"))
}

pub fn normalize_java_path_for_play(java_path: &Path) -> Result<PathBuf, String> {
    normalize_java_path(java_path, true)
}

/// Resolve existing system Java exactly before trusted verification, while
/// permitting an expected managed-Java path to remain absent until the trusted
/// installer downloads it.
pub fn normalize_java_path_before_install(java_path: &Path) -> Result<PathBuf, String> {
    normalize_java_path(java_path, false)
}

fn normalize_java_path(java_path: &Path, must_exist: bool) -> Result<PathBuf, String> {
    let resolved = if java_path.is_absolute() {
        java_path.to_path_buf()
    } else {
        which::which(java_path)
            .map_err(|e| format!("Java executable could not be resolved: {e}"))?
    };

    #[cfg(target_os = "macos")]
    if resolved == Path::new("/usr/bin/java") {
        let output = std::process::Command::new("/usr/libexec/java_home")
            .output()
            .map_err(|e| format!("Failed to resolve the macOS Java launcher shim: {e}"))?;
        if !output.status.success() {
            return Err("macOS could not resolve /usr/bin/java to a Java home".to_string());
        }
        let java_home = String::from_utf8(output.stdout)
            .map_err(|e| format!("macOS returned a non-UTF-8 Java home: {e}"))?;
        let resolved = PathBuf::from(java_home.trim()).join("bin/java");
        if !resolved.is_file() {
            return Err(format!(
                "Resolved macOS Java executable does not exist: {}",
                resolved.display()
            ));
        }
        return std::fs::canonicalize(&resolved).map_err(|e| {
            format!(
                "Failed to canonicalize resolved macOS Java executable {}: {e}",
                resolved.display()
            )
        });
    }

    if must_exist {
        std::fs::canonicalize(&resolved).map_err(|e| {
            format!(
                "Failed to canonicalize Java executable {}: {e}",
                resolved.display()
            )
        })
    } else {
        vesta_sandbox::canonicalize_allowlist(&[resolved])
            .map_err(|e| format!("Failed to resolve expected Java executable path: {e}"))
            .map(|mut paths| paths.remove(0))
    }
}

pub fn resolve_sandbox_settings(
    instance: &Instance,
    app_config: &AppConfig,
) -> Result<ResolvedSandboxSettings, String> {
    let preset_raw = if instance.use_global_sandbox {
        app_config.default_sandbox_preset.as_str()
    } else {
        instance
            .sandbox_preset
            .as_deref()
            .unwrap_or(app_config.default_sandbox_preset.as_str())
    };

    let nesting_raw = if instance.use_global_sandbox {
        app_config.default_sandbox_wrapper_nesting.as_str()
    } else {
        instance
            .sandbox_wrapper_nesting
            .as_deref()
            .unwrap_or(app_config.default_sandbox_wrapper_nesting.as_str())
    };

    let preset = parse_sandbox_preset(preset_raw)
        .ok_or_else(|| format!("Unknown sandbox preset: {preset_raw}"))?;
    let wrapper_nesting = parse_wrapper_nesting(nesting_raw)
        .ok_or_else(|| format!("Unknown sandbox wrapper nesting: {nesting_raw}"))?;

    let global_paths = parse_extra_paths_json(&app_config.default_sandbox_extra_paths)?;
    let instance_paths = parse_extra_paths_json(&instance.sandbox_extra_paths)?;
    let extra_paths = merge_extra_paths(&global_paths, &instance_paths);

    Ok(ResolvedSandboxSettings {
        preset,
        wrapper_nesting,
        extra_paths,
    })
}

/// Build a resolved [`SandboxPolicy`] for confinement of the Play process tree.
pub fn build_sandbox_policy_for_roots(
    resolved: &ResolvedSandboxSettings,
    data_dir: &Path,
    game_dir: &Path,
    log_file: &Path,
    java_path: &Path,
    exit_handler_jar: Option<&Path>,
    wrapper_command: Option<&str>,
    hooks_need_shell: bool,
) -> Result<SandboxPolicy, String> {
    let caps = vesta_sandbox::resolve_preset(resolved.preset);
    if !caps.enabled {
        let mut policy = SandboxPolicy::trusted();
        policy.wrapper_nesting = resolved.wrapper_nesting;
        return Ok(policy);
    }

    // Play may consume shared launcher data, but only the instance and its
    // session logs are mutable. Installation/repair processors run outside the
    // Play sandbox and therefore do not require shared data to be writable.
    let mut filesystem = vec![
        PathAccess::new(game_dir.to_path_buf(), true, true, false),
        PathAccess::file(log_file.to_path_buf(), true, true, false),
    ];
    let mut protected_paths = Vec::new();
    for shared_dir in ["assets", "libraries", "versions", "natives"] {
        let path = data_dir.join(shared_dir);
        protected_paths.push(path.clone());
        filesystem.push(PathAccess::new(path, true, false, false));
    }

    // Exec is exact-path by default. Only recognize a Java runtime root when
    // the selected executable has the conventional <java_home>/bin/java shape
    // and the candidate contains a lib directory; blindly taking parents of
    // /usr/bin/java would accidentally allow all of /usr.
    let mut exec_allowlist = vec![java_path.to_path_buf()];
    if let Some(java_root) = java_runtime_root(java_path) {
        protected_paths.push(java_root.clone());
        filesystem.push(PathAccess::new(java_root.clone(), true, false, false));
        let spawn_helper = java_root.join("lib/jspawnhelper");
        if spawn_helper.is_file() {
            exec_allowlist.push(spawn_helper);
        }
    } else {
        protected_paths.push(java_path.to_path_buf());
        filesystem.push(PathAccess::file(java_path.to_path_buf(), true, false, true));
    }

    if hooks_need_shell {
        exec_allowlist.push(PathBuf::from("/bin/sh"));
        // sandbox-exec resolves /bin/sh through the bash variant on macOS.
        exec_allowlist.push(PathBuf::from("/bin/bash"));
    }

    if resolved.wrapper_nesting == WrapperNesting::SandboxOutside {
        if let Some(wrapper) = wrapper_command.filter(|value| !value.trim().is_empty()) {
            for executable in sandboxed_wrapper_executables(wrapper)? {
                filesystem.push(PathAccess::file(executable.clone(), true, false, true));
                exec_allowlist.push(executable);
            }
        }
    }

    if let Some(jar) = exit_handler_jar {
        filesystem.push(PathAccess::file(jar.to_path_buf(), true, false, false));
    }

    let mut extra_paths = Vec::new();
    for path in &resolved.extra_paths {
        extra_paths.push(PathAccess::new(path.clone(), true, true, false));
    }

    // Canonicalize the complete path policy together so a logical child in the
    // extras list cannot escape a declared root unnoticed.
    let filesystem_len = filesystem.len();
    filesystem.extend(extra_paths);
    let mut canonical_paths = canonicalize_path_access(&filesystem)
        .map_err(|e| format!("Sandbox filesystem allowlist invalid: {e}"))?;
    let extra_paths = canonical_paths.split_off(filesystem_len);
    let filesystem_allowlist = canonical_paths;
    let exec_allowlist = vesta_sandbox::canonicalize_allowlist(&exec_allowlist)
        .map_err(|e| format!("Sandbox exec allowlist invalid: {e}"))?;
    let protected_paths = vesta_sandbox::canonicalize_allowlist(&protected_paths)
        .map_err(|e| format!("Sandbox protected path invalid: {e}"))?;
    for writable in filesystem_allowlist
        .iter()
        .chain(extra_paths.iter())
        .filter(|entry| entry.write && entry.recursive)
    {
        if let Some(protected) = protected_paths.iter().find(|protected| {
            protected.starts_with(&writable.path) || writable.path.starts_with(protected)
        }) {
            return Err(format!(
                "Sandbox writable path {} overlaps protected shared path {}",
                writable.path.display(),
                protected.display()
            ));
        }
    }

    Ok(SandboxPolicy {
        enabled: true,
        preset: resolved.preset,
        filesystem_allowlist,
        network_allowed: caps.network_allowed,
        mic_allowed: caps.mic_allowed,
        usb_allowed: caps.usb_allowed,
        exec_allowlist,
        wrapper_nesting: resolved.wrapper_nesting,
        extra_paths,
    })
}

fn java_runtime_root(java_path: &Path) -> Option<PathBuf> {
    let bin_dir = java_path.parent()?;
    if bin_dir.file_name()? != "bin" {
        return None;
    }
    let root = bin_dir.parent()?;
    root.join("lib").is_dir().then(|| root.to_path_buf())
}

/// Resolve the wrapper and, for a script, its absolute shebang interpreter.
/// Environment-resolved shebangs are rejected because the child environment
/// could otherwise select a different executable from the one validated here.
fn sandboxed_wrapper_executables(wrapper: &str) -> Result<Vec<PathBuf>, String> {
    use std::io::Read as _;

    let parts = shlex::split(wrapper)
        .ok_or_else(|| "Sandboxed wrapper command has invalid quoting".to_string())?;
    let executable = parts
        .first()
        .ok_or_else(|| "Sandboxed wrapper command is empty".to_string())?;
    let resolved = which::which(executable).map_err(|e| {
        format!("Sandboxed wrapper executable could not be resolved ({executable}): {e}")
    })?;
    let mut executables = vec![resolved.clone()];

    let mut file = std::fs::File::open(&resolved).map_err(|e| {
        format!(
            "Sandboxed wrapper executable could not be inspected ({}): {e}",
            resolved.display()
        )
    })?;
    let mut bytes = Vec::with_capacity(4096);
    std::io::Read::take(&mut file, 4096)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Sandboxed wrapper executable could not be inspected: {e}"))?;
    if bytes.starts_with(b"#!") {
        let first_line = bytes
            .split(|byte| *byte == b'\n')
            .next()
            .unwrap_or_default();
        let shebang = std::str::from_utf8(&first_line[2..])
            .map_err(|_| "Sandboxed wrapper has a non-UTF-8 shebang".to_string())?
            .trim();
        let interpreter_parts = shlex::split(shebang)
            .ok_or_else(|| "Sandboxed wrapper has an invalid shebang".to_string())?;
        let interpreter = interpreter_parts
            .first()
            .ok_or_else(|| "Sandboxed wrapper has an empty shebang".to_string())?;
        let interpreter = PathBuf::from(interpreter);
        if !interpreter.is_absolute() || !interpreter.is_file() {
            return Err(format!(
                "Sandboxed wrapper shebang interpreter is not an existing absolute file: {}",
                interpreter.display()
            ));
        }
        if interpreter == Path::new("/usr/bin/env") {
            return Err(
                "Sandboxed script wrappers cannot use /usr/bin/env in the shebang because its target can change with PATH; use an absolute interpreter path"
                    .to_string(),
            );
        }
        executables.push(interpreter);
    }

    Ok(executables)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::instance::Instance;
    use std::fs;
    use tempfile::TempDir;

    fn create_shared_data_roots(data: &Path) {
        for root in ["assets", "libraries", "versions", "natives"] {
            fs::create_dir_all(data.join(root)).unwrap();
        }
    }

    fn sample_config() -> AppConfig {
        AppConfig {
            default_sandbox_preset: "modded".to_string(),
            default_sandbox_wrapper_nesting: "sandbox-outside".to_string(),
            default_sandbox_extra_paths: r#"["/global/path"]"#.to_string(),
            ..AppConfig::default()
        }
    }

    #[test]
    fn parse_preset_and_nesting_aliases() {
        assert_eq!(
            parse_sandbox_preset("Paranoid"),
            Some(SandboxPreset::Paranoid)
        );
        assert_eq!(
            parse_wrapper_nesting("wrapper-outside"),
            Some(WrapperNesting::WrapperOutside)
        );
        assert_eq!(
            parse_wrapper_nesting("sandbox_outside"),
            Some(WrapperNesting::SandboxOutside)
        );
    }

    #[test]
    fn resolve_uses_global_defaults_when_requested() {
        let config = sample_config();
        let instance = Instance {
            use_global_sandbox: true,
            sandbox_preset: Some("paranoid".to_string()),
            sandbox_wrapper_nesting: Some("wrapper-outside".to_string()),
            sandbox_extra_paths: r#"["/instance/path"]"#.to_string(),
            ..Instance::default()
        };

        let resolved = resolve_sandbox_settings(&instance, &config).expect("resolve");
        assert_eq!(resolved.preset, SandboxPreset::Modded);
        assert_eq!(resolved.wrapper_nesting, WrapperNesting::SandboxOutside);
        assert_eq!(
            resolved.extra_paths,
            vec![
                PathBuf::from("/global/path"),
                PathBuf::from("/instance/path")
            ]
        );
    }

    #[test]
    fn resolve_uses_instance_overrides_when_not_global() {
        let config = sample_config();
        let instance = Instance {
            use_global_sandbox: false,
            sandbox_preset: Some("paranoid".to_string()),
            sandbox_wrapper_nesting: Some("wrapper-outside".to_string()),
            sandbox_extra_paths: r#"["/instance/path"]"#.to_string(),
            ..Instance::default()
        };

        let resolved = resolve_sandbox_settings(&instance, &config).expect("resolve");
        assert_eq!(resolved.preset, SandboxPreset::Paranoid);
        assert_eq!(resolved.wrapper_nesting, WrapperNesting::WrapperOutside);
        assert_eq!(
            resolved.extra_paths,
            vec![
                PathBuf::from("/global/path"),
                PathBuf::from("/instance/path")
            ]
        );
    }

    #[test]
    fn play_policy_keeps_shared_data_and_java_read_only() {
        let temp = TempDir::new().unwrap();
        let data = temp.path().join("data");
        let game = temp.path().join("instances/example");
        let log_file = data.join("logs/example.log");
        let java_root = data.join("jre/runtime");
        let java_bin = java_root.join("bin/java");
        let exit_handler = temp.path().join("resources/exit-handler.jar");
        let extra = temp.path().join("extra");
        for path in [
            &data,
            &game,
            log_file.parent().unwrap(),
            java_bin.parent().unwrap(),
            &extra,
        ] {
            fs::create_dir_all(path).unwrap();
        }
        create_shared_data_roots(&data);
        fs::create_dir_all(java_root.join("lib")).unwrap();
        fs::create_dir_all(exit_handler.parent().unwrap()).unwrap();
        fs::write(&java_bin, b"java").unwrap();
        fs::write(&log_file, b"").unwrap();
        fs::write(&exit_handler, b"jar").unwrap();

        let resolved = ResolvedSandboxSettings {
            preset: SandboxPreset::Paranoid,
            wrapper_nesting: WrapperNesting::SandboxOutside,
            extra_paths: vec![extra.clone()],
        };
        let policy = build_sandbox_policy_for_roots(
            &resolved,
            &data,
            &game,
            &log_file,
            &java_bin,
            Some(&exit_handler),
            None,
            false,
        )
        .unwrap();

        let access = |path: &Path| {
            let canonical = fs::canonicalize(path).unwrap();
            policy
                .filesystem_allowlist
                .iter()
                .find(|entry| entry.path == canonical)
                .cloned()
                .unwrap()
        };
        for shared in ["assets", "libraries", "versions", "natives"] {
            let shared_access = access(&data.join(shared));
            assert!(shared_access.read);
            assert!(!shared_access.write);
        }
        assert!(policy
            .filesystem_allowlist
            .iter()
            .all(|entry| { entry.path != fs::canonicalize(&data).unwrap() }));
        let game_access = access(&game);
        assert!(game_access.read && game_access.write);
        let log_access = access(&log_file);
        assert!(log_access.read && log_access.write);
        assert!(!log_access.recursive);
        let java_access = access(&java_root);
        assert!(java_access.read && !java_access.write);
        assert!(policy.extra_paths[0].read && policy.extra_paths[0].write);
    }

    #[test]
    fn hook_shell_is_explicit_and_wrapper_outside_needs_no_wrapper_exec_grant() {
        let temp = TempDir::new().unwrap();
        let data = temp.path().join("data");
        let game = temp.path().join("game");
        let log_file = data.join("logs/example.log");
        let java_bin = temp.path().join("runtime/bin/java");
        for path in [
            &data,
            &game,
            log_file.parent().unwrap(),
            java_bin.parent().unwrap(),
        ] {
            fs::create_dir_all(path).unwrap();
        }
        create_shared_data_roots(&data);
        fs::write(&java_bin, b"java").unwrap();
        fs::write(&log_file, b"").unwrap();

        let resolved = ResolvedSandboxSettings {
            preset: SandboxPreset::Modded,
            wrapper_nesting: WrapperNesting::WrapperOutside,
            extra_paths: Vec::new(),
        };
        let policy = build_sandbox_policy_for_roots(
            &resolved,
            &data,
            &game,
            &log_file,
            &java_bin,
            None,
            Some("/usr/bin/env ignored"),
            true,
        )
        .unwrap();

        let shell = fs::canonicalize("/bin/sh").unwrap();
        let wrapper = fs::canonicalize("/usr/bin/env").unwrap();
        assert!(policy.exec_allowlist.contains(&shell));
        assert!(!policy.exec_allowlist.contains(&wrapper));
    }

    #[test]
    fn sandbox_outside_allows_only_the_resolved_wrapper_executable() {
        let temp = TempDir::new().unwrap();
        let data = temp.path().join("data");
        let game = temp.path().join("game");
        let log_file = data.join("logs/example.log");
        let java_bin = temp.path().join("runtime/bin/java");
        for path in [
            &data,
            &game,
            log_file.parent().unwrap(),
            java_bin.parent().unwrap(),
        ] {
            fs::create_dir_all(path).unwrap();
        }
        create_shared_data_roots(&data);
        fs::write(&java_bin, b"java").unwrap();
        fs::write(&log_file, b"").unwrap();

        let resolved = ResolvedSandboxSettings {
            preset: SandboxPreset::Modded,
            wrapper_nesting: WrapperNesting::SandboxOutside,
            extra_paths: Vec::new(),
        };
        let policy = build_sandbox_policy_for_roots(
            &resolved,
            &data,
            &game,
            &log_file,
            &java_bin,
            None,
            Some("/usr/bin/env ignored"),
            false,
        )
        .unwrap();

        let wrapper = fs::canonicalize("/usr/bin/env").unwrap();
        assert!(policy.exec_allowlist.contains(&wrapper));
        let wrapper_access = policy
            .filesystem_allowlist
            .iter()
            .find(|entry| entry.path == wrapper)
            .unwrap();
        assert!(wrapper_access.read && !wrapper_access.write && wrapper_access.execute);
        assert!(!policy
            .exec_allowlist
            .contains(&fs::canonicalize("/bin/sh").unwrap()));
    }

    #[test]
    #[cfg(unix)]
    fn sandboxed_script_wrapper_allows_its_exact_shebang_interpreter() {
        use std::os::unix::fs::PermissionsExt;

        let temp = TempDir::new().unwrap();
        let script = temp.path().join("wrapper.sh");
        fs::write(&script, b"#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();

        let executables = sandboxed_wrapper_executables(script.to_str().unwrap()).unwrap();
        assert_eq!(executables[0], script);
        assert_eq!(executables[1], PathBuf::from("/bin/sh"));
    }

    #[test]
    fn sandboxed_wrapper_command_persists_the_canonical_executable() {
        let resolved = ResolvedSandboxSettings {
            preset: SandboxPreset::Modded,
            wrapper_nesting: WrapperNesting::SandboxOutside,
            extra_paths: Vec::new(),
        };
        let normalized = normalize_wrapper_command_for_play(
            &resolved,
            Some("/usr/bin/env --ignore-environment"),
        )
        .unwrap()
        .unwrap();
        let parts = shlex::split(&normalized).unwrap();

        assert_eq!(
            PathBuf::from(&parts[0]),
            fs::canonicalize("/usr/bin/env").unwrap()
        );
        assert_eq!(parts[1], "--ignore-environment");
    }

    #[test]
    #[cfg(unix)]
    fn sandboxed_script_wrapper_rejects_env_shebang_target() {
        use std::os::unix::fs::PermissionsExt;

        let temp = TempDir::new().unwrap();
        let script = temp.path().join("wrapper");
        fs::write(&script, b"#!/usr/bin/env bash\nexit 0\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();

        let error = sandboxed_wrapper_executables(script.to_str().unwrap()).unwrap_err();
        assert!(error.contains("target can change with PATH"));
    }

    #[test]
    #[cfg(unix)]
    fn unsandboxed_wrapper_cannot_be_loaded_from_the_game_directory() {
        use std::os::unix::fs::PermissionsExt;

        let temp = TempDir::new().unwrap();
        let game = temp.path().join("game");
        let wrapper = game.join("wrapper.sh");
        fs::create_dir_all(&game).unwrap();
        fs::write(&wrapper, b"#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o755)).unwrap();
        let resolved = ResolvedSandboxSettings {
            preset: SandboxPreset::Modded,
            wrapper_nesting: WrapperNesting::WrapperOutside,
            extra_paths: Vec::new(),
        };

        let error = validate_wrapper_path_for_play(&resolved, wrapper.to_str(), &game).unwrap_err();
        assert!(error.contains("unsandboxed wrapper executable"));
        assert!(error.contains("overlaps writable path"));
    }

    #[test]
    fn writable_extra_cannot_overlap_shared_runtime_data() {
        let temp = TempDir::new().unwrap();
        let data = temp.path().join("data");
        let game = temp.path().join("game");
        let log_file = data.join("logs/example.log");
        let java_bin = temp.path().join("runtime/bin/java");
        for path in [
            &game,
            log_file.parent().unwrap(),
            java_bin.parent().unwrap(),
        ] {
            fs::create_dir_all(path).unwrap();
        }
        create_shared_data_roots(&data);
        fs::write(&log_file, b"").unwrap();
        fs::write(&java_bin, b"java").unwrap();

        let resolved = ResolvedSandboxSettings {
            preset: SandboxPreset::Modded,
            wrapper_nesting: WrapperNesting::SandboxOutside,
            extra_paths: vec![data.join("assets")],
        };
        let error = build_sandbox_policy_for_roots(
            &resolved, &data, &game, &log_file, &java_bin, None, None, false,
        )
        .unwrap_err();
        assert!(error.contains("overlaps protected shared path"));
    }

    #[test]
    fn configured_java_in_game_directory_is_rejected_before_execution() {
        let temp = TempDir::new().unwrap();
        let game = temp.path().join("game");
        let java = game.join("runtime/bin/java");
        fs::create_dir_all(java.parent().unwrap()).unwrap();
        fs::write(&java, b"java").unwrap();
        let resolved = ResolvedSandboxSettings {
            preset: SandboxPreset::Modded,
            wrapper_nesting: WrapperNesting::SandboxOutside,
            extra_paths: Vec::new(),
        };

        let error = validate_java_path_for_play(&resolved, &java, &game).unwrap_err();
        assert!(error.contains("overlaps writable path"));
    }

    #[test]
    fn expected_managed_java_path_can_be_normalized_before_install() {
        let temp = TempDir::new().unwrap();
        let expected = temp.path().join("data/jre/zulu-21/bin/java");

        let normalized = normalize_java_path_before_install(&expected).unwrap();
        assert_eq!(
            normalized,
            fs::canonicalize(temp.path())
                .unwrap()
                .join("data/jre/zulu-21/bin/java")
        );
        assert!(normalize_java_path_for_play(&expected).is_err());
    }
}
