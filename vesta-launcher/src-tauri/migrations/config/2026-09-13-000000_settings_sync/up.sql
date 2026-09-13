CREATE TABLE settings_sync (
    category TEXT PRIMARY KEY NOT NULL CHECK (category IN ('gameOptions', 'keybinds', 'servers', 'resourcePacks')),
    revision INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL
);
