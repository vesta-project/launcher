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

    /// Additional metadata (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

// ============================================================================
// External API Response Types (for fetching from various sources)
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

/// Fabric loader version response
#[derive(Debug, Deserialize)]
pub struct FabricLoaderVersion {
    pub version: String,
    pub stable: bool,
}

/// Quilt loader version response (same structure as Fabric)
pub type QuiltLoaderVersion = FabricLoaderVersion;

/// Forge version metadata response
#[derive(Debug, Deserialize)]
pub struct ForgeVersionMetadata {
    pub versions: HashMap<String, Vec<String>>,
}

/// NeoForge version response
#[derive(Debug, Deserialize)]
pub struct NeoForgeVersionResponse {
    pub versions: Vec<String>,
}
