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

#[derive(Debug, Serialize, Clone)]
pub struct CompleteTutorSessionResult {
    pub chapter: Chapter,
    pub qcm_score_row: QcmScoreRow,
    pub box_level: i64,
    pub outcome: String,
    pub next_review_date: String,
}
