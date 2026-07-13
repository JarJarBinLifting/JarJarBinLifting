use crate::db::{self, DbState};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

const SERVICE: &str = "com.amadou.dcgetude";
const KEYRING_USER: &str = "anthropic-api-key";

/// Local, non-synced settings — just a pointer to where the (synced) database
/// file lives. Never put anything sensitive in here: this file sits in the OS
/// app-config dir, not inside the user's cloud-synced folder, but the db_path
/// value itself is harmless (a path, not a secret).
#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct LocalConfig {
    pub db_path: Option<String>,
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

/// Points the app at a database file (new or existing — same call handles
/// both "create my study db in this synced folder" on machine 1 and "open
/// the existing one" on machine 2), opens it, runs migrations, and remembers
/// the path for next launch.
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
/// run, reopen it so the user isn't sent back through the folder picker every
/// launch. Returns false if no location has been configured yet (first run).
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
