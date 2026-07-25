use crate::appstate::{AppError, AppState};
use crate::db::with_conn;
use axum::extract::State;
use axum::Json;
#[cfg(test)]
use rusqlite::params;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Serialize)]
pub struct CalibrationHistory {
    pub ues: Vec<UeCalibrationHistory>,
}

#[derive(Debug, Serialize)]
pub struct UeCalibrationHistory {
    pub ue_id: i64,
    pub ue_code: String,
    pub ue_name: String,
    pub ue_color: Option<String>,
    pub average_absolute_gap: i64,
    pub trend: String,
    pub sessions: Vec<CalibrationPoint>,
}

#[derive(Debug, Serialize)]
pub struct CalibrationPoint {
    pub chapter_name: String,
    pub completed_at: String,
    pub self_rated_percent: i64,
    pub assessed_percent: i64,
    /// Positive means the QCM was stronger than the pre-QCM estimate.
    pub gap: i64,
    pub status: String,
}

#[derive(Debug)]
struct RawCalibrationRow {
    ue_id: i64,
    ue_code: String,
    ue_name: String,
    ue_color: Option<String>,
    chapter_name: String,
    completed_at: String,
    confidence_json: String,
    qcm_score: i64,
    qcm_total: i64,
}

fn confidence_percent(raw: &str) -> Option<i64> {
    let values = serde_json::from_str::<Value>(raw)
        .ok()?
        .as_array()?
        .iter()
        .filter_map(|entry| {
            entry
                .get("val")?
                .as_f64()
                .filter(|value| (1.0..=3.0).contains(value))
        })
        .collect::<Vec<_>>();
    if values.is_empty() {
        return None;
    }
    Some(((values.iter().sum::<f64>() / values.len() as f64) / 3.0 * 100.0).round() as i64)
}

fn calibration_status(gap: i64) -> &'static str {
    if gap <= -15 {
        "overconfident"
    } else if gap >= 15 {
        "cautious"
    } else {
        "aligned"
    }
}

fn trend(points: &[CalibrationPoint]) -> &'static str {
    if points.len() < 2 {
        return "insufficient";
    }
    let latest = points
        .last()
        .map(|point| point.gap.abs())
        .unwrap_or_default();
    let previous = points[points.len() - 2].gap.abs();
    if latest + 5 < previous {
        "improving"
    } else if latest > previous + 5 {
        "worsening"
    } else {
        "stable"
    }
}

pub async fn calibration_history(
    State(state): State<AppState>,
) -> Result<Json<CalibrationHistory>, AppError> {
    with_conn(&state.db, calibration_history_inner)
        .map(Json)
        .map_err(AppError)
}

fn calibration_history_inner(conn: &Connection) -> rusqlite::Result<CalibrationHistory> {
    let mut statement = conn.prepare(
        "SELECT u.id, u.code, u.name, u.color, c.name, s.completed_at,
                s.confidence_json, s.qcm_score, s.qcm_total
         FROM tutor_sessions s
         JOIN chapters c ON c.id = s.chapter_id
         JOIN ues u ON u.id = c.ue_id
         WHERE s.status = 'completed'
           AND s.confidence_json IS NOT NULL
           AND s.qcm_score IS NOT NULL
           AND s.qcm_total > 0
         ORDER BY s.completed_at ASC, s.id ASC",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok(RawCalibrationRow {
                ue_id: row.get(0)?,
                ue_code: row.get(1)?,
                ue_name: row.get(2)?,
                ue_color: row.get(3)?,
                chapter_name: row.get(4)?,
                completed_at: row.get(5)?,
                confidence_json: row.get(6)?,
                qcm_score: row.get(7)?,
                qcm_total: row.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut grouped: BTreeMap<i64, UeCalibrationHistory> = BTreeMap::new();
    for row in rows {
        let Some(self_rated_percent) = confidence_percent(&row.confidence_json) else {
            continue;
        };
        let assessed_percent = (row.qcm_score * 100 / row.qcm_total).clamp(0, 100);
        let gap = assessed_percent - self_rated_percent;
        let entry = grouped
            .entry(row.ue_id)
            .or_insert_with(|| UeCalibrationHistory {
                ue_id: row.ue_id,
                ue_code: row.ue_code,
                ue_name: row.ue_name,
                ue_color: row.ue_color,
                average_absolute_gap: 0,
                trend: "insufficient".into(),
                sessions: Vec::new(),
            });
        entry.sessions.push(CalibrationPoint {
            chapter_name: row.chapter_name,
            completed_at: row.completed_at,
            self_rated_percent,
            assessed_percent,
            gap,
            status: calibration_status(gap).into(),
        });
    }

    let mut ues = grouped.into_values().collect::<Vec<_>>();
    for ue in &mut ues {
        ue.average_absolute_gap = (ue.sessions.iter().map(|point| point.gap.abs()).sum::<i64>()
            as f64
            / ue.sessions.len() as f64)
            .round() as i64;
        ue.trend = trend(&ue.sessions).into();
    }
    ues.sort_by(|left, right| left.ue_code.cmp(&right.ue_code));
    Ok(CalibrationHistory { ues })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        migrate::run(&conn).unwrap();
        conn.execute(
            "INSERT INTO ues (code, name) VALUES ('UE4', 'Fiscalité')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO chapters (ue_id, name) VALUES (1, 'TVA')", [])
            .unwrap();
        conn
    }

    #[test]
    fn reports_real_calibration_history_and_gap_trend_per_ue() {
        let conn = setup();
        conn.execute(
            "INSERT INTO tutor_sessions (chapter_id, status, confidence_json, qcm_score, qcm_total, completed_at)
             VALUES (1, 'completed', ?1, 4, 10, '2026-07-01 10:00:00')",
            params![r#"[{"val":3}]"#],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tutor_sessions (chapter_id, status, confidence_json, qcm_score, qcm_total, completed_at)
             VALUES (1, 'completed', ?1, 8, 10, '2026-07-10 10:00:00')",
            params![r#"[{"val":3}]"#],
        )
        .unwrap();

        let history = calibration_history_inner(&conn).unwrap();
        assert_eq!(history.ues.len(), 1);
        assert_eq!(history.ues[0].sessions.len(), 2);
        assert_eq!(history.ues[0].sessions[0].status, "overconfident");
        assert_eq!(history.ues[0].trend, "improving");
        assert_eq!(history.ues[0].average_absolute_gap, 40);
    }

    #[test]
    fn skips_malformed_confidence_without_making_up_a_signal() {
        let conn = setup();
        conn.execute(
            "INSERT INTO tutor_sessions (chapter_id, status, confidence_json, qcm_score, qcm_total, completed_at)
             VALUES (1, 'completed', 'not json', 8, 10, '2026-07-10 10:00:00')",
            [],
        )
        .unwrap();

        assert!(calibration_history_inner(&conn).unwrap().ues.is_empty());
    }
}
