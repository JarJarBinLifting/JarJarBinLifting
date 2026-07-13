-- 0004: flag a tutor session as a short "revision" pass (targeted QCM +
-- Socratic dialogue against a prior compte-rendu, skipping the narrative
-- discovery and the case-study exercise) rather than a full first-time
-- learning session. Persisted so a crash-resumed session picks the right
-- phase sequence instead of expecting stages that mode never runs.
ALTER TABLE tutor_sessions ADD COLUMN is_revision INTEGER NOT NULL DEFAULT 0;
