use chrono::NaiveDate;

/// Interval in days for boxes 1..=5, index 0 == box 1.
pub const BOX_INTERVALS_DAYS: [i64; 5] = [1, 3, 7, 14, 30];

/// Inside this many days of the exam, review intervals are halved instead of
/// following the normal Leitner spacing — more frequent touches on
/// everything, not just weak chapters, since there's less runway left to
/// space repetitions out.
pub const CRAM_WINDOW_DAYS: i64 = 14;

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
/// `exam_date` is the user's configured exam date (Settings), if set.
///
/// Deliberately coarser than SM-2 (no continuous ease factor): it mirrors the
/// flashcard-level Leitner mechanic already used inside a tutor session, so
/// there's one mental model, not two, and "chapter 4 is in box 3, due in 7
/// days" stays easy to explain in the UI.
///
/// Exam-aware: inside `CRAM_WINDOW_DAYS` of the exam, the interval is halved
/// (denser review touches while there's still time to use them), and the
/// result is never scheduled later than the exam itself — otherwise a chapter
/// that jumps to a long interval (e.g. box 5 → 30 days) could get pushed past
/// exam day and never come back up for review at all.
pub fn next_schedule(current_box: i64, result: SessionResult, today: NaiveDate, exam_date: Option<NaiveDate>) -> ScheduleUpdate {
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

    let base_interval = BOX_INTERVALS_DAYS[(box_level - 1) as usize];
    // A past (or today's) exam date is treated as unset rather than clamping
    // every future review back to "today" forever — otherwise a user who
    // forgets to clear an old exam date after sitting it would have spaced
    // repetition silently stop working.
    let future_exam = exam_date.filter(|&exam| exam > today);
    let days_to_exam = future_exam.map(|exam| (exam - today).num_days());

    let interval = match days_to_exam {
        Some(d) if d <= CRAM_WINDOW_DAYS => (base_interval / 2).max(1),
        _ => base_interval,
    };

    let mut next_review_date = today + chrono::Duration::days(interval);
    if let Some(exam) = future_exam {
        if next_review_date > exam {
            next_review_date = exam;
        }
    }

    ScheduleUpdate {
        box_level,
        outcome,
        next_review_date,
    }
}

/// Interval in days for flashcard boxes 0..=5 — tighter than the chapter
/// intervals since a card is one atomic fact, not a whole chapter. Box 0 is
/// "just failed / brand new from an error note".
pub const CARD_INTERVALS_DAYS: [i64; 6] = [1, 2, 4, 8, 15, 30];

/// Per-card Leitner update for the daily "révision éclair" deck. Same shape
/// and exam-awareness as the chapter-level `next_schedule` — one mental
/// model at two granularities: a correct answer climbs one box, a miss falls
/// all the way back to box 0, intervals halve inside the cram window, and a
/// card is never scheduled past the exam itself. Cards deliberately never
/// leave rotation ("mastered" just means a 30-day interval) — retention
/// decays, so the schedule shouldn't pretend it doesn't.
pub fn next_card_schedule(current_box: i64, correct: bool, today: NaiveDate, exam_date: Option<NaiveDate>) -> (i64, NaiveDate) {
    let box_level = if correct { current_box + 1 } else { 0 }.clamp(0, 5);

    let base_interval = CARD_INTERVALS_DAYS[box_level as usize];
    let future_exam = exam_date.filter(|&exam| exam > today);
    let days_to_exam = future_exam.map(|exam| (exam - today).num_days());

    let interval = match days_to_exam {
        Some(d) if d <= CRAM_WINDOW_DAYS => (base_interval / 2).max(1),
        _ => base_interval,
    };

    let mut next_review_date = today + chrono::Duration::days(interval);
    if let Some(exam) = future_exam {
        if next_review_date > exam {
            next_review_date = exam;
        }
    }

    (box_level, next_review_date)
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
        let upd = next_schedule(2, result, date(2026, 1, 1), None);
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
        let upd = next_schedule(1, result, date(2026, 1, 1), None);
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
        let upd = next_schedule(3, result, date(2026, 1, 1), None);
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
        let upd = next_schedule(3, result, date(2026, 1, 1), None);
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
        assert_eq!(next_schedule(5, strong, date(2026, 1, 1), None).box_level, 5);

        let weak = SessionResult {
            qcm_score: 0,
            qcm_total: 10,
            avg_confidence: 1.0,
            overconfidence_count: 0,
        };
        assert_eq!(next_schedule(1, weak, date(2026, 1, 1), None).box_level, 1);
    }

    #[test]
    fn zero_total_qcm_treated_as_weak_not_a_crash() {
        let result = SessionResult {
            qcm_score: 0,
            qcm_total: 0,
            avg_confidence: 2.0,
            overconfidence_count: 0,
        };
        let upd = next_schedule(2, result, date(2026, 1, 1), None);
        assert_eq!(upd.outcome, Outcome::Weak);
        assert_eq!(upd.box_level, 1);
    }

    #[test]
    fn far_from_exam_uses_normal_interval() {
        let result = SessionResult {
            qcm_score: 9,
            qcm_total: 10,
            avg_confidence: 2.5,
            overconfidence_count: 0,
        };
        // Exam is 60 days out — well outside the cram window, so this should
        // behave exactly like the no-exam-date case.
        let upd = next_schedule(2, result, date(2026, 1, 1), Some(date(2026, 3, 2)));
        assert_eq!(upd.next_review_date, date(2026, 1, 8)); // +7d for box 3, unchanged
    }

    #[test]
    fn inside_cram_window_halves_the_interval() {
        let result = SessionResult {
            qcm_score: 9,
            qcm_total: 10,
            avg_confidence: 2.5,
            overconfidence_count: 0,
        };
        // Exam is 10 days out (inside the 14-day cram window) — box 3's
        // normal 7-day interval should halve to 3.
        let upd = next_schedule(2, result, date(2026, 1, 1), Some(date(2026, 1, 11)));
        assert_eq!(upd.box_level, 3);
        assert_eq!(upd.next_review_date, date(2026, 1, 4));
    }

    #[test]
    fn never_schedules_past_the_exam_even_with_a_long_interval() {
        let result = SessionResult {
            qcm_score: 10,
            qcm_total: 10,
            avg_confidence: 3.0,
            overconfidence_count: 0,
        };
        // Box jumps 4 -> 5 (30-day interval, halved to 15 inside the cram
        // window), but the exam is only 10 days out — must clamp to the
        // exam date instead of landing 5 days past it.
        let upd = next_schedule(4, result, date(2026, 1, 1), Some(date(2026, 1, 11)));
        assert_eq!(upd.box_level, 5);
        assert_eq!(upd.next_review_date, date(2026, 1, 11));
    }

    #[test]
    fn exam_today_or_past_does_not_panic_or_go_negative() {
        let result = SessionResult {
            qcm_score: 3,
            qcm_total: 10,
            avg_confidence: 2.0,
            overconfidence_count: 0,
        };
        // Exam is today (or already passed) — cramming logic should just
        // step aside rather than clamp the date backwards.
        let upd = next_schedule(1, result, date(2026, 1, 1), Some(date(2026, 1, 1)));
        assert_eq!(upd.next_review_date, date(2026, 1, 2));
    }

    // ── per-card schedule ──

    #[test]
    fn card_climbs_one_box_on_correct_and_uses_that_box_interval() {
        let (box_level, next) = next_card_schedule(1, true, date(2026, 1, 1), None);
        assert_eq!(box_level, 2);
        assert_eq!(next, date(2026, 1, 5)); // +4d for box 2
    }

    #[test]
    fn card_falls_to_box_zero_on_a_miss_and_comes_back_tomorrow() {
        let (box_level, next) = next_card_schedule(4, false, date(2026, 1, 1), None);
        assert_eq!(box_level, 0);
        assert_eq!(next, date(2026, 1, 2));
    }

    #[test]
    fn card_box_caps_at_five_and_never_leaves_rotation() {
        let (box_level, next) = next_card_schedule(5, true, date(2026, 1, 1), None);
        assert_eq!(box_level, 5);
        assert_eq!(next, date(2026, 1, 31)); // +30d — long, but still scheduled
    }

    #[test]
    fn out_of_range_stored_box_is_clamped_not_a_panic() {
        // Pre-migration data capped boxes at 3, but nothing in SQLite stops a
        // stray value; the index into CARD_INTERVALS_DAYS must stay in bounds.
        let (box_level, _) = next_card_schedule(99, true, date(2026, 1, 1), None);
        assert_eq!(box_level, 5);
        let (box_level, _) = next_card_schedule(-7, false, date(2026, 1, 1), None);
        assert_eq!(box_level, 0);
    }

    #[test]
    fn card_interval_halves_inside_the_cram_window_and_clamps_to_the_exam() {
        // Box 4 → 5 would be 30d, halved to 15 inside the window, but the
        // exam is 10 days out — clamp to exam day.
        let (box_level, next) = next_card_schedule(4, true, date(2026, 1, 1), Some(date(2026, 1, 11)));
        assert_eq!(box_level, 5);
        assert_eq!(next, date(2026, 1, 11));

        // Box 1 → 2 is 4d, halved to 2 — fits before the exam untouched.
        let (_, next) = next_card_schedule(1, true, date(2026, 1, 1), Some(date(2026, 1, 11)));
        assert_eq!(next, date(2026, 1, 3));
    }
}
