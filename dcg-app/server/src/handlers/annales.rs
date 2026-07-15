use crate::appstate::{AppError, AppState};
use crate::db::with_conn;
use crate::models::AnnaleAttempt;
use axum::extract::{Path, State};
use axum::Json;
use rusqlite::{params, Connection};
use serde::Deserialize;

const ANNALE_COLUMNS: &str = "a.id, a.ue_id, u.code, u.name, u.color, a.chapter_id, a.title, a.subject_text,
    a.corrige_text, a.duration_minutes, a.exercice_json, a.answers_json, a.correction_json,
    a.score, a.total, a.status, a.started_at, a.completed_at";

fn row_to_attempt(row: &rusqlite::Row) -> rusqlite::Result<AnnaleAttempt> {
    Ok(AnnaleAttempt {
        id: row.get(0)?,
        ue_id: row.get(1)?,
        ue_code: row.get(2)?,
        ue_name: row.get(3)?,
        ue_color: row.get(4)?,
        chapter_id: row.get(5)?,
        title: row.get(6)?,
        subject_text: row.get(7)?,
        corrige_text: row.get(8)?,
        duration_minutes: row.get(9)?,
        exercice_json: row.get(10)?,
        answers_json: row.get(11)?,
        correction_json: row.get(12)?,
        score: row.get(13)?,
        total: row.get(14)?,
        status: row.get(15)?,
        started_at: row.get(16)?,
        completed_at: row.get(17)?,
    })
}

fn get_attempt(conn: &Connection, id: i64) -> rusqlite::Result<AnnaleAttempt> {
    conn.query_row(
        &format!("SELECT {ANNALE_COLUMNS} FROM annale_attempts a JOIN ues u ON u.id = a.ue_id WHERE a.id = ?1"),
        params![id],
        row_to_attempt,
    )
}

pub async fn list_attempts(State(state): State<AppState>) -> Result<Json<Vec<AnnaleAttempt>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut stmt = conn.prepare(&format!(
            "SELECT {ANNALE_COLUMNS} FROM annale_attempts a JOIN ues u ON u.id = a.ue_id
             ORDER BY CASE a.status WHEN 'in_progress' THEN 0 ELSE 1 END, a.id DESC"
        ))?;
        let rows = stmt.query_map([], row_to_attempt)?;
        rows.collect()
    })
    .map(Json)
    .map_err(AppError)
}

#[derive(Debug, Deserialize)]
pub struct StartAttemptRequest {
    pub ue_id: i64,
    pub chapter_id: Option<i64>,
    pub title: String,
    pub subject_text: String,
    pub corrige_text: Option<String>,
    pub duration_minutes: i64,
}

pub async fn start_attempt(State(state): State<AppState>, Json(body): Json<StartAttemptRequest>) -> Result<Json<AnnaleAttempt>, AppError> {
    let title = body.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError("Donne un titre à l'annale (ex. « DCG UE4 2023 — dossier 2 »)".into()));
    }
    if body.subject_text.trim().is_empty() {
        return Err(AppError("Colle le texte du sujet".into()));
    }
    if !(5..=300).contains(&body.duration_minutes) {
        return Err(AppError("La durée doit être entre 5 et 300 minutes".into()));
    }
    with_conn(&state.db, |conn| {
        conn.execute(
            "INSERT INTO annale_attempts (ue_id, chapter_id, title, subject_text, corrige_text, duration_minutes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                body.ue_id,
                body.chapter_id,
                title,
                body.subject_text,
                body.corrige_text.as_deref().filter(|s| !s.trim().is_empty()),
                body.duration_minutes,
            ],
        )?;
        get_attempt(conn, conn.last_insert_rowid())
    })
    .map(Json)
    .map_err(AppError)
}

/// Incremental save while the clock runs — same COALESCE pattern as the tutor
/// session patch, so a crash mid-annale loses at most the debounce window.
#[derive(Debug, Deserialize)]
pub struct AttemptPatch {
    pub exercice_json: Option<String>,
    pub answers_json: Option<String>,
}

pub async fn patch_attempt(State(state): State<AppState>, Path(id): Path<i64>, Json(patch): Json<AttemptPatch>) -> Result<Json<AnnaleAttempt>, AppError> {
    with_conn(&state.db, |conn| {
        conn.execute(
            "UPDATE annale_attempts SET
                exercice_json = COALESCE(?1, exercice_json),
                answers_json = COALESCE(?2, answers_json),
                updated_at = datetime('now')
             WHERE id = ?3",
            params![patch.exercice_json, patch.answers_json, id],
        )?;
        get_attempt(conn, id)
    })
    .map(Json)
    .map_err(AppError)
}

pub async fn abandon_attempt(State(state): State<AppState>, Path(id): Path<i64>) -> Result<(), AppError> {
    with_conn(&state.db, |conn| {
        conn.execute(
            "UPDATE annale_attempts SET status = 'abandoned', updated_at = datetime('now') WHERE id = ?1 AND status = 'in_progress'",
            params![id],
        )?;
        Ok(())
    })
    .map_err(AppError)
}

pub async fn delete_attempt(State(state): State<AppState>, Path(id): Path<i64>) -> Result<(), AppError> {
    with_conn(&state.db, |conn| {
        conn.execute("DELETE FROM annale_attempts WHERE id = ?1", params![id])?;
        Ok(())
    })
    .map_err(AppError)
}

// Lenient mirrors of the frontend's ExoCorrection / Exercice shapes — every
// field defaults, and items are parsed one by one, because this JSON came
// out of a model.
#[derive(Debug, Deserialize, Default)]
struct StoredCorrectionItem {
    #[serde(default)]
    dossier: i64,
    #[serde(default)]
    question: i64,
    #[serde(default)]
    note: f64,
    #[serde(default)]
    bareme: f64,
    #[serde(default)]
    reponse_attendue: String,
}

#[derive(Debug, Deserialize, Default)]
struct StoredExoQuestion {
    #[serde(default)]
    numero: i64,
    #[serde(default)]
    enonce: String,
}

#[derive(Debug, Deserialize, Default)]
struct StoredExoDossier {
    #[serde(default)]
    numero: i64,
    #[serde(default)]
    questions: Vec<StoredExoQuestion>,
}

fn lenient_array<T: serde::de::DeserializeOwned + Default>(value: Option<&serde_json::Value>) -> Vec<T> {
    value
        .and_then(|v| v.as_array())
        .map(|items| items.iter().map(|item| serde_json::from_value(item.clone()).unwrap_or_default()).collect())
        .unwrap_or_default()
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max).collect();
        format!("{cut}…")
    }
}

#[derive(Debug, Deserialize)]
pub struct CompleteAttemptRequest {
    pub correction_json: String,
    /// Actual working time in seconds, reported by the frontend timer —
    /// logged as a study session so annale work counts toward the streak.
    pub elapsed_seconds: i64,
}

pub async fn complete_attempt(State(state): State<AppState>, Path(id): Path<i64>, Json(body): Json<CompleteAttemptRequest>) -> Result<Json<AnnaleAttempt>, AppError> {
    with_conn(&state.db, |conn| complete_attempt_inner(conn, id, &body))
        .map(Json)
        .map_err(AppError)
}

fn complete_attempt_inner(conn: &Connection, id: i64, body: &CompleteAttemptRequest) -> rusqlite::Result<AnnaleAttempt> {
    let attempt = get_attempt(conn, id)?;

    let correction: serde_json::Value = serde_json::from_str(&body.correction_json).unwrap_or(serde_json::Value::Null);
    let items: Vec<StoredCorrectionItem> = lenient_array(correction.get("corrections"));
    let total: f64 = items.iter().map(|i| i.bareme).sum();
    let score: f64 = correction
        .get("total")
        .and_then(|v| v.as_f64())
        .unwrap_or_else(|| items.iter().map(|i| i.note).sum());

    conn.execute(
        "UPDATE annale_attempts SET
            correction_json = ?1, score = ?2, total = ?3,
            status = 'completed', completed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?4",
        params![body.correction_json, score, total, id],
    )?;

    // Weak answers (< 50% of the barème) become error notes with
    // source 'annale' — the exact exam behavior the notebook exists to fix.
    // The question énoncé is looked up from the structured subject so the
    // note says what was actually asked, not just "dossier 2 question 3".
    let exercice: serde_json::Value = attempt
        .exercice_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(serde_json::Value::Null);
    let dossiers: Vec<StoredExoDossier> = lenient_array(exercice.get("dossiers"));

    for item in items.iter().filter(|i| i.bareme > 0.0 && i.note < i.bareme * 0.5) {
        let enonce = dossiers
            .iter()
            .find(|d| d.numero == item.dossier)
            .and_then(|d| d.questions.iter().find(|q| q.numero == item.question))
            .map(|q| q.enonce.as_str())
            .unwrap_or("");
        let title = if enonce.is_empty() {
            format!("{} — D{}Q{}", attempt.title, item.dossier, item.question)
        } else {
            format!("{} — {}", attempt.title, truncate_chars(enonce, 90))
        };
        let correction_text = item.reponse_attendue.trim();
        let inserted = conn.execute(
            "INSERT INTO error_notes (ue_id, chapter_id, title, error_type, skill, correction, source, next_review_date)
             SELECT ?1, ?2, ?3, 'method', 'application', ?4, 'annale', date('now','localtime')
             WHERE NOT EXISTS (
                 SELECT 1 FROM error_notes WHERE ue_id = ?1 AND title = ?3 AND status = 'active'
             )",
            params![
                attempt.ue_id,
                attempt.chapter_id,
                title,
                if correction_text.is_empty() { None } else { Some(correction_text) },
            ],
        )?;
        if inserted == 1 {
            crate::handlers::planner::create_card_for_error_note(conn, conn.last_insert_rowid())?;
        }
    }

    // Annale work is real study time — log it so the streak and session
    // stats see it, capped at the configured duration to keep a forgotten
    // open tab from logging hours.
    let elapsed = body.elapsed_seconds.clamp(0, attempt.duration_minutes * 60);
    if elapsed > 0 {
        conn.execute(
            "INSERT INTO sessions (ue_id, chapter_id, preset, duration_seconds, started_at, ended_at)
             VALUES (?1, ?2, 'annale', ?3, ?4, datetime('now'))",
            params![attempt.ue_id, attempt.chapter_id, elapsed, attempt.started_at],
        )?;
    }

    get_attempt(conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        migrate::run(&conn).unwrap();
        conn.execute("INSERT INTO ues (code, name) VALUES ('UE4', 'Droit fiscal')", []).unwrap();
        conn.execute("INSERT INTO chapters (ue_id, name) VALUES (1, 'La TVA')", []).unwrap();
        conn.execute(
            "INSERT INTO annale_attempts (ue_id, chapter_id, title, subject_text, duration_minutes, exercice_json)
             VALUES (1, 1, 'DCG UE4 2023', 'sujet…', 60, ?1)",
            params![
                r#"{"dossiers":[{"numero":1,"titre":"TVA","questions":[
                    {"numero":1,"enonce":"Déterminer le régime de TVA applicable."},
                    {"numero":2,"enonce":"Calculer la TVA collectée."}]}]}"#
            ],
        )
        .unwrap();
        conn
    }

    #[test]
    fn completing_an_attempt_stores_score_and_mints_error_notes_for_weak_answers() {
        let conn = setup();
        let body = CompleteAttemptRequest {
            correction_json: r#"{"corrections":[
                {"dossier":1,"question":1,"note":1,"bareme":4,"evaluation":"confus","reponse_attendue":"Le régime réel normal."},
                {"dossier":1,"question":2,"note":3,"bareme":4,"evaluation":"bien","reponse_attendue":"20 000 €."}
            ],"total":4,"appreciation":"Moyen."}"#
                .into(),
            elapsed_seconds: 1800,
        };
        let attempt = complete_attempt_inner(&conn, 1, &body).unwrap();
        assert_eq!(attempt.status, "completed");
        assert_eq!(attempt.score, Some(4.0));
        assert_eq!(attempt.total, Some(8.0));

        // Q1 scored 25% → error note with the real énoncé and the expected
        // answer; Q2 scored 75% → no note.
        let (count, title, correction): (i64, String, String) = conn
            .query_row(
                "SELECT COUNT(*), MAX(title), MAX(correction) FROM error_notes WHERE source = 'annale'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert!(title.contains("Déterminer le régime de TVA"), "unexpected title: {title}");
        assert_eq!(correction, "Le régime réel normal.");

        // The weak answer also became a révision éclair card (via the note).
        let cards: i64 = conn.query_row("SELECT COUNT(*) FROM flashcards WHERE error_note_id IS NOT NULL", [], |r| r.get(0)).unwrap();
        assert_eq!(cards, 1);

        // And the working time was logged as a study session.
        let (sessions, secs): (i64, i64) = conn
            .query_row("SELECT COUNT(*), MAX(duration_seconds) FROM sessions WHERE preset = 'annale'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((sessions, secs), (1, 1800));
    }

    #[test]
    fn malformed_correction_json_still_completes_without_panicking() {
        let conn = setup();
        let body = CompleteAttemptRequest {
            correction_json: "{pas du json".into(),
            elapsed_seconds: 60,
        };
        let attempt = complete_attempt_inner(&conn, 1, &body).unwrap();
        assert_eq!(attempt.status, "completed");
        assert_eq!(attempt.score, Some(0.0));
        let notes: i64 = conn.query_row("SELECT COUNT(*) FROM error_notes", [], |r| r.get(0)).unwrap();
        assert_eq!(notes, 0);
    }
}
