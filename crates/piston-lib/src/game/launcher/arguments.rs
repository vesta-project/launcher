/// Argument builder for Minecraft launcher
use crate::game::launcher::classpath::OsType;
use crate::game::launcher::types::LaunchSpec;
use crate::game::launcher::version_parser::{Argument, ArgumentValue, VersionManifest};
use dunce::canonicalize;
use std::collections::HashMap;
use std::path::Path;

/// Build JVM arguments for launching the game
pub fn build_jvm_arguments(
    spec: &LaunchSpec,
    manifest: &VersionManifest,
    natives_dir: &Path,
    classpath: &str,
) -> Vec<String> {
    let mut args = Vec::new();

    // Add custom JVM args first (if provided)
    if !spec.jvm_args.is_empty() {
        args.extend(spec.jvm_args.clone());
    } else {
        // Use default JVM args
        args.extend(get_default_jvm_args());
    }

    // Collect manifest JVM arguments first to check for duplicates
    let mut manifest_args = Vec::new();
    if let Some(ref arguments) = manifest.arguments {
        let variables = build_jvm_variables(spec, manifest, natives_dir, classpath);

        for arg in &arguments.jvm {
            // Use special processing for JVM args to avoid splitting quoted strings with spaces
            let parts = process_jvm_argument(arg, &variables, OsType::current(), spec);
            for p in parts {
                if p.trim().is_empty() {
                    continue;
                }
                manifest_args.push(p);
            }
        }
    }

    // Check if manifest already defines these properties
    let has_natives_path = manifest_args.iter().any(|arg| arg.starts_with("-Djava.library.path="));
    let has_launcher_brand = manifest_args.iter().any(|arg| arg.starts_with("-Dminecraft.launcher.brand="));
    let has_launcher_version = manifest_args.iter().any(|arg| arg.starts_with("-Dminecraft.launcher.version="));

    // Add natives library path only if not in manifest (Forge/Fabric include it)
    if !has_natives_path {
        let natives_arg = canonicalize(natives_dir)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| natives_dir.to_string_lossy().to_string());
        args.push(format!("-Djava.library.path={}", natives_arg));
    }

    // Add launcher brand and version only if not in manifest
    if !has_launcher_brand {
        args.push("-Dminecraft.launcher.brand=VestaLauncher".to_string());
    }
    if !has_launcher_version {
        args.push("-Dminecraft.launcher.version=1.0.0".to_string());
    }

    // Add manifest arguments
    args.extend(manifest_args);

    // For legacy versions (like 1.0) that don't have JVM args in manifest, add classpath manually
    let has_classpath = args.iter().any(|arg| arg == "-cp" || arg.starts_with("-cp=") || arg.starts_with("-classpath"));
    if !has_classpath && manifest.arguments.is_none() {
        args.push("-cp".to_string());
        args.push(classpath.to_string());
    }

    args
}

/// Build game arguments for launching the game
pub fn build_game_arguments(spec: &LaunchSpec, manifest: &VersionManifest) -> Vec<String> {
    let mut args = Vec::new();

    let variables = build_game_variables(spec, manifest);

    // Handle modern arguments format
    if let Some(ref arguments) = manifest.arguments {
        for arg in &arguments.game {
            let parts = process_argument(arg, &variables, OsType::current(), spec);
            for p in parts {
                if p.trim().is_empty() {
                    // ignore empty game-argument tokens that might come from optional quick-play params
                    continue;
                }
                args.push(p);
            }
        }
    } else if let Some(ref legacy_args) = manifest.minecraft_arguments {
        // Handle legacy format (pre-1.13)
        for arg in legacy_args.split_whitespace() {
            args.push(substitute_variables(arg, &variables));
        }
    }

    // Add custom game args, ignoring any empty strings
    args.extend(
        spec.game_args
            .clone()
            .into_iter()
            .filter(|s| !s.trim().is_empty()),
    );

    args
}

/// Process a JVM argument (simple or conditional) - DOES NOT SPLIT ON WHITESPACE
fn process_jvm_argument(
    arg: &Argument,
    variables: &HashMap<String, String>,
    os: OsType,
    spec: &LaunchSpec,
) -> Vec<String> {
    match arg {
        Argument::Simple(s) => {
            if contains_empty_placeholder(s, variables) {
                return Vec::new();
            }
            // For JVM args, we substitute but DO NOT split.
            // This preserves arguments like "-DFabricMcEmu= net.minecraft.client.main.Main " as a single token.
            vec![substitute_variables(s, variables)]
        }
        Argument::Conditional { rules, value } => {
            if evaluate_rules(rules, os, spec) {
                match value {
                    ArgumentValue::Single(s) => {
                        if contains_empty_placeholder(s, variables) {
                            return Vec::new();
                        }
                        vec![substitute_variables(s, variables)]
                    }
                    ArgumentValue::Multiple(vec) => {
                        let mut out: Vec<String> = Vec::new();
                        for part in vec.iter() {
                            if contains_empty_placeholder(part, variables) {
                                return Vec::new();
                            }
                            // For multiple values, we treat each as a separate arg, but don't split within them
                            out.push(substitute_variables(part, variables));
                        }
                        out
                    }
                }
            } else {
                Vec::new()
            }
        }
    }
}

/// Process an argument (simple or conditional)
fn process_argument(
    arg: &Argument,
    variables: &HashMap<String, String>,
    os: OsType,
    spec: &LaunchSpec,
) -> Vec<String> {
    match arg {
        Argument::Simple(s) => {
            // If the incoming string contains any placeholders that would
            // resolve to empty/missing values we should drop the entire
            // token to avoid orphan flags. Otherwise, substitute and
            // split into tokens (handles multi-token strings like "--flag val").
            if contains_empty_placeholder(s, variables) {
                return Vec::new();
            }

            let res = substitute_variables(s, variables);
            split_preserving_quotes(&res)
        }
        Argument::Conditional { rules, value } => {
            // Check if rules match
            if evaluate_rules(rules, os, spec) {
                match value {
                    ArgumentValue::Single(s) => {
                        if contains_empty_placeholder(s, variables) {
                            return Vec::new();
                        }

                        let res = substitute_variables(s, variables);
                        split_preserving_quotes(&res)
                    }
                    ArgumentValue::Multiple(vec) => {
                        // Substitute all parts and if any part results in an empty string
                        // then skip the entire multi-part group. This avoids leaving lone
                        // flags (e.g. "--quickplay") when their value is empty.
                        let mut out: Vec<String> = Vec::new();

                        for part in vec.iter() {
                            if contains_empty_placeholder(part, variables) {
                                return Vec::new();
                            }

                            let substituted = substitute_variables(part, variables);
                            let mut toks = split_preserving_quotes(&substituted);
                            out.append(&mut toks);
                        }

                        out
                    }
                }
            } else {
                Vec::new()
            }
        }
    }
}

/// Evaluate rules to determine if they match
fn evaluate_rules(
    rules: &[crate::game::launcher::version_parser::Rule],
    os: OsType,
    spec: &LaunchSpec,
) -> bool {
    use crate::game::launcher::version_parser::RuleAction;

    let mut allow = false;

    use regex::Regex;

    for rule in rules {
        // Start assuming the rule could match; fail fast when any constraint fails
        let mut matches = true;

        if let Some(ref os_rule) = rule.os {
            // OS name
            if let Some(ref os_name) = os_rule.name {
                if os_name != os.as_str() {
                    matches = false;
                }
            }

            // OS arch
            if matches {
                if let Some(ref arch) = os_rule.arch {
                    // Compare arch literally
                    if arch != std::env::consts::ARCH {
                        matches = false;
                    }
                }
            }

            // OS version (regex). If provided, try to match against the host OS
            // version string. We don't have a rich OS version API, so use sysinfo
            // to get a platform version string if available.
            if matches {
                if let Some(ref version_expr) = os_rule.version {
                    // Treat version_expr as a regex
                    if let Ok(re) = Regex::new(version_expr) {
                        let host_version = match sysinfo::System::long_os_version() {
                            Some(v) => v,
                            None => String::new(),
                        };

                        if !re.is_match(&host_version) {
                            matches = false;
                        }
                    } else {
                        // If regex fails to compile, be conservative and do not match
                        matches = false;
                    }
                }
            }
        }

        // Feature checks (e.g., is_demo_user, has_custom_resolution)
        if matches {
            if let Some(features) = &rule.features {
                for (k, v) in features.iter() {
                    let satisfied = match k.as_str() {
                        "is_demo_user" => {
                            // Demo user detection: match launcher defaults
                            let is_demo = spec.username == "Player"
                                || spec.uuid == "00000000-0000-0000-0000-000000000000"
                                || spec.access_token == "0";
                            is_demo == *v
                        }
                        "has_custom_resolution" => {
                            let has_res =
                                spec.window_width.is_some() && spec.window_height.is_some();
                            has_res == *v
                        }
                        _ => {
                            // Unknown features: conservative, do not match
                            false
                        }
                    };

                    if !satisfied {
                        matches = false;
                        break;
                    }
                }
            }
        }

        if matches {
            match rule.action {
                RuleAction::Allow => allow = true,
                RuleAction::Disallow => allow = false,
            }
        }
    }

    allow
}

/// Substitute variables in a string
pub fn substitute_variables(text: &str, variables: &HashMap<String, String>) -> String {
    let mut result = text.to_string();

    for (key, value) in variables {
        let placeholder = format!("${{{}}}", key);
        result = result.replace(&placeholder, value);
    }

    result
}

/// Quick helper: return true when the provided `text` contains a placeholder
/// (e.g. ${foo}) that is either missing from `variables` or maps to an empty string.
fn contains_empty_placeholder(text: &str, variables: &HashMap<String, String>) -> bool {
    let mut idx = 0usize;
    while let Some(start) = text[idx..].find("${") {
        let abs = idx + start + 2; // position after '${'
        if let Some(end_rel) = text[abs..].find('}') {
            let end = abs + end_rel;
            let key = &text[abs..end];
            match variables.get(key) {
                Some(v) => {
                    if v.trim().is_empty() {
                        return true;
                    }
                }
                None => return true,
            }
            idx = end + 1;
        } else {
            // No closing brace — treat it as a bad/missing placeholder
            return true;
        }
    }

    false
}

/// Splits a string into whitespace-separated tokens while respecting
/// single and double quotes. Quotes are removed from returned tokens.
pub(crate) fn split_preserving_quotes(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut chars = s.chars().peekable();
    let mut in_double = false;
    let mut in_single = false;

    while let Some(c) = chars.next() {
        match c {
            '"' if !in_single => {
                in_double = !in_double;
            }
            '\'' if !in_double => {
                in_single = !in_single;
            }
            c if c.is_whitespace() && !in_double && !in_single => {
                if !buf.is_empty() {
                    out.push(buf.clone());
                    buf.clear();
                }
            }
            c => buf.push(c),
        }
    }

    if !buf.is_empty() {
        out.push(buf);
    }

    out
}

/// Build JVM variable map
fn build_jvm_variables(
    spec: &LaunchSpec,
    _manifest: &VersionManifest,
    natives_dir: &Path,
    classpath: &str,
) -> HashMap<String, String> {
    let mut vars = HashMap::new();

    // Prefer canonicalized paths so the variables are consistent across
    // platforms and avoid non-normalized paths (like "C:/../" or short/UNC forms).
    let natives_canon = canonicalize(natives_dir)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| natives_dir.to_string_lossy().to_string());
    vars.insert("natives_directory".to_string(), natives_canon);
    vars.insert("launcher_name".to_string(), "VestaLauncher".to_string());
    vars.insert("launcher_version".to_string(), "1.0.0".to_string());
    vars.insert("classpath".to_string(), classpath.to_string());
    let lib_dir = spec.libraries_dir();
    let lib_canon = canonicalize(&lib_dir)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| lib_dir.to_string_lossy().to_string());
    vars.insert("library_directory".to_string(), lib_canon);
    vars.insert(
        "classpath_separator".to_string(),
        OsType::current().classpath_separator().to_string(),
    );

    vars
}

/// Build game variable map
fn build_game_variables(spec: &LaunchSpec, manifest: &VersionManifest) -> HashMap<String, String> {
    let mut vars = HashMap::new();

    // Player info (support multiple common placeholders for compatibility)
    vars.insert("auth_player_name".to_string(), spec.username.clone());
    vars.insert("player_name".to_string(), spec.username.clone());
    vars.insert("auth_uuid".to_string(), spec.uuid.clone());
    vars.insert("uuid".to_string(), spec.uuid.clone());
    vars.insert("auth_access_token".to_string(), spec.access_token.clone());
    vars.insert("accessToken".to_string(), spec.access_token.clone());
    vars.insert("auth_session".to_string(), spec.access_token.clone());
    vars.insert("user_type".to_string(), spec.user_type.clone());

    // Version info
    vars.insert("version_name".to_string(), manifest.id.clone());
    vars.insert(
        "version_type".to_string(),
        manifest
            .version_type
            .clone()
            .unwrap_or_else(|| "release".to_string()),
    );

    // Directories
    let game_dir = spec.game_dir.clone();
    let game_canon = canonicalize(&game_dir)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| game_dir.to_string_lossy().to_string());
    vars.insert("game_directory".to_string(), game_canon);
    let assets_dir = spec.assets_dir();
    let assets_canon = canonicalize(&assets_dir)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| assets_dir.to_string_lossy().to_string());
    vars.insert("assets_root".to_string(), assets_canon.clone());

    // Asset index
    if let Some(ref asset_index) = manifest.asset_index {
        vars.insert("assets_index_name".to_string(), asset_index.id.clone());
    } else if let Some(ref assets) = manifest.assets {
        vars.insert("assets_index_name".to_string(), assets.clone());
    }
    
    // Game assets directory (legacy versions like 1.0 use ${game_assets})
    vars.insert("game_assets".to_string(), assets_canon);

    // Resolution
    if let Some(width) = spec.window_width {
        vars.insert("resolution_width".to_string(), width.to_string());
    }
    if let Some(height) = spec.window_height {
        vars.insert("resolution_height".to_string(), height.to_string());
    }

    // User properties and client id defaults (compat with manifests that use various names)
    vars.insert("user_properties".to_string(), "{}".to_string());
    // clientid should contain a launcher client id. Use value supplied on LaunchSpec
    // (plumbed through from the caller) so ita can be the official client id.
    vars.insert("clientid".to_string(), spec.client_id.clone());
    vars.insert("auth_session".to_string(), spec.access_token.clone());

    vars
}

/// Get default JVM arguments
fn get_default_jvm_args() -> Vec<String> {
    vec![
        // Memory settings
        "-Xms2G".to_string(),
        "-Xmx4G".to_string(),
        // G1GC settings for better performance
        "-XX:+UseG1GC".to_string(),
        "-XX:+UnlockExperimentalVMOptions".to_string(),
        "-XX:G1NewSizePercent=20".to_string(),
        "-XX:G1ReservePercent=20".to_string(),
        "-XX:MaxGCPauseMillis=50".to_string(),
        "-XX:G1HeapRegionSize=32M".to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_substitute_variables() {
        let mut vars = HashMap::new();
        vars.insert("username".to_string(), "Player".to_string());
        vars.insert("version".to_string(), "1.20.1".to_string());

        let result = substitute_variables("--username ${username} --version ${version}", &vars);
        assert_eq!(result, "--username Player --version 1.20.1");
    }

    #[test]
    fn test_substitute_variables_no_match() {
        let vars = HashMap::new();
        let result = substitute_variables("--username ${username}", &vars);
        assert_eq!(result, "--username ${username}");
    }

    #[test]
    fn test_default_jvm_args() {
        let args = get_default_jvm_args();
        assert!(args.contains(&"-Xms2G".to_string()));
        assert!(args.contains(&"-Xmx4G".to_string()));
        assert!(args.contains(&"-XX:+UseG1GC".to_string()));
    }

    #[test]
    fn build_variables_canonicalize_paths() {
        use std::fs;
        use tempfile::TempDir;

        let tmp = TempDir::new().unwrap();
        // Create directories with spaces to ensure canonicalize handles them
        let data_dir = tmp.path().join("my data");
        let libs = data_dir.join("libraries");
        let natives = data_dir.join("natives").join("instance with space");
        let assets = data_dir.join("assets");

        fs::create_dir_all(&libs).unwrap();
        fs::create_dir_all(&natives).unwrap();
        fs::create_dir_all(&assets).unwrap();

        let spec = LaunchSpec {
            instance_id: "test-inst".to_string(),
            version_id: "vtest".to_string(),
            modloader: None,
            modloader_version: None,
            data_dir: data_dir.clone(),
            game_dir: data_dir.join("game_dir"),
            java_path: std::path::PathBuf::from("java"),
            username: "Player".to_string(),
            uuid: "uuid".to_string(),
            access_token: "token".to_string(),
            user_type: "msa".to_string(),
            jvm_args: vec![],
            game_args: vec![],
            window_width: None,
            window_height: None,
            client_id: "cid".to_string(),
            exit_handler_jar: None,
            log_file: None,
        };

        let manifest = VersionManifest {
            id: "vtest".to_string(),
            main_class: None,
            inherits_from: None,
            arguments: None,
            minecraft_arguments: None,
            libraries: vec![],
            asset_index: None,
            assets: None,
            java_version: None,
            version_type: None,
            release_time: None,
            time: None,
        };

        let jvm_vars = build_jvm_variables(&spec, &manifest, &natives, "cp");
        // natives_directory should be canonicalized
        let expected_natives = canonicalize(&natives)
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert_eq!(
            jvm_vars.get("natives_directory").unwrap(),
            &expected_natives
        );

        // library_directory should canonicalize spec.libraries_dir()
        let expected_lib = canonicalize(&spec.libraries_dir())
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert_eq!(jvm_vars.get("library_directory").unwrap(), &expected_lib);

        // Game variables
        let game_vars = build_game_variables(&spec, &manifest);
        let expected_game = canonicalize(&spec.game_dir)
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert_eq!(game_vars.get("game_directory").unwrap(), &expected_game);

        let expected_assets = canonicalize(&assets).unwrap().to_string_lossy().to_string();
        // Note: spec.assets_dir gives data_dir.join("assets") because spec.assets_dir() constructs from data_dir
        assert_eq!(game_vars.get("assets_root").unwrap(), &expected_assets);
    }

    #[test]
    fn process_simple_split_and_drop() {
        use crate::game::launcher::version_parser::{Argument, Rule, RuleAction};

        // Build a simple LaunchSpec
        let spec = LaunchSpec {
            instance_id: "i".to_string(),
            version_id: "v".to_string(),
            modloader: None,
            modloader_version: None,
            data_dir: tempfile::tempdir().unwrap().path().to_path_buf(),
            game_dir: tempfile::tempdir().unwrap().path().to_path_buf(),
            java_path: std::path::PathBuf::from("java"),
            username: "Player".to_string(),
            uuid: "00000000-0000-0000-0000-000000000000".to_string(),
            access_token: "0".to_string(),
            user_type: "msa".to_string(),
            jvm_args: vec![],
            game_args: vec![],
            window_width: None,
            window_height: None,
            client_id: "cid".to_string(),
            exit_handler_jar: None,
            log_file: None,
        };

        let mut vars = HashMap::new();
        vars.insert("value".to_string(), "42".to_string());

        // Simple multi-token string should split
        let arg = Argument::Simple("--flag ${value}".to_string());
        let parts = process_argument(&arg, &vars, OsType::current(), &spec);
        assert_eq!(parts, vec!["--flag".to_string(), "42".to_string()]);

        // Missing variable -> drop entire token
        let empty_vars: HashMap<String, String> = HashMap::new();
        let parts = process_argument(&arg, &empty_vars, OsType::current(), &spec);
        assert!(parts.is_empty());

        // Conditional single value should also split
        let rule = Rule {
            action: RuleAction::Allow,
            os: None,
            features: None,
        };
        let cond = Argument::Conditional {
            rules: vec![rule],
            value: ArgumentValue::Single("--one ${value}".to_string()),
        };
        let parts = process_argument(&cond, &vars, OsType::current(), &spec);
        assert_eq!(parts, vec!["--one".to_string(), "42".to_string()]);

        // Conditional multiple: drop when missing value
        let cond2 = Argument::Conditional {
            rules: vec![Rule {
                action: RuleAction::Allow,
                os: None,
                features: None,
            }],
            value: ArgumentValue::Multiple(vec!["--a".to_string(), "${missing}".to_string()]),
        };
        let parts = process_argument(&cond2, &vars, OsType::current(), &spec);
        assert!(parts.is_empty());
    }

    #[test]
    fn evaluate_rules_feature_checks() {
        use crate::game::launcher::version_parser::{Rule, RuleAction};

        // Demo user spec: username Player and zero-uuid/access token 0
        let demo_spec = LaunchSpec {
            instance_id: "i".to_string(),
            version_id: "v".to_string(),
            modloader: None,
            modloader_version: None,
            data_dir: tempfile::tempdir().unwrap().path().to_path_buf(),
            game_dir: tempfile::tempdir().unwrap().path().to_path_buf(),
            java_path: std::path::PathBuf::from("java"),
            username: "Player".to_string(),
            uuid: "00000000-0000-0000-0000-000000000000".to_string(),
            access_token: "0".to_string(),
            user_type: "msa".to_string(),
            jvm_args: vec![],
            game_args: vec![],
            window_width: None,
            window_height: None,
            client_id: "cid".to_string(),
            exit_handler_jar: None,
            log_file: None,
        };

        // Rule requiring demo user should match
        let mut features = HashMap::new();
        features.insert("is_demo_user".to_string(), true);
        let rule = Rule {
            action: RuleAction::Allow,
            os: None,
            features: Some(features),
        };
        assert!(evaluate_rules(&[rule], OsType::current(), &demo_spec));

        // Rule requiring custom resolution should NOT match demo_spec
        let mut features2 = HashMap::new();
        features2.insert("has_custom_resolution".to_string(), true);
        let rule2 = Rule {
            action: RuleAction::Allow,
            os: None,
            features: Some(features2),
        };
        assert!(!evaluate_rules(
            &[rule2.clone()],
            OsType::current(),
            &demo_spec
        ));

        // A spec with resolution should match has_custom_resolution = true
        let res_spec = LaunchSpec {
            window_width: Some(800),
            window_height: Some(600),
            ..demo_spec.clone()
        };
        assert!(evaluate_rules(&[rule2], OsType::current(), &res_spec));
    }
}
