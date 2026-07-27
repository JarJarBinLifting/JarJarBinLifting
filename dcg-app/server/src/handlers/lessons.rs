use crate::appstate::{AppError, AppState};
use crate::db::with_conn;
use axum::extract::{Path, State};
use axum::Json;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;

mod quality;
use quality::audit_lesson;

#[derive(Debug, Serialize)]
pub struct LessonVersion {
    id: i64,
    chapter_id: i64,
    chapter_name: String,
    ue_code: String,
    version_number: i64,
    format_version: i64,
    prompt_version: Option<i64>,
    difficulty: String,
    source: Option<String>,
    generated_at: Option<String>,
    generated_with: Option<String>,
    raw_json: String,
    story_steps: i64,
    flashcard_count: i64,
    qcm_count: i64,
    warning_count: i64,
    flag_count: i64,
    is_active: bool,
    imported_at: String,
}

#[derive(Debug, Serialize)]
pub struct LessonSummary {
    id: i64,
    chapter_id: i64,
    version_number: i64,
    prompt_version: Option<i64>,
    difficulty: String,
    source: Option<String>,
    generated_at: Option<String>,
    generated_with: Option<String>,
    story_steps: i64,
    flashcard_count: i64,
    qcm_count: i64,
    warning_count: i64,
    flag_count: i64,
    imported_at: String,
}

#[derive(Debug, Serialize)]
pub struct LessonFlag {
    id: i64,
    lesson_version_id: i64,
    item_type: String,
    item_index: Option<i64>,
    reason: String,
    status: String,
    created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct ImportLessonRequest {
    raw_json: String,
    #[serde(default)]
    warning_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateFlagRequest {
    item_type: String,
    item_index: Option<i64>,
    reason: String,
}

fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn validate(
    raw: &str,
    expected_chapter: &str,
    expected_ue: &str,
) -> Result<(Value, i64, i64, i64, i64), AppError> {
    let data: Value = serde_json::from_str(raw)
        .map_err(|_| AppError("La leçon n'est pas un JSON valide".into()))?;
    if data.get("format").and_then(Value::as_str) != Some("dcg-lesson") {
        return Err(AppError("Format de leçon non reconnu".into()));
    }
    let steps = data
        .pointer("/story/etapes")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError("La leçon ne contient aucune étape".into()))?;
    let cards = data
        .get("flashcards")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError("La leçon ne contient aucune flashcard".into()))?;
    let questions = data
        .pointer("/qcm/questions")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError("La leçon ne contient aucun QCM".into()))?;
    if steps.is_empty() || cards.is_empty() || questions.is_empty() {
        return Err(AppError(
            "La leçon doit contenir des étapes, des flashcards et un QCM".into(),
        ));
    }
    for (index, question) in questions.iter().enumerate() {
        let options = question
            .get("options")
            .and_then(Value::as_array)
            .ok_or_else(|| AppError(format!("Question {} : options manquantes", index + 1)))?;
        let correct = question
            .get("correct")
            .and_then(Value::as_i64)
            .ok_or_else(|| AppError(format!("Question {} : bonne réponse manquante", index + 1)))?;
        if options.len() != 4 || correct < 0 || correct >= options.len() as i64 {
            return Err(AppError(format!(
                "Question {} : quatre options et un index correct valide sont requis",
                index + 1
            )));
        }
    }
    let audit = audit_lesson(&data, expected_chapter, expected_ue).map_err(AppError)?;
    let counts = (
        steps.len() as i64,
        cards.len() as i64,
        questions.len() as i64,
    );
    Ok((
        data,
        counts.0,
        counts.1,
        counts.2,
        audit.warnings.len() as i64,
    ))
}

pub async fn list_active(
    State(state): State<AppState>,
) -> Result<Json<Vec<LessonSummary>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut statement = conn.prepare(
            "SELECT lv.id, lv.chapter_id, lv.version_number, lv.prompt_version, lv.difficulty,
                    lv.source, lv.generated_at, lv.generated_with, lv.story_steps, lv.flashcard_count,
                    lv.qcm_count, lv.warning_count,
                    (SELECT COUNT(*) FROM lesson_flags f WHERE f.lesson_version_id = lv.id AND f.status = 'active'),
                    lv.imported_at
             FROM lesson_versions lv WHERE lv.is_active = 1 ORDER BY lv.chapter_id",
        )?;
        let rows = statement.query_map([], |row| Ok(LessonSummary {
            id: row.get(0)?, chapter_id: row.get(1)?, version_number: row.get(2)?, prompt_version: row.get(3)?, difficulty: row.get(4)?,
            source: row.get(5)?, generated_at: row.get(6)?, generated_with: row.get(7)?, story_steps: row.get(8)?, flashcard_count: row.get(9)?,
            qcm_count: row.get(10)?, warning_count: row.get(11)?, flag_count: row.get(12)?, imported_at: row.get(13)?,
        }))?;
        rows.collect()
    }).map(Json).map_err(AppError)
}

fn get_version(conn: &rusqlite::Connection, id: i64) -> rusqlite::Result<LessonVersion> {
    conn.query_row(
        "SELECT lv.id, lv.chapter_id, c.name, u.code, lv.version_number, lv.format_version, lv.prompt_version,
                lv.difficulty, lv.source, lv.generated_at, lv.generated_with, lv.raw_json, lv.story_steps,
                lv.flashcard_count, lv.qcm_count, lv.warning_count,
                (SELECT COUNT(*) FROM lesson_flags f WHERE f.lesson_version_id = lv.id AND f.status = 'active'),
                lv.is_active, lv.imported_at
         FROM lesson_versions lv JOIN chapters c ON c.id = lv.chapter_id JOIN ues u ON u.id = c.ue_id WHERE lv.id = ?1",
        params![id],
        |row| Ok(LessonVersion {
            id: row.get(0)?, chapter_id: row.get(1)?, chapter_name: row.get(2)?, ue_code: row.get(3)?, version_number: row.get(4)?,
            format_version: row.get(5)?, prompt_version: row.get(6)?, difficulty: row.get(7)?, source: row.get(8)?, generated_at: row.get(9)?,
            generated_with: row.get(10)?, raw_json: row.get(11)?, story_steps: row.get(12)?, flashcard_count: row.get(13)?, qcm_count: row.get(14)?,
            warning_count: row.get(15)?, flag_count: row.get(16)?, is_active: row.get::<_, i64>(17)? != 0, imported_at: row.get(18)?,
        }),
    )
}

pub async fn list_chapter_versions(
    State(state): State<AppState>,
    Path(chapter_id): Path<i64>,
) -> Result<Json<Vec<LessonVersion>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut ids = conn.prepare(
            "SELECT id FROM lesson_versions WHERE chapter_id = ?1 ORDER BY version_number DESC",
        )?;
        let result = ids
            .query_map(params![chapter_id], |row| row.get(0))?
            .map(|id| get_version(conn, id?))
            .collect();
        result
    })
    .map(Json)
    .map_err(AppError)
}

pub async fn import_version(
    State(state): State<AppState>,
    Path(chapter_id): Path<i64>,
    Json(body): Json<ImportLessonRequest>,
) -> Result<Json<LessonVersion>, AppError> {
    let (chapter_name, ue_code): (String, String) = with_conn(&state.db, |conn| {
        conn.query_row(
            "SELECT c.name, u.code FROM chapters c JOIN ues u ON u.id = c.ue_id WHERE c.id = ?1",
            params![chapter_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    })
    .map_err(AppError)?;
    let (data, steps, cards, questions, server_warnings) =
        validate(&body.raw_json, &chapter_name, &ue_code)?;
    with_conn(&state.db, |conn| {
        let next: i64 = conn.query_row("SELECT COALESCE(MAX(version_number), 0) + 1 FROM lesson_versions WHERE chapter_id = ?1", params![chapter_id], |row| row.get(0))?;
        conn.execute("UPDATE lesson_versions SET is_active = 0 WHERE chapter_id = ?1", params![chapter_id])?;
        conn.execute(
            "INSERT INTO lesson_versions (chapter_id, version_number, format_version, prompt_version, difficulty, source, generated_at, generated_with, raw_json, story_steps, flashcard_count, qcm_count, warning_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![chapter_id, next, data.get("version").and_then(Value::as_i64).unwrap_or(1), data.get("prompt_version").and_then(Value::as_i64), text(&data, "difficulty").unwrap_or_else(|| "Fondamental".into()), text(&data, "source"), text(&data, "generated_at"), text(&data, "generated_with"), body.raw_json, steps, cards, questions, body.warning_count.max(0).max(server_warnings)],
        )?;
        get_version(conn, conn.last_insert_rowid())
    }).map(Json).map_err(AppError)
}

pub async fn activate_version(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<LessonVersion>, AppError> {
    with_conn(&state.db, |conn| {
        let chapter_id: i64 = conn.query_row("SELECT chapter_id FROM lesson_versions WHERE id = ?1", params![id], |row| row.get(0))?;
        conn.execute("UPDATE lesson_versions SET is_active = CASE WHEN id = ?1 THEN 1 ELSE 0 END WHERE chapter_id = ?2", params![id, chapter_id])?;
        get_version(conn, id)
    }).map(Json).map_err(AppError)
}

pub async fn list_flags(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<LessonFlag>>, AppError> {
    with_conn(&state.db, |conn| {
        let mut statement = conn.prepare("SELECT id, lesson_version_id, item_type, item_index, reason, status, created_at FROM lesson_flags WHERE lesson_version_id = ?1 ORDER BY id DESC")?;
        let rows = statement.query_map(params![id], |row| Ok(LessonFlag { id: row.get(0)?, lesson_version_id: row.get(1)?, item_type: row.get(2)?, item_index: row.get(3)?, reason: row.get(4)?, status: row.get(5)?, created_at: row.get(6)? }))?;
        rows.collect()
    }).map(Json).map_err(AppError)
}

pub async fn create_flag(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<CreateFlagRequest>,
) -> Result<Json<LessonFlag>, AppError> {
    if !["flashcard", "qcm", "lesson"].contains(&body.item_type.as_str())
        || body.reason.trim().is_empty()
    {
        return Err(AppError(
            "Le type et la raison du signalement sont requis".into(),
        ));
    }
    with_conn(&state.db, |conn| {
        conn.execute("INSERT INTO lesson_flags (lesson_version_id, item_type, item_index, reason) VALUES (?1, ?2, ?3, ?4)", params![id, body.item_type, body.item_index, body.reason.trim()])?;
        let flag_id = conn.last_insert_rowid();
        conn.query_row("SELECT id, lesson_version_id, item_type, item_index, reason, status, created_at FROM lesson_flags WHERE id = ?1", params![flag_id], |row| Ok(LessonFlag { id: row.get(0)?, lesson_version_id: row.get(1)?, item_type: row.get(2)?, item_index: row.get(3)?, reason: row.get(4)?, status: row.get(5)?, created_at: row.get(6)? }))
    }).map(Json).map_err(AppError)
}

pub async fn resolve_flag(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<(), AppError> {
    with_conn(&state.db, |conn| { conn.execute("UPDATE lesson_flags SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?1", params![id])?; Ok(()) }).map_err(AppError)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    fn fixture(model: &str) -> String {
        format!(
            r#"{{"format":"dcg-lesson","version":2,"prompt_version":2,"difficulty":"Fondamental","generated_with":"{model}","story":{{"etapes":[{{"titre_court":"A","contexte_narratif":"B","type_activite":"prediction","question_activite":"C","hypotheses":["a","b","c"],"feedbacks":["a","b","c"],"notion":"N","explication":"E","application":"A","a_retenir":"R","question_rappel":"Q"}}]}},"flashcards":[{{"recto":"R","verso":"V"}}],"qcm":{{"questions":[{{"question":"Q","options":["A","B","C","D"],"correct":0,"explication":"E"}}]}}}}"#
        )
    }

    #[test]
    fn representative_llm_files_share_the_same_contract() {
        for raw in [
            include_str!("../../tests/fixtures/lesson_claude_ue2.json"),
            include_str!("../../tests/fixtures/lesson_chatgpt_ue4.json"),
            include_str!("../../tests/fixtures/lesson_gemini_ue10.json"),
        ] {
            let (_, steps, cards, qcm, _) =
                validate(raw, "", "").unwrap_or_else(|_| panic!("fixture must validate"));
            assert_eq!((steps, cards, qcm), (1, 1, 1));
        }
    }

    #[test]
    fn server_validation_rejects_a_lesson_attached_to_another_import_target() {
        let mut lesson: Value = serde_json::from_str(&fixture("Claude")).unwrap();
        lesson["chapitre"] = Value::String("Autre chapitre".into());
        lesson["ue"] = Value::String("UE2".into());
        let raw = serde_json::to_string(&lesson).unwrap();

        assert!(validate(&raw, "Chapitre", "UE1").is_err());
    }

    #[test]
    fn versions_are_immutable_and_only_one_is_active() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        migrate::run(&conn).unwrap();
        conn.execute("INSERT INTO ues (code,name) VALUES ('UE1','Test')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO chapters (ue_id,name) VALUES (1,'Chapitre')",
            [],
        )
        .unwrap();
        let raw = fixture("Claude");
        let (data, steps, cards, qcm, _) =
            validate(&raw, "", "").unwrap_or_else(|_| panic!("fixture must validate"));
        for version in 1..=2 {
            conn.execute(
                "UPDATE lesson_versions SET is_active=0 WHERE chapter_id=1",
                [],
            )
            .unwrap();
            conn.execute("INSERT INTO lesson_versions (chapter_id,version_number,format_version,difficulty,raw_json,story_steps,flashcard_count,qcm_count) VALUES (1,?1,2,'Fondamental',?2,?3,?4,?5)", params![version, raw, steps, cards, qcm]).unwrap();
        }
        let active: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM lesson_versions WHERE is_active=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM lesson_versions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            (active, total, data["version"].as_i64().unwrap()),
            (1, 2, 2)
        );
    }
}
