-- Concrete services an organization provides, each backed by a quote and a source.
CREATE TABLE IF NOT EXISTS organization_services (
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    service         TEXT NOT NULL,
    quote           TEXT,
    source_url      TEXT,
    audiences       TEXT[] NOT NULL DEFAULT '{}',
    source          TEXT NOT NULL DEFAULT 'bot',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, service)
);

CREATE INDEX IF NOT EXISTS organization_services_service_idx ON organization_services (service);

-- Everything the monitor has seen: Telegram posts, YouTube videos, site news, news mentions.
CREATE TABLE IF NOT EXISTS monitor_items (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    source          TEXT NOT NULL CHECK (source IN ('telegram', 'youtube', 'site', 'news')),
    url             TEXT NOT NULL,
    title           TEXT,
    text            TEXT,
    published_at    DATE,
    processed       BOOLEAN NOT NULL DEFAULT FALSE,
    relevant        BOOLEAN,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, url)
);

CREATE INDEX IF NOT EXISTS monitor_items_queue_idx ON monitor_items (processed, organization_id);

ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS services_checked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS web_checked_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS youtube_channel_id  TEXT;

-- Cases found by the monitor point to the post they came from; never insert the same post twice.
CREATE UNIQUE INDEX IF NOT EXISTS organization_cases_source_url_idx
    ON organization_cases (organization_id, source_url) WHERE source_url IS NOT NULL AND source = 'monitor';
