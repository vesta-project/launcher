-- Remove instance linking and new settings
ALTER TABLE instance RENAME COLUMN game_width TO width;
ALTER TABLE instance RENAME COLUMN game_height TO height;
ALTER TABLE instance DROP COLUMN use_global_resolution;
ALTER TABLE instance DROP COLUMN use_global_memory;
ALTER TABLE instance DROP COLUMN use_global_java_args;
ALTER TABLE instance DROP COLUMN use_global_java_path;
ALTER TABLE instance DROP COLUMN use_global_hooks;
ALTER TABLE instance DROP COLUMN use_global_environment_variables;
ALTER TABLE instance DROP COLUMN use_global_game_dir;

ALTER TABLE instance DROP COLUMN environment_variables;
ALTER TABLE instance DROP COLUMN pre_launch_hook;
ALTER TABLE instance DROP COLUMN wrapper_command;
ALTER TABLE instance DROP COLUMN post_exit_hook;
