mod commands;
mod native_menu;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            native_menu::install(&app.handle())?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            native_menu::handle_event(app, &event.id().0);
        })
        .invoke_handler(tauri::generate_handler![
            commands::new_document,
            commands::open_document,
            commands::save_document,
            commands::get_icloud_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
