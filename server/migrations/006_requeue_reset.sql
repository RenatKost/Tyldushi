-- Organizations returned to the queue must not count against today's enrichment limit.
UPDATE organizations SET enriched_at = NULL WHERE status = 'registry' AND enriched_at IS NOT NULL;
