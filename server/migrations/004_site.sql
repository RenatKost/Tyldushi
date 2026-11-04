-- Requests from the site's forms (help, contact, volunteering/partnership).
CREATE TABLE IF NOT EXISTS help_requests (
    id            SERIAL PRIMARY KEY,
    kind          TEXT NOT NULL DEFAULT 'help' CHECK (kind IN ('help', 'contact', 'partner')),
    name          TEXT NOT NULL,
    phone         TEXT,
    contact       TEXT,
    role          TEXT,
    direction     TEXT,
    message       TEXT,
    status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'done')),
    handled_by    TEXT,
    tg_message_id BIGINT,
    ip            TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS help_requests_status_idx ON help_requests (status, created_at DESC);

-- Editable site content: bank details, working hours.
CREATE TABLE IF NOT EXISTS site_settings (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bank details from the Ukreximbank account certificate of 06.10.2025.
INSERT INTO site_settings (key, value) VALUES ('bank_details', '{
    "recipient": "БО «Благодійний фонд «Тил Душі»",
    "edrpou": "46068117",
    "iban": "UA233223130000026006000059063",
    "bank": "АТ «Укрексімбанк»",
    "mfo": "322313",
    "purpose": "Благодійний внесок на статутну діяльність",
    "currencies": "UAH, USD, EUR",
    "swift_note": ""
}'::jsonb) ON CONFLICT (key) DO NOTHING;

INSERT INTO site_settings (key, value) VALUES ('work_hours', '""'::jsonb) ON CONFLICT (key) DO NOTHING;

-- "Наші події" on the home page.
CREATE TABLE IF NOT EXISTS site_events (
    id          SERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    text        TEXT,
    event_date  DATE,
    image_url   TEXT,
    link        TEXT,
    position    INTEGER NOT NULL DEFAULT 0,
    published   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
