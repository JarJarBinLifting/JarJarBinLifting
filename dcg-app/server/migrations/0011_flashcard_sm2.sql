-- 0011_flashcard_sm2: move flashcard scheduling to the explicit SM-2
-- algorithm. Legacy Leitner fields are deliberately retained: existing user
-- data stays readable and the UI can continue to show its familiar progress.
-- These fields hold the minimum SM-2 state needed to schedule each card.

ALTER TABLE flashcards ADD COLUMN sm2_repetitions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flashcards ADD COLUMN sm2_interval_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flashcards ADD COLUMN sm2_ease_factor REAL NOT NULL DEFAULT 2.5;

-- Give existing cards a conservative starting state derived from their
-- current Leitner history. Their already-scheduled review date is untouched;
-- SM-2 takes over only when the learner next grades the card.
UPDATE flashcards
SET
  sm2_repetitions = CASE
    WHEN correct_streak >= 2 THEN 2
    WHEN correct_streak = 1 THEN 1
    ELSE 0
  END,
  sm2_interval_days = CASE box_level
    WHEN 0 THEN 1
    WHEN 1 THEN 2
    WHEN 2 THEN 4
    WHEN 3 THEN 8
    WHEN 4 THEN 15
    ELSE 30
  END;

CREATE INDEX IF NOT EXISTS idx_flashcards_sm2_due ON flashcards(next_review_date, sm2_repetitions);
