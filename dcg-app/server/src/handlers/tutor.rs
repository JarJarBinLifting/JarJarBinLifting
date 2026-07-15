use crate::appstate::{AppError, AppState};
use crate::db::with_conn;
use crate::handlers::planner::{row_to_qcm, set_chapter_status};
use crate::handlers::scheduler::{self, SessionResult};
use crate::models::{CompleteTutorSessionResult, DueChapter, FlashcardRow, ModelUsageRow, TutorSessionRow, WeakChapter};
use axum::extract::{Path, Query, State};
use axum::Json;
use rusqlite::{params, Connection};
use serde::Deserialize;

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
        started_at: row.get(20)?,
        completed_at: row.get(21)?,
    })
}

const TUTOR_SESSION_COLUMNS: &str = "id, chapter_id, status, input_source_type, story_json, concepts_json,
    confidence_json, qcm_json, qcm_results_json, qcm_score, qcm_total,
    socratique_transcript_json, exercice_json, bilan_json, adhd_mode_used, difficulty, model, input_tokens,
    output_tokens, is_revision, started_at, completed_at";

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
}

/// Reuses an in-progress session for this chapter if one exists, otherwise
/// starts a fresh one. The frontend is expected to have already resolved any
/// existing in-progress session via `get_in_progress_session` (offering the
/// user a Resume/Start-fresh choice, abandoning the old row on "fresh") — the
/// lookup here is a safety net, not the primary resume mechanism. `difficulty`,
/// `model`, and `is_revision` are only used when a new row is created; a
/// reused row keeps whatever it was originally started with.
pub async fn start_or_resume_tutor_session(State(state): State<AppState>, Json(body): Json<StartSessionRequest>) -> Result<Json<TutorSessionRow>, AppError> {
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
            "INSERT INTO tutor_sessions (chapter_id, input_source_type, adhd_mode_used, difficulty, model, is_revision)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![body.chapter_id, body.input_source_type, body.adhd_mode as i64, body.difficulty, body.model, body.is_revision as i64],
        )?;
        let id = conn.last_insert_rowid();
        get_tutor_session(conn, id)
    })
    .map(Json)
    .map_err(AppError)
}

pub async fn get_latest_completed_session(State(state): State<AppState>, Path(chapter_id): Path<i64>) -> Result<Json<Option<TutorSessionRow>>, AppError> {
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
pub async fn get_in_progress_session(State(state): State<AppState>, Path(chapter_id): Path<i64>) -> Result<Json<Option<TutorSessionRow>>, AppError> {
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

fn apply_tutor_session_patch(conn: &Connection, id: i64, patch: &TutorSessionPatch) -> rusqlite::Result<TutorSessionRow> {
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

pub async fn save_tutor_session_progress(State(state): State<AppState>, Path(id): Path<i64>, Json(patch): Json<TutorSessionPatch>) -> Result<Json<TutorSessionRow>, AppError> {
    with_conn(&state.db, |conn| apply_tutor_session_patch(conn, id, &patch))
        .map(Json)
        .map_err(AppError)
}

pub async fn abandon_tutor_session(State(state): State<AppState>, Path(id): Path<i64>) -> Result<(), AppError> {
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
        box_level: row.get(5)?,
        correct_streak: row.get(6)?,
        mastered: row.get::<_, i64>(7)? != 0,
        last_reviewed_at: row.get(8)?,
    })
}

const FLASHCARD_COLUMNS: &str = "id, chapter_id, concept_id, question, answer, box_level, correct_streak, mastered, last_reviewed_at";

pub async fn list_flashcards(State(state): State<AppState>, Path(chapter_id): Path<i64>) -> Result<Json<Vec<FlashcardRow>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut stmt = conn.prepare(&format!("SELECT {FLASHCARD_COLUMNS} FROM flashcards WHERE chapter_id = ?1 ORDER BY id"))?;
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
}

#[derive(Debug, Deserialize)]
pub struct SaveFlashcardsRequest {
    pub tutor_session_id: i64,
    pub cards: Vec<NewFlashcard>,
}

/// Persists a freshly-generated flashcard set once per chapter. Callers
/// should check `list_flashcards` first and skip generation entirely if the
/// chapter already has cards, so they aren't regenerated every session.
pub async fn save_flashcards(State(state): State<AppState>, Path(chapter_id): Path<i64>, Json(body): Json<SaveFlashcardsRequest>) -> Result<Json<Vec<FlashcardRow>>, AppError> {
    with_conn(&state.db, |conn| {
        for card in &body.cards {
            conn.execute(
                "INSERT INTO flashcards (chapter_id, tutor_session_id, concept_id, question, answer)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![chapter_id, body.tutor_session_id, card.concept_id, card.question, card.answer],
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
    pub correct: bool,
}

/// Mirrors the flashcard-level Leitner queue: a correct pass advances the box
/// and streak (mastered once the streak reaches 2), a miss resets both so the
/// card recirculates.
pub async fn update_flashcard_progress(State(state): State<AppState>, Path(id): Path<i64>, Json(body): Json<FlashcardProgressRequest>) -> Result<Json<FlashcardRow>, AppError> {
    with_conn(&state.db, |conn| {
        if body.correct {
            conn.execute(
                "UPDATE flashcards SET
                    correct_streak = correct_streak + 1,
                    box_level = MIN(box_level + 1, 3),
                    mastered = CASE WHEN correct_streak + 1 >= 2 THEN 1 ELSE 0 END,
                    last_reviewed_at = datetime('now'),
                    updated_at = datetime('now')
                 WHERE id = ?1",
                params![id],
            )?;
        } else {
            conn.execute(
                "UPDATE flashcards SET
                    correct_streak = 0,
                    box_level = 0,
                    mastered = 0,
                    last_reviewed_at = datetime('now'),
                    updated_at = datetime('now')
                 WHERE id = ?1",
                params![id],
            )?;
        }
        conn.query_row(&format!("SELECT {FLASHCARD_COLUMNS} FROM flashcards WHERE id = ?1"), params![id], row_to_flashcard)
    })
    .map(Json)
    .map_err(AppError)
}

#[derive(Debug, Deserialize)]
pub struct CompleteSessionRequest {
    pub avg_confidence: f64,
    pub overconfidence_count: i64,
}

/// `theme` is LLM-generated and not guaranteed to be present even though the
/// prompt asks for it (the frontend hedges the same way with `q.theme ||
/// "Général"`), so it must default rather than fail the parse.
#[derive(Debug, Deserialize, Default)]
struct StoredQcmMiss {
    #[serde(default)]
    question: String,
    #[serde(default)]
    theme: String,
}

/// A QCM miss is useful only if it comes back as a concrete future action.
/// Keep the automatic diagnosis intentionally conservative (knowledge/recall)
/// rather than pretending the app can infer the student's exact reasoning.
/// The learner can add a more specific manual error note after an annale.
fn capture_tutor_misses(conn: &Connection, tutor_session_id: i64, chapter_id: i64, ue_id: i64, raw: Option<String>) -> rusqlite::Result<()> {
    let Some(raw) = raw else { return Ok(()); };
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
            miss.question
        } else {
            format!("{} — {}", miss.theme, miss.question)
        };
        // NOT EXISTS: re-missing the same notion in a later session re-surfaces
        // the existing active note instead of stacking a near-duplicate; the
        // per-session UNIQUE constraint (via OR IGNORE) still covers retried
        // completion callbacks even after the original note was mastered.
        conn.execute(
            "INSERT OR IGNORE INTO error_notes
                (ue_id, chapter_id, tutor_session_id, title, error_type, skill, correction, source, next_review_date)
             SELECT ?1, ?2, ?3, ?4, 'knowledge', 'recall', ?5, 'tutor', date('now','localtime')
             WHERE NOT EXISTS (
                 SELECT 1 FROM error_notes WHERE chapter_id = ?2 AND title = ?4 AND status = 'active'
             )",
            params![
                ue_id,
                chapter_id,
                tutor_session_id,
                title,
                "Reprendre la notion, l'expliquer sans support, puis refaire une application courte.",
            ],
        )?;
    }
    Ok(())
}

/// The single write-back point from a finished tutor session into the
/// planner's world: marks the session completed, logs the QCM score, updates
/// the chapter-level Leitner schedule, and marks the chapter done.
pub async fn complete_tutor_session(State(state): State<AppState>, Path(tutor_session_id): Path<i64>, Json(body): Json<CompleteSessionRequest>) -> Result<Json<CompleteTutorSessionResult>, AppError> {
    with_conn(&state.db, |conn| complete_tutor_session_inner(conn, tutor_session_id, &body))
        .map(Json)
        .map_err(AppError)
}

fn complete_tutor_session_inner(conn: &Connection, tutor_session_id: i64, body: &CompleteSessionRequest) -> rusqlite::Result<CompleteTutorSessionResult> {
    let (chapter_id, qcm_score, qcm_total, qcm_results_json): (i64, Option<i64>, Option<i64>, Option<String>) = conn.query_row(
        "SELECT chapter_id, qcm_score, qcm_total, qcm_results_json FROM tutor_sessions WHERE id = ?1",
        params![tutor_session_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    let qcm_score = qcm_score.unwrap_or(0);
    let qcm_total = qcm_total.unwrap_or(0);
    let ue_id: i64 = conn.query_row("SELECT ue_id FROM chapters WHERE id = ?1", params![chapter_id], |r| r.get(0))?;

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
        params![chapter_id, tutor_session_id, today_str, qcm_score, qcm_total],
    )?;
    let qcm_score_id = conn.last_insert_rowid();
    let qcm_score_row = conn.query_row(
        "SELECT id, chapter_id, tutor_session_id, date, score, total, source FROM qcm_scores WHERE id = ?1",
        params![qcm_score_id],
        row_to_qcm,
    )?;

    capture_tutor_misses(conn, tutor_session_id, chapter_id, ue_id, qcm_results_json)?;

    let current_box: i64 = conn
        .query_row("SELECT box FROM review_schedule WHERE chapter_id = ?1", params![chapter_id], |r| r.get(0))
        .unwrap_or(1);

    let exam_date: Option<chrono::NaiveDate> = conn
        .query_row("SELECT value FROM app_meta WHERE key = 'exam_date'", [], |r| r.get::<_, String>(0))
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
pub async fn list_due_chapters(State(state): State<AppState>, Query(q): Query<DueChaptersQuery>) -> Result<Json<Vec<DueChapter>>, AppError> {
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
pub async fn list_weak_chapters(State(state): State<AppState>) -> Result<Json<Vec<WeakChapter>>, AppError> {
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
pub async fn get_usage_summary(State(state): State<AppState>) -> Result<Json<Vec<ModelUsageRow>>, AppError> {
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
        migrate::run(&conn).unwrap();
        conn.execute("INSERT INTO ues (code, name) VALUES ('UE1', 'Test UE')", []).unwrap();
        conn.execute("INSERT INTO chapters (ue_id, name) VALUES (1, 'Test chapter')", []).unwrap();
        conn.execute("INSERT INTO tutor_sessions (chapter_id) VALUES (1)", []).unwrap();
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
        assert_eq!(after_first.story_json.as_deref(), Some(r#"{"titre":"histoire"}"#));
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
        assert_eq!(after_second.story_json.as_deref(), Some(r#"{"titre":"histoire"}"#));
        assert_eq!(after_second.qcm_json.as_deref(), Some(r#"{"questions":[]}"#));
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
        let patch2 = TutorSessionPatch { input_tokens: Some(30), output_tokens: Some(12), ..no_op_patch() };
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

        let body = CompleteSessionRequest { avg_confidence: 2.5, overconfidence_count: 0 };
        let result = complete_tutor_session_inner(&conn, 1, &body).unwrap();

        assert_eq!(result.chapter.status, "done");
        assert_eq!(result.qcm_score_row.score, 9);
        assert_eq!(result.qcm_score_row.total, 10);
        // Strong performance (85%+, confidence>=2, no overconfidence) from a
        // first-ever session (baseline box 1) should advance to box 2.
        assert_eq!(result.box_level, 2);

        let status: String = conn.query_row("SELECT status FROM tutor_sessions WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(status, "completed");

        let scheduled_box: i64 = conn.query_row("SELECT box FROM review_schedule WHERE chapter_id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(scheduled_box, 2);

        // A missed QCM question must become a concrete revision item, rather
        // than disappearing into a historical percentage once the session is
        // over. The migration's UNIQUE constraint also makes this safe if a
        // completion callback is retried.
        let errors: i64 = conn.query_row("SELECT COUNT(*) FROM error_notes WHERE tutor_session_id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(errors, 1);
    }

    #[test]
    fn complete_tutor_session_is_idempotent_on_the_review_schedule_row() {
        let conn = setup();
        let body = CompleteSessionRequest { avg_confidence: 1.0, overconfidence_count: 3 };
        complete_tutor_session_inner(&conn, 1, &body).unwrap();

        // A second tutor session for the same chapter must UPDATE the
        // existing review_schedule row (ON CONFLICT), not fail on the
        // UNIQUE(chapter_id) constraint or insert a duplicate.
        conn.execute("INSERT INTO tutor_sessions (chapter_id) VALUES (1)", []).unwrap();
        let second_id = conn.last_insert_rowid();
        let result = complete_tutor_session_inner(&conn, second_id, &body).unwrap();
        assert_eq!(result.outcome, "weak");

        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM review_schedule WHERE chapter_id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1);
    }

    fn error_note_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM error_notes", [], |r| r.get(0)).unwrap()
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
            .query_row("SELECT title FROM error_notes WHERE title NOT LIKE '%—%'", [], |r| r.get(0))
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
        conn.execute("INSERT INTO tutor_sessions (chapter_id) VALUES (1)", []).unwrap();
        let second_session = conn.last_insert_rowid();
        capture_tutor_misses(&conn, second_session, 1, 1, Some(raw.to_string())).unwrap();
        assert_eq!(error_note_count(&conn), 1);

        // Once the note is mastered, missing the notion again is a real
        // regression — it should come back as a fresh active note.
        conn.execute("UPDATE error_notes SET status = 'mastered' WHERE id = 1", []).unwrap();
        capture_tutor_misses(&conn, second_session, 1, 1, Some(raw.to_string())).unwrap();
        assert_eq!(error_note_count(&conn), 2);
        let active: i64 = conn
            .query_row("SELECT COUNT(*) FROM error_notes WHERE status = 'active'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(active, 1);
    }
}
