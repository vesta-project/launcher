ALTER TABLE instance ADD COLUMN memory_mb INTEGER NOT NULL DEFAULT 4096;
UPDATE instance SET memory_mb = max_memory;
ALTER TABLE instance DROP COLUMN min_memory;
ALTER TABLE instance DROP COLUMN max_memory;
