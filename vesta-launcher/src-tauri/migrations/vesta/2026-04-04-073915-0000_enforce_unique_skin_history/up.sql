-- Remove orphans or duplicates that might violate the new constraint
DELETE FROM account_skin_history
WHERE id NOT IN (
    SELECT MAX(id)
    FROM account_skin_history
    GROUP BY account_uuid, texture_key
);

-- We create a unique index which our UPSERT logic will use as the conflict target.
CREATE UNIQUE INDEX idx_account_skin_history_unique_identity ON account_skin_history(account_uuid, texture_key);
