-- Remove show_on_completion column from notification table
-- SQLite doesn't support DROP COLUMN, so we recreate the table without the column

-- Create temporary table with old structure (without show_on_completion)
CREATE TABLE notification_temp (
    id INTEGER PRIMARY KEY,
    client_key TEXT,
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

-- Copy data from original table to temp table (excluding show_on_completion column)
INSERT INTO notification_temp (
    id, client_key, title, description, severity, notification_type,
    dismissible, progress, current_step, total_steps, read, actions,
    metadata, created_at, updated_at, expires_at
)
SELECT
    id, client_key, title, description, severity, notification_type,
    dismissible, progress, current_step, total_steps, read, actions,
    metadata, created_at, updated_at, expires_at
FROM notification;

-- Drop original table
DROP TABLE notification;

-- Rename temp table to original name
ALTER TABLE notification_temp RENAME TO notification;

-- Recreate indexes if they existed (based on typical Diesel patterns)
CREATE INDEX IF NOT EXISTS idx_notification_client_key ON notification(client_key);
CREATE INDEX IF NOT EXISTS idx_notification_created_at ON notification(created_at);
CREATE INDEX IF NOT EXISTS idx_notification_read ON notification(read);
