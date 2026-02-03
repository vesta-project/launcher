-- SQLite doesn't support DROP COLUMN in older versions easily, but 3.35.0+ does.
-- Since this is for a launcher, we target modern environments.
ALTER TABLE account DROP COLUMN account_type;