-- 0007_flashcard_review: give each flashcard its own spaced-repetition
-- schedule so cards can be reviewed in a daily "révision éclair" deck
-- between full tutor sessions, instead of only ever appearing inside the
-- Mémorisation phase of a session.
--
-- next_review_date is nullable at the schema level (ADD COLUMN can't take a
-- non-constant default), but every insert/update path sets it explicitly and
-- the backfill below covers pre-existing cards.
ALTER TABLE flashcards ADD COLUMN next_review_date TEXT;

-- Cards can now also be born from the error notebook (carnet d'erreurs):
-- the note's title becomes the recto, its correction the verso. Deleting a
-- note removes its card; the UNIQUE index keeps one card per note (multiple
-- NULLs are allowed in SQLite, so tutor-generated cards are unaffected).
ALTER TABLE flashcards ADD COLUMN error_note_id INTEGER REFERENCES error_notes(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_flashcards_error_note ON flashcards(error_note_id);

CREATE INDEX IF NOT EXISTS idx_flashcards_due ON flashcards(next_review_date);

-- Existing cards enter the rotation as due today; the deck's daily cap keeps
-- the first pass bounded rather than flooding every historical card at once.
UPDATE flashcards SET next_review_date = date('now','localtime') WHERE next_review_date IS NULL;
