use crate::appstate::{AppError, AppState};
use crate::db::with_conn;
use axum::extract::State;
use axum::Json;
use rusqlite::{params, Connection};
use serde::Serialize;

/// The Sunday-ritual view: one query bundle answering "what did this week
/// actually look like, and what does next week ask of me?" — pure SQL over
/// data the app already records, zero LLM calls.
#[derive(Debug, Serialize)]
pub struct WeeklyBilan {
    /// Monday (local time) of the current week — the week runs Mon→Sun.
    pub week_start: String,
    pub minutes_this_week: i64,
    pub minutes_last_week: i64,
    /// Every UE, busiest first — zero-minute rows are the neglect signal,
    /// which is exactly why they're not filtered out server-side.
    pub per_ue: Vec<UeWeekTime>,
    pub tutor_sessions_completed: i64,
    pub cards_reviewed: i64,
    pub quiz_answered: i64,
    pub qcm_avg_pct: Option<f64>,
    pub errors_created: i64,
    pub errors_mastered: i64,
    /// Active error notes overdue by more than 3 days — the ladder stalled.
    pub errors_stalled: i64,
    pub annales: Vec<WeeklyAnnale>,
    /// Chapters whose review lands within the next 7 days (overdue included).
    pub due_next_week: i64,
}

#[derive(Debug, Serialize)]
pub struct UeWeekTime {
    pub ue_id: i64,
    pub ue_code: String,
    pub ue_name: String,
    pub ue_color: Option<String>,
    pub minutes: i64,
}

#[derive(Debug, Serialize)]
pub struct WeeklyAnnale {
    pub title: String,
    pub ue_code: String,
    pub score: Option<f64>,
    pub total: Option<f64>,
}

pub async fn weekly_bilan(State(state): State<AppState>) -> Result<Json<WeeklyBilan>, AppError> {
    let today = chrono::Local::now().date_naive();
    with_conn(&state.db, |conn| weekly_bilan_inner(conn, today))
        .map(Json)
        .map_err(AppError)
}

fn weekly_bilan_inner(conn: &Connection, today: chrono::NaiveDate) -> rusqlite::Result<WeeklyBilan> {
    use chrono::Datelike;
    let monday = today - chrono::Duration::days(today.weekday().num_days_from_monday() as i64);
    let next_monday = (monday + chrono::Duration::days(7)).to_string();
    let last_monday = (monday - chrono::Duration::days(7)).to_string();
    let monday = monday.to_string();

    // sessions.ended_at arrives in two formats (ISO with Z from the timer UI,
    // SQLite datetime from annale completion) — date(col,'localtime')
    // normalizes both onto the local calendar day.
    let minutes_this_week: i64 = conn.query_row(
        "SELECT COALESCE(SUM(duration_seconds), 0) / 60 FROM sessions
         WHERE date(ended_at,'localtime') >= ?1 AND date(ended_at,'localtime') < ?2",
        params![monday, next_monday],
        |r| r.get(0),
    )?;
    let minutes_last_week: i64 = conn.query_row(
        "SELECT COALESCE(SUM(duration_seconds), 0) / 60 FROM sessions
         WHERE date(ended_at,'localtime') >= ?1 AND date(ended_at,'localtime') < ?2",
        params![last_monday, monday],
        |r| r.get(0),
    )?;

    let mut stmt = conn.prepare(
        "SELECT u.id, u.code, u.name, u.color,
                COALESCE((SELECT SUM(s.duration_seconds) FROM sessions s
                          WHERE s.ue_id = u.id
                            AND date(s.ended_at,'localtime') >= ?1
                            AND date(s.ended_at,'localtime') < ?2), 0) / 60 AS minutes
         FROM ues u
         ORDER BY minutes DESC, u.position",
    )?;
    let per_ue = stmt
        .query_map(params![monday, next_monday], |row| {
            Ok(UeWeekTime {
                ue_id: row.get(0)?,
                ue_code: row.get(1)?,
                ue_name: row.get(2)?,
                ue_color: row.get(3)?,
                minutes: row.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let tutor_sessions_completed: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tutor_sessions
         WHERE status = 'completed' AND date(completed_at,'localtime') >= ?1 AND date(completed_at,'localtime') < ?2",
        params![monday, next_monday],
        |r| r.get(0),
    )?;
    let cards_reviewed: i64 = conn.query_row(
        "SELECT COUNT(*) FROM flashcards
         WHERE last_reviewed_at IS NOT NULL AND date(last_reviewed_at,'localtime') >= ?1 AND date(last_reviewed_at,'localtime') < ?2",
        params![monday, next_monday],
        |r| r.get(0),
    )?;
    let quiz_answered: i64 = conn.query_row(
        "SELECT COUNT(*) FROM quiz_items
         WHERE last_reviewed_at IS NOT NULL AND date(last_reviewed_at,'localtime') >= ?1 AND date(last_reviewed_at,'localtime') < ?2",
        params![monday, next_monday],
        |r| r.get(0),
    )?;
    // qcm_scores.date is already a plain local date string.
    let qcm_avg_pct: Option<f64> = conn.query_row(
        "SELECT AVG(score * 100.0 / total) FROM qcm_scores
         WHERE total > 0 AND date >= ?1 AND date < ?2",
        params![monday, next_monday],
        |r| r.get(0),
    )?;

    let errors_created: i64 = conn.query_row(
        "SELECT COUNT(*) FROM error_notes
         WHERE date(created_at,'localtime') >= ?1 AND date(created_at,'localtime') < ?2",
        params![monday, next_monday],
        |r| r.get(0),
    )?;
    let errors_mastered: i64 = conn.query_row(
        "SELECT COUNT(*) FROM error_notes
         WHERE status = 'mastered' AND date(updated_at,'localtime') >= ?1 AND date(updated_at,'localtime') < ?2",
        params![monday, next_monday],
        |r| r.get(0),
    )?;
    let errors_stalled: i64 = conn.query_row(
        "SELECT COUNT(*) FROM error_notes
         WHERE status = 'active' AND next_review_date <= date(?1, '-3 days')",
        params![today.to_string()],
        |r| r.get(0),
    )?;

    let mut stmt = conn.prepare(
        "SELECT a.title, u.code, a.score, a.total
         FROM annale_attempts a JOIN ues u ON u.id = a.ue_id
         WHERE a.status = 'completed' AND date(a.completed_at,'localtime') >= ?1 AND date(a.completed_at,'localtime') < ?2
         ORDER BY a.completed_at DESC",
    )?;
    let annales = stmt
        .query_map(params![monday, next_monday], |row| {
            Ok(WeeklyAnnale {
                title: row.get(0)?,
                ue_code: row.get(1)?,
                score: row.get(2)?,
                total: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let due_next_week: i64 = conn.query_row(
        "SELECT COUNT(*) FROM review_schedule WHERE next_review_date <= date(?1, '+7 days')",
        params![today.to_string()],
        |r| r.get(0),
    )?;

    Ok(WeeklyBilan {
        week_start: monday,
        minutes_this_week,
        minutes_last_week,
        per_ue,
        tutor_sessions_completed,
        cards_reviewed,
        quiz_answered,
        qcm_avg_pct,
        errors_created,
        errors_mastered,
        errors_stalled,
        annales,
        due_next_week,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use chrono::Datelike;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        migrate::run(&conn).unwrap();
        conn.execute("INSERT INTO ues (code, name, position) VALUES ('UE4', 'Droit fiscal', 1)", []).unwrap();
        conn.execute("INSERT INTO ues (code, name, position) VALUES ('UE9', 'Compta', 2)", []).unwrap();
        conn
    }

    fn monday_of(today: chrono::NaiveDate) -> chrono::NaiveDate {
        today - chrono::Duration::days(today.weekday().num_days_from_monday() as i64)
    }

    fn insert_session(conn: &Connection, ue_id: i64, minutes: i64, date: chrono::NaiveDate) {
        conn.execute(
            "INSERT INTO sessions (ue_id, duration_seconds, started_at, ended_at) VALUES (?1, ?2, ?3, ?3)",
            params![ue_id, minutes * 60, format!("{date} 10:00:00")],
        )
        .unwrap();
    }

    #[test]
    fn buckets_study_time_into_this_week_and_last_week_per_ue() {
        let conn = setup();
        let today = chrono::Local::now().date_naive();
        let monday = monday_of(today);

        insert_session(&conn, 1, 45, monday); // this week, UE4
        insert_session(&conn, 1, 30, today); // this week, UE4
        insert_session(&conn, 2, 20, monday - chrono::Duration::days(2)); // last week, UE9
        insert_session(&conn, 2, 10, monday - chrono::Duration::days(7)); // last week (its Monday)

        let bilan = weekly_bilan_inner(&conn, today).unwrap();
        assert_eq!(bilan.week_start, monday.to_string());
        assert_eq!(bilan.minutes_this_week, 75);
        assert_eq!(bilan.minutes_last_week, 30);

        // Busiest first; the untouched UE is present with 0 minutes — that's
        // the neglect signal.
        assert_eq!(bilan.per_ue[0].ue_code, "UE4");
        assert_eq!(bilan.per_ue[0].minutes, 75);
        assert_eq!(bilan.per_ue[1].ue_code, "UE9");
        assert_eq!(bilan.per_ue[1].minutes, 0);
    }

    #[test]
    fn counts_notebook_movement_and_stalled_notes() {
        let conn = setup();
        let today = chrono::Local::now().date_naive();

        // Created now → counts as created this week; mastering it now also
        // counts. A second note overdue by 5 days is stalled.
        conn.execute("INSERT INTO error_notes (ue_id, title, error_type, skill) VALUES (1, 'fraîche', 'method', 'method')", []).unwrap();
        conn.execute(
            "INSERT INTO error_notes (ue_id, title, error_type, skill, next_review_date) VALUES (1, 'en panne', 'method', 'method', date(?1, '-5 days'))",
            params![today.to_string()],
        )
        .unwrap();
        conn.execute("UPDATE error_notes SET status = 'mastered' WHERE title = 'fraîche'", []).unwrap();

        let bilan = weekly_bilan_inner(&conn, today).unwrap();
        assert_eq!(bilan.errors_created, 2);
        assert_eq!(bilan.errors_mastered, 1);
        assert_eq!(bilan.errors_stalled, 1);
    }

    #[test]
    fn empty_database_yields_a_calm_all_zero_bilan() {
        let conn = setup();
        let bilan = weekly_bilan_inner(&conn, chrono::Local::now().date_naive()).unwrap();
        assert_eq!(bilan.minutes_this_week, 0);
        assert_eq!(bilan.qcm_avg_pct, None);
        assert_eq!(bilan.annales.len(), 0);
        assert_eq!(bilan.due_next_week, 0);
    }
}
