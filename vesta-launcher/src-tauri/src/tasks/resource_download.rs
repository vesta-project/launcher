use crate::models::resource::{ResourceType, ResourceVersion, ResourceVersionFile, SourcePlatform};
use crate::notifications::models::PROGRESS_INDETERMINATE;
use crate::resources::ledger::DownloadLedgerEntry;
use crate::schema::instance::dsl as instances_dsl;
use crate::tasks::manager::{
    resourcepacks_conflict_key, saves_conflict_key, world_conflict_key, Task, TaskContext,
};
use crate::utils::db::get_vesta_conn;
pub use crate::worlds::ResourceInstallTarget;
use diesel::prelude::*;
use reqwest::Url;
use sha1::{Digest, Sha1};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tokio::fs;
use tokio::io::AsyncWriteExt;

fn target_instance_id(target: &ResourceInstallTarget) -> i32 {
    match target {
        ResourceInstallTarget::Instance { instance_id } => *instance_id,
        ResourceInstallTarget::World { world } => world.instance_id,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedArtifact {
    pub url: String,
    pub file_name: String,
    pub sha1: String,
    pub file_size: Option<u64>,
    pub resource_type: ResourceType,
}

fn role_resource_type(role: &str, project_type: ResourceType) -> Result<ResourceType, String> {
    match role.trim().to_ascii_lowercase().as_str() {
        "primary" | "alternate" | "additional" => Ok(project_type),
        "mod" => Ok(ResourceType::Mod),
        "resourcepack" | "resource-pack" | "companionresourcepack" => {
            Ok(ResourceType::ResourcePack)
        }
        "shader" | "shaderpack" => Ok(ResourceType::Shader),
        "datapack" | "data-pack" => Ok(ResourceType::DataPack),
        "world" => Ok(ResourceType::World),
        "modpack" => Ok(ResourceType::Modpack),
        unknown => Err(format!("Unknown artifact role '{unknown}'")),
    }
}

/// Turns provider data into a complete, deterministic install plan. Providers
/// with legacy single-file versions get one synthetic `primary` artifact.
pub fn plan_artifacts(
    version: &ResourceVersion,
    project_type: ResourceType,
) -> Result<Vec<PlannedArtifact>, String> {
    let files = if version.files.is_empty() {
        vec![ResourceVersionFile {
            url: version.download_url.clone(),
            file_name: version.file_name.clone(),
            hash: version.hash.clone(),
            file_size: version.file_size,
            role: "primary".to_string(),
        }]
    } else {
        version.files.clone()
    };

    files
        .into_iter()
        .map(|file| {
            if file.url.trim().is_empty() {
                return Err(format!("Artifact '{}' has no download URL", file.file_name));
            }
            let safe_name = Path::new(&file.file_name)
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.is_empty() && *name == file.file_name)
                .ok_or_else(|| format!("Unsafe artifact file name '{}'", file.file_name))?;
            Ok(PlannedArtifact {
                url: file.url,
                file_name: safe_name.to_string(),
                sha1: file.hash,
                file_size: file.file_size,
                resource_type: role_resource_type(&file.role, project_type)?,
            })
        })
        .collect()
}

pub fn requires_world_target(version: &ResourceVersion, project_type: ResourceType) -> bool {
    plan_artifacts(version, project_type).is_ok_and(|artifacts| {
        artifacts
            .iter()
            .any(|a| a.resource_type == ResourceType::DataPack)
    })
}

pub struct ResourceDownloadTask {
    pub target: ResourceInstallTarget,
    pub platform: SourcePlatform,
    pub project_id: String,
    pub project_name: String,
    pub version: ResourceVersion,
    pub resource_type: ResourceType,
    pub dependency_for: Option<String>,
    pub replacement_resource_id: Option<i32>,
}

fn resource_type_name(resource_type: ResourceType) -> &'static str {
    match resource_type {
        ResourceType::Mod => "mod",
        ResourceType::ResourcePack => "resourcepack",
        ResourceType::Shader => "shader",
        ResourceType::DataPack => "datapack",
        ResourceType::Modpack => "modpack",
        ResourceType::World => "world",
    }
}

fn artifact_target_directory(
    artifact_type: ResourceType,
    instance_path: &Path,
    world_path: Option<&Path>,
) -> Result<PathBuf, String> {
    match artifact_type {
        ResourceType::Mod => Ok(instance_path.join("mods")),
        ResourceType::ResourcePack => Ok(instance_path.join("resourcepacks")),
        ResourceType::Shader => Ok(instance_path.join("shaderpacks")),
        ResourceType::DataPack => world_path
            .map(|world| world.join("datapacks"))
            .ok_or_else(|| "Datapack installation requires a world target".to_string()),
        ResourceType::World => Ok(instance_path.join("saves")),
        ResourceType::Modpack => Err("Modpack artifacts use the modpack workflow".to_string()),
    }
}

fn file_metadata(path: &Path) -> Result<(i64, i64), String> {
    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    Ok((metadata.len() as i64, modified))
}

fn validate_datapack(path: &Path) -> Result<(), String> {
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Datapack is not a readable ZIP: {error}"))?;
    let pack = archive
        .by_name("pack.mcmeta")
        .map_err(|_| "Datapack must contain pack.mcmeta at the pack root".to_string())?;
    if !pack.is_file() {
        return Err("Datapack pack.mcmeta is not a file".to_string());
    }
    Ok(())
}

fn sha1_file(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha1::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn managed_component_path(
    manifest: &crate::worlds::manifest::WorldManifest,
    platform: SourcePlatform,
    project_id: &str,
    kind: crate::worlds::manifest::ManagedComponentKind,
    instance_path: &Path,
    world_path: &Path,
) -> Result<Option<PathBuf>, String> {
    use crate::worlds::manifest::{ComponentScope, ManagedComponentKind};
    use std::path::Component;

    let Some(component) = manifest.managed_components.iter().find(|component| {
        component.platform == platform.as_str()
            && component.project_id == project_id
            && component.kind == kind
    }) else {
        return Ok(None);
    };
    let relative = Path::new(&component.relative_path);
    if relative.is_absolute()
        || relative.components().next().is_none()
        || relative.components().any(|part| {
            matches!(
                part,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("World metadata contains an unsafe managed component path".to_string());
    }

    let (base, required_root) = match (kind, component.scope) {
        (ManagedComponentKind::Datapack, ComponentScope::World) => (world_path, "datapacks"),
        (ManagedComponentKind::CompanionResourcepack, ComponentScope::Instance) => {
            (instance_path, "resourcepacks")
        }
        _ => return Err("World metadata contains an invalid managed component scope".to_string()),
    };
    if relative
        .components()
        .next()
        .and_then(|part| part.as_os_str().to_str())
        != Some(required_root)
    {
        return Err(format!(
            "Managed component path must stay under {required_root}"
        ));
    }
    Ok(Some(base.join(relative)))
}

fn companion_path_is_shared(
    instance_path: &Path,
    current_world: &Path,
    companion_path: &Path,
) -> bool {
    let Ok(relative) = companion_path.strip_prefix(instance_path) else {
        return true;
    };
    let Ok(worlds) = std::fs::read_dir(instance_path.join("saves")) else {
        return true;
    };
    for entry in worlds {
        let Ok(entry) = entry else {
            return true;
        };
        let world = entry.path();
        if !entry
            .file_type()
            .is_ok_and(|file_type| file_type.is_dir() && !file_type.is_symlink())
            || !crate::worlds::level_dat::has_level_marker(&world)
        {
            continue;
        }
        let read = crate::worlds::manifest::read_manifest(&world);
        match read.status {
            crate::worlds::manifest::MetadataStatus::Valid => {
                let references = read.manifest.map_or(0, |manifest| {
                    manifest
                        .managed_components
                        .iter()
                        .filter(|component| {
                            component.kind
                                == crate::worlds::manifest::ManagedComponentKind::CompanionResourcepack
                                && Path::new(&component.relative_path) == relative
                        })
                        .count()
                });
                if references > usize::from(world == current_world) {
                    return true;
                }
            }
            crate::worlds::manifest::MetadataStatus::Corrupt
            | crate::worlds::manifest::MetadataStatus::Future => return true,
            crate::worlds::manifest::MetadataStatus::Absent => {}
        }
    }
    false
}

async fn download_artifact(
    ctx: &TaskContext,
    artifact: &PlannedArtifact,
    output: &Path,
    index: usize,
    total: usize,
) -> Result<String, String> {
    let url = Url::parse(&artifact.url)
        .map_err(|error| format!("Invalid download URL '{}': {error}", artifact.url))?;
    let mut response = piston_lib::client::shared_client()
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Failed to send download request: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Download failed with status {}", response.status()));
    }
    let expected_bytes = response
        .content_length()
        .or(artifact.file_size)
        .unwrap_or(0);
    let mut file = fs::File::create(output)
        .await
        .map_err(|error| error.to_string())?;
    let mut downloaded = 0_u64;
    let mut hasher = Sha1::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if *ctx.cancel_rx.borrow() {
            return Err("Installation cancelled".to_string());
        }
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        let percent = if expected_bytes == 0 {
            PROGRESS_INDETERMINATE
        } else {
            ((downloaded as f64 / expected_bytes as f64 * 100.0) as i32).clamp(0, 99)
        };
        ctx.update_full(
            percent,
            format!("Downloading {}", artifact.file_name),
            Some(index as i32),
            Some(total as i32),
        );
    }
    file.flush().await.map_err(|error| error.to_string())?;
    file.sync_all().await.map_err(|error| error.to_string())?;
    let computed = hex::encode(hasher.finalize());
    if !artifact.sha1.is_empty() && !computed.eq_ignore_ascii_case(&artifact.sha1) {
        return Err(format!(
            "SHA1 mismatch for {}: expected {}, got {}",
            artifact.file_name, artifact.sha1, computed
        ));
    }
    Ok(computed)
}

fn collision_safe_path(directory: &Path, file_name: &str) -> PathBuf {
    let requested = directory.join(file_name);
    if !requested.exists() {
        return requested;
    }
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("resource");
    let extension = path.extension().and_then(|value| value.to_str());
    for suffix in 2.. {
        let name = match extension {
            Some(extension) => format!("{stem} ({suffix}).{extension}"),
            None => format!("{stem} ({suffix})"),
        };
        let candidate = directory.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

struct PublishedArtifact {
    final_path: PathBuf,
    backup: Option<(PathBuf, PathBuf)>,
    newly_published: bool,
    sha1: String,
    resource_type: ResourceType,
    replaces_path: Option<PathBuf>,
}

fn managed_component_kind(
    resource_type: ResourceType,
) -> Option<crate::worlds::manifest::ManagedComponentKind> {
    match resource_type {
        ResourceType::DataPack => Some(crate::worlds::manifest::ManagedComponentKind::Datapack),
        ResourceType::ResourcePack => {
            Some(crate::worlds::manifest::ManagedComponentKind::CompanionResourcepack)
        }
        _ => None,
    }
}

fn restore_manifest_snapshot(world_root: &Path, snapshot: Option<&[u8]>) -> Result<(), String> {
    crate::worlds::manifest::restore_manifest_bytes(world_root, snapshot)
}

async fn rollback_publication(published: &[PublishedArtifact]) {
    for artifact in published.iter().rev() {
        if artifact.newly_published {
            let _ = fs::remove_file(&artifact.final_path).await;
        }
        if let Some((original, backup)) = &artifact.backup {
            let _ = fs::rename(backup, original).await;
        }
    }
}

impl Task for ResourceDownloadTask {
    fn name(&self) -> String {
        format!("Installing {}", self.project_name)
    }

    fn id(&self) -> Option<String> {
        let target = match &self.target {
            ResourceInstallTarget::Instance { instance_id } => format!("instance-{instance_id}"),
            ResourceInstallTarget::World { world } => format!(
                "world-{}-{}",
                world.instance_id,
                world.directory_name.replace(['/', '\\'], "_")
            ),
        };
        Some(format!(
            "download_{}_{}_{}",
            target, self.project_id, self.version.id
        ))
    }

    fn cancellable(&self) -> bool {
        true
    }

    fn conflict_keys(&self) -> Vec<String> {
        let Ok(artifacts) = plan_artifacts(&self.version, self.resource_type) else {
            return Vec::new();
        };
        let instance_id = target_instance_id(&self.target);
        let mut keys = Vec::new();

        if artifacts
            .iter()
            .any(|artifact| artifact.resource_type == ResourceType::DataPack)
        {
            if let ResourceInstallTarget::World { world } = &self.target {
                keys.push(world_conflict_key(world.instance_id, &world.directory_name));
            }
        }
        if artifacts
            .iter()
            .any(|artifact| artifact.resource_type == ResourceType::ResourcePack)
        {
            keys.push(resourcepacks_conflict_key(instance_id));
        }
        if artifacts
            .iter()
            .any(|artifact| artifact.resource_type == ResourceType::World)
        {
            keys.push(saves_conflict_key(instance_id));
        }

        keys
    }

    fn show_completion_notification(&self) -> bool {
        true
    }

    fn completion_description(&self) -> String {
        let suffix = if self.resource_type == ResourceType::ResourcePack
            || self
                .version
                .files
                .iter()
                .any(|file| file.role.eq_ignore_ascii_case("resourcepack"))
        {
            " Enable its resource pack in Minecraft if required."
        } else {
            ""
        };
        if let Some(parent) = &self.dependency_for {
            format!(
                "{} installed (required by {}).{}",
                self.project_name, parent, suffix
            )
        } else {
            format!("{} installed successfully.{}", self.project_name, suffix)
        }
    }

    fn run(
        &self,
        ctx: TaskContext,
    ) -> crate::tasks::manager::BoxFuture<'static, Result<(), String>> {
        let target = self.target.clone();
        let platform = self.platform;
        let project_id = self.project_id.clone();
        let project_name = self.project_name.clone();
        let version = self.version.clone();
        let project_type = self.resource_type;
        let replacement_resource_id = self.replacement_resource_id;
        let app_handle = ctx.app_handle.clone();

        Box::pin(async move {
            let artifacts = plan_artifacts(&version, project_type)?;
            if replacement_resource_id.is_some()
                && artifacts
                    .iter()
                    .filter(|artifact| artifact.resource_type == ResourceType::DataPack)
                    .count()
                    != 1
            {
                return Err(
                    "A world datapack replacement requires exactly one datapack artifact"
                        .to_string(),
                );
            }
            if artifacts
                .iter()
                .any(|a| a.resource_type == ResourceType::Modpack)
            {
                return Err("Modpack artifacts use the existing modpack workflow".to_string());
            }
            let world_artifacts = artifacts
                .iter()
                .filter(|artifact| artifact.resource_type == ResourceType::World)
                .count();
            if world_artifacts > 1 {
                return Err("A resource version may contain only one world archive".to_string());
            }
            if world_artifacts > 0 && artifacts.len() != world_artifacts {
                return Err(
                    "World archives cannot be combined with instance file artifacts".to_string(),
                );
            }
            if world_artifacts > 0 && !matches!(&target, ResourceInstallTarget::Instance { .. }) {
                return Err(
                    "World archives install into an instance, not another world".to_string()
                );
            }

            let instance_id = target_instance_id(&target);
            let instance = tauri::async_runtime::spawn_blocking(move || {
                let mut conn = get_vesta_conn().map_err(|error| error.to_string())?;
                instances_dsl::instance
                    .filter(instances_dsl::id.eq(instance_id))
                    .first::<crate::models::instance::Instance>(&mut conn)
                    .map_err(|error| format!("Instance not found: {error}"))
            })
            .await
            .map_err(|error| format!("Failed to query instance: {error}"))??;
            let instance_path = instance
                .game_directory
                .as_deref()
                .map(PathBuf::from)
                .ok_or_else(|| "Instance has no game directory set".to_string())?;
            let world_path = match &target {
                ResourceInstallTarget::World { world } => {
                    if world.instance_id != instance.id {
                        return Err("World target belongs to another instance".to_string());
                    }
                    Some(crate::worlds::resolve_world_path(world)?)
                }
                ResourceInstallTarget::Instance { .. } => None,
            };
            let requested_replacement = match (&target, replacement_resource_id) {
                (ResourceInstallTarget::World { world }, Some(resource_id)) => Some(
                    crate::worlds::datapacks::replacement_path(world, resource_id)?,
                ),
                (ResourceInstallTarget::Instance { .. }, Some(_)) => {
                    return Err("A world datapack replacement requires a world target".to_string())
                }
                (_, None) => None,
            };
            if artifacts
                .iter()
                .any(|a| a.resource_type == ResourceType::DataPack)
                && world_path.is_none()
            {
                return Err("Datapack installation requires a world target".to_string());
            }

            let staging = instance_path
                .join(".vesta")
                .join("staging")
                .join(format!("resource-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&staging)
                .await
                .map_err(|error| error.to_string())?;

            let result = async {
                let mut staged = Vec::with_capacity(artifacts.len());
                for (index, artifact) in artifacts.iter().enumerate() {
                    let staged_path = staging.join(format!("{index}.download"));
                    let hash =
                        download_artifact(&ctx, artifact, &staged_path, index + 1, artifacts.len())
                            .await?;
                    if artifact.resource_type == ResourceType::DataPack {
                        let validate_path = staged_path.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            validate_datapack(&validate_path)
                        })
                        .await
                        .map_err(|error| format!("Failed to validate datapack: {error}"))??;
                    }
                    staged.push((artifact.clone(), staged_path, hash));
                }

                if world_artifacts > 0 {
                    let (artifact, archive_path, hash) = staged
                        .into_iter()
                        .next()
                        .ok_or_else(|| "World archive is missing".to_string())?;
                    let source = crate::worlds::manifest::WorldSource {
                        platform: platform.as_str().to_string(),
                        project_id: project_id.clone(),
                        version_id: version.id.clone(),
                        version_number: version.version_number.clone(),
                        sha1: hash,
                        installed_at: chrono::Utc::now(),
                    };
                    crate::tasks::world_install::install_world_archive(
                        app_handle.clone(),
                        instance.clone(),
                        archive_path,
                        Some(source),
                        serde_json::json!({
                            "platform": platform.as_str(),
                            "projectId": project_id,
                            "name": project_name,
                            "versionId": version.id,
                            "fileName": artifact.file_name
                        }),
                        ctx.clone(),
                    )
                    .await?;
                    return Ok(());
                }

                let manifest_snapshot = world_path.as_deref().and_then(|world| {
                    std::fs::read(crate::worlds::manifest::manifest_path(world)).ok()
                });
                let mut world_manifest = if let Some(world) = world_path.as_deref() {
                    Some(crate::worlds::manifest::ensure_manifest_for_management(
                        world,
                    )?)
                } else {
                    None
                };
                let bundle_id = world_manifest
                    .as_ref()
                    .and_then(|manifest| {
                        manifest
                            .managed_components
                            .iter()
                            .find(|component| {
                                component.platform == platform.as_str()
                                    && component.project_id == project_id
                                    && managed_component_kind(ResourceType::DataPack)
                                        == Some(component.kind)
                            })
                            .map(|component| component.bundle_id)
                    })
                    .unwrap_or_else(uuid::Uuid::new_v4);

                let mut published = Vec::with_capacity(staged.len());
                macro_rules! rollback_try {
                    ($expression:expr) => {
                        match $expression {
                            Ok(value) => value,
                            Err(error) => {
                                rollback_publication(&published).await;
                                if let Some(world_root) = world_path.as_deref() {
                                    let _ = restore_manifest_snapshot(
                                        world_root,
                                        manifest_snapshot.as_deref(),
                                    );
                                }
                                return Err(error.to_string());
                            }
                        }
                    };
                }
                for (index, (artifact, staged_path, hash)) in staged.into_iter().enumerate() {
                    let directory = rollback_try!(artifact_target_directory(
                        artifact.resource_type,
                        &instance_path,
                        world_path.as_deref(),
                    ));
                    rollback_try!(fs::create_dir_all(&directory)
                        .await
                        .map_err(|error| error.to_string()));
                    let exact_query = rollback_try!(tauri::async_runtime::spawn_blocking({
                        let directory = directory.clone();
                        let hash = hash.clone();
                        move || {
                            crate::resources::ledger::find_exact_hash_in_directory(
                                instance_id,
                                resource_type_name(artifact.resource_type),
                                &directory,
                                &hash,
                            )
                            .map_err(|error| error.to_string())
                        }
                    })
                    .await
                    .map_err(|error| error.to_string()));
                    let exact = rollback_try!(exact_query);
                    if let Some(existing) = exact.filter(|existing| {
                        let path = Path::new(&existing.local_path);
                        let requested_matches = requested_replacement
                            .as_ref()
                            .is_none_or(|requested| requested == path);
                        requested_matches
                            && path.is_file()
                            && sha1_file(path)
                                .is_ok_and(|actual| actual.eq_ignore_ascii_case(&hash))
                    }) {
                        published.push(PublishedArtifact {
                            final_path: PathBuf::from(existing.local_path),
                            backup: None,
                            newly_published: false,
                            sha1: hash,
                            resource_type: artifact.resource_type,
                            replaces_path: None,
                        });
                        let _ = fs::remove_file(staged_path).await;
                        continue;
                    }

                    let mut managed_replacement = match (
                        world_manifest.as_ref(),
                        world_path.as_deref(),
                        managed_component_kind(artifact.resource_type),
                    ) {
                        (Some(manifest), Some(world_root), Some(kind)) => rollback_try!(
                            managed_component_path(
                                manifest,
                                platform,
                                &project_id,
                                kind,
                                &instance_path,
                                world_root,
                            )
                        ),
                        _ => None,
                    };
                    if artifact.resource_type == ResourceType::DataPack {
                        if let Some(requested) = requested_replacement.as_ref() {
                            managed_replacement = Some(requested.clone());
                        }
                    }
                    if artifact.resource_type == ResourceType::ResourcePack
                        && managed_replacement.as_deref().is_some_and(|path| {
                            companion_path_is_shared(
                                &instance_path,
                                world_path.as_deref().expect("managed bundle has a world"),
                                path,
                            )
                        })
                    {
                        managed_replacement = None;
                    }
                    let standalone_replacement = if managed_replacement.is_none()
                        && matches!(&target, ResourceInstallTarget::Instance { .. })
                    {
                        let query = rollback_try!(tauri::async_runtime::spawn_blocking({
                            let directory = directory.clone();
                            let project_id = project_id.clone();
                            move || {
                                crate::resources::ledger::find_custom_remote_for_target(
                                    instance_id,
                                    platform,
                                    &project_id,
                                    resource_type_name(artifact.resource_type),
                                    &directory,
                                    None,
                                )
                                .map(|row| row.map(|row| PathBuf::from(row.local_path)))
                                .map_err(|error| error.to_string())
                            }
                        })
                        .await
                        .map_err(|error| error.to_string()));
                        rollback_try!(query)
                    } else {
                        None
                    };
                    let replaces_path = managed_replacement.or(standalone_replacement);
                    let final_path = replaces_path
                        .clone()
                        .unwrap_or_else(|| collision_safe_path(&directory, &artifact.file_name));
                    let backup = if final_path.exists() {
                        let backup_path = staging.join(format!("backup-{index}"));
                        rollback_try!(fs::rename(&final_path, &backup_path)
                            .await
                            .map_err(|error| error.to_string()));
                        Some((final_path.clone(), backup_path))
                    } else {
                        None
                    };
                    if let Err(error) = fs::rename(&staged_path, &final_path).await {
                        rollback_publication(&published).await;
                        if let Some((original, backup)) = &backup {
                            let _ = fs::rename(backup, original).await;
                        }
                        return Err(error.to_string());
                    }
                    published.push(PublishedArtifact {
                        final_path,
                        backup,
                        newly_published: true,
                        sha1: hash,
                        resource_type: artifact.resource_type,
                        replaces_path,
                    });
                }

                if let (Some(world_root), Some(manifest)) =
                    (world_path.as_deref(), world_manifest.as_mut())
                {
                    let now = chrono::Utc::now();
                    for artifact in &published {
                        let Some(kind) = managed_component_kind(artifact.resource_type) else {
                            continue;
                        };
                        let (scope, relative_path) = match artifact.resource_type {
                            ResourceType::DataPack => (
                                crate::worlds::manifest::ComponentScope::World,
                                rollback_try!(artifact.final_path.strip_prefix(world_root).map_err(
                                    |_| "Datapack path escaped its world".to_string()
                                ))
                                .to_path_buf(),
                            ),
                            ResourceType::ResourcePack => (
                                crate::worlds::manifest::ComponentScope::Instance,
                                rollback_try!(artifact
                                    .final_path
                                    .strip_prefix(&instance_path)
                                    .map_err(|_| {
                                        "Resource pack path escaped its instance".to_string()
                                    }))
                                .to_path_buf(),
                            ),
                            _ => continue,
                        };
                        manifest.managed_components.retain(|component| {
                            !(component.platform == platform.as_str()
                                && component.project_id == project_id
                                && component.kind == kind)
                        });
                        manifest.managed_components.push(
                            crate::worlds::manifest::ManagedComponent {
                                bundle_id,
                                kind,
                                platform: platform.as_str().to_string(),
                                project_id: project_id.clone(),
                                version_id: version.id.clone(),
                                version_number: version.version_number.clone(),
                                display_name: project_name.clone(),
                                sha1: artifact.sha1.clone(),
                                scope,
                                relative_path: relative_path
                                    .to_string_lossy()
                                    .replace(std::path::MAIN_SEPARATOR, "/"),
                                installed_at: now,
                            },
                        );
                    }
                    manifest.updated_at = now;
                    if let Err(error) =
                        crate::worlds::manifest::write_manifest(world_root, manifest)
                    {
                        rollback_publication(&published).await;
                        let _ = restore_manifest_snapshot(world_root, manifest_snapshot.as_deref());
                        return Err(error);
                    }
                }

                let ledger_entries = published
                    .iter()
                    .map(|artifact| {
                        Ok(DownloadLedgerEntry {
                            instance_id,
                            path: artifact.final_path.clone(),
                            platform,
                            project_id: project_id.clone(),
                            project_name: project_name.clone(),
                            version: version.clone(),
                            resource_type: resource_type_name(artifact.resource_type).to_string(),
                            hash: artifact.sha1.clone(),
                            metadata: file_metadata(&artifact.final_path)?,
                            replaces_path: artifact.replaces_path.clone(),
                        })
                    })
                    .collect::<Result<Vec<_>, String>>();
                let ledger_entries = match ledger_entries {
                    Ok(entries) => entries,
                    Err(error) => {
                        rollback_publication(&published).await;
                        if let Some(world_root) = world_path.as_deref() {
                            let _ =
                                restore_manifest_snapshot(world_root, manifest_snapshot.as_deref());
                        }
                        return Err(error);
                    }
                };
                let ledger_join = tauri::async_runtime::spawn_blocking(move || {
                    crate::resources::ledger::record_downloads(ledger_entries)
                        .map_err(|error| error.to_string())
                })
                .await;
                let ledger_result = match ledger_join {
                    Ok(result) => result,
                    Err(error) => {
                        rollback_publication(&published).await;
                        if let Some(world_root) = world_path.as_deref() {
                            let _ =
                                restore_manifest_snapshot(world_root, manifest_snapshot.as_deref());
                        }
                        return Err(error.to_string());
                    }
                };
                if let Err(error) = ledger_result {
                    rollback_publication(&published).await;
                    if let Some(world_root) = world_path.as_deref() {
                        let _ = restore_manifest_snapshot(world_root, manifest_snapshot.as_deref());
                    }
                    return Err(error);
                }

                if world_path.is_some() {
                    if let Some(watcher) =
                        app_handle.try_state::<crate::resources::ResourceWatcher>()
                    {
                        if let Err(error) = watcher
                            .refresh_world_watches(instance_id, &instance_path)
                            .await
                        {
                            log::warn!(
                                "Installed datapack bundle, but could not refresh world watches: {error}"
                            );
                        }
                    }
                    if let ResourceInstallTarget::World { world } = &target {
                        let _ = crate::worlds::datapacks::emit_world_datapacks_changed(
                            &app_handle,
                            world,
                            "datapack-install",
                        );
                    }
                }
                for artifact in &published {
                    if let Some((_, backup)) = &artifact.backup {
                        let _ = fs::remove_file(backup).await;
                    }
                }
                Ok(())
            }
            .await;

            let _ = fs::remove_dir_all(&staging).await;
            result?;
            if let Err(error) = crate::resources::reconciliation::emit_rows_changed(
                &app_handle,
                instance_id,
                "resource-download",
            ) {
                log::warn!("Installed resource bundle, but row refresh emission failed: {error}");
            }
            if let Err(error) = crate::resources::reconciliation::emit_metadata_changed(
                &app_handle,
                instance_id,
                vec![crate::models::resource::ResourceProjectRef {
                    platform,
                    id: project_id,
                }],
                "complete",
            ) {
                log::warn!(
                    "Installed resource bundle, but metadata refresh emission failed: {error}"
                );
            }
            let _ =
                crate::resources::update_cache::invalidate_instance_update_snapshot(instance_id);
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::resource::ReleaseType;

    fn version(files: Vec<ResourceVersionFile>) -> ResourceVersion {
        ResourceVersion {
            id: "version".to_string(),
            project_id: "project".to_string(),
            version_number: "1".to_string(),
            game_versions: vec![],
            loaders: vec![],
            download_url: "https://example.invalid/legacy.zip".to_string(),
            file_name: "legacy.zip".to_string(),
            release_type: ReleaseType::Release,
            hash: "abc".to_string(),
            dependencies: vec![],
            published_at: None,
            download_count: None,
            file_size: Some(12),
            files,
        }
    }

    #[test]
    fn legacy_version_synthesizes_primary_artifact() {
        let planned = plan_artifacts(&version(vec![]), ResourceType::DataPack).unwrap();
        assert_eq!(planned.len(), 1);
        assert_eq!(planned[0].resource_type, ResourceType::DataPack);
        assert_eq!(planned[0].file_name, "legacy.zip");
    }

    #[test]
    fn combined_datapack_and_resourcepack_plans_every_artifact() {
        let planned = plan_artifacts(
            &version(vec![
                ResourceVersionFile {
                    url: "https://example.invalid/data.zip".to_string(),
                    file_name: "data.zip".to_string(),
                    hash: String::new(),
                    file_size: None,
                    role: "datapack".to_string(),
                },
                ResourceVersionFile {
                    url: "https://example.invalid/resources.zip".to_string(),
                    file_name: "resources.zip".to_string(),
                    hash: String::new(),
                    file_size: None,
                    role: "resourcepack".to_string(),
                },
            ]),
            ResourceType::ResourcePack,
        )
        .unwrap();
        assert_eq!(planned.len(), 2);
        assert_eq!(planned[0].resource_type, ResourceType::DataPack);
        assert_eq!(planned[1].resource_type, ResourceType::ResourcePack);
    }

    #[test]
    fn unknown_roles_are_rejected_before_download() {
        let result = plan_artifacts(
            &version(vec![ResourceVersionFile {
                url: "https://example.invalid/file.zip".to_string(),
                file_name: "file.zip".to_string(),
                hash: String::new(),
                file_size: None,
                role: "mystery".to_string(),
            }]),
            ResourceType::Mod,
        );
        assert!(result.unwrap_err().contains("Unknown artifact role"));
    }

    #[test]
    fn datapack_plan_requires_world_target() {
        assert!(requires_world_target(
            &version(vec![]),
            ResourceType::DataPack
        ));
    }

    #[test]
    fn combined_world_bundle_locks_world_and_companion_directory() {
        let task = ResourceDownloadTask {
            target: ResourceInstallTarget::World {
                world: crate::worlds::WorldRef {
                    instance_id: 7,
                    directory_name: "New World".to_string(),
                },
            },
            platform: SourcePlatform::Modrinth,
            project_id: "project".to_string(),
            project_name: "Bundle".to_string(),
            version: version(vec![
                ResourceVersionFile {
                    url: "https://example.invalid/data.zip".to_string(),
                    file_name: "data.zip".to_string(),
                    hash: String::new(),
                    file_size: None,
                    role: "datapack".to_string(),
                },
                ResourceVersionFile {
                    url: "https://example.invalid/resources.zip".to_string(),
                    file_name: "resources.zip".to_string(),
                    hash: String::new(),
                    file_size: None,
                    role: "resourcepack".to_string(),
                },
            ]),
            resource_type: ResourceType::DataPack,
            dependency_for: None,
            replacement_resource_id: None,
        };

        let mut keys = task.conflict_keys();
        keys.sort();
        assert_eq!(
            keys,
            vec![
                resourcepacks_conflict_key(7),
                world_conflict_key(7, "New World"),
            ]
        );
    }

    #[test]
    fn world_archive_install_locks_the_destination_saves_directory() {
        let task = ResourceDownloadTask {
            target: ResourceInstallTarget::Instance { instance_id: 9 },
            platform: SourcePlatform::Modrinth,
            project_id: "world".to_string(),
            project_name: "World".to_string(),
            version: version(vec![]),
            resource_type: ResourceType::World,
            dependency_for: None,
            replacement_resource_id: None,
        };

        assert_eq!(task.conflict_keys(), vec![saves_conflict_key(9)]);
    }
}
