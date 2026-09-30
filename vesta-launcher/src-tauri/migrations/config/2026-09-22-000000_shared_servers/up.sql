CREATE TABLE shared_servers (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    state TEXT NOT NULL
);
