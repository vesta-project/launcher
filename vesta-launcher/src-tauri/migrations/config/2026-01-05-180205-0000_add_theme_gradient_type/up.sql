-- Add theme_gradient_type to app_config table
ALTER TABLE app_config ADD COLUMN theme_gradient_type TEXT DEFAULT 'linear';
