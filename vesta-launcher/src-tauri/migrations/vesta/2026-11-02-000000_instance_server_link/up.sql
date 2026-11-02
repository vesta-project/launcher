CREATE TABLE instance_server_link (
    instance_id INTEGER PRIMARY KEY NOT NULL REFERENCES instance(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    address TEXT NOT NULL
);
