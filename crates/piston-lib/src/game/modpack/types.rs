use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Modrinth modpack index (modrinth.index.json)
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthIndex {
    #[serde(default = "default_format_version")]
    pub format_version: u32,
    #[serde(default = "default_game")]
    pub game: String,
    pub version_id: String,
    pub name: String,
    pub summary: Option<String>,
    pub files: Vec<ModrinthFile>,
    #[serde(default)]
    pub dependencies: HashMap<String, String>,
}

fn default_format_version() -> u32 { 1 }
fn default_game() -> String { "minecraft".to_string() }

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthFile {
    pub path: String,
    #[serde(default)]
    pub hashes: HashMap<String, String>,
    pub env: Option<ModrinthEnv>,
    #[serde(default)]
    pub downloads: Vec<String>,
    #[serde(default)]
    pub file_size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub struct ModrinthEnv {
    #[serde(default = "default_required")]
    pub client: String, // "required", "optional", "unsupported"
    #[serde(default = "default_required")]
    pub server: String,
}

fn default_required() -> String { "required".to_string() }

/// CurseForge modpack manifest (manifest.json)
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeManifest {
    pub minecraft: CurseForgeMinecraft,
    #[serde(default = "default_modpack")]
    pub manifest_type: String,
    #[serde(default = "default_manifest_version")]
    pub manifest_version: u32,
    pub name: String,
    pub version: String,
    #[serde(default = "default_author")]
    pub author: String,
    pub files: Vec<CurseForgeFile>,
    #[serde(default = "default_overrides")]
    pub overrides: String,
}

fn default_manifest_version() -> u32 { 1 }
fn default_author() -> String { "Unknown".to_string() }
fn default_modpack() -> String { "minecraftModpack".to_string() }
fn default_overrides() -> String { "overrides".to_string() }

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeMinecraft {
    pub version: String,
    pub mod_loaders: Vec<CurseForgeModLoader>,
    pub recommended_ram: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeModLoader {
    pub id: String,
    #[serde(default)]
    pub primary: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeFile {
    #[serde(alias = "projectID")]
    pub project_id: Option<u32>,
    #[serde(alias = "fileID")]
    pub file_id: u32,
    pub required: bool,
    #[serde(default)]
    pub hashes: Option<Vec<CurseForgeHash>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeHash {
    pub value: String,
    pub algo: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ModpackMod {
    Modrinth {
        path: String,
        urls: Vec<String>,
        hashes: HashMap<String, String>,
        size: u64,
    },
    CurseForge {
        project_id: Option<u32>,
        file_id: u32,
        required: bool,
        hash: Option<String>,
    },
}

/// Unified modpack metadata for the UI
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModpackMetadata {
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub minecraft_version: String,
    pub modloader_type: String, // "vanilla", "fabric", "forge", etc.
    pub modloader_version: Option<String>,
    pub description: Option<String>,
    pub recommended_ram_mb: Option<u32>,
    pub format: ModpackFormat,
    pub mods: Vec<ModpackMod>,
    /// Optional prefix path if the modpack is nested in a folder within the ZIP
    pub root_prefix: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum ModpackFormat {
    Modrinth,
    CurseForge,
}
