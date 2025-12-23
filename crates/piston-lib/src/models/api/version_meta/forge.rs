use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize)]
pub struct PromotionsSlim {
    pub promos: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct VersionManifest {
    pub versioning: Versioning,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Versioning {
    pub versions: Versions,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Versions {
    pub version: Vec<String>,
}
