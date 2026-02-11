-- SQLite does not support dropping columns easily, but we can't do much about it in a simple migration.
-- However, for reference if we were using a more advanced DB: 
-- ALTER TABLE app_config DROP COLUMN discord_presence_enabled;
PRAGMA foreign_keys=OFF;
CREATE TABLE app_config_dg_tmp (
    id INTEGER NOT NULL PRIMARY KEY,
    background_hue INTEGER NOT NULL,
    theme TEXT NOT NULL,
    language TEXT NOT NULL,
    max_download_threads INTEGER NOT NULL,
    max_memory_mb INTEGER NOT NULL,
    java_path TEXT,
    default_game_dir TEXT,
    auto_update_enabled BOOLEAN NOT NULL,
    notification_enabled BOOLEAN NOT NULL,
    startup_check_updates BOOLEAN NOT NULL,
    show_tray_icon BOOLEAN NOT NULL,
    minimize_to_tray BOOLEAN NOT NULL,
    reduced_motion BOOLEAN NOT NULL,
    last_window_width INTEGER NOT NULL,
    last_window_height INTEGER NOT NULL,
    debug_logging BOOLEAN NOT NULL,
    notification_retention_days INTEGER NOT NULL,
    active_account_uuid TEXT,
    theme_id TEXT NOT NULL,
    theme_mode TEXT NOT NULL,
    theme_primary_hue INTEGER NOT NULL,
    theme_primary_sat INTEGER,
    theme_primary_light INTEGER,
    theme_style TEXT NOT NULL,
    theme_gradient_enabled BOOLEAN NOT NULL,
    theme_gradient_angle INTEGER,
    theme_gradient_harmony TEXT,
    theme_advanced_overrides TEXT,
    theme_gradient_type TEXT,
    theme_border_width INTEGER,
    setup_completed BOOLEAN NOT NULL,
    setup_step INTEGER NOT NULL,
    tutorial_completed BOOLEAN NOT NULL,
    use_dedicated_gpu BOOLEAN NOT NULL
);

INSERT INTO app_config_dg_tmp(id, background_hue, theme, language, max_download_threads, max_memory_mb, java_path, default_game_dir, auto_update_enabled, notification_enabled, startup_check_updates, show_tray_icon, minimize_to_tray, reduced_motion, last_window_width, last_window_height, debug_logging, notification_retention_days, active_account_uuid, theme_id, theme_mode, theme_primary_hue, theme_primary_sat, theme_primary_light, theme_style, theme_gradient_enabled, theme_gradient_angle, theme_gradient_harmony, theme_advanced_overrides, theme_gradient_type, theme_border_width, setup_completed, setup_step, tutorial_completed, use_dedicated_gpu)
SELECT id, background_hue, theme, language, max_download_threads, max_memory_mb, java_path, default_game_dir, auto_update_enabled, notification_enabled, startup_check_updates, show_tray_icon, minimize_to_tray, reduced_motion, last_window_width, last_window_height, debug_logging, notification_retention_days, active_account_uuid, theme_id, theme_mode, theme_primary_hue, theme_primary_sat, theme_primary_light, theme_style, theme_gradient_enabled, theme_gradient_angle, theme_gradient_harmony, theme_advanced_overrides, theme_gradient_type, theme_border_width, setup_completed, setup_step, tutorial_completed, use_dedicated_gpu
FROM app_config;

DROP TABLE app_config;
ALTER TABLE app_config_dg_tmp RENAME TO app_config;
PRAGMA foreign_keys=ON;
