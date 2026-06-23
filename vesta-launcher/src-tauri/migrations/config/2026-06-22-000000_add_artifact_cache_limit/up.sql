ALTER TABLE app_config
-- Keep this literal in sync with piston_lib::game::installer::types::DEFAULT_ARTIFACT_CACHE_MAX_BYTES.
ADD COLUMN artifact_cache_max_bytes BIGINT NOT NULL DEFAULT 1073741824;
