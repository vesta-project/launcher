-- Migration: Theme System v2
ALTER TABLE app_config ADD COLUMN theme_window_effect TEXT;
ALTER TABLE app_config ADD COLUMN theme_background_opacity INTEGER;
ALTER TABLE app_config ADD COLUMN theme_data TEXT;

-- Update background_hue to be nullable (SQLite doesn't support ALTER COLUMN, we allow NULL via schema)
-- We don't need a table rebuild here because SQLite columns are nullable by default unless NOT NULL is specified.
-- Our original table definition for background_hue was likely "INTEGER NOT NULL", 
-- but Diesel doesn't strictly enforce that at the DB level for existing columns without a check.
-- However, to be safe and clean, we'll just ensure the Rust model and schema reflect Option<i32>.
