//! Centralized installer settings.
//! Currently static constants; later can be made user-configurable via a shared config.
//! These values are used by download helpers and installers.

// Progress reporting throttling (used in higher-level reporter)
pub const REQUEST_TIMEOUT_SECS: u64 = 120;

// TODO: Centralized installer settings will be re-added here later.
// Helper for future dynamic loading (placeholder)
#[allow(dead_code)]
pub fn current_timeout() -> std::time::Duration {
    std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS)
}
// URL Constants
pub const VANILLA_MANIFEST_URL: &str =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
pub const FABRIC_META_URL: &str = "https://meta.fabricmc.net/v2/versions/loader";
pub const FABRIC_MAVEN_URL: &str = "https://maven.fabricmc.net/";
pub const QUILT_META_URL: &str = "https://meta.quiltmc.org/v3/versions/loader";
pub const QUILT_MAVEN_URL: &str = "https://maven.quiltmc.org/repository/release/";
pub const NEOFORGE_MAVEN_URL: &str = "https://maven.neoforged.net/releases/";
pub const FORGE_MAVEN_URL: &str = "https://maven.minecraftforge.net/";
pub const ZULU_JRE_API_URL: &str = "https://api.azul.com/metadata/v1/zulu/packages";
