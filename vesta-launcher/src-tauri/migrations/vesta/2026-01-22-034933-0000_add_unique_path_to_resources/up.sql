-- Your SQL goes here
-- Normalize existing paths to use backslashes (Windows standard)
UPDATE installed_resource SET local_path = REPLACE(local_path, '/', '\');

-- Remove duplicates by normalized local_path, keeping the most recently updated record
DELETE FROM installed_resource
WHERE id NOT IN (
    SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY local_path ORDER BY last_updated DESC, id DESC) as rn
        FROM installed_resource
    ) WHERE rn = 1
);

CREATE UNIQUE INDEX idx_installed_resource_local_path ON installed_resource (local_path);
