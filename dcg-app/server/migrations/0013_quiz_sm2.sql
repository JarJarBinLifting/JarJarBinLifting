-- 0013_quiz_sm2: the daily QCM bank uses the same explicit SM-2 state as
-- flashcards. Legacy Leitner fields and existing due dates stay intact so no
-- learner loses a planned review during the transition.

ALTER TABLE quiz_items ADD COLUMN sm2_repetitions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quiz_items ADD COLUMN sm2_interval_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quiz_items ADD COLUMN sm2_ease_factor REAL NOT NULL DEFAULT 2.5;

UPDATE quiz_items
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

CREATE INDEX IF NOT EXISTS idx_quiz_items_sm2_due ON quiz_items(next_review_date, sm2_repetitions);
