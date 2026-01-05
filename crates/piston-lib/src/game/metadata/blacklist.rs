use crate::game::metadata::types::ModloaderType;
use once_cell::sync::Lazy;
use std::collections::HashSet;

/// A structure representing a blacklisted modloader version
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct BlacklistedVersion {
    pub loader: ModloaderType,
    pub minecraft_version: String,
    pub loader_version: String,
}

/// The global blacklist of broken modloader versions
pub static MODLOADER_BLACKLIST: Lazy<HashSet<BlacklistedVersion>> = Lazy::new(|| {
    let mut m = HashSet::new();
    
    // Forge 1.20.1-47.0.1 is known to have issues
    m.insert(BlacklistedVersion {
        loader: ModloaderType::Forge,
        minecraft_version: "1.20.1".to_string(),
        loader_version: "47.0.1".to_string(),
    });

    // Forge 1.19.2-43.2.0 (known issues with some mods)
    m.insert(BlacklistedVersion {
        loader: ModloaderType::Forge,
        minecraft_version: "1.19.2".to_string(),
        loader_version: "43.2.0".to_string(),
    });

    // NeoForge 20.1.0 (early versions were unstable)
    m.insert(BlacklistedVersion {
        loader: ModloaderType::NeoForge,
        minecraft_version: "1.20.1".to_string(),
        loader_version: "20.1.0".to_string(),
    });

    // Fabric 0.14.22 (had some issues with certain Java versions)
    m.insert(BlacklistedVersion {
        loader: ModloaderType::Fabric,
        minecraft_version: "1.20.1".to_string(),
        loader_version: "0.14.22".to_string(),
    });

    // Add more known broken versions here
    
    m
});

/// Check if a modloader version is blacklisted
pub fn is_blacklisted(loader: ModloaderType, mc_version: &str, loader_version: &str) -> bool {
    MODLOADER_BLACKLIST.contains(&BlacklistedVersion {
        loader,
        minecraft_version: mc_version.to_string(),
        loader_version: loader_version.to_string(),
    })
}
