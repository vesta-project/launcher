use crate::models::user_version_tracking::NewUserVersionTracking;
use crate::schema::user_version_tracking::dsl::*;
use crate::utils::db::get_vesta_conn;
use anyhow::Result;
use diesel::prelude::*;

/// Repository functions for user version tracking
pub struct VersionTrackingRepository;

impl VersionTrackingRepository {
    /// Get the last seen version for a specific version type
    pub fn get_last_seen_version(v_type: &str) -> Result<Option<String>> {
        let mut conn =
            get_vesta_conn().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;

        let result = user_version_tracking
            .filter(version_type.eq(v_type))
            .order(last_seen_at.desc())
            .select(last_seen_version)
            .first::<String>(&mut conn)
            .optional()?;

        Ok(result)
    }

    /// Update or insert the last seen version for a version type
    pub fn update_last_seen_version(v_type: &str, version: &str, is_notified: bool) -> Result<()> {
        log::info!(
            "Updating last seen version for type '{}' to '{}' (notified: {})",
            v_type,
            version,
            is_notified
        );

        let mut conn =
            get_vesta_conn().map_err(|e| anyhow::anyhow!("Failed to get database: {}", e))?;
        let now = chrono::Utc::now().to_rfc3339();

        // Check if exists
        let exists: bool = diesel::select(diesel::dsl::exists(
            user_version_tracking.filter(version_type.eq(v_type)),
        ))
        .get_result(&mut conn)?;

        if exists {
            diesel::update(user_version_tracking.filter(version_type.eq(v_type)))
                .set((
                    last_seen_version.eq(version),
                    last_seen_at.eq(&now),
                    notified.eq(is_notified),
                ))
                .execute(&mut conn)?;
        } else {
            let new_tracking = NewUserVersionTracking {
                version_type: v_type.to_string(),
                last_seen_version: version.to_string(),
                last_seen_at: now,
                notified: is_notified,
            };

            diesel::insert_into(user_version_tracking)
                .values(&new_tracking)
                .execute(&mut conn)?;
        }

        log::info!(
            "Successfully updated last seen version for type '{}'",
            v_type
        );
        Ok(())
    }

    /// Check if a version is newer than the last seen version
    pub fn is_version_newer(v_type: &str, current_version: &str) -> Result<bool> {
        if let Some(last_seen) = Self::get_last_seen_version(v_type)? {
            // Simple string comparison for now - could be enhanced with semver parsing
            Ok(current_version != last_seen)
        } else {
            // No previous version seen, so this is "new"
            Ok(true)
        }
    }

    /// Mark that user has been notified about a version
    pub fn mark_notified(v_type: &str, version: &str) -> Result<()> {
        Self::update_last_seen_version(v_type, version, true)
    }

    /// Initialize default version tracking entries on first run
    pub fn initialize_defaults() -> Result<()> {
        // Initialize with current known versions (as of Dec 2025)
        let defaults = vec![
            ("minecraft_release", "1.21.1"),
            ("minecraft_snapshot", "25w51a"),
        ];

        for (v_type, version) in defaults {
            if Self::get_last_seen_version(v_type)?.is_none() {
                Self::update_last_seen_version(v_type, version, true)?;
            }
        }

        Ok(())
    }
}
