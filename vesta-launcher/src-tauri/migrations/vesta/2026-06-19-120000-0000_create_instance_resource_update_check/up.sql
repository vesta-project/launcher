CREATE TABLE instance_resource_update_check (
    instance_id INTEGER PRIMARY KEY NOT NULL,
    checked_at TEXT NOT NULL,
    results_json TEXT NOT NULL,
    instance_fingerprint TEXT NOT NULL,
    FOREIGN KEY (instance_id) REFERENCES instance(id) ON DELETE CASCADE
);
