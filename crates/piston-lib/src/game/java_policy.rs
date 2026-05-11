use anyhow::{Context, Result};
use std::collections::HashMap;

pub const LEGACY_JAVA_MAJOR: u32 = 8;

/// Normalize declared Java requirements to launcher policy.
/// Current policy: treat Java 16 requirements as Java 17.
pub fn preferred_java_major(major: u32) -> u32 {
    if major == 16 {
        17
    } else {
        major
    }
}

/// Fetch available Java runtime majors from Mojang's runtime manifest.
/// Single HTTP request returns all Java runtimes that exist on any platform.
pub async fn fetch_available_runtimes(client: &reqwest::Client) -> Result<Vec<u32>> {
    #[derive(serde::Deserialize)]
    struct Entry {
        version: VersionInfo,
    }
    #[derive(serde::Deserialize)]
    struct VersionInfo {
        name: String,
    }

    let url = "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";
    let data: HashMap<String, HashMap<String, Vec<Entry>>> =
        client.get(url).send().await?.json().await?;

    let mut majors: std::collections::BTreeSet<u32> = std::collections::BTreeSet::new();
    for (_platform, components) in data {
        for (component, entries) in components {
            if !component.starts_with("java-runtime-") && component != "jre-legacy" {
                continue;
            }
            for entry in entries {
                if let Some(major) = parse_java_major(&entry.version.name) {
                    majors.insert(preferred_java_major(major));
                }
            }
        }
    }

    if majors.is_empty() {
        anyhow::bail!("No Java runtimes found in Mojang manifest");
    }
    Ok(majors.into_iter().rev().collect())
}

/// Parse a Java version string like "1.8.0_402" or "17.0.14" to its major number.
pub fn parse_java_major(version: &str) -> Option<u32> {
    if let Some(rest) = version.strip_prefix("1.") {
        return rest
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse::<u32>()
            .ok();
    }
    version
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse::<u32>()
        .ok()
}

/// Fetch the Java major version required by a specific Minecraft version.
/// Makes one HTTP request to Mojang's version detail endpoint.
/// Returns 8 as default for legacy versions without a declared requirement.
pub async fn fetch_java_major_for_version(
    mc_version: &str,
    client: &reqwest::Client,
) -> Result<u32> {
    #[derive(serde::Deserialize)]
    struct Detail {
        java_version: Option<JavaVersionDetail>,
    }
    #[derive(serde::Deserialize)]
    struct JavaVersionDetail {
        major_version: u32,
    }

    // Find the version's detail URL from the Mojang version manifest
    let manifest_url = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    #[derive(serde::Deserialize)]
    struct VersionManifest {
        versions: Vec<VersionEntry>,
    }
    #[derive(serde::Deserialize)]
    struct VersionEntry {
        id: String,
        url: String,
    }

    let manifest: VersionManifest = client.get(manifest_url).send().await?.json().await?;
    let version = manifest
        .versions
        .iter()
        .find(|v| v.id == mc_version)
        .with_context(|| format!("Minecraft version '{mc_version}' not found"))?;

    let detail: Detail = client.get(&version.url).send().await?.json().await?;
    let major = detail.java_version.map(|j| j.major_version).unwrap_or(8);
    Ok(preferred_java_major(major))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_java_16_to_17() {
        assert_eq!(preferred_java_major(16), 17);
    }

    #[test]
    fn preserves_other_versions() {
        assert_eq!(preferred_java_major(8), 8);
        assert_eq!(preferred_java_major(17), 17);
        assert_eq!(preferred_java_major(21), 21);
        assert_eq!(preferred_java_major(25), 25);
    }

    #[test]
    fn parses_java_8_format() {
        assert_eq!(parse_java_major("1.8.0_402"), Some(8));
        assert_eq!(parse_java_major("1.8.0_402-b08"), Some(8));
    }

    #[test]
    fn parses_modern_java_format() {
        assert_eq!(parse_java_major("17.0.14"), Some(17));
        assert_eq!(parse_java_major("21.0.5"), Some(21));
        assert_eq!(parse_java_major("25"), Some(25));
    }

    #[test]
    fn parse_returns_none_for_garbage() {
        assert_eq!(parse_java_major(""), None);
        assert_eq!(parse_java_major("abc"), None);
    }
}
