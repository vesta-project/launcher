-- Rollback: Theme System v2
DROP TABLE IF EXISTS saved_themes;
-- Note: SQLite does not support dropping columns. These are no-ops to allow migration state to revert.
PRAGMA user_version = PRAGMA user_version;
