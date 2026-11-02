//! Optional Modrinth listing association; provider pack identity remains on Instance.
use crate::models::{
    instance::Instance,
    resource::{ServerContent, ServerListing},
    SourcePlatform,
};
use crate::resources::ResourceManager;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstanceServerLink {
    pub platform: SourcePlatform,
    pub project_id: String,
    pub address: String,
}
#[derive(Debug, Serialize)]
pub struct InstanceServerStatus {
    pub server: InstanceServerLink,
    pub listing: ServerListing,
    pub update_available: bool,
    pub update_required: bool,
}
#[derive(QueryableByName)]
struct LinkRow {
    #[diesel(sql_type = diesel::sql_types::Text)]
    project_id: String,
    #[diesel(sql_type = diesel::sql_types::Text)]
    address: String,
}
pub fn load_link(instance_id: i32) -> Result<Option<InstanceServerLink>, String> {
    let mut conn = crate::utils::db::get_vesta_conn().map_err(|e| e.to_string())?;
    let row = diesel::sql_query(
        "SELECT project_id, address FROM instance_server_link WHERE instance_id = ?",
    )
    .bind::<diesel::sql_types::Integer, _>(instance_id)
    .get_result::<LinkRow>(&mut conn)
    .optional()
    .map_err(|e| e.to_string())?;
    Ok(row.map(|r| InstanceServerLink {
        platform: SourcePlatform::Modrinth,
        project_id: r.project_id,
        address: r.address,
    }))
}
fn save_link(instance_id: i32, project_id: &str, address: &str) -> Result<(), String> {
    let mut conn = crate::utils::db::get_vesta_conn().map_err(|e| e.to_string())?;
    diesel::sql_query("INSERT INTO instance_server_link(instance_id, project_id, address) VALUES (?, ?, ?) ON CONFLICT(instance_id) DO UPDATE SET project_id=excluded.project_id, address=excluded.address")
        .bind::<diesel::sql_types::Integer,_>(instance_id).bind::<diesel::sql_types::Text,_>(project_id).bind::<diesel::sql_types::Text,_>(address)
        .execute(&mut conn).map_err(|e| e.to_string())?;
    Ok(())
}
pub async fn listing(
    app: &tauri::AppHandle,
    project_id: &str,
) -> Result<(String, String, ServerListing), String> {
    let project = app
        .state::<ResourceManager>()
        .get_project(SourcePlatform::Modrinth, project_id)
        .await
        .map_err(|e| e.to_string())?;
    let server = project
        .server
        .ok_or("Project is not a supported Minecraft server listing")?;
    piston_lib::game::launcher::targets::parse_server_address(&server.address)
        .map_err(|e| e.to_string())?;
    Ok((project.id, project.name, server))
}
fn validate_link(inst: &Instance, listing: &ServerListing) -> Result<(), String> {
    if inst.modpack_platform.as_deref() == Some("server") {
        return Err("Detach the signed Vesta pack before linking another server".into());
    }
    match &listing.content {
        ServerContent::Modpack { project_id, .. } => {
            if inst.modpack_platform.as_deref() != Some("modrinth")
                || inst.modpack_id.as_ref() != Some(project_id)
            {
                return Err("Instance must use the listing's Modrinth modpack project".into());
            }
        }
        ServerContent::Vanilla { game_versions, .. } => {
            if inst.modpack_id.is_some()
                || !matches!(inst.modloader.as_deref(), None | Some("vanilla"))
                || !game_versions.contains(&inst.minecraft_version)
            {
                return Err(
                    "Instance must be vanilla and use a supported Minecraft version".into(),
                );
            }
        }
    }
    Ok(())
}
fn update_state(inst: &Instance, listing: &ServerListing) -> (bool, bool) {
    match &listing.content {
        ServerContent::Modpack {
            project_id,
            version_id,
            ..
        } => {
            let required = inst.modpack_platform.as_deref() != Some("modrinth")
                || inst.modpack_id.as_ref() != Some(project_id)
                || inst.modpack_version_id.as_ref() != Some(version_id);
            // A different pack project requires a new instance, not an in-place update.
            (
                required
                    && inst.modpack_platform.as_deref() == Some("modrinth")
                    && inst.modpack_id.as_ref() == Some(project_id),
                required,
            )
        }
        ServerContent::Vanilla { game_versions, .. } => {
            (false, !game_versions.contains(&inst.minecraft_version))
        }
    }
}
#[tauri::command]
pub async fn instance_server_status(
    app_handle: tauri::AppHandle,
    instance_id: i32,
) -> Result<Option<InstanceServerStatus>, String> {
    let inst = super::instances::get_instance(instance_id)?;
    let Some(mut server) = load_link(instance_id)? else {
        return Ok(None);
    };
    let (_, _, listing) = listing(&app_handle, &server.project_id).await?;
    server.address = listing.address.clone();
    let (update_available, update_required) = update_state(&inst, &listing);
    Ok(Some(InstanceServerStatus {
        server,
        listing,
        update_available,
        update_required,
    }))
}
#[tauri::command]
pub async fn link_instance_to_server(
    app_handle: tauri::AppHandle,
    instance_id: i32,
    project_id: String,
) -> Result<(), String> {
    let (project_id, _, listing) = listing(&app_handle, &project_id).await?;
    let tasks = app_handle.state::<crate::tasks::manager::TaskManager>();
    let _guard = tasks
        .acquire_conflicts([crate::tasks::manager::instance_play_conflict_key(
            instance_id,
        )])
        .await;
    let inst = super::instances::get_instance(instance_id)?;
    validate_link(&inst, &listing)?;
    // Signed bindings remain authoritative even if provider metadata was tampered with.
    if app_handle
        .state::<std::sync::Arc<crate::servers::ServerManager>>()
        .pack_link(instance_id)
        .await
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Err("Instance already has a signed Vesta pack binding".into());
    }
    save_link(instance_id, &project_id, &listing.address)?;
    let _ = app_handle.emit("core://instance-updated", inst);
    Ok(())
}
#[tauri::command]
pub async fn unlink_instance_server(
    app_handle: tauri::AppHandle,
    instance_id: i32,
) -> Result<(), String> {
    let tasks = app_handle.state::<crate::tasks::manager::TaskManager>();
    let _guard = tasks
        .acquire_conflicts([crate::tasks::manager::instance_play_conflict_key(
            instance_id,
        )])
        .await;
    let inst = super::instances::get_instance(instance_id)?;
    let mut conn = crate::utils::db::get_vesta_conn().map_err(|e| e.to_string())?;
    diesel::sql_query("DELETE FROM instance_server_link WHERE instance_id = ?")
        .bind::<diesel::sql_types::Integer, _>(instance_id)
        .execute(&mut conn)
        .map_err(|e| e.to_string())?;
    let _ = app_handle.emit("core://instance-updated", inst);
    Ok(())
}
#[tauri::command]
pub async fn install_server_pack(
    app_handle: tauri::AppHandle,
    project_id: String,
) -> Result<i32, String> {
    let (project_id, name, listing) = listing(&app_handle, &project_id).await?;
    let mut inst = Instance {
        name,
        ..Default::default()
    };
    let instance_id = match &listing.content {
        ServerContent::Modpack {
            project_id: pack_id,
            version_id,
            project_icon,
            ..
        } => {
            let version = app_handle
                .state::<ResourceManager>()
                .get_version(SourcePlatform::Modrinth, pack_id, version_id)
                .await
                .map_err(|e| e.to_string())?;
            if version.project_id != *pack_id || !version.file_name.ends_with(".mrpack") {
                return Err("Listing does not reference a Modrinth pack archive".into());
            }
            inst.minecraft_version = version
                .game_versions
                .first()
                .ok_or("Pack version has no Minecraft version")?
                .clone();
            inst.modpack_platform = Some("modrinth".into());
            inst.modpack_id = Some(pack_id.clone());
            inst.modpack_version_id = Some(version_id.clone());
            inst.modpack_icon_url = project_icon.clone();
            super::modpacks::install_modpack_from_url(
                app_handle.clone(),
                version.download_url,
                inst,
                None,
                app_handle.state(),
            )
            .await?
        }
        ServerContent::Vanilla {
            recommended_version,
            game_versions,
        } => {
            inst.minecraft_version = recommended_version
                .as_ref()
                .filter(|v| game_versions.contains(v))
                .ok_or("Server has no supported recommended Minecraft version")?
                .clone();
            super::instances::create_instance(app_handle.clone(), inst, app_handle.state()).await?
        }
    };
    // The asynchronous installer retains its normal task/recovery behavior.
    save_link(instance_id, &project_id, &listing.address)?;
    if matches!(listing.content, ServerContent::Vanilla { .. }) {
        super::instances::install_instance(
            app_handle.clone(),
            app_handle.state(),
            super::instances::get_instance(instance_id)?,
            None,
        )
        .await?;
    }
    let _ = app_handle.emit(
        "core://instance-updated",
        super::instances::get_instance(instance_id)?,
    );
    Ok(instance_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pack() -> ServerListing {
        ServerListing {
            address: "play.example.org".into(),
            content: ServerContent::Modpack {
                project_id: "pack".into(),
                version_id: "pinned".into(),
                project_name: None,
                project_icon: None,
            },
            ping: None,
            region: None,
            languages: vec![],
            plays2w: None,
        }
    }
    fn instance() -> Instance {
        Instance {
            modpack_platform: Some("modrinth".into()),
            modpack_id: Some("pack".into()),
            modpack_version_id: Some("pinned".into()),
            ..Default::default()
        }
    }
    #[test]
    fn listing_pin_controls_update_and_required_state() {
        let mut inst = instance();
        let mut listing = pack();
        assert_eq!(update_state(&inst, &listing), (false, false));
        inst.modpack_version_id = Some("old".into());
        assert_eq!(update_state(&inst, &listing), (true, true));
        // A changed listing project cannot be offered as an in-place version update.
        if let ServerContent::Modpack { project_id, .. } = &mut listing.content {
            *project_id = "replacement".into();
        }
        assert_eq!(update_state(&inst, &listing), (false, true));
        assert!(validate_link(&inst, &listing).is_err());
    }
    #[test]
    fn linking_accepts_same_project_but_never_signed_or_other_provider() {
        let mut inst = instance();
        inst.modpack_version_id = Some("old".into());
        assert!(validate_link(&inst, &pack()).is_ok());
        for platform in ["curseforge", "server"] {
            inst.modpack_platform = Some(platform.into());
            assert!(validate_link(&inst, &pack()).is_err());
        }
    }
    #[test]
    fn vanilla_requires_supported_version_and_no_pack_or_loader() {
        let listing = ServerListing {
            content: ServerContent::Vanilla {
                game_versions: vec!["1.21.1".into()],
                recommended_version: Some("1.21.1".into()),
            },
            ..pack()
        };
        let mut inst = Instance::default();
        assert!(validate_link(&inst, &listing).is_ok());
        assert_eq!(update_state(&inst, &listing), (false, false));
        inst.minecraft_version = "1.20.1".into();
        assert!(validate_link(&inst, &listing).is_err());
        assert_eq!(update_state(&inst, &listing), (false, true));
        inst.minecraft_version = "1.21.1".into();
        inst.modloader = Some("fabric".into());
        assert!(validate_link(&inst, &listing).is_err());
        assert!(validate_link(&instance(), &listing).is_err());
    }
    #[test]
    fn link_migration_preserves_provider_columns_and_cascades_only_link() {
        use diesel::connection::SimpleConnection;
        let mut conn = diesel::sqlite::SqliteConnection::establish(":memory:").unwrap();
        conn.batch_execute("PRAGMA foreign_keys=ON; CREATE TABLE instance(id INTEGER PRIMARY KEY, modpack_id TEXT); INSERT INTO instance VALUES(1, 'pack');").unwrap();
        conn.batch_execute(include_str!(
            "../../migrations/vesta/2026-11-02-000000_instance_server_link/up.sql"
        ))
        .unwrap();
        conn.batch_execute("INSERT INTO instance_server_link VALUES(1, 'listing', 'example.org');")
            .unwrap();
        assert!(diesel::sql_query(
            "INSERT INTO instance_server_link VALUES(999, 'listing', 'example.org')"
        )
        .execute(&mut conn)
        .is_err());
        conn.batch_execute("DELETE FROM instance WHERE id=1;")
            .unwrap();
        assert!(
            diesel::sql_query("SELECT project_id, address FROM instance_server_link")
                .load::<LinkRow>(&mut conn)
                .unwrap()
                .is_empty()
        );
        conn.batch_execute(include_str!(
            "../../migrations/vesta/2026-11-02-000000_instance_server_link/down.sql"
        ))
        .unwrap();
        conn.batch_execute("INSERT INTO instance VALUES(2, 'unchanged');")
            .unwrap();
    }
}
