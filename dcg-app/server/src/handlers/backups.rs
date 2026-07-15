use crate::appstate::{AppError, AppState};
use crate::db;
use crate::handlers::settings::{app_data_dir, read_local_config};
use axum::body::Bytes;
use axum::extract::State;
use axum::Json;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// How many automatic daily snapshots to keep. A week of history covers the
/// realistic "I broke something a few days ago and only just noticed" case
/// without letting the backups folder grow unbounded.
const KEEP_AUTO_BACKUPS: usize = 7;
/// Pre-restore safety snapshots are rarer and more precious (each one is the
/// state you were about to overwrite) — keep a few.
const KEEP_SAFETY_BACKUPS: usize = 3;

const AUTO_PREFIX: &str = "dcg-auto-";
const SAFETY_PREFIX: &str = "dcg-avant-restauration-";

pub(crate) fn backups_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Consistent-snapshot copy of the live database via SQLite's online backup
/// API — safe to run mid-write, unlike a raw file copy of a WAL database.
fn snapshot_live_db(state: &AppState, prefix: &str) -> Result<PathBuf, String> {
    let dir = backups_dir()?;
    let ts = chrono::Local::now().format("%Y-%m-%d-%H%M%S");
    let dest = dir.join(format!("{prefix}{ts}.sqlite3"));

    let guard = state.db.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or_else(|| "Aucune base de données ouverte".to_string())?;
    let mut dst = Connection::open(&dest).map_err(|e| e.to_string())?;
    let backup = rusqlite::backup::Backup::new(conn, &mut dst).map_err(|e| e.to_string())?;
    backup
        .run_to_completion(5, std::time::Duration::from_millis(100), None)
        .map_err(|e| e.to_string())?;
    Ok(dest)
}

fn list_backup_files(prefix: &str) -> Result<Vec<PathBuf>, String> {
    let dir = backups_dir()?;
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with(prefix) && n.ends_with(".sqlite3"))
                .unwrap_or(false)
        })
        .collect();
    // Timestamped names sort chronologically; newest last.
    files.sort();
    Ok(files)
}

fn prune(prefix: &str, keep: usize) -> Result<(), String> {
    let files = list_backup_files(prefix)?;
    if files.len() > keep {
        for old in &files[..files.len() - keep] {
            let _ = std::fs::remove_file(old);
        }
    }
    Ok(())
}

/// Called once at startup, right after the database opens: takes at most one
/// automatic snapshot per calendar day (the app is opened daily; a snapshot
/// per launch would be noise) and prunes old ones. Failures are logged, never
/// fatal — a backup problem must not block studying.
pub fn run_auto_backup_if_due(state: &AppState) {
    let today_tag = format!("{AUTO_PREFIX}{}", chrono::Local::now().format("%Y-%m-%d"));
    match list_backup_files(AUTO_PREFIX) {
        Ok(files) => {
            let already_today = files.iter().any(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with(&today_tag))
                    .unwrap_or(false)
            });
            if already_today {
                return;
            }
        }
        Err(e) => {
            tracing::warn!("could not inspect backups dir: {e}");
            return;
        }
    }
    match snapshot_live_db(state, AUTO_PREFIX) {
        Ok(path) => {
            tracing::info!("automatic backup written to {}", path.display());
            if let Err(e) = prune(AUTO_PREFIX, KEEP_AUTO_BACKUPS) {
                tracing::warn!("backup pruning failed: {e}");
            }
        }
        Err(e) => tracing::warn!("automatic backup failed: {e}"),
    }
}

#[derive(Debug, Serialize)]
pub struct BackupInfo {
    pub file_name: String,
    pub size_bytes: u64,
    /// Local-time label parsed from the file name, e.g. "2026-07-15 09:30".
    pub created_label: String,
    pub is_safety: bool,
}

fn describe(path: &Path) -> Option<BackupInfo> {
    let file_name = path.file_name()?.to_str()?.to_string();
    let size_bytes = std::fs::metadata(path).ok()?.len();
    let is_safety = file_name.starts_with(SAFETY_PREFIX);
    let stem = file_name
        .trim_end_matches(".sqlite3")
        .trim_start_matches(AUTO_PREFIX)
        .trim_start_matches(SAFETY_PREFIX);
    // "YYYY-MM-DD-HHMMSS" → "YYYY-MM-DD HH:MM"
    let created_label = if stem.len() >= 17 {
        format!("{} {}:{}", &stem[..10], &stem[11..13], &stem[13..15])
    } else {
        stem.to_string()
    };
    Some(BackupInfo { file_name, size_bytes, created_label, is_safety })
}

pub async fn list_backups() -> Result<Json<Vec<BackupInfo>>, AppError> {
    let mut all: Vec<PathBuf> = list_backup_files(AUTO_PREFIX).map_err(AppError)?;
    all.extend(list_backup_files(SAFETY_PREFIX).map_err(AppError)?);
    all.sort();
    all.reverse(); // newest first for display
    Ok(Json(all.iter().filter_map(|p| describe(p)).collect()))
}

pub async fn backup_now(State(state): State<AppState>) -> Result<Json<Vec<BackupInfo>>, AppError> {
    snapshot_live_db(&state, AUTO_PREFIX).map_err(AppError)?;
    prune(AUTO_PREFIX, KEEP_AUTO_BACKUPS).map_err(AppError)?;
    list_backups().await
}

/// A candidate database must actually be a healthy DCG database before we
/// let it replace the live one: openable, passing integrity_check, carrying
/// a _migrations table whose version this build knows how to run (an older
/// version is fine — migrations run on open — but a *newer* one means the
/// file came from a newer app and this build would misread it).
fn validate_candidate(path: &Path) -> Result<(), String> {
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "Ce fichier n'est pas une base de données SQLite lisible".to_string())?;
    let ok: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|_| "Ce fichier n'est pas une base de données SQLite valide".to_string())?;
    if ok != "ok" {
        return Err("La base de données est endommagée (integrity_check a échoué)".to_string());
    }
    let version: i64 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM _migrations", [], |r| r.get(0))
        .map_err(|_| "Ce fichier ne ressemble pas à une sauvegarde DCG Étude (table _migrations absente)".to_string())?;
    if version > crate::db::migrate::LATEST_VERSION {
        return Err(format!(
            "Cette sauvegarde vient d'une version plus récente de l'application (migration {version} > {}) — mets d'abord l'application à jour.",
            crate::db::migrate::LATEST_VERSION
        ));
    }
    Ok(())
}

/// The swap itself: safety-snapshot the live DB, close it, copy the candidate
/// over the configured path (clearing stale WAL sidecars), reopen (running
/// any pending migrations). If reopening the restored file fails, the
/// original file is put back so a bad restore can't leave the app dead.
fn restore_from_file(state: &AppState, candidate: &Path) -> Result<(), String> {
    validate_candidate(candidate)?;

    let db_path = read_local_config()
        .db_path
        .ok_or_else(|| "Aucune base de données configurée".to_string())?;
    let db_path = PathBuf::from(db_path);

    let safety = snapshot_live_db(state, SAFETY_PREFIX)?;
    prune(SAFETY_PREFIX, KEEP_SAFETY_BACKUPS)?;

    {
        let mut guard = state.db.0.lock().map_err(|e| e.to_string())?;
        *guard = None; // close the live connection before touching the file

        // SQLite names sidecars by appending to the full file name
        // ("dcg.sqlite3-wal"), not by swapping the extension.
        let wal = PathBuf::from(format!("{}-wal", db_path.display()));
        let shm = PathBuf::from(format!("{}-shm", db_path.display()));
        let swap = std::fs::copy(candidate, &db_path).map_err(|e| e.to_string()).map(|_| {
            // Stale WAL sidecars belong to the old database — with them gone,
            // the restored file opens clean.
            let _ = std::fs::remove_file(&wal);
            let _ = std::fs::remove_file(&shm);
        });

        let reopened = swap.and_then(|_| db::open(&db_path).map_err(|e| e.to_string()));
        match reopened {
            Ok(conn) => {
                *guard = Some(conn);
                Ok(())
            }
            Err(e) => {
                // Roll back: put the safety snapshot back and reopen it.
                let _ = std::fs::copy(&safety, &db_path);
                let _ = std::fs::remove_file(&wal);
                let _ = std::fs::remove_file(&shm);
                match db::open(&db_path) {
                    Ok(conn) => {
                        *guard = Some(conn);
                        Err(format!("Restauration annulée ({e}) — ta base actuelle est intacte."))
                    }
                    Err(e2) => Err(format!(
                        "Restauration échouée ({e}) et la réouverture a aussi échoué ({e2}) — une copie de secours est dans {}",
                        safety.display()
                    )),
                }
            }
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct RestoreRequest {
    pub file_name: String,
}

pub async fn restore_backup(State(state): State<AppState>, Json(body): Json<RestoreRequest>) -> Result<(), AppError> {
    // The name must be one of ours — no path components, no traversal.
    let name = body.file_name;
    if name.contains('/') || name.contains('\\') || !(name.starts_with(AUTO_PREFIX) || name.starts_with(SAFETY_PREFIX)) || !name.ends_with(".sqlite3") {
        return Err(AppError("Nom de sauvegarde invalide".into()));
    }
    let path = backups_dir().map_err(AppError)?.join(&name);
    if !path.exists() {
        return Err(AppError("Cette sauvegarde n'existe plus".into()));
    }
    restore_from_file(&state, &path).map_err(AppError)
}

/// Restore from an uploaded file (e.g. a manual export saved in Downloads).
/// The raw body is the SQLite file itself — written to a temp path first so
/// validation runs on a real file before anything is touched.
pub async fn restore_upload(State(state): State<AppState>, body: Bytes) -> Result<(), AppError> {
    if body.is_empty() {
        return Err(AppError("Fichier vide".into()));
    }
    let tmp = std::env::temp_dir().join(format!("dcg-restore-upload-{}.sqlite3", std::process::id()));
    std::fs::write(&tmp, &body).map_err(|e| e.to_string()).map_err(AppError)?;
    let result = restore_from_file(&state, &tmp).map_err(AppError);
    let _ = std::fs::remove_file(&tmp);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_sqlite(dir: &Path, name: &str, healthy: bool) -> PathBuf {
        let path = dir.join(name);
        if healthy {
            let conn = Connection::open(&path).unwrap();
            crate::db::migrate::run(&conn).unwrap();
        } else {
            std::fs::write(&path, b"pas une base sqlite du tout").unwrap();
        }
        path
    }

    #[test]
    fn validate_accepts_a_real_dcg_database_and_rejects_garbage() {
        let dir = std::env::temp_dir().join(format!("dcg-backup-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let good = temp_sqlite(&dir, "good.sqlite3", true);
        assert!(validate_candidate(&good).is_ok());

        let garbage = temp_sqlite(&dir, "garbage.sqlite3", false);
        assert!(validate_candidate(&garbage).is_err());

        // A plain SQLite file that isn't a DCG database (no _migrations).
        let foreign = dir.join("foreign.sqlite3");
        Connection::open(&foreign).unwrap().execute_batch("CREATE TABLE t(x)").unwrap();
        let err = validate_candidate(&foreign).unwrap_err();
        assert!(err.contains("_migrations"), "unexpected: {err}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn validate_rejects_a_database_from_a_newer_app_version() {
        let dir = std::env::temp_dir().join(format!("dcg-backup-newer-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = temp_sqlite(&dir, "futur.sqlite3", true);
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute("INSERT INTO _migrations (version, description) VALUES (9999, 'du futur')", []).unwrap();
        }
        let err = validate_candidate(&path).unwrap_err();
        assert!(err.contains("plus récente"), "unexpected: {err}");
        std::fs::remove_dir_all(&dir).ok();
    }
}
