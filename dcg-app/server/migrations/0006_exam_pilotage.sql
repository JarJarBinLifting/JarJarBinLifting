-- 0006_exam_pilotage: exam-oriented feedback loops beyond chapter completion.
-- These tables remain deliberately small and local. They are a study journal,
-- not a second LMS: every row must help decide what to practise next.

CREATE TABLE IF NOT EXISTS error_notes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ue_id             INTEGER NOT NULL REFERENCES ues(id) ON DELETE CASCADE,
  chapter_id        INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
  tutor_session_id  INTEGER REFERENCES tutor_sessions(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  error_type        TEXT NOT NULL CHECK (error_type IN ('knowledge','method','calculation','reading','time')),
  skill             TEXT NOT NULL CHECK (skill IN ('recall','method','application','technical','time')),
  my_reasoning      TEXT,
  correction        TEXT,
  source            TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','tutor','annale')),
  ladder_step       INTEGER NOT NULL DEFAULT 0 CHECK (ladder_step BETWEEN 0 AND 4),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','mastered')),
  next_review_date  TEXT NOT NULL DEFAULT (date('now')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tutor_session_id, title)
);
CREATE INDEX IF NOT EXISTS idx_error_notes_due ON error_notes(status, next_review_date);
CREATE INDEX IF NOT EXISTS idx_error_notes_ue ON error_notes(ue_id);

CREATE TABLE IF NOT EXISTS skill_assessments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ue_id        INTEGER NOT NULL REFERENCES ues(id) ON DELETE CASCADE,
  chapter_id   INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
  skill        TEXT NOT NULL CHECK (skill IN ('recall','method','application','technical','time')),
  score        INTEGER NOT NULL CHECK (score BETWEEN 1 AND 4),
  note         TEXT,
  recorded_at  TEXT NOT NULL DEFAULT (date('now')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_skill_assessments_ue_skill ON skill_assessments(ue_id, skill, recorded_at);

-- One current mark and one realistic target per UE. The interface always
-- labels its projection as being limited to the UEs the learner tracks here.
CREATE TABLE IF NOT EXISTS exam_scenarios (
  ue_id          INTEGER PRIMARY KEY REFERENCES ues(id) ON DELETE CASCADE,
  current_mark   REAL,
  target_mark    REAL,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (current_mark IS NULL OR (current_mark >= 0 AND current_mark <= 20)),
  CHECK (target_mark IS NULL OR (target_mark >= 0 AND target_mark <= 20))
);
