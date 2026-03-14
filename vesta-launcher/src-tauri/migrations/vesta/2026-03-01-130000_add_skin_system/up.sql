-- Migration: add_skin_system
-- Refactor account skin management and create skin history table

-- 1. Add skin_variant to account table (Diesel doesn't easily support dropping columns in SQLite)
ALTER TABLE account ADD COLUMN skin_variant TEXT DEFAULT 'classic' NOT NULL;

-- 2. Create account_skin_history table
CREATE TABLE account_skin_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    account_uuid TEXT NOT NULL,
    texture_key TEXT NOT NULL,
    name TEXT NOT NULL,
    variant TEXT NOT NULL,
    image_data TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'mojang',
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_uuid) REFERENCES account(uuid) ON DELETE CASCADE,
    UNIQUE(account_uuid, texture_key)
);

CREATE INDEX idx_account_skin_history_uuid_added_at ON account_skin_history(account_uuid, added_at DESC);
