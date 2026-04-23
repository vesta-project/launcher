use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowEffectCapabilities {
    pub os: String,
    pub os_version: Option<String>,
    pub supported_effects: Vec<String>,
    pub default_effect: String,
}

#[derive(Debug, Clone, Copy)]
struct WindowsVersionInfo {
    major: u32,
    build: u32,
}

pub fn get_window_effect_capabilities() -> WindowEffectCapabilities {
    #[cfg(target_os = "windows")]
    {
        let raw_version = sysinfo::System::long_os_version().or_else(sysinfo::System::os_version);
        let parsed = raw_version
            .as_deref()
            .and_then(parse_windows_version)
            .or_else(detect_windows_version_from_cmd);

        let mut effects = vec![
            "none".to_string(),
            "transparent".to_string(),
            "blur".to_string(),
        ];

        if let Some(version) = parsed {
            if version.major >= 10 {
                effects.push("acrylic".to_string());
                if version.build >= 22000 {
                    effects.push("mica".to_string());
                }
            }
        }

        let default_effect = if effects.iter().any(|e| e == "mica") {
            "mica"
        } else if effects.iter().any(|e| e == "acrylic") {
            "acrylic"
        } else {
            "none"
        }
        .to_string();

        return WindowEffectCapabilities {
            os: "windows".to_string(),
            os_version: raw_version,
            supported_effects: effects,
            default_effect,
        };
    }

    #[cfg(target_os = "macos")]
    {
        let raw_version = sysinfo::System::os_version().or_else(macos_version_from_sw_vers);
        let major = raw_version.as_deref().and_then(parse_macos_major);

        let mut effects = vec![
            "none".to_string(),
            "transparent".to_string(),
            "vibrancy".to_string(),
        ];

        if major.unwrap_or_default() >= 26 {
            effects.push("liquid_glass".to_string());
        }

        return WindowEffectCapabilities {
            os: "macos".to_string(),
            os_version: raw_version,
            supported_effects: effects,
            default_effect: "vibrancy".to_string(),
        };
    }

    #[cfg(target_os = "linux")]
    {
        return WindowEffectCapabilities {
            os: "linux".to_string(),
            os_version: sysinfo::System::os_version(),
            supported_effects: vec!["none".to_string(), "transparent".to_string()],
            default_effect: "none".to_string(),
        };
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        WindowEffectCapabilities {
            os: std::env::consts::OS.to_string(),
            os_version: None,
            supported_effects: vec!["none".to_string(), "transparent".to_string()],
            default_effect: "none".to_string(),
        }
    }
}

pub fn normalize_window_effect(
    requested: &str,
    capabilities: &WindowEffectCapabilities,
) -> (String, bool) {
    let normalized = requested.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return ("none".to_string(), false);
    }

    if capabilities
        .supported_effects
        .iter()
        .any(|effect| effect == &normalized)
    {
        (normalized, false)
    } else {
        ("none".to_string(), true)
    }
}

pub fn default_window_effect() -> String {
    get_window_effect_capabilities().default_effect
}

#[cfg(target_os = "windows")]
fn parse_windows_version(raw: &str) -> Option<WindowsVersionInfo> {
    let nums: Vec<u32> = raw
        .split(|c: char| !c.is_ascii_digit())
        .filter(|segment| !segment.is_empty())
        .filter_map(|segment| segment.parse::<u32>().ok())
        .collect();

    if nums.len() >= 3 {
        Some(WindowsVersionInfo {
            major: nums[0],
            build: nums[2],
        })
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn detect_windows_version_from_cmd() -> Option<WindowsVersionInfo> {
    let output = std::process::Command::new("cmd")
        .args(["/C", "ver"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let raw = String::from_utf8(output.stdout).ok()?;
    parse_windows_version(raw.trim())
}

#[cfg(target_os = "macos")]
fn parse_macos_major(raw: &str) -> Option<u32> {
    raw.split('.')
        .next()
        .and_then(|major| major.parse::<u32>().ok())
}

#[cfg(target_os = "macos")]
fn macos_version_from_sw_vers() -> Option<String> {
    let output = std::process::Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8(output.stdout)
        .ok()
        .map(|v| v.trim().to_string())
}
