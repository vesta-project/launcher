//! Centralized installer settings.
//! All metadata and library downloads go through Modrinth's launcher-meta endpoint.

// Progress reporting throttling (used in higher-level reporter)
pub const REQUEST_TIMEOUT_SECS: u64 = 120;

#[allow(dead_code)]
pub fn current_timeout() -> std::time::Duration {
    std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS)
}

// ---------------------------------------------------------------------------
// Modrinth launcher-meta endpoints (single source of truth for everything)
// ---------------------------------------------------------------------------

/// Base URL for Modrinth's launcher-meta service
pub const MODRINTH_BASE_URL: &str = "https://launcher-meta.modrinth.com";

/// Minecraft version manifest (lists all versions with URLs to patched JSONs)
pub const VANILLA_MANIFEST_URL: &str =
    "https://launcher-meta.modrinth.com/minecraft/v0/manifest.json";

/// Maven artifact mirror — all library JARs are mirrored by Modrinth's daedalus
pub const MODRINTH_MAVEN_URL: &str = "https://launcher-meta.modrinth.com/maven/";

/// Quilt maven URL (same Modrinth mirror)
pub const QUILT_MAVEN_URL: &str = "https://launcher-meta.modrinth.com/maven/";

/// NeoForge maven URL (same Modrinth mirror)
pub const NEOFORGE_MAVEN_URL: &str = "https://launcher-meta.modrinth.com/maven/";

/// Java runtime metadata (still from Mojang — Modrinth doesn't mirror runtimes)
pub const ZULU_JRE_API_URL: &str = "https://api.azul.com/metadata/v1/zulu/packages";
