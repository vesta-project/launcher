use serde::{Deserialize, Serialize};

use super::resource::ResourceVersion;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResourceUpdateCheckResult {
    pub resource_id: i32,
    pub version: ResourceVersion,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstanceUpdateCheckResult {
    pub resource_updates: Vec<ResourceUpdateCheckResult>,
    pub modpack_versions: Vec<ResourceVersion>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InstanceUpdateSnapshotData {
    pub resource_updates: Vec<ResourceUpdateCheckResult>,
    pub modpack_versions: Vec<ResourceVersion>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceUpdateSnapshotResponse {
    pub checked_at: String,
    pub resource_updates: Vec<ResourceUpdateCheckResult>,
    pub modpack_versions: Vec<ResourceVersion>,
    pub is_stale: bool,
}
