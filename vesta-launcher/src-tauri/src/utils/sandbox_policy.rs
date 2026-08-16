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

/// Build a resolved [`SandboxPolicy`] for launch/install JVM confinement.
pub fn build_sandbox_policy_for_roots(
    resolved: &ResolvedSandboxSettings,
    data_dir: &Path,
    game_dir: &Path,
    java_path: &Path,
    exit_handler_jar: Option<&Path>,
) -> Result<SandboxPolicy, String> {
    let caps = vesta_sandbox::resolve_preset(resolved.preset);
    if !caps.enabled {
        let mut policy = SandboxPolicy::trusted();
        policy.wrapper_nesting = resolved.wrapper_nesting;
        return Ok(policy);
    }

    let mut filesystem = vec![
        PathAccess::new(data_dir.to_path_buf(), true, true, false),
        PathAccess::new(game_dir.to_path_buf(), true, true, false),
    ];

    let mut exec_allowlist = Vec::new();
    if let Some(java_home) = java_path.parent() {
        // Allow the JRE tree (java binary + jspawnhelper / libs).
        exec_allowlist.push(java_home.to_path_buf());
        if let Some(jre_root) = java_home.parent() {
            exec_allowlist.push(jre_root.to_path_buf());
        }
    }
    exec_allowlist.push(java_path.to_path_buf());

    if let Some(jar) = exit_handler_jar {
        filesystem.push(PathAccess::new(jar.to_path_buf(), true, false, false));
        if let Some(parent) = jar.parent() {
            filesystem.push(PathAccess::new(parent.to_path_buf(), true, false, false));
        }
    }

    let mut extra_paths = Vec::new();
    for path in &resolved.extra_paths {
        extra_paths.push(PathAccess::new(path.clone(), true, true, false));
    }

    let filesystem_allowlist = canonicalize_path_access(&filesystem)
        .map_err(|e| format!("Sandbox filesystem allowlist invalid: {e}"))?;
    let extra_paths = canonicalize_path_access(&extra_paths)
        .map_err(|e| format!("Sandbox extra paths invalid: {e}"))?;
    let exec_allowlist = vesta_sandbox::canonicalize_allowlist(&exec_allowlist)
        .map_err(|e| format!("Sandbox exec allowlist invalid: {e}"))?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::instance::Instance;

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
}
