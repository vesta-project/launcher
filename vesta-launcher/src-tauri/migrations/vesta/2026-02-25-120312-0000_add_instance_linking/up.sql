-- Add instance linking and new settings
ALTER TABLE instance RENAME COLUMN width TO game_width;
ALTER TABLE instance RENAME COLUMN height TO game_height;
ALTER TABLE instance ADD COLUMN use_global_resolution BOOLEAN NOT NULL DEFAULT 1;
ALTER TABLE instance ADD COLUMN use_global_memory BOOLEAN NOT NULL DEFAULT 1;
ALTER TABLE instance ADD COLUMN use_global_java_args BOOLEAN NOT NULL DEFAULT 1;
ALTER TABLE instance ADD COLUMN use_global_java_path BOOLEAN NOT NULL DEFAULT 1;
ALTER TABLE instance ADD COLUMN use_global_hooks BOOLEAN NOT NULL DEFAULT 1;
ALTER TABLE instance ADD COLUMN use_global_environment_variables BOOLEAN NOT NULL DEFAULT 1;
ALTER TABLE instance ADD COLUMN use_global_game_dir BOOLEAN NOT NULL DEFAULT 1;

ALTER TABLE instance ADD COLUMN environment_variables TEXT;
ALTER TABLE instance ADD COLUMN pre_launch_hook TEXT;
ALTER TABLE instance ADD COLUMN wrapper_command TEXT;
ALTER TABLE instance ADD COLUMN post_exit_hook TEXT;
