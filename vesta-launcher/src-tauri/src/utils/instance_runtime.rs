use diesel::prelude::*;
use piston_lib::game::modpack::manifest::ModpackManifest;
use piston_lib::game::modpack::types::ModpackMetadata;

use crate::models::instance::Instance;
use crate::utils::db::get_vesta_conn;

/// Minecraft version and modloader columns on an instance row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstanceRuntimeFields {
    pub minecraft_version: String,
    pub modloader: Option<String>,
    pub modloader_version: Option<String>,
}

impl InstanceRuntimeFields {
    pub fn from_instance(inst: &Instance) -> Self {
        Self {
            minecraft_version: inst.minecraft_version.clone(),
            modloader: inst.modloader.clone(),
            modloader_version: inst.modloader_version.clone(),
        }
    }

    pub fn from_manifest(manifest: &ModpackManifest) -> Self {
        Self {
            minecraft_version: manifest.minecraft_version.clone(),
            modloader: Some(manifest.modloader.loader_type.to_lowercase()),
            modloader_version: manifest.modloader.version.clone(),
        }
    }

    pub fn from_metadata(metadata: &ModpackMetadata) -> Self {
        Self {
            minecraft_version: metadata.minecraft_version.clone(),
            modloader: Some(metadata.modloader_type.to_lowercase()),
            modloader_version: metadata.modloader_version.clone(),
        }
    }
}

fn normalize_loader(loader: Option<&str>) -> String {
    loader.unwrap_or("vanilla").to_lowercase()
}

/// True when instance DB runtime columns differ from the target fields.
pub fn runtime_drifts(inst: &Instance, target: &InstanceRuntimeFields) -> bool {
    inst.minecraft_version != target.minecraft_version
        || normalize_loader(inst.modloader.as_deref())
            != normalize_loader(target.modloader.as_deref())
        || inst.modloader_version != target.modloader_version
}

/// True when instance DB runtime columns differ from an on-disk modpack manifest.
pub fn runtime_drifts_from_manifest(inst: &Instance, manifest: &ModpackManifest) -> bool {
    runtime_drifts(inst, &InstanceRuntimeFields::from_manifest(manifest))
}

/// True when two modpack manifests target different Minecraft or loader identities.
pub fn manifest_runtime_identity_changed(
    old: &ModpackManifest,
    new: &ModpackManifest,
) -> bool {
    InstanceRuntimeFields::from_manifest(old) != InstanceRuntimeFields::from_manifest(new)
}

/// Write Minecraft/loader columns on the instance row.
pub fn sync_fields(instance_id: i32, fields: &InstanceRuntimeFields) -> Result<Instance, String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    use crate::schema::instance::dsl as inst_dsl;

    diesel::update(inst_dsl::instance.filter(inst_dsl::id.eq(instance_id)))
        .set((
            inst_dsl::minecraft_version.eq(&fields.minecraft_version),
            inst_dsl::modloader.eq(&fields.modloader),
            inst_dsl::modloader_version.eq(&fields.modloader_version),
        ))
        .execute(&mut conn)
        .map_err(|e| format!("Failed to sync instance runtime fields: {}", e))?;

    inst_dsl::instance
        .find(instance_id)
        .first(&mut conn)
        .map_err(|e| format!("Failed to reload instance after runtime sync: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use piston_lib::game::modpack::manifest::ModpackManifestModloader;
    use piston_lib::game::modpack::types::ModpackFormat;

    fn sample_manifest(
        mc: &str,
        loader_type: &str,
        loader_version: Option<&str>,
    ) -> ModpackManifest {
        ModpackManifest {
            source: ModpackFormat::Modrinth,
            modpack_id: Some("test-pack".to_string()),
            name: "Test".to_string(),
            version: "1.0".to_string(),
            installed_at: String::new(),
            minecraft_version: mc.to_string(),
            modloader: ModpackManifestModloader {
                loader_type: loader_type.to_string(),
                version: loader_version.map(str::to_string),
            },
            mods: vec![],
            overrides: piston_lib::game::modpack::manifest::ModpackManifestOverrides {
                extracted: vec![],
                skipped_configs: vec![],
                hashes: std::collections::HashMap::new(),
            },
            source_zip_path: None,
        }
    }

    #[test]
    fn manifest_runtime_identity_unchanged_for_same_target() {
        let old = sample_manifest("1.20.1", "fabric", Some("0.15.0"));
        let new = sample_manifest("1.20.1", "fabric", Some("0.15.0"));
        assert!(!manifest_runtime_identity_changed(&old, &new));
    }

    #[test]
    fn manifest_runtime_identity_changed_on_minecraft_bump() {
        let old = sample_manifest("1.20.1", "fabric", Some("0.15.0"));
        let new = sample_manifest("1.21.1", "fabric", Some("0.15.0"));
        assert!(manifest_runtime_identity_changed(&old, &new));
    }

    #[test]
    fn manifest_runtime_identity_changed_on_loader_version_bump() {
        let old = sample_manifest("1.20.1", "fabric", Some("0.15.0"));
        let new = sample_manifest("1.20.1", "fabric", Some("0.16.0"));
        assert!(manifest_runtime_identity_changed(&old, &new));
    }

    #[test]
    fn runtime_treats_none_loader_as_vanilla() {
        let target = InstanceRuntimeFields::from_manifest(&sample_manifest(
            "1.20.1",
            "vanilla",
            None,
        ));
        let inst = Instance {
            minecraft_version: "1.20.1".to_string(),
            modloader: None,
            modloader_version: None,
            ..Default::default()
        };
        assert!(!runtime_drifts(&inst, &target));
    }

    #[test]
    fn runtime_drifts_when_minecraft_differs() {
        let manifest = sample_manifest("1.21.1", "fabric", Some("0.15.0"));
        let inst = Instance {
            minecraft_version: "1.20.1".to_string(),
            modloader: Some("fabric".to_string()),
            modloader_version: Some("0.15.0".to_string()),
            ..Default::default()
        };
        assert!(runtime_drifts_from_manifest(&inst, &manifest));
    }
}
