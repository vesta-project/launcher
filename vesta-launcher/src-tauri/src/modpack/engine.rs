use std::path::{Path, PathBuf};

use crate::models::instance::Instance;
use crate::models::SourcePlatform;
use crate::resources::ResourceManager;
use crate::sync::action_tree::ActionTree;
use crate::sync::differ::ThreeWayDiffer;
use crate::sync::manifest;
use crate::sync::manifest_bootstrap::{self, TaskBootstrapProgress};
use crate::tasks::installers::modpack::enrich_manifest_platform_hashes;
use crate::tasks::manager::TaskContext;
use piston_lib::game::modpack::manifest::ModpackManifest;
use piston_lib::game::modpack::types::ModpackFormat;
use tauri::{Manager, State};

pub struct UpdatePlan {
    pub old_manifest: ModpackManifest,
    pub new_manifest: ModpackManifest,
    pub zip_path: PathBuf,
    pub format: ModpackFormat,
    pub actions: ActionTree,
}

pub async fn plan(
    app_handle: &tauri::AppHandle,
    instance: &Instance,
    game_dir: &Path,
    target_version_id: &str,
    ctx: &TaskContext,
) -> Result<UpdatePlan, String> {
    ctx.update_full(5, "Loading old manifest...".to_string(), Some(0), Some(6));
    let progress = TaskBootstrapProgress(ctx);
    let mut old_manifest =
        manifest_bootstrap::ensure_old_manifest(app_handle, instance, game_dir, Some(&progress))
            .await
            .map_err(|error| format!("Cannot update: no modpack manifest found. {}", error))?;
    manifest::backfill_manifest_hashes(&mut old_manifest, game_dir, instance.id)
        .map_err(|error| format!("Failed to backfill old manifest hashes: {}", error))?;

    ctx.update_full(
        10,
        "Fetching new modpack version...".to_string(),
        Some(0),
        Some(6),
    );
    let (new_manifest, zip_path) =
        fetch_target_manifest(app_handle, instance, target_version_id).await?;
    let format = new_manifest.source;

    ctx.update_full(
        15,
        "Scanning current files...".to_string(),
        Some(0),
        Some(6),
    );
    let current_hashes = manifest::hash_current_directory(game_dir, &old_manifest);

    ctx.update_full(
        20,
        "Computing update plan (three-way diff)...".to_string(),
        Some(0),
        Some(6),
    );
    let actions = ThreeWayDiffer::diff(&old_manifest, &current_hashes, &new_manifest);

    Ok(UpdatePlan {
        old_manifest,
        new_manifest,
        zip_path,
        format,
        actions,
    })
}

async fn fetch_target_manifest(
    app_handle: &tauri::AppHandle,
    instance: &Instance,
    target_version_id: &str,
) -> Result<(ModpackManifest, PathBuf), String> {
    let resource_manager: State<'_, ResourceManager> = app_handle.state();
    let platform = match instance.modpack_platform.as_deref() {
        Some("modrinth") => SourcePlatform::Modrinth,
        _ => SourcePlatform::CurseForge,
    };
    let project_id = instance
        .modpack_id
        .as_deref()
        .ok_or("Instance is not linked to a modpack")?;
    let version = resource_manager
        .get_version(platform, project_id, target_version_id)
        .await
        .map_err(|error| format!("Failed to fetch modpack version info: {}", error))?;

    let modpacks_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("modpacks");
    let _ = std::fs::create_dir_all(&modpacks_dir);
    let file_stem = format!("{}-{}", project_id, target_version_id).replace(
        |character: char| !character.is_ascii_alphanumeric() && character != '-',
        "_",
    );
    let zip_path = modpacks_dir.join(format!("{}.zip", file_stem));

    if !zip_path.exists() {
        let url = reqwest::Url::parse(&version.download_url)
            .map_err(|error| format!("Invalid download URL: {}", error))?;
        let response = piston_lib::client::shared_client()
            .get(url)
            .send()
            .await
            .map_err(|error| format!("Download failed: {}", error))?;
        if !response.status().is_success() {
            return Err(format!(
                "Failed to download modpack: HTTP {}",
                response.status()
            ));
        }
        let data = response
            .bytes()
            .await
            .map_err(|error| format!("Download read failed: {}", error))?;
        if !version.hash.is_empty() {
            let actual = crate::utils::hash::calculate_sha1_from_bytes(&data);
            if actual.to_lowercase() != version.hash.to_lowercase() {
                return Err(format!(
                    "Modpack ZIP hash mismatch: expected {}, got {}",
                    version.hash, actual
                ));
            }
        }
        std::fs::write(&zip_path, &data)
            .map_err(|error| format!("Failed to write modpack ZIP: {}", error))?;
    }

    let mut manifest = manifest::build_new_manifest(&zip_path, instance.modpack_id.clone())
        .map_err(|error| format!("Failed to parse new modpack manifest: {}", error))?;
    enrich_manifest_platform_hashes(app_handle, &mut manifest).await;
    Ok((manifest, zip_path))
}
