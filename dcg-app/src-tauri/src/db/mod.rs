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

/// Opens (creating if needed) the sqlite file at `path`, applies pragmas
/// appropriate for a file that lives inside a cloud-synced folder, and runs
/// pending migrations.
pub fn open(path: &Path) -> Result<Connection, DbError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    if path.exists() {
        backup_before_migration(path)?;
    }

    let conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", true)?;
    // Rollback-journal, NOT WAL: WAL leaves -wal/-shm sidecar files next to the
    // main db file, which a cloud-sync client (iCloud/Dropbox/OneDrive) may only
    // pick up post-checkpoint — risking an inconsistent copy on the other
    // machine after an unclean shutdown. Keeping everything in one file matches
    // the "portable single file in a synced folder" design.
    conn.pragma_update(None, "journal_mode", "DELETE")?;
    conn.pragma_update(None, "synchronous", "FULL")?;

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
    let conn = guard.as_ref().ok_or(DbError::NotOpen).map_err(|e| e.to_string())?;
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
