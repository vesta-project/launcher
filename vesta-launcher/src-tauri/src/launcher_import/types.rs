use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum LauncherKind {
    #[serde(rename = "curseforgeFlame")]
    CurseforgeFlame,
    #[serde(rename = "gdlauncher")]
    GDLauncher,
    #[serde(rename = "prism")]
    Prism,
    #[serde(rename = "multimc")]
    MultiMC,
    #[serde(rename = "atlauncher")]
    ATLauncher,
    #[serde(rename = "ftb")]
    Ftb,
    #[serde(rename = "modrinthApp")]
    ModrinthApp,
    #[serde(rename = "technic")]
    Technic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedLauncher {
    pub kind: LauncherKind,
    pub display_name: String,
    pub detected_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExternalInstanceCandidate {
    pub id: String,
    pub name: String,
    pub instance_path: String,
    pub game_directory: String,
    pub icon_path: Option<String>,
    pub minecraft_version: Option<String>,
    pub modloader: Option<String>,
    pub modloader_version: Option<String>,
    pub modpack_platform: Option<String>,
    pub modpack_id: Option<String>,
    pub modpack_version_id: Option<String>,
    pub last_played_at_unix_ms: Option<i64>,
    pub mods_count: Option<u32>,
    pub resourcepacks_count: Option<u32>,
    pub shaderpacks_count: Option<u32>,
    pub worlds_count: Option<u32>,
    pub screenshots_count: Option<u32>,
    pub game_directory_size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportExternalInstanceRequest {
    pub launcher: LauncherKind,
    pub instance_path: String,
    pub selected_instance: Option<ExternalInstanceCandidate>,
    pub base_path_override: Option<String>,
    pub instance_name_override: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportExternalInstanceResponse {
    pub instance_id: i32,
}

