use crate::appstate::{AppError, AppState};
use crate::db;
use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const SERVICE: &str = "com.amadou.dcgetude";
const KEYRING_USER: &str = "anthropic-api-key";
const APP_ID: &str = "com.amadou.dcgetude";

fn app_config_dir() -> Result<PathBuf, String> {
    let base =
        dirs::config_dir().ok_or("Impossible de localiser le dossier de configuration de l'OS")?;
    Ok(base.join(APP_ID))
}

pub(crate) fn app_data_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("Impossible de localiser le dossier de données de l'OS")?;
    Ok(base.join(APP_ID))
}

/// Local settings — just a pointer to where the database file lives. Never
/// put anything sensitive in here: this file sits in the OS app-config dir,
/// but the db_path value itself is harmless (a path, not a secret).
#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct LocalConfig {
    pub db_path: Option<String>,
}

/// Where the database lives if the user never chooses a custom location —
/// the OS's standard per-app data directory. Single-machine app, so there's
/// no need to make the user pick a folder on first run.
fn default_db_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("dcg.sqlite3"))
}

fn config_file() -> Result<PathBuf, String> {
    let dir = app_config_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

pub(crate) fn read_local_config() -> LocalConfig {
    let path = match config_file() {
        Ok(p) => p,
        Err(_) => return LocalConfig::default(),
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_local_config(cfg: &LocalConfig) -> Result<(), String> {
    let path = config_file()?;
    let s = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(path, s).map_err(|e| e.to_string())
}

/// What the frontend actually needs to know at startup: not just "is a path
/// recorded" (`db_path`) but "is the connection actually open right now"
/// (`db_open`) — those can disagree if the configured file went missing or
/// got corrupted between runs, which is exactly the case the recovery screen
/// exists for. Checking only `db_path` would show the normal UI over a dead
/// DB, with every action failing "aucune base de données n'est ouverte" and
/// no recovery screen ever appearing.
#[derive(Debug, Serialize)]
pub struct LocalConfigStatus {
    pub db_path: Option<String>,
    pub db_open: bool,
}

pub async fn get_local_config(State(state): State<AppState>) -> Json<LocalConfigStatus> {
    let cfg = read_local_config();
    let db_open = state.db.0.lock().map(|g| g.is_some()).unwrap_or(false);
    Json(LocalConfigStatus {
        db_path: cfg.db_path,
        db_open,
    })
}

#[derive(Debug, Deserialize)]
pub struct SetDbPathRequest {
    pub path: String,
}

/// Points the app at a database file (e.g. the user relocating it for their
/// own backup purposes — say, into a personal cloud-storage folder), opens
/// it, runs migrations, and remembers the path for next launch.
pub async fn set_db_path(
    State(state): State<AppState>,
    Json(body): Json<SetDbPathRequest>,
) -> Result<(), AppError> {
    set_db_path_inner(&state, body.path).map_err(AppError)
}

fn set_db_path_inner(state: &AppState, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let conn = db::open(&p).map_err(|e| e.to_string())?;
    *state.db.0.lock().map_err(|e| e.to_string())? = Some(conn);

    let mut cfg = read_local_config();
    cfg.db_path = Some(path);
    write_local_config(&cfg)
}

/// Called once at startup: if a db_path was already configured on a previous
/// run, reopen it. Returns false if no location has been configured yet
/// (first-ever run), in which case the caller should fall back to
/// `ensure_default_db` to auto-provision one with no user interaction needed.
pub fn reopen_configured_db(state: &AppState) -> Result<bool, String> {
    let cfg = read_local_config();
    match cfg.db_path {
        Some(path) => {
            let conn = db::open(std::path::Path::new(&path)).map_err(|e| e.to_string())?;
            *state.db.0.lock().map_err(|e| e.to_string())? = Some(conn);
            Ok(true)
        }
        None => Ok(false),
    }
}

/// First-ever run: silently creates the database at the default per-app data
/// location and remembers it, so there's no folder-picker step between
/// installing the app and using it.
///
/// Also the recovery action behind the Settings "Réessayer" button: if a
/// path was already configured — e.g. the file went missing or the
/// connection failed on a previous attempt — this retries opening that same
/// path rather than silently switching to a fresh, empty default DB, so a
/// retry can't look like it worked while quietly abandoning the user's
/// actual data.
pub fn ensure_default_db(state: &AppState) -> Result<(), String> {
    if read_local_config().db_path.is_some() {
        return reopen_configured_db(state).map(|_| ());
    }
    let path = default_db_path()?;
    set_db_path_inner(state, path.to_string_lossy().into_owned())
}

pub async fn ensure_default_db_route(State(state): State<AppState>) -> Result<(), AppError> {
    ensure_default_db(&state).map_err(AppError)
}

#[derive(Debug, Serialize)]
pub struct ApiKeyStatus {
    pub has_key: bool,
    /// "keychain" | "plaintext_fallback" | "none" — surfaced in Settings so
    /// the user knows if their OS keyring wasn't available.
    pub storage: String,
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

/// Local fallback location for the API key when no OS keyring is available.
fn plaintext_key_file() -> Result<PathBuf, String> {
    let dir = app_config_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(".anthropic_key"))
}

#[derive(Debug, Deserialize)]
pub struct SaveApiKeyRequest {
    pub key: String,
}

pub async fn save_api_key(
    Json(body): Json<SaveApiKeyRequest>,
) -> Result<Json<ApiKeyStatus>, AppError> {
    let key = body.key.trim().to_string();
    if key.is_empty() {
        return Err(AppError("La clé API ne peut pas être vide".into()));
    }
    // Clear whichever storage might hold a stale previous key before writing
    // the new one, so we don't end up with two disagreeing copies.
    if let Ok(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
    if let Ok(path) = plaintext_key_file() {
        let _ = std::fs::remove_file(path);
    }

    match keyring_entry().and_then(|e| e.set_password(&key).map_err(|e| e.to_string())) {
        Ok(()) => Ok(Json(ApiKeyStatus {
            has_key: true,
            storage: "keychain".into(),
        })),
        Err(_) => {
            let path = plaintext_key_file().map_err(AppError)?;
            std::fs::write(&path, &key)
                .map_err(|e| e.to_string())
                .map_err(AppError)?;
            Ok(Json(ApiKeyStatus {
                has_key: true,
                storage: "plaintext_fallback".into(),
            }))
        }
    }
}

/// Rust-side only — never exposed as a route, so the raw key never crosses
/// into an HTTP response. Used by handlers::anthropic.
pub fn read_api_key() -> Option<String> {
    if let Ok(entry) = keyring_entry() {
        if let Ok(pw) = entry.get_password() {
            return Some(pw);
        }
    }
    plaintext_key_file()
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
}

pub async fn get_api_key_status() -> Json<ApiKeyStatus> {
    if let Ok(entry) = keyring_entry() {
        if entry.get_password().is_ok() {
            return Json(ApiKeyStatus {
                has_key: true,
                storage: "keychain".into(),
            });
        }
    }
    if let Ok(path) = plaintext_key_file() {
        if path.exists() {
            return Json(ApiKeyStatus {
                has_key: true,
                storage: "plaintext_fallback".into(),
            });
        }
    }
    Json(ApiKeyStatus {
        has_key: false,
        storage: "none".into(),
    })
}

pub async fn clear_api_key() -> Result<(), AppError> {
    if let Ok(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
    if let Ok(path) = plaintext_key_file() {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}

/// Manual on-demand export, distinct from the automatic pre-migration
/// `.bak`. Uses SQLite's online backup API (via the existing open connection)
/// rather than a raw file copy, so it's safe to run whenever — no risk of
/// grabbing a half-written file mid-transaction. Backs up to a temp file
/// then streams it back as a download, since a browser can't be handed an
/// arbitrary destination path the way a native save-dialog could.
pub async fn export_database(State(state): State<AppState>) -> Result<Response, AppError> {
    let tmp_path = std::env::temp_dir().join(format!(
        "dcg-export-{}.sqlite3",
        chrono::Local::now().format("%Y%m%dT%H%M%S%.f")
    ));
    {
        let guard = state.db.0.lock().map_err(|e| e.to_string())?;
        let conn = guard
            .as_ref()
            .ok_or_else(|| "Aucune base de données ouverte".to_string())?;
        let mut dst = rusqlite::Connection::open(&tmp_path).map_err(|e| e.to_string())?;
        let backup = rusqlite::backup::Backup::new(conn, &mut dst).map_err(|e| e.to_string())?;
        backup
            .run_to_completion(5, std::time::Duration::from_millis(100), None)
            .map_err(|e| e.to_string())?;
    }

    let bytes = std::fs::read(&tmp_path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&tmp_path);

    let filename = format!(
        "dcg-sauvegarde-{}.sqlite3",
        chrono::Local::now().format("%Y-%m-%d")
    );
    Ok((
        [
            (
                axum::http::header::CONTENT_TYPE,
                "application/x-sqlite3".to_string(),
            ),
            (
                axum::http::header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\""),
            ),
        ],
        bytes,
    )
        .into_response())
}
