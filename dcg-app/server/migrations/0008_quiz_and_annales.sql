-- 0008_quiz_and_annales: two exam-oriented additions.
--
-- quiz_items: a re-usable bank of previously-missed QCM questions. Every
-- generated QCM already stores its misses in tutor_sessions.qcm_results_json,
-- but nothing re-used them — this materializes each miss (question, options,
-- correct index, explication) with its own Leitner schedule so a daily "quiz
-- éclair" can re-ask real exam-style questions at zero LLM cost.
CREATE TABLE IF NOT EXISTS quiz_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id       INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  tutor_session_id INTEGER REFERENCES tutor_sessions(id) ON DELETE SET NULL,
  question         TEXT NOT NULL,
  theme            TEXT,
  options_json     TEXT NOT NULL,
  correct          INTEGER NOT NULL,
  explication      TEXT,
  box_level        INTEGER NOT NULL DEFAULT 0,
  correct_streak   INTEGER NOT NULL DEFAULT 0,
  next_review_date TEXT NOT NULL,
  last_reviewed_at TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  -- Re-missing the same question resets its schedule instead of duplicating.
  UNIQUE(chapter_id, question)
);
CREATE INDEX IF NOT EXISTS idx_quiz_items_due ON quiz_items(next_review_date);

-- Backfill from every already-completed session's stored misses, so the quiz
-- bank starts full instead of empty. json_each tolerates non-array values by
-- yielding rows the NULL-guards below filter out; json_valid skips corrupt
-- blobs entirely.
INSERT OR IGNORE INTO quiz_items
  (chapter_id, tutor_session_id, question, theme, options_json, correct, explication, next_review_date)
SELECT
  ts.chapter_id,
  ts.id,
  json_extract(m.value, '$.question'),
  json_extract(m.value, '$.theme'),
  json_extract(m.value, '$.options'),
  json_extract(m.value, '$.correct'),
  json_extract(m.value, '$.explication'),
  date('now','localtime')
FROM tutor_sessions ts, json_each(ts.qcm_results_json) m
WHERE ts.qcm_results_json IS NOT NULL
  AND json_valid(ts.qcm_results_json)
  AND json_extract(m.value, '$.question') IS NOT NULL
  AND json_type(m.value, '$.options') = 'array'
  AND json_extract(m.value, '$.correct') IS NOT NULL;

-- annale_attempts: timed training on a real past exam paper the learner
-- pastes in. The subject is structured once by the model (exercice_json,
-- same shape as the tutor's case-study phase), answers autosave as drafts
-- while the clock runs, and the correction (barème-based, optionally guided
-- by a pasted official corrigé) is stored whole. Weak answers flow into the
-- error notebook with source 'annale'.
CREATE TABLE IF NOT EXISTS annale_attempts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ue_id            INTEGER NOT NULL REFERENCES ues(id) ON DELETE CASCADE,
  chapter_id       INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  subject_text     TEXT NOT NULL,
  corrige_text     TEXT,
  duration_minutes INTEGER NOT NULL,
  exercice_json    TEXT,
  answers_json     TEXT,
  correction_json  TEXT,
  score            REAL,
  total            REAL,
  status           TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','abandoned')),
  started_at       TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at     TEXT,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_annale_attempts_ue ON annale_attempts(ue_id);
