ALTER TABLE instance ADD COLUMN min_memory INTEGER NOT NULL DEFAULT 2048;
ALTER TABLE instance ADD COLUMN max_memory INTEGER NOT NULL DEFAULT 4096;
UPDATE instance SET max_memory = memory_mb;
ALTER TABLE instance DROP COLUMN memory_mb;
