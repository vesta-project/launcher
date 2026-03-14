use serde::{Deserialize, Serialize};
use std::fmt;
use std::sync::Arc;
use url::Url;

/// Represents a Minecraft skin model variant.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum MinecraftSkinVariant {
    Classic,
    Slim,
}

impl Default for MinecraftSkinVariant {
    fn default() -> Self {
        Self::Classic
    }
}

impl From<&str> for MinecraftSkinVariant {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "slim" | "alex" => Self::Slim,
            _ => Self::Classic,
        }
    }
}

impl From<String> for MinecraftSkinVariant {
    fn from(s: String) -> Self {
        Self::from(s.as_str())
    }
}

impl fmt::Display for MinecraftSkinVariant {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Self::Classic => write!(f, "classic"),
            Self::Slim => write!(f, "slim"),
        }
    }
}

/// Where the skin originates from.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SkinSource {
    /// A default skin provided by Mojang.
    Default {
        category: Option<Arc<str>>,
        /// For some default skins, we have both slim and classic textures.
        slim_texture: Option<Arc<str>>,
        classic_texture: Option<Arc<str>>,
    },
    /// A skin from the user's history in the local database.
    History {
        id: i32,
        /// For history skins, we store the texture and variant inside the source to avoid redundancy.
        texture: Arc<str>,
        variant: MinecraftSkinVariant,
    },
    /// A skin uploaded from a local file.
    Local {
        path: Arc<str>,
        variant: MinecraftSkinVariant,
    },
    /// An active skin from a Minecraft profile.
    Profile {
        url: Arc<str>,
        variant: MinecraftSkinVariant,
    },
}

/// A unified representation of a Minecraft skin used throughout the application.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Skin {
    /// The unique identifier or texture hash for the skin.
    pub texture_key: Arc<str>,
    /// An optional display name for the skin.
    pub name: Option<Arc<str>>,
    /// Meta information about where this skin came from.
    pub source: SkinSource,
}

impl Skin {
    /// Get the texture URL or data URI for a given variant, falling back to any available texture.
    pub fn get_texture(&self, preferred_variant: MinecraftSkinVariant) -> Arc<str> {
        match &self.source {
            SkinSource::Default {
                slim_texture,
                classic_texture,
                ..
            } => match preferred_variant {
                MinecraftSkinVariant::Slim => slim_texture
                    .as_ref()
                    .or(classic_texture.as_ref())
                    .cloned()
                    .unwrap_or_else(|| Arc::from("")),
                MinecraftSkinVariant::Classic => classic_texture
                    .as_ref()
                    .or(slim_texture.as_ref())
                    .cloned()
                    .unwrap_or_else(|| Arc::from("")),
            },
            SkinSource::History { texture, .. } => texture.clone(),
            SkinSource::Local { path, .. } => path.clone(),
            SkinSource::Profile { url, .. } => url.clone(),
        }
    }

    /// Get the variant of the skin.
    pub fn get_variant(&self, preferred_variant: MinecraftSkinVariant) -> MinecraftSkinVariant {
        match &self.source {
            SkinSource::Default {
                slim_texture,
                classic_texture,
                ..
            } => match preferred_variant {
                MinecraftSkinVariant::Slim if slim_texture.is_some() => MinecraftSkinVariant::Slim,
                MinecraftSkinVariant::Classic if classic_texture.is_some() => {
                    MinecraftSkinVariant::Classic
                }
                _ => {
                    if classic_texture.is_some() {
                        MinecraftSkinVariant::Classic
                    } else {
                        MinecraftSkinVariant::Slim
                    }
                }
            },
            SkinSource::History { variant, .. } => *variant,
            SkinSource::Local { variant, .. } => *variant,
            SkinSource::Profile { variant, .. } => *variant,
        }
    }
}

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
