CREATE TABLE resource_project (
    id TEXT PRIMARY KEY NOT NULL,
    source TEXT NOT NULL,
    name TEXT NOT NULL,
    summary TEXT NOT NULL,
    icon_url TEXT,
    icon_data BLOB,
    project_type TEXT NOT NULL,
    last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
