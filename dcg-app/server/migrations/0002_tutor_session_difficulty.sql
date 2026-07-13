-- 0002: persist the QCM difficulty a tutor session was started with, so a
-- resumed session (after a crash/force-quit) can regenerate QCM/exercice
-- content at the right level without asking the user again.
ALTER TABLE tutor_sessions ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'Fondamental';
