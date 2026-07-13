use crate::db::DbState;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use std::sync::Arc;

/// Cheaply cloneable handle to shared state, as axum's `State` extractor requires.
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<DbState>,
}

/// Every handler in this app returns `Result<_, AppError>` — errors from
/// `with_conn`/command logic are plain `String`s (as they were as Tauri
/// commands), so this just needs a `From<String>` impl to make `?` work,
/// plus `IntoResponse` to turn that into a JSON error body.
pub struct AppError(pub String);

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError(s)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (StatusCode::BAD_REQUEST, Json(json!({ "error": self.0 }))).into_response()
    }
}
