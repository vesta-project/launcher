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

    let Ok(rows) = load_profiles(&mut connection) else {
        return out;
    };

    // The chosen root can itself be `profiles`; app.db identifies the data root.
    let data_root = db_path.parent().unwrap_or(base_path);
    let profile_root = data_root.join("profiles");
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
                let local = profile_path.join(&icon_candidate);
                if local.is_file() {
                    local
                } else {
                    data_root.join(icon_candidate)
                }
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
            minecraft_version: row.game_version,
            modloader: row.mod_loader,
            modloader_version: row.mod_loader_version,
            modpack_platform: Some("modrinth".to_string()),
            modpack_id: row.linked_project_id,
            modpack_version_id: row.linked_version_id,
            // Modrinth stores UNIX seconds; the import Interface uses milliseconds.
            last_played_at_unix_ms: row
                .last_played
                .filter(|value| *value > 0)
                .and_then(|value| value.checked_mul(1000)),
            ..Default::default()
        });
    }

    out
}

fn load_profiles(connection: &mut SqliteConnection) -> diesel::QueryResult<Vec<DbProfileRow>> {
    // Modrinth's newer content-set model replaces the old profiles table.
    let modern = sql_query(
        "SELECT i.path, i.name, i.icon_path, c.game_version, c.loader AS mod_loader,
         c.loader_version AS mod_loader_version, l.modrinth_project_id AS linked_project_id,
         l.modrinth_version_id AS linked_version_id, i.last_played
         FROM instances i
         LEFT JOIN instance_content_sets c ON c.id = i.applied_content_set_id
         LEFT JOIN instance_links l ON l.instance_id = i.id AND l.link_kind = 'modrinth_modpack'",
    )
    .load::<DbProfileRow>(connection);
    if modern.is_ok() {
        return modern;
    }

    let legacy = "SELECT path, name, icon_path, game_version, mod_loader, mod_loader_version,
                  linked_project_id, linked_version_id";
    sql_query(format!("{legacy}, last_played FROM profiles"))
        .load::<DbProfileRow>(connection)
        .or_else(|_| {
            sql_query(format!("{legacy}, NULL AS last_played FROM profiles"))
                .load::<DbProfileRow>(connection)
        })
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
    for rows in query_results.into_iter().flatten() {
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
    hints
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::connection::SimpleConnection;

    #[test]
    fn reads_content_sets_dates_and_cached_icons_from_nested_root() {
        let root = tempfile::tempdir().unwrap();
        let db = root.path().join("app.db");
        let mut connection = SqliteConnection::establish(db.to_str().unwrap()).unwrap();
        connection.batch_execute(
            "CREATE TABLE instances (id TEXT, path TEXT, name TEXT, icon_path TEXT,
               applied_content_set_id TEXT, last_played INTEGER);
             CREATE TABLE instance_content_sets (id TEXT, game_version TEXT, loader TEXT, loader_version TEXT);
             CREATE TABLE instance_links (instance_id TEXT, link_kind TEXT, modrinth_project_id TEXT, modrinth_version_id TEXT);
             INSERT INTO instances VALUES ('one','Pack','My pack','caches/icon.png','set',1776074628);
             INSERT INTO instances VALUES ('two','Vanilla','Vanilla',NULL,NULL,NULL);
             INSERT INTO instance_content_sets VALUES ('set','26.1.2','fabric','0.18.6');
             INSERT INTO instance_links VALUES ('one','modrinth_modpack','project','version');"
        ).unwrap();
        std::fs::create_dir_all(root.path().join("caches")).unwrap();
        std::fs::write(root.path().join("caches/icon.png"), b"icon").unwrap();
        let rows = read_instances_from_app_db(&root.path().join("profiles"), &db);
        assert_eq!(rows.len(), 2);
        let pack = rows.iter().find(|row| row.name == "My pack").unwrap();
        assert_eq!(pack.last_played_at_unix_ms, Some(1_776_074_628_000));
        assert_eq!(pack.minecraft_version.as_deref(), Some("26.1.2"));
        assert_eq!(pack.modloader.as_deref(), Some("fabric"));
        assert_eq!(pack.modpack_id.as_deref(), Some("project"));
        assert_eq!(
            pack.icon_path.as_deref(),
            Some("data:image/png;base64,aWNvbg==")
        );
        assert_eq!(
            Path::new(&pack.instance_path),
            root.path().join("profiles/Pack")
        );
        assert_eq!(
            rows.iter()
                .find(|row| row.name == "Vanilla")
                .unwrap()
                .last_played_at_unix_ms,
            None
        );
    }

    #[test]
    fn retains_legacy_profiles_without_last_played_column() {
        let root = tempfile::tempdir().unwrap();
        let db = root.path().join("app.db");
        let mut connection = SqliteConnection::establish(db.to_str().unwrap()).unwrap();
        connection.batch_execute(
            "CREATE TABLE profiles (path TEXT, name TEXT, icon_path TEXT, game_version TEXT,
             mod_loader TEXT, mod_loader_version TEXT, linked_project_id TEXT, linked_version_id TEXT);
             INSERT INTO profiles VALUES ('old','Old pack',NULL,'1.21','vanilla',NULL,NULL,NULL);"
        ).unwrap();
        let rows = read_instances_from_app_db(root.path(), &db);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].minecraft_version.as_deref(), Some("1.21"));
        assert_eq!(rows[0].last_played_at_unix_ms, None);
    }
}
