CREATE TABLE notification_subscriptions (
    id TEXT PRIMARY KEY NOT NULL,
    provider_type TEXT NOT NULL, -- Enum: news, patch_notes, rss, resource, game
    target_url TEXT,
    target_id TEXT, -- e.g. project_slug or loader name
    title TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    metadata TEXT, -- JSON filters/settings
    last_checked TEXT, -- Timestamp
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
