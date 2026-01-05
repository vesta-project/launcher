-- Add advanced theme fields to account table
ALTER TABLE account ADD COLUMN theme_primary_sat INTEGER;
ALTER TABLE account ADD COLUMN theme_primary_light INTEGER;
