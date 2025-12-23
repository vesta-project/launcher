use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionStruct {
    pub version: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoaderVersionStruct {
    pub separator: String,
    pub build: i64,
    pub maven: String,
    pub version: String,
    pub stable: Option<bool>,
}
