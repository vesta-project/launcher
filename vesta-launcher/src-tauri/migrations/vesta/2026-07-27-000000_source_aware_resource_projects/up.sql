PRAGMA foreign_keys = OFF;

CREATE TABLE resource_project_new (
    id TEXT NOT NULL,
    source TEXT NOT NULL,
    name TEXT NOT NULL,
    summary TEXT NOT NULL,
    description TEXT,
    icon_url TEXT,
    icon_data BLOB,
    project_type TEXT NOT NULL,
    last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata_synced_at TIMESTAMP,
    icon_synced_at TIMESTAMP,
    PRIMARY KEY (source, id)
);

INSERT INTO resource_project_new (
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
FROM resource_project;

DROP TABLE resource_project;
ALTER TABLE resource_project_new RENAME TO resource_project;

CREATE TABLE resource_project_peer (
    source TEXT NOT NULL,
    project_id TEXT NOT NULL,
    peer_source TEXT NOT NULL,
    peer_project_id TEXT NOT NULL,
    evidence TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (source, project_id, peer_source)
);

CREATE INDEX resource_project_peer_reverse_idx
    ON resource_project_peer (peer_source, peer_project_id, source);

PRAGMA foreign_keys = ON;
