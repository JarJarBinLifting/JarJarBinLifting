use crate::db::{self, DbState};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

const SERVICE: &str = "com.amadou.dcgetude";
const KEYRING_USER: &str = "anthropic-api-key";

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
fn default_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("dcg.sqlite3"))
}

fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

fn read_local_config(app: &AppHandle) -> LocalConfig {
    let path = match config_file(app) {
        Ok(p) => p,
        Err(_) => return LocalConfig::default(),
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_local_config(app: &AppHandle, cfg: &LocalConfig) -> Result<(), String> {
    let path = config_file(app)?;
    let s = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(path, s).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_local_config(app: AppHandle) -> LocalConfig {
    read_local_config(&app)
}

/// Points the app at a database file (e.g. the user relocating it for their
/// own backup purposes — say, into a personal cloud-storage folder), opens
/// it, runs migrations, and remembers the path for next launch.
#[tauri::command]
pub fn set_db_path(app: AppHandle, db: State<DbState>, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let conn = db::open(&p).map_err(|e| e.to_string())?;
    *db.0.lock().map_err(|e| e.to_string())? = Some(conn);

    let mut cfg = read_local_config(&app);
    cfg.db_path = Some(path);
    write_local_config(&app, &cfg)
}

/// Called once at startup: if a db_path was already configured on a previous
/// run, reopen it. Returns false if no location has been configured yet
/// (first-ever run), in which case the caller should fall back to
/// `ensure_default_db` to auto-provision one with no user interaction needed.
#[tauri::command]
pub fn reopen_configured_db(app: AppHandle, db: State<DbState>) -> Result<bool, String> {
    let cfg = read_local_config(&app);
    match cfg.db_path {
        Some(path) => {
            let conn = db::open(std::path::Path::new(&path)).map_err(|e| e.to_string())?;
            *db.0.lock().map_err(|e| e.to_string())? = Some(conn);
            Ok(true)
        }
        None => Ok(false),
    }
}

/// First-ever run: silently creates the database at the default per-app data
/// location and remembers it, so there's no folder-picker step between
/// installing the app and using it. Safe to call again later (e.g. as a
/// recovery action if something went wrong) — it's a no-op once a path is
/// already configured.
#[tauri::command]
pub fn ensure_default_db(app: AppHandle, db: State<DbState>) -> Result<(), String> {
    if read_local_config(&app).db_path.is_some() {
        return Ok(());
    }
    let path = default_db_path(&app)?;
    set_db_path(app, db, path.to_string_lossy().into_owned())
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

/// Local (non-synced) fallback location for the API key when no OS keyring is
/// available. Deliberately never placed in the synced db folder — a plaintext
/// key living inside a cloud-synced folder is the one realistic way this
/// secret could leak.
fn plaintext_key_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(".anthropic_key"))
}

#[tauri::command]
pub fn save_api_key(app: AppHandle, key: String) -> Result<ApiKeyStatus, String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("La clé API ne peut pas être vide".into());
    }
    // Clear whichever storage might hold a stale previous key before writing
    // the new one, so we don't end up with two disagreeing copies.
    if let Ok(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
    if let Ok(path) = plaintext_key_file(&app) {
        let _ = std::fs::remove_file(path);
    }

    match keyring_entry().and_then(|e| e.set_password(&key).map_err(|e| e.to_string())) {
        Ok(()) => Ok(ApiKeyStatus {
            has_key: true,
            storage: "keychain".into(),
        }),
        Err(_) => {
            let path = plaintext_key_file(&app)?;
            std::fs::write(&path, &key).map_err(|e| e.to_string())?;
            Ok(ApiKeyStatus {
                has_key: true,
                storage: "plaintext_fallback".into(),
            })
        }
    }
}

/// Rust-side only — never exposed as a #[tauri::command], so the raw key
/// never crosses the IPC boundary into the webview. Used by commands::anthropic.
pub fn read_api_key(app: &AppHandle) -> Option<String> {
    if let Ok(entry) = keyring_entry() {
        if let Ok(pw) = entry.get_password() {
            return Some(pw);
        }
    }
    plaintext_key_file(app).ok().and_then(|p| std::fs::read_to_string(p).ok())
}

#[tauri::command]
pub fn get_api_key_status(app: AppHandle) -> ApiKeyStatus {
    if let Ok(entry) = keyring_entry() {
        if entry.get_password().is_ok() {
            return ApiKeyStatus {
                has_key: true,
                storage: "keychain".into(),
            };
        }
    }
    if let Ok(path) = plaintext_key_file(&app) {
        if path.exists() {
            return ApiKeyStatus {
                has_key: true,
                storage: "plaintext_fallback".into(),
            };
        }
    }
    ApiKeyStatus {
        has_key: false,
        storage: "none".into(),
    }
}

#[tauri::command]
pub fn clear_api_key(app: AppHandle) -> Result<(), String> {
    if let Ok(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
    if let Ok(path) = plaintext_key_file(&app) {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}

/// Manual on-demand export, distinct from the automatic pre-migration
/// `.bak`. Uses SQLite's online backup API (via the existing open connection)
/// rather than a raw file copy, so it's safe to run whenever — no risk of
/// grabbing a half-written file mid-transaction.
#[tauri::command]
pub fn export_database(db: State<DbState>, destination: String) -> Result<(), String> {
    let guard = db.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Aucune base de données ouverte")?;

    let mut dst = rusqlite::Connection::open(&destination).map_err(|e| e.to_string())?;
    let backup = rusqlite::backup::Backup::new(conn, &mut dst).map_err(|e| e.to_string())?;
    backup
        .run_to_completion(5, std::time::Duration::from_millis(100), None)
        .map_err(|e| e.to_string())
}
