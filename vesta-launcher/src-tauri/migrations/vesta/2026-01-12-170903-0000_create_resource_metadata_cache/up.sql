CREATE TABLE resource_metadata_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    remote_id TEXT NOT NULL,
    project_data TEXT NOT NULL, -- Serialized ResourceProject
    versions_data TEXT,         -- Serialized Vec<ResourceVersion>
    last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    UNIQUE(source, remote_id)
);

CREATE INDEX idx_resource_metadata_cache_expires ON resource_metadata_cache(expires_at);
