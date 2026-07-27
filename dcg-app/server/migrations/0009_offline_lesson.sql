-- Sessions started from an imported "leçon Claude" file (story + flashcards +
-- QCM generated in a claude.ai chat, no API key) run fully offline: the flag
-- lets resume and revision flows know not to attempt any Anthropic call.
ALTER TABLE tutor_sessions ADD COLUMN is_offline_lesson INTEGER NOT NULL DEFAULT 0;
