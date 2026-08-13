CREATE TABLE keybinding_commands (
    command_id TEXT PRIMARY KEY NOT NULL,
    handler_id TEXT NOT NULL,
    label TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    default_chord TEXT,
    current_chord TEXT,
    customized BOOLEAN NOT NULL DEFAULT 0,
    available BOOLEAN NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX keybinding_commands_current_chord_unique
ON keybinding_commands (current_chord)
WHERE current_chord IS NOT NULL;
