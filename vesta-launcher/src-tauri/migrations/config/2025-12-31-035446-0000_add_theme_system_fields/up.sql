-- Add theme system fields to app_config table
ALTER TABLE app_config ADD COLUMN theme_id TEXT NOT NULL DEFAULT 'midnight';
ALTER TABLE app_config ADD COLUMN theme_mode TEXT NOT NULL DEFAULT 'template';
ALTER TABLE app_config ADD COLUMN theme_primary_hue INTEGER NOT NULL DEFAULT 220;
ALTER TABLE app_config ADD COLUMN theme_primary_sat INTEGER;
ALTER TABLE app_config ADD COLUMN theme_primary_light INTEGER;
ALTER TABLE app_config ADD COLUMN theme_style TEXT NOT NULL DEFAULT 'glass';
ALTER TABLE app_config ADD COLUMN theme_gradient_enabled BOOLEAN NOT NULL DEFAULT 1;
ALTER TABLE app_config ADD COLUMN theme_gradient_angle INTEGER DEFAULT 135;
ALTER TABLE app_config ADD COLUMN theme_gradient_harmony TEXT DEFAULT 'complementary';
ALTER TABLE app_config ADD COLUMN theme_advanced_overrides TEXT;
