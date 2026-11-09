//! Client loader and dependency target come from the draft, never server software.
use crate::{
    models::resource::{
        DependencyType, ResourceProject, ResourceType, ResourceVersion, SideRequirement,
        SourcePlatform,
    },
    resources::ResourceManager,
    servers::ServerManager,
};
use std::sync::Arc;
use tauri::{AppHandle, State};
use vesta_server_client::{pack::*, Error, ErrorCode, Result};
type Manager<'a> = State<'a, Arc<ServerManager>>;
fn invalid() -> Error {
    Error::new(ErrorCode::InvalidInput)
}
#[tauri::command]
pub async fn server_pack_icon(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<Option<PackIcon>> {
    manager
        .management_read(&app, &connection_id, |c| async move { c.pack_icon().await })
        .await
}
fn incompatible() -> Error {
    Error::new(ErrorCode::Unsupported)
}
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExpectedRevision {
    expected_revision: String,
}
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UploadId {
    upload_id: String,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackDependency {
    pub project: ResourceProject,
    pub version: ResourceVersion,
    pub required: bool,
    pub installed: bool,
    pub entry: PackEntry,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackDependencyPreview {
    pub target: WorkspaceView,
    pub project: ResourceProject,
    pub version: ResourceVersion,
    pub entry: PackEntry,
    pub dependencies: Vec<PackDependency>,
    pub warnings: Vec<String>,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPackPreview {
    #[serde(flatten)]
    pub preview: PackPreview,
    pub resolved_entries: Vec<PackEntry>,
    pub warnings: Vec<String>,
}

fn entry(
    project: &ResourceProject,
    version: &ResourceVersion,
    manifest: &PackManifest,
    required: bool,
) -> Result<PackEntry> {
    use crate::resources::manager::is_loader_compatible;
    if !version.game_versions.contains(&manifest.minecraft_version)
        || project
            .environment
            .is_some_and(|e| e.client_requirement == Some(SideRequirement::Unsupported))
    {
        return Err(incompatible());
    }
    let kind = if version.loaders.iter().any(|l| l == "datapack") {
        EntryKind::Datapack
    } else {
        match project.resource_type {
            ResourceType::Mod => EntryKind::Mod,
            ResourceType::ResourcePack => EntryKind::ResourcePack,
            ResourceType::Shader => EntryKind::Shader,
            ResourceType::DataPack => EntryKind::Datapack,
            _ => return Err(incompatible()),
        }
    };
    if kind == EntryKind::Mod
        && (manifest.loader == ClientLoader::None
            || !is_loader_compatible(&version.loaders, manifest.loader.id()))
    {
        return Err(incompatible());
    }
    if version.file_name.contains('/')
        || version.file_name.contains('\\')
        || version.file_name.is_empty()
    {
        return Err(invalid());
    }
    let directory = match kind {
        EntryKind::Mod => "mods",
        EntryKind::ResourcePack => "resourcepacks",
        EntryKind::Shader => "shaderpacks",
        EntryKind::Datapack => "datapacks",
        EntryKind::ConfigOverride => return Err(invalid()),
    };
    let server = match project.environment.and_then(|e| e.server_requirement) {
        Some(SideRequirement::Required) => Side::Required,
        Some(SideRequirement::Optional) => Side::Optional,
        _ => Side::Unsupported,
    };
    Ok(PackEntry {
        id: format!("{}-{}", project.source.as_str(), project.id),
        kind,
        path: format!("{directory}/{}", version.file_name),
        // Provider filename selection has no imported rename/SHA512 binding.
        // ResourceVersion.hash is SHA1 and must not be mislabeled as SHA512.
        artifact_sha512: None,
        required,
        environment: Environment {
            client: if required {
                Side::Required
            } else {
                Side::Optional
            },
            server,
        },
        source: EntrySource::Provider {
            provider: project.source.as_str().into(),
            project_id: project.id.clone(),
            version_id: version.id.clone(),
        },
    })
}
async fn dependencies(
    resources: &ResourceManager,
    target: WorkspaceView,
    provider: &str,
    project_id: &str,
    version_id: &str,
) -> Result<PackDependencyPreview> {
    if target.minecraft_drift {
        return Err(Error::new(ErrorCode::StaleTarget));
    }
    let platform = SourcePlatform::from_str_id(provider)
        .filter(|p| *p != SourcePlatform::Smithed)
        .ok_or_else(invalid)?;
    let project = resources
        .get_project(platform, project_id)
        .await
        .map_err(|_| incompatible())?;
    let version = resources
        .get_version(platform, project_id, version_id)
        .await
        .map_err(|_| incompatible())?;
    let root = entry(&project, &version, &target.draft.manifest, true)?;
    let resolved = resources
        .resolve_dependency_preview(
            platform,
            project.resource_type,
            &version,
            &target.draft.manifest.minecraft_version,
            &target.draft.manifest.minecraft_version,
            target.draft.manifest.loader.id(),
            false,
            true,
        )
        .await
        .map_err(|_| incompatible())?;
    let mut rows = Vec::new();
    let mut warnings = Vec::new();
    if version.download_url.is_empty() {
        warnings.push("manual_download_required".into());
    }
    for (project, version, dependency_type) in resolved {
        let required = dependency_type == DependencyType::Required;
        let dependency = match entry(&project, &version, &target.draft.manifest, required) {
            Ok(e) => e,
            Err(_) if !required => {
                warnings.push(format!("optional_dependency_incompatible:{}", project.id));
                continue;
            }
            Err(e) => return Err(e),
        };
        let installed=target.draft.manifest.entries.iter().any(|e|matches!(&e.source,EntrySource::Provider{provider,project_id,version_id} if provider==project.source.as_str()&&project_id==&project.id&&version_id==&version.id));
        if version.download_url.is_empty() {
            warnings.push(format!("manual_download_required:{}", project.id));
        }
        rows.push(PackDependency {
            project,
            version,
            required,
            installed,
            entry: dependency,
        });
    }
    Ok(PackDependencyPreview {
        target,
        project,
        version,
        entry: root,
        dependencies: rows,
        warnings,
    })
}
#[tauri::command]
pub async fn server_pack_dependencies(
    app: AppHandle,
    manager: Manager<'_>,
    resource_manager: State<'_, ResourceManager>,
    connection_id: String,
    provider: String,
    project_id: String,
    version_id: String,
) -> Result<PackDependencyPreview> {
    let target = manager
        .management_read(
            &app,
            &connection_id,
            |c| async move { c.pack_draft().await },
        )
        .await?;
    dependencies(
        &resource_manager,
        target,
        &provider,
        &project_id,
        &version_id,
    )
    .await
}
#[tauri::command]
pub async fn server_pack_add(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: BrowseAdd,
    intent_id: String,
) -> Result<PackDraft> {
    let payload = serde_json::to_value(&request).map_err(|_| invalid())?;
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "pack/draft/add",
            payload,
            false,
            |c| async move { c.pack_browse_add(request, &intent_id).await },
        )
        .await
}
#[tauri::command]
pub async fn server_pack_preview(
    app: AppHandle,
    manager: Manager<'_>,
    resource_manager: State<'_, ResourceManager>,
    connection_id: String,
    draft_revision: String,
) -> Result<ResolvedPackPreview> {
    let target = manager
        .management_read(
            &app,
            &connection_id,
            |c| async move { c.pack_draft().await },
        )
        .await?;
    if target.draft.revision != draft_revision {
        return Err(Error::new(ErrorCode::StaleTarget));
    }
    let mut resolved_entries: Vec<PackEntry> = Vec::new();
    let mut warnings = Vec::new();
    let mut failed = false;
    for root in &target.draft.manifest.entries {
        if root.environment.client == Side::Unsupported {
            continue;
        }
        let EntrySource::Provider {
            provider,
            project_id,
            version_id,
        } = &root.source
        else {
            continue;
        };
        match dependencies(
            &resource_manager,
            target.clone(),
            provider,
            project_id,
            version_id,
        )
        .await
        {
            Ok(preview) => {
                warnings.extend(preview.warnings);
                for mut dependency in preview.dependencies {
                    if !dependency.required {
                        continue;
                    }
                    if dependency.installed {
                        if let Some(old) = target.draft.manifest.entries.iter().find(|e| {
                            serde_json::to_value(&e.source).ok()
                                == serde_json::to_value(&dependency.entry.source).ok()
                        }) {
                            if !root.required || old.required {
                                continue;
                            }
                            dependency.entry = old.clone();
                        }
                    }
                    dependency.entry.required = root.required;
                    dependency.entry.environment.client = if root.required {
                        Side::Required
                    } else {
                        Side::Optional
                    };
                    if let Some(old) = resolved_entries
                        .iter_mut()
                        .find(|e| e.id == dependency.entry.id)
                    {
                        if old.path != dependency.entry.path
                            || serde_json::to_value(&old.source).ok()
                                != serde_json::to_value(&dependency.entry.source).ok()
                        {
                            failed = true;
                            warnings.push("dependency_version_conflict".into());
                        }
                        old.required |= dependency.entry.required;
                        if old.required {
                            old.environment.client = Side::Required;
                        }
                    } else {
                        resolved_entries.push(dependency.entry);
                    }
                }
            }
            Err(_) => {
                failed = true;
                warnings.push(format!("dependency_resolution_failed:{}", root.id));
            }
        }
    }
    let input = PreviewRequest {
        draft_revision,
        resolved_entries: resolved_entries.clone(),
    };
    let mut preview = manager
        .management_read(&app, &connection_id, |c| async move {
            c.pack_preview(input).await
        })
        .await?;
    if failed {
        preview.valid = false;
        preview.issues.push(PackIssue {
            code: "dependency_resolution_failed".into(),
            entry_id: None,
            severity: "error".into(),
        });
    }
    Ok(ResolvedPackPreview {
        preview,
        resolved_entries,
        warnings,
    })
}

#[tauri::command]
pub async fn server_pack_write(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: DraftWrite,
    intent_id: String,
) -> Result<PackDraft> {
    let payload = serde_json::to_value(&request).map_err(|_| invalid())?;
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "pack/draft",
            payload,
            false,
            |c| async move { c.pack_write(request, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_pack_delete(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: ExpectedRevision,
    intent_id: String,
) -> Result<PackDraft> {
    let payload = serde_json::to_value(&request).map_err(|_| invalid())?;
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "pack/draft/delete",
            payload,
            false,
            |c| async move { c.pack_delete(request.expected_revision, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_pack_import(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: ImportRequest,
    intent_id: String,
) -> Result<PackDraft> {
    let payload = serde_json::to_value(&request).map_err(|_| invalid())?;
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "pack/draft/import",
            payload,
            false,
            |c| async move { c.pack_import(request, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_pack_build_publish(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: WorkspacePublish,
    intent_id: String,
) -> Result<vesta_server_client::management::PackOutcome> {
    let payload = serde_json::to_value(&request).map_err(|_| invalid())?;
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "pack/publish",
            payload,
            false,
            |c| async move { c.pack_publish_workspace(request, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_pack_upload_begin(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: UploadBegin,
    intent_id: String,
) -> Result<UploadReceipt> {
    let payload = serde_json::to_value(&request).map_err(|_| invalid())?;
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "pack/draft/uploads/begin",
            payload,
            false,
            |c| async move { c.pack_upload_begin(request, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_pack_upload_chunk(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: UploadChunk,
    intent_id: String,
) -> Result<UploadReceipt> {
    let payload = serde_json::to_value(&request).map_err(|_| invalid())?;
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "pack/draft/uploads/chunk",
            payload,
            false,
            |c| async move { c.pack_upload_chunk(request, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_pack_upload_finish(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: UploadId,
    intent_id: String,
) -> Result<UploadReceipt> {
    let payload = serde_json::to_value(&request).map_err(|_| invalid())?;
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "pack/draft/uploads/finish",
            payload,
            false,
            |c| async move { c.pack_upload_finish(request.upload_id, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_pack_upload_cancel(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: UploadId,
    intent_id: String,
) -> Result<bool> {
    let payload = serde_json::to_value(&request).map_err(|_| invalid())?;
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "pack/draft/uploads/cancel",
            payload,
            false,
            |c| async move { c.pack_upload_cancel(request.upload_id, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_pack_draft(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<WorkspaceView> {
    manager
        .management_read(
            &app,
            &connection_id,
            |c| async move { c.pack_draft().await },
        )
        .await
}

#[tauri::command]
pub async fn server_pack_suggestions(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<PackSuggestions> {
    manager
        .management_read(&app, &connection_id, |c| async move {
            c.pack_suggestions().await
        })
        .await
}

#[tauri::command]
pub async fn server_pack_archive_inspect(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    upload_id: String,
) -> Result<ArchiveInspection> {
    manager
        .management_read(&app, &connection_id, |c| async move {
            c.pack_archive_inspect(upload_id).await
        })
        .await
}

#[tauri::command]
pub async fn server_pack_file_read(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: FileRead,
) -> Result<FileBody> {
    manager
        .management_read(&app, &connection_id, |c| async move {
            c.pack_file_read(request).await
        })
        .await
}
#[tauri::command]
pub async fn server_pack_file_mutate(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: FileMutation,
    intent_id: String,
) -> Result<PackDraft> {
    let payload = serde_json::to_value(&request).map_err(|_| invalid())?;
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "pack/files/mutate",
            payload,
            false,
            |c| async move { c.pack_file_mutate(request, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_pack_provider_publish(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: ProviderPackPublish,
    intent_id: String,
) -> Result<vesta_server_client::management::PackOutcome> {
    let payload = serde_json::to_value(&request).map_err(|_| invalid())?;
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "pack/provider/publish",
            payload,
            false,
            |c| async move { c.pack_provider_publish(request, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_pack_install_plan(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: PackInstallRequest,
) -> Result<PackInstallPlan> {
    manager
        .management_read(&app, &connection_id, |c| async move {
            c.pack_install_plan(request).await
        })
        .await
}
#[tauri::command]
pub async fn server_pack_install_apply(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: PackInstallApply,
    intent_id: String,
) -> Result<PackInstallOutcome> {
    let payload = serde_json::to_value(&request).map_err(|_| invalid())?;
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "pack/install/apply",
            payload,
            false,
            |c| async move { c.pack_install_apply(request, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_pack_history(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<Vec<PublishedRevision>> {
    manager
        .management_read(
            &app,
            &connection_id,
            |c| async move { c.pack_history().await },
        )
        .await
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedPackUpload {
    name: String,
    path: String,
    receipt: UploadReceipt,
}
#[tauri::command]
pub async fn server_pack_upload_dropped(
    app: AppHandle,
    window: tauri::WebviewWindow,
    manager: Manager<'_>,
    drops: State<'_, crate::servers::files::DroppedFiles>,
    connection_id: String,
    paths: Vec<String>,
    archive: bool,
) -> Result<Vec<DroppedPackUpload>> {
    use base64::Engine;
    use tokio::io::AsyncReadExt;
    let sources = drops.pack_sources(window.label(), paths, archive).await?;
    let mut result = Vec::new();
    for source in sources {
        let upload_id = uuid::Uuid::new_v4().to_string();
        let mut file = tokio::fs::File::from_std(source.file);
        let input = UploadBegin {
            upload_id: upload_id.clone(),
            total_size: source.size.to_string(),
            sha256: source.sha256,
            archive,
        };
        server_pack_upload_begin(
            app.clone(),
            manager.clone(),
            connection_id.clone(),
            input,
            format!("{upload_id}-begin"),
        )
        .await?;
        let mut offset = 0u64;
        let mut buffer = vec![0u8; 512 * 1024];
        loop {
            let count = file.read(&mut buffer).await.map_err(|_| invalid())?;
            if count == 0 {
                break;
            }
            if offset + count as u64 > source.size {
                return Err(invalid());
            }
            let chunk = &buffer[..count];
            server_pack_upload_chunk(
                app.clone(),
                manager.clone(),
                connection_id.clone(),
                UploadChunk {
                    upload_id: upload_id.clone(),
                    offset: offset.to_string(),
                    content_base64: base64::engine::general_purpose::STANDARD.encode(chunk),
                },
                format!("{upload_id}-{offset}"),
            )
            .await?;
            offset += count as u64;
        }
        if offset != source.size {
            return Err(invalid());
        }
        let receipt = server_pack_upload_finish(
            app.clone(),
            manager.clone(),
            connection_id.clone(),
            UploadId {
                upload_id: upload_id.clone(),
            },
            format!("{upload_id}-finish"),
        )
        .await?;
        result.push(DroppedPackUpload {
            name: source.name,
            path: source.path,
            receipt,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn server_client_pack_mode(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: ClientPackConfig,
    intent_id: String,
) -> Result<ClientPackConfig> {
    let payload = serde_json::to_value(&request).map_err(|_| invalid())?;
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "pack/client-mode",
            payload,
            false,
            |c| async move { c.client_pack_mode(request, &intent_id).await },
        )
        .await
}
#[tauri::command]
pub async fn server_modpack_unlink(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: ServerModpackUnlink,
    intent_id: String,
) -> Result<PackInstallOutcome> {
    let payload = serde_json::to_value(&request).map_err(|_| invalid())?;
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "pack/server-link/unlink",
            payload,
            false,
            |c| async move { c.server_modpack_unlink(request, &intent_id).await },
        )
        .await
}

#[tauri::command]
pub async fn server_modpack_update(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
) -> Result<ServerModpackUpdate> {
    manager
        .management_read(&app, &connection_id, |c| async move {
            c.server_modpack_update().await
        })
        .await
}
