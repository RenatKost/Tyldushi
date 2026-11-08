-- Web-first discovery: active organizations are found on the web first, then matched to the registry.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS discovery JSONB;

CREATE TABLE IF NOT EXISTS discovery_queries (
    query       TEXT PRIMARY KEY,
    last_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    results     INT NOT NULL DEFAULT 0,
    matched     INT NOT NULL DEFAULT 0
);

-- Registry queue: organizations registered before 2014 rarely have any web presence (all 95 automatic
-- rejections so far), clubs, choirs and co-operatives are not help organizations.
UPDATE organizations SET priority = priority
    + CASE WHEN registered_at < '2014-01-01' THEN -30 WHEN registered_at >= '2022-01-01' THEN 30 ELSE 0 END
    + CASE WHEN upper(name) ~ '(ХОР|АНСАМБЛ|КООПЕРАТИВ|ГАРАЖ|САДІВН|ДАЧН|МИСЛИВ|РИБАЛ|ОСББ|ПРОФСПІЛК|ПАРТІ)' THEN -40 ELSE 0 END
WHERE status = 'registry';
