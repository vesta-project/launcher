DROP INDEX IF EXISTS resource_project_peer_reverse_idx;
DROP TABLE IF EXISTS resource_project_peer;

PRAGMA foreign_keys = OFF;

CREATE TABLE resource_project_old (
    id TEXT PRIMARY KEY NOT NULL,
    source TEXT NOT NULL,
    name TEXT NOT NULL,
    summary TEXT NOT NULL,
    description TEXT,
    icon_url TEXT,
    icon_data BLOB,
    project_type TEXT NOT NULL,
    last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata_synced_at TIMESTAMP,
    icon_synced_at TIMESTAMP
);

INSERT OR REPLACE INTO resource_project_old (
    id,
    source,
    name,
    summary,
    description,
    icon_url,
    icon_data,
    project_type,
    last_updated,
    metadata_synced_at,
    icon_synced_at
)
SELECT
    id,
    source,
    name,
    summary,
    description,
    icon_url,
    icon_data,
    project_type,
    last_updated,
    metadata_synced_at,
    icon_synced_at
FROM resource_project
ORDER BY last_updated;

DROP TABLE resource_project;
ALTER TABLE resource_project_old RENAME TO resource_project;

PRAGMA foreign_keys = ON;
