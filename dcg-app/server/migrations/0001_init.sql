-- 0001_init: base schema for DCG Étude
-- Journal mode is set to DELETE (not WAL) at connection time in db/mod.rs,
-- since this file is expected to live inside a cloud-synced folder and WAL's
-- -wal/-shm sidecar files interact badly with sync clients.

CREATE TABLE IF NOT EXISTS _migrations (
  version     INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS ues (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  position       INTEGER NOT NULL DEFAULT 0,
  color          TEXT,
  points_forts   TEXT,
  points_faibles TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chapters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ue_id      INTEGER NOT NULL REFERENCES ues(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','ongoing','done')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chapters_ue ON chapters(ue_id);

CREATE TABLE IF NOT EXISTS chapter_status_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_status_events_chapter ON chapter_status_events(chapter_id);

CREATE TABLE IF NOT EXISTS tutor_sessions (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id                  INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  status                      TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','abandoned')),
  input_source_type           TEXT CHECK (input_source_type IN ('paste','pdf','image')),
  story_json                  TEXT,
  concepts_json                TEXT,
  confidence_json              TEXT,
  qcm_json                     TEXT,
  qcm_results_json             TEXT,
  qcm_score                    INTEGER,
  qcm_total                    INTEGER,
  socratique_transcript_json   TEXT,
  exercice_json                 TEXT,
  bilan_json                    TEXT,
  adhd_mode_used                 INTEGER NOT NULL DEFAULT 0,
  started_at                     TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at                   TEXT,
  updated_at                     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tutor_sessions_chapter ON tutor_sessions(chapter_id);

CREATE TABLE IF NOT EXISTS qcm_scores (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id       INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  tutor_session_id INTEGER REFERENCES tutor_sessions(id) ON DELETE SET NULL,
  date             TEXT NOT NULL,
  score            INTEGER NOT NULL,
  total            INTEGER NOT NULL,
  source           TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','tutor')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_qcm_scores_chapter ON qcm_scores(chapter_id);

CREATE TABLE IF NOT EXISTS sessions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ue_id            INTEGER REFERENCES ues(id) ON DELETE SET NULL,
  chapter_id       INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
  preset           TEXT,
  duration_seconds INTEGER NOT NULL,
  started_at       TEXT NOT NULL,
  ended_at         TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_ue ON sessions(ue_id);

CREATE TABLE IF NOT EXISTS flashcards (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id       INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  tutor_session_id INTEGER REFERENCES tutor_sessions(id) ON DELETE SET NULL,
  concept_id       TEXT,
  question         TEXT NOT NULL,
  answer           TEXT NOT NULL,
  box_level        INTEGER NOT NULL DEFAULT 1,
  correct_streak   INTEGER NOT NULL DEFAULT 0,
  mastered         INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_flashcards_chapter ON flashcards(chapter_id);

CREATE TABLE IF NOT EXISTS review_schedule (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id            INTEGER NOT NULL UNIQUE REFERENCES chapters(id) ON DELETE CASCADE,
  box                   INTEGER NOT NULL DEFAULT 1,
  next_review_date      TEXT NOT NULL,
  last_reviewed_date    TEXT,
  last_outcome          TEXT CHECK (last_outcome IN ('strong','ok','weak')),
  last_tutor_session_id INTEGER REFERENCES tutor_sessions(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
