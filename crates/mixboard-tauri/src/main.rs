mod commands;
mod native_menu;
mod quit;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(quit::QuitState::default())
        .setup(|app| {
            native_menu::install(&app.handle())?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            native_menu::handle_event(app, &event.id().0);
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_icloud_path,
            quit::quit_flush_done,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { code, api, .. } = &event {
                quit::on_exit_requested(app, *code, api);
            }
        });
}
