use serde::{Deserialize, Serialize};
use crate::game::launcher::version_parser::{AssetIndex, JavaVersion, Library, ExtractRules, VersionManifest, Argument, Rule, RuleAction};
use crate::game::installer::types::{OsType, Arch};
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
        let mut game_arguments = vanilla.arguments.as_ref().map(|a| a.game.clone()).unwrap_or_default();
        let mut jvm_arguments = vanilla.arguments.as_ref().map(|a| a.jvm.clone()).unwrap_or_default();
        let mut libraries_map: HashMap<String, UnifiedLibrary> = HashMap::new();

        // Add vanilla libraries
        for lib in vanilla.libraries {
            for unified in UnifiedLibrary::from_library(&lib, None, os) {
                libraries_map.insert(get_lib_key(&unified), unified);
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
            if let Some(ml_args) = ml.arguments {
                game_arguments.extend(ml_args.game);
                jvm_arguments.extend(ml_args.jvm);
            }

            // Determine modloader type for maven resolution
            let ml_type = if ml.id.contains("forge") {
                Some("forge")
            } else if ml.id.contains("fabric") {
                Some("fabric")
            } else if ml.id.contains("quilt") {
                Some("quilt")
            } else {
                None
            };

            // Merge libraries
            for lib in ml.libraries {
                for unified in UnifiedLibrary::from_library(&lib, ml_type, os) {
                    libraries_map.insert(get_lib_key(&unified), unified);
                }
            }

            if ml.java_version.is_some() {
                java_version = ml.java_version;
            }
        }

        UnifiedManifest {
            id,
            main_class,
            minecraft_version,
            java_version,
            libraries: libraries_map.into_values().collect(),
            asset_index,
            game_arguments,
            jvm_arguments,
            processors: Vec::new(),
            data: HashMap::new(),
            assets: vanilla.assets.clone(),
            version_type: vanilla.version_type.clone(),
            is_legacy: vanilla.minecraft_arguments.is_some() && vanilla.arguments.is_none(),
        }
    }

    /// Add processors and data from a Forge install profile
    pub fn with_forge_profile(mut self, processors: Vec<Processor>, data: HashMap<String, SidedDataEntry>) -> Self {
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

/// Helper to get deduplication key (group:artifact:classifier)
fn get_lib_key(lib: &UnifiedLibrary) -> String {
    let parts: Vec<&str> = lib.name.split(':').collect();
    let base = if parts.len() >= 2 {
        format!("{}:{}", parts[0], parts[1])
    } else {
        lib.name.clone()
    };

    if let Some(ref classifier) = lib.classifier {
        format!("{}:{}", base, classifier)
    } else {
        base
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
                let path = artifact.path.clone().unwrap_or_else(|| name_to_path(&lib.name));
                let url = artifact.url.clone().or_else(|| {
                    if let Some(lib_url) = &lib.url {
                        let base = if lib_url.ends_with('/') { lib_url.clone() } else { format!("{}/", lib_url) };
                        Some(format!("{}{}", base, path))
                    } else {
                        resolve_maven_url(&lib.name, ml_type)
                    }
                });

                // In modern Minecraft, native libraries are often separate entries with 
                // ":natives-<os>" in their name. We need to mark them as native so they get extracted.
                let name_lower = lib.name.to_lowercase();
                let is_native_by_name = name_lower.contains(":natives-") 
                    || (name_lower.contains("natives-") && name_lower.split(':').count() > 3);
                
                // If it's a separate entry, it might have the classifier in the name
                let parts: Vec<&str> = lib.name.split(':').collect();
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
                });
            }
        }

        // If no downloads.artifact, but it's a normal library (no natives field), 
        // we still might need it (e.g. Fabric/Quilt libraries often don't have downloads field)
        if normal_lib.is_none() && lib.natives.is_none() {
             let path = name_to_path(&lib.name);
             let url = if let Some(lib_url) = &lib.url {
                let base = if lib_url.ends_with('/') { lib_url.clone() } else { format!("{}/", lib_url) };
                Some(format!("{}{}", base, path))
             } else {
                resolve_maven_url(&lib.name, ml_type)
             };

             normal_lib = Some(UnifiedLibrary {
                name: lib.name.clone(),
                path,
                download_url: url,
                sha1: None,
                size: None,
                is_native: false,
                classifier: None,
                extract_rules: lib.extract.clone(),
             });
        }

        if let Some(nl) = normal_lib {
            results.push(nl);
        }

        // 2. Check for native classifier
        let mut native_classifier = if let Some(natives) = &lib.natives {
            let os_key = match os {
                OsType::Windows | OsType::WindowsArm64 => "windows",
                OsType::MacOS | OsType::MacOSArm64 => "osx",
                OsType::Linux | OsType::LinuxArm32 | OsType::LinuxArm64 => "linux",
            };
            natives.get(os_key).cloned()
        } else {
            None
        };

        // Fallback: Check downloads.classifiers for OS match if not found in natives map
        if native_classifier.is_none() {
            if let Some(downloads) = &lib.downloads {
                if let Some(classifiers) = &downloads.classifiers {
                    let os_name = match os {
                        OsType::Windows | OsType::WindowsArm64 => "windows",
                        OsType::MacOS | OsType::MacOSArm64 => "osx",
                        OsType::Linux | OsType::LinuxArm32 | OsType::LinuxArm64 => "linux",
                    };
                    
                    for key in classifiers.keys() {
                        if classifier_key_matches_os(key, os_name) {
                            // On 64-bit systems, avoid "x86" (32-bit) libraries if possible
                            // Check for "x86" but NOT "x86_64" to identify 32-bit libs
                            let is_32bit = key.contains("x86") && !key.contains("x86_64");
                            
                            if cfg!(target_pointer_width = "64") && is_32bit {
                                // Only accept as fallback
                                if native_classifier.is_none() {
                                    native_classifier = Some(key.clone());
                                }
                            } else {
                                // Prefer non-x86 (or explicit 64-bit) matches immediately
                                native_classifier = Some(key.clone());
                                break;
                            }
                        }
                    }
                }
            }
        }

        if let Some(classifier) = native_classifier {
            let classifier = classifier.replace("${arch}", Arch::current().as_str());
            let mut path = String::new();
            let mut url = None;
            let mut sha1 = None;
            let mut size = None;

            if let Some(downloads) = &lib.downloads {
                if let Some(classifiers) = &downloads.classifiers {
                    if let Some(artifact) = classifiers.get(&classifier) {
                        path = artifact.path.clone().unwrap_or_default();
                        url = artifact.url.clone();
                        sha1 = artifact.sha1.clone();
                        size = artifact.size;
                    }
                }
            }
            
            if path.is_empty() {
                path = name_to_path_with_classifier(&lib.name, &classifier);
            }

            if url.is_none() {
                if let Some(lib_url) = &lib.url {
                    let base = if lib_url.ends_with('/') { lib_url.clone() } else { format!("{}/", lib_url) };
                    url = Some(format!("{}{}", base, path));
                } else {
                    url = resolve_maven_url_with_classifier(&lib.name, &classifier, ml_type);
                }
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
            });
        }

        results
    }
}

fn should_include_library(library: &Library, os: OsType) -> bool {
    let Some(rules) = &library.rules else {
        return true;
    };

    let mut include = false;
    for rule in rules {
        if rule_matches(rule, os) {
            match rule.action {
                RuleAction::Allow => include = true,
                RuleAction::Disallow => include = false,
            }
        }
    }
    include
}

fn rule_matches(rule: &Rule, os: OsType) -> bool {
    if let Some(ref os_rule) = rule.os {
        if let Some(ref os_name) = os_rule.name {
            if os_name != os.as_str() {
                return false;
            }
        }
        
        if let Some(ref arch) = os_rule.arch {
            let host_arch = std::env::consts::ARCH;
            let normalized_arch = match arch.as_str() {
                "x64" | "amd64" => "x86_64",
                "x86" => "x86",
                "arm64" => "aarch64",
                _ => arch.as_str(),
            };

            if normalized_arch != host_arch {
                return false;
            }
        }
    }

    if let Some(ref features) = rule.features {
        for (feature_name, required_state) in features {
            match feature_name.as_str() {
                "is_demo_user" => if *required_state { return false; },
                "has_custom_resolution" => if *required_state { return false; },
                _ => {}
            }
        }
    }

    true
}

fn name_to_path_with_classifier(name: &str, classifier: &str) -> String {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return name.replace('.', "/").replace(':', "/");
    }

    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    
    format!("{}/{}/{}/{}-{}-{}.jar", group, artifact, version, artifact, version, classifier)
}

fn name_to_path(name: &str) -> String {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return name.replace('.', "/").replace(':', "/");
    }

    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    
    let classifier = if parts.len() > 3 {
        format!("-{}", parts[3])
    } else {
        "".to_string()
    };

    format!("{}/{}/{}/{}-{}{}.jar", group, artifact, version, artifact, version, classifier)
}

fn resolve_maven_url(name: &str, ml_type: Option<&str>) -> Option<String> {
    let path = name_to_path(name);
    
    match ml_type {
        Some("forge") => Some(format!("https://maven.minecraftforge.net/{}", path)),
        Some("fabric") => Some(format!("https://maven.fabricmc.net/{}", path)),
        Some("quilt") => Some(format!("https://maven.quiltmc.org/repository/release/{}", path)),
        _ => {
            // Default to libraries.minecraft.net for vanilla-looking things
            if name.starts_with("com.mojang") || name.starts_with("net.minecraft") || name.starts_with("org.lwjgl") {
                Some(format!("https://libraries.minecraft.net/{}", path))
            } else {
                None
            }
        }
    }
}

fn resolve_maven_url_with_classifier(name: &str, classifier: &str, ml_type: Option<&str>) -> Option<String> {
    let path = name_to_path_with_classifier(name, classifier);
    
    match ml_type {
        Some("forge") => Some(format!("https://maven.minecraftforge.net/{}", path)),
        Some("fabric") => Some(format!("https://maven.fabricmc.net/{}", path)),
        Some("quilt") => Some(format!("https://maven.quiltmc.org/repository/release/{}", path)),
        _ => {
            // Default to libraries.minecraft.net for vanilla-looking things
            if name.starts_with("com.mojang") || name.starts_with("net.minecraft") || name.starts_with("org.lwjgl") {
                Some(format!("https://libraries.minecraft.net/{}", path))
            } else {
                None
            }
        }
    }
}

fn classifier_key_matches_os(key: &str, os_name: &str) -> bool {
    let key = key.to_lowercase();
    let os_name = os_name.to_lowercase();

    if key.contains(&os_name) {
        return true;
    }

    // Special case for macOS/OSX
    if os_name == "osx" && key.contains("macos") {
        return true;
    }
    if os_name == "macos" && key.contains("osx") {
        return true;
    }

    false
}
