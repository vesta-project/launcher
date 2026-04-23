ALTER TABLE instance
ADD COLUMN use_global_launcher_action BOOLEAN NOT NULL DEFAULT 1;

ALTER TABLE instance
ADD COLUMN launcher_action_on_launch TEXT;
