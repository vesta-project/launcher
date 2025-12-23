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
        let db = get_data_db().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;
        let conn = db.get_connection();

        let tracking = UserVersionTracking {
            id: crate::utils::sqlite::AUTOINCREMENT::INIT,
            version_type: version_type.to_string(),
            last_seen_version: version.to_string(),
            last_seen_at: chrono::Utc::now().to_rfc3339(),
            notified,
        };

        // Use INSERT OR REPLACE to update existing or create new
        let columns = UserVersionTracking::columns();
        let values = tracking.values()?;
        let placeholders: Vec<String> = (0..values.0.len()).map(|i| format!("?{}", i + 1)).collect();

        let sql = format!(
            "INSERT OR REPLACE INTO {} ({}) VALUES ({})",
            UserVersionTracking::name(),
            columns.keys().map(|s| s.as_str()).collect::<Vec<_>>().join(", "),
            placeholders.join(", ")
        );

        conn.execute(&sql, rusqlite::params_from_iter(values.0))?;

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