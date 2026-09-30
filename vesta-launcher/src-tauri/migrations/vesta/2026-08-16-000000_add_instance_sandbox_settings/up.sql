ALTER TABLE instance ADD COLUMN use_global_sandbox BOOLEAN NOT NULL DEFAULT 1;
ALTER TABLE instance ADD COLUMN sandbox_preset TEXT;
ALTER TABLE instance ADD COLUMN sandbox_wrapper_nesting TEXT;
ALTER TABLE instance ADD COLUMN sandbox_extra_paths TEXT NOT NULL DEFAULT '[]';
