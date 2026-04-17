mod ai;
mod commands;
mod native_menu;

use std::sync::Arc;
use tokio::sync::Mutex;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            native_menu::install(&app.handle())?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            native_menu::handle_event(app, &event.id().0);
        })
        .manage(Arc::new(Mutex::new(None::<ai::chatgpt_auth_server::PendingOAuth>)))
        .invoke_handler(tauri::generate_handler![
            commands::new_document,
            commands::open_document,
            commands::save_document,
            commands::get_icloud_path,
            // Legacy OpenAI-only commands
            ai::commands::has_ai_credentials,
            ai::commands::get_ai_base_url,
            ai::commands::set_ai_credentials,
            ai::commands::clear_ai_credentials,
            ai::commands::validate_ai_credentials,
            ai::commands::list_ai_models,
            ai::commands::chat_completion,
            ai::commands::chat_completion_stream,
            // Multi-provider commands
            ai::commands::has_provider_credentials,
            ai::commands::get_provider_base_url,
            ai::commands::set_provider_credentials,
            ai::commands::clear_provider_credentials,
            ai::commands::validate_provider_credentials,
            ai::commands::list_provider_models,
            ai::commands::provider_chat_completion,
            // ChatGPT web auth
            ai::commands::has_chatgpt_session,
            ai::commands::get_auth_type,
            ai::commands::set_auth_type,
            ai::commands::start_chatgpt_login,
            ai::commands::clear_chatgpt_session,
            ai::commands::validate_chatgpt_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}