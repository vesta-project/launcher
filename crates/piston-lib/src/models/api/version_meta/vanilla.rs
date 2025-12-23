// This metadata supports v2 of mojang's version manifest as of May 2024
// Located at https://launchermeta.mojang.com/mc/game/version_manifest_v2.json

use crate::models::common::GameReleaseType;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct McVersionManifest {
    pub latest: Latest,

    pub versions: Vec<Version>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Latest {
    pub release: String,

    pub snapshot: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Version {
    pub id: String,

    #[serde(rename = "type")]
    pub release_type: GameReleaseType,

    pub url: String,

    pub time: String,

    #[serde(rename = "releaseTime")]
    pub release_time: String,

    pub sha1: String,

    #[serde(rename = "complianceLevel")]
    pub compliance_level: i64,
}
