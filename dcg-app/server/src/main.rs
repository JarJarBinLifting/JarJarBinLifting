mod appstate;
mod db;
mod handlers;
mod models;

use appstate::AppState;
use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post, put};
use axum::Router;
use db::DbState;
use rust_embed::RustEmbed;
use std::net::SocketAddr;
use std::sync::Arc;

/// The built frontend (`npm run build` output) is embedded directly into this
/// binary, so the shipped artifact is a single self-contained executable —
/// nothing else needs to sit alongside it on disk.
#[derive(RustEmbed)]
#[folder = "$CARGO_MANIFEST_DIR/../dist/"]
struct Assets;

async fn static_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    if let Some(file) = Assets::get(path) {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        return ([(header::CONTENT_TYPE, mime.as_ref())], file.data).into_response();
    }

    // Client-side routed SPA: any unknown path falls back to index.html
    // rather than a 404, except for API routes (never reached here — they're
    // matched by the router before this fallback).
    match Assets::get("index.html") {
        Some(file) => ([(header::CONTENT_TYPE, "text/html")], file.data).into_response(),
        None => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

fn api_router() -> Router<AppState> {
    Router::new()
        // settings
        .route("/settings/local-config", get(handlers::settings::get_local_config))
        .route("/settings/db-path", post(handlers::settings::set_db_path))
        .route("/settings/ensure-default-db", post(handlers::settings::ensure_default_db_route))
        .route("/settings/api-key", post(handlers::settings::save_api_key).delete(handlers::settings::clear_api_key))
        .route("/settings/api-key/status", get(handlers::settings::get_api_key_status))
        .route("/settings/export", get(handlers::settings::export_database))
        // anthropic
        .route("/anthropic/call", post(handlers::anthropic::call_anthropic))
        .route("/anthropic/test", post(handlers::anthropic::test_anthropic_connection))
        // planner
        .route("/planner/seed", post(handlers::planner::seed_default_curriculum_route))
        .route("/planner/ues", get(handlers::planner::list_ues))
        .route("/planner/ues/:ue_id/notes", patch(handlers::planner::update_ue_notes))
        .route("/planner/ues/:ue_id/chapters", get(handlers::planner::list_chapters))
        .route("/planner/chapters", get(handlers::planner::list_all_chapters))
        .route("/planner/chapters/:chapter_id/cycle-status", post(handlers::planner::cycle_chapter_status))
        .route("/planner/chapters/:chapter_id/qcm-scores", get(handlers::planner::list_qcm_scores))
        .route("/planner/qcm-scores", get(handlers::planner::list_all_qcm_scores).post(handlers::planner::add_qcm_score))
        .route("/planner/qcm-scores/:id", delete(handlers::planner::delete_qcm_score))
        .route("/planner/sessions", get(handlers::planner::list_timer_sessions).post(handlers::planner::add_timer_session))
        .route("/planner/sessions/:id", delete(handlers::planner::delete_timer_session))
        // exam pilotage
        .route("/planner/errors", get(handlers::planner::list_error_notes).post(handlers::planner::create_error_note))
        .route("/planner/errors/:id", delete(handlers::planner::delete_error_note))
        .route("/planner/errors/:id/advance", post(handlers::planner::advance_error_note))
        .route("/planner/skills", get(handlers::planner::list_skill_profiles).post(handlers::planner::record_skill_assessment))
        .route("/planner/exam-scenario", get(handlers::planner::list_exam_scenario))
        .route("/planner/exam-scenario/:ue_id", put(handlers::planner::set_exam_scenario))
        .route("/planner/meta/:key", get(handlers::planner::get_meta).put(handlers::planner::set_meta))
        // tutor
        .route("/tutor/sessions/start", post(handlers::tutor::start_or_resume_tutor_session))
        .route("/tutor/chapters/:chapter_id/latest-completed", get(handlers::tutor::get_latest_completed_session))
        .route("/tutor/chapters/:chapter_id/in-progress", get(handlers::tutor::get_in_progress_session))
        .route("/tutor/sessions/:id", patch(handlers::tutor::save_tutor_session_progress))
        .route("/tutor/sessions/:id/abandon", post(handlers::tutor::abandon_tutor_session))
        .route("/tutor/chapters/:chapter_id/flashcards", get(handlers::tutor::list_flashcards).post(handlers::tutor::save_flashcards))
        .route("/tutor/flashcards/:id/progress", post(handlers::tutor::update_flashcard_progress))
        .route("/tutor/sessions/:id/complete", post(handlers::tutor::complete_tutor_session))
        .route("/tutor/due-chapters", get(handlers::tutor::list_due_chapters))
        .route("/tutor/weak-chapters", get(handlers::tutor::list_weak_chapters))
        .route("/tutor/usage", get(handlers::tutor::get_usage_summary))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    // Generous but bounded: a full story generation can legitimately run for
    // over a minute at high max_tokens, but an unbounded client means a
    // stalled connection hangs the tutor forever with no way to recover
    // short of restarting the app.
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .expect("failed to build HTTP client");
    let state = AppState { db: Arc::new(DbState::default()), http };

    let opened = match handlers::settings::reopen_configured_db(&state) {
        Ok(true) => true,
        Ok(false) => match handlers::settings::ensure_default_db(&state) {
            Ok(()) => true,
            Err(e) => {
                tracing::error!("failed to auto-provision default database: {e}");
                false
            }
        },
        Err(e) => {
            tracing::error!("failed to reopen configured database: {e}");
            false
        }
    };

    if opened {
        if let Err(e) = handlers::planner::seed_default_curriculum(&state) {
            tracing::error!("failed to seed default curriculum: {e}");
        }
    }

    let app = Router::new()
        .nest("/api", api_router())
        .fallback(static_handler)
        .with_state(state);

    let port: u16 = std::env::var("DCG_PORT").ok().and_then(|s| s.parse().ok()).unwrap_or(4287);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await.expect("failed to bind local port");

    let url = format!("http://127.0.0.1:{port}");
    tracing::info!("DCG Étude listening on {url}");
    if open::that(&url).is_err() {
        tracing::warn!("could not auto-open the browser — open {url} manually");
    }

    axum::serve(listener, app).await.expect("server error");
}
