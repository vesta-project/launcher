use crate::models::installed_resource::{InstalledResource, NewInstalledResource};
use crate::models::instance::Instance;
use crate::models::resource::{ResourceProject, ResourceVersion, SourcePlatform};
use crate::schema::installed_resource::dsl as ir_dsl;
use crate::schema::instance::dsl as inst_dsl;
use crate::utils::db::get_vesta_conn;
use crate::utils::instance_helpers::normalize_path;
use anyhow::Result;
use diesel::prelude::*;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default)]
pub struct ResourceProvenance {
    pub source_kind: String,
    pub source_modpack_id: Option<String>,
    pub source_modpack_version_id: Option<String>,
    pub source_modpack_platform: Option<String>,
}

impl ResourceProvenance {
    pub fn custom() -> Self {
        Self {
            source_kind: "custom".to_string(),
            ..Self::default()
        }
    }

    pub fn modpack(
        source_modpack_id: Option<String>,
        source_modpack_version_id: Option<String>,
        source_modpack_platform: Option<String>,
    ) -> Self {
        Self {
            source_kind: "modpack".to_string(),
            source_modpack_id,
            source_modpack_version_id,
            source_modpack_platform,
        }
    }
}

pub fn modpack_provenance_for_instance(instance_id: i32) -> Result<ResourceProvenance> {
    let mut conn = get_vesta_conn()?;
    let inst = inst_dsl::instance
        .filter(inst_dsl::id.eq(instance_id))
        .first::<Instance>(&mut conn)?;

    Ok(ResourceProvenance::modpack(
        inst.modpack_id,
        inst.modpack_version_id,
        inst.modpack_platform,
    ))
}

pub fn remove_resource(instance_id: i32, resource_id: i32) -> Result<()> {
    let mut conn = get_vesta_conn()?;
    let resource = ir_dsl::installed_resource
        .filter(ir_dsl::id.eq(resource_id))
        .filter(ir_dsl::instance_id.eq(instance_id))
        .first::<InstalledResource>(&mut conn)?;

    let path = Path::new(&resource.local_path);
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    diesel::delete(ir_dsl::installed_resource.filter(ir_dsl::id.eq(resource_id)))
        .execute(&mut conn)?;
    Ok(())
}

pub fn set_enabled(resource_id: i32, enabled: bool) -> Result<()> {
    let mut conn = get_vesta_conn()?;
    let resource = ir_dsl::installed_resource
        .filter(ir_dsl::id.eq(resource_id))
        .first::<InstalledResource>(&mut conn)?;
    let current_path = PathBuf::from(&resource.local_path);

    if !current_path.exists() {
        diesel::delete(ir_dsl::installed_resource.filter(ir_dsl::id.eq(resource_id)))
            .execute(&mut conn)?;
        anyhow::bail!("File not found on disk. The entry has been removed from the database.");
    }

    let new_path = toggled_path(&current_path, enabled);
    if new_path != current_path {
        std::fs::rename(&current_path, &new_path)?;
    }
    diesel::update(ir_dsl::installed_resource.filter(ir_dsl::id.eq(resource_id)))
        .set((
            ir_dsl::local_path.eq(normalize_path(&new_path)),
            ir_dsl::is_enabled.eq(enabled),
        ))
        .execute(&mut conn)?;
    Ok(())
}

pub fn clear_modpack_provenance(instance_id: i32) -> Result<usize> {
    let mut conn = get_vesta_conn()?;
    Ok(diesel::update(
        ir_dsl::installed_resource
            .filter(ir_dsl::instance_id.eq(instance_id))
            .filter(ir_dsl::source_kind.eq("modpack")),
    )
    .set((
        ir_dsl::source_kind.eq("custom"),
        ir_dsl::source_modpack_id.eq(Option::<String>::None),
        ir_dsl::source_modpack_version_id.eq(Option::<String>::None),
        ir_dsl::source_modpack_platform.eq(Option::<String>::None),
    ))
    .execute(&mut conn)?)
}

pub fn apply_modpack_provenance(
    instance: &Instance,
    resources: &[InstalledResource],
    matched_ids: &HashSet<i32>,
) -> Result<usize> {
    let Some(modpack_id) = instance.modpack_id.clone() else {
        return Ok(0);
    };
    let Some(modpack_version_id) = instance.modpack_version_id.clone() else {
        return Ok(0);
    };
    let Some(modpack_platform) = instance.modpack_platform.clone() else {
        return Ok(0);
    };

    let mut conn = get_vesta_conn()?;
    let mut changed = 0;
    for resource in resources {
        if matched_ids.contains(&resource.id) {
            let already_correct = resource.source_kind == "modpack"
                && resource.source_modpack_id.as_deref() == Some(modpack_id.as_str())
                && resource.source_modpack_version_id.as_deref()
                    == Some(modpack_version_id.as_str())
                && resource.source_modpack_platform.as_deref() == Some(modpack_platform.as_str());
            if already_correct {
                continue;
            }
            diesel::update(ir_dsl::installed_resource.filter(ir_dsl::id.eq(resource.id)))
                .set((
                    ir_dsl::source_kind.eq("modpack"),
                    ir_dsl::source_modpack_id.eq(Some(modpack_id.clone())),
                    ir_dsl::source_modpack_version_id.eq(Some(modpack_version_id.clone())),
                    ir_dsl::source_modpack_platform.eq(Some(modpack_platform.clone())),
                ))
                .execute(&mut conn)?;
        } else {
            let already_custom = resource.source_kind == "custom"
                && resource.source_modpack_id.is_none()
                && resource.source_modpack_version_id.is_none()
                && resource.source_modpack_platform.is_none();
            if already_custom {
                continue;
            }
            diesel::update(ir_dsl::installed_resource.filter(ir_dsl::id.eq(resource.id)))
                .set((
                    ir_dsl::source_kind.eq("custom"),
                    ir_dsl::source_modpack_id.eq(Option::<String>::None),
                    ir_dsl::source_modpack_version_id.eq(Option::<String>::None),
                    ir_dsl::source_modpack_platform.eq(Option::<String>::None),
                ))
                .execute(&mut conn)?;
        }
        changed += 1;
    }
    Ok(changed)
}

pub fn remove_missing_in_folder(instance_id: i32, folder: &Path) -> Result<usize> {
    let mut conn = get_vesta_conn()?;
    let prefix = normalize_path(folder);
    let resources = ir_dsl::installed_resource
        .filter(ir_dsl::instance_id.eq(instance_id))
        .load::<InstalledResource>(&mut conn)?;
    let mut removed = 0;
    for resource in resources
        .into_iter()
        .filter(|resource| resource.local_path.starts_with(&prefix))
    {
        if !Path::new(&resource.local_path).exists() {
            removed +=
                diesel::delete(ir_dsl::installed_resource.filter(ir_dsl::id.eq(resource.id)))
                    .execute(&mut conn)?;
        }
    }
    Ok(removed)
}

pub fn unlink_path(instance_id: i32, path: &Path) -> Result<usize> {
    let mut conn = get_vesta_conn()?;
    Ok(diesel::delete(
        ir_dsl::installed_resource
            .filter(ir_dsl::instance_id.eq(instance_id))
            .filter(ir_dsl::local_path.eq(normalize_path(path))),
    )
    .execute(&mut conn)?)
}

pub fn has_indexed_launch_resources(instance_id: i32) -> Result<bool> {
    let mut conn = get_vesta_conn()?;
    let count = ir_dsl::installed_resource
        .filter(ir_dsl::instance_id.eq(instance_id))
        .filter(
            ir_dsl::resource_type
                .eq("mod")
                .or(ir_dsl::resource_type.eq("resourcepack"))
                .or(ir_dsl::resource_type.eq("shader"))
                .or(ir_dsl::resource_type.eq("datapack")),
        )
        .count()
        .get_result::<i64>(&mut conn)?;
    Ok(count > 0)
}

pub fn find_custom_remote(instance_id: i32, remote_id: &str) -> Result<Option<InstalledResource>> {
    let mut conn = get_vesta_conn()?;
    Ok(ir_dsl::installed_resource
        .filter(ir_dsl::instance_id.eq(instance_id))
        .filter(ir_dsl::remote_id.eq(remote_id))
        .filter(ir_dsl::source_kind.eq("custom"))
        .first::<InstalledResource>(&mut conn)
        .optional()?)
}

pub fn record_manual(
    instance_id: i32,
    path: &Path,
    hash: Option<String>,
    metadata: (i64, i64),
    platform: &str,
    provenance: Option<ResourceProvenance>,
) -> Result<bool> {
    let path = normalize_path(path);
    let provenance = provenance.unwrap_or_else(|| {
        if platform == "modpack" {
            modpack_provenance_for_instance(instance_id)
                .unwrap_or_else(|_| ResourceProvenance::modpack(None, None, None))
        } else {
            ResourceProvenance::custom()
        }
    });
    let resource_type = resource_type_for_path(Path::new(&path));
    let Some(resource_type) = resource_type else {
        return Ok(false);
    };
    let display_name = Path::new(&path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Unknown Resource")
        .to_string();
    let enabled = !path.ends_with(".disabled");
    let mut conn = get_vesta_conn()?;
    let existing = ir_dsl::installed_resource
        .filter(ir_dsl::local_path.eq(&path))
        .first::<InstalledResource>(&mut conn)
        .optional()?;

    if let Some(resource) = existing {
        let canonical = !resource.remote_id.is_empty()
            && matches!(resource.platform.as_str(), "modrinth" | "curseforge");
        if canonical {
            diesel::update(ir_dsl::installed_resource.filter(ir_dsl::id.eq(resource.id)))
                .set((
                    ir_dsl::is_enabled.eq(enabled),
                    ir_dsl::last_updated.eq(chrono::Utc::now().to_rfc3339()),
                    ir_dsl::hash.eq(hash),
                    ir_dsl::file_size.eq(metadata.0),
                    ir_dsl::file_mtime.eq(metadata.1),
                    ir_dsl::resource_type.eq(resource_type),
                    ir_dsl::source_kind.eq(&provenance.source_kind),
                    ir_dsl::source_modpack_id.eq(&provenance.source_modpack_id),
                    ir_dsl::source_modpack_version_id.eq(&provenance.source_modpack_version_id),
                    ir_dsl::source_modpack_platform.eq(&provenance.source_modpack_platform),
                ))
                .execute(&mut conn)?;
        } else {
            diesel::update(ir_dsl::installed_resource.filter(ir_dsl::id.eq(resource.id)))
                .set((
                    ir_dsl::platform.eq(platform),
                    ir_dsl::is_enabled.eq(enabled),
                    ir_dsl::last_updated.eq(chrono::Utc::now().to_rfc3339()),
                    ir_dsl::hash.eq(hash),
                    ir_dsl::file_size.eq(metadata.0),
                    ir_dsl::file_mtime.eq(metadata.1),
                    ir_dsl::resource_type.eq(resource_type),
                    ir_dsl::source_kind.eq(&provenance.source_kind),
                    ir_dsl::source_modpack_id.eq(&provenance.source_modpack_id),
                    ir_dsl::source_modpack_version_id.eq(&provenance.source_modpack_version_id),
                    ir_dsl::source_modpack_platform.eq(&provenance.source_modpack_platform),
                ))
                .execute(&mut conn)?;
        }
    } else {
        diesel::insert_into(ir_dsl::installed_resource)
            .values(NewInstalledResource {
                instance_id,
                platform: platform.to_string(),
                remote_id: String::new(),
                remote_version_id: String::new(),
                resource_type: resource_type.to_string(),
                local_path: path,
                display_name,
                current_version: "unknown".to_string(),
                is_manual: true,
                is_enabled: enabled,
                last_updated: chrono::Utc::now().to_rfc3339(),
                release_type: "release".to_string(),
                hash,
                file_size: metadata.0,
                file_mtime: metadata.1,
                source_kind: provenance.source_kind,
                source_modpack_id: provenance.source_modpack_id,
                source_modpack_version_id: provenance.source_modpack_version_id,
                source_modpack_platform: provenance.source_modpack_platform,
            })
            .execute(&mut conn)?;
    }
    Ok(true)
}

pub fn record_remote(
    instance_id: i32,
    path: &Path,
    project: &ResourceProject,
    version: &ResourceVersion,
    platform: SourcePlatform,
    hash: Option<String>,
    metadata: (i64, i64),
    provenance: Option<ResourceProvenance>,
    resource_type: Option<&str>,
) -> Result<()> {
    let path = normalize_path(path);
    let platform = match platform {
        SourcePlatform::Modrinth => "modrinth",
        SourcePlatform::CurseForge => "curseforge",
    };
    let provenance = provenance.unwrap_or_else(ResourceProvenance::custom);
    let resource_type = resource_type
        .map(str::to_string)
        .unwrap_or_else(|| format!("{:?}", project.resource_type));
    let enabled = !path.ends_with(".disabled");
    let mut conn = get_vesta_conn()?;
    let by_path = ir_dsl::installed_resource
        .filter(ir_dsl::local_path.eq(&path))
        .first::<InstalledResource>(&mut conn)
        .optional()?;
    let by_remote = if by_path.is_none() {
        ir_dsl::installed_resource
            .filter(ir_dsl::instance_id.eq(instance_id))
            .filter(ir_dsl::remote_id.eq(&project.id))
            .filter(ir_dsl::platform.eq(platform))
            .filter(ir_dsl::source_kind.eq(&provenance.source_kind))
            .first::<InstalledResource>(&mut conn)
            .optional()?
    } else {
        None
    };

    let values = (
        ir_dsl::platform.eq(platform),
        ir_dsl::remote_id.eq(&project.id),
        ir_dsl::remote_version_id.eq(&version.id),
        ir_dsl::resource_type.eq(&resource_type),
        ir_dsl::local_path.eq(&path),
        ir_dsl::display_name.eq(&project.name),
        ir_dsl::current_version.eq(&version.version_number),
        ir_dsl::release_type.eq(format!("{:?}", version.release_type).to_lowercase()),
        ir_dsl::is_manual.eq(false),
        ir_dsl::is_enabled.eq(enabled),
        ir_dsl::last_updated.eq(chrono::Utc::now().to_rfc3339()),
        ir_dsl::hash.eq(hash),
        ir_dsl::file_size.eq(metadata.0),
        ir_dsl::file_mtime.eq(metadata.1),
        ir_dsl::source_kind.eq(&provenance.source_kind),
        ir_dsl::source_modpack_id.eq(&provenance.source_modpack_id),
        ir_dsl::source_modpack_version_id.eq(&provenance.source_modpack_version_id),
        ir_dsl::source_modpack_platform.eq(&provenance.source_modpack_platform),
    );
    if let Some(resource) = by_path.or(by_remote) {
        diesel::update(ir_dsl::installed_resource.filter(ir_dsl::id.eq(resource.id)))
            .set(values)
            .execute(&mut conn)?;
    } else {
        diesel::insert_into(ir_dsl::installed_resource)
            .values((ir_dsl::instance_id.eq(instance_id), values))
            .execute(&mut conn)?;
    }
    Ok(())
}

pub fn record_download(
    instance_id: i32,
    path: &Path,
    platform: SourcePlatform,
    project_id: &str,
    project_name: &str,
    version: &ResourceVersion,
    resource_type: &str,
    metadata: (i64, i64),
) -> Result<()> {
    let path = normalize_path(path);
    let platform = match platform {
        SourcePlatform::Modrinth => "modrinth",
        SourcePlatform::CurseForge => "curseforge",
    };
    let mut conn = get_vesta_conn()?;
    let existing = ir_dsl::installed_resource
        .filter(ir_dsl::instance_id.eq(instance_id))
        .filter(ir_dsl::remote_id.eq(project_id))
        .filter(ir_dsl::source_kind.eq("custom"))
        .first::<InstalledResource>(&mut conn)
        .optional()?;
    let values = (
        ir_dsl::platform.eq(platform),
        ir_dsl::remote_id.eq(project_id),
        ir_dsl::remote_version_id.eq(&version.id),
        ir_dsl::resource_type.eq(resource_type),
        ir_dsl::local_path.eq(&path),
        ir_dsl::display_name.eq(project_name),
        ir_dsl::current_version.eq(&version.version_number),
        ir_dsl::release_type.eq(format!("{:?}", version.release_type).to_lowercase()),
        ir_dsl::is_manual.eq(false),
        ir_dsl::is_enabled.eq(true),
        ir_dsl::last_updated.eq(chrono::Utc::now().to_rfc3339()),
        ir_dsl::hash.eq(Some(version.hash.clone())),
        ir_dsl::file_size.eq(metadata.0),
        ir_dsl::file_mtime.eq(metadata.1),
        ir_dsl::source_kind.eq("custom"),
        ir_dsl::source_modpack_id.eq(Option::<String>::None),
        ir_dsl::source_modpack_version_id.eq(Option::<String>::None),
        ir_dsl::source_modpack_platform.eq(Option::<String>::None),
    );
    if let Some(resource) = existing {
        diesel::update(ir_dsl::installed_resource.filter(ir_dsl::id.eq(resource.id)))
            .set(values)
            .execute(&mut conn)?;
    } else {
        diesel::insert_into(ir_dsl::installed_resource)
            .values((ir_dsl::instance_id.eq(instance_id), values))
            .execute(&mut conn)?;
    }
    Ok(())
}

pub fn toggled_path(path: &Path, enabled: bool) -> PathBuf {
    let value = path.to_string_lossy();
    if enabled && value.ends_with(".disabled") {
        PathBuf::from(&value[..value.len() - ".disabled".len()])
    } else if !enabled && !value.ends_with(".disabled") {
        PathBuf::from(format!("{value}.disabled"))
    } else {
        path.to_path_buf()
    }
}

fn resource_type_for_path(path: &Path) -> Option<&'static str> {
    match path
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
    {
        Some("mods") => Some("Mod"),
        Some("resourcepacks") => Some("ResourcePack"),
        Some("shaderpacks") => Some("ShaderPack"),
        Some("datapacks") => Some("DataPack"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::toggled_path;
    use std::path::Path;

    #[test]
    fn toggling_disabled_suffix_is_idempotent() {
        assert_eq!(
            toggled_path(Path::new("mods/a.jar"), false),
            Path::new("mods/a.jar.disabled")
        );
        assert_eq!(
            toggled_path(Path::new("mods/a.jar.disabled"), false),
            Path::new("mods/a.jar.disabled")
        );
        assert_eq!(
            toggled_path(Path::new("mods/a.jar.disabled"), true),
            Path::new("mods/a.jar")
        );
    }
}
