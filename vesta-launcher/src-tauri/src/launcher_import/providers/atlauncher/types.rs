use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct ATResourceHint {
    pub project_id: String,
    pub version_id: String,
    pub platform: String,
    pub file_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ATInstance {
    pub id: String,
    pub launcher: ATLauncherData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ATLauncherData {
    pub name: String,
    #[serde(default)]
    pub loader_version: Option<ATLoaderVersion>,
    #[serde(default)]
    pub modrinth_project: Option<ATModrinthProject>,
    #[serde(default)]
    pub modrinth_version: Option<ATModrinthVersion>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ATLoaderVersion {
    pub r#type: String,
    pub version: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct ATModrinthProject {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct ATModrinthVersion {
    pub id: String,
}
