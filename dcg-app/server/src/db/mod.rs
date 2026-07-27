pub mod migrate;

use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

/// Holds the single open connection for whichever database file the user has
/// pointed the app at (see commands::settings). `None` until a location is
/// configured on first run.
pub struct DbState(pub Mutex<Option<Connection>>);

impl Default for DbState {
    fn default() -> Self {
        DbState(Mutex::new(None))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("aucune base de données n'est ouverte — configure un emplacement dans les Réglages")]
    NotOpen,
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for DbError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// Opens (creating if needed) the sqlite file at `path`, applies pragmas for
/// a single-machine local file, and runs pending migrations.
pub fn open(path: &Path) -> Result<Connection, DbError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    if path.exists() {
        backup_before_migration(path)?;
    }

    let conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", true)?;
    // WAL: this file lives on local disk only (no cloud-sync client watching
    // it), so there's no reason to avoid WAL's -wal/-shm sidecar files —
    // and WAL gives meaningfully better write performance/concurrency than
    // the rollback journal for a single-machine app.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;

    migrate::run(&conn)?;

    Ok(conn)
}

/// Runs `f` against the currently open connection, or a friendly error if the
/// user hasn't configured a database location yet. Shared by every command
/// module that touches the db.
pub fn with_conn<T>(
    state: &DbState,
    f: impl FnOnce(&Connection) -> rusqlite::Result<T>,
) -> Result<T, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard
        .as_ref()
        .ok_or(DbError::NotOpen)
        .map_err(|e| e.to_string())?;
    f(conn).map_err(|e| e.to_string())
}

/// Best-effort snapshot of the db file before a migration runs against it, so
/// a bad migration on an existing file is recoverable. Only triggers when a
/// migration is actually pending, to avoid a `.bak` file on every launch.
fn backup_before_migration(path: &Path) -> Result<(), DbError> {
    let applied = {
        let conn = Connection::open(path)?;
        conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _migrations",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
    };

    if applied < migrate::LATEST_VERSION {
        let ts = chrono::Local::now().format("%Y%m%dT%H%M%S");
        let backup_path = path.with_extension(format!("sqlite3.bak-{ts}"));
        std::fs::copy(path, backup_path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A garbage (non-sqlite) file at the configured path must surface as an
    /// `Err` from `open` — not panic and not silently produce a connection
    /// that then fails on every later query.
    #[test]
    fn opening_a_corrupt_file_returns_an_error_not_a_panic() {
        let dir = std::env::temp_dir().join(format!("dcg-test-corrupt-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("corrupt.sqlite3");
        std::fs::write(&path, b"not a real sqlite database, just garbage bytes").unwrap();

        let result = open(&path);
        assert!(result.is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    /// A missing parent directory should be created rather than failing —
    /// this is what makes first-run auto-provisioning work without asking
    /// the user to pick/create a folder first.
    #[test]
    fn opening_a_path_with_a_missing_parent_dir_creates_it() {
        let dir = std::env::temp_dir().join(format!("dcg-test-newdir-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        let path = dir.join("nested").join("dcg.sqlite3");

        let conn = open(&path).unwrap();
        drop(conn);
        assert!(path.exists());

        std::fs::remove_dir_all(&dir).ok();
    }
}
