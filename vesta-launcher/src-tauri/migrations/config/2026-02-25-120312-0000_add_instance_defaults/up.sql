-- Add instance defaults to app_config
ALTER TABLE app_config RENAME COLUMN max_memory_mb TO default_max_memory;
ALTER TABLE app_config ADD COLUMN default_width INTEGER NOT NULL DEFAULT 854;
ALTER TABLE app_config ADD COLUMN default_height INTEGER NOT NULL DEFAULT 480;
ALTER TABLE app_config ADD COLUMN default_java_args TEXT;
ALTER TABLE app_config ADD COLUMN default_environment_variables TEXT;
ALTER TABLE app_config ADD COLUMN default_pre_launch_hook TEXT;
ALTER TABLE app_config ADD COLUMN default_wrapper_command TEXT;
ALTER TABLE app_config ADD COLUMN default_post_exit_hook TEXT;
ALTER TABLE app_config ADD COLUMN default_min_memory INTEGER NOT NULL DEFAULT 2048;
