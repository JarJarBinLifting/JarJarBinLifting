use crate::appstate::{AppError, AppState};
use crate::db::with_conn;
use crate::models::{Chapter, QcmScoreRow, SessionLogRow, Ue};
use axum::extract::{Path, State};
use axum::Json;
use rusqlite::{params, Connection};
use serde::Deserialize;

/// The user's actual DCG programme, carried over from the original planner
/// prototype so a fresh install isn't an empty shell.
const DEFAULT_CURRICULUM: &[(&str, &str, &str, &[&str])] = &[
    (
        "UE1", "Droit des affaires", "#5B9CF7",
        &["Introduction au droit", "Les personnes juridiques", "Les actes juridiques", "La responsabilité civile", "Les contrats spéciaux", "Les sociétés commerciales", "Les contrats commerciaux", "Les sûretés", "Les procédures collectives", "La propriété intellectuelle"],
    ),
    (
        "UE3", "Droit social", "#B57BF7",
        &["Formation du contrat de travail", "Exécution du contrat", "Modification et suspension", "Rupture du contrat", "Droit disciplinaire", "Relations collectives", "Protection sociale", "Instances représentatives"],
    ),
    (
        "UE4", "Droit fiscal", "#F87171",
        &["Introduction à la fiscalité", "La TVA", "L'impôt sur les sociétés", "L'IR — BIC", "L'IR — BNC et BA", "Droits d'enregistrement", "Fiscalité locale", "Procédure fiscale"],
    ),
    (
        "UE6", "Finance d'entreprise", "#34D399",
        &["Diagnostic financier", "Le bilan fonctionnel", "Soldes intermédiaires de gestion", "Tableau de financement", "Gestion de trésorerie", "Décision d'investissement", "Modes de financement", "Évaluation d'entreprise"],
    ),
    (
        "UE7", "Management", "#FBBF24",
        &["Théories des organisations", "Analyse de l'environnement", "Diagnostic stratégique", "Options stratégiques", "Structure organisationnelle", "Management RH", "Gestion de projet", "Système d'information"],
    ),
    (
        "UE10", "Compta approfondie", "#22D3EE",
        &["Opérations courantes", "Opérations de fin d'exercice", "Provisions et dépréciations", "Immobilisations corporelles", "Immobilisations incorporelles", "Les capitaux propres", "Comptes consolidés", "Normes IFRS", "Opérations particulières"],
    ),
    (
        "UE11", "Contrôle de gestion", "#F472B6",
        &["Introduction au CG", "Les coûts complets", "Coût variable et direct", "Imputation rationnelle", "Gestion budgétaire", "Budgets opérationnels", "Contrôle budgétaire et écarts", "Tableau de bord et BSC", "Coûts cibles et ABC"],
    ),
];

/// Idempotent: only seeds if the `ues` table is empty, so it's safe to call
/// on every startup right after the db is opened.
pub fn seed_default_curriculum(state: &AppState) -> Result<bool, String> {
    with_conn(&state.db, |conn| {
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM ues", [], |r| r.get(0))?;
        if count > 0 {
            return Ok(false);
        }
        for (i, (code, name, color, chapters)) in DEFAULT_CURRICULUM.iter().enumerate() {
            conn.execute(
                "INSERT INTO ues (code, name, position, color) VALUES (?1, ?2, ?3, ?4)",
                params![code, name, i as i64, color],
            )?;
            let ue_id = conn.last_insert_rowid();
            for (j, chapter_name) in chapters.iter().enumerate() {
                conn.execute(
                    "INSERT INTO chapters (ue_id, name, position) VALUES (?1, ?2, ?3)",
                    params![ue_id, chapter_name, j as i64],
                )?;
            }
        }
        Ok(true)
    })
}

pub async fn seed_default_curriculum_route(State(state): State<AppState>) -> Result<Json<bool>, AppError> {
    seed_default_curriculum(&state).map(Json).map_err(AppError)
}

pub(crate) fn row_to_ue(row: &rusqlite::Row) -> rusqlite::Result<Ue> {
    Ok(Ue {
        id: row.get(0)?,
        code: row.get(1)?,
        name: row.get(2)?,
        position: row.get(3)?,
        color: row.get(4)?,
        points_forts: row.get(5)?,
        points_faibles: row.get(6)?,
        notes: row.get(7)?,
    })
}

pub async fn list_ues(State(state): State<AppState>) -> Result<Json<Vec<Ue>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, code, name, position, color, points_forts, points_faibles, notes
             FROM ues ORDER BY position",
        )?;
        let rows = stmt.query_map([], row_to_ue)?;
        rows.collect()
    })
    .map(Json)
    .map_err(AppError)
}

#[derive(Debug, Deserialize)]
pub struct UpdateUeNotesRequest {
    pub points_forts: Option<String>,
    pub points_faibles: Option<String>,
    pub notes: Option<String>,
}

pub async fn update_ue_notes(State(state): State<AppState>, Path(ue_id): Path<i64>, Json(body): Json<UpdateUeNotesRequest>) -> Result<(), AppError> {
    with_conn(&state.db, |conn| {
        conn.execute(
            "UPDATE ues SET points_forts = ?1, points_faibles = ?2, notes = ?3, updated_at = datetime('now')
             WHERE id = ?4",
            params![body.points_forts, body.points_faibles, body.notes, ue_id],
        )?;
        Ok(())
    })
    .map_err(AppError)
}

pub(crate) fn row_to_chapter(row: &rusqlite::Row) -> rusqlite::Result<Chapter> {
    Ok(Chapter {
        id: row.get(0)?,
        ue_id: row.get(1)?,
        name: row.get(2)?,
        position: row.get(3)?,
        status: row.get(4)?,
    })
}

pub async fn list_chapters(State(state): State<AppState>, Path(ue_id): Path<i64>) -> Result<Json<Vec<Chapter>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut stmt = conn.prepare("SELECT id, ue_id, name, position, status FROM chapters WHERE ue_id = ?1 ORDER BY position")?;
        let rows = stmt.query_map(params![ue_id], row_to_chapter)?;
        rows.collect()
    })
    .map(Json)
    .map_err(AppError)
}

pub async fn list_all_chapters(State(state): State<AppState>) -> Result<Json<Vec<Chapter>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut stmt = conn.prepare("SELECT id, ue_id, name, position, status FROM chapters ORDER BY ue_id, position")?;
        let rows = stmt.query_map([], row_to_chapter)?;
        rows.collect()
    })
    .map(Json)
    .map_err(AppError)
}

fn cycle_status(current: &str) -> &'static str {
    match current {
        "todo" => "ongoing",
        "ongoing" => "done",
        _ => "todo",
    }
}

pub fn set_chapter_status(conn: &Connection, chapter_id: i64, new_status: &str) -> rusqlite::Result<Chapter> {
    let old_status: String = conn.query_row("SELECT status FROM chapters WHERE id = ?1", params![chapter_id], |r| r.get(0))?;

    conn.execute(
        "UPDATE chapters SET status = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![new_status, chapter_id],
    )?;
    conn.execute(
        "INSERT INTO chapter_status_events (chapter_id, old_status, new_status) VALUES (?1, ?2, ?3)",
        params![chapter_id, old_status, new_status],
    )?;

    conn.query_row(
        "SELECT id, ue_id, name, position, status FROM chapters WHERE id = ?1",
        params![chapter_id],
        row_to_chapter,
    )
}

pub async fn cycle_chapter_status(State(state): State<AppState>, Path(chapter_id): Path<i64>) -> Result<Json<Chapter>, AppError> {
    with_conn(&state.db, |conn| {
        let current: String = conn.query_row("SELECT status FROM chapters WHERE id = ?1", params![chapter_id], |r| r.get(0))?;
        set_chapter_status(conn, chapter_id, cycle_status(&current))
    })
    .map(Json)
    .map_err(AppError)
}

pub(crate) fn row_to_qcm(row: &rusqlite::Row) -> rusqlite::Result<QcmScoreRow> {
    Ok(QcmScoreRow {
        id: row.get(0)?,
        chapter_id: row.get(1)?,
        tutor_session_id: row.get(2)?,
        date: row.get(3)?,
        score: row.get(4)?,
        total: row.get(5)?,
        source: row.get(6)?,
    })
}

pub async fn list_qcm_scores(State(state): State<AppState>, Path(chapter_id): Path<i64>) -> Result<Json<Vec<QcmScoreRow>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, chapter_id, tutor_session_id, date, score, total, source
             FROM qcm_scores WHERE chapter_id = ?1 ORDER BY date, id",
        )?;
        let rows = stmt.query_map(params![chapter_id], row_to_qcm)?;
        rows.collect()
    })
    .map(Json)
    .map_err(AppError)
}

pub async fn list_all_qcm_scores(State(state): State<AppState>) -> Result<Json<Vec<QcmScoreRow>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut stmt = conn.prepare("SELECT id, chapter_id, tutor_session_id, date, score, total, source FROM qcm_scores")?;
        let rows = stmt.query_map([], row_to_qcm)?;
        rows.collect()
    })
    .map(Json)
    .map_err(AppError)
}

#[derive(Debug, Deserialize)]
pub struct AddQcmScoreRequest {
    pub chapter_id: i64,
    pub date: String,
    pub score: i64,
    pub total: i64,
}

pub async fn add_qcm_score(State(state): State<AppState>, Json(body): Json<AddQcmScoreRequest>) -> Result<Json<QcmScoreRow>, AppError> {
    with_conn(&state.db, |conn| {
        conn.execute(
            "INSERT INTO qcm_scores (chapter_id, date, score, total, source) VALUES (?1, ?2, ?3, ?4, 'manual')",
            params![body.chapter_id, body.date, body.score, body.total],
        )?;
        let id = conn.last_insert_rowid();
        conn.query_row(
            "SELECT id, chapter_id, tutor_session_id, date, score, total, source FROM qcm_scores WHERE id = ?1",
            params![id],
            row_to_qcm,
        )
    })
    .map(Json)
    .map_err(AppError)
}

pub async fn delete_qcm_score(State(state): State<AppState>, Path(id): Path<i64>) -> Result<(), AppError> {
    with_conn(&state.db, |conn| {
        conn.execute("DELETE FROM qcm_scores WHERE id = ?1", params![id])?;
        Ok(())
    })
    .map_err(AppError)
}

fn row_to_session(row: &rusqlite::Row) -> rusqlite::Result<SessionLogRow> {
    Ok(SessionLogRow {
        id: row.get(0)?,
        ue_id: row.get(1)?,
        chapter_id: row.get(2)?,
        preset: row.get(3)?,
        duration_seconds: row.get(4)?,
        started_at: row.get(5)?,
        ended_at: row.get(6)?,
    })
}

pub async fn list_timer_sessions(State(state): State<AppState>) -> Result<Json<Vec<SessionLogRow>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, ue_id, chapter_id, preset, duration_seconds, started_at, ended_at
             FROM sessions ORDER BY started_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_session)?;
        rows.collect()
    })
    .map(Json)
    .map_err(AppError)
}

#[derive(Debug, Deserialize)]
pub struct AddTimerSessionRequest {
    pub ue_id: Option<i64>,
    pub chapter_id: Option<i64>,
    pub preset: Option<String>,
    pub duration_seconds: i64,
    pub started_at: String,
    pub ended_at: String,
}

pub async fn add_timer_session(State(state): State<AppState>, Json(body): Json<AddTimerSessionRequest>) -> Result<Json<SessionLogRow>, AppError> {
    with_conn(&state.db, |conn| {
        conn.execute(
            "INSERT INTO sessions (ue_id, chapter_id, preset, duration_seconds, started_at, ended_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![body.ue_id, body.chapter_id, body.preset, body.duration_seconds, body.started_at, body.ended_at],
        )?;
        let id = conn.last_insert_rowid();
        conn.query_row(
            "SELECT id, ue_id, chapter_id, preset, duration_seconds, started_at, ended_at FROM sessions WHERE id = ?1",
            params![id],
            row_to_session,
        )
    })
    .map(Json)
    .map_err(AppError)
}

pub async fn delete_timer_session(State(state): State<AppState>, Path(id): Path<i64>) -> Result<(), AppError> {
    with_conn(&state.db, |conn| {
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
        Ok(())
    })
    .map_err(AppError)
}

pub async fn get_meta(State(state): State<AppState>, Path(key): Path<String>) -> Result<Json<Option<String>>, AppError> {
    with_conn(&state.db, |conn| {
        conn.query_row("SELECT value FROM app_meta WHERE key = ?1", params![key], |r| r.get(0))
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })
    })
    .map(Json)
    .map_err(AppError)
}

#[derive(Debug, Deserialize)]
pub struct SetMetaRequest {
    pub value: String,
}

pub async fn set_meta(State(state): State<AppState>, Path(key): Path<String>, Json(body): Json<SetMetaRequest>) -> Result<(), AppError> {
    with_conn(&state.db, |conn| {
        conn.execute(
            "INSERT INTO app_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, body.value],
        )?;
        Ok(())
    })
    .map_err(AppError)
}
