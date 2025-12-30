-- Create app_config table
CREATE TABLE app_config (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    background_hue INTEGER NOT NULL DEFAULT 220,
    theme TEXT NOT NULL DEFAULT 'dark',
    language TEXT NOT NULL DEFAULT 'en',
    max_download_threads INTEGER NOT NULL DEFAULT 4,
    max_memory_mb INTEGER NOT NULL DEFAULT 4096,
    java_path TEXT,
    default_game_dir TEXT,
    auto_update_enabled INTEGER NOT NULL DEFAULT 1,
    notification_enabled INTEGER NOT NULL DEFAULT 1,
    startup_check_updates INTEGER NOT NULL DEFAULT 1,
    show_tray_icon INTEGER NOT NULL DEFAULT 1,
    minimize_to_tray INTEGER NOT NULL DEFAULT 0,
    reduced_motion INTEGER NOT NULL DEFAULT 0,
    reduced_effects INTEGER NOT NULL DEFAULT 0,
    last_window_width INTEGER NOT NULL DEFAULT 1200,
    last_window_height INTEGER NOT NULL DEFAULT 700,
    debug_logging INTEGER NOT NULL DEFAULT 0,
    notification_retention_days INTEGER NOT NULL DEFAULT 30,
    active_account_uuid TEXT
);

-- Insert default config row
INSERT INTO app_config (id) VALUES (1);
