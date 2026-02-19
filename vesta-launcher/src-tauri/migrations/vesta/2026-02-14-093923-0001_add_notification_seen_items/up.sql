CREATE TABLE notification_seen_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    subscription_id TEXT NOT NULL,
    item_id TEXT NOT NULL, -- slug, uuid, guid
    seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (subscription_id) REFERENCES notification_subscriptions(id) ON DELETE CASCADE,
    UNIQUE(subscription_id, item_id)
);
