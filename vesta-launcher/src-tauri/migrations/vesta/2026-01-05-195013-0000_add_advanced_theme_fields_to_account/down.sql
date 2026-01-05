-- Remove advanced theme fields from account table
ALTER TABLE account DROP COLUMN theme_primary_sat;
ALTER TABLE account DROP COLUMN theme_primary_light;
