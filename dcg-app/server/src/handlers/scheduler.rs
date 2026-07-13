use chrono::NaiveDate;

/// Interval in days for boxes 1..=5, index 0 == box 1.
pub const BOX_INTERVALS_DAYS: [i64; 5] = [1, 3, 7, 14, 30];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Strong,
    Ok,
    Weak,
}

impl Outcome {
    pub fn as_str(&self) -> &'static str {
        match self {
            Outcome::Strong => "strong",
            Outcome::Ok => "ok",
            Outcome::Weak => "weak",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct SessionResult {
    pub qcm_score: i64,
    pub qcm_total: i64,
    /// Mean of the per-concept 1–3 self-ratings collected during Découverte.
    pub avg_confidence: f64,
    /// Concepts self-rated >=3 whose linked QCM question(s) were missed.
    pub overconfidence_count: i64,
}

pub struct ScheduleUpdate {
    pub box_level: i64,
    pub outcome: Outcome,
    pub next_review_date: NaiveDate,
}

/// Chapter-level Leitner update. `current_box` is the box the chapter was in
/// before this session — pass 1 for a chapter with no prior schedule.
///
/// Deliberately coarser than SM-2 (no continuous ease factor): it mirrors the
/// flashcard-level Leitner mechanic already used inside a tutor session, so
/// there's one mental model, not two, and "chapter 4 is in box 3, due in 7
/// days" stays easy to explain in the UI.
pub fn next_schedule(current_box: i64, result: SessionResult, today: NaiveDate) -> ScheduleUpdate {
    let qcm_pct = if result.qcm_total > 0 {
        result.qcm_score as f64 / result.qcm_total as f64
    } else {
        0.0
    };

    let outcome = if qcm_pct >= 0.85 && result.avg_confidence >= 2.0 && result.overconfidence_count == 0 {
        Outcome::Strong
    } else if qcm_pct < 0.60 || result.overconfidence_count >= 2 {
        Outcome::Weak
    } else {
        Outcome::Ok
    };

    let box_level = match outcome {
        Outcome::Strong => current_box + 1,
        Outcome::Weak => current_box - 1,
        Outcome::Ok => current_box,
    }
    .clamp(1, 5);

    let interval = BOX_INTERVALS_DAYS[(box_level - 1) as usize];
    let next_review_date = today + chrono::Duration::days(interval);

    ScheduleUpdate {
        box_level,
        outcome,
        next_review_date,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn strong_result_bumps_box_and_pushes_review_out() {
        let result = SessionResult {
            qcm_score: 9,
            qcm_total: 10,
            avg_confidence: 2.5,
            overconfidence_count: 0,
        };
        let upd = next_schedule(2, result, date(2026, 1, 1));
        assert_eq!(upd.box_level, 3);
        assert_eq!(upd.outcome, Outcome::Strong);
        assert_eq!(upd.next_review_date, date(2026, 1, 8)); // +7d for box 3
    }

    #[test]
    fn weak_qcm_drops_box_even_with_no_prior_history() {
        let result = SessionResult {
            qcm_score: 3,
            qcm_total: 10,
            avg_confidence: 2.0,
            overconfidence_count: 0,
        };
        let upd = next_schedule(1, result, date(2026, 1, 1));
        assert_eq!(upd.box_level, 1); // already floor
        assert_eq!(upd.outcome, Outcome::Weak);
        assert_eq!(upd.next_review_date, date(2026, 1, 2));
    }

    #[test]
    fn overconfidence_forces_weak_even_with_decent_score() {
        let result = SessionResult {
            qcm_score: 7,
            qcm_total: 10,
            avg_confidence: 2.8,
            overconfidence_count: 2,
        };
        let upd = next_schedule(3, result, date(2026, 1, 1));
        assert_eq!(upd.outcome, Outcome::Weak);
        assert_eq!(upd.box_level, 2);
    }

    #[test]
    fn mediocre_result_holds_box_steady() {
        let result = SessionResult {
            qcm_score: 7,
            qcm_total: 10,
            avg_confidence: 1.8,
            overconfidence_count: 0,
        };
        let upd = next_schedule(3, result, date(2026, 1, 1));
        assert_eq!(upd.outcome, Outcome::Ok);
        assert_eq!(upd.box_level, 3);
    }

    #[test]
    fn box_never_exceeds_five_or_drops_below_one() {
        let strong = SessionResult {
            qcm_score: 10,
            qcm_total: 10,
            avg_confidence: 3.0,
            overconfidence_count: 0,
        };
        assert_eq!(next_schedule(5, strong, date(2026, 1, 1)).box_level, 5);

        let weak = SessionResult {
            qcm_score: 0,
            qcm_total: 10,
            avg_confidence: 1.0,
            overconfidence_count: 0,
        };
        assert_eq!(next_schedule(1, weak, date(2026, 1, 1)).box_level, 1);
    }

    #[test]
    fn zero_total_qcm_treated_as_weak_not_a_crash() {
        let result = SessionResult {
            qcm_score: 0,
            qcm_total: 0,
            avg_confidence: 2.0,
            overconfidence_count: 0,
        };
        let upd = next_schedule(2, result, date(2026, 1, 1));
        assert_eq!(upd.outcome, Outcome::Weak);
        assert_eq!(upd.box_level, 1);
    }
}
