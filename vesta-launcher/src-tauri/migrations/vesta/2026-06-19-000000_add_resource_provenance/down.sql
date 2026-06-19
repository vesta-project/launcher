DROP INDEX IF EXISTS idx_installed_resource_source_modpack;
DROP INDEX IF EXISTS idx_installed_resource_source_kind;

ALTER TABLE installed_resource DROP COLUMN source_modpack_platform;
ALTER TABLE installed_resource DROP COLUMN source_modpack_version_id;
ALTER TABLE installed_resource DROP COLUMN source_modpack_id;
ALTER TABLE installed_resource DROP COLUMN source_kind;
