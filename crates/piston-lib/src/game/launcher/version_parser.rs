use crate::game::launcher::arguments::split_preserving_quotes;
/// Version.json parser with inheritance support
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Complete version manifest from version.json
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VersionManifest {
    /// Version ID (e.g., "1.20.1" or "1.20.1-forge-47.2.0")
    pub id: String,

    /// Main class to execute
    #[serde(skip_serializing_if = "Option::is_none")]
    pub main_class: Option<String>,

    /// Parent version to inherit from
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inherits_from: Option<String>,

    /// Downloads for the client and server JARs
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloads: Option<VersionDownloads>,

    /// Game and JVM arguments
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Arguments>,

    /// Legacy arguments (pre-1.13)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minecraft_arguments: Option<String>,

    /// Libraries required for this version
    #[serde(default)]
    pub libraries: Vec<Library>,

    /// Asset index information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_index: Option<AssetIndex>,

    /// Assets version (legacy)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assets: Option<String>,

    /// Java version requirements
    #[serde(skip_serializing_if = "Option::is_none")]
    pub java_version: Option<JavaVersion>,

    /// Version type (release, snapshot, etc.)
    #[serde(skip_serializing_if = "Option::is_none", rename = "type")]
    pub version_type: Option<String>,

    /// Release time
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_time: Option<String>,

    /// Time
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<String>,
}

/// Downloads for the version (client, server, data, etc.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionDownloads {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client: Option<Artifact>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub server: Option<Artifact>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_mappings: Option<Artifact>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_mappings: Option<Artifact>,
}

/// Game and JVM arguments
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Arguments {
    #[serde(default)]
    pub game: Vec<Argument>,

    #[serde(default)]
    pub jvm: Vec<Argument>,
}

/// Argument that can be simple or conditional
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Argument {
    /// Simple string argument
    Simple(String),

    /// Conditional argument with rules
    Conditional {
        rules: Vec<Rule>,
        value: ArgumentValue,
    },
}

/// Argument value can be a single string or array
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ArgumentValue {
    Single(String),
    Multiple(Vec<String>),
}

/// Rule for conditional arguments/libraries
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Rule {
    pub action: RuleAction,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub os: Option<OsRule>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub features: Option<HashMap<String, bool>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RuleAction {
    #[default]
    Allow,
    Disallow,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct OsRule {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub arch: Option<String>,
}

/// Library definition
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Library {
    /// Maven coordinates
    pub name: String,

    /// Download information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloads: Option<LibraryDownloads>,

    /// Custom Maven repository URL
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,

    /// Rules for conditional inclusion
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rules: Option<Vec<Rule>>,

    /// Native classifiers
    #[serde(skip_serializing_if = "Option::is_none")]
    pub natives: Option<HashMap<String, String>>,

    /// Extract rules for natives
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extract: Option<ExtractRules>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct LibraryDownloads {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact: Option<Artifact>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub classifiers: Option<HashMap<String, Artifact>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Artifact {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha1: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

impl Artifact {
    /// Get the artifact path, either from the field or derived from Maven coordinates
    pub fn get_path(&self, maven_name: &str) -> Result<String> {
        if let Some(ref path) = self.path {
            Ok(path.clone())
        } else {
            // Derive path from Maven coordinates
            maven_coords_to_path(maven_name)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct ExtractRules {
    #[serde(default)]
    pub exclude: Vec<String>,
}

/// Asset index information
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssetIndex {
    pub id: String,
    pub sha1: String,
    pub size: u64,
    pub total_size: u64,
    pub url: String,
}

/// Java version requirements
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JavaVersion {
    pub component: String,
    pub major_version: u32,
}

/// Parse a version.json file
pub async fn parse_version_json(path: &Path) -> Result<VersionManifest> {
    let content = tokio::fs::read_to_string(path)
        .await
        .context(format!("Failed to read version.json at {:?}", path))?;

    let manifest: VersionManifest = serde_json::from_str(&content)
        .context(format!("Failed to parse version.json at {:?}", path))?;

    Ok(manifest)
}

/// Convert Maven coordinates to relative path string
/// Format: group:artifact:version[:classifier][@extension]
/// Example: "com.google.guava:guava:21.0" -> "com/google/guava/guava/21.0/guava-21.0.jar"
fn maven_coords_to_path(coords: &str) -> Result<String> {
    let parts: Vec<&str> = coords.split(':').collect();

    if parts.len() < 3 {
        anyhow::bail!("Invalid Maven coordinates: {}", coords);
    }

    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let mut version = parts[2];
    let mut extension = "jar";
    let mut classifier = None;

    // Handle version@extension if no classifier is present
    if parts.len() == 3 {
        if let Some((v, ext)) = version.split_once('@') {
            version = v;
            extension = ext;
        }
    } else if parts.len() >= 4 {
        // Check if there's an @extension in the classifier part
        if let Some((clf, ext)) = parts[3].split_once('@') {
            classifier = Some(clf);
            extension = ext;
        } else {
            classifier = Some(parts[3]);
        }
    }

    let filename = if let Some(clf) = classifier {
        format!("{}-{}-{}.{}", artifact, version, clf, extension)
    } else {
        format!("{}-{}.{}", artifact, version, extension)
    };

    Ok(format!("{}/{}/{}/{}", group, artifact, version, filename))
}

/// Resolve the complete version chain by following inheritsFrom
pub async fn resolve_version_chain(version_id: &str, data_dir: &Path) -> Result<VersionManifest> {
    let versions_dir = data_dir.join("versions");
    let version_path = versions_dir
        .join(version_id)
        .join(format!("{}.json", version_id));

    log::debug!(
        "Checking version path for {} -> {:?}",
        version_id,
        version_path
    );
    if !version_path.exists() {
        // Try to add more diagnostics to help understand why a manifest check might fail
        let parent = version_path.parent();
        if let Some(p) = parent {
            match std::fs::read_dir(p) {
                Ok(rd) => {
                    let mut listing: Vec<String> = vec![];
                    for entry in rd.flatten() {
                        if let Ok(fname) = entry.file_name().into_string() {
                            listing.push(fname);
                        }
                    }
                    log::debug!("Parent directory {:?} contents: {:?}", p, listing);
                }
                Err(e) => {
                    log::debug!("Failed to read parent dir {:?}: {}", p, e);
                }
            }
        }

        anyhow::bail!("Version manifest not found: {:?}", version_path);
    }

    let mut manifest = parse_version_json(&version_path).await?;

    // If this version inherits from another, merge them
    if let Some(parent_id) = manifest.inherits_from.clone() {
        let parent = Box::pin(resolve_version_chain(&parent_id, data_dir)).await?;
        manifest = merge_manifests(parent, manifest)?;
        
        // Validate the merged result
        let validation_warnings = validate_manifest(&manifest)?;
        for warning in validation_warnings {
            log::warn!("Manifest validation for {}: {}", manifest.id, warning);
        }
    }

    Ok(manifest)
}

/// Merge a child manifest with its parent
pub(crate) fn merge_manifests(
    mut parent: VersionManifest,
    child: VersionManifest,
) -> Result<VersionManifest> {
    // Allow modification of child during merging
    let mut child = child;

    // Convert parent legacy minecraftArguments into arguments.game if present
    if let Some(ref legacy) = parent.minecraft_arguments {
        let tokens = split_preserving_quotes(legacy);
        let converted: Vec<Argument> = tokens.into_iter().map(Argument::Simple).collect();
        if !converted.is_empty() {
            if let Some(ref mut parent_args) = parent.arguments {
                // Prepend so legacy tokens come before parent's declared args
                let mut new_game = converted;
                new_game.append(&mut parent_args.game);
                parent_args.game = new_game;
            } else {
                parent.arguments = Some(Arguments {
                    game: converted,
                    jvm: vec![],
                });
            }
            parent.minecraft_arguments = None;
        }
    }

    // Convert child legacy minecraftArguments into arguments.game if present
    if let Some(ref legacy) = child.minecraft_arguments {
        let tokens = split_preserving_quotes(legacy);
        let converted: Vec<Argument> = tokens.into_iter().map(Argument::Simple).collect();
        if !converted.is_empty() {
            if let Some(ref mut child_args) = child.arguments {
                // Append child legacy tokens to child's declared args
                child_args.game.extend(converted);
            } else {
                child.arguments = Some(Arguments {
                    game: converted,
                    jvm: vec![],
                });
            }
            child.minecraft_arguments = None;
        }
    }
    // Child's ID takes precedence
    parent.id = child.id;

    // CRITICAL FIX: Child main class should only override if it's NOT a modloader
    // Most modloaders (Forge/Fabric) should inherit the vanilla main class
    if let Some(ref child_main_class) = child.main_class {
        // Only override if it's not a LaunchWrapper (which most modloaders use)
        // or if the parent doesn't have a main class
        if child_main_class != "net.minecraft.launchwrapper.Launch" || parent.main_class.is_none() {
            parent.main_class = child.main_class;
        }
        // If child uses LaunchWrapper but parent has a different main class,
        // this likely means we should preserve the parent's main class for compatibility
    } else if parent.main_class.is_none() {
        // Provide sensible default if neither has main class
        parent.main_class = Some("net.minecraft.client.Minecraft".to_string());
    }

    // CRITICAL FIX: Merge arguments properly - modloader args should come FIRST
    if let Some(child_args) = child.arguments {
        if let Some(ref mut parent_args) = parent.arguments {
            // PREPEND child arguments before parent (modloader tweaks come first)
            let mut new_game_args = child_args.game;
            new_game_args.extend(parent_args.game.clone());
            parent_args.game = new_game_args;
            
            // For JVM args, child args typically come first (modloader JVM flags)
            let mut new_jvm_args = child_args.jvm;
            new_jvm_args.extend(parent_args.jvm.clone());
            parent_args.jvm = new_jvm_args;
        } else {
            parent.arguments = Some(child_args);
        }
    }

    // Handle legacy minecraft_arguments
    if child.minecraft_arguments.is_some() {
        parent.minecraft_arguments = child.minecraft_arguments;
    }

    // Merge libraries (child libraries come after parent)
    parent.libraries.extend(child.libraries);

    // Child's asset index overrides parent's
    if child.asset_index.is_some() {
        parent.asset_index = child.asset_index;
    }

    // Child's assets override parent's
    if child.assets.is_some() {
        parent.assets = child.assets;
    }

    // Child's java version overrides parent's
    if child.java_version.is_some() {
        parent.java_version = child.java_version;
    }

    // Child's type overrides parent's
    if child.version_type.is_some() {
        parent.version_type = child.version_type;
    }

    // Clear inheritsFrom since we've resolved it
    parent.inherits_from = None;

    Ok(parent)
}

/// Validate a merged manifest to ensure it can be launched successfully
pub fn validate_manifest(manifest: &VersionManifest) -> Result<Vec<String>> {
    let mut warnings = Vec::new();

    // Check for main class
    if manifest.main_class.is_none() {
        warnings.push("No main class specified - will use default".to_string());
    }

    // Validate main class makes sense
    if let Some(ref main_class) = manifest.main_class {
        if main_class == "net.minecraft.launchwrapper.Launch" {
            // Check if we have appropriate tweaker arguments
            let has_tweakers = manifest.arguments
                .as_ref()
                .map(|args| args.game.iter().any(|arg| {
                    match arg {
                        Argument::Simple(s) => s.contains("tweakClass"),
                        Argument::Conditional { .. } => false, // More complex check would be needed
                    }
                }))
                .unwrap_or(false) || 
                manifest.minecraft_arguments
                    .as_ref()
                    .map(|args| args.contains("tweakClass"))
                    .unwrap_or(false);

            if !has_tweakers && manifest.id != "1.0" {
                warnings.push(format!(
                    "LaunchWrapper main class specified but no tweaker classes found for version {}", 
                    manifest.id
                ));
            }
        }
    }

    // Check for assets/asset_index
    if manifest.asset_index.is_none() && manifest.assets.is_none() {
        warnings.push("No asset information specified".to_string());
    }

    // Check library count
    if manifest.libraries.is_empty() {
        warnings.push("No libraries specified - this may cause runtime failures".to_string());
    }

    // Validate arguments structure
    if let Some(ref args) = manifest.arguments {
        if args.game.is_empty() && manifest.minecraft_arguments.is_none() {
            warnings.push("No game arguments specified".to_string());
        }
    } else if manifest.minecraft_arguments.is_none() {
        warnings.push("No game arguments specified (neither modern nor legacy format)".to_string());
    }

    Ok(warnings)
}

/// Determines if a version is a "legacy" version that predates LaunchWrapper.
/// 
/// LaunchWrapper (net.minecraft.launchwrapper.Launch) was introduced in Minecraft 1.6
/// (released July 1, 2013). Versions before this used direct main() invocation or
/// Applet-based launching.
/// 
/// Mojang has retroactively modified old version manifests to use LaunchWrapper,
/// but this doesn't actually work properly for these old versions. We need to
/// detect them and use the correct direct launch method instead.
/// 
/// Detection criteria:
/// 1. Asset index ID is "pre-1.6" or "legacy" 
/// 2. Release date is before July 2013
/// 3. Version ID pattern matches known legacy versions
pub fn is_legacy_version(manifest: &VersionManifest) -> bool {
    // Check asset index - "pre-1.6" or "legacy" indicates old version
    if let Some(ref asset_index) = manifest.asset_index {
        if asset_index.id == "pre-1.6" || asset_index.id == "legacy" {
            log::debug!(
                "Version {} detected as legacy: asset_index.id = {}",
                manifest.id,
                asset_index.id
            );
            return true;
        }
    }
    
    // Check assets field (older manifests use this)
    if let Some(ref assets) = manifest.assets {
        if assets == "pre-1.6" || assets == "legacy" {
            log::debug!(
                "Version {} detected as legacy: assets = {}",
                manifest.id,
                assets
            );
            return true;
        }
    }
    
    // Check release time - LaunchWrapper was introduced July 1, 2013
    // Anything before that date is legacy
    if let Some(ref release_time) = manifest.release_time {
        // Parse ISO 8601 date format: 2012-03-01T00:00:00+00:00
        if let Ok(date) = chrono::DateTime::parse_from_rfc3339(release_time) {
            // LaunchWrapper was introduced with 1.6 on July 1, 2013
            let launchwrapper_date = chrono::DateTime::parse_from_rfc3339("2013-07-01T00:00:00+00:00")
                .expect("Invalid hardcoded date");
            
            if date < launchwrapper_date {
                log::debug!(
                    "Version {} detected as legacy: release_time {} < 2013-07-01",
                    manifest.id,
                    release_time
                );
                return true;
            }
        }
    }
    
    // Additional check: if main_class is LaunchWrapper but minecraft_arguments
    // doesn't contain --tweakClass, it's likely a retrofitted legacy version
    // that can't actually work with LaunchWrapper
    if let Some(ref main_class) = manifest.main_class {
        if main_class == "net.minecraft.launchwrapper.Launch" {
            if let Some(ref args) = manifest.minecraft_arguments {
                if !args.contains("--tweakClass") {
                    log::debug!(
                        "Version {} detected as legacy: uses LaunchWrapper but no --tweakClass",
                        manifest.id
                    );
                    return true;
                }
            }
        }
    }
    
    false
}

/// Get the main class from a manifest, with special handling for legacy versions.
/// 
/// For versions that predate LaunchWrapper (pre-1.6), Mojang's manifests have been
/// retroactively modified to use `net.minecraft.launchwrapper.Launch`, but this
/// doesn't work. We override these to use the original direct main class.
pub fn get_main_class(manifest: &VersionManifest) -> Result<String> {
    // Check if this is a legacy version that shouldn't use LaunchWrapper
    if is_legacy_version(manifest) {
        if let Some(ref main_class) = manifest.main_class {
            if main_class == "net.minecraft.launchwrapper.Launch" {
                log::info!(
                    "Legacy version {} has LaunchWrapper as main class - overriding to net.minecraft.client.Minecraft",
                    manifest.id
                );
                return Ok("net.minecraft.client.Minecraft".to_string());
            }
        }
    }
    
    if let Some(ref main_class) = manifest.main_class {
        Ok(main_class.clone())
    } else {
        // Default main class for versions that don't specify one
        // Most legacy versions use this directly
        Ok("net.minecraft.client.Minecraft".to_string())
    }
}

/// Get the asset index from a manifest
pub fn get_asset_index(manifest: &VersionManifest) -> Result<AssetIndex> {
    manifest
        .asset_index
        .clone()
        .ok_or_else(|| anyhow::anyhow!("No asset index specified in version manifest"))
}

/// Get the assets ID (for legacy versions)
pub fn get_assets_id(manifest: &VersionManifest) -> Result<String> {
    if let Some(ref assets) = manifest.assets {
        Ok(assets.clone())
    } else if let Some(ref asset_index) = manifest.asset_index {
        Ok(asset_index.id.clone())
    } else {
        anyhow::bail!("No assets information in version manifest")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_argument() {
        let json = r#""--username""#;
        let arg: Argument = serde_json::from_str(json).unwrap();
        match arg {
            Argument::Simple(s) => assert_eq!(s, "--username"),
            _ => panic!("Expected simple argument"),
        }
    }

    #[test]
    fn test_merge_manifests_basic() {
        let parent = VersionManifest {
            id: "1.20.1".to_string(),
            main_class: Some("net.minecraft.client.main.Main".to_string()),
            inherits_from: None,
            arguments: Some(Arguments {
                game: vec![Argument::Simple("--version".to_string())],
                jvm: vec![],
            }),
            minecraft_arguments: None,
            libraries: vec![],
            asset_index: None,
            assets: None,
            java_version: None,
            version_type: Some("release".to_string()),
            release_time: None,
            time: None,
            downloads: None,
        };

        let child = VersionManifest {
            id: "1.20.1-forge-47.2.0".to_string(),
            main_class: Some("cpw.mods.bootstraplauncher.BootstrapLauncher".to_string()),
            inherits_from: Some("1.20.1".to_string()),
            arguments: Some(Arguments {
                game: vec![Argument::Simple("--fml.forgeVersion".to_string())],
                jvm: vec![],
            }),
            minecraft_arguments: None,
            libraries: vec![],
            asset_index: None,
            assets: None,
            java_version: None,
            version_type: None,
            release_time: None,
            time: None,
            downloads: None,
        };

        let merged = merge_manifests(parent, child).unwrap();

        assert_eq!(merged.id, "1.20.1-forge-47.2.0");
        assert_eq!(
            merged.main_class.unwrap(),
            "cpw.mods.bootstraplauncher.BootstrapLauncher"
        );
        assert!(merged.inherits_from.is_none());
        assert_eq!(merged.arguments.unwrap().game.len(), 2);
    }

    #[test]
    fn test_merge_manifests_preserve_minecraft_args() {
        let parent = VersionManifest {
            id: "1.12.2".to_string(),
            main_class: Some("net.minecraft.launchwrapper.Launch".to_string()),
            inherits_from: None,
            arguments: None,
            minecraft_arguments: Some("--username ${auth_player_name} --tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker --versionType Forge".to_string()),
            libraries: vec![],
            asset_index: None,
            assets: None,
            java_version: None,
            version_type: Some("release".to_string()),
            release_time: None,
            time: None,
            downloads: None,
        };

        let child = VersionManifest {
            id: "forge-loader-test".to_string(),
            main_class: Some("net.minecraft.launchwrapper.Launch".to_string()),
            inherits_from: Some("1.12.2".to_string()),
            arguments: Some(Arguments {
                game: vec![Argument::Simple("--fml.forgeVersion".to_string())],
                jvm: vec![],
            }),
            minecraft_arguments: None,
            libraries: vec![],
            asset_index: None,
            assets: None,
            java_version: None,
            version_type: None,
            release_time: None,
            time: None,
            downloads: None,
        };

        let merged = merge_manifests(parent, child).unwrap();
        assert_eq!(merged.id, "forge-loader-test");
        assert!(merged.inherits_from.is_none());
        // merged should contain tokens from parent legacy and child's modern argument
        let game_args = merged.arguments.unwrap().game;
        let strings: Vec<String> = game_args
            .iter()
            .map(|a| match a {
                Argument::Simple(s) => s.clone(),
                _ => String::new(),
            })
            .collect();
        assert!(
            strings.iter().any(|s| s.contains("--tweakClass")),
            "Merged args must contain --tweakClass"
        );
        assert!(
            strings.iter().any(|s| s.contains("--fml.forgeVersion")),
            "Merged args must contain --fml.forgeVersion"
        );
    }
}
