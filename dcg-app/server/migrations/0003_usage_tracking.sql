-- 0003: track which model a tutor session used and its token usage, so
-- per-session and lifetime usage can be surfaced in the UI. Token counts are
-- always accurate (straight from the Anthropic API response); the model
-- column lets a lifetime summary attribute usage to the right per-model rate
-- even if the user changes their model choice between sessions.
ALTER TABLE tutor_sessions ADD COLUMN model TEXT NOT NULL DEFAULT 'claude-sonnet-5';
ALTER TABLE tutor_sessions ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tutor_sessions ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
