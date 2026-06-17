-- Memory is now always stored per instance. Preserve existing concrete
-- min_memory/max_memory values and remove the deprecated link flag.
ALTER TABLE instance DROP COLUMN use_global_memory;
