-- Rollback: remove theme system fields from `app_config` by recreating the table
-- SQLite does not support DROP COLUMN; we recreate the table with the original schema

PRAGMA foreign_keys=off;
BEGIN TRANSACTION;

-- Create temporary table with the original columns (before theme fields were added)
CREATE TABLE app_config_temp (
	id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
	background_hue INTEGER NOT NULL DEFAULT 220,
	theme TEXT NOT NULL DEFAULT 'dark',
	language TEXT NOT NULL DEFAULT 'en',
	max_download_threads INTEGER NOT NULL DEFAULT 4,
	max_memory_mb INTEGER NOT NULL DEFAULT 4096,
	java_path TEXT,
	default_game_dir TEXT,
	auto_update_enabled BOOLEAN NOT NULL DEFAULT 1,
	notification_enabled BOOLEAN NOT NULL DEFAULT 1,
	startup_check_updates BOOLEAN NOT NULL DEFAULT 1,
	show_tray_icon BOOLEAN NOT NULL DEFAULT 1,
	minimize_to_tray BOOLEAN NOT NULL DEFAULT 0,
	reduced_motion BOOLEAN NOT NULL DEFAULT 0,
	reduced_effects BOOLEAN NOT NULL DEFAULT 0,
	last_window_width INTEGER NOT NULL DEFAULT 1200,
	last_window_height INTEGER NOT NULL DEFAULT 700,
	debug_logging BOOLEAN NOT NULL DEFAULT 0,
	notification_retention_days INTEGER NOT NULL DEFAULT 30,
	active_account_uuid TEXT
);

-- Copy data from existing table to temp table (ignore theme columns)
INSERT INTO app_config_temp (
	id, background_hue, theme, language, max_download_threads, max_memory_mb,
	java_path, default_game_dir, auto_update_enabled, notification_enabled,
	startup_check_updates, show_tray_icon, minimize_to_tray, reduced_motion,
	reduced_effects, last_window_width, last_window_height, debug_logging,
	notification_retention_days, active_account_uuid
)
SELECT
	id, background_hue, theme, language, max_download_threads, max_memory_mb,
	java_path, default_game_dir, auto_update_enabled, notification_enabled,
	startup_check_updates, show_tray_icon, minimize_to_tray, reduced_motion,
	reduced_effects, last_window_width, last_window_height, debug_logging,
	notification_retention_days, active_account_uuid
FROM app_config;

-- Drop original table and rename temp to original
DROP TABLE app_config;
ALTER TABLE app_config_temp RENAME TO app_config;

-- Recreate any indexes if they existed (none expected for app_config by default)

COMMIT;
PRAGMA foreign_keys=on;
