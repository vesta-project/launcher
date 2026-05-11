ALTER TABLE global_java_paths RENAME TO global_java_paths_new;

CREATE TABLE global_java_paths (
    major_version INTEGER PRIMARY KEY,
    path TEXT NOT NULL,
    is_managed BOOLEAN NOT NULL DEFAULT 0
);

-- Collapse to one row per major_version, preferring is_active=1, otherwise MAX(id)
INSERT INTO global_java_paths (major_version, path, is_managed)
SELECT major_version, path, is_managed
FROM global_java_paths_new
WHERE id IN (
    SELECT COALESCE(
        MAX(CASE WHEN is_active = 1 THEN id END),
        MAX(id)
    )
    FROM global_java_paths_new
    GROUP BY major_version
);

DROP TABLE global_java_paths_new;
