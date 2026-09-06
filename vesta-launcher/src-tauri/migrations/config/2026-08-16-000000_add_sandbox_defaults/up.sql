ALTER TABLE app_config ADD COLUMN default_sandbox_preset TEXT NOT NULL DEFAULT 'trusted';
ALTER TABLE app_config ADD COLUMN default_sandbox_wrapper_nesting TEXT NOT NULL DEFAULT 'sandbox-outside';
ALTER TABLE app_config ADD COLUMN default_sandbox_extra_paths TEXT NOT NULL DEFAULT '[]';
