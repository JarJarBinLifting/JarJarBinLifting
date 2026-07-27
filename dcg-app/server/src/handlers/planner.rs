use crate::appstate::{AppError, AppState};
use crate::db::with_conn;
use crate::models::{
    Chapter, ErrorNote, ExamScenarioRow, QcmScoreRow, SessionLogRow, SkillProfileRow, Ue,
};
use axum::extract::{Path, State};
use axum::Json;
use rusqlite::{params, Connection};
use serde::Deserialize;

/// The user's actual DCG programme. UE2/UE3/UE6/UE7/UE11 are transcribed
/// verbatim from their real study-tracker export so chapter names match
/// exactly what they've been studying against; UE4/UE10 keep a curated
/// default (their export had no chapters there yet); UE12 has no known
/// chapter breakdown (their export was empty there too).
const DEFAULT_CURRICULUM: &[(&str, &str, &str, &[&str])] = &[
    (
        "UE2", "Droit des affaires", "#6b7c3f",
        &[
            "Ch.1 — Les sources du droit des affaires",
            "Ch.2 — La société, un contrat",
            "Ch.3 — La société, une personne juridique",
            "Ch.4 — Le fonctionnement de la société : les dirigeants",
            "Ch.5 — Le fonctionnement de la société : les associés et le contrôle",
            "Ch.6 — La transformation et la dissolution de la société",
            "Ch.7 — Les sociétés sans personnalité morale",
            "Ch.8 — Le fonds de commerce",
            "Ch.9 — La société en nom collectif (SNC)",
            "Ch.10 — La société à responsabilité limitée (SARL)",
            "Ch.11 — La société anonyme (SA) : constitution et administration",
            "Ch.12 — La société anonyme (SA) : actionnaires et évolution",
            "Ch.13 — La société par actions simplifiée (SAS)",
            "Ch.14 — Les groupements civils",
            "Ch.15 — L'économie sociale et solidaire : associations et coopératives",
            "Ch.16 — L'environnement pénal",
            "Ch.17 — Les infractions de droit commun applicables aux affaires",
            "Ch.18 — Les infractions spécifiques au droit des affaires",
        ],
    ),
    (
        "UE3", "Droit social", "#7a3346",
        &[
            "Ch.1 — Les situations de travail et la protection sociale",
            "Ch.2 — Les régimes sociaux",
            "Ch.3 — La représentation du personnel",
            "Ch.4 — Les instances de contrôle",
            "Ch.5 — Le litige en droit social",
            "Ch.6 — Les sources du droit social",
            "Ch.7 — La négociation collective",
            "Ch.8 — Les conflits de normes en droit social",
            "Ch.9 — Le recrutement et la formation du contrat de travail",
            "Ch.10 — Les clauses spécifiques du contrat de travail",
            "Ch.11 — Le temps de travail",
            "Ch.12 — Les congés et le repos",
            "Ch.13 — La rémunération",
            "Ch.14 — Le partage de la valeur",
            "Ch.15 — La formation",
            "Ch.16 — Le pouvoir de l'employeur",
            "Ch.17 — La santé au travail",
            "Ch.18 — La modification du contrat de travail",
            "Ch.19 — Les modes de rupture du contrat de travail",
            "Ch.20 — La rupture du contrat de travail et les conséquences sur les revenus",
            "Ch.21 — Les contrats de travail adaptés (atypiques)",
            "Ch.22 — La prise en charge des risques sociaux",
            "Ch.23 — Le temps de travail adapté",
            "Ch.24 — Les conflits collectifs",
            "Ch.25 — L'évolution de la situation juridique de l'employeur",
        ],
    ),
    (
        "UE4", "Droit fiscal", "#a6402f",
        &["Introduction à la fiscalité", "La TVA", "L'impôt sur les sociétés", "L'IR — BIC", "L'IR — BNC et BA", "Droits d'enregistrement", "Fiscalité locale", "Procédure fiscale"],
    ),
    (
        "UE6", "Finance d'entreprise", "#2f6b5e",
        &[
            "Ch.1 — La démarche du diagnostic financier et extra-financier",
            "Ch.2 — L'analyse de l'activité",
            "Ch.3 — L'analyse de la rentabilité et des risques",
            "Ch.4 — L'analyse de la structure financière",
            "Ch.5 — L'analyse par les tableaux de flux",
            "Ch.6 — L'analyse par les ratios",
            "Ch.7 — La démarche du diagnostic financier et du diagnostic extra-financier — La performance durable",
            "Ch.8 — La valeur et le temps",
            "Ch.9 — La gestion du besoin en fonds de roulement d'exploitation",
            "Ch.10 — Les projets d'investissement",
            "Ch.11 — Les investissements pour une performance durable",
            "Ch.12 — Les acteurs du financement",
            "Ch.13 — Les modes de financement",
            "Ch.14 — Les coûts de financement",
            "Ch.15 — Les marchés financiers",
            "Ch.16 — Le plan de financement",
            "Ch.17 — Le budget de trésorerie",
            "Ch.18 — Le financement des déficits de trésorerie de court terme",
            "Ch.19 — Le placement des excédents de trésorerie",
        ],
    ),
    (
        "UE7", "Management", "#b8863f",
        &[
            "Ch.1 — Les objectifs et les périmètres du management",
            "Ch.2 — La diversité des organisations et leur environnement",
            "Ch.3 — Les parties prenantes et la RSE",
            "Ch.4 — Le diagnostic stratégique",
            "Ch.5 — Les choix et la dynamique stratégiques",
            "Ch.6 — Les comportements humains et les modes d'animation",
            "Ch.7 — La structure organisationnelle",
            "Ch.8 — La prise de décision",
            "Ch.9 — Le pouvoir et ses abus",
            "Ch.10 — Les activités opérationnelles",
            "Ch.11 — Le numérique, l'intelligence artificielle et la durabilité",
            "Ch.12 — La qualité, l'innovation et les risques",
        ],
    ),
    (
        "UE10", "Compta approfondie", "#3f7d95",
        &["Opérations courantes", "Opérations de fin d'exercice", "Provisions et dépréciations", "Immobilisations corporelles", "Immobilisations incorporelles", "Les capitaux propres", "Comptes consolidés", "Normes IFRS", "Opérations particulières"],
    ),
    (
        "UE11", "Contrôle de gestion", "#a85d72",
        &[
            "Ch.1 — Les prémices du contrôle de gestion",
            "Ch.2 — Le contrôle de gestion en pratique",
            "Ch.3 — La construction des modèles de coûts",
            "Ch.4 — Le choix d'une méthode de calcul de coûts",
            "Ch.5 — La prise en compte des données aléatoires",
            "Ch.6 — La structuration de l'organisation et la gestion budgétaire",
            "Ch.7 — Les outils et les procédures de la gestion budgétaire",
            "P4.I — La performance",
            "P4.II — La méthode des coûts cibles (target costing)",
            "P4.III — L'analyse de la valeur",
            "P4.IV — L'étalonnage concurrentiel et la reconfiguration des processus",
            "P4.V — Piloter la qualité",
            "P4.VI — Les coûts liés à la qualité et à la non-qualité",
            "P4.VII — Les coûts cachés (hidden costs)",
            "P4.VIII — Le contrôle statistique de la qualité",
            "P4.IX — Les outils de gestion de la qualité",
            "P4.X — Les rôles et modalités du reporting",
            "P4.XI — Le tableau de bord de gestion",
            "P4.XII — Les prix de cession interne (PCI)",
        ],
    ),
    (
        "UE12", "Anglais des affaires", "#8a6a3f",
        &[],
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

pub async fn seed_default_curriculum_route(
    State(state): State<AppState>,
) -> Result<Json<bool>, AppError> {
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

pub async fn update_ue_notes(
    State(state): State<AppState>,
    Path(ue_id): Path<i64>,
    Json(body): Json<UpdateUeNotesRequest>,
) -> Result<(), AppError> {
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

pub async fn list_chapters(
    State(state): State<AppState>,
    Path(ue_id): Path<i64>,
) -> Result<Json<Vec<Chapter>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut stmt = conn.prepare("SELECT id, ue_id, name, position, status FROM chapters WHERE ue_id = ?1 ORDER BY position")?;
        let rows = stmt.query_map(params![ue_id], row_to_chapter)?;
        rows.collect()
    })
    .map(Json)
    .map_err(AppError)
}

pub async fn list_all_chapters(
    State(state): State<AppState>,
) -> Result<Json<Vec<Chapter>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, ue_id, name, position, status FROM chapters ORDER BY ue_id, position",
        )?;
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

pub fn set_chapter_status(
    conn: &Connection,
    chapter_id: i64,
    new_status: &str,
) -> rusqlite::Result<Chapter> {
    let old_status: String = conn.query_row(
        "SELECT status FROM chapters WHERE id = ?1",
        params![chapter_id],
        |r| r.get(0),
    )?;

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

pub async fn cycle_chapter_status(
    State(state): State<AppState>,
    Path(chapter_id): Path<i64>,
) -> Result<Json<Chapter>, AppError> {
    with_conn(&state.db, |conn| {
        let current: String = conn.query_row(
            "SELECT status FROM chapters WHERE id = ?1",
            params![chapter_id],
            |r| r.get(0),
        )?;
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

pub async fn list_qcm_scores(
    State(state): State<AppState>,
    Path(chapter_id): Path<i64>,
) -> Result<Json<Vec<QcmScoreRow>>, AppError> {
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

pub async fn list_all_qcm_scores(
    State(state): State<AppState>,
) -> Result<Json<Vec<QcmScoreRow>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, chapter_id, tutor_session_id, date, score, total, source FROM qcm_scores",
        )?;
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

pub async fn add_qcm_score(
    State(state): State<AppState>,
    Json(body): Json<AddQcmScoreRequest>,
) -> Result<Json<QcmScoreRow>, AppError> {
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

pub async fn delete_qcm_score(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<(), AppError> {
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

pub async fn list_timer_sessions(
    State(state): State<AppState>,
) -> Result<Json<Vec<SessionLogRow>>, AppError> {
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

pub async fn add_timer_session(
    State(state): State<AppState>,
    Json(body): Json<AddTimerSessionRequest>,
) -> Result<Json<SessionLogRow>, AppError> {
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

pub async fn delete_timer_session(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<(), AppError> {
    with_conn(&state.db, |conn| {
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
        Ok(())
    })
    .map_err(AppError)
}

pub async fn get_meta(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<Option<String>>, AppError> {
    with_conn(&state.db, |conn| {
        conn.query_row(
            "SELECT value FROM app_meta WHERE key = ?1",
            params![key],
            |r| r.get(0),
        )
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

pub async fn set_meta(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(body): Json<SetMetaRequest>,
) -> Result<(), AppError> {
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

// ─── Exam pilotage: error notebook, skills, and score scenarios ───

fn row_to_error_note(row: &rusqlite::Row) -> rusqlite::Result<ErrorNote> {
    Ok(ErrorNote {
        id: row.get(0)?,
        ue_id: row.get(1)?,
        ue_code: row.get(2)?,
        ue_name: row.get(3)?,
        ue_color: row.get(4)?,
        chapter_id: row.get(5)?,
        chapter_name: row.get(6)?,
        title: row.get(7)?,
        error_type: row.get(8)?,
        skill: row.get(9)?,
        my_reasoning: row.get(10)?,
        correction: row.get(11)?,
        source: row.get(12)?,
        ladder_step: row.get(13)?,
        status: row.get(14)?,
        next_review_date: row.get(15)?,
        updated_at: row.get(16)?,
    })
}

const ERROR_NOTE_COLUMNS: &str = "e.id, u.id, u.code, u.name, u.color, c.id, c.name,
    e.title, e.error_type, e.skill, e.my_reasoning, e.correction, e.source,
    e.ladder_step, e.status, e.next_review_date, e.updated_at";

pub async fn list_error_notes(
    State(state): State<AppState>,
) -> Result<Json<Vec<ErrorNote>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut stmt = conn.prepare(&format!(
            "SELECT {ERROR_NOTE_COLUMNS} FROM error_notes e
             JOIN ues u ON u.id = e.ue_id
             LEFT JOIN chapters c ON c.id = e.chapter_id
             ORDER BY CASE e.status WHEN 'active' THEN 0 ELSE 1 END,
                      e.next_review_date ASC, e.id DESC"
        ))?;
        let rows = stmt.query_map([], row_to_error_note)?;
        rows.collect()
    })
    .map(Json)
    .map_err(AppError)
}

#[derive(Debug, Deserialize)]
pub struct CreateErrorNoteRequest {
    pub ue_id: i64,
    pub chapter_id: Option<i64>,
    pub title: String,
    pub error_type: String,
    pub skill: String,
    pub my_reasoning: Option<String>,
    pub correction: Option<String>,
    pub source: Option<String>,
}

/// Mints a révision éclair flashcard from an error note — the note's title
/// is the recto, its correction the verso — so a recorded mistake gets daily
/// spaced-repetition recall on top of the deliberate revision ladder. Only
/// fires when the note has both a chapter (flashcards.chapter_id is NOT
/// NULL) and a non-empty correction (an empty verso is a useless card).
/// Idempotent: the UNIQUE index on error_note_id (+ OR IGNORE) keeps one
/// card per note, and ON DELETE CASCADE removes the card with the note.
/// Box 0 puts it at the front of the next deck.
pub(crate) fn create_card_for_error_note(conn: &Connection, note_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO flashcards (chapter_id, error_note_id, question, answer, box_level, next_review_date)
         SELECT e.chapter_id, e.id, e.title, e.correction, 0, date('now','localtime')
         FROM error_notes e
         WHERE e.id = ?1 AND e.chapter_id IS NOT NULL AND TRIM(COALESCE(e.correction, '')) <> ''",
        params![note_id],
    )?;
    Ok(())
}

pub async fn create_error_note(
    State(state): State<AppState>,
    Json(body): Json<CreateErrorNoteRequest>,
) -> Result<Json<ErrorNote>, AppError> {
    let title = body.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError("Le point d'erreur doit être renseigné".into()));
    }
    with_conn(&state.db, |conn| {
        // next_review_date is set explicitly with localtime rather than
        // relying on the column DEFAULT's date('now') (UTC): all review-due
        // logic in this app runs on the user's local calendar day (the
        // chapter scheduler uses chrono::Local), and a UTC date is a day
        // behind for the first hour(s) after local midnight.
        conn.execute(
            "INSERT INTO error_notes (ue_id, chapter_id, title, error_type, skill, my_reasoning, correction, source, next_review_date)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, date('now','localtime'))",
            params![
                body.ue_id,
                body.chapter_id,
                title,
                body.error_type,
                body.skill,
                body.my_reasoning.filter(|s| !s.trim().is_empty()),
                body.correction.filter(|s| !s.trim().is_empty()),
                body.source.unwrap_or_else(|| "manual".into()),
            ],
        )?;
        let id = conn.last_insert_rowid();
        create_card_for_error_note(conn, id)?;
        conn.query_row(
            &format!(
                "SELECT {ERROR_NOTE_COLUMNS} FROM error_notes e
                 JOIN ues u ON u.id = e.ue_id
                 LEFT JOIN chapters c ON c.id = e.chapter_id
                 WHERE e.id = ?1"
            ),
            params![id],
            row_to_error_note,
        )
    })
    .map(Json)
    .map_err(AppError)
}

/// Advance a mistake through the revision ladder. The first four steps map to
/// recall, guided application, independent mini-case, and timed extract. A
/// completed timed extract marks the mistake mastered; it stays visible as a
/// useful record but no longer appears in the due work.
pub async fn advance_error_note(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<ErrorNote>, AppError> {
    with_conn(&state.db, |conn| advance_error_note_inner(conn, id))
        .map(Json)
        .map_err(AppError)
}

fn advance_error_note_inner(conn: &Connection, id: i64) -> rusqlite::Result<ErrorNote> {
    let (step, status): (i64, String) = conn.query_row(
        "SELECT ladder_step, status FROM error_notes WHERE id = ?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if status == "active" {
        let (next_step, next_status, delay_days) = match step {
            0 => (1, "active", 1),
            1 => (2, "active", 3),
            2 => (3, "active", 7),
            _ => (4, "mastered", 0),
        };
        // localtime for the same reason as create_error_note: due-dates live
        // on the user's local calendar day, not UTC's.
        conn.execute(
            "UPDATE error_notes SET ladder_step = ?1, status = ?2,
                next_review_date = date('now','localtime', ?3), updated_at = datetime('now')
             WHERE id = ?4",
            params![next_step, next_status, format!("+{delay_days} days"), id],
        )?;
    }
    conn.query_row(
        &format!(
            "SELECT {ERROR_NOTE_COLUMNS} FROM error_notes e
             JOIN ues u ON u.id = e.ue_id
             LEFT JOIN chapters c ON c.id = e.chapter_id
             WHERE e.id = ?1"
        ),
        params![id],
        row_to_error_note,
    )
}

pub async fn delete_error_note(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<(), AppError> {
    with_conn(&state.db, |conn| {
        conn.execute("DELETE FROM error_notes WHERE id = ?1", params![id])?;
        Ok(())
    })
    .map_err(AppError)
}

pub async fn list_skill_profiles(
    State(state): State<AppState>,
) -> Result<Json<Vec<SkillProfileRow>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut stmt = conn.prepare(
            "SELECT u.id, s.skill, a.score, a.note, a.recorded_at
             FROM ues u
             CROSS JOIN (
                 SELECT 'recall' AS skill UNION ALL SELECT 'method' UNION ALL
                 SELECT 'application' UNION ALL SELECT 'technical' UNION ALL SELECT 'time'
             ) s
             LEFT JOIN skill_assessments a ON a.id = (
                 SELECT a2.id FROM skill_assessments a2
                 WHERE a2.ue_id = u.id AND a2.skill = s.skill
                 ORDER BY a2.recorded_at DESC, a2.id DESC LIMIT 1
             )
             ORDER BY u.position, s.skill",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SkillProfileRow {
                ue_id: row.get(0)?,
                skill: row.get(1)?,
                score: row.get(2)?,
                note: row.get(3)?,
                recorded_at: row.get(4)?,
            })
        })?;
        rows.collect()
    })
    .map(Json)
    .map_err(AppError)
}

#[derive(Debug, Deserialize)]
pub struct RecordSkillRequest {
    pub ue_id: i64,
    pub chapter_id: Option<i64>,
    pub skill: String,
    pub score: i64,
    pub note: Option<String>,
}

pub async fn record_skill_assessment(
    State(state): State<AppState>,
    Json(body): Json<RecordSkillRequest>,
) -> Result<(), AppError> {
    if !(1..=4).contains(&body.score) {
        return Err(AppError("La compétence doit être notée de 1 à 4".into()));
    }
    with_conn(&state.db, |conn| {
        // recorded_at is shown as a calendar date in Pilotage ("évalué le …"),
        // so stamp it with the local day, not the column DEFAULT's UTC day.
        conn.execute(
            "INSERT INTO skill_assessments (ue_id, chapter_id, skill, score, note, recorded_at)
             VALUES (?1, ?2, ?3, ?4, ?5, date('now','localtime'))",
            params![
                body.ue_id,
                body.chapter_id,
                body.skill,
                body.score,
                body.note.filter(|s| !s.trim().is_empty())
            ],
        )?;
        Ok(())
    })
    .map_err(AppError)
}

fn row_to_exam_scenario(row: &rusqlite::Row) -> rusqlite::Result<ExamScenarioRow> {
    Ok(ExamScenarioRow {
        ue_id: row.get(0)?,
        ue_code: row.get(1)?,
        ue_name: row.get(2)?,
        ue_color: row.get(3)?,
        current_mark: row.get(4)?,
        target_mark: row.get(5)?,
    })
}

pub async fn list_exam_scenario(
    State(state): State<AppState>,
) -> Result<Json<Vec<ExamScenarioRow>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut stmt = conn.prepare(
            "SELECT u.id, u.code, u.name, u.color, es.current_mark, es.target_mark
             FROM ues u LEFT JOIN exam_scenarios es ON es.ue_id = u.id
             ORDER BY u.position",
        )?;
        let rows = stmt.query_map([], row_to_exam_scenario)?;
        rows.collect()
    })
    .map(Json)
    .map_err(AppError)
}

#[derive(Debug, Deserialize)]
pub struct SetExamScenarioRequest {
    pub current_mark: Option<f64>,
    pub target_mark: Option<f64>,
}

pub async fn set_exam_scenario(
    State(state): State<AppState>,
    Path(ue_id): Path<i64>,
    Json(body): Json<SetExamScenarioRequest>,
) -> Result<(), AppError> {
    for mark in [body.current_mark, body.target_mark].into_iter().flatten() {
        if !(0.0..=20.0).contains(&mark) {
            return Err(AppError("Une note doit être comprise entre 0 et 20".into()));
        }
    }
    with_conn(&state.db, |conn| {
        conn.execute(
            "INSERT INTO exam_scenarios (ue_id, current_mark, target_mark)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(ue_id) DO UPDATE SET
                 current_mark = excluded.current_mark,
                 target_mark = excluded.target_mark,
                 updated_at = datetime('now')",
            params![ue_id, body.current_mark, body.target_mark],
        )?;
        Ok(())
    })
    .map_err(AppError)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate::run(&conn).unwrap();
        conn.execute("INSERT INTO ues (code, name) VALUES ('UE1', 'Test UE')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO error_notes (ue_id, title, error_type, skill) VALUES (1, 'Mauvais régime de TVA', 'method', 'method')",
            [],
        )
        .unwrap();
        conn
    }

    fn local_date_plus(days: i64) -> String {
        (chrono::Local::now().date_naive() + chrono::Duration::days(days)).to_string()
    }

    #[test]
    fn ladder_advances_through_all_steps_with_growing_delays() {
        let conn = setup();

        // Step 0 → 1: due again tomorrow.
        let note = advance_error_note_inner(&conn, 1).unwrap();
        assert_eq!((note.ladder_step, note.status.as_str()), (1, "active"));
        assert_eq!(note.next_review_date, local_date_plus(1));

        // Step 1 → 2: +3 days.
        let note = advance_error_note_inner(&conn, 1).unwrap();
        assert_eq!((note.ladder_step, note.status.as_str()), (2, "active"));
        assert_eq!(note.next_review_date, local_date_plus(3));

        // Step 2 → 3: +7 days.
        let note = advance_error_note_inner(&conn, 1).unwrap();
        assert_eq!((note.ladder_step, note.status.as_str()), (3, "active"));
        assert_eq!(note.next_review_date, local_date_plus(7));

        // Step 3 → 4: the timed extract is done, the mistake is mastered.
        let note = advance_error_note_inner(&conn, 1).unwrap();
        assert_eq!((note.ladder_step, note.status.as_str()), (4, "mastered"));
    }

    #[test]
    fn advancing_a_mastered_note_is_a_no_op() {
        let conn = setup();
        for _ in 0..4 {
            advance_error_note_inner(&conn, 1).unwrap();
        }
        let before: String = conn
            .query_row(
                "SELECT next_review_date FROM error_notes WHERE id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();

        let note = advance_error_note_inner(&conn, 1).unwrap();
        assert_eq!((note.ladder_step, note.status.as_str()), (4, "mastered"));
        assert_eq!(note.next_review_date, before);
    }
}
