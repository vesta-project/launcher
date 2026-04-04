-- Migration: Theme System v2
ALTER TABLE app_config ADD COLUMN theme_window_effect TEXT;
ALTER TABLE app_config ADD COLUMN theme_background_opacity INTEGER;
ALTER TABLE app_config ADD COLUMN theme_data TEXT;

-- Note: This migration intentionally does not alter `background_hue` nullability.
-- The original `app_config.background_hue` column remains NOT NULL.
