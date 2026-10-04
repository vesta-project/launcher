-- The home screen's sort mode, order and folders, stored as one JSON document.
CREATE TABLE IF NOT EXISTS library_layout (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    layout TEXT NOT NULL
);
