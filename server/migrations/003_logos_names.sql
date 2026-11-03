-- Registry short names ("БО «БФ ...»") are noisy; cards now use a clean display name instead.
UPDATE organizations SET short_name = NULL;

-- Logos picked from og:image were often article photos. Only verified logos stored in our bucket remain.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_checked_at TIMESTAMPTZ;
UPDATE organizations SET logo_url = NULL WHERE logo_url IS NOT NULL AND logo_url NOT LIKE '/media/%';
