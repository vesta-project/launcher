use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MinecraftInstance {
    pub name: Option<String>,
    pub game_version: String,
    pub base_mod_loader: Option<BaseModLoader>,
    #[serde(default)]
    #[serde(alias = "projectId")]
    #[serde(alias = "projectID")]
    pub project_id: Option<Value>,
    #[serde(default)]
    #[serde(alias = "fileId")]
    #[serde(alias = "fileID")]
    pub file_id: Option<Value>,
    #[serde(default)]
    pub installed_modpack: Option<InstalledModpack>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BaseModLoader {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MinecraftGameInstance {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub install_location: Option<String>,
    #[serde(default)]
    pub install_path: Option<String>,
    #[serde(default)]
    pub game_directory: Option<String>,
    #[serde(default)]
    pub game_version: Option<String>,
    #[serde(default)]
    pub base_mod_loader: Option<BaseModLoader>,
    #[serde(default)]
    pub mod_loader: Option<BaseModLoader>,
    #[serde(default)]
    pub installed_modpack: Option<InstalledModpack>,
    #[serde(default)]
    #[serde(alias = "projectId")]
    #[serde(alias = "projectID")]
    pub project_id: Option<Value>,
    #[serde(default)]
    #[serde(alias = "fileId")]
    #[serde(alias = "fileID")]
    pub file_id: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct InstalledModpack {
    #[serde(default)]
    #[serde(alias = "projectId")]
    #[serde(alias = "projectID")]
    pub project_id: Option<Value>,
    #[serde(default)]
    #[serde(alias = "fileId")]
    #[serde(alias = "fileID")]
    pub file_id: Option<Value>,
    #[serde(default)]
    #[serde(alias = "addonId")]
    #[serde(alias = "addonID")]
    pub addon_id: Option<Value>,
    #[serde(default)]
    pub installed_file: Option<InstalledPackFile>,
    #[serde(default)]
    pub latest_file: Option<InstalledPackFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct InstalledPackFile {
    #[serde(default)]
    #[serde(alias = "projectID")]
    pub project_id: Option<Value>,
    #[serde(default)]
    #[serde(alias = "fileID")]
    pub file_id: Option<Value>,
    #[serde(default)]
    #[serde(alias = "id")]
    pub file_uid: Option<Value>,
}
