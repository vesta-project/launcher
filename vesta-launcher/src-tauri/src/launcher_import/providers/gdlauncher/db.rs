use std::path::Path;

use diesel::prelude::*;
use diesel::sql_query;
use diesel::sqlite::SqliteConnection;

use super::types::{GDHintRow, GDResourceHint};

pub fn extract_gdlauncher_resource_hints(
    launcher_root: &Path,
    instance_path: &Path,
) -> Vec<GDResourceHint> {
    let db_candidates = [
        launcher_root.join("gdl_conf.db"),
        launcher_root.join("data").join("gdl_conf.db"),
    ];
    let Some(db_path) = db_candidates.into_iter().find(|p| p.is_file()) else {
        return Vec::new();
    };
    let Ok(mut conn) = SqliteConnection::establish(db_path.to_string_lossy().as_ref()) else {
        return Vec::new();
    };

    let instance_key = instance_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();
    let instance_path_str = instance_path.to_string_lossy().to_string();

    let queries = vec![
        format!(
            "SELECT project_id AS project_id, file_id AS version_id, platform AS platform, file_name AS file_name \
             FROM installed_mods WHERE instance_id = '{}' OR instance_path = '{}'",
            escape_sql_string(&instance_key),
            escape_sql_string(&instance_path_str)
        ),
        format!(
            "SELECT project_id AS project_id, version_id AS version_id, source AS platform, path AS file_name \
             FROM instance_mods WHERE instance_id = '{}' OR instance_path = '{}'",
            escape_sql_string(&instance_key),
            escape_sql_string(&instance_path_str)
        ),
    ];

    let mut out = Vec::new();
    for q in queries {
        if let Ok(rows) = sql_query(q).load::<GDHintRow>(&mut conn) {
            for row in rows {
                let Some(project_id) = row.project_id.filter(|s| !s.trim().is_empty()) else {
                    continue;
                };
                let Some(version_id) = row.version_id.filter(|s| !s.trim().is_empty()) else {
                    continue;
                };
                let platform = row.platform.unwrap_or_default().to_ascii_lowercase();
                let platform = match platform.as_str() {
                    "curseforge" | "cf" => "curseforge",
                    "modrinth" | "mr" => "modrinth",
                    _ => continue,
                };
                let file_name = row.file_name.and_then(|raw| {
                    Path::new(&raw)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(|s| s.to_string())
                });
                out.push(GDResourceHint {
                    project_id,
                    version_id,
                    platform: platform.to_string(),
                    file_name,
                });
            }
            if !out.is_empty() {
                break;
            }
        }
    }
    out
}

fn escape_sql_string(input: &str) -> String {
    input.replace('\'', "''")
}
