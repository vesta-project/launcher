//! Server content IPC shares management request journaling and invalidation.
use crate::servers::ServerManager;
use serde_json::json;
use std::sync::Arc;
use tauri::{AppHandle, State};
use vesta_server_client::{
    content::*,
    hosting::{CustomJarPlan, SoftwareJob},
    Result,
};
type Manager<'a> = State<'a, Arc<ServerManager>>;
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerDependency {
    project: crate::models::resource::ResourceProject,
    version: crate::models::resource::ResourceVersion,
    required: bool,
    installed: bool,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerDependencyPreview {
    target: ContentInventory,
    project: crate::models::resource::ResourceProject,
    version: crate::models::resource::ResourceVersion,
    dependencies: Vec<ServerDependency>,
    warnings: Vec<String>,
}
#[tauri::command]
pub async fn server_content_dependencies(
    app: AppHandle,
    manager: Manager<'_>,
    resource_manager: State<'_, crate::resources::ResourceManager>,
    connection_id: String,
    provider: String,
    project_id: String,
    version_id: String,
) -> anyhow_tauri::TAResult<ServerDependencyPreview> {
    use crate::models::resource::{DependencyType, ResourceType, SourcePlatform};
    use crate::resources::manager::is_loader_compatible;
    let platform = SourcePlatform::from_str_id(&provider)
        .filter(|p| *p != SourcePlatform::Smithed)
        .ok_or_else(|| {
            anyhow::anyhow!("Server content requires Modrinth or CurseForge identifiers")
        })?;
    let inventory = manager
        .management_read(&app, &connection_id, |client| async move {
            client.content_inventory().await
        })
        .await
        .map_err(|e| anyhow::anyhow!("{}", e))?;
    if !inventory.capabilities.install {
        return Err(anyhow::anyhow!("content.install capability required").into());
    }
    let mut project = resource_manager.get_project(platform, &project_id).await?;
    let version = resource_manager
        .get_version(platform, &project_id, &version_id)
        .await?;
    if version
        .loaders
        .iter()
        .any(|l| l.eq_ignore_ascii_case("datapack"))
    {
        project.resource_type = ResourceType::DataPack;
    }
    let loader = inventory.software.as_deref().unwrap_or("vanilla");
    let kind = project.resource_type;
    if !matches!(
        kind,
        ResourceType::Mod | ResourceType::Plugin | ResourceType::DataPack
    ) || (kind == ResourceType::Mod && !inventory.capabilities.mods_supported)
        || (kind == ResourceType::Plugin && !inventory.capabilities.plugins_supported)
    {
        return Err(anyhow::anyhow!("Resource kind is incompatible with server software").into());
    }
    let compatible = |resource: &crate::models::resource::ResourceProject,
                      release: &crate::models::resource::ResourceVersion| {
        release.game_versions.contains(&inventory.minecraft_version)
            && match resource.resource_type {
                ResourceType::DataPack => {
                    release.loaders.iter().any(|l| l == "datapack")
                        || platform == SourcePlatform::CurseForge
                }
                ResourceType::Mod | ResourceType::Plugin => {
                    is_loader_compatible(&release.loaders, loader)
                        || (resource.resource_type == ResourceType::Plugin
                            && platform == SourcePlatform::CurseForge
                            && release.loaders.is_empty()
                            && loader != "folia")
                }
                _ => false,
            }
    };
    if !compatible(&project, &version)
        || project.environment.is_some_and(|e| {
            e.server_requirement == Some(crate::models::resource::SideRequirement::Unsupported)
        })
    {
        return Err(anyhow::anyhow!("Version does not support this server target").into());
    }
    let resolved = resource_manager
        .resolve_dependency_preview(
            platform,
            kind,
            &version,
            &inventory.minecraft_version,
            &inventory.minecraft_version,
            loader,
            false,
            true,
        )
        .await?;
    let mut dependencies = Vec::new();
    let mut warnings = Vec::new();
    for (project, version, dependency_type) in resolved {
        let required = dependency_type == DependencyType::Required;
        if !compatible(&project, &version)
            || project.environment.is_some_and(|e| {
                e.server_requirement == Some(crate::models::resource::SideRequirement::Unsupported)
            })
        {
            if required {
                return Err(anyhow::anyhow!(
                    "Required dependency {} is incompatible with the server",
                    project.name
                )
                .into());
            }
            warnings.push(format!(
                "Optional dependency {} is incompatible with the server",
                project.name
            ));
            continue;
        }
        let installed = inventory.items.iter().any(|item| {
            item.enabled == Some(true)
                && item.sha256.is_some()
                && !matches!(item.pending.as_deref(), Some("remove" | "disable" | "install"))
                && item.provider.as_ref().is_some_and(|p| {
                    p.provider == provider
                        && p.project_id == project.id
                        && p.version_id == version.id
                })
        });
        dependencies.push(ServerDependency {
            project,
            version,
            required,
            installed,
        });
    }
    Ok(ServerDependencyPreview {
        target: inventory,
        project,
        version,
        dependencies,
        warnings,
    })
}
#[tauri::command]
pub async fn server_content(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    summary: Option<bool>,
) -> Result<ContentInventory> {
    manager
        .management_read(&app, &connection_id, |client| async move {
            client.content_inventory_view(summary.unwrap_or(false)).await
        })
        .await
}
#[tauri::command]
pub async fn server_content_install(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: ContentInstall,
    intent_id: String,
) -> Result<ContentChange> {
    let payload = serde_json::to_value(&request).map_err(|_| {
        vesta_server_client::Error::new(vesta_server_client::ErrorCode::InvalidInput)
    })?;
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "content/install",
            payload,
            false,
            |client| async move { client.content_install(request, &intent_id).await },
        )
        .await
}
#[tauri::command]
pub async fn server_content_mutate(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    request: ContentMutation,
    intent_id: String,
) -> Result<ContentChange> {
    let payload = serde_json::to_value(&request).map_err(|_| {
        vesta_server_client::Error::new(vesta_server_client::ErrorCode::InvalidInput)
    })?;
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "content/mutate",
            payload,
            false,
            |client| async move { client.content_mutate(request, &intent_id).await },
        )
        .await
}
#[tauri::command]
pub async fn server_content_cancel(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    id: String,
    intent_id: String,
) -> Result<ContentChange> {
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "content/cancel",
            json!({"id":id}),
            false,
            |client| async move { client.content_cancel(id, &intent_id).await },
        )
        .await
}
#[tauri::command]
pub async fn server_content_identify(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    path: String,
    intent_id: String,
) -> Result<Option<ContentProvider>> {
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "content/identify",
            json!({"path":path}),
            false,
            |client| async move { client.content_identify(path, &intent_id).await },
        )
        .await
}
#[tauri::command]
pub async fn server_custom_jar_plan(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    path: Option<String>,
    expected_revision: String,
) -> Result<CustomJarPlan> {
    manager
        .management_read(&app, &connection_id, |client| async move {
            client.custom_jar_plan(path, expected_revision).await
        })
        .await
}
#[tauri::command]
pub async fn server_custom_jar_apply(
    app: AppHandle,
    manager: Manager<'_>,
    connection_id: String,
    plan_id: String,
    intent_id: String,
) -> Result<SoftwareJob> {
    let key = intent_id.clone();
    manager
        .management_write(
            &app,
            &connection_id,
            &key,
            "software/custom-jar/apply",
            json!({"planId":plan_id}),
            false,
            |client| async move { client.custom_jar_apply(plan_id, &intent_id).await },
        )
        .await
}
