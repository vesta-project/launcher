CREATE TABLE pinned_page (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    page_type TEXT NOT NULL, -- 'instance' or 'resource'
    target_id TEXT NOT NULL, -- instance slug or resource projectId
    platform TEXT,           -- 'modrinth', 'curseforge' (for resources)
    label TEXT NOT NULL,
    icon_url TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pinned_page_order ON pinned_page(order_index);
