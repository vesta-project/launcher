-- Allow multiple paths per Java major version
-- OLD: major_version INTEGER PRIMARY KEY (one path per version)
-- NEW: id INTEGER PRIMARY KEY, UNIQUE(major_version, path) (many paths per version)
ALTER TABLE global_java_paths RENAME TO global_java_paths_old;

CREATE TABLE global_java_paths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    major_version INTEGER NOT NULL,
    path TEXT NOT NULL,
    is_managed BOOLEAN NOT NULL DEFAULT 0,
    UNIQUE(major_version, path)
);

INSERT INTO global_java_paths (major_version, path, is_managed)
SELECT major_version, path, is_managed FROM global_java_paths_old;

DROP TABLE global_java_paths_old;
