use crate::game::installer::types::OsType;
use crate::game::launcher::version_parser::{
    Argument, AssetIndex, ExtractRules, JavaVersion, Library, LoggingConfig, Rule, RuleAction,
    VersionManifest,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A unified manifest that combines vanilla and modloader requirements.
/// This is the final resolved state used by the installer and launcher.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedManifest {
    pub id: String,
    pub main_class: String,
    pub minecraft_version: String,
    pub java_version: Option<JavaVersion>,
    pub libraries: Vec<UnifiedLibrary>,
    pub asset_index: Option<AssetIndex>,
    pub game_arguments: Vec<Argument>,
    pub jvm_arguments: Vec<Argument>,
    #[serde(default)]
    pub processors: Vec<Processor>,
    #[serde(default)]
    pub data: HashMap<String, SidedDataEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assets: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "type")]
    pub version_type: Option<String>,
    pub is_legacy: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logging: Option<LoggingConfig>,
}

/// A resolved library with all conditional rules already applied.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedLibrary {
    pub name: String,
    pub path: String,
    pub download_url: Option<String>,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub is_native: bool,
    pub classifier: Option<String>,
    pub extract_rules: Option<ExtractRules>,
    #[serde(default = "default_true")]
    pub include_in_classpath: bool,
}

fn default_true() -> bool {
    true
}

/// Processor to run during installation (for Forge/NeoForge)
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Processor {
    pub jar: String,
    pub classpath: Vec<String>,
    pub args: Vec<String>,
    #[serde(default)]
    pub outputs: Option<HashMap<String, String>>,
    #[serde(default)]
    pub sides: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SidedDataEntry {
    pub client: String,
    pub server: String,
}

impl UnifiedManifest {
    pub fn merge(vanilla: VersionManifest, modloader: Option<VersionManifest>, os: OsType) -> Self {
        let mut id = vanilla.id.clone();
        let mut main_class = vanilla.main_class.clone().unwrap_or_default();
        let mut game_arguments = vanilla
            .arguments
            .as_ref()
            .map(|a| a.game.clone())
            .unwrap_or_default();
        let mut jvm_arguments = vanilla
            .arguments
            .as_ref()
            .map(|a| a.jvm.clone())
            .unwrap_or_default();

        // Handle legacy vanilla `minecraftArguments` (pre-1.13 string format)
        // when the structured `arguments` field is absent.
        if vanilla.arguments.is_none() {
            if let Some(ref legacy) = vanilla.minecraft_arguments {
                let tokens = crate::game::launcher::arguments::split_preserving_quotes(legacy);
                game_arguments = tokens.into_iter().map(Argument::Simple).collect();
            }
        }
        let mut libraries: Vec<UnifiedLibrary> = Vec::new();

        // Add vanilla libraries
        for lib in &vanilla.libraries {
            for unified in UnifiedLibrary::from_library(&lib, None, os) {
                libraries.push(unified);
            }
        }

        let mut java_version = vanilla.java_version.clone();
        let asset_index = vanilla.asset_index.clone();
        let minecraft_version = vanilla.id.clone();

        if let Some(ml) = modloader {
            id = ml.id.clone();
            if let Some(mc) = ml.main_class {
                main_class = mc;
            }

            // Merge arguments
            let mut child_game_args = ml
                .arguments
                .as_ref()
                .map(|a| a.game.clone())
                .unwrap_or_default();
            let child_jvm_args = ml
                .arguments
                .as_ref()
                .map(|a| a.jvm.clone())
                .unwrap_or_default();

            // CRITICAL FIX: Handle legacy Forge `minecraft_arguments`
            if let Some(legacy) = ml.minecraft_arguments {
                let tokens = crate::game::launcher::arguments::split_preserving_quotes(&legacy);
                let converted: Vec<Argument> = tokens.into_iter().map(Argument::Simple).collect();
                child_game_args.extend(converted);
            }

            if !child_game_args.is_empty() {
                let mut new_game = game_arguments;
                new_game.extend(child_game_args);
                // Deduplicate by flag name — both vanilla and modloader may
                // include common tokens like `--gameDir`, `--accessToken`.
                deduplicate_args(&mut new_game);
                game_arguments = new_game;
            }

            if !child_jvm_args.is_empty() {
                let mut new_jvm = jvm_arguments;
                new_jvm.extend(child_jvm_args);
                jvm_arguments = new_jvm;
            }

            // Determine modloader type for maven resolution
            let ml_type = if ml.id.contains("neoforge") {
                Some("neoforge")
            } else if ml.id.contains("forge") {
                Some("forge")
            } else if ml.id.contains("fabric") {
                Some("fabric")
            } else if ml.id.contains("quilt") {
                Some("quilt")
            } else {
                None
            };

            // Deduplicate vanilla libraries that the loader overrides.
            // Matches daedalus::merge_partial_version(): if the loader provides
            // a library with the same group:artifact and include_in_classpath=true,
            // the vanilla version is skipped to avoid class conflicts.
            //
            // We extract group:artifact by taking the first two colon-separated
            // components. This correctly handles Maven coords with classifiers
            // (group:artifact:version:classifier) where rsplit_once(':') would
            // yield group:artifact:version instead of group:artifact.
            let loader_lib_artifacts: Vec<&str> = ml
                .libraries
                .iter()
                .filter(|l| l.include_in_classpath)
                .filter_map(|l| maven_group_artifact(&l.name))
                .collect();

            libraries.retain(|lib| {
                if let Some(lib_artifact) = maven_group_artifact(&lib.name) {
                    !loader_lib_artifacts.contains(&lib_artifact)
                } else {
                    true
                }
            });

            // Add loader libraries
            let mut ml_unified_libraries = Vec::new();

            for ml_lib in ml.libraries {
                let unified_list = UnifiedLibrary::from_library(&ml_lib, ml_type, os);
                if unified_list.is_empty() {
                    continue;
                }

                ml_unified_libraries.extend(unified_list);
            }

            libraries.extend(ml_unified_libraries);

            if ml.java_version.is_some() {
                java_version = ml.java_version;
            }
        }

        let mut manifest = UnifiedManifest {
            id,
            main_class,
            minecraft_version,
            java_version,
            libraries,
            asset_index,
            game_arguments,
            jvm_arguments,
            processors: Vec::new(),
            data: HashMap::new(),
            assets: vanilla.assets.clone(),
            version_type: vanilla.version_type.clone(),
            is_legacy: crate::game::launcher::version_parser::is_legacy_version(&vanilla),
            logging: vanilla.logging.clone(),
        };
        manifest.apply_native_arch_policy(os);
        manifest
    }

    /// Drop redundant generic native libraries when an arch-specific variant exists
    /// for the same Maven group:artifact. Returns true if the library list changed.
    pub fn apply_native_arch_policy(&mut self, os: OsType) -> bool {
        let before = self.libraries.len();
        self.libraries =
            filter_native_libraries_by_arch_policy(std::mem::take(&mut self.libraries), os);
        self.libraries.len() != before
    }

    pub fn save_to_path(&self, path: &std::path::Path) -> anyhow::Result<()> {
        if path.exists() {
            let meta = std::fs::symlink_metadata(path)?;
            if meta.file_type().is_symlink() {
                anyhow::bail!("refusing to write manifest through symlink: {:?}", path);
            }
        }

        let parent = path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("manifest path has no parent: {:?}", path))?;
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("manifest.json");
        let temp_path = parent.join(format!(".{file_name}.tmp"));

        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(&temp_path, json)?;
        std::fs::rename(&temp_path, path)?;
        Ok(())
    }

    /// Load a unified manifest, apply native-arch normalization, and persist when stale.
    pub fn normalize_and_save_if_stale(path: &std::path::Path) -> anyhow::Result<Self> {
        let mut manifest = Self::load_from_path(path)?;
        if manifest.minecraft_version.is_empty() {
            return Ok(manifest);
        }

        let os = OsType::current();
        if manifest.apply_native_arch_policy(os) {
            log::info!(
                "[UnifiedManifest] Persisting normalized native libraries to {:?}",
                path
            );
            manifest.save_to_path(path)?;
        }
        Ok(manifest)
    }

    /// Add processors and data from a Forge install profile
    pub fn with_forge_profile(
        mut self,
        processors: Vec<Processor>,
        data: HashMap<String, SidedDataEntry>,
    ) -> Self {
        self.processors = processors;
        self.data = data;
        self
    }

    pub fn load_from_path(path: &std::path::Path) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)?;

        // Try to parse as UnifiedManifest first
        if let Ok(manifest) = serde_json::from_str::<Self>(&content) {
            // Check if it's actually a UnifiedManifest by looking for a required field
            // that standard Mojang manifests don't have.
            if !manifest.minecraft_version.is_empty() {
                return Ok(manifest);
            }
        }

        // Fallback to VersionManifest and convert
        let v: VersionManifest = serde_json::from_str(&content)?;
        Ok(Self::from(v))
    }

    pub fn has_natives(&self) -> bool {
        self.libraries.iter().any(|l| l.is_native)
    }
}

impl From<VersionManifest> for UnifiedManifest {
    fn from(v: VersionManifest) -> Self {
        UnifiedManifest::merge(v, None, OsType::current())
    }
}

impl UnifiedLibrary {
    pub fn from_library(lib: &Library, ml_type: Option<&str>, os: OsType) -> Vec<Self> {
        // Check if library should be included based on rules
        if !should_include_library(lib, os) {
            return Vec::new();
        }

        let mut results = Vec::new();

        // 1. Check for normal artifact
        let mut normal_lib = None;
        if let Some(downloads) = &lib.downloads {
            if let Some(artifact) = &downloads.artifact {
                let path = artifact
                    .path
                    .clone()
                    .unwrap_or_else(|| name_to_path(&lib.name));
                let explicit = artifact.url.as_deref().filter(|s| !s.is_empty());
                let url = normalize_explicit_url(
                    explicit,
                    &path,
                    lib.url.as_deref(),
                    resolve_maven_url(&lib.name, ml_type),
                );

                // In modern Minecraft, native libraries are often separate entries with
                // ":natives-<os>" or ":native-<name>:<os>-<arch>" in their name. We need
                // to mark them as native so they get extracted.
                let name_lower = lib.name.to_lowercase();
                let parts: Vec<&str> = lib.name.split(':').collect();
                let is_native_by_name = name_lower.contains(":natives-")
                    || name_lower.contains(":native-")
                    || (name_lower.contains("natives-") && parts.len() > 3)
                    || (name_lower.contains("native-") && parts.len() > 3)
                    || (parts.len() > 3 && {
                        let cl = parts[3].to_lowercase();
                        cl.starts_with("osx-")
                            || cl.starts_with("macos-")
                            || cl.starts_with("linux-")
                            || cl.starts_with("windows-")
                            || cl.starts_with("win-")
                    });

                // Extract the classifier from the name
                let classifier = if parts.len() > 3 {
                    Some(parts[3].to_string())
                } else {
                    None
                };

                normal_lib = Some(UnifiedLibrary {
                    name: lib.name.clone(),
                    path,
                    download_url: url,
                    sha1: artifact.sha1.clone(),
                    size: artifact.size,
                    is_native: is_native_by_name,
                    classifier,
                    extract_rules: lib.extract.clone(),
                    include_in_classpath: lib.include_in_classpath,
                });
            }
        }

        // If no downloads.artifact, but it's a normal library (no natives field),
        // we still might need it (e.g. Fabric/Quilt libraries often don't have downloads field)
        if normal_lib.is_none() && lib.natives.is_none() {
            let path = name_to_path(&lib.name);
            let url = normalize_explicit_url(
                None,
                &path,
                lib.url.as_deref(),
                resolve_maven_url(&lib.name, ml_type),
            );

            normal_lib = Some(UnifiedLibrary {
                name: lib.name.clone(),
                path,
                download_url: url,
                sha1: None,
                size: None,
                is_native: false,
                classifier: None,
                extract_rules: lib.extract.clone(),
                include_in_classpath: lib.include_in_classpath,
            });
        }

        if let Some(nl) = normal_lib {
            results.push(nl);
        }

        // 2. Check for native classifier
        // Try ARM-specific keys first (e.g. "osx-arm64") so that
        // Modrinth-patched version JSONs with arm64 native classifiers
        // are preferred on Apple Silicon / ARM Linux machines.
        let mut native_classifier = if let Some(natives) = &lib.natives {
            let os_keys: &[&str] = match os {
                OsType::WindowsArm64 => &["windows-arm64", "windows"],
                OsType::Windows => &["windows"],
                OsType::MacOSArm64 => &["osx-arm64", "osx"],
                OsType::MacOS => &["osx"],
                OsType::LinuxArm64 => &["linux-arm64", "linux"],
                OsType::LinuxArm32 => &["linux-arm32", "linux"],
                OsType::Linux => &["linux"],
            };
            os_keys.iter().find_map(|key| natives.get(*key)).cloned()
        } else {
            None
        };

        // Fallback: Check downloads.classifiers for OS match if not found in natives map or inferred
        if native_classifier.is_none() {
            if let Some(downloads) = &lib.downloads {
                if let Some(classifiers) = &downloads.classifiers {
                    for key in classifiers.keys() {
                        if classifier_key_matches_os(key, os) {
                            native_classifier = Some(key.clone());
                            break;
                        }
                    }
                }
            }
        }

        if let Some(classifier) = native_classifier {
            let arch_str = match os {
                OsType::Windows | OsType::MacOS | OsType::Linux => "64",
                OsType::WindowsArm64 | OsType::MacOSArm64 | OsType::LinuxArm64 => "arm64",
                OsType::LinuxArm32 => "arm32",
            };
            let classifier = classifier.replace("${arch}", arch_str);
            let mut path = String::new();
            let mut url = None;
            let mut sha1 = None;
            let mut size = None;

            if let Some(downloads) = &lib.downloads {
                if let Some(classifiers) = &downloads.classifiers {
                    if let Some(artifact) = classifiers.get(&classifier) {
                        path = artifact.path.clone().unwrap_or_default();
                        let explicit = artifact.url.as_deref().filter(|s| !s.is_empty());
                        url = normalize_explicit_url(
                            explicit,
                            &path,
                            lib.url.as_deref(),
                            resolve_maven_url_with_classifier(&lib.name, &classifier, ml_type),
                        );
                        sha1 = artifact.sha1.clone();
                        size = artifact.size;
                    }
                }
            }

            if path.is_empty() {
                path = name_to_path_with_classifier(&lib.name, &classifier);
            }

            if url.is_none() {
                url = normalize_explicit_url(
                    None,
                    &path,
                    lib.url.as_deref(),
                    resolve_maven_url_with_classifier(&lib.name, &classifier, ml_type),
                );
            }

            results.push(UnifiedLibrary {
                name: lib.name.clone(),
                path,
                download_url: url,
                sha1,
                size,
                is_native: true,
                classifier: Some(classifier),
                extract_rules: lib.extract.clone(),
                include_in_classpath: lib.include_in_classpath,
            });
        }

        results
    }
}

fn should_include_library(library: &Library, os: OsType) -> bool {
    // If the Maven coordinate has a classifier that explicitly targets an OS,
    // require it to match the current runtime architecture/OS.
    // This prevents downloading/extracting both x64 and arm64 native variants.
    let parts: Vec<&str> = library.name.split(':').collect();
    if parts.len() > 3 {
        let classifier = parts[3].to_lowercase();
        let os_specific = classifier.contains("osx")
            || classifier.contains("macos")
            || classifier.contains("linux")
            || classifier.contains("windows")
            || classifier.contains("win");
        if os_specific {
            let token = if classifier.contains("native") {
                classifier
            } else {
                format!("natives-{classifier}")
            };
            if !os.classifier_matches(&token) {
                return false;
            }
        }
    }

    let Some(rules) = &library.rules else {
        return true;
    };

    // Modrinth-style rule evaluation:
    // - Allow + match     -> include
    // - Allow + no match  -> exclude (rule says "only include if...")
    // - Disallow + match  -> exclude
    // - Disallow + no match -> neutral (rule doesn't apply)
    // - If ALL rules are Disallow and NONE match -> include (default allow)
    let mut results: Vec<Option<bool>> = rules
        .iter()
        .map(|rule| {
            let matches = rule_matches(rule, os);
            match rule.action {
                RuleAction::Allow => Some(matches),
                RuleAction::Disallow => {
                    if matches {
                        Some(false)
                    } else {
                        None
                    }
                }
            }
        })
        .collect();

    // If every rule is a disallow, add a synthetic allow (default-allow)
    if rules
        .iter()
        .all(|r| matches!(r.action, RuleAction::Disallow))
    {
        results.push(Some(true));
    }

    // Include if: at least one explicit true AND no explicit false
    let should_exclude =
        results.iter().any(|r| r == &Some(false)) || results.iter().all(|r| r.is_none());

    // Exception: On ARM64 systems, if the library has ARM64-specific native classifiers
    // for the **current** OS (e.g., "osx-arm64" on macOS ARM64), include it even if
    // rules would normally exclude it. This handles Modrinth JSONs that provide arm64
    // variants alongside old libraries with outdated rules.
    //
    // IMPORTANT: The check is scoped to the current OS — a Linux-only "natives-linux-arm64"
    // must NOT trigger this exception on macOS ARM64.
    if should_exclude {
        let arm64_os_key = match os {
            OsType::MacOSArm64 => Some("osx-arm64"),
            OsType::LinuxArm64 => Some("linux-arm64"),
            OsType::WindowsArm64 => Some("windows-arm64"),
            _ => None,
        };
        let os_prefix = os.os_name(); // "osx", "linux", or "windows"

        if let Some(arm64_key) = arm64_os_key {
            // Check natives map for a direct ARM64 entry (e.g. { "osx-arm64": "natives-osx-arm64" })
            if let Some(natives) = &library.natives {
                if natives.contains_key(arm64_key) {
                    return true;
                }
            }
            // Check classifiers for OS + arm64 combination
            if let Some(downloads) = &library.downloads {
                if let Some(classifiers) = &downloads.classifiers {
                    if classifiers.keys().any(|k| {
                        let kl = k.to_lowercase();
                        kl.contains(os_prefix) && (kl.contains("arm64") || kl.contains("aarch64"))
                    }) {
                        return true;
                    }
                }
            }
        }
    }

    !should_exclude
}

fn rule_matches(rule: &Rule, os: OsType) -> bool {
    if let Some(ref os_rule) = rule.os {
        if let Some(ref os_name) = os_rule.name {
            if !os.matches_rule_os_name(os_name) {
                return false;
            }
        }

        if let Some(ref arch) = os_rule.arch {
            let target_arch = match os {
                OsType::Windows | OsType::MacOS | OsType::Linux => "x86_64",
                OsType::WindowsArm64 | OsType::MacOSArm64 | OsType::LinuxArm64 => "aarch64",
                OsType::LinuxArm32 => "arm",
            };
            let normalized_arch = match arch.as_str() {
                "x64" | "amd64" => "x86_64",
                "x86" => "x86",
                "arm64" => "aarch64",
                _ => arch.as_str(),
            };

            if normalized_arch != target_arch {
                return false;
            }
        }
    }

    if let Some(ref features) = rule.features {
        for (feature_name, required_state) in features {
            match feature_name.as_str() {
                "is_demo_user" => {
                    if required_state.unwrap_or(true) {
                        return false;
                    }
                }
                "has_custom_resolution" => {
                    if required_state.unwrap_or(true) {
                        return false;
                    }
                }
                _ => {}
            }
        }
    }

    true
}

fn name_to_path_with_classifier(name: &str, classifier: &str) -> String {
    // If we have a classifier, we can just append it to the name and use the standard parser
    let coords = if name.contains('@') {
        let (base, ext) = name.split_once('@').unwrap();
        format!("{}:{}@{}", base, classifier, ext)
    } else {
        format!("{}:{}", name, classifier)
    };

    crate::game::launcher::maven_to_path(&coords).unwrap_or_else(|_| {
        let parts: Vec<&str> = name.split(':').collect();
        let group = parts[0].replace('.', "/");
        let artifact = parts.get(1).unwrap_or(&"");
        let version = parts.get(2).unwrap_or(&"");
        format!(
            "{}/{}/{}/{}-{}-{}.jar",
            group, artifact, version, artifact, version, classifier
        )
    })
}

fn name_to_path(name: &str) -> String {
    crate::game::launcher::maven_to_path(name)
        .unwrap_or_else(|_| name.replace('.', "/").replace(':', "/"))
}

/// Libraries that Modrinth/Mojang host on libraries.minecraft.net even inside Forge profiles.
fn uses_mojang_libraries_mirror(name: &str) -> bool {
    name.starts_with("com.mojang")
        || name.starts_with("net.minecraft")
        || name.starts_with("org.lwjgl")
        || name.starts_with("java3d:")
        || name.starts_with("lzma:")
        || name.starts_with("com.google.code.gson")
        || name.starts_with("com.google.guava")
        || name.starts_with("org.apache.commons")
        || name.starts_with("commons-")
        || name.starts_with("commons:")
        || name.starts_with("io.netty")
        || name.starts_with("tv.twitch")
}

fn is_forge_artifact(name: &str) -> bool {
    name.starts_with("net.minecraftforge") || name.starts_with("com.minecraftforge")
}

fn is_neoforge_artifact(name: &str) -> bool {
    name.starts_with("net.neoforged")
}

/// Pick a Maven base URL when a loader profile library has no `downloads` or `url`.
/// Modrinth loader JSONs usually include `url: https://launcher-meta.modrinth.com/maven/`;
/// this fallback only runs for the sparse entries that omit both fields (common on legacy Forge).
fn resolve_maven_base(name: &str, ml_type: Option<&str>) -> Option<&'static str> {
    if uses_mojang_libraries_mirror(name) {
        return Some("https://libraries.minecraft.net/");
    }

    match ml_type {
        Some("neoforge") if is_neoforge_artifact(name) => {
            Some("https://maven.neoforged.net/releases/")
        }
        Some("forge") if is_forge_artifact(name) => Some("https://maven.minecraftforge.net/"),
        // Match Modrinth loader profiles that point other deps at their Maven mirror.
        Some("forge") | Some("neoforge") => Some("https://launcher-meta.modrinth.com/maven/"),
        Some("fabric") => Some("https://maven.fabricmc.net/"),
        Some("quilt") => Some("https://maven.quiltmc.org/repository/release/"),
        _ => None,
    }
}

fn join_maven_url(base: &str, path: &str) -> String {
    if base.ends_with('/') {
        format!("{}{}", base, path)
    } else {
        format!("{}/{}", base, path)
    }
}

fn is_absolute_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn looks_like_artifact_url(value: &str, path: &str) -> bool {
    let clean = value.split(['?', '#']).next().unwrap_or(value);
    let clean_lower = clean.to_ascii_lowercase();
    clean.trim_end_matches('/').ends_with(path)
        || clean_lower.ends_with(".jar")
        || clean_lower.ends_with(".zip")
        || clean_lower.ends_with(".lzma")
        || clean_lower.ends_with(".json")
        || clean_lower.ends_with(".pom")
}

fn join_repository_base_or_final_url(base: &str, path: &str) -> String {
    if is_absolute_url(base) && looks_like_artifact_url(base, path) {
        return base.to_string();
    }

    join_maven_url(base, path)
}

fn resolve_maven_url(name: &str, ml_type: Option<&str>) -> Option<String> {
    let path = name_to_path(name);
    resolve_maven_base(name, ml_type).map(|base| join_maven_url(base, &path))
}

fn resolve_maven_url_with_classifier(
    name: &str,
    classifier: &str,
    ml_type: Option<&str>,
) -> Option<String> {
    let path = name_to_path_with_classifier(name, classifier);
    resolve_maven_base(name, ml_type).map(|base| join_maven_url(base, &path))
}

fn normalize_explicit_url(
    explicit: Option<&str>,
    path: &str,
    lib_base: Option<&str>,
    maven_base: Option<String>,
) -> Option<String> {
    // If we have an explicit URL
    if let Some(s) = explicit {
        if is_absolute_url(s) {
            return Some(s.to_string());
        }
        // Relative explicit - prefer lib_base, then maven_base
        if !s.is_empty() {
            if let Some(base) = lib_base {
                if is_absolute_url(base) && looks_like_artifact_url(base, path) {
                    return Some(base.to_string());
                }
                return Some(join_maven_url(base, s.trim_start_matches('/')));
            }
            if let Some(mb) = maven_base.as_deref() {
                if is_absolute_url(mb) && looks_like_artifact_url(mb, path) {
                    return Some(mb.to_string());
                }
                return Some(join_maven_url(mb, s.trim_start_matches('/')));
            }
        }
    } else {
        // No explicit URL: build from lib_base + path or maven_base + path
        if let Some(base) = lib_base {
            return Some(join_repository_base_or_final_url(base, path));
        }
        if let Some(mb) = maven_base.as_deref() {
            return Some(join_repository_base_or_final_url(mb, path));
        }
    }

    None
}

fn classifier_key_matches_os(key: &str, target_os: OsType) -> bool {
    target_os.classifier_matches(key)
}

/// Filter native libraries based on architecture policy.
/// On ARM64, when both a generic native (e.g., "natives-osx") and an arch-specific
/// variant (e.g., "natives-osx-arm64") exist for the same library, this function
/// removes the generic one to prevent downloading x86/x64-only binaries.
fn filter_native_libraries_by_arch_policy(
    libraries: Vec<UnifiedLibrary>,
    os: OsType,
) -> Vec<UnifiedLibrary> {
    use crate::game::installer::types::NATIVE_ARCH_POLICY;
    use std::collections::HashMap;

    // Only apply filtering on ARM64 with PreferArchSpecificOnly policy
    if NATIVE_ARCH_POLICY
        != crate::game::installer::types::NativeArchitecturePolicy::PreferArchSpecificOnly
    {
        return libraries;
    }

    let target_is_arm64 = matches!(
        os,
        OsType::MacOSArm64 | OsType::LinuxArm64 | OsType::WindowsArm64
    );

    if !target_is_arm64 {
        return libraries;
    }

    // Group OS-matching native libraries by group:artifact (any version).
    let mut base_to_libs: HashMap<String, Vec<&UnifiedLibrary>> = HashMap::new();
    for lib in &libraries {
        if !lib.is_native {
            continue;
        }
        if !lib
            .classifier
            .as_ref()
            .is_some_and(|cl| os.classifier_matches(cl))
        {
            continue;
        }
        let base = maven_group_artifact(&lib.name)
            .unwrap_or(lib.name.as_str())
            .to_string();
        base_to_libs.entry(base).or_insert_with(Vec::new).push(lib);
    }

    // Filter: for each group, skip generic natives when an arch-specific sibling exists.
    let mut skip_names = std::collections::HashSet::new();
    for libs in base_to_libs.values() {
        let has_arch_specific = libs.iter().any(|lib| {
            lib.classifier.as_ref().is_some_and(|cl| {
                let cl_lower = cl.to_lowercase();
                cl_lower.contains("arm64")
                    || cl_lower.contains("aarch64")
                    || cl_lower.contains("aarch_64")
            })
        });

        if has_arch_specific {
            for lib in libs {
                if let Some(cl) = &lib.classifier {
                    if os.should_skip_generic_native(cl, has_arch_specific) {
                        log::info!(
                            "[NativeArchPolicy] Skipping generic native {} (arch-specific variant exists)",
                            &lib.name
                        );
                        skip_names.insert(lib.name.clone());
                    }
                }
            }
        }
    }

    // Remove flagged libraries
    libraries
        .into_iter()
        .filter(|lib| !skip_names.contains(&lib.name))
        .collect()
}

/// Deduplicate game arguments by flag name.
/// Legacy `minecraftArguments` produce `--flag value` pairs. When both vanilla
/// and modloader provide these (e.g. `--gameDir`, `--accessToken`), the same
/// flag can appear twice. This function removes the second occurrence.
fn deduplicate_args(args: &mut Vec<Argument>) {
    use std::collections::HashSet;
    let mut seen_flags: HashSet<String> = HashSet::new();
    let mut i = 0;
    while i < args.len() {
        let is_dup_flag = match &args[i] {
            Argument::Simple(s) if s.starts_with("--") => !seen_flags.insert(s.clone()),
            _ => false,
        };
        if is_dup_flag {
            // Remove the duplicate flag
            args.remove(i);
            // Remove its value too (next token, if it doesn't start with --)
            if i < args.len() {
                let next_is_value = match &args[i] {
                    Argument::Simple(s) => !s.starts_with("--"),
                    _ => true,
                };
                if next_is_value {
                    args.remove(i);
                }
            }
            // Don't increment i — next element shifted into this position
        } else {
            i += 1;
        }
    }
}

/// Extract group:artifact from a Maven coordinate string.
///
/// Maven coords have the format `group:artifact:version` or
/// `group:artifact:version:classifier`. This function returns the first
/// two colon-separated components (`group:artifact`), which is the correct
/// key for library deduplication.
fn maven_group_artifact(coord: &str) -> Option<&str> {
    let first_colon = coord.find(':')?;
    let rest = &coord[first_colon + 1..];
    let second_colon = rest.find(':')?;
    Some(&coord[..first_colon + 1 + second_colon])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::launcher::version_parser::{Rule, RuleAction};

    fn allow_rule_for_os(name: &str) -> Rule {
        Rule {
            action: RuleAction::Allow,
            os: Some(crate::game::launcher::version_parser::OsRule {
                name: Some(name.to_string()),
                version: None,
                arch: None,
            }),
            features: None,
        }
    }

    #[test]
    fn rule_matches_osx_base_name_for_arm64_macos() {
        let rule = allow_rule_for_os("osx");
        assert!(rule_matches(&rule, OsType::MacOSArm64));
    }

    #[test]
    fn should_include_library_when_rule_uses_base_os_name() {
        let mut lib = Library {
            name: "org.lwjgl:lwjgl:3.4.1:natives-macos-arm64".to_string(),
            ..Default::default()
        };
        lib.rules = Some(vec![allow_rule_for_os("osx")]);
        assert!(should_include_library(&lib, OsType::MacOSArm64));
    }

    #[test]
    fn should_exclude_arm64_native_classifier_on_intel_macos() {
        let mut lib = Library {
            name: "org.lwjgl:lwjgl:3.4.1:natives-macos-arm64".to_string(),
            ..Default::default()
        };
        lib.rules = Some(vec![allow_rule_for_os("osx")]);
        assert!(!should_include_library(&lib, OsType::MacOS));
    }

    #[test]
    fn should_include_aarch64_classifier_on_arm64_linux() {
        let mut lib = Library {
            name: "io.netty:netty-transport-native-epoll:4.2.7.Final:linux-aarch_64".to_string(),
            ..Default::default()
        };
        lib.rules = Some(vec![allow_rule_for_os("linux")]);
        assert!(should_include_library(&lib, OsType::LinuxArm64));
    }

    #[test]
    fn filter_native_drops_generic_when_arch_specific_exists_across_versions() {
        let libs = vec![
            UnifiedLibrary {
                name: "org.lwjgl.lwjgl:lwjgl-platform:2.9.4-nightly-20150209".to_string(),
                path: "a.jar".to_string(),
                download_url: None,
                sha1: None,
                size: None,
                is_native: true,
                classifier: Some("natives-osx-arm64".to_string()),
                extract_rules: None,
                include_in_classpath: true,
            },
            UnifiedLibrary {
                name: "org.lwjgl.lwjgl:lwjgl-platform:2.9.2-nightly-20140822".to_string(),
                path: "b.jar".to_string(),
                download_url: None,
                sha1: None,
                size: None,
                is_native: true,
                classifier: Some("natives-osx".to_string()),
                extract_rules: None,
                include_in_classpath: true,
            },
        ];

        let filtered = filter_native_libraries_by_arch_policy(libs, OsType::MacOSArm64);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].classifier.as_deref(), Some("natives-osx-arm64"));
    }

    #[test]
    fn filter_native_keeps_osx_when_only_linux_arm64_sibling_exists() {
        let libs = vec![
            UnifiedLibrary {
                name: "org.lwjgl.lwjgl:lwjgl-platform:2.9.4-nightly-20150209".to_string(),
                path: "a.jar".to_string(),
                download_url: None,
                sha1: None,
                size: None,
                is_native: true,
                classifier: Some("natives-linux-arm64".to_string()),
                extract_rules: None,
                include_in_classpath: true,
            },
            UnifiedLibrary {
                name: "org.lwjgl.lwjgl:lwjgl-platform:2.9.2-nightly-20140822".to_string(),
                path: "b.jar".to_string(),
                download_url: None,
                sha1: None,
                size: None,
                is_native: true,
                classifier: Some("natives-osx".to_string()),
                extract_rules: None,
                include_in_classpath: true,
            },
        ];

        let filtered = filter_native_libraries_by_arch_policy(libs, OsType::MacOSArm64);
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn normalize_and_save_if_stale_persists_normalized_native_libraries() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("forge-loader-test.json");

        let stale = UnifiedManifest {
            id: "forge-loader-test".to_string(),
            main_class: "net.minecraft.launchwrapper.Launch".to_string(),
            minecraft_version: "1.12.2".to_string(),
            java_version: None,
            libraries: vec![
                UnifiedLibrary {
                    name: "org.lwjgl.lwjgl:lwjgl-platform:2.9.4-nightly-20150209".to_string(),
                    path: "a.jar".to_string(),
                    download_url: None,
                    sha1: None,
                    size: None,
                    is_native: true,
                    classifier: Some("natives-osx-arm64".to_string()),
                    extract_rules: None,
                    include_in_classpath: true,
                },
                UnifiedLibrary {
                    name: "org.lwjgl.lwjgl:lwjgl-platform:2.9.2-nightly-20140822".to_string(),
                    path: "b.jar".to_string(),
                    download_url: None,
                    sha1: None,
                    size: None,
                    is_native: true,
                    classifier: Some("natives-osx".to_string()),
                    extract_rules: None,
                    include_in_classpath: true,
                },
            ],
            asset_index: None,
            game_arguments: vec![],
            jvm_arguments: vec![],
            processors: vec![],
            data: HashMap::new(),
            assets: None,
            version_type: None,
            is_legacy: true,
            logging: None,
        };

        stale.save_to_path(&path).expect("write stale manifest");

        let loaded =
            UnifiedManifest::normalize_and_save_if_stale(&path).expect("normalize manifest");
        assert_eq!(loaded.libraries.len(), 1);
        assert_eq!(
            loaded.libraries[0].classifier.as_deref(),
            Some("natives-osx-arm64")
        );

        let on_disk: UnifiedManifest =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(on_disk.libraries.len(), 1);

        let reloaded = UnifiedManifest::load_from_path(&path).expect("reload manifest");
        assert_eq!(reloaded.libraries.len(), 1);
    }

    #[test]
    fn forge_sparse_libraries_use_mojang_or_modrinth_mirror_not_forge_maven() {
        let forge = Some("forge");
        assert_eq!(
            resolve_maven_url("net.minecraft:launchwrapper:1.12", forge),
            Some(
                "https://libraries.minecraft.net/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar"
                    .to_string()
            )
        );
        assert_eq!(
            resolve_maven_url("org.scala-lang:scala-library:2.11.1", forge),
            Some(
                "https://launcher-meta.modrinth.com/maven/org/scala-lang/scala-library/2.11.1/scala-library-2.11.1.jar"
                    .to_string()
            )
        );
        let forge_url =
            resolve_maven_url("net.minecraftforge:forge:1.8.9-11.15.1.2318-1.8.9", forge)
                .expect("forge artifact url");
        assert!(forge_url.starts_with("https://maven.minecraftforge.net/"));
    }

    #[test]
    fn forge_client_classifier_resolves_to_forge_maven_once() {
        let forge_url = resolve_maven_url_with_classifier(
            "net.minecraftforge:forge:26.1.2-64.0.8",
            "client",
            Some("forge"),
        )
        .expect("forge client artifact url");

        assert_eq!(
            forge_url,
            "https://maven.minecraftforge.net/net/minecraftforge/forge/26.1.2-64.0.8/forge-26.1.2-64.0.8-client.jar"
        );
        assert!(!forge_url.contains(".jar/net/minecraftforge/"));
    }

    #[test]
    fn full_library_url_is_preserved_instead_of_treated_as_base() {
        let path = "net/minecraftforge/forge/26.1.2-64.0.8/forge-26.1.2-64.0.8-client.jar";
        let final_url = "https://maven.minecraftforge.net/net/minecraftforge/forge/26.1.2-64.0.8/forge-26.1.2-64.0.8-client.jar";

        assert_eq!(
            normalize_explicit_url(None, path, Some(final_url), None),
            Some(final_url.to_string())
        );
    }

    #[test]
    fn library_repository_base_appends_artifact_path_once() {
        let path = "net/minecraftforge/forge/26.1.2-64.0.8/forge-26.1.2-64.0.8-client.jar";

        assert_eq!(
            normalize_explicit_url(None, path, Some("https://maven.minecraftforge.net/"), None),
            Some(
                "https://maven.minecraftforge.net/net/minecraftforge/forge/26.1.2-64.0.8/forge-26.1.2-64.0.8-client.jar"
                    .to_string()
            )
        );
    }
}
