-- 0015_chapter_started: a chapter that already carries real study work should
-- not still read as "todo" on the programme screen. Sessions, flashcards and
-- QCM scores are only ever created by actually studying, so their presence is
-- reliable evidence that the chapter was opened.
--
-- Deliberately one-way and conservative: only 'todo' -> 'ongoing'. A chapter
-- the student marked 'done' or 'ongoing' by hand is left untouched, and
-- nothing is ever demoted, so no manual decision is overwritten. Deciding a
-- chapter is finished stays a human judgement the app does not infer.
--
-- The status events are inserted BEFORE the update so old_status still reads
-- 'todo', keeping the audit trail consistent with set_chapter_status().

INSERT INTO chapter_status_events (chapter_id, old_status, new_status)
SELECT c.id, 'todo', 'ongoing'
FROM chapters c
WHERE c.status = 'todo'
  AND (
        EXISTS (SELECT 1 FROM tutor_sessions t WHERE t.chapter_id = c.id)
     OR EXISTS (SELECT 1 FROM flashcards f WHERE f.chapter_id = c.id)
     OR EXISTS (SELECT 1 FROM qcm_scores q WHERE q.chapter_id = c.id)
  );

UPDATE chapters
SET status = 'ongoing', updated_at = datetime('now')
WHERE status = 'todo'
  AND (
        EXISTS (SELECT 1 FROM tutor_sessions t WHERE t.chapter_id = chapters.id)
     OR EXISTS (SELECT 1 FROM flashcards f WHERE f.chapter_id = chapters.id)
     OR EXISTS (SELECT 1 FROM qcm_scores q WHERE q.chapter_id = chapters.id)
  );
