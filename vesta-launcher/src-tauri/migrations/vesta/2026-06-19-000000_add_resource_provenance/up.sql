ALTER TABLE installed_resource ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'custom';
ALTER TABLE installed_resource ADD COLUMN source_modpack_id TEXT;
ALTER TABLE installed_resource ADD COLUMN source_modpack_version_id TEXT;
ALTER TABLE installed_resource ADD COLUMN source_modpack_platform TEXT;

CREATE INDEX idx_installed_resource_source_kind ON installed_resource (instance_id, source_kind);
CREATE INDEX idx_installed_resource_source_modpack ON installed_resource (instance_id, source_modpack_platform, source_modpack_id);
