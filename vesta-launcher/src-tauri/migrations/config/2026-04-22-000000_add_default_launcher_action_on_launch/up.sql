ALTER TABLE app_config
ADD COLUMN default_launcher_action_on_launch TEXT NOT NULL DEFAULT 'stay-open';
