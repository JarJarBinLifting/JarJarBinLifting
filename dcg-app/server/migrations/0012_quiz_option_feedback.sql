-- 0012_quiz_option_feedback: preserve the explanation tied to each QCM
-- distractor. A later Quiz éclair can then explain why the learner's chosen
-- wrong answer was plausible, not merely display the generic correction.

ALTER TABLE quiz_items ADD COLUMN option_feedbacks_json TEXT;
