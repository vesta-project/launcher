use anyhow::{Context, Result};
use chrono::Datelike;
use std::collections::HashMap;

pub const LEGACY_JAVA_MAJOR: u32 = 8;
pub const JAVA_METADATA_REQUIRED_YEAR: i32 = 2014;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JavaRequirement {
    pub major_version: u32,
    pub component: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionDetail {
    id: Option<String>,
    #[serde(rename = "type")]
    version_type: Option<String>,
    release_time: Option<String>,
    java_version: Option<JavaVersionDetail>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct JavaVersionDetail {
    major_version: u32,
    component: Option<String>,
}

/// Normalize declared Java requirements to launcher policy.
/// Current policy: treat Java 16 requirements as Java 17.
pub fn preferred_java_major(major: u32) -> u32 {
    if major == 16 {
        17
    } else {
        major
    }
}

pub fn is_legacy_minecraft_version(version_type: &str, release_time: &str) -> bool {
    if matches!(version_type, "old_alpha" | "old_beta") {
        return true;
    }

    chrono::DateTime::parse_from_rfc3339(release_time)
        .map(|dt| dt.year() < JAVA_METADATA_REQUIRED_YEAR)
        .unwrap_or(false)
}

pub fn java_requirement_from_version_detail_value(
    requested_version_id: &str,
    detail: serde_json::Value,
) -> Result<JavaRequirement> {
    let detail: VersionDetail = serde_json::from_value(detail)
        .context("Failed to parse Minecraft version detail while resolving Java requirement")?;
    let version_id = detail.id.as_deref().unwrap_or(requested_version_id);
    let version_type = detail.version_type.as_deref().unwrap_or("unknown");
    let release_time = detail.release_time.as_deref().unwrap_or("unknown");

    if let Some(java) = detail.java_version {
        return Ok(JavaRequirement {
            major_version: preferred_java_major(java.major_version),
            component: java.component,
        });
    }

    if is_legacy_minecraft_version(version_type, release_time) {
        log::warn!(
            "Missing javaVersion for legacy/pre-metadata Minecraft version '{}' (type '{}', release '{}'), defaulting to Java {}",
            version_id,
            version_type,
            release_time,
            LEGACY_JAVA_MAJOR
        );
        return Ok(JavaRequirement {
            major_version: LEGACY_JAVA_MAJOR,
            component: None,
        });
    }

    anyhow::bail!(
        "Missing javaVersion.majorVersion for non-legacy Minecraft version '{}' (type '{}', release '{}')",
        version_id,
        version_type,
        release_time
    )
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

/// Fetch the Java requirement for a specific Minecraft version.
/// Uses the Modrinth launcher-meta version detail JSON, same data source as
/// the install pipeline.
pub async fn fetch_java_requirement_for_version(
    mc_version: &str,
    client: &reqwest::Client,
) -> Result<JavaRequirement> {
    let url = format!(
        "https://launcher-meta.modrinth.com/minecraft/v0/versions/{}.json",
        mc_version
    );
    let detail: serde_json::Value = client
        .get(&url)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    java_requirement_from_version_detail_value(mc_version, detail)
}

/// Fetch the Java major version required by a specific Minecraft version.
pub async fn fetch_java_major_for_version(
    mc_version: &str,
    client: &reqwest::Client,
) -> Result<u32> {
    Ok(fetch_java_requirement_for_version(mc_version, client)
        .await?
        .major_version)
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

    #[test]
    fn parses_java_requirement_from_version_detail() {
        let detail = serde_json::json!({
            "id": "1.21.1",
            "type": "release",
            "releaseTime": "2024-08-08T12:24:45+00:00",
            "javaVersion": {
                "component": "java-runtime-delta",
                "majorVersion": 21
            }
        });

        let requirement = java_requirement_from_version_detail_value("1.21.1", detail).unwrap();
        assert_eq!(requirement.major_version, 21);
        assert_eq!(requirement.component.as_deref(), Some("java-runtime-delta"));
    }

    #[test]
    fn legacy_missing_java_requirement_defaults_to_java_8() {
        let detail = serde_json::json!({
            "id": "1.6.4",
            "type": "release",
            "releaseTime": "2013-09-19T15:52:37+00:00"
        });

        let requirement = java_requirement_from_version_detail_value("1.6.4", detail).unwrap();
        assert_eq!(requirement.major_version, LEGACY_JAVA_MAJOR);
    }

    #[test]
    fn modern_missing_java_requirement_errors() {
        let detail = serde_json::json!({
            "id": "1.21.1",
            "type": "release",
            "releaseTime": "2024-08-08T12:24:45+00:00"
        });

        let err = java_requirement_from_version_detail_value("1.21.1", detail)
            .expect_err("modern versions must not silently default to Java 8");
        assert!(err
            .to_string()
            .contains("Missing javaVersion.majorVersion for non-legacy"));
    }
}
