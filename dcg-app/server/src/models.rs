use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct Ue {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub position: i64,
    pub color: Option<String>,
    pub points_forts: Option<String>,
    pub points_faibles: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct Chapter {
    pub id: i64,
    pub ue_id: i64,
    pub name: String,
    pub position: i64,
    pub status: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct QcmScoreRow {
    pub id: i64,
    pub chapter_id: i64,
    pub tutor_session_id: Option<i64>,
    pub date: String,
    pub score: i64,
    pub total: i64,
    pub source: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct SessionLogRow {
    pub id: i64,
    pub ue_id: Option<i64>,
    pub chapter_id: Option<i64>,
    pub preset: Option<String>,
    pub duration_seconds: i64,
    pub started_at: String,
    pub ended_at: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct TutorSessionRow {
    pub id: i64,
    pub chapter_id: i64,
    pub status: String,
    pub input_source_type: Option<String>,
    pub story_json: Option<String>,
    pub concepts_json: Option<String>,
    pub confidence_json: Option<String>,
    pub qcm_json: Option<String>,
    pub qcm_results_json: Option<String>,
    pub qcm_score: Option<i64>,
    pub qcm_total: Option<i64>,
    pub socratique_transcript_json: Option<String>,
    pub exercice_json: Option<String>,
    pub bilan_json: Option<String>,
    pub adhd_mode_used: bool,
    pub difficulty: String,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub is_revision: bool,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct FlashcardRow {
    pub id: i64,
    pub chapter_id: i64,
    pub concept_id: Option<String>,
    pub question: String,
    pub answer: String,
    pub box_level: i64,
    pub correct_streak: i64,
    pub mastered: bool,
    pub last_reviewed_at: Option<String>,
    pub sm2_repetitions: i64,
    pub sm2_interval_days: i64,
    pub sm2_ease_factor: f64,
}

/// One card in the daily "révision éclair" deck, carrying just enough
/// chapter/UE context to label the card in the review UI.
#[derive(Debug, Serialize, Clone)]
pub struct DueFlashcard {
    pub id: i64,
    pub chapter_id: i64,
    pub chapter_name: String,
    pub ue_code: String,
    pub ue_color: Option<String>,
    pub concept_id: Option<String>,
    pub question: String,
    pub answer: String,
    pub box_level: i64,
    pub sm2_repetitions: i64,
    pub sm2_interval_days: i64,
    pub sm2_ease_factor: f64,
}

/// `total` is the full count of cards due today; `cards` is capped at the
/// daily deck limit so a backlog after a break stays finishable instead of
/// becoming a wall — the rest simply stays due and fills tomorrow's deck.
#[derive(Debug, Serialize)]
pub struct DueFlashcardsResponse {
    pub total: i64,
    pub cards: Vec<DueFlashcard>,
}

/// Progress is grouped by the notion identifier carried by each flashcard,
/// never collapsed into a chapter-wide average. `sample_question` keeps older
/// cards (which may have only a numeric concept id) understandable in the UI.
#[derive(Debug, Serialize, Clone)]
pub struct ConceptProgress {
    pub chapter_id: i64,
    pub chapter_name: String,
    pub ue_code: String,
    pub ue_color: Option<String>,
    pub concept_id: Option<String>,
    pub concept_label: Option<String>,
    pub sample_question: String,
    pub total_cards: i64,
    pub mastered_cards: i64,
    pub due_cards: i64,
    pub avg_sm2_repetitions: f64,
    pub next_review_date: Option<String>,
}

/// One question in the daily "quiz éclair": a previously-missed QCM question
/// re-asked with its original options. The correct index deliberately stays
/// server-side — answers are checked by the answer endpoint, one source of
/// truth for grading and scheduling.
#[derive(Debug, Serialize, Clone)]
pub struct DueQuizItem {
    pub id: i64,
    pub chapter_id: i64,
    pub chapter_name: String,
    pub ue_code: String,
    pub ue_color: Option<String>,
    pub question: String,
    pub theme: Option<String>,
    pub options: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DueQuizResponse {
    pub total: i64,
    pub items: Vec<DueQuizItem>,
}

#[derive(Debug, Serialize)]
pub struct QuizAnswerResult {
    pub was_correct: bool,
    pub correct: i64,
    pub explication: Option<String>,
    pub box_level: i64,
    pub next_review_date: String,
}

/// One timed training run on a real past exam paper (annale).
#[derive(Debug, Serialize, Clone)]
pub struct AnnaleAttempt {
    pub id: i64,
    pub ue_id: i64,
    pub ue_code: String,
    pub ue_name: String,
    pub ue_color: Option<String>,
    pub chapter_id: Option<i64>,
    pub title: String,
    pub subject_text: String,
    pub corrige_text: Option<String>,
    pub duration_minutes: i64,
    pub exercice_json: Option<String>,
    pub answers_json: Option<String>,
    pub correction_json: Option<String>,
    pub score: Option<f64>,
    pub total: Option<f64>,
    pub status: String,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct DueChapter {
    pub chapter_id: i64,
    pub chapter_name: String,
    pub ue_id: i64,
    pub ue_code: String,
    pub ue_name: String,
    pub box_level: i64,
    pub next_review_date: String,
    pub last_reviewed_date: Option<String>,
    pub last_outcome: Option<String>,
}

/// One row of the cross-UE weak-spot ranking: any chapter that's been
/// studied at least once (has a review_schedule row and/or a QCM score),
/// ranked weakest-first. `box_level`/`last_outcome`/`next_review_date` are
/// null for a chapter that only has manually-entered QCM scores and never
/// went through a full tutor session.
#[derive(Debug, Serialize, Clone)]
pub struct WeakChapter {
    pub chapter_id: i64,
    pub chapter_name: String,
    pub ue_id: i64,
    pub ue_code: String,
    pub ue_name: String,
    pub ue_color: Option<String>,
    pub box_level: Option<i64>,
    pub last_outcome: Option<String>,
    pub next_review_date: Option<String>,
    pub latest_qcm_score: Option<i64>,
    pub latest_qcm_total: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct CompleteTutorSessionResult {
    pub chapter: Chapter,
    pub qcm_score_row: QcmScoreRow,
    pub box_level: i64,
    pub outcome: String,
    pub next_review_date: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ModelUsageRow {
    pub model: String,
    pub session_count: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct ErrorNote {
    pub id: i64,
    pub ue_id: i64,
    pub ue_code: String,
    pub ue_name: String,
    pub ue_color: Option<String>,
    pub chapter_id: Option<i64>,
    pub chapter_name: Option<String>,
    pub title: String,
    pub error_type: String,
    pub skill: String,
    pub my_reasoning: Option<String>,
    pub correction: Option<String>,
    pub source: String,
    pub ladder_step: i64,
    pub status: String,
    pub next_review_date: String,
}

/// The latest self-assessed evidence for one exam skill in one UE. A missing
/// row deliberately means "not assessed yet", never a fabricated zero.
#[derive(Debug, Serialize, Clone)]
pub struct SkillProfileRow {
    pub ue_id: i64,
    pub skill: String,
    pub score: Option<i64>,
    pub note: Option<String>,
    pub recorded_at: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ExamScenarioRow {
    pub ue_id: i64,
    pub ue_code: String,
    pub ue_name: String,
    pub ue_color: Option<String>,
    pub current_mark: Option<f64>,
    pub target_mark: Option<f64>,
}
