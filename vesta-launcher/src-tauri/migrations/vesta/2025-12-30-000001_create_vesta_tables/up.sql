-- Create instance table
CREATE TABLE instance (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL,
    minecraft_version TEXT NOT NULL,
    modloader TEXT,
    modloader_version TEXT,
    java_path TEXT,
    java_args TEXT,
    game_directory TEXT,
    width INTEGER NOT NULL DEFAULT 854,
    height INTEGER NOT NULL DEFAULT 480,
    memory_mb INTEGER NOT NULL DEFAULT 2048,
    icon_path TEXT,
    last_played TEXT,
    total_playtime_minutes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT,
    installation_status TEXT,
    crashed BOOLEAN,
    crash_details TEXT
);

CREATE INDEX idx_instance_name ON instance(name);
CREATE INDEX idx_instance_version ON instance(minecraft_version);

-- Create account table
CREATE TABLE account (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    uuid TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    display_name TEXT,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TEXT,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    skin_url TEXT,
    cape_url TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE INDEX idx_account_uuid ON account(uuid);
CREATE INDEX idx_account_username ON account(username);

-- Create notification table
CREATE TABLE notification (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    client_key TEXT UNIQUE,
    title TEXT,
    description TEXT,
    severity TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    dismissible BOOLEAN NOT NULL DEFAULT 0,
    progress INTEGER,
    current_step INTEGER,
    total_steps INTEGER,
    read BOOLEAN NOT NULL DEFAULT 0,
    actions TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT
);

CREATE INDEX idx_notification_client_key ON notification(client_key);
CREATE INDEX idx_notification_created_at ON notification(created_at);
CREATE INDEX idx_notification_read ON notification(read);

-- Create user_version_tracking table
CREATE TABLE user_version_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    version_type TEXT NOT NULL,
    last_seen_version TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    notified BOOLEAN NOT NULL DEFAULT 0
);

CREATE INDEX idx_user_version_tracking_type ON user_version_tracking(version_type);
