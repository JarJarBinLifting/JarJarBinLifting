use rusqlite::Connection;

/// Ordered, forward-only migrations. Add new entries at the end — never edit
/// an already-shipped entry's SQL, since `_migrations` only records that a
/// version number ran, not a checksum of its contents.
const MIGRATIONS: &[(i64, &str, &str)] = &[
    (1, "init schema", include_str!("../../migrations/0001_init.sql")),
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

    let applied: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _migrations",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    for (version, description, sql) in MIGRATIONS {
        if *version <= applied {
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
}
