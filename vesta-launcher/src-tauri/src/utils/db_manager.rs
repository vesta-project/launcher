//! Database Manager
//!
//! Helper functions for database paths.
//! Legacy database initialization has been replaced by Diesel `utils::db`.

use anyhow::Result;
use directories::BaseDirs;
use diesel::prelude::*;
use diesel::sql_query;
use std::io::ErrorKind;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

fn app_config_folder_name() -> &'static str {
    if cfg!(target_os = "windows") {
        ".VestaLauncher"
    } else {
        "VestaLauncher"
    }
}

const CONFIG_ARTIFACTS: &[&str] = &[
    "app_config.db",
    "app_config.db-wal",
    "app_config.db-shm",
    "vesta.db",
    "vesta.db-wal",
    "vesta.db-shm",
];

fn migrate_config_artifacts_only(legacy_dir: &Path, config_dir: &Path) -> Result<()> {
    if !config_dir.exists() {
        std::fs::create_dir_all(config_dir)?;
    }

    for artifact in CONFIG_ARTIFACTS {
        let src_path = legacy_dir.join(artifact);
        if !src_path.exists() {
            continue;
        }
        let dst_path = config_dir.join(artifact);
        if dst_path.exists() {
            continue;
        }

        std::fs::rename(&src_path, &dst_path).map_err(|err| {
            anyhow::anyhow!(
                "Failed to migrate config artifact from '{}' to '{}': {}",
                src_path.display(),
                dst_path.display(),
                err
            )
        })?;
    }

    match std::fs::remove_dir(legacy_dir) {
        Ok(()) => {
            log::info!(
                "Removed legacy app data directory after config migration: '{}'",
                legacy_dir.display()
            );
        }
        Err(err) if err.kind() == ErrorKind::DirectoryNotEmpty => {
            // Expected if legacy dir still contains instance/data folders.
            log::info!(
                "Keeping legacy app data directory with non-config entries: '{}'",
                legacy_dir.display()
            );
        }
        Err(err) => {
            log::warn!(
                "Failed to remove legacy app data directory '{}': {}",
                legacy_dir.display(),
                err
            );
        }
    }

    Ok(())
}

#[derive(QueryableByName)]
struct SinglePathRow {
    #[diesel(sql_type = diesel::sql_types::Nullable<diesel::sql_types::Text>)]
    path: Option<String>,
}

#[derive(QueryableByName)]
struct ResourcePathRow {
    #[diesel(sql_type = diesel::sql_types::Text)]
    path: String,
}

fn top_level_entry_under(base: &Path, p: &Path) -> Option<PathBuf> {
    let rel = p.strip_prefix(base).ok()?;
    let first = rel.components().next()?;
    Some(base.join(first.as_os_str()))
}

fn collect_db_owned_legacy_entries(legacy_dir: &Path, config_dir: &Path) -> Result<HashSet<PathBuf>> {
    let mut preserved = HashSet::new();

    let vesta_db = config_dir.join("vesta.db");
    if vesta_db.exists() {
        let db_url = vesta_db.to_string_lossy().to_string();
        let mut conn = diesel::sqlite::SqliteConnection::establish(&db_url)?;

        let instance_paths = sql_query("SELECT game_directory AS path FROM instance")
            .load::<SinglePathRow>(&mut conn)
            .unwrap_or_default();
        for row in instance_paths {
            if let Some(p) = row.path {
                if let Some(top) = top_level_entry_under(legacy_dir, Path::new(&p)) {
                    preserved.insert(top);
                }
            }
        }

        let resource_paths = sql_query("SELECT local_path AS path FROM installed_resource")
            .load::<ResourcePathRow>(&mut conn)
            .unwrap_or_default();
        for row in resource_paths {
            let p = Path::new(&row.path);
            if let Some(parent) = p.parent() {
                if let Some(top) = top_level_entry_under(legacy_dir, parent) {
                    preserved.insert(top);
                }
            }
        }
    }

    let config_db = config_dir.join("app_config.db");
    if config_db.exists() {
        let db_url = config_db.to_string_lossy().to_string();
        let mut conn = diesel::sqlite::SqliteConnection::establish(&db_url)?;

        let default_dirs = sql_query("SELECT default_game_dir AS path FROM app_config WHERE id = 1")
            .load::<SinglePathRow>(&mut conn)
            .unwrap_or_default();
        for row in default_dirs {
            if let Some(p) = row.path {
                if let Some(top) = top_level_entry_under(legacy_dir, Path::new(&p)) {
                    preserved.insert(top);
                }
            }
        }
    }

    Ok(preserved)
}

fn move_non_db_owned_entries(legacy_dir: &Path, config_dir: &Path) -> Result<()> {
    let preserved_entries = collect_db_owned_legacy_entries(legacy_dir, config_dir)?;
    for entry in std::fs::read_dir(legacy_dir)? {
        let entry = entry?;
        let src_path = entry.path();
        let file_name = entry.file_name();
        let file_name_str = file_name.to_string_lossy();
        let dst_path = config_dir.join(&file_name);

        if CONFIG_ARTIFACTS.iter().any(|a| *a == file_name_str.as_ref()) {
            continue;
        }
        if preserved_entries.contains(&src_path) {
            continue;
        }
        if dst_path.exists() {
            continue;
        }

        std::fs::rename(&src_path, &dst_path).map_err(|err| {
            anyhow::anyhow!(
                "Failed to move legacy entry from '{}' to '{}': {}",
                src_path.display(),
                dst_path.display(),
                err
            )
        })?;
    }

    Ok(())
}

fn migrate_legacy_non_windows_config_dir(base_config_dir: &Path, config_dir: &Path) -> Result<()> {
    if cfg!(target_os = "windows") {
        return Ok(());
    }

    for legacy_dir in legacy_config_dir_candidates(base_config_dir) {
        if !legacy_dir.exists() {
            continue;
        }

        migrate_config_artifacts_only(&legacy_dir, config_dir)?;
        move_non_db_owned_entries(&legacy_dir, config_dir)?;
    }

    Ok(())
}

fn legacy_config_dir_candidates(base_config_dir: &Path) -> Vec<PathBuf> {
    vec![
        base_config_dir.join(".VestaLauncher"),
        base_config_dir.join(".vestalauncher"),
    ]
}

/// Get the application's config directory.
/// - Windows: `%APPDATA%/.VestaLauncher`
/// - macOS: `~/Library/Application Support/VestaLauncher`
/// - Linux: `~/.config/VestaLauncher`
///
/// On non-Windows platforms, this migrates the legacy `.VestaLauncher` folder
/// to `VestaLauncher` when needed.
pub fn get_app_config_dir() -> Result<PathBuf> {
    let base_dirs = BaseDirs::new()
        .ok_or_else(|| anyhow::anyhow!("Failed to determine user's config directory"))?;

    let base_config_dir = base_dirs.config_dir();
    let config_dir = base_config_dir.join(app_config_folder_name());

    migrate_legacy_non_windows_config_dir(base_config_dir, &config_dir)?;

    if !config_dir.exists() {
        std::fs::create_dir_all(&config_dir)?;
    }

    Ok(config_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(label: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is before unix epoch")
            .as_nanos();

        std::env::temp_dir().join(format!(
            "vesta-db-manager-{}-{}-{}",
            label,
            std::process::id(),
            timestamp
        ))
    }

    #[test]
    fn migrate_config_artifacts_only_moves_db_files() {
        let root = unique_temp_dir("moves");
        let legacy_dir = root.join(".VestaLauncher");
        let target_dir = root.join("VestaLauncher");

        fs::create_dir_all(&legacy_dir).expect("create legacy dir");
        fs::write(legacy_dir.join("app_config.db"), b"legacy-config").expect("write legacy db");
        fs::write(legacy_dir.join("vesta.db"), b"legacy-vesta").expect("write legacy vesta db");

        migrate_config_artifacts_only(&legacy_dir, &target_dir).expect("migrate config artifacts");

        assert!(target_dir.join("app_config.db").exists());
        assert!(target_dir.join("vesta.db").exists());
        assert!(!legacy_dir.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn migrate_config_artifacts_only_does_not_move_instance_data_folder() {
        let root = unique_temp_dir("preserve-data");
        let legacy_dir = root.join(".VestaLauncher");
        let target_dir = root.join("VestaLauncher");

        fs::create_dir_all(legacy_dir.join("instances").join("my-pack").join("mods"))
            .expect("create legacy instance dir");
        fs::write(legacy_dir.join("app_config.db"), b"legacy-config").expect("write legacy db");

        migrate_config_artifacts_only(&legacy_dir, &target_dir).expect("migrate config artifacts");

        assert!(target_dir.join("app_config.db").exists());
        assert!(legacy_dir.join("instances").join("my-pack").join("mods").exists());
        assert!(legacy_dir.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn migrate_config_artifacts_only_does_not_overwrite_existing_files() {
        let root = unique_temp_dir("preserve");
        let legacy_dir = root.join(".VestaLauncher");
        let target_dir = root.join("VestaLauncher");

        fs::create_dir_all(&legacy_dir).expect("create legacy dir");
        fs::create_dir_all(&target_dir).expect("create target dir");
        fs::write(legacy_dir.join("app_config.db"), b"legacy-config").expect("write legacy db");
        fs::write(target_dir.join("app_config.db"), b"target-config").expect("write target db");

        migrate_config_artifacts_only(&legacy_dir, &target_dir).expect("migrate config artifacts");

        let contents = fs::read(target_dir.join("app_config.db")).expect("read target db");
        assert_eq!(contents, b"target-config");
        assert!(legacy_dir.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn move_non_db_owned_entries_moves_data_but_preserves_instances_when_db_points_to_it() {
        let root = unique_temp_dir("preserve-known-paths");
        let legacy_dir = root.join(".VestaLauncher");
        let target_dir = root.join("VestaLauncher");

        fs::create_dir_all(legacy_dir.join("instances").join("my-pack").join("mods"))
            .expect("create legacy instance dir");
        fs::create_dir_all(legacy_dir.join("data")).expect("create legacy data dir");
        fs::write(legacy_dir.join("app_config.db"), b"cfg").expect("write config db placeholder");
        fs::write(legacy_dir.join("vesta.db"), b"vesta").expect("write vesta db placeholder");

        migrate_config_artifacts_only(&legacy_dir, &target_dir).expect("migrate config artifacts");

        let vesta_db = target_dir.join("vesta.db");
        let mut vesta_conn =
            diesel::sqlite::SqliteConnection::establish(vesta_db.to_string_lossy().as_ref())
                .expect("open vesta db");
        use diesel::connection::SimpleConnection;
        vesta_conn
            .batch_execute(
                r#"
                DROP TABLE IF EXISTS instance;
                CREATE TABLE instance (id INTEGER PRIMARY KEY, game_directory TEXT);
                DROP TABLE IF EXISTS installed_resource;
                CREATE TABLE installed_resource (id INTEGER PRIMARY KEY, local_path TEXT);
                INSERT INTO instance (id, game_directory) VALUES (1, NULL);
                "#,
            )
            .expect("create vesta schema");
        sql_query("UPDATE instance SET game_directory = ? WHERE id = 1")
            .bind::<diesel::sql_types::Text, _>(
                legacy_dir
                    .join("instances")
                    .join("my-pack")
                    .to_string_lossy()
                    .to_string(),
            )
            .execute(&mut vesta_conn)
            .expect("seed instance path");

        let config_db = target_dir.join("app_config.db");
        let mut config_conn =
            diesel::sqlite::SqliteConnection::establish(config_db.to_string_lossy().as_ref())
                .expect("open config db");
        config_conn
            .batch_execute(
                r#"
                DROP TABLE IF EXISTS app_config;
                CREATE TABLE app_config (id INTEGER PRIMARY KEY, default_game_dir TEXT);
                INSERT INTO app_config (id, default_game_dir) VALUES (1, NULL);
                "#,
            )
            .expect("create config schema");

        move_non_db_owned_entries(&legacy_dir, &target_dir).expect("move non-db-owned entries");

        assert!(legacy_dir.join("instances").exists());
        assert!(!legacy_dir.join("data").exists());
        assert!(target_dir.join("data").exists());

        let _ = fs::remove_dir_all(&root);
    }
}
