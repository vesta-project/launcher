use crate::models::UserVersionTracking;
use crate::utils::db_manager::get_data_db;
use crate::utils::sqlite::SqlTable;
use anyhow::Result;

/// Repository functions for user version tracking
pub struct VersionTrackingRepository;

impl VersionTrackingRepository {
    /// Get the last seen version for a specific version type
    pub fn get_last_seen_version(version_type: &str) -> Result<Option<String>> {
        let db = get_data_db().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;
        let conn = db.get_connection();

        let mut stmt = conn.prepare(&format!(
            "SELECT last_seen_version FROM {} WHERE version_type = ?1 ORDER BY last_seen_at DESC LIMIT 1",
            UserVersionTracking::name()
        ))?;

        let mut rows = stmt.query_map([version_type], |row| row.get::<_, String>(0))?;

        if let Some(version) = rows.next() {
            Ok(Some(version?))
        } else {
            Ok(None)
        }
    }

    /// Update or insert the last seen version for a version type
    pub fn update_last_seen_version(version_type: &str, version: &str, notified: bool) -> Result<()> {
        log::info!(
            "Updating last seen version for type '{}' to '{}' (notified: {})",
            version_type,
            version,
            notified
        );

        let db = get_data_db().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;
        let conn = db.get_connection();

        let now = chrono::Utc::now().to_rfc3339();

        // Try to update an existing row first; avoid specifying the AUTOINCREMENT column to prevent column count mismatches.
        let updated = conn.execute(
            &format!(
                "UPDATE {} SET last_seen_version = ?1, last_seen_at = ?2, notified = ?3 WHERE version_type = ?4",
                UserVersionTracking::name()
            ),
            rusqlite::params![version, now, notified, version_type],
        )?;

        if updated == 0 {
            // No row existed; insert a new one (omit id so SQLite assigns it)
            conn.execute(
                &format!(
                    "INSERT INTO {} (version_type, last_seen_version, last_seen_at, notified) VALUES (?1, ?2, ?3, ?4)",
                    UserVersionTracking::name()
                ),
                rusqlite::params![version_type, version, now, notified],
            )?;
        }

        log::info!("Successfully updated last seen version for type '{}'", version_type);
        Ok(())
    }

    /// Check if a version is newer than the last seen version
    pub fn is_version_newer(version_type: &str, current_version: &str) -> Result<bool> {
        if let Some(last_seen) = Self::get_last_seen_version(version_type)? {
            // Simple string comparison for now - could be enhanced with semver parsing
            Ok(current_version != last_seen)
        } else {
            // No previous version seen, so this is "new"
            Ok(true)
        }
    }

    /// Mark that user has been notified about a version
    pub fn mark_notified(version_type: &str, version: &str) -> Result<()> {
        Self::update_last_seen_version(version_type, version, true)
    }

    /// Initialize default version tracking entries on first run
    pub fn initialize_defaults() -> Result<()> {
        // Initialize with current known versions (as of Dec 2025)
        let defaults = vec![
            ("minecraft_release", "1.21.1"),
            ("minecraft_snapshot", "25w51a"),
        ];

        for (version_type, version) in defaults {
            if Self::get_last_seen_version(version_type)?.is_none() {
                Self::update_last_seen_version(version_type, version, true)?;
            }
        }

        Ok(())
    }
}