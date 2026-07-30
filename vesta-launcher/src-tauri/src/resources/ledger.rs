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

#[derive(Debug, Clone)]
pub enum InstalledResourceFact {
    Discovered {
        instance_id: i32,
        path: PathBuf,
        metadata: (i64, i64),
        provenance: Option<ResourceProvenance>,
    },
    Manual {
        instance_id: i32,
        path: PathBuf,
        hash: Option<String>,
        metadata: (i64, i64),
        platform: String,
        provenance: Option<ResourceProvenance>,
    },
    Remote {
        instance_id: i32,
        path: PathBuf,
        project: ResourceProject,
        version: ResourceVersion,
        platform: SourcePlatform,
        hash: Option<String>,
        metadata: (i64, i64),
        provenance: Option<ResourceProvenance>,
        resource_type: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LedgerBatchResult {
    pub attempted: usize,
    pub changed: usize,
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

fn resource_filename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Unknown Resource")
        .to_string()
}

fn provenance_matches(resource: &InstalledResource, provenance: &ResourceProvenance) -> bool {
    resource.source_kind == provenance.source_kind
        && resource.source_modpack_id == provenance.source_modpack_id
        && resource.source_modpack_version_id == provenance.source_modpack_version_id
        && resource.source_modpack_platform == provenance.source_modpack_platform
}

fn record_discovered_with_conn(
    conn: &mut SqliteConnection,
    instance_id: i32,
    path: &Path,
    metadata: (i64, i64),
    provenance: Option<ResourceProvenance>,
) -> Result<bool> {
    let path = normalize_path(path);
    let Some(resource_type) = resource_type_for_path(Path::new(&path)) else {
        return Ok(false);
    };
    let enabled = !path.ends_with(".disabled");
    let existing = ir_dsl::installed_resource
        .filter(ir_dsl::instance_id.eq(instance_id))
        .filter(ir_dsl::local_path.eq(&path))
        .first::<InstalledResource>(conn)
        .optional()?;

    if let Some(resource) = existing {
        let effective_provenance = provenance.unwrap_or_else(|| ResourceProvenance {
            source_kind: resource.source_kind.clone(),
            source_modpack_id: resource.source_modpack_id.clone(),
            source_modpack_version_id: resource.source_modpack_version_id.clone(),
            source_modpack_platform: resource.source_modpack_platform.clone(),
        });
        let content_changed = resource.file_size != metadata.0 || resource.file_mtime != metadata.1;
        let local_changed = content_changed
            || resource.is_enabled != enabled
            || resource.resource_type != resource_type
            || !provenance_matches(&resource, &effective_provenance);
        if !local_changed {
            return Ok(false);
        }

        if content_changed {
            diesel::update(ir_dsl::installed_resource.filter(ir_dsl::id.eq(resource.id)))
                .set((
                    ir_dsl::platform.eq("manual"),
                    ir_dsl::remote_id.eq(""),
                    ir_dsl::remote_version_id.eq(""),
                    ir_dsl::resource_type.eq(resource_type),
                    ir_dsl::display_name.eq(resource_filename(&path)),
                    ir_dsl::current_version.eq("unknown"),
                    ir_dsl::is_manual.eq(true),
                    ir_dsl::is_enabled.eq(enabled),
                    ir_dsl::last_updated.eq(chrono::Utc::now().to_rfc3339()),
                    ir_dsl::release_type.eq("release"),
                    ir_dsl::hash.eq(Option::<String>::None),
                    ir_dsl::file_size.eq(metadata.0),
                    ir_dsl::file_mtime.eq(metadata.1),
                    ir_dsl::source_kind.eq(&effective_provenance.source_kind),
                    ir_dsl::source_modpack_id.eq(&effective_provenance.source_modpack_id),
                    ir_dsl::source_modpack_version_id
                        .eq(&effective_provenance.source_modpack_version_id),
                    ir_dsl::source_modpack_platform
                        .eq(&effective_provenance.source_modpack_platform),
                ))
                .execute(conn)?;
        } else {
            diesel::update(ir_dsl::installed_resource.filter(ir_dsl::id.eq(resource.id)))
                .set((
                    ir_dsl::resource_type.eq(resource_type),
                    ir_dsl::is_enabled.eq(enabled),
                    ir_dsl::last_updated.eq(chrono::Utc::now().to_rfc3339()),
                    ir_dsl::source_kind.eq(&effective_provenance.source_kind),
                    ir_dsl::source_modpack_id.eq(&effective_provenance.source_modpack_id),
                    ir_dsl::source_modpack_version_id
                        .eq(&effective_provenance.source_modpack_version_id),
                    ir_dsl::source_modpack_platform
                        .eq(&effective_provenance.source_modpack_platform),
                ))
                .execute(conn)?;
        }
        return Ok(true);
    }

    let provenance = provenance.unwrap_or_else(ResourceProvenance::custom);
    diesel::insert_into(ir_dsl::installed_resource)
        .values(NewInstalledResource {
            instance_id,
            platform: "manual".to_string(),
            remote_id: String::new(),
            remote_version_id: String::new(),
            resource_type: resource_type.to_string(),
            local_path: path.clone(),
            display_name: resource_filename(&path),
            current_version: "unknown".to_string(),
            is_manual: true,
            is_enabled: enabled,
            last_updated: chrono::Utc::now().to_rfc3339(),
            release_type: "release".to_string(),
            hash: None,
            file_size: metadata.0,
            file_mtime: metadata.1,
            source_kind: provenance.source_kind,
            source_modpack_id: provenance.source_modpack_id,
            source_modpack_version_id: provenance.source_modpack_version_id,
            source_modpack_platform: provenance.source_modpack_platform,
        })
        .execute(conn)?;
    Ok(true)
}

pub fn record_manual(
    instance_id: i32,
    path: &Path,
    hash: Option<String>,
    metadata: (i64, i64),
    platform: &str,
    provenance: Option<ResourceProvenance>,
) -> Result<bool> {
    let mut conn = get_vesta_conn()?;
    record_manual_with_conn(
        &mut conn,
        instance_id,
        path,
        hash,
        metadata,
        platform,
        provenance,
    )
}

fn record_manual_with_conn(
    conn: &mut SqliteConnection,
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
    let display_name = resource_filename(&path);
    let enabled = !path.ends_with(".disabled");
    let existing = ir_dsl::installed_resource
        .filter(ir_dsl::instance_id.eq(instance_id))
        .filter(ir_dsl::local_path.eq(&path))
        .first::<InstalledResource>(conn)
        .optional()?;

    if let Some(resource) = existing {
        let unchanged = resource.platform == platform
            && resource.remote_id.is_empty()
            && resource.remote_version_id.is_empty()
            && resource.resource_type == resource_type
            && resource.display_name == display_name
            && resource.current_version == "unknown"
            && resource.is_manual
            && resource.is_enabled == enabled
            && resource.hash == hash
            && resource.file_size == metadata.0
            && resource.file_mtime == metadata.1
            && provenance_matches(&resource, &provenance);
        if unchanged {
            return Ok(false);
        }
        diesel::update(ir_dsl::installed_resource.filter(ir_dsl::id.eq(resource.id)))
            .set((
                ir_dsl::platform.eq(platform),
                ir_dsl::remote_id.eq(""),
                ir_dsl::remote_version_id.eq(""),
                ir_dsl::resource_type.eq(resource_type),
                ir_dsl::display_name.eq(&display_name),
                ir_dsl::current_version.eq("unknown"),
                ir_dsl::is_manual.eq(true),
                ir_dsl::is_enabled.eq(enabled),
                ir_dsl::last_updated.eq(chrono::Utc::now().to_rfc3339()),
                ir_dsl::release_type.eq("release"),
                ir_dsl::hash.eq(hash),
                ir_dsl::file_size.eq(metadata.0),
                ir_dsl::file_mtime.eq(metadata.1),
                ir_dsl::source_kind.eq(&provenance.source_kind),
                ir_dsl::source_modpack_id.eq(&provenance.source_modpack_id),
                ir_dsl::source_modpack_version_id.eq(&provenance.source_modpack_version_id),
                ir_dsl::source_modpack_platform.eq(&provenance.source_modpack_platform),
            ))
            .execute(conn)?;
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
            .execute(conn)?;
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
    let mut conn = get_vesta_conn()?;
    record_remote_with_conn(
        &mut conn,
        instance_id,
        path,
        project,
        version,
        platform,
        hash,
        metadata,
        provenance,
        resource_type,
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn record_remote_with_conn(
    conn: &mut SqliteConnection,
    instance_id: i32,
    path: &Path,
    project: &ResourceProject,
    version: &ResourceVersion,
    platform: SourcePlatform,
    hash: Option<String>,
    metadata: (i64, i64),
    provenance: Option<ResourceProvenance>,
    resource_type: Option<&str>,
) -> Result<bool> {
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
    let by_path = ir_dsl::installed_resource
        .filter(ir_dsl::local_path.eq(&path))
        .first::<InstalledResource>(conn)
        .optional()?;
    let by_remote = if by_path.is_none() {
        ir_dsl::installed_resource
            .filter(ir_dsl::instance_id.eq(instance_id))
            .filter(ir_dsl::remote_id.eq(&project.id))
            .filter(ir_dsl::platform.eq(platform))
            .filter(ir_dsl::source_kind.eq(&provenance.source_kind))
            .first::<InstalledResource>(conn)
            .optional()?
    } else {
        None
    };

    if let Some(resource) = by_path.as_ref().or(by_remote.as_ref()) {
        let unchanged = resource.platform == platform
            && resource.remote_id == project.id
            && resource.remote_version_id == version.id
            && resource.resource_type == resource_type
            && resource.local_path == path
            && resource.display_name == project.name
            && resource.current_version == version.version_number
            && resource.release_type == format!("{:?}", version.release_type).to_lowercase()
            && !resource.is_manual
            && resource.is_enabled == enabled
            && resource.hash == hash
            && resource.file_size == metadata.0
            && resource.file_mtime == metadata.1
            && provenance_matches(resource, &provenance);
        if unchanged {
            return Ok(false);
        }
    }

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
            .execute(conn)?;
    } else {
        diesel::insert_into(ir_dsl::installed_resource)
            .values((ir_dsl::instance_id.eq(instance_id), values))
            .execute(conn)?;
    }
    Ok(true)
}

pub fn record_many(facts: Vec<InstalledResourceFact>) -> Result<LedgerBatchResult> {
    let mut conn = get_vesta_conn()?;
    record_many_with_conn(&mut conn, facts)
}

fn record_many_with_conn(
    conn: &mut SqliteConnection,
    facts: Vec<InstalledResourceFact>,
) -> Result<LedgerBatchResult> {
    let attempted = facts.len();
    let changed = conn.transaction::<usize, anyhow::Error, _>(|conn| {
        let mut changed = 0;
        for fact in facts {
            match fact {
                InstalledResourceFact::Discovered {
                    instance_id,
                    path,
                    metadata,
                    provenance,
                } => {
                    if record_discovered_with_conn(conn, instance_id, &path, metadata, provenance)?
                    {
                        changed += 1;
                    }
                }
                InstalledResourceFact::Manual {
                    instance_id,
                    path,
                    hash,
                    metadata,
                    platform,
                    provenance,
                } => {
                    if record_manual_with_conn(
                        conn,
                        instance_id,
                        &path,
                        hash,
                        metadata,
                        &platform,
                        provenance,
                    )? {
                        changed += 1;
                    }
                }
                InstalledResourceFact::Remote {
                    instance_id,
                    path,
                    project,
                    version,
                    platform,
                    hash,
                    metadata,
                    provenance,
                    resource_type,
                } => {
                    if record_remote_with_conn(
                        conn,
                        instance_id,
                        &path,
                        &project,
                        &version,
                        platform,
                        hash,
                        metadata,
                        provenance,
                        resource_type.as_deref(),
                    )? {
                        changed += 1;
                    }
                }
            }
        }
        Ok(changed)
    })?;

    Ok(LedgerBatchResult { attempted, changed })
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
    use super::{record_many_with_conn, toggled_path, InstalledResourceFact, ResourceProvenance};
    use diesel::connection::SimpleConnection;
    use diesel::prelude::*;
    use std::path::Path;

    fn test_connection() -> SqliteConnection {
        let mut conn = SqliteConnection::establish(":memory:").expect("in-memory sqlite");
        conn.batch_execute(
            "CREATE TABLE installed_resource (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                instance_id INTEGER NOT NULL,
                platform TEXT NOT NULL,
                remote_id TEXT NOT NULL,
                remote_version_id TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                local_path TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                current_version TEXT NOT NULL,
                is_manual BOOLEAN NOT NULL,
                is_enabled BOOLEAN NOT NULL,
                last_updated TEXT NOT NULL,
                release_type TEXT NOT NULL,
                hash TEXT,
                file_size BIGINT NOT NULL,
                file_mtime BIGINT NOT NULL,
                source_kind TEXT NOT NULL,
                source_modpack_id TEXT,
                source_modpack_version_id TEXT,
                source_modpack_platform TEXT
            );",
        )
        .expect("installed_resource schema");
        conn
    }

    fn discovered(instance_id: i32, path: &Path) -> InstalledResourceFact {
        InstalledResourceFact::Discovered {
            instance_id,
            path: path.to_path_buf(),
            metadata: (3, 1),
            provenance: Some(ResourceProvenance::custom()),
        }
    }

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

    #[test]
    fn discovered_batch_is_idempotent() {
        let temp = tempfile::tempdir().expect("tempdir");
        let mods = temp.path().join("mods");
        std::fs::create_dir_all(&mods).expect("mods directory");
        let path = mods.join("example.jar");
        std::fs::write(&path, b"jar").expect("resource file");
        let mut conn = test_connection();

        let first =
            record_many_with_conn(&mut conn, vec![discovered(1, &path)]).expect("first batch");
        let second =
            record_many_with_conn(&mut conn, vec![discovered(1, &path)]).expect("second batch");

        assert_eq!(first.attempted, 1);
        assert_eq!(first.changed, 1);
        assert_eq!(second.attempted, 1);
        assert_eq!(second.changed, 0);
    }

    #[test]
    fn passive_discovery_preserves_existing_provenance_when_unspecified() {
        use crate::schema::installed_resource::dsl as installed_dsl;

        let temp = tempfile::tempdir().expect("tempdir");
        let mods = temp.path().join("mods");
        std::fs::create_dir_all(&mods).expect("mods directory");
        let path = mods.join("bundled.jar");
        std::fs::write(&path, b"jar").expect("resource file");
        let mut conn = test_connection();
        let modpack = ResourceProvenance::modpack(
            Some("pack".to_string()),
            Some("version".to_string()),
            Some("modrinth".to_string()),
        );

        record_many_with_conn(
            &mut conn,
            vec![InstalledResourceFact::Discovered {
                instance_id: 1,
                path: path.clone(),
                metadata: (3, 1),
                provenance: Some(modpack),
            }],
        )
        .expect("modpack discovery");
        let passive = record_many_with_conn(
            &mut conn,
            vec![InstalledResourceFact::Discovered {
                instance_id: 1,
                path,
                metadata: (3, 1),
                provenance: None,
            }],
        )
        .expect("passive discovery");
        let resource = installed_dsl::installed_resource
            .first::<crate::models::installed_resource::InstalledResource>(&mut conn)
            .expect("installed resource");

        assert_eq!(passive.changed, 0);
        assert_eq!(resource.source_kind, "modpack");
        assert_eq!(resource.source_modpack_id.as_deref(), Some("pack"));
    }

    #[test]
    fn batch_rolls_back_when_any_row_fails() {
        use crate::schema::installed_resource::dsl as installed_dsl;

        let temp = tempfile::tempdir().expect("tempdir");
        let mods = temp.path().join("mods");
        std::fs::create_dir_all(&mods).expect("mods directory");
        let path = mods.join("same.jar");
        std::fs::write(&path, b"jar").expect("resource file");
        let mut conn = test_connection();

        let result =
            record_many_with_conn(&mut conn, vec![discovered(1, &path), discovered(2, &path)]);
        assert!(result.is_err());
        let count = installed_dsl::installed_resource
            .count()
            .get_result::<i64>(&mut conn)
            .expect("row count");
        assert_eq!(count, 0);
    }
}
