use std::path::{Path, PathBuf};

use diesel::prelude::*;
use diesel::sql_query;
use diesel::sqlite::SqliteConnection;

use crate::launcher_import::types::ExternalInstanceCandidate;

use super::helpers::encode_icon_as_data_url;
use super::types::{DbProfileRow, ModrinthHintRow, ModrinthResourceHint};

pub(super) fn find_app_db(base_path: &Path) -> Option<PathBuf> {
    let candidates = [
        base_path.join("app.db"),
        base_path.join("../app.db"),
        base_path.join("../../app.db"),
    ];

    candidates.into_iter().find(|candidate| candidate.exists())
}

pub(super) fn read_instances_from_app_db(
    base_path: &Path,
    db_path: &Path,
) -> Vec<ExternalInstanceCandidate> {
    let mut out = Vec::new();
    let Ok(mut connection) = SqliteConnection::establish(db_path.to_string_lossy().as_ref()) else {
        return out;
    };

    let query = sql_query(
        "SELECT path, name, icon_path, game_version, mod_loader, mod_loader_version, linked_project_id, linked_version_id FROM profiles",
    );
    let Ok(rows) = query.load::<DbProfileRow>(&mut connection) else {
        return out;
    };

    let profile_root = base_path.join("profiles");
    for row in rows {
        let profile_path = {
            let candidate = PathBuf::from(&row.path);
            if candidate.is_absolute() {
                candidate
            } else {
                profile_root.join(candidate)
            }
        };

        let game_dir = if profile_path.join(".minecraft").is_dir() {
            profile_path.join(".minecraft")
        } else if profile_path.join("minecraft").is_dir() {
            profile_path.join("minecraft")
        } else {
            profile_path.clone()
        };

        let resolved_icon = row.icon_path.as_ref().map(|icon| {
            let icon_candidate = PathBuf::from(icon);
            if icon_candidate.is_absolute() {
                icon_candidate.to_string_lossy().to_string()
            } else {
                profile_path
                    .join(icon_candidate)
                    .to_string_lossy()
                    .to_string()
            }
        });
        let encoded_icon = resolved_icon
            .as_deref()
            .and_then(|icon_path| encode_icon_as_data_url(Path::new(icon_path)));

        out.push(ExternalInstanceCandidate {
            id: row.path.clone(),
            name: row.name,
            instance_path: profile_path.to_string_lossy().to_string(),
            game_directory: game_dir.to_string_lossy().to_string(),
            icon_path: encoded_icon,
            minecraft_version: Some(row.game_version),
            modloader: Some(row.mod_loader),
            modloader_version: row.mod_loader_version,
            modpack_platform: Some("modrinth".to_string()),
            modpack_id: row.linked_project_id,
            modpack_version_id: row.linked_version_id,
            ..Default::default()
        });
    }

    out
}

pub fn extract_modrinth_resource_hints(
    launcher_root: &Path,
    instance_path: &Path,
) -> Vec<ModrinthResourceHint> {
    let Some(db_path) = find_app_db(launcher_root) else {
        return Vec::new();
    };
    let Ok(mut connection) = SqliteConnection::establish(db_path.to_string_lossy().as_ref()) else {
        return Vec::new();
    };

    let profile_path = instance_path.to_string_lossy().to_string();
    let profile_id = instance_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();

    let query_results = vec![
        sql_query("SELECT project_id AS project_id, version_id AS version_id, file_name AS file_name FROM profile_files WHERE profile_path = ? OR profile_id = ?")
            .bind::<diesel::sql_types::Text, _>(profile_path.clone())
            .bind::<diesel::sql_types::Text, _>(profile_id.clone())
            .load::<ModrinthHintRow>(&mut connection),
        sql_query("SELECT modrinth_project_id AS project_id, modrinth_version_id AS version_id, file_name AS file_name FROM profile_files WHERE profile_path = ? OR profile_id = ?")
            .bind::<diesel::sql_types::Text, _>(profile_path.clone())
            .bind::<diesel::sql_types::Text, _>(profile_id.clone())
            .load::<ModrinthHintRow>(&mut connection),
        sql_query("SELECT project_id AS project_id, version_id AS version_id, path AS file_name FROM installed WHERE profile_path = ? OR profile_id = ?")
            .bind::<diesel::sql_types::Text, _>(profile_path.clone())
            .bind::<diesel::sql_types::Text, _>(profile_id.clone())
            .load::<ModrinthHintRow>(&mut connection),
    ];

    let mut hints = Vec::new();
    for result in query_results {
        if let Ok(rows) = result {
            for row in rows {
                let Some(project_id) = row.project_id.filter(|s| !s.trim().is_empty()) else {
                    continue;
                };
                let Some(version_id) = row.version_id.filter(|s| !s.trim().is_empty()) else {
                    continue;
                };
                let file_name = row.file_name.and_then(|raw| {
                    Path::new(&raw)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(|s| s.to_string())
                });
                hints.push(ModrinthResourceHint {
                    project_id,
                    version_id,
                    file_name,
                });
            }
            if !hints.is_empty() {
                break;
            }
        }
    }
    hints
}
