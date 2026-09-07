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
#[cfg(target_os = "windows")]
struct WindowsVersionInfo {
    major: u32,
    build: u32,
}

#[cfg(target_os = "windows")]
fn windows_supported_effects(version: Option<WindowsVersionInfo>) -> Vec<String> {
    let mut effects = vec!["none".to_string(), "transparent".to_string()];

    if let Some(version) = version {
        // window-vibrancy uses the legacy Blur Behind path on Windows 7/10
        // and early Windows 11. It is no longer supported from build 22621.
        if version.major < 10 || version.build < 22621 {
            effects.push("blur".to_string());
        }
        if version.major >= 10 {
            effects.push("acrylic".to_string());
            if version.build >= 22000 {
                effects.push("mica".to_string());
            }
        }
    }

    effects
}

pub fn get_window_effect_capabilities() -> WindowEffectCapabilities {
    #[cfg(target_os = "windows")]
    {
        // Query Windows directly instead of spawning `cmd /C ver`. A release Tauri
        // process has no console, so every console child can otherwise become a
        // visible Windows Terminal window. This function runs once per webview,
        // including the two prewarmed mini windows during startup.
        let detected_version = winver::WindowsVersion::detect();
        let raw_version = sysinfo::System::long_os_version()
            .or_else(sysinfo::System::os_version)
            .or_else(|| detected_version.as_ref().map(ToString::to_string));
        let parsed = detected_version
            .map(|version| WindowsVersionInfo {
                major: version.major,
                build: version.build,
            })
            .or_else(|| raw_version.as_deref().and_then(parse_windows_version));

        let effects = windows_supported_effects(parsed);

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

        WindowEffectCapabilities {
            os: "macos".to_string(),
            os_version: raw_version,
            supported_effects: effects,
            default_effect: "vibrancy".to_string(),
        }
    }

    #[cfg(target_os = "linux")]
    {
        WindowEffectCapabilities {
            os: "linux".to_string(),
            os_version: sysinfo::System::os_version(),
            supported_effects: vec!["none".to_string(), "transparent".to_string()],
            default_effect: "none".to_string(),
        }
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

#[cfg(all(test, target_os = "windows"))]
mod windows_tests {
    use super::*;

    #[test]
    fn blur_support_stops_at_windows_11_build_22621() {
        let early_windows_11 = windows_supported_effects(Some(WindowsVersionInfo {
            major: 10,
            build: 22000,
        }));
        assert!(early_windows_11.iter().any(|effect| effect == "blur"));
        assert!(early_windows_11.iter().any(|effect| effect == "mica"));

        let current_windows_11 = windows_supported_effects(Some(WindowsVersionInfo {
            major: 10,
            build: 26100,
        }));
        assert!(!current_windows_11.iter().any(|effect| effect == "blur"));
        assert!(current_windows_11.iter().any(|effect| effect == "mica"));
        assert!(current_windows_11.iter().any(|effect| effect == "acrylic"));
    }

    #[test]
    fn windows_10_keeps_blur_and_acrylic() {
        let effects = windows_supported_effects(Some(WindowsVersionInfo {
            major: 10,
            build: 19045,
        }));
        assert!(effects.iter().any(|effect| effect == "blur"));
        assert!(effects.iter().any(|effect| effect == "acrylic"));
        assert!(!effects.iter().any(|effect| effect == "mica"));
    }
}
