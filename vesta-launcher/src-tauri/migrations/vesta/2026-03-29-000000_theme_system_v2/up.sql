-- Migration: Theme System v2
CREATE TABLE IF NOT EXISTS saved_themes (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    theme_data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE account ADD COLUMN theme_data TEXT;
ALTER TABLE account ADD COLUMN theme_window_effect TEXT;
ALTER TABLE account ADD COLUMN theme_background_opacity INTEGER;
