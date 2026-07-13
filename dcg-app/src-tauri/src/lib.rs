mod commands;
mod db;
mod models;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(db::DbState::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let handle = app.handle().clone();
            let opened = match commands::settings::reopen_configured_db(handle.clone(), app.state::<db::DbState>()) {
                Ok(true) => true,
                Ok(false) => {
                    // First-ever run: auto-provision at the default location
                    // instead of making the user pick a folder — this is a
                    // single-machine app, there's nothing to configure.
                    match commands::settings::ensure_default_db(handle, app.state::<db::DbState>()) {
                        Ok(()) => true,
                        Err(e) => {
                            log::error!("failed to auto-provision default database: {e}");
                            false
                        }
                    }
                }
                Err(e) => {
                    log::error!("failed to reopen configured database: {e}");
                    false
                }
            };

            if opened {
                if let Err(e) = commands::planner::seed_default_curriculum(app.state::<db::DbState>()) {
                    log::error!("failed to seed default curriculum: {e}");
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_local_config,
            commands::settings::set_db_path,
            commands::settings::reopen_configured_db,
            commands::settings::ensure_default_db,
            commands::settings::save_api_key,
            commands::settings::get_api_key_status,
            commands::settings::clear_api_key,
            commands::settings::export_database,
            commands::anthropic::call_anthropic,
            commands::anthropic::test_anthropic_connection,
            commands::planner::seed_default_curriculum,
            commands::planner::list_ues,
            commands::planner::update_ue_notes,
            commands::planner::list_chapters,
            commands::planner::list_all_chapters,
            commands::planner::cycle_chapter_status,
            commands::planner::list_qcm_scores,
            commands::planner::list_all_qcm_scores,
            commands::planner::add_qcm_score,
            commands::planner::delete_qcm_score,
            commands::planner::list_timer_sessions,
            commands::planner::add_timer_session,
            commands::planner::delete_timer_session,
            commands::planner::get_meta,
            commands::planner::set_meta,
            commands::tutor::start_or_resume_tutor_session,
            commands::tutor::get_latest_completed_session,
            commands::tutor::get_in_progress_session,
            commands::tutor::save_tutor_session_progress,
            commands::tutor::abandon_tutor_session,
            commands::tutor::list_flashcards,
            commands::tutor::save_flashcards,
            commands::tutor::update_flashcard_progress,
            commands::tutor::complete_tutor_session,
            commands::tutor::list_due_chapters,
            commands::tutor::get_usage_summary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
