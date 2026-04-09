CREATE TABLE resource_project_old (
    id TEXT PRIMARY KEY NOT NULL,
    source TEXT NOT NULL,
    name TEXT NOT NULL,
    summary TEXT NOT NULL,
    icon_url TEXT,
    icon_data BLOB,
    project_type TEXT NOT NULL,
    last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO resource_project_old (
    id,
    source,
    name,
    summary,
    icon_url,
    icon_data,
    project_type,
    last_updated
)
SELECT
    id,
    source,
    name,
    summary,
    icon_url,
    icon_data,
    project_type,
    last_updated
FROM resource_project;

DROP TABLE resource_project;
ALTER TABLE resource_project_old RENAME TO resource_project;
