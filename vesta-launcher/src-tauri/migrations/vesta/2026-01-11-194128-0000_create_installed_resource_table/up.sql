CREATE TABLE installed_resource (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id INTEGER NOT NULL,
    platform TEXT NOT NULL,
    remote_id TEXT NOT NULL,
    remote_version_id TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    local_path TEXT NOT NULL,
    display_name TEXT NOT NULL,
    current_version TEXT NOT NULL,
    is_manual BOOLEAN NOT NULL DEFAULT 0,
    is_enabled BOOLEAN NOT NULL DEFAULT 1,
    last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (instance_id) REFERENCES instance(id) ON DELETE CASCADE
);
