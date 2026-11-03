ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS registry_purpose TEXT,
    ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS organizations_queue_idx
    ON organizations (status, priority DESC, registered_at DESC NULLS LAST);
