-- Activity rating
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS activity_score   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS activity_level   TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS activity_details JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS last_activity_at DATE,
    ADD COLUMN IF NOT EXISTS tg_posts_90d     INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tg_checked_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verified_by_fund BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS has_reports      BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS review_count     INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS review_avg       REAL;

CREATE INDEX IF NOT EXISTS organizations_public_order_idx
    ON organizations (status, is_featured DESC, activity_score DESC);

-- Cases become a dated activity feed
ALTER TABLE organization_cases
    ADD COLUMN IF NOT EXISTS kind   TEXT NOT NULL DEFAULT 'aid',
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'bot';

-- Public comments
CREATE TABLE IF NOT EXISTS organization_reviews (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    author_name     TEXT NOT NULL,
    text            TEXT NOT NULL,
    rating          SMALLINT CHECK (rating BETWEEN 1 AND 5),
    status          TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden')),
    ip_hash         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_reviews_org_idx ON organization_reviews (organization_id, status, created_at DESC);

-- Interpretations of free-text search requests ("Пошук по запиту")
CREATE TABLE IF NOT EXISTS query_cache (
    query      TEXT PRIMARY KEY,
    result     JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No more Telegram moderation: everything that was waiting is published.
UPDATE organizations SET status = 'approved' WHERE status = 'pending';

-- Organizations rejected on 2026-11-04 only because the search engine was blocked go back to the queue.
UPDATE organizations SET status = 'registry', enrich_attempts = 0, enrich_error = NULL
WHERE status = 'rejected_auto' AND enrich_error = 'Не знайдено сайту чи соцмереж організації'
  AND enriched_at >= '2026-11-03';
