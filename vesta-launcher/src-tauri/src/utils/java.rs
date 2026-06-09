use crate::metadata_cache::MetadataCache;
use crate::models::instance::Instance;
use crate::notifications::manager::NotificationManager;
use crate::notifications::models::{
    CreateNotificationInput, NotificationSeverity, NotificationType, PROGRESS_INDETERMINATE,
};
use crate::utils::db::get_config_conn;
use crate::utils::db_manager::get_app_config_dir;
use diesel::prelude::*;
use piston_lib::game::installer::core::jre_manager::{self, get_or_install_jre, JavaVersion};
use piston_lib::game::installer::types::{NotificationActionSpec, ProgressReporter};
use piston_lib::game::java_policy::LEGACY_JAVA_MAJOR;
use piston_lib::game::metadata::PistonMetadata;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub use piston_lib::game::java_policy::preferred_java_major;

pub(crate) fn normalize_metadata_java_requirements(metadata: &mut PistonMetadata) -> bool {
    let mut changed = false;

    for major in metadata.java_major_version_by_game_version.values_mut() {
        let preferred = preferred_java_major(*major);
        if preferred != *major {
            *major = preferred;
            changed = true;
        }
    }

    let before = metadata.required_java_major_versions.clone();
    for major in metadata.required_java_major_versions.iter_mut() {
        *major = preferred_java_major(*major);
    }
    metadata
        .required_java_major_versions
        .sort_unstable_by(|a, b| b.cmp(a));
    metadata.required_java_major_versions.dedup();

    if metadata.required_java_major_versions != before {
        changed = true;
    }

    changed
}

pub fn get_managed_jre_dir() -> Result<PathBuf, String> {
    get_app_config_dir()
        .map(|d| d.join("data").join("jre"))
        .map_err(|e| e.to_string())
}

pub fn scan_system_javas_filtered() -> Vec<jre_manager::DetectedJava> {
    let mut javas = jre_manager::scan_system_javas();

    // Filter out javas that are in our managed directory
    if let Ok(managed_dir) = get_managed_jre_dir() {
        if managed_dir.exists() {
            javas.retain(|java| !java.path.starts_with(&managed_dir));
        }
    }

    javas
}

pub fn get_managed_javas() -> Vec<jre_manager::DetectedJava> {
    let mut managed_javas = Vec::new();
    if let Ok(managed_dir) = get_managed_jre_dir() {
        if managed_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&managed_dir) {
                for entry in entries.flatten() {
                    let entry_path = entry.path();
                    if entry_path.is_dir() {
                        if let Some(java_exe) = jre_manager::find_java_executable(&entry_path) {
                            if let Ok(info) = jre_manager::verify_java(&java_exe) {
                                managed_javas.push(info);
                            }
                        }
                    }
                }
            }
        }
    }
    managed_javas
}

fn is_legacy_version_type(version_type: &str) -> bool {
    matches!(version_type, "old_alpha" | "old_beta")
}

pub fn resolve_required_java_from_manifest(
    metadata: &PistonMetadata,
    mc_version: &str,
) -> Result<u32, String> {
    if let Some(major) = metadata.java_major_version_by_game_version.get(mc_version) {
        return Ok(preferred_java_major(*major));
    }

    if let Some(version_meta) = metadata.game_versions.iter().find(|v| v.id == mc_version) {
        if is_legacy_version_type(&version_meta.version_type) {
            return Ok(LEGACY_JAVA_MAJOR);
        }

        return Err(format!(
            "Missing javaVersion.majorVersion for non-legacy version '{}'",
            mc_version
        ));
    }

    Err(format!(
        "Minecraft version '{}' not found in metadata",
        mc_version
    ))
}



pub async fn resolve_required_java_major(
    app_handle: &tauri::AppHandle,
    mc_version: &str,
) -> Result<u32, String> {
    let mut metadata = super::manifest::load_manifest(app_handle).await?;

    match resolve_required_java_from_manifest(&metadata, mc_version) {
        Ok(major) => return Ok(major),
        Err(e) => {
            log::warn!(
                "Java major missing in cached manifest for '{}': {}. Falling back to Mojang detail lookup.",
                mc_version,
                e
            );
        }
    }

    let client = piston_lib::client::shared_client();
    let fetched = piston_lib::game::java_policy::fetch_java_major_for_version(mc_version, client)
        .await
        .map_err(|e| e.to_string())?;
    let preferred = preferred_java_major(fetched);

    metadata
        .java_major_version_by_game_version
        .insert(mc_version.to_string(), preferred);

    if !metadata.required_java_major_versions.contains(&preferred) {
        metadata.required_java_major_versions.push(preferred);
        metadata
            .required_java_major_versions
            .sort_unstable_by(|a, b| b.cmp(a));
        metadata.required_java_major_versions.dedup();
    }

    if let Some(cache) = app_handle.try_state::<MetadataCache>() {
        cache.set(&metadata);
    }

    Ok(preferred)
}

fn is_path_only_java_command(java_path: &str) -> bool {
    matches!(java_path, "java" | "java.exe")
}

fn managed_java_executable_name() -> &'static str {
    if cfg!(windows) {
        "java.exe"
    } else {
        "java"
    }
}

/// Expected managed Java executable path before download (direct `bin/` layout).
pub fn managed_java_executable_path(major_version: u32) -> Result<PathBuf, String> {
    Ok(get_managed_jre_dir()?
        .join(format!("zulu-{}", major_version))
        .join("bin")
        .join(managed_java_executable_name()))
}

pub fn get_active_global_java_path(version_major: i32) -> Option<String> {
    use crate::schema::config::global_java_paths::dsl::*;
    let mut conn = get_config_conn().ok()?;
    global_java_paths
        .filter(major_version.eq(version_major))
        .order((is_active.desc(), id.desc()))
        .select(path)
        .first::<String>(&mut conn)
        .ok()
}

fn find_verified_managed_java_for_major(major_version: u32) -> Option<PathBuf> {
    let install_dir = get_managed_jre_dir()
        .ok()?
        .join(format!("zulu-{}", major_version));
    let java_path = jre_manager::find_java_executable(&install_dir)?;
    jre_manager::verify_java(&java_path).ok()?;
    Some(java_path)
}

/// Registers managed Java as the active preference without downloading.
pub fn ensure_managed_java_preference(major_version: u32) -> Result<String, String> {
    if let Some(path) = get_active_global_java_path(major_version as i32) {
        return Ok(path);
    }

    if let Some(existing) = find_verified_managed_java_for_major(major_version) {
        save_active_managed_java_path(major_version as i32, &existing)?;
        return Ok(existing.to_string_lossy().to_string());
    }

    Ok(managed_java_executable_path(major_version)?.to_string_lossy().to_string())
}

pub async fn resolve_java_path_for_version(
    app_handle: &AppHandle,
    mc_version: &str,
) -> Result<String, String> {
    let required_major = resolve_required_java_major(app_handle, mc_version).await?;

    if let Some(path) = get_active_global_java_path(required_major as i32) {
        return Ok(path);
    }

    ensure_managed_java_preference(required_major)
}

pub async fn resolve_instance_java_path(
    app_handle: &AppHandle,
    instance: &Instance,
) -> Result<String, String> {
    if !instance.use_global_java_path {
        if let Some(ref path) = instance.java_path {
            if !path.is_empty() {
                return Ok(path.clone());
            }
        }
    }

    let app_config = crate::utils::config::get_app_config().map_err(|e| e.to_string())?;
    if let Some(path) = app_config.java_path.clone() {
        if !path.is_empty() {
            return Ok(path);
        }
    }

    resolve_java_path_for_version(app_handle, &instance.minecraft_version).await
}

/// Returns true when the configured Java path is launcher-managed (not a user-provided system install).
pub fn is_configured_java_managed(java_path: &str, version_major: i32) -> bool {
    if is_path_only_java_command(java_path) {
        return false;
    }

    let configured = Path::new(java_path);
    if let Ok(managed_dir) = get_managed_jre_dir() {
        if configured.starts_with(&managed_dir) {
            return true;
        }
    }

    let Ok(mut conn) = get_config_conn() else {
        return false;
    };

    use crate::schema::config::global_java_paths::dsl::*;

    if matches!(
        global_java_paths
            .filter(path.eq(java_path))
            .filter(is_managed.eq(true))
            .select(is_managed)
            .first::<bool>(&mut conn),
        Ok(true)
    ) {
        return true;
    }

    global_java_paths
        .filter(major_version.eq(version_major))
        .filter(is_managed.eq(true))
        .filter(is_active.eq(true))
        .select(path)
        .first::<String>(&mut conn)
        .map(|active_path| active_path == java_path)
        .unwrap_or(false)
}

pub fn save_active_managed_java_path(major_version: i32, java_path: &Path) -> Result<(), String> {
    let path_str = java_path.to_string_lossy().to_string();
    let mut conn = get_config_conn().map_err(|e| e.to_string())?;
    conn.transaction(|conn| {
        diesel::sql_query("UPDATE global_java_paths SET is_active = 0 WHERE major_version = ?")
            .bind::<diesel::sql_types::Integer, _>(major_version)
            .execute(conn)?;

        diesel::sql_query(
            "INSERT INTO global_java_paths (major_version, path, is_managed, is_active) \
             VALUES (?, ?, 1, 1) \
             ON CONFLICT(major_version, path) DO UPDATE SET is_active = 1, is_managed = 1",
        )
        .bind::<diesel::sql_types::Integer, _>(major_version)
        .bind::<diesel::sql_types::Text, _>(&path_str)
        .execute(conn)?;

        Ok(())
    })
    .map_err(|e: diesel::result::Error| e.to_string())
}

pub async fn install_managed_java(
    app_handle: &AppHandle,
    major_version: u32,
    reporter: &dyn ProgressReporter,
) -> Result<PathBuf, String> {
    let jre_dir = get_app_config_dir()
        .map_err(|e| e.to_string())?
        .join("data")
        .join("jre");

    let java_path = get_or_install_jre(
        &jre_dir,
        &JavaVersion::new(major_version),
        piston_lib::client::shared_client(),
        reporter,
    )
    .await
    .map_err(|e| e.to_string())?;

    save_active_managed_java_path(major_version as i32, &java_path)?;
    let _ = app_handle.emit("java-paths-updated", ());

    Ok(java_path)
}

fn managed_zulu_install_dir(major_version: u32) -> Result<PathBuf, String> {
    Ok(get_managed_jre_dir()?.join(format!("zulu-{}", major_version)))
}

fn remove_managed_zulu_install_dir(major_version: u32) -> Result<(), String> {
    let install_dir = managed_zulu_install_dir(major_version)?;
    if install_dir.exists() {
        std::fs::remove_dir_all(&install_dir).map_err(|e| {
            format!(
                "Failed to remove managed Java install at {:?}: {}",
                install_dir, e
            )
        })?;
        log::info!(
            "Removed managed Java {} install directory at {:?}",
            major_version,
            install_dir
        );
    }
    Ok(())
}

struct LaunchJavaProgressReporter {
    app_handle: AppHandle,
    client_key: String,
    last_percent: AtomicI32,
    last_emit: Mutex<std::time::Instant>,
    warned_missing_notifications: std::sync::atomic::AtomicBool,
}

impl LaunchJavaProgressReporter {
    fn new(app_handle: AppHandle, client_key: String) -> Self {
        Self {
            app_handle,
            client_key,
            last_percent: AtomicI32::new(-1),
            last_emit: Mutex::new(std::time::Instant::now()),
            warned_missing_notifications: std::sync::atomic::AtomicBool::new(false),
        }
    }

    fn with_manager<F>(&self, f: F)
    where
        F: FnOnce(&NotificationManager),
    {
        if let Some(nm) = self.app_handle.try_state::<NotificationManager>() {
            f(&nm);
        } else if !self
            .warned_missing_notifications
            .swap(true, Ordering::Relaxed)
        {
            log::warn!(
                "NotificationManager unavailable; Java repair progress will not be shown in UI"
            );
        }
    }
}

impl ProgressReporter for LaunchJavaProgressReporter {
    fn start_step(&self, name: &str, _total_steps: Option<u32>) {
        self.with_manager(|nm| {
            let _ = nm.update_progress_with_description(
                self.client_key.clone(),
                PROGRESS_INDETERMINATE,
                None,
                None,
                name.to_string(),
            );
        });
    }

    fn update_bytes(&self, transferred: u64, total: Option<u64>) {
        if let Some(total) = total {
            let percent = (transferred as f64 / total as f64 * 100.0) as i32;
            self.set_percent(percent);
        }
    }

    fn set_percent(&self, percent: i32) {
        const MIN_INTERVAL_MS: u64 = 150;
        const MIN_PERCENT_DELTA: i32 = 1;

        let prev = self.last_percent.load(Ordering::Relaxed);
        let mut allow = percent == 0 || percent == 100;
        if !allow {
            let delta = percent - prev;
            if delta.abs() >= MIN_PERCENT_DELTA {
                let mut guard = self.last_emit.lock().unwrap();
                if guard.elapsed() >= std::time::Duration::from_millis(MIN_INTERVAL_MS) {
                    *guard = std::time::Instant::now();
                    allow = true;
                }
            }
        }
        if allow {
            self.last_percent.store(percent, Ordering::Relaxed);
            self.with_manager(|nm| {
                let _ = nm.update_progress(self.client_key.clone(), percent, None, None, None);
            });
        }
    }

    fn set_message(&self, message: &str) {
        self.with_manager(|nm| {
            let _ = nm.upsert_description(&self.client_key, message);
        });
    }

    fn set_step_count(&self, current: u32, total: Option<u32>) {
        self.with_manager(|nm| {
            let known_percent = self.last_percent.load(Ordering::Relaxed);
            let _ = nm.update_progress(
                self.client_key.clone(),
                if known_percent >= 0 {
                    known_percent
                } else {
                    PROGRESS_INDETERMINATE
                },
                Some(current as i32),
                total.map(|t| t as i32),
                None,
            );
        });
    }

    fn set_substep(&self, name: Option<&str>, _current: Option<u32>, _total: Option<u32>) {
        if let Some(name) = name {
            self.set_message(name);
        }
    }

    fn set_actions(&self, _actions: Option<Vec<NotificationActionSpec>>) {}

    fn done(&self, success: bool, message: Option<&str>) {
        if success {
            log::info!("Managed Java reinstall finished successfully");
        } else {
            self.set_message(message.unwrap_or("Java download failed"));
        }
    }

    fn is_cancelled(&self) -> bool {
        false
    }

    fn is_paused(&self) -> bool {
        false
    }
}

/// Verifies the configured Java path and reinstalls managed Java when it is missing or invalid.
pub async fn ensure_java_available(
    app_handle: &AppHandle,
    java_path_str: &str,
    major_version: u32,
    progress_reporter: Option<&dyn ProgressReporter>,
    notification_client_key: Option<String>,
) -> Result<String, String> {
    if let Some(existing) = find_verified_managed_java_for_major(major_version) {
        let existing_str = existing.to_string_lossy().to_string();
        if java_path_str != existing_str {
            save_active_managed_java_path(major_version as i32, &existing)?;
        }
        return Ok(existing_str);
    }

    let java_path = PathBuf::from(java_path_str);
    if jre_manager::verify_java(&java_path).is_ok() {
        if is_configured_java_managed(java_path_str, major_version as i32) {
            save_active_managed_java_path(major_version as i32, &java_path)?;
        }
        return Ok(java_path_str.to_string());
    }

    if !is_configured_java_managed(java_path_str, major_version as i32) {
        return Err(format!(
            "Java verification failed: executable not found or invalid at {}. \
             Update your Java installation in Settings.",
            java_path_str
        ));
    }

    log::warn!(
        "Managed Java {} missing or invalid at {}; reinstalling automatically",
        major_version,
        java_path_str
    );

    let client_key = notification_client_key
        .unwrap_or_else(|| format!("repair_managed_java_{}", major_version));

    if progress_reporter.is_none() {
        if let Some(nm) = app_handle.try_state::<NotificationManager>() {
            let _ = nm.create(CreateNotificationInput {
                client_key: Some(client_key.clone()),
                title: Some(format!("Repairing Java {}", major_version)),
                description: Some(
                    "The managed Java installation was missing or corrupted. Downloading a fresh copy..."
                        .to_string(),
                ),
                severity: Some("info".to_string()),
                notification_type: Some(NotificationType::Progress),
                dismissible: Some(false),
                persist: Some(true),
                silent: Some(false),
                actions: None,
                progress: Some(PROGRESS_INDETERMINATE),
                current_step: None,
                total_steps: None,
                metadata: None,
                show_on_completion: Some(true),
            });
        }
    } else if let Some(reporter) = progress_reporter {
        reporter.set_message("Setting up Java runtime...");
    }

    remove_managed_zulu_install_dir(major_version)?;

    let installed_path = if let Some(reporter) = progress_reporter {
        install_managed_java(app_handle, major_version, reporter).await
    } else {
        let launch_reporter =
            LaunchJavaProgressReporter::new(app_handle.clone(), client_key.clone());
        install_managed_java(app_handle, major_version, &launch_reporter).await
    }
    .map_err(|e| {
        if progress_reporter.is_none() {
            if let Some(nm) = app_handle.try_state::<NotificationManager>() {
                let _ = nm.create(CreateNotificationInput {
                    client_key: Some(client_key.clone()),
                    title: Some(format!("Java {} repair failed", major_version)),
                    description: Some(format!("Failed to reinstall managed Java: {}", e)),
                    severity: Some("error".to_string()),
                    notification_type: Some(NotificationType::Patient),
                    dismissible: Some(true),
                    persist: Some(true),
                    silent: Some(false),
                    actions: None,
                    progress: None,
                    current_step: None,
                    total_steps: None,
                    metadata: None,
                    show_on_completion: None,
                });
            }
        }
        format!("Failed to reinstall managed Java {}: {}", major_version, e)
    })?;

    if jre_manager::verify_java(&installed_path).is_err() {
        return Err(format!(
            "Managed Java {} was reinstalled but still failed verification at {:?}",
            major_version, installed_path
        ));
    }

    if progress_reporter.is_none() {
        if let Some(nm) = app_handle.try_state::<NotificationManager>() {
            let _ = nm.update_progress_with_description_and_severity(
                client_key,
                100,
                None,
                None,
                format!("Java {} installed successfully.", major_version),
                Some(NotificationSeverity::Success),
            );
        }
    }

    log::info!(
        "Managed Java {} available at {:?}",
        major_version,
        installed_path
    );

    Ok(installed_path.to_string_lossy().to_string())
}

/// Verifies Java for an instance and downloads managed Java when needed.
pub async fn ensure_java_for_instance(
    app_handle: &AppHandle,
    instance: &Instance,
    progress_reporter: Option<&dyn ProgressReporter>,
    notification_client_key: Option<String>,
) -> Result<String, String> {
    let major_version =
        resolve_required_java_major(app_handle, &instance.minecraft_version).await?;
    let java_path = resolve_instance_java_path(app_handle, instance).await?;
    ensure_java_available(
        app_handle,
        &java_path,
        major_version,
        progress_reporter,
        notification_client_key,
    )
    .await
}

/// Verifies the configured Java path and reinstalls managed Java when it is missing or invalid.
pub async fn ensure_java_for_launch(
    app_handle: &AppHandle,
    java_path_str: &str,
    major_version: u32,
) -> Result<String, String> {
    ensure_java_available(
        app_handle,
        java_path_str,
        major_version,
        None,
        Some(format!("repair_managed_java_{}", major_version)),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_only_java_command_is_not_managed() {
        assert!(!is_configured_java_managed("java", 21));
        assert!(!is_configured_java_managed("java.exe", 21));
    }
}
