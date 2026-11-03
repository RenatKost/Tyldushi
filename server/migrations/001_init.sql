CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS organizations (
    id              SERIAL PRIMARY KEY,
    slug            TEXT NOT NULL UNIQUE,
    edrpou          TEXT UNIQUE,
    name            TEXT NOT NULL,
    short_name      TEXT,
    org_type        TEXT NOT NULL DEFAULT 'public_org'
                    CHECK (org_type IN ('charity_fund', 'public_org')),
    city            TEXT,
    region          TEXT,
    address         TEXT,
    head_name       TEXT,
    registered_at   DATE,
    registry_state  TEXT,
    description     TEXT,
    help_categories TEXT[] NOT NULL DEFAULT '{}',
    contacts        JSONB NOT NULL DEFAULT '{}'::jsonb,
    logo_url        TEXT,
    status          TEXT NOT NULL DEFAULT 'registry'
                    CHECK (status IN ('registry', 'enriching', 'pending', 'approved',
                                      'rejected', 'rejected_auto', 'hidden')),
    is_featured     BOOLEAN NOT NULL DEFAULT FALSE,
    featured_rank   INTEGER,
    sources         JSONB NOT NULL DEFAULT '[]'::jsonb,
    ai_confidence   REAL,
    enrich_attempts INTEGER NOT NULL DEFAULT 0,
    enrich_error    TEXT,
    enriched_at     TIMESTAMPTZ,
    tg_message_id   BIGINT,
    tg_sent_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organizations_status_city_idx ON organizations (status, city);
CREATE INDEX IF NOT EXISTS organizations_featured_idx ON organizations (is_featured, featured_rank);
CREATE INDEX IF NOT EXISTS organizations_name_trgm_idx ON organizations USING gin (name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS organization_cases (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    description     TEXT,
    image_url       TEXT,
    happened_at     DATE,
    source_url      TEXT,
    position        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS organization_cases_org_idx ON organization_cases (organization_id, position);

CREATE TABLE IF NOT EXISTS job_runs (
    id          SERIAL PRIMARY KEY,
    job         TEXT NOT NULL,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    ok          BOOLEAN,
    stats       JSONB NOT NULL DEFAULT '{}'::jsonb,
    error       TEXT
);

-- Telegram conversation state for "edit field" flows (one admin, small table).
CREATE TABLE IF NOT EXISTS tg_state (
    chat_id    BIGINT PRIMARY KEY,
    state      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
