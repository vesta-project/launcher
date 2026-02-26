use std::collections::HashMap;
use crate::utils::config::AppConfig;
use crate::models::instance::Instance;

/// Parses Environment Variables from a string (one per line, format KEY=VALUE)
fn parse_env_vars(raw: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            map.insert(key.trim().to_string(), value.trim().to_string());
        } else {
            log::warn!("Ignoring malformed env var line: {}", line);
        }
    }
    map
}

/// Resolves environment variables for an instance, merging global defaults and instance overrides.
pub fn resolve_env_vars(
    config: &AppConfig,
    instance: &Instance,
) -> HashMap<String, String> {
    let mut vars = HashMap::new();

    // 1. Start with global defaults if linked
    if instance.use_global_environment_variables {
        if let Some(ref global_env_raw) = config.default_environment_variables {
            vars.extend(parse_env_vars(global_env_raw));
        }
    }

    // 2. Add instance overrides (only if NOT linked, or should we merge?)
    // User said "linked = immutable", so if linked, we ignore local overrides for Env Vars too.
    if !instance.use_global_environment_variables {
        if let Some(ref instance_env_raw) = instance.environment_variables {
            vars.extend(parse_env_vars(instance_env_raw));
        }
    }

    // 3. Add system/standard vars
    vars.insert("VESTA_INSTANCE_NAME".to_string(), instance.name.clone());
    vars.insert("VESTA_MC_VERSION".to_string(), instance.minecraft_version.clone());

    vars
}
