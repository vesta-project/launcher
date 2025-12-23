use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Serialize, Deserialize, PartialEq, Eq, Hash, Clone, Debug)]
pub enum ModloaderType {
    None,
    Fabric,
    Quilt,
    Forge,
    NeoForge,
}

impl fmt::Display for ModloaderType {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            ModloaderType::None => write!(f, "none"),
            ModloaderType::Fabric => write!(f, "fabric"),
            ModloaderType::Quilt => write!(f, "quilt"),
            ModloaderType::Forge => write!(f, "forge"),
            ModloaderType::NeoForge => write!(f, "neoforge"),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub enum GameReleaseType {
    #[serde(rename = "old_alpha")]
    OldAlpha,

    #[serde(rename = "old_beta")]
    OldBeta,

    #[serde(rename = "release")]
    Release,

    #[serde(rename = "snapshot")]
    Snapshot,
}

impl fmt::Display for GameReleaseType {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            GameReleaseType::OldAlpha => write!(f, "old_alpha"),
            GameReleaseType::OldBeta => write!(f, "old_beta"),
            GameReleaseType::Release => write!(f, "release"),
            GameReleaseType::Snapshot => write!(f, "snapshot"),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FileInfo {
    pub url: String,
    pub sha1: String,
}
