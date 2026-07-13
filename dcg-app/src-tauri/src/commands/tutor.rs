use crate::commands::planner::{row_to_qcm, set_chapter_status};
use crate::commands::scheduler::{self, SessionResult};
use crate::db::{with_conn, DbState};
use crate::models::{CompleteTutorSessionResult, DueChapter, FlashcardRow, ModelUsageRow, TutorSessionRow};
use rusqlite::{params, Connection};
use serde::Deserialize;
use tauri::State;

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

/// Reuses an in-progress session for this chapter if one exists, otherwise
/// starts a fresh one. The frontend is expected to have already resolved any
/// existing in-progress session via `get_in_progress_session` (offering the
/// user a Resume/Start-fresh choice, abandoning the old row on "fresh") — the
/// lookup here is a safety net, not the primary resume mechanism. `difficulty`,
/// `model`, and `is_revision` are only used when a new row is created; a
/// reused row keeps whatever it was originally started with.
#[tauri::command]
pub fn start_or_resume_tutor_session(
    db: State<DbState>,
    chapter_id: i64,
    input_source_type: Option<String>,
    adhd_mode: bool,
    difficulty: String,
    model: String,
    is_revision: bool,
) -> Result<TutorSessionRow, String> {
    with_conn(&db, |conn| {
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM tutor_sessions WHERE chapter_id = ?1 AND status = 'in_progress' ORDER BY id DESC LIMIT 1",
                params![chapter_id],
                |r| r.get(0),
            )
            .ok();

        if let Some(id) = existing {
            return get_tutor_session(conn, id);
        }

        conn.execute(
            "INSERT INTO tutor_sessions (chapter_id, input_source_type, adhd_mode_used, difficulty, model, is_revision)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![chapter_id, input_source_type, adhd_mode as i64, difficulty, model, is_revision as i64],
        )?;
        let id = conn.last_insert_rowid();
        get_tutor_session(conn, id)
    })
}

#[tauri::command]
pub fn get_latest_completed_session(db: State<DbState>, chapter_id: i64) -> Result<Option<TutorSessionRow>, String> {
    with_conn(&db, |conn| {
        conn.query_row(
            &format!(
                "SELECT {TUTOR_SESSION_COLUMNS} FROM tutor_sessions
                 WHERE chapter_id = ?1 AND status = 'completed' ORDER BY id DESC LIMIT 1"
            ),
            params![chapter_id],
            row_to_tutor_session,
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })
    })
}

/// The session a chapter was mid-way through when the app was last closed —
/// gracefully (Pause is just UI state, doesn't affect this) or otherwise
/// (crash / force-quit, which never got to call `abandon_tutor_session`).
/// Drives the Resume/Start-fresh prompt in the tutor UI.
#[tauri::command]
pub fn get_in_progress_session(db: State<DbState>, chapter_id: i64) -> Result<Option<TutorSessionRow>, String> {
    with_conn(&db, |conn| {
        conn.query_row(
            &format!(
                "SELECT {TUTOR_SESSION_COLUMNS} FROM tutor_sessions
                 WHERE chapter_id = ?1 AND status = 'in_progress' ORDER BY id DESC LIMIT 1"
            ),
            params![chapter_id],
            row_to_tutor_session,
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })
    })
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

#[tauri::command]
pub fn save_tutor_session_progress(
    db: State<DbState>,
    id: i64,
    patch: TutorSessionPatch,
) -> Result<TutorSessionRow, String> {
    with_conn(&db, |conn| {
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
    })
}

#[tauri::command]
pub fn abandon_tutor_session(db: State<DbState>, id: i64) -> Result<(), String> {
    with_conn(&db, |conn| {
        conn.execute(
            "UPDATE tutor_sessions SET status = 'abandoned', updated_at = datetime('now') WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    })
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

const FLASHCARD_COLUMNS: &str =
    "id, chapter_id, concept_id, question, answer, box_level, correct_streak, mastered, last_reviewed_at";

#[tauri::command]
pub fn list_flashcards(db: State<DbState>, chapter_id: i64) -> Result<Vec<FlashcardRow>, String> {
    with_conn(&db, |conn| {
        let mut stmt = conn.prepare(&format!(
            "SELECT {FLASHCARD_COLUMNS} FROM flashcards WHERE chapter_id = ?1 ORDER BY id"
        ))?;
        let rows = stmt.query_map(params![chapter_id], row_to_flashcard)?;
        rows.collect()
    })
}

#[derive(Debug, Deserialize)]
pub struct NewFlashcard {
    pub concept_id: Option<String>,
    pub question: String,
    pub answer: String,
}

/// Persists a freshly-generated flashcard set once per chapter. Callers
/// should check `list_flashcards` first and skip generation entirely if the
/// chapter already has cards, so they aren't regenerated every session.
#[tauri::command]
pub fn save_flashcards(
    db: State<DbState>,
    chapter_id: i64,
    tutor_session_id: i64,
    cards: Vec<NewFlashcard>,
) -> Result<Vec<FlashcardRow>, String> {
    with_conn(&db, |conn| {
        for card in &cards {
            conn.execute(
                "INSERT INTO flashcards (chapter_id, tutor_session_id, concept_id, question, answer)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![chapter_id, tutor_session_id, card.concept_id, card.question, card.answer],
            )?;
        }
        let mut stmt = conn.prepare(&format!(
            "SELECT {FLASHCARD_COLUMNS} FROM flashcards WHERE chapter_id = ?1 ORDER BY id"
        ))?;
        let rows = stmt.query_map(params![chapter_id], row_to_flashcard)?;
        rows.collect()
    })
}

/// Mirrors the flashcard-level Leitner queue: a correct pass advances the box
/// and streak (mastered once the streak reaches 2), a miss resets both so the
/// card recirculates.
#[tauri::command]
pub fn update_flashcard_progress(db: State<DbState>, id: i64, correct: bool) -> Result<FlashcardRow, String> {
    with_conn(&db, |conn| {
        if correct {
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
        conn.query_row(
            &format!("SELECT {FLASHCARD_COLUMNS} FROM flashcards WHERE id = ?1"),
            params![id],
            row_to_flashcard,
        )
    })
}

/// The single write-back point from a finished tutor session into the
/// planner's world: marks the session completed, logs the QCM score, updates
/// the chapter-level Leitner schedule, and marks the chapter done.
#[tauri::command]
pub fn complete_tutor_session(
    db: State<DbState>,
    tutor_session_id: i64,
    avg_confidence: f64,
    overconfidence_count: i64,
) -> Result<CompleteTutorSessionResult, String> {
    with_conn(&db, |conn| {
        let (chapter_id, qcm_score, qcm_total): (i64, Option<i64>, Option<i64>) = conn.query_row(
            "SELECT chapter_id, qcm_score, qcm_total FROM tutor_sessions WHERE id = ?1",
            params![tutor_session_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        let qcm_score = qcm_score.unwrap_or(0);
        let qcm_total = qcm_total.unwrap_or(0);

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

        let current_box: i64 = conn
            .query_row(
                "SELECT box FROM review_schedule WHERE chapter_id = ?1",
                params![chapter_id],
                |r| r.get(0),
            )
            .unwrap_or(1);

        let result = SessionResult {
            qcm_score,
            qcm_total,
            avg_confidence,
            overconfidence_count,
        };
        let upd = scheduler::next_schedule(current_box, result, today);

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
            params![
                chapter_id,
                upd.box_level,
                upd.next_review_date.to_string(),
                today_str,
                upd.outcome.as_str(),
                tutor_session_id,
            ],
        )?;

        let chapter = set_chapter_status(conn, chapter_id, "done")?;

        Ok(CompleteTutorSessionResult {
            chapter,
            qcm_score_row,
            box_level: upd.box_level,
            outcome: upd.outcome.as_str().to_string(),
            next_review_date: upd.next_review_date.to_string(),
        })
    })
}

/// Chapters whose `next_review_date` falls within `within_days` of today
/// (pass 0 for "due today", 7 for "due this week"). Chapters that have never
/// been through a tutor session have no `review_schedule` row and correctly
/// don't show up here — they belong in the normal todo/ongoing chapter list,
/// not the review agenda.
#[tauri::command]
pub fn list_due_chapters(db: State<DbState>, within_days: i64) -> Result<Vec<DueChapter>, String> {
    with_conn(&db, |conn| {
        let horizon = (chrono::Local::now().date_naive() + chrono::Duration::days(within_days)).to_string();
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
}

/// Lifetime token usage grouped by model — the `model` column records which
/// model each session actually used, so switching models in Settings doesn't
/// corrupt historical totals. Token counts come straight from the Anthropic
/// API's own `usage` field, so they're always accurate; converting to a
/// dollar estimate is left to the UI, which can apply current published
/// rates rather than this command guessing at pricing that changes over time.
#[tauri::command]
pub fn get_usage_summary(db: State<DbState>) -> Result<Vec<ModelUsageRow>, String> {
    with_conn(&db, |conn| {
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
}
