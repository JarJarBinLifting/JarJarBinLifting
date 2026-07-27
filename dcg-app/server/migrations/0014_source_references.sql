-- 0014_source_references: keep the declared chapter excerpt alongside each
-- imported flashcard and banked QCM. Nullable columns preserve every existing
-- lesson and its SM-2 schedule unchanged.

ALTER TABLE flashcards ADD COLUMN source_ref TEXT;
ALTER TABLE quiz_items ADD COLUMN source_ref TEXT;
