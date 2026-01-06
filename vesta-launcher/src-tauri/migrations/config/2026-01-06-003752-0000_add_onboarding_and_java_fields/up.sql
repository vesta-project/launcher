-- Add onboarding fields to app_config
ALTER TABLE app_config ADD COLUMN setup_completed BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE app_config ADD COLUMN setup_step INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_config ADD COLUMN tutorial_completed BOOLEAN NOT NULL DEFAULT 0;

-- Create table for global Java paths
CREATE TABLE global_java_paths (
    major_version INTEGER PRIMARY KEY,
    path TEXT NOT NULL,
    is_managed BOOLEAN NOT NULL DEFAULT 0
);
