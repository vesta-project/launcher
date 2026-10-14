ALTER TABLE app_config ADD COLUMN manual_mod_dependency_policy TEXT NOT NULL DEFAULT 'ask'
    CHECK (manual_mod_dependency_policy IN ('ask', 'always', 'never'));
