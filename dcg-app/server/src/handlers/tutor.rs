use crate::appstate::{AppError, AppState};
use crate::db::with_conn;
use crate::handlers::planner::{row_to_qcm, set_chapter_status};
use crate::handlers::scheduler::{self, SessionResult};
use crate::models::{
    CompleteTutorSessionResult, ConceptProgress, DueChapter, DueFlashcard, DueFlashcardsResponse,
    DueQuizItem, DueQuizResponse, FlashcardRow, ModelUsageRow, QuizAnswerResult, TutorSessionRow,
    WeakChapter,
};
use axum::extract::{Path, Query, State};
use axum::Json;
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::Value;

fn row_to_tutor_session(row: &rusqlite::Row) -> rusqlite::Result<TutorSessionRow> {
    Ok(TutorSessionRow {
        id: row.get(0)?,
        chapter_id: row.get(1)?,
        status: row.get(2)?,
        input_source_type: row.get(3)?,
        story_json: row.get(4)?,
        concepts_json: row.get(5)?,
        confidence_json: row.get(6)?,
        qcm_json: row.get(7)?,
        qcm_results_json: row.get(8)?,
        qcm_score: row.get(9)?,
        qcm_total: row.get(10)?,
        socratique_transcript_json: row.get(11)?,
        exercice_json: row.get(12)?,
        bilan_json: row.get(13)?,
        adhd_mode_used: row.get::<_, i64>(14)? != 0,
        difficulty: row.get(15)?,
        model: row.get(16)?,
        input_tokens: row.get(17)?,
        output_tokens: row.get(18)?,
        is_revision: row.get::<_, i64>(19)? != 0,
        is_offline_lesson: row.get::<_, i64>(20)? != 0,
        started_at: row.get(21)?,
        completed_at: row.get(22)?,
    })
}

const TUTOR_SESSION_COLUMNS: &str = "id, chapter_id, status, input_source_type, story_json, concepts_json,
    confidence_json, qcm_json, qcm_results_json, qcm_score, qcm_total,
    socratique_transcript_json, exercice_json, bilan_json, adhd_mode_used, difficulty, model, input_tokens,
    output_tokens, is_revision, is_offline_lesson, started_at, completed_at";

fn get_tutor_session(conn: &Connection, id: i64) -> rusqlite::Result<TutorSessionRow> {
    conn.query_row(
        &format!("SELECT {TUTOR_SESSION_COLUMNS} FROM tutor_sessions WHERE id = ?1"),
        params![id],
        row_to_tutor_session,
    )
}

#[derive(Debug, Deserialize)]
pub struct StartSessionRequest {
    pub chapter_id: i64,
    pub input_source_type: Option<String>,
    pub adhd_mode: bool,
    pub difficulty: String,
    pub model: String,
    pub is_revision: bool,
    /// Session driven by an imported lesson file (story/flashcards/QCM
    /// pre-generated in a claude.ai chat) — no Anthropic call is ever made.
    #[serde(default)]
    pub is_offline_lesson: bool,
    pub lesson_version_id: Option<i64>,
}

/// Reuses an in-progress session for this chapter if one exists, otherwise
/// starts a fresh one. The frontend is expected to have already resolved any
/// existing in-progress session via `get_in_progress_session` (offering the
/// user a Resume/Start-fresh choice, abandoning the old row on "fresh") — the
/// lookup here is a safety net, not the primary resume mechanism. `difficulty`,
/// `model`, and `is_revision` are only used when a new row is created; a
/// reused row keeps whatever it was originally started with.
pub async fn start_or_resume_tutor_session(
    State(state): State<AppState>,
    Json(body): Json<StartSessionRequest>,
) -> Result<Json<TutorSessionRow>, AppError> {
    with_conn(&state.db, |conn| {
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM tutor_sessions WHERE chapter_id = ?1 AND status = 'in_progress' ORDER BY id DESC LIMIT 1",
                params![body.chapter_id],
                |r| r.get(0),
            )
            .ok();

        if let Some(id) = existing {
            return get_tutor_session(conn, id);
        }

        conn.execute(
            "INSERT INTO tutor_sessions (chapter_id, input_source_type, adhd_mode_used, difficulty, model, is_revision, is_offline_lesson, lesson_version_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![body.chapter_id, body.input_source_type, body.adhd_mode as i64, body.difficulty, body.model, body.is_revision as i64, body.is_offline_lesson as i64, body.lesson_version_id],
        )?;
        let id = conn.last_insert_rowid();
        get_tutor_session(conn, id)
    })
    .map(Json)
    .map_err(AppError)
}

pub async fn get_latest_completed_session(
    State(state): State<AppState>,
    Path(chapter_id): Path<i64>,
) -> Result<Json<Option<TutorSessionRow>>, AppError> {
    with_conn(&state.db, |conn| {
        conn.query_row(
            &format!("SELECT {TUTOR_SESSION_COLUMNS} FROM tutor_sessions WHERE chapter_id = ?1 AND status = 'completed' ORDER BY id DESC LIMIT 1"),
            params![chapter_id],
            row_to_tutor_session,
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })
    })
    .map(Json)
    .map_err(AppError)
}

/// The session a chapter was mid-way through when the app was last closed —
/// gracefully (Pause is just UI state, doesn't affect this) or otherwise
/// (crash / force-quit, which never got to call `abandon_tutor_session`).
/// Drives the Resume/Start-fresh prompt in the tutor UI.
pub async fn get_in_progress_session(
    State(state): State<AppState>,
    Path(chapter_id): Path<i64>,
) -> Result<Json<Option<TutorSessionRow>>, AppError> {
    with_conn(&state.db, |conn| {
        conn.query_row(
            &format!("SELECT {TUTOR_SESSION_COLUMNS} FROM tutor_sessions WHERE chapter_id = ?1 AND status = 'in_progress' ORDER BY id DESC LIMIT 1"),
            params![chapter_id],
            row_to_tutor_session,
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })
    })
    .map(Json)
    .map_err(AppError)
}

/// Only the fields that changed are set — pass `None` for anything the
/// current phase didn't touch. Fields are never cleared once written within
/// the same session (each phase writes its own slice once, going forward).
#[derive(Debug, Deserialize)]
pub struct TutorSessionPatch {
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
    /// Latest *cumulative* token counts for the session so far (not deltas —
    /// the frontend tracks the running total in memory and resends the whole
    /// count each time), so this overwrites rather than accumulates in SQL.
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
}

fn apply_tutor_session_patch(
    conn: &Connection,
    id: i64,
    patch: &TutorSessionPatch,
) -> rusqlite::Result<TutorSessionRow> {
    conn.execute(
        "UPDATE tutor_sessions SET
            story_json = COALESCE(?1, story_json),
            concepts_json = COALESCE(?2, concepts_json),
            confidence_json = COALESCE(?3, confidence_json),
            qcm_json = COALESCE(?4, qcm_json),
            qcm_results_json = COALESCE(?5, qcm_results_json),
            qcm_score = COALESCE(?6, qcm_score),
            qcm_total = COALESCE(?7, qcm_total),
            socratique_transcript_json = COALESCE(?8, socratique_transcript_json),
            exercice_json = COALESCE(?9, exercice_json),
            bilan_json = COALESCE(?10, bilan_json),
            input_tokens = COALESCE(?11, input_tokens),
            output_tokens = COALESCE(?12, output_tokens),
            updated_at = datetime('now')
         WHERE id = ?13",
        params![
            patch.story_json,
            patch.concepts_json,
            patch.confidence_json,
            patch.qcm_json,
            patch.qcm_results_json,
            patch.qcm_score,
            patch.qcm_total,
            patch.socratique_transcript_json,
            patch.exercice_json,
            patch.bilan_json,
            patch.input_tokens,
            patch.output_tokens,
            id,
        ],
    )?;
    get_tutor_session(conn, id)
}

pub async fn save_tutor_session_progress(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(patch): Json<TutorSessionPatch>,
) -> Result<Json<TutorSessionRow>, AppError> {
    with_conn(&state.db, |conn| {
        apply_tutor_session_patch(conn, id, &patch)
    })
    .map(Json)
    .map_err(AppError)
}

pub async fn abandon_tutor_session(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<(), AppError> {
    with_conn(&state.db, |conn| {
        conn.execute("UPDATE tutor_sessions SET status = 'abandoned', updated_at = datetime('now') WHERE id = ?1", params![id])?;
        Ok(())
    })
    .map_err(AppError)
}

fn row_to_flashcard(row: &rusqlite::Row) -> rusqlite::Result<FlashcardRow> {
    Ok(FlashcardRow {
        id: row.get(0)?,
        chapter_id: row.get(1)?,
        concept_id: row.get(2)?,
        question: row.get(3)?,
        answer: row.get(4)?,
        source_ref: parse_source_reference(row.get(5)?),
        box_level: row.get(6)?,
        correct_streak: row.get(7)?,
        mastered: row.get::<_, i64>(8)? != 0,
        last_reviewed_at: row.get(9)?,
        sm2_repetitions: row.get(10)?,
        sm2_interval_days: row.get(11)?,
        sm2_ease_factor: row.get(12)?,
    })
}

const FLASHCARD_COLUMNS: &str = "id, chapter_id, concept_id, question, answer, source_ref, box_level, correct_streak, mastered, last_reviewed_at, sm2_repetitions, sm2_interval_days, sm2_ease_factor";

fn parse_source_reference(raw: Option<String>) -> Option<Value> {
    raw.and_then(|value| serde_json::from_str::<Value>(&value).ok())
}

fn source_reference_json(reference: Option<&Value>) -> Option<String> {
    reference.and_then(|value| serde_json::to_string(value).ok())
}

pub async fn list_flashcards(
    State(state): State<AppState>,
    Path(chapter_id): Path<i64>,
) -> Result<Json<Vec<FlashcardRow>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut stmt = conn.prepare(&format!(
            "SELECT {FLASHCARD_COLUMNS} FROM flashcards WHERE chapter_id = ?1 ORDER BY id"
        ))?;
        let rows = stmt.query_map(params![chapter_id], row_to_flashcard)?;
        rows.collect()
    })
    .map(Json)
    .map_err(AppError)
}

#[derive(Debug, Deserialize)]
pub struct NewFlashcard {
    pub concept_id: Option<String>,
    pub question: String,
    pub answer: String,
    #[serde(default)]
    pub source_ref: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct SaveFlashcardsRequest {
    pub tutor_session_id: i64,
    pub cards: Vec<NewFlashcard>,
}

/// Persists a freshly-generated flashcard set once per chapter. Callers
/// should check `list_flashcards` first and skip generation entirely if the
/// chapter already has cards, so they aren't regenerated every session.
pub async fn save_flashcards(
    State(state): State<AppState>,
    Path(chapter_id): Path<i64>,
    Json(body): Json<SaveFlashcardsRequest>,
) -> Result<Json<Vec<FlashcardRow>>, AppError> {
    with_conn(&state.db, |conn| {
        for card in &body.cards {
            // Due today: freshly generated cards get graded moments later in
            // the Mémorisation phase (which reschedules them), and if the
            // session is abandoned first they correctly land in tomorrow
            // morning's révision éclair deck instead of never surfacing.
            conn.execute(
                "INSERT INTO flashcards (chapter_id, tutor_session_id, concept_id, question, answer, source_ref, next_review_date)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, date('now','localtime'))",
                params![chapter_id, body.tutor_session_id, card.concept_id, card.question, card.answer, source_reference_json(card.source_ref.as_ref())],
            )?;
        }
        let mut stmt = conn.prepare(&format!("SELECT {FLASHCARD_COLUMNS} FROM flashcards WHERE chapter_id = ?1 ORDER BY id"))?;
        let rows = stmt.query_map(params![chapter_id], row_to_flashcard)?;
        rows.collect()
    })
    .map(Json)
    .map_err(AppError)
}

#[derive(Debug, Deserialize)]
pub struct FlashcardProgressRequest {
    /// SM-2 quality after active recall: 0 (forgotten) through 5 (effortless).
    /// `correct` is retained temporarily for older app builds.
    pub quality: Option<i64>,
    pub correct: Option<bool>,
}

/// Mirrors the flashcard-level Leitner queue: a correct pass advances the box
/// and streak (mastered once the streak reaches 2), a miss resets both so the
/// card recirculates. One grading path for both contexts — the Mémorisation
/// phase inside a tutor session and the standalone révision éclair deck — so
/// they share a single per-card schedule instead of drifting apart.
pub async fn update_flashcard_progress(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<FlashcardProgressRequest>,
) -> Result<Json<FlashcardRow>, AppError> {
    let quality = match body
        .quality
        .or_else(|| body.correct.map(|correct| if correct { 4 } else { 1 }))
    {
        Some(quality) if (0..=5).contains(&quality) => quality,
        Some(_) => {
            return Err(AppError(
                "La qualité de rappel doit être comprise entre 0 et 5.".to_string(),
            ))
        }
        None => {
            return Err(AppError(
                "Indique la qualité du rappel avant de passer à la carte suivante.".to_string(),
            ))
        }
    };
    with_conn(&state.db, |conn| grade_flashcard(conn, id, quality))
        .map(Json)
        .map_err(AppError)
}

fn read_exam_date(conn: &Connection) -> Option<chrono::NaiveDate> {
    conn.query_row(
        "SELECT value FROM app_meta WHERE key = 'exam_date'",
        [],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .and_then(|s| chrono::NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok())
}

fn grade_flashcard(conn: &Connection, id: i64, quality: i64) -> rusqlite::Result<FlashcardRow> {
    let (current_box, repetitions, interval_days, ease_factor): (i64, i64, i64, f64) = conn.query_row(
        "SELECT box_level, sm2_repetitions, sm2_interval_days, sm2_ease_factor FROM flashcards WHERE id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    let today = chrono::Local::now().date_naive();
    let update = scheduler::next_sm2_card_schedule(
        scheduler::Sm2CardState {
            repetitions,
            interval_days,
            ease_factor,
        },
        quality,
        today,
        read_exam_date(conn),
    );
    let recalled = quality >= 3;
    // Keep legacy display fields in sync, while the new SM-2 fields are the
    // single source of truth for the next review date.
    let box_level = if recalled { current_box + 1 } else { 0 }.clamp(0, 5);
    conn.execute(
        "UPDATE flashcards SET
            correct_streak = CASE WHEN ?1 THEN correct_streak + 1 ELSE 0 END,
            box_level = ?2,
            mastered = CASE WHEN ?3 >= 2 THEN 1 ELSE 0 END,
            sm2_repetitions = ?3,
            sm2_interval_days = ?4,
            sm2_ease_factor = ?5,
            next_review_date = ?6,
            last_reviewed_at = datetime('now'),
            updated_at = datetime('now')
         WHERE id = ?7",
        params![
            recalled as i64,
            box_level,
            update.repetitions,
            update.interval_days,
            update.ease_factor,
            update.next_review_date.to_string(),
            id
        ],
    )?;
    conn.query_row(
        &format!("SELECT {FLASHCARD_COLUMNS} FROM flashcards WHERE id = ?1"),
        params![id],
        row_to_flashcard,
    )
}

/// Hard cap on the daily révision éclair deck: a bounded, finishable stack
/// (roughly 5 minutes) beats an unbounded backlog wall after a few days
/// away. Whatever doesn't fit simply stays due and fills tomorrow's deck.
const DAILY_DECK_LIMIT: i64 = 20;
/// Inspect a wider due pool before selecting the bounded daily deck. This
/// gives the interleaver enough choice to alternate notions instead of merely
/// taking the first twenty rows from one chapter.
const DAILY_DECK_CANDIDATE_LIMIT: i64 = DAILY_DECK_LIMIT * 4;

/// The daily card deck: every card whose review date has arrived, weakest
/// state first, then deliberately interleaved across chapters and notions.
/// Costs zero LLM calls — the cards already exist.
pub async fn list_due_flashcards(
    State(state): State<AppState>,
) -> Result<Json<DueFlashcardsResponse>, AppError> {
    with_conn(&state.db, |conn| list_due_flashcards_inner(conn))
        .map(Json)
        .map_err(AppError)
}

fn list_due_flashcards_inner(conn: &Connection) -> rusqlite::Result<DueFlashcardsResponse> {
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM flashcards WHERE next_review_date IS NOT NULL AND next_review_date <= date('now','localtime')",
        [],
        |r| r.get(0),
    )?;
    let mut stmt = conn.prepare(
        "SELECT f.id, f.chapter_id, c.name, u.code, u.color, f.concept_id, f.question, f.answer, f.source_ref, f.box_level, f.sm2_repetitions, f.sm2_interval_days, f.sm2_ease_factor
         FROM flashcards f
         JOIN chapters c ON c.id = f.chapter_id
         JOIN ues u ON u.id = c.ue_id
         WHERE f.next_review_date IS NOT NULL AND f.next_review_date <= date('now','localtime')
         ORDER BY f.sm2_repetitions ASC, f.box_level ASC, f.sm2_ease_factor ASC, f.next_review_date ASC, f.id ASC
         LIMIT ?1",
    )?;
    let cards = stmt
        .query_map(params![DAILY_DECK_CANDIDATE_LIMIT], |row| {
            Ok(DueFlashcard {
                id: row.get(0)?,
                chapter_id: row.get(1)?,
                chapter_name: row.get(2)?,
                ue_code: row.get(3)?,
                ue_color: row.get(4)?,
                concept_id: row.get(5)?,
                question: row.get(6)?,
                answer: row.get(7)?,
                source_ref: parse_source_reference(row.get(8)?),
                box_level: row.get(9)?,
                sm2_repetitions: row.get(10)?,
                sm2_interval_days: row.get(11)?,
                sm2_ease_factor: row.get(12)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(DueFlashcardsResponse {
        total,
        cards: interleave_due_cards(cards, DAILY_DECK_LIMIT as usize),
    })
}

/// Returns a notion-level view of memory strength. A single chapter can be
/// secure on one concept and fragile on another, so this deliberately groups
/// cards by their `concept_id` rather than averaging the whole lesson.
pub async fn list_concept_progress(
    State(state): State<AppState>,
) -> Result<Json<Vec<ConceptProgress>>, AppError> {
    with_conn(&state.db, |conn| list_concept_progress_inner(conn))
        .map(Json)
        .map_err(AppError)
}

fn list_concept_progress_inner(conn: &Connection) -> rusqlite::Result<Vec<ConceptProgress>> {
    let mut stmt = conn.prepare(
        "SELECT f.chapter_id, c.name, u.code, u.color,
                NULLIF(f.concept_id, ''), MIN(f.question),
                COUNT(*),
                SUM(CASE WHEN f.mastered = 1 THEN 1 ELSE 0 END),
                SUM(CASE WHEN f.next_review_date IS NOT NULL AND f.next_review_date <= date('now','localtime') THEN 1 ELSE 0 END),
                COALESCE(AVG(f.sm2_repetitions), 0),
                MIN(f.next_review_date),
                MAX(f.last_reviewed_at),
                MAX(ts.story_json)
         FROM flashcards f
         JOIN chapters c ON c.id = f.chapter_id
         JOIN ues u ON u.id = c.ue_id
         LEFT JOIN tutor_sessions ts ON ts.id = f.tutor_session_id
         GROUP BY f.chapter_id, NULLIF(f.concept_id, '')",
    )?;
    let mut concepts = stmt
        .query_map([], |row| {
            let concept_id: Option<String> = row.get(4)?;
            let story_json: Option<String> = row.get(12)?;
            Ok(ConceptProgress {
                chapter_id: row.get(0)?,
                chapter_name: row.get(1)?,
                ue_code: row.get(2)?,
                ue_color: row.get(3)?,
                concept_label: concept_label_from_story(
                    concept_id.as_deref(),
                    story_json.as_deref(),
                ),
                concept_id,
                sample_question: row.get(5)?,
                total_cards: row.get(6)?,
                mastered_cards: row.get(7)?,
                due_cards: row.get(8)?,
                avg_sm2_repetitions: row.get(9)?,
                next_review_date: row.get(10)?,
                last_exposure_at: row.get(11)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    // Urgent concepts lead, then the weakest mastery ratio. Cross-multiplying
    // avoids float ordering edge cases and keeps the ordering deterministic.
    concepts.sort_by(|left, right| {
        right
            .due_cards
            .cmp(&left.due_cards)
            .then_with(|| {
                (left.mastered_cards * right.total_cards)
                    .cmp(&(right.mastered_cards * left.total_cards))
            })
            .then_with(|| left.chapter_name.cmp(&right.chapter_name))
            .then_with(|| left.concept_id.cmp(&right.concept_id))
    });
    Ok(concepts)
}

/// Flashcards historically store their source-story step as a compact string
/// ("1", "2", ...). Resolve that stable reference only when the originating
/// story is available, so the learner sees the actual DCG notion without
/// changing or migrating any existing card data.
fn concept_label_from_story(concept_id: Option<&str>, story_json: Option<&str>) -> Option<String> {
    let step = concept_id?.trim().parse::<usize>().ok()?;
    if step == 0 {
        return None;
    }
    serde_json::from_str::<serde_json::Value>(story_json?)
        .ok()?
        .get("etapes")?
        .get(step - 1)?
        .get("notion")?
        .as_str()
        .map(str::trim)
        .filter(|label| !label.is_empty())
        .map(str::to_owned)
}

/// Preserves the server's priority order while avoiding two cards from the
/// same notion or chapter when another due card is available. This is a small,
/// deterministic form of interleaving: it makes the learner retrieve and
/// discriminate between nearby rules instead of answering a run of almost
/// identical prompts by pattern matching.
fn interleave_due_cards(mut candidates: Vec<DueFlashcard>, limit: usize) -> Vec<DueFlashcard> {
    let mut deck: Vec<DueFlashcard> = Vec::with_capacity(limit.min(candidates.len()));
    while deck.len() < limit && !candidates.is_empty() {
        let selected = if let Some(last) = deck.last() {
            candidates
                .iter()
                .position(|card| {
                    card.chapter_id != last.chapter_id && card.concept_id != last.concept_id
                })
                .or_else(|| {
                    candidates
                        .iter()
                        .position(|card| card.concept_id != last.concept_id)
                })
                .or_else(|| {
                    candidates
                        .iter()
                        .position(|card| card.chapter_id != last.chapter_id)
                })
                .unwrap_or(0)
        } else {
            0
        };
        deck.push(candidates.remove(selected));
    }
    deck
}

#[derive(Debug, Deserialize)]
pub struct CompleteSessionRequest {
    pub avg_confidence: f64,
    pub overconfidence_count: i64,
}

/// `theme` and `explication` are LLM-generated and not guaranteed to be
/// present even though the prompt asks for them (the frontend hedges the
/// same way with `q.theme || "Général"`), so they must default rather than
/// fail the parse. `options`/`correct` feed the quiz éclair bank and are
/// only used when structurally sound (a real options array + an in-range
/// correct index).
#[derive(Debug, Deserialize, Default)]
struct StoredQcmMiss {
    #[serde(default)]
    question: String,
    #[serde(default)]
    theme: String,
    #[serde(default)]
    explication: String,
    #[serde(default)]
    options: Vec<serde_json::Value>,
    #[serde(default)]
    correct: Option<i64>,
    #[serde(default)]
    option_feedbacks: Vec<String>,
    #[serde(default)]
    source_ref: Option<Value>,
}

/// A QCM miss is useful only if it comes back as a concrete future action.
/// Keep the automatic diagnosis intentionally conservative (knowledge/recall)
/// rather than pretending the app can infer the student's exact reasoning.
/// The learner can add a more specific manual error note after an annale.
fn capture_tutor_misses(
    conn: &Connection,
    tutor_session_id: i64,
    chapter_id: i64,
    ue_id: i64,
    raw: Option<String>,
) -> rusqlite::Result<()> {
    let Some(raw) = raw else {
        return Ok(());
    };
    // Parse element-by-element so one malformed entry (this is stored LLM
    // output) costs only itself, not every other miss in the array.
    let misses: Vec<StoredQcmMiss> = serde_json::from_str::<Vec<serde_json::Value>>(&raw)
        .unwrap_or_default()
        .into_iter()
        .map(|v| serde_json::from_value(v).unwrap_or_default())
        .collect();
    for miss in misses {
        if miss.question.trim().is_empty() {
            continue;
        }
        let title = if miss.theme.trim().is_empty() {
            miss.question.clone()
        } else {
            format!("{} — {}", miss.theme, miss.question)
        };
        // The QCM's own explication is the best available correction — a real
        // answer, not generic advice — and doubles as the verso of the
        // flashcard minted below. Fall back to the generic next-action text
        // only when the model didn't provide one.
        let explication = miss.explication.trim();
        let correction = if explication.is_empty() {
            "Reprendre la notion, l'expliquer sans support, puis refaire une application courte."
        } else {
            explication
        };
        // NOT EXISTS: re-missing the same notion in a later session re-surfaces
        // the existing active note instead of stacking a near-duplicate; the
        // per-session UNIQUE constraint (via OR IGNORE) still covers retried
        // completion callbacks even after the original note was mastered.
        let inserted = conn.execute(
            "INSERT OR IGNORE INTO error_notes
                (ue_id, chapter_id, tutor_session_id, title, error_type, skill, correction, source, next_review_date)
             SELECT ?1, ?2, ?3, ?4, 'knowledge', 'recall', ?5, 'tutor', date('now','localtime')
             WHERE NOT EXISTS (
                 SELECT 1 FROM error_notes WHERE chapter_id = ?2 AND title = ?4 AND status = 'active'
             )",
            params![ue_id, chapter_id, tutor_session_id, title, correction],
        )?;
        // Only mint a flashcard when the answer is real content (the QCM
        // explication) — generic advice makes a useless verso. The card
        // starts at box 0 so it leads tomorrow's révision éclair deck.
        if inserted == 1 && !explication.is_empty() {
            crate::handlers::planner::create_card_for_error_note(conn, conn.last_insert_rowid())?;
        }

        // Feed the quiz éclair bank: the full question (options + correct
        // index) so it can be re-asked as-is later. Only structurally sound
        // entries qualify. Re-missing an already-banked question resets its
        // schedule instead of duplicating it.
        let correct_ok = miss
            .correct
            .is_some_and(|c| c >= 0 && (c as usize) < miss.options.len());
        if miss.options.len() >= 2 && correct_ok {
            let option_feedbacks_json = if miss.option_feedbacks.len() == miss.options.len()
                && miss
                    .option_feedbacks
                    .iter()
                    .all(|feedback| !feedback.trim().is_empty())
            {
                serde_json::to_string(&miss.option_feedbacks).ok()
            } else {
                None
            };
            conn.execute(
                "INSERT INTO quiz_items (chapter_id, tutor_session_id, question, theme, options_json, correct, explication, option_feedbacks_json, source_ref, next_review_date)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, date('now','localtime'))
                 ON CONFLICT(chapter_id, question) DO UPDATE SET
                    tutor_session_id = excluded.tutor_session_id,
                    theme = excluded.theme,
                    options_json = excluded.options_json,
                    correct = excluded.correct,
                    explication = excluded.explication,
                    option_feedbacks_json = excluded.option_feedbacks_json,
                    source_ref = excluded.source_ref,
                    box_level = 0,
                    correct_streak = 0,
                    next_review_date = date('now','localtime'),
                    updated_at = datetime('now')",
                params![
                    chapter_id,
                    tutor_session_id,
                    miss.question.trim(),
                    if miss.theme.trim().is_empty() { None } else { Some(miss.theme.trim()) },
                    serde_json::to_string(&miss.options).unwrap_or_else(|_| "[]".into()),
                    miss.correct.unwrap_or(0),
                    if explication.is_empty() { None } else { Some(explication) },
                    option_feedbacks_json,
                    source_reference_json(miss.source_ref.as_ref()),
                ],
            )?;
        }
    }
    Ok(())
}

/// Quiz questions are heavier than flashcards (read four options, commit to
/// one), so the daily stack is smaller than the card deck's 20.
const DAILY_QUIZ_LIMIT: i64 = 10;

pub async fn list_due_quiz(
    State(state): State<AppState>,
) -> Result<Json<DueQuizResponse>, AppError> {
    with_conn(&state.db, |conn| list_due_quiz_inner(conn))
        .map(Json)
        .map_err(AppError)
}

fn parse_options(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<serde_json::Value>>(raw)
        .unwrap_or_default()
        .into_iter()
        .map(|v| match v {
            serde_json::Value::String(s) => s,
            other => other.to_string(),
        })
        .collect()
}

fn parse_option_feedbacks(raw: Option<&str>) -> Vec<String> {
    raw.and_then(|value| serde_json::from_str::<Vec<String>>(value).ok())
        .unwrap_or_default()
}

fn list_due_quiz_inner(conn: &Connection) -> rusqlite::Result<DueQuizResponse> {
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM quiz_items WHERE next_review_date <= date('now','localtime')",
        [],
        |r| r.get(0),
    )?;
    let mut stmt = conn.prepare(
        "SELECT q.id, q.chapter_id, c.name, u.code, u.color, q.question, q.theme, q.options_json, q.source_ref
         FROM quiz_items q
         JOIN chapters c ON c.id = q.chapter_id
         JOIN ues u ON u.id = c.ue_id
         WHERE q.next_review_date <= date('now','localtime')
         ORDER BY q.sm2_repetitions ASC, q.box_level ASC, q.sm2_ease_factor ASC, q.next_review_date ASC, q.id ASC
         LIMIT ?1",
    )?;
    let items = stmt
        .query_map(params![DAILY_QUIZ_LIMIT], |row| {
            Ok(DueQuizItem {
                id: row.get(0)?,
                chapter_id: row.get(1)?,
                chapter_name: row.get(2)?,
                ue_code: row.get(3)?,
                ue_color: row.get(4)?,
                question: row.get(5)?,
                theme: row.get(6)?,
                options: parse_options(&row.get::<_, String>(7)?),
                source_ref: parse_source_reference(row.get(8)?),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(DueQuizResponse { total, items })
}

#[derive(Debug, Deserialize)]
pub struct QuizAnswerRequest {
    pub choice: i64,
}

/// Grades server-side (the correct index never leaves the database until the
/// answer is committed) and reschedules through the same explicit SM-2
/// algorithm as flashcards. A QCM success maps to quality 4: it demonstrates
/// solid recall, but remains recognition among options rather than a fully
/// unaided response.
pub async fn answer_quiz_item(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<QuizAnswerRequest>,
) -> Result<Json<QuizAnswerResult>, AppError> {
    with_conn(&state.db, |conn| {
        answer_quiz_item_inner(conn, id, body.choice)
    })
    .map(Json)
    .map_err(AppError)
}

fn answer_quiz_item_inner(
    conn: &Connection,
    id: i64,
    choice: i64,
) -> rusqlite::Result<QuizAnswerResult> {
    let (correct, explication, option_feedbacks_json, current_box, repetitions, interval_days, ease_factor): (i64, Option<String>, Option<String>, i64, i64, i64, f64) = conn.query_row(
        "SELECT correct, explication, option_feedbacks_json, box_level, sm2_repetitions, sm2_interval_days, sm2_ease_factor FROM quiz_items WHERE id = ?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
    )?;
    let was_correct = choice == correct;
    let choice_feedback = parse_option_feedbacks(option_feedbacks_json.as_deref())
        .get(choice.max(0) as usize)
        .map(String::to_owned);
    let today = chrono::Local::now().date_naive();
    let quality = if was_correct { 4 } else { 1 };
    let schedule = scheduler::next_sm2_card_schedule(
        scheduler::Sm2CardState {
            repetitions,
            interval_days,
            ease_factor,
        },
        quality,
        today,
        read_exam_date(conn),
    );
    // Keep legacy values readable for historical displays; SM-2 controls the
    // next date, repetitions and ease factor.
    let box_level = if was_correct { current_box + 1 } else { 0 }.clamp(0, 5);

    conn.execute(
        "UPDATE quiz_items SET
            box_level = ?1,
            correct_streak = CASE WHEN ?2 THEN correct_streak + 1 ELSE 0 END,
            sm2_repetitions = ?3,
            sm2_interval_days = ?4,
            sm2_ease_factor = ?5,
            next_review_date = ?6,
            last_reviewed_at = datetime('now'),
            updated_at = datetime('now')
         WHERE id = ?7",
        params![
            box_level,
            was_correct,
            schedule.repetitions,
            schedule.interval_days,
            schedule.ease_factor,
            schedule.next_review_date.to_string(),
            id
        ],
    )?;

    Ok(QuizAnswerResult {
        was_correct,
        correct,
        explication,
        choice_feedback,
        box_level,
        next_review_date: schedule.next_review_date.to_string(),
    })
}

/// The single write-back point from a finished tutor session into the
/// planner's world: marks the session completed, logs the QCM score, updates
/// the chapter-level Leitner schedule, and marks the chapter done.
pub async fn complete_tutor_session(
    State(state): State<AppState>,
    Path(tutor_session_id): Path<i64>,
    Json(body): Json<CompleteSessionRequest>,
) -> Result<Json<CompleteTutorSessionResult>, AppError> {
    with_conn(&state.db, |conn| {
        complete_tutor_session_inner(conn, tutor_session_id, &body)
    })
    .map(Json)
    .map_err(AppError)
}

fn complete_tutor_session_inner(
    conn: &Connection,
    tutor_session_id: i64,
    body: &CompleteSessionRequest,
) -> rusqlite::Result<CompleteTutorSessionResult> {
    let (chapter_id, qcm_score, qcm_total, qcm_results_json): (i64, Option<i64>, Option<i64>, Option<String>) = conn.query_row(
        "SELECT chapter_id, qcm_score, qcm_total, qcm_results_json FROM tutor_sessions WHERE id = ?1",
        params![tutor_session_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    let qcm_score = qcm_score.unwrap_or(0);
    let qcm_total = qcm_total.unwrap_or(0);
    let ue_id: i64 = conn.query_row(
        "SELECT ue_id FROM chapters WHERE id = ?1",
        params![chapter_id],
        |r| r.get(0),
    )?;

    conn.execute(
        "UPDATE tutor_sessions SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?1",
        params![tutor_session_id],
    )?;

    let today = chrono::Local::now().date_naive();
    let today_str = today.to_string();

    conn.execute(
        "INSERT INTO qcm_scores (chapter_id, tutor_session_id, date, score, total, source)
         VALUES (?1, ?2, ?3, ?4, ?5, 'tutor')",
        params![
            chapter_id,
            tutor_session_id,
            today_str,
            qcm_score,
            qcm_total
        ],
    )?;
    let qcm_score_id = conn.last_insert_rowid();
    let qcm_score_row = conn.query_row(
        "SELECT id, chapter_id, tutor_session_id, date, score, total, source FROM qcm_scores WHERE id = ?1",
        params![qcm_score_id],
        row_to_qcm,
    )?;

    capture_tutor_misses(conn, tutor_session_id, chapter_id, ue_id, qcm_results_json)?;

    let current_box: i64 = conn
        .query_row(
            "SELECT box FROM review_schedule WHERE chapter_id = ?1",
            params![chapter_id],
            |r| r.get(0),
        )
        .unwrap_or(1);

    let exam_date: Option<chrono::NaiveDate> = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'exam_date'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|s| chrono::NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok());

    let result = SessionResult {
        qcm_score,
        qcm_total,
        avg_confidence: body.avg_confidence,
        overconfidence_count: body.overconfidence_count,
    };
    let upd = scheduler::next_schedule(current_box, result, today, exam_date);

    conn.execute(
        "INSERT INTO review_schedule (chapter_id, box, next_review_date, last_reviewed_date, last_outcome, last_tutor_session_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(chapter_id) DO UPDATE SET
            box = excluded.box,
            next_review_date = excluded.next_review_date,
            last_reviewed_date = excluded.last_reviewed_date,
            last_outcome = excluded.last_outcome,
            last_tutor_session_id = excluded.last_tutor_session_id,
            updated_at = datetime('now')",
        params![chapter_id, upd.box_level, upd.next_review_date.to_string(), today_str, upd.outcome.as_str(), tutor_session_id],
    )?;

    let chapter = set_chapter_status(conn, chapter_id, "done")?;

    Ok(CompleteTutorSessionResult {
        chapter,
        qcm_score_row,
        box_level: upd.box_level,
        outcome: upd.outcome.as_str().to_string(),
        next_review_date: upd.next_review_date.to_string(),
    })
}

#[derive(Debug, Deserialize)]
pub struct DueChaptersQuery {
    pub within_days: i64,
}

/// Chapters whose `next_review_date` falls within `within_days` of today
/// (pass 0 for "due today", 7 for "due this week"). Chapters that have never
/// been through a tutor session have no `review_schedule` row and correctly
/// don't show up here — they belong in the normal todo/ongoing chapter list,
/// not the review agenda.
pub async fn list_due_chapters(
    State(state): State<AppState>,
    Query(q): Query<DueChaptersQuery>,
) -> Result<Json<Vec<DueChapter>>, AppError> {
    with_conn(&state.db, |conn| {
        let horizon = (chrono::Local::now().date_naive() + chrono::Duration::days(q.within_days)).to_string();
        let mut stmt = conn.prepare(
            "SELECT c.id, c.name, u.id, u.code, u.name, rs.box, rs.next_review_date, rs.last_reviewed_date, rs.last_outcome
             FROM review_schedule rs
             JOIN chapters c ON c.id = rs.chapter_id
             JOIN ues u ON u.id = c.ue_id
             WHERE rs.next_review_date <= ?1
             ORDER BY rs.next_review_date ASC",
        )?;
        let rows = stmt.query_map(params![horizon], |row| {
            Ok(DueChapter {
                chapter_id: row.get(0)?,
                chapter_name: row.get(1)?,
                ue_id: row.get(2)?,
                ue_code: row.get(3)?,
                ue_name: row.get(4)?,
                box_level: row.get(5)?,
                next_review_date: row.get(6)?,
                last_reviewed_date: row.get(7)?,
                last_outcome: row.get(8)?,
            })
        })?;
        rows.collect()
    })
    .map(Json)
    .map_err(AppError)
}

/// Every chapter that's been studied at least once (has a review_schedule
/// row from a completed tutor session, and/or a manually- or tutor-entered
/// QCM score), ranked weakest-first: lowest Leitner box first, then lowest
/// latest QCM percentage as a tiebreak. Chapters never touched at all
/// correctly don't show up — a "todo" chapter isn't weak, it's just not
/// started. Answers "what should I actually study today" in one ranked list
/// instead of the per-UE points_forts/points_faibles free text, which has to
/// be kept up to date by hand.
pub async fn list_weak_chapters(
    State(state): State<AppState>,
) -> Result<Json<Vec<WeakChapter>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut stmt = conn.prepare(
            "SELECT c.id, c.name, u.id, u.code, u.name, u.color,
                    rs.box, rs.last_outcome, rs.next_review_date,
                    latest.score, latest.total
             FROM chapters c
             JOIN ues u ON u.id = c.ue_id
             LEFT JOIN review_schedule rs ON rs.chapter_id = c.id
             LEFT JOIN qcm_scores latest ON latest.chapter_id = c.id
                AND latest.id = (
                    SELECT id FROM qcm_scores q2
                    WHERE q2.chapter_id = c.id
                    ORDER BY date DESC, id DESC
                    LIMIT 1
                )
             WHERE rs.chapter_id IS NOT NULL OR latest.chapter_id IS NOT NULL
             ORDER BY
                COALESCE(rs.box, 1) ASC,
                CASE WHEN latest.total > 0 THEN CAST(latest.score AS REAL) / latest.total ELSE 1.0 END ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(WeakChapter {
                chapter_id: row.get(0)?,
                chapter_name: row.get(1)?,
                ue_id: row.get(2)?,
                ue_code: row.get(3)?,
                ue_name: row.get(4)?,
                ue_color: row.get(5)?,
                box_level: row.get(6)?,
                last_outcome: row.get(7)?,
                next_review_date: row.get(8)?,
                latest_qcm_score: row.get(9)?,
                latest_qcm_total: row.get(10)?,
            })
        })?;
        rows.collect()
    })
    .map(Json)
    .map_err(AppError)
}

/// Lifetime token usage grouped by model — the `model` column records which
/// model each session actually used, so switching models in Settings doesn't
/// corrupt historical totals. Token counts come straight from the Anthropic
/// API's own `usage` field, so they're always accurate; converting to a
/// dollar estimate is left to the UI, which can apply current published
/// rates rather than this command guessing at pricing that changes over time.
pub async fn get_usage_summary(
    State(state): State<AppState>,
) -> Result<Json<Vec<ModelUsageRow>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut stmt = conn.prepare(
            "SELECT model, COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0)
             FROM tutor_sessions
             WHERE input_tokens > 0 OR output_tokens > 0
             GROUP BY model
             ORDER BY SUM(input_tokens + output_tokens) DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ModelUsageRow {
                model: row.get(0)?,
                session_count: row.get(1)?,
                input_tokens: row.get(2)?,
                output_tokens: row.get(3)?,
            })
        })?;
        rows.collect()
    })
    .map(Json)
    .map_err(AppError)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    /// Fresh in-memory DB, migrated, with one UE/chapter/in-progress session
    /// ready to exercise — mirrors the pattern already used in
    /// `db::migrate::tests`, but with the extra rows this module's queries
    /// need (tutor_sessions and its FK chain back to chapters/ues).
    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        // db::open enables foreign_keys in production; tests must too, or the
        // ON DELETE CASCADE paths under test silently don't fire.
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        migrate::run(&conn).unwrap();
        conn.execute("INSERT INTO ues (code, name) VALUES ('UE1', 'Test UE')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO chapters (ue_id, name) VALUES (1, 'Test chapter')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO tutor_sessions (chapter_id) VALUES (1)", [])
            .unwrap();
        conn
    }

    #[test]
    fn patch_only_overwrites_the_fields_it_sets() {
        let conn = setup();

        let first = TutorSessionPatch {
            story_json: Some(r#"{"titre":"histoire"}"#.into()),
            concepts_json: None,
            confidence_json: None,
            qcm_json: None,
            qcm_results_json: None,
            qcm_score: None,
            qcm_total: None,
            socratique_transcript_json: None,
            exercice_json: None,
            bilan_json: None,
            input_tokens: Some(100),
            output_tokens: Some(50),
        };
        let after_first = apply_tutor_session_patch(&conn, 1, &first).unwrap();
        assert_eq!(
            after_first.story_json.as_deref(),
            Some(r#"{"titre":"histoire"}"#)
        );
        assert_eq!(after_first.input_tokens, 100);

        // A later patch that only touches qcm_json must leave story_json and
        // the token counts exactly as they were — this is the COALESCE
        // behavior a resumed/crashed session depends on to not lose earlier
        // phases' output.
        let second = TutorSessionPatch {
            story_json: None,
            concepts_json: None,
            confidence_json: None,
            qcm_json: Some(r#"{"questions":[]}"#.into()),
            qcm_results_json: None,
            qcm_score: None,
            qcm_total: None,
            socratique_transcript_json: None,
            exercice_json: None,
            bilan_json: None,
            input_tokens: None,
            output_tokens: None,
        };
        let after_second = apply_tutor_session_patch(&conn, 1, &second).unwrap();
        assert_eq!(
            after_second.story_json.as_deref(),
            Some(r#"{"titre":"histoire"}"#)
        );
        assert_eq!(
            after_second.qcm_json.as_deref(),
            Some(r#"{"questions":[]}"#)
        );
        assert_eq!(after_second.input_tokens, 100);
        assert_eq!(after_second.output_tokens, 50);
    }

    #[test]
    fn patch_overwrites_token_counts_rather_than_accumulating() {
        let conn = setup();
        let patch = TutorSessionPatch {
            story_json: None,
            concepts_json: None,
            confidence_json: None,
            qcm_json: None,
            qcm_results_json: None,
            qcm_score: None,
            qcm_total: None,
            socratique_transcript_json: None,
            exercice_json: None,
            bilan_json: None,
            input_tokens: Some(10),
            output_tokens: Some(5),
        };
        apply_tutor_session_patch(&conn, 1, &patch).unwrap();
        let patch2 = TutorSessionPatch {
            input_tokens: Some(30),
            output_tokens: Some(12),
            ..no_op_patch()
        };
        let after = apply_tutor_session_patch(&conn, 1, &patch2).unwrap();
        // Frontend sends cumulative totals, not deltas — so this should land
        // on the new value (30), not 10 + 30.
        assert_eq!(after.input_tokens, 30);
        assert_eq!(after.output_tokens, 12);
    }

    fn no_op_patch() -> TutorSessionPatch {
        TutorSessionPatch {
            story_json: None,
            concepts_json: None,
            confidence_json: None,
            qcm_json: None,
            qcm_results_json: None,
            qcm_score: None,
            qcm_total: None,
            socratique_transcript_json: None,
            exercice_json: None,
            bilan_json: None,
            input_tokens: None,
            output_tokens: None,
        }
    }

    #[test]
    fn complete_tutor_session_updates_status_schedule_and_chapter() {
        let conn = setup();
        conn.execute(
            "UPDATE tutor_sessions SET qcm_score = 9, qcm_total = 10,
             qcm_results_json = '[{\"question\":\"Quel régime choisir ?\",\"theme\":\"TVA\"}]'
             WHERE id = 1",
            [],
        )
        .unwrap();

        let body = CompleteSessionRequest {
            avg_confidence: 2.5,
            overconfidence_count: 0,
        };
        let result = complete_tutor_session_inner(&conn, 1, &body).unwrap();

        assert_eq!(result.chapter.status, "done");
        assert_eq!(result.qcm_score_row.score, 9);
        assert_eq!(result.qcm_score_row.total, 10);
        // Strong performance (85%+, confidence>=2, no overconfidence) from a
        // first-ever session (baseline box 1) should advance to box 2.
        assert_eq!(result.box_level, 2);

        let status: String = conn
            .query_row("SELECT status FROM tutor_sessions WHERE id = 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(status, "completed");

        let scheduled_box: i64 = conn
            .query_row(
                "SELECT box FROM review_schedule WHERE chapter_id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(scheduled_box, 2);

        // A missed QCM question must become a concrete revision item, rather
        // than disappearing into a historical percentage once the session is
        // over. The migration's UNIQUE constraint also makes this safe if a
        // completion callback is retried.
        let errors: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM error_notes WHERE tutor_session_id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(errors, 1);
    }

    #[test]
    fn complete_tutor_session_is_idempotent_on_the_review_schedule_row() {
        let conn = setup();
        let body = CompleteSessionRequest {
            avg_confidence: 1.0,
            overconfidence_count: 3,
        };
        complete_tutor_session_inner(&conn, 1, &body).unwrap();

        // A second tutor session for the same chapter must UPDATE the
        // existing review_schedule row (ON CONFLICT), not fail on the
        // UNIQUE(chapter_id) constraint or insert a duplicate.
        conn.execute("INSERT INTO tutor_sessions (chapter_id) VALUES (1)", [])
            .unwrap();
        let second_id = conn.last_insert_rowid();
        let result = complete_tutor_session_inner(&conn, second_id, &body).unwrap();
        assert_eq!(result.outcome, "weak");

        let rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM review_schedule WHERE chapter_id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rows, 1);
    }

    fn error_note_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM error_notes", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn capture_misses_tolerates_missing_theme_and_malformed_items() {
        let conn = setup();
        // Stored LLM output: one complete item, one missing `theme` entirely,
        // one non-object garbage entry, one with no usable question. Only the
        // last two should be dropped — a missing theme must not cost the
        // whole array.
        let raw = r#"[
            {"question": "Quel régime choisir ?", "theme": "TVA"},
            {"question": "Définir l'amortissement"},
            "n'importe quoi",
            {"theme": "IS", "question": "   "}
        ]"#;
        capture_tutor_misses(&conn, 1, 1, 1, Some(raw.to_string())).unwrap();
        assert_eq!(error_note_count(&conn), 2);

        let themeless_title: String = conn
            .query_row(
                "SELECT title FROM error_notes WHERE title NOT LIKE '%—%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(themeless_title, "Définir l'amortissement");
    }

    #[test]
    fn capture_misses_survives_completely_unparseable_json() {
        let conn = setup();
        capture_tutor_misses(&conn, 1, 1, 1, Some("{not json at all".to_string())).unwrap();
        capture_tutor_misses(&conn, 1, 1, 1, None).unwrap();
        assert_eq!(error_note_count(&conn), 0);
    }

    #[test]
    fn capture_misses_reuses_an_existing_active_note_instead_of_duplicating() {
        let conn = setup();
        let raw = r#"[{"question": "Quel régime choisir ?", "theme": "TVA"}]"#;
        capture_tutor_misses(&conn, 1, 1, 1, Some(raw.to_string())).unwrap();

        // Re-missing the same notion in a later session for the same chapter
        // must not stack a near-duplicate note.
        conn.execute("INSERT INTO tutor_sessions (chapter_id) VALUES (1)", [])
            .unwrap();
        let second_session = conn.last_insert_rowid();
        capture_tutor_misses(&conn, second_session, 1, 1, Some(raw.to_string())).unwrap();
        assert_eq!(error_note_count(&conn), 1);

        // Once the note is mastered, missing the notion again is a real
        // regression — it should come back as a fresh active note.
        conn.execute(
            "UPDATE error_notes SET status = 'mastered' WHERE id = 1",
            [],
        )
        .unwrap();
        capture_tutor_misses(&conn, second_session, 1, 1, Some(raw.to_string())).unwrap();
        assert_eq!(error_note_count(&conn), 2);
        let active: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM error_notes WHERE status = 'active'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(active, 1);
    }

    // ── révision éclair: per-card schedule + due deck ──

    fn insert_card(conn: &Connection, question: &str, box_level: i64, due: &str) -> i64 {
        conn.execute(
            "INSERT INTO flashcards (chapter_id, question, answer, box_level, next_review_date) VALUES (1, ?1, 'réponse', ?2, ?3)",
            params![question, box_level, due],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn local_date_plus(days: i64) -> String {
        (chrono::Local::now().date_naive() + chrono::Duration::days(days)).to_string()
    }

    #[test]
    fn grading_a_card_with_good_recall_starts_sm2_at_one_day() {
        let conn = setup();
        let id = insert_card(&conn, "Q", 1, &local_date_plus(0));

        let card = grade_flashcard(&conn, id, 4).unwrap();
        assert_eq!(card.box_level, 2);
        assert_eq!(card.sm2_repetitions, 1);
        assert_eq!(card.sm2_interval_days, 1);
        assert_eq!(card.sm2_ease_factor, 2.5);
        let due: String = conn
            .query_row(
                "SELECT next_review_date FROM flashcards WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(due, local_date_plus(1));
    }

    #[test]
    fn missing_a_card_resets_it_to_box_zero_due_tomorrow() {
        let conn = setup();
        let id = insert_card(&conn, "Q", 4, &local_date_plus(0));
        conn.execute(
            "UPDATE flashcards SET correct_streak = 3, mastered = 1 WHERE id = ?1",
            params![id],
        )
        .unwrap();

        let card = grade_flashcard(&conn, id, 1).unwrap();
        assert_eq!(card.box_level, 0);
        assert_eq!(card.correct_streak, 0);
        assert!(!card.mastered);
        assert_eq!(card.sm2_repetitions, 0);
        assert_eq!(card.sm2_interval_days, 1);
        let due: String = conn
            .query_row(
                "SELECT next_review_date FROM flashcards WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(due, local_date_plus(1));
    }

    #[test]
    fn due_deck_is_capped_ordered_weakest_first_and_reports_the_full_total() {
        let conn = setup();
        // 25 due cards (weakest last by insertion order, to prove ordering is
        // by box, not id) + one scheduled for tomorrow that must not appear.
        for i in 0..25 {
            insert_card(&conn, &format!("Q{i}"), 3, &local_date_plus(0));
        }
        insert_card(&conn, "faible", 0, &local_date_plus(0));
        insert_card(&conn, "pas encore due", 0, &local_date_plus(1));

        let deck = list_due_flashcards_inner(&conn).unwrap();
        assert_eq!(deck.total, 26);
        assert_eq!(deck.cards.len(), 20);
        assert_eq!(deck.cards[0].question, "faible"); // box 0 outranks box 3
        assert!(deck.cards.iter().all(|c| c.question != "pas encore due"));
        assert_eq!(deck.cards[0].ue_code, "UE1");
    }

    #[test]
    fn due_cards_are_interleaved_when_an_alternative_notion_exists() {
        let card = |id: i64, chapter_id: i64, concept_id: &str| DueFlashcard {
            id,
            chapter_id,
            chapter_name: format!("Chapitre {chapter_id}"),
            ue_code: "UE1".to_string(),
            ue_color: None,
            concept_id: Some(concept_id.to_string()),
            question: format!("Question {id}"),
            answer: "Réponse".to_string(),
            source_ref: None,
            box_level: 0,
            sm2_repetitions: 0,
            sm2_interval_days: 1,
            sm2_ease_factor: 2.5,
        };
        let deck = interleave_due_cards(
            vec![
                card(1, 1, "A"),
                card(2, 1, "A"),
                card(3, 1, "B"),
                card(4, 2, "A"),
                card(5, 2, "B"),
            ],
            5,
        );
        assert_eq!(deck.len(), 5);
        assert_ne!(deck[0].chapter_id, deck[1].chapter_id);
        assert_ne!(deck[0].concept_id, deck[1].concept_id);
        assert_ne!(deck[1].chapter_id, deck[2].chapter_id);
    }

    #[test]
    fn concept_progress_is_grouped_by_notion_not_just_by_chapter() {
        let conn = setup();
        let first = insert_card(&conn, "Notion A — carte 1", 0, &local_date_plus(0));
        let second = insert_card(&conn, "Notion A — carte 2", 0, &local_date_plus(1));
        let third = insert_card(&conn, "Notion B — carte 1", 2, &local_date_plus(0));
        conn.execute(
            "UPDATE flashcards SET concept_id = 'A', mastered = 0 WHERE id IN (?1, ?2)",
            params![first, second],
        )
        .unwrap();
        conn.execute("UPDATE flashcards SET concept_id = 'B', mastered = 1, sm2_repetitions = 3 WHERE id = ?1", params![third]).unwrap();

        let concepts = list_concept_progress_inner(&conn).unwrap();
        assert_eq!(concepts.len(), 2);
        let a = concepts
            .iter()
            .find(|concept| concept.concept_id.as_deref() == Some("A"))
            .unwrap();
        let b = concepts
            .iter()
            .find(|concept| concept.concept_id.as_deref() == Some("B"))
            .unwrap();
        assert_eq!((a.total_cards, a.mastered_cards, a.due_cards), (2, 0, 1));
        assert_eq!((b.total_cards, b.mastered_cards, b.due_cards), (1, 1, 1));
        assert!(b.avg_sm2_repetitions > a.avg_sm2_repetitions);
    }

    #[test]
    fn concept_label_resolves_a_story_step_without_touching_card_data() {
        let story =
            r#"{"etapes":[{"notion":"Le fait generateur"},{"notion":"La TVA deductible"}]}"#;
        assert_eq!(
            concept_label_from_story(Some("2"), Some(story)).as_deref(),
            Some("La TVA deductible")
        );
        assert_eq!(concept_label_from_story(Some("0"), Some(story)), None);
        assert_eq!(concept_label_from_story(Some("2"), Some("not json")), None);
    }

    #[test]
    fn a_captured_miss_with_explication_mints_a_flashcard_answering_with_it() {
        let conn = setup();
        let raw = r#"[
            {"question": "Quel régime choisir ?", "theme": "TVA", "explication": "Le régime réel normal s'applique au-delà des seuils."},
            {"question": "Sans explication", "theme": "IS"}
        ]"#;
        capture_tutor_misses(&conn, 1, 1, 1, Some(raw.to_string())).unwrap();
        assert_eq!(error_note_count(&conn), 2);

        // Only the miss with real content becomes a card, at box 0, and its
        // verso is the QCM explication (not the generic advice fallback).
        let (count, answer, box_level): (i64, String, i64) = conn
            .query_row(
                "SELECT COUNT(*), MAX(answer), MAX(box_level) FROM flashcards WHERE error_note_id IS NOT NULL",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(
            answer,
            "Le régime réel normal s'applique au-delà des seuils."
        );
        assert_eq!(box_level, 0);
    }

    // ── quiz éclair: bank capture + grading ──

    #[test]
    fn a_captured_miss_with_options_feeds_the_quiz_bank_and_a_remiss_resets_it() {
        let conn = setup();
        let raw = r#"[{"question":"Quel régime ?","theme":"TVA","explication":"Réel normal.","options":["A) micro","B) simplifié","C) réel normal","D) franchise"],"correct":2}]"#;
        capture_tutor_misses(&conn, 1, 1, 1, Some(raw.to_string())).unwrap();
        let (count, correct): (i64, i64) = conn
            .query_row("SELECT COUNT(*), MAX(correct) FROM quiz_items", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!((count, correct), (1, 2));

        // Let the item climb, then re-miss it in a later session: the bank
        // must reset its schedule (box 0, due today), not grow a duplicate.
        conn.execute("UPDATE quiz_items SET box_level = 3, next_review_date = date('now','localtime','+8 days')", []).unwrap();
        conn.execute("INSERT INTO tutor_sessions (chapter_id) VALUES (1)", [])
            .unwrap();
        let second_session = conn.last_insert_rowid();
        capture_tutor_misses(&conn, second_session, 1, 1, Some(raw.to_string())).unwrap();
        let (count, box_level): (i64, i64) = conn
            .query_row("SELECT COUNT(*), MAX(box_level) FROM quiz_items", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!((count, box_level), (1, 0));
    }

    #[test]
    fn quiz_bank_keeps_the_declared_source_excerpt() {
        let conn = setup();
        let raw = r#"[{"question":"Quelle regle ?","theme":"TVA","explication":"La regle attendue.","options":["A","B","C","D"],"correct":2,"source_ref":{"section":"2.1","extrait":"Le regime reel normal s'applique lorsque les conditions du support sont reunies."}}]"#;
        capture_tutor_misses(&conn, 1, 1, 1, Some(raw.to_string())).unwrap();

        let deck = list_due_quiz_inner(&conn).unwrap();
        assert_eq!(deck.items.len(), 1);
        assert_eq!(
            deck.items[0].source_ref,
            Some(serde_json::json!({
                "section": "2.1",
                "extrait": "Le regime reel normal s'applique lorsque les conditions du support sont reunies."
            }))
        );
    }

    #[test]
    fn quiz_replay_explains_why_the_selected_distractor_is_tempting() {
        let conn = setup();
        let raw = r#"[{"question":"Quel regime ?","theme":"TVA","explication":"Le reel normal est requis.","options":["A) micro","B) simplifie","C) reel normal"],"correct":2,"option_feedbacks":["Le micro semble simple, mais le seuil est depasse.","Le simplifie est proche, mais ses conditions ne sont pas reunies.","C'est la bonne qualification."]}]"#;
        capture_tutor_misses(&conn, 1, 1, 1, Some(raw.to_string())).unwrap();
        let id: i64 = conn
            .query_row("SELECT id FROM quiz_items", [], |row| row.get(0))
            .unwrap();

        let result = answer_quiz_item_inner(&conn, id, 1).unwrap();
        assert!(!result.was_correct);
        assert_eq!(
            result.choice_feedback.as_deref(),
            Some("Le simplifie est proche, mais ses conditions ne sont pas reunies.")
        );
        assert_eq!(
            result.explication.as_deref(),
            Some("Le reel normal est requis.")
        );
    }

    #[test]
    fn structurally_broken_misses_stay_out_of_the_quiz_bank() {
        let conn = setup();
        // No options at all; a single option; correct index out of range.
        let raw = r#"[
            {"question": "Sans options", "correct": 0},
            {"question": "Une seule option", "options": ["A"], "correct": 0},
            {"question": "Index hors limites", "options": ["A","B"], "correct": 5}
        ]"#;
        capture_tutor_misses(&conn, 1, 1, 1, Some(raw.to_string())).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM quiz_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
        // They still became error notes — the notebook is more lenient than
        // the quiz bank on purpose.
        assert_eq!(error_note_count(&conn), 3);
    }

    #[test]
    fn answering_a_quiz_item_grades_server_side_and_reschedules() {
        let conn = setup();
        conn.execute(
            "INSERT INTO quiz_items (chapter_id, question, options_json, correct, explication, next_review_date)
             VALUES (1, 'Q', '[\"A\",\"B\",\"C\"]', 1, 'Parce que B.', date('now','localtime'))",
            [],
        )
        .unwrap();

        let wrong = answer_quiz_item_inner(&conn, 1, 2).unwrap();
        assert!(!wrong.was_correct);
        assert_eq!(wrong.correct, 1);
        assert_eq!(wrong.explication.as_deref(), Some("Parce que B."));
        assert_eq!(wrong.box_level, 0);
        assert_eq!(wrong.next_review_date, local_date_plus(1));

        let right = answer_quiz_item_inner(&conn, 1, 1).unwrap();
        assert!(right.was_correct);
        assert_eq!(right.box_level, 1);
        assert_eq!(right.next_review_date, local_date_plus(1));

        let second_right = answer_quiz_item_inner(&conn, 1, 1).unwrap();
        assert!(second_right.was_correct);
        assert_eq!(second_right.next_review_date, local_date_plus(6));

        let deck = list_due_quiz_inner(&conn).unwrap();
        assert_eq!(deck.total, 0); // rescheduled out of today
    }

    #[test]
    fn deleting_an_error_note_removes_its_card_but_not_tutor_cards() {
        let conn = setup();
        insert_card(&conn, "carte de session", 1, &local_date_plus(0));
        let raw = r#"[{"question": "Q ratée", "theme": "TVA", "explication": "La bonne règle."}]"#;
        capture_tutor_misses(&conn, 1, 1, 1, Some(raw.to_string())).unwrap();

        let before: i64 = conn
            .query_row("SELECT COUNT(*) FROM flashcards", [], |r| r.get(0))
            .unwrap();
        assert_eq!(before, 2);

        conn.execute("DELETE FROM error_notes", []).unwrap();
        let after: i64 = conn
            .query_row("SELECT COUNT(*) FROM flashcards", [], |r| r.get(0))
            .unwrap();
        assert_eq!(after, 1);
    }
}
