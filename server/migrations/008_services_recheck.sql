-- The first backfill used a schema where "services" was optional, so Gemini skipped it.
-- Organizations left without services are checked again with the focused services call.
UPDATE organizations o SET services_checked_at = NULL
WHERE services_checked_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM organization_services s WHERE s.organization_id = o.id);
