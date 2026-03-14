-- Rollback: add_skin_system
-- (Diesel SQLite doesn't support DROP COLUMN easily, but we can drop the table)
DROP TABLE IF EXISTS account_skin_history;
-- Note: skin_variant column is left as-is since DROP COLUMN is not supported in SQLite older than 3.35.0
