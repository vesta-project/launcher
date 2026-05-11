ALTER TABLE global_java_paths RENAME TO global_java_paths_new;

CREATE TABLE global_java_paths (
    major_version INTEGER PRIMARY KEY,
    path TEXT NOT NULL,
    is_managed BOOLEAN NOT NULL DEFAULT 0
);

INSERT INTO global_java_paths (major_version, path, is_managed)
SELECT major_version, path, is_managed FROM global_java_paths_new;

DROP TABLE global_java_paths_new;
