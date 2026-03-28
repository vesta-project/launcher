-- We can't really drop columns in SQLite easily, but we can do a dummy command
PRAGMA user_version = PRAGMA user_version;
