-- Remove theme fields from account table
ALTER TABLE account DROP COLUMN theme_id;
ALTER TABLE account DROP COLUMN theme_primary_hue;
ALTER TABLE account DROP COLUMN theme_style;
ALTER TABLE account DROP COLUMN theme_gradient_enabled;
ALTER TABLE account DROP COLUMN theme_gradient_angle;
ALTER TABLE account DROP COLUMN theme_gradient_type;
ALTER TABLE account DROP COLUMN theme_gradient_harmony;
ALTER TABLE account DROP COLUMN theme_advanced_overrides;
