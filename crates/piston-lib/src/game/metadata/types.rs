use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Unified metadata structure containing all game versions and their available loaders
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PistonMetadata {
    /// When this metadata was last updated
    pub last_updated: DateTime<Utc>,

    /// All available game versions with their loader support
    pub game_versions: Vec<GameVersionMetadata>,

    /// Latest release and snapshot versions
    pub latest: LatestVersions,

    /// Java runtime majors available/required for managed runtime selection.
    pub required_java_major_versions: Vec<u32>,

    /// Required Java major version for each Minecraft version id (resolved lazily on-demand).
    #[serde(default)]
    pub java_major_version_by_game_version: HashMap<String, u32>,
}

/// Latest version information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatestVersions {
    pub release: String,
    pub snapshot: String,
}

/// Metadata for a single game version
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameVersionMetadata {
    /// Minecraft version ID (e.g., "1.20.1")
    pub id: String,

    /// Version type (release, snapshot, old_alpha, old_beta)
    pub version_type: String,

    /// Release timestamp
    pub release_time: DateTime<Utc>,

    /// Whether this is a stable release
    pub stable: bool,

    /// Available modloaders for this version
    pub loaders: HashMap<ModloaderType, Vec<LoaderVersionInfo>>,
}

/// Modloader type enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModloaderType {
    Vanilla,
    Fabric,
    Quilt,
    Forge,
    NeoForge,
}

impl ModloaderType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ModloaderType::Vanilla => "vanilla",
            ModloaderType::Fabric => "fabric",
            ModloaderType::Quilt => "quilt",
            ModloaderType::Forge => "forge",
            ModloaderType::NeoForge => "neoforge",
        }
    }
}

impl std::fmt::Display for ModloaderType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for ModloaderType {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "vanilla" => Ok(ModloaderType::Vanilla),
            "fabric" => Ok(ModloaderType::Fabric),
            "quilt" => Ok(ModloaderType::Quilt),
            "forge" => Ok(ModloaderType::Forge),
            "neoforge" => Ok(ModloaderType::NeoForge),
            _ => Err(anyhow::anyhow!("Unknown modloader type: {}", s)),
        }
    }
}

/// Information about a specific loader version
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoaderVersionInfo {
    /// Loader version ID
    pub version: String,

    /// Whether this loader version is stable
    pub stable: bool,

    /// URL to the full loader profile JSON (from Modrinth)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,

    /// Additional metadata (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

// ============================================================================
// Modrinth launcher-meta API response types
// ============================================================================

/// Base URL for Modrinth's launcher-meta service
pub const MODRINTH_BASE_URL: &str = "https://launcher-meta.modrinth.com";

/// Modrinth modloader manifest (Fabric, Quilt, Forge, NeoForge)
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthManifest {
    pub game_versions: Vec<ModrinthGameVersion>,
}

#[derive(Debug, Deserialize)]
pub struct ModrinthGameVersion {
    pub id: String,
    pub stable: bool,
    pub loaders: Vec<ModrinthLoaderVersion>,
}

#[derive(Debug, Deserialize)]
pub struct ModrinthLoaderVersion {
    pub id: String,
    pub url: String,
    pub stable: bool,
}

/// Placeholder string that Modrinth uses in Fabric/Quilt profiles for the
/// Minecraft version (replaced with the actual version at install time).
pub const MODRINTH_GAME_VERSION_PLACEHOLDER: &str = "${modrinth.gameVersion}";

/// Check if a game version id is the Fabric/Quilt dummy entry (${modrinth.gameVersion})
pub fn is_dummy_game_version(id: &str) -> bool {
    id.contains("modrinth.gameVersion")
}

// ============================================================================
// Modrinth loader profile (PartialVersionInfo) — used by installers
// ============================================================================

/// A loader version profile from Modrinth (Fabric, Quilt, Forge, NeoForge).
/// Matches daedalus::modded::PartialVersionInfo.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthLoaderProfile {
    pub id: String,
    pub inherits_from: String,
    pub release_time: String,
    pub time: String,
    #[serde(rename = "type")]
    pub version_type: Option<String>,
    pub main_class: Option<String>,
    pub minecraft_arguments: Option<String>,
    pub arguments: Option<serde_json::Value>,
    pub libraries: Vec<ModrinthProfileLibrary>,
    /// Forge-only: data entries for processors
    pub data: Option<HashMap<String, ModrinthSidedDataEntry>>,
    /// Forge-only: processors to run after download
    pub processors: Option<Vec<ModrinthProcessor>>,
}

/// A library entry in a Modrinth loader profile.
#[derive(Debug, Deserialize)]
pub struct ModrinthProfileLibrary {
    pub name: String,
    pub url: Option<String>,
    pub downloads: Option<ModrinthLibraryDownloads>,
    pub rules: Option<Vec<serde_json::Value>>,
    pub natives: Option<HashMap<String, String>>,
    pub extract: Option<serde_json::Value>,
    #[serde(default = "default_include_in_classpath")]
    pub include_in_classpath: bool,
}

fn default_include_in_classpath() -> bool {
    true
}

#[derive(Debug, Deserialize)]
pub struct ModrinthLibraryDownloads {
    pub artifact: Option<ModrinthArtifact>,
    pub classifiers: Option<HashMap<String, ModrinthArtifact>>,
}

#[derive(Debug, Deserialize)]
pub struct ModrinthArtifact {
    pub path: Option<String>,
    pub sha1: String,
    pub size: u64,
    pub url: String,
}

/// Forge/NeoForge sided data entry (client/server paths).
#[derive(Debug, Deserialize)]
pub struct ModrinthSidedDataEntry {
    pub client: String,
    pub server: String,
}

/// Forge/NeoForge processor (run during installation).
#[derive(Debug, Deserialize)]
pub struct ModrinthProcessor {
    pub jar: String,
    pub classpath: Vec<String>,
    pub args: Vec<String>,
    pub outputs: Option<HashMap<String, String>>,
    pub sides: Option<Vec<String>>,
}

impl ModrinthLoaderProfile {
    /// Replace `${modrinth.gameVersion}` placeholders with the actual Minecraft version.
    pub fn resolve_placeholders(&mut self, mc_version: &str) {
        self.id = self.id.replace(MODRINTH_GAME_VERSION_PLACEHOLDER, mc_version);
        self.inherits_from = self.inherits_from.replace(MODRINTH_GAME_VERSION_PLACEHOLDER, mc_version);
        for lib in &mut self.libraries {
            lib.name = lib.name.replace(MODRINTH_GAME_VERSION_PLACEHOLDER, mc_version);
        }
    }
}

// ============================================================================
// Mojang API types (still needed for vanilla version list + Java resolution)
// ============================================================================

/// Mojang version manifest response
#[derive(Debug, Deserialize)]
pub struct MojangVersionManifest {
    pub latest: MojangLatest,
    pub versions: Vec<MojangVersion>,
}

#[derive(Debug, Deserialize)]
pub struct MojangLatest {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MojangVersion {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub url: String,
    pub time: String,
    pub release_time: String,
    pub sha1: String,
    pub compliance_level: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MojangVersionDetail {
    pub java_version: Option<MojangJavaVersion>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MojangJavaVersion {
    pub major_version: u32,
    pub component: String,
}
