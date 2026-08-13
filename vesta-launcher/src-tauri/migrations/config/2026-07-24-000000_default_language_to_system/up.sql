-- The language field existed before the launcher exposed a language preference,
-- so no existing "en" value represents an explicit user choice.
UPDATE app_config SET language = 'system' WHERE language = 'en';
