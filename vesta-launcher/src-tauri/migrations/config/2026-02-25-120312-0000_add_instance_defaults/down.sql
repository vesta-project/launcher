-- Undo instance defaults in app_config
ALTER TABLE app_config RENAME COLUMN default_max_memory TO max_memory_mb;
ALTER TABLE app_config DROP COLUMN default_width;
ALTER TABLE app_config DROP COLUMN default_height;
ALTER TABLE app_config DROP COLUMN default_java_args;
ALTER TABLE app_config DROP COLUMN default_environment_variables;
ALTER TABLE app_config DROP COLUMN default_pre_launch_hook;
ALTER TABLE app_config DROP COLUMN default_wrapper_command;
ALTER TABLE app_config DROP COLUMN default_post_exit_hook;
ALTER TABLE app_config DROP COLUMN default_min_memory;
