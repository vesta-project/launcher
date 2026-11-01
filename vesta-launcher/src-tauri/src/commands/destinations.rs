use crate::models::instance::Instance;
use fastnbt::Value;
use piston_lib::game::launcher::LaunchTarget;
use serde::Serialize;
use std::{collections::HashMap, io::Read, path::Path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedServer {
    pub name: String,
    pub address: String,
    pub icon: Option<String>,
    pub target: Option<LaunchTarget>,
}

pub fn read_saved_servers(path: &Path) -> Vec<SavedServer> {
    let Ok(file) = std::fs::File::open(path) else {
        return vec![];
    };
    let mut bytes = Vec::new();
    if file
        .take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() > 4 * 1024 * 1024
    {
        return vec![];
    }
    let Ok(root) = fastnbt::from_bytes::<HashMap<String, Value>>(&bytes) else {
        return vec![];
    };
    let Some(Value::List(entries)) = root.get("servers") else {
        return vec![];
    };
    entries
        .iter()
        .take(10_000)
        .filter_map(|entry| {
            let Value::Compound(row) = entry else {
                return None;
            };
            if matches!(row.get("hidden"), Some(Value::Byte(n)) if *n != 0) {
                return None;
            }
            let (Some(Value::String(name)), Some(Value::String(address))) =
                (row.get("name"), row.get("ip"))
            else {
                return None;
            };
            if name.len() > 1024 || address.len() > 512 {
                return None;
            }
            let icon = match row.get("icon") {
                Some(Value::String(icon)) if icon.len() < 1024 * 1024 => validated_icon(icon),
                _ => None,
            };
            Some(SavedServer {
                name: name.clone(),
                address: address.clone(),
                icon,
                target: piston_lib::game::launcher::targets::parse_server_address(address).ok(),
            })
        })
        .collect()
}
fn validated_icon(icon: &str) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let encoded = icon.strip_prefix("data:image/png;base64,").unwrap_or(icon);
    let bytes = STANDARD.decode(encoded).ok()?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return None;
    }
    Some(format!("data:image/png;base64,{encoded}"))
}

pub fn direct_launch_supported(instance: &Instance) -> bool {
    use piston_lib::game::{
        installer::types::OsType,
        launcher::targets::supports_quick_play,
        runtime_plan::{RuntimePlan, RuntimeRequest},
    };
    let loader = match instance.modloader.as_deref() {
        None => None,
        Some(value) => match value.parse() {
            Ok(loader) => Some(loader),
            Err(_) => return false,
        },
    };
    if !supports_quick_play(&instance.minecraft_version, loader) {
        return false;
    }
    let Ok(dir) = crate::utils::db_manager::get_app_config_dir() else {
        return false;
    };
    let data_dir = if dir.join("data").exists() {
        dir.join("data")
    } else {
        dir
    };
    let Ok(plan) = RuntimePlan::resolve_installed(RuntimeRequest {
        version_id: instance.minecraft_version.clone(),
        modloader: loader,
        modloader_version: instance.modloader_version.clone(),
        data_dir,
        os: OsType::current(),
    }) else {
        return false;
    };
    manifest_supports_direct_launch(&instance.minecraft_version, loader, &plan.manifest)
}

fn manifest_supports_direct_launch(
    version: &str,
    loader: Option<piston_lib::game::metadata::ModloaderType>,
    manifest: &piston_lib::game::launcher::unified_manifest::UnifiedManifest,
) -> bool {
    let mut probe = piston_lib::game::launcher::LaunchSpec {
        version_id: version.into(),
        modloader: loader,
        game_dir: std::path::PathBuf::from("support-probe"),
        access_token: "offline".into(),
        ..Default::default()
    };
    for target in [
        LaunchTarget::World {
            folder: "Support probe".into(),
        },
        LaunchTarget::Server {
            host: "localhost".into(),
            port: None,
        },
    ] {
        probe.target = target;
        if piston_lib::game::launcher::targets::validate_target_arguments(&probe, manifest).is_err()
        {
            return false;
        }
    }
    true
}

#[tauri::command]
pub fn list_instance_saved_servers(instance_id: i32) -> Result<Vec<SavedServer>, String> {
    let instance = crate::commands::instances::get_instance(instance_id)?;
    Ok(read_saved_servers(
        &crate::worlds::instance_game_directory(&instance)?.join("servers.dat"),
    ))
}
#[tauri::command]
pub fn instance_direct_launch_support(instance_id: i32) -> Result<bool, String> {
    Ok(direct_launch_supported(
        &crate::commands::instances::get_instance(instance_id)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn support_checks_resolved_flags_instead_of_version_alone() {
        use piston_lib::game::launcher::{
            unified_manifest::UnifiedManifest, version_parser::VersionManifest,
        };
        let vanilla: VersionManifest = serde_json::from_str(include_str!(
            "../../../../crates/piston-lib/src/test_fixtures/quickplay-1.21.json"
        ))
        .unwrap();
        let mut manifest = UnifiedManifest::from(vanilla);
        assert!(manifest_supports_direct_launch("1.21", None, &manifest));
        manifest.game_arguments.clear();
        assert!(!manifest_supports_direct_launch("1.21", None, &manifest));
    }
    #[test]
    fn saved_servers_read_only_tolerates_bad_rows_and_hidden() {
        let dir = std::env::temp_dir().join(format!("vesta-saved-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("servers.dat");
        assert!(read_saved_servers(&path).is_empty());
        std::fs::write(&path, b"bad nbt").unwrap();
        assert!(read_saved_servers(&path).is_empty());
        // Build heterogeneous malformed rows through NBT Values.
        let mut rows = Vec::new();
        for (name, ip, hidden) in [
            ("SMP", Some("[::1]:25566"), false),
            ("Hidden", Some("localhost"), true),
            ("broken", None, false),
        ] {
            let mut row = HashMap::new();
            row.insert("name".into(), Value::String(name.into()));
            if let Some(ip) = ip {
                row.insert("ip".into(), Value::String(ip.into()));
            }
            if hidden {
                row.insert("hidden".into(), Value::Byte(1));
            }
            rows.push(Value::Compound(row));
        }
        let bytes = fastnbt::to_bytes(&HashMap::from([("servers", Value::List(rows))])).unwrap();
        std::fs::write(&path, &bytes).unwrap();
        let rows = read_saved_servers(&path);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].address, "[::1]:25566");
        assert!(rows[0].target.is_some());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
