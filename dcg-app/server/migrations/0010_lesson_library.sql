CREATE TABLE IF NOT EXISTS lesson_versions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id         INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  version_number     INTEGER NOT NULL,
  format_version     INTEGER NOT NULL,
  prompt_version     INTEGER,
  difficulty         TEXT NOT NULL,
  source             TEXT,
  generated_at       TEXT,
  generated_with     TEXT,
  raw_json           TEXT NOT NULL,
  story_steps        INTEGER NOT NULL,
  flashcard_count    INTEGER NOT NULL,
  qcm_count          INTEGER NOT NULL,
  warning_count      INTEGER NOT NULL DEFAULT 0,
  is_active          INTEGER NOT NULL DEFAULT 1,
  imported_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(chapter_id, version_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lesson_active_chapter
  ON lesson_versions(chapter_id) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS lesson_flags (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_version_id  INTEGER NOT NULL REFERENCES lesson_versions(id) ON DELETE CASCADE,
  item_type          TEXT NOT NULL CHECK(item_type IN ('flashcard','qcm','lesson')),
  item_index         INTEGER,
  reason             TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_lesson_flags_active ON lesson_flags(lesson_version_id, status);

ALTER TABLE tutor_sessions ADD COLUMN lesson_version_id INTEGER REFERENCES lesson_versions(id) ON DELETE SET NULL;

-- Preserve imported lessons created before the library existed. Their source
-- metadata is unknown, but the stored story/QCM and chapter flashcards are
-- enough to create a recoverable legacy version.
INSERT INTO lesson_versions
  (chapter_id, version_number, format_version, prompt_version, difficulty, source,
   generated_with, raw_json, story_steps, flashcard_count, qcm_count, warning_count)
SELECT
  ts.chapter_id, 1, 1, NULL, ts.difficulty, 'Import antérieur à la bibliothèque',
  'Version historique',
  json_object(
    'format','dcg-lesson','version',1,'chapitre',c.name,'difficulty',ts.difficulty,
    'story',json(ts.story_json),
    'flashcards',json(COALESCE((
      SELECT json_group_array(json_object('recto',f.question,'verso',f.answer,'etape',0))
      FROM flashcards f WHERE f.chapter_id = ts.chapter_id
    ), '[]')),
    'qcm',json(ts.qcm_json)
  ),
  json_array_length(json_extract(ts.story_json,'$.etapes')),
  (SELECT COUNT(*) FROM flashcards f WHERE f.chapter_id = ts.chapter_id),
  json_array_length(json_extract(ts.qcm_json,'$.questions')),
  1
FROM tutor_sessions ts JOIN chapters c ON c.id = ts.chapter_id
WHERE ts.id = (
  SELECT ts2.id FROM tutor_sessions ts2
  WHERE ts2.chapter_id = ts.chapter_id AND ts2.story_json IS NOT NULL AND ts2.qcm_json IS NOT NULL
    AND json_valid(ts2.story_json) AND json_valid(ts2.qcm_json)
  ORDER BY ts2.id DESC LIMIT 1
)
AND json_array_length(json_extract(ts.story_json,'$.etapes')) > 0
AND json_array_length(json_extract(ts.qcm_json,'$.questions')) > 0
AND (SELECT COUNT(*) FROM flashcards f WHERE f.chapter_id = ts.chapter_id) > 0;

UPDATE tutor_sessions
SET lesson_version_id = (
  SELECT lv.id FROM lesson_versions lv WHERE lv.chapter_id = tutor_sessions.chapter_id AND lv.is_active = 1
)
WHERE is_offline_lesson = 1;
