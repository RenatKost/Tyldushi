-- The first discovery run rejected organizations whose site uses a foreign spelling (caritas.od.ua for
-- «Карітас»): the ranking now accepts pages with the ЄДРПОУ code or the discovery page, so they get a retry.
UPDATE organizations SET status = 'registry'
WHERE status = 'rejected_auto' AND discovered_at IS NOT NULL AND enrich_attempts < 3;
