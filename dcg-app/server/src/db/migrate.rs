use rusqlite::Connection;

/// Ordered, forward-only migrations. Add new entries at the end — never edit
/// an already-shipped entry's SQL, since `_migrations` only records that a
/// version number ran, not a checksum of its contents.
const MIGRATIONS: &[(i64, &str, &str)] = &[
    (
        1,
        "init schema",
        include_str!("../../migrations/0001_init.sql"),
    ),
    (
        2,
        "tutor session difficulty",
        include_str!("../../migrations/0002_tutor_session_difficulty.sql"),
    ),
    (
        3,
        "usage tracking",
        include_str!("../../migrations/0003_usage_tracking.sql"),
    ),
    (
        4,
        "revision mode",
        include_str!("../../migrations/0004_revision_mode.sql"),
    ),
    (
        5,
        "ledger colors",
        include_str!("../../migrations/0005_ledger_colors.sql"),
    ),
    (
        6,
        "exam pilotage",
        include_str!("../../migrations/0006_exam_pilotage.sql"),
    ),
    (
        7,
        "flashcard review schedule",
        include_str!("../../migrations/0007_flashcard_review.sql"),
    ),
    (
        8,
        "quiz bank and annales",
        include_str!("../../migrations/0008_quiz_and_annales.sql"),
    ),
    (
        9,
        "offline lesson sessions",
        include_str!("../../migrations/0009_offline_lesson.sql"),
    ),
    (
        10,
        "lesson library and versioning",
        include_str!("../../migrations/0010_lesson_library.sql"),
    ),
    (
        11,
        "flashcard SM-2 scheduling",
        include_str!("../../migrations/0011_flashcard_sm2.sql"),
    ),
    (
        12,
        "quiz option feedback",
        include_str!("../../migrations/0012_quiz_option_feedback.sql"),
    ),
    (
        13,
        "quiz SM-2 scheduling",
        include_str!("../../migrations/0013_quiz_sm2.sql"),
    ),
    (
        14,
        "source references",
        include_str!("../../migrations/0014_source_references.sql"),
    ),
    (
        15,
        "chapter started backfill",
        include_str!("../../migrations/0015_chapter_started.sql"),
    ),
];

pub const LATEST_VERSION: i64 = MIGRATIONS[MIGRATIONS.len() - 1].0;

pub fn run(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            version     INTEGER PRIMARY KEY,
            description TEXT NOT NULL,
            applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;

    apply_pending(conn, MIGRATIONS)
}

fn apply_pending(conn: &Connection, migrations: &[(i64, &str, &str)]) -> rusqlite::Result<()> {
    for (version, description, sql) in migrations {
        // A database can legitimately have a gap when an earlier app build
        // shipped a newer migration before a local feature branch was merged.
        // Check each migration individually so that those omitted, forward-only
        // schema changes are applied safely on the next launch.
        let already_applied: i64 = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM _migrations WHERE version = ?1)",
            [version],
            |r| r.get(0),
        )?;
        if already_applied != 0 {
            continue;
        }
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT INTO _migrations (version, description) VALUES (?1, ?2)",
            (version, description),
        )?;
        tx.commit()?;
        tracing::info!("applied migration {version}: {description}");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_all_migrations_and_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        run(&conn).unwrap(); // second call must be a no-op, not an error

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, MIGRATIONS.len() as i64);

        // spot-check a table from the migration actually exists
        let table_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='chapters'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(table_exists, 1);
    }

    #[test]
    fn chapter_backfill_promotes_only_untouched_todo_chapters_with_real_work() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        conn.execute(
            "INSERT INTO ues (code, name) VALUES ('UE3', 'Droit social')",
            [],
        )
        .unwrap();
        // 1: studied (has a flashcard) · 2: never opened · 3: studied but the
        // student already marked it finished by hand
        conn.execute_batch(
            "INSERT INTO chapters (ue_id, name, status) VALUES
                (1, 'Ch.1', 'todo'), (1, 'Ch.2', 'todo'), (1, 'Ch.3', 'done');
             INSERT INTO flashcards (chapter_id, question, answer) VALUES
                (1, 'q', 'a'), (3, 'q', 'a');",
        )
        .unwrap();

        conn.execute_batch(include_str!("../../migrations/0015_chapter_started.sql"))
            .unwrap();

        let status = |id: i64| -> String {
            conn.query_row("SELECT status FROM chapters WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .unwrap()
        };
        assert_eq!(status(1), "ongoing", "work done -> no longer 'todo'");
        assert_eq!(status(2), "todo", "an untouched chapter stays untouched");
        assert_eq!(status(3), "done", "a manual 'done' is never demoted");

        let events: i64 = conn
            .query_row("SELECT COUNT(*) FROM chapter_status_events", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(events, 1, "only the real promotion is logged");
    }

    #[test]
    fn fills_an_older_missing_migration_after_newer_ones() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE _migrations (
                version INTEGER PRIMARY KEY,
                description TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )
        .unwrap();

        const GAPPED_MIGRATIONS: &[(i64, &str, &str)] = &[
            (
                1,
                "base",
                "CREATE TABLE migration_base (id INTEGER PRIMARY KEY);",
            ),
            (
                2,
                "missing",
                "CREATE TABLE migration_recovered (id INTEGER PRIMARY KEY);",
            ),
            (
                3,
                "newer",
                "CREATE TABLE migration_newer (id INTEGER PRIMARY KEY);",
            ),
        ];

        // Simulate an earlier build that applied versions 1 and 3 but did not
        // contain version 2. Pending versions must be found individually, not
        // inferred from MAX(version).
        for (version, description, sql) in GAPPED_MIGRATIONS {
            if *version == 2 {
                continue;
            }
            conn.execute_batch(sql).unwrap();
            conn.execute(
                "INSERT INTO _migrations (version, description) VALUES (?1, ?2)",
                (version, description),
            )
            .unwrap();
        }

        apply_pending(&conn, GAPPED_MIGRATIONS).unwrap();

        let missing_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM _migrations WHERE version = 2",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(missing_count, 1);

        let recovered_table_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'migration_recovered'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(recovered_table_exists, 1);
    }
}
