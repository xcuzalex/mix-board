mod commands;
mod native_menu;
mod quit;
mod vault;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(quit::QuitState::default())
        .setup(|app| {
            native_menu::install(&app.handle())?;
            app.manage(vault::VaultState::load(&app.handle()));
            Ok(())
        })
        .on_menu_event(|app, event| {
            native_menu::handle_event(app, &event.id().0);
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_icloud_path,
            vault::vault_status,
            vault::vault_pick_folder,
            vault::vault_use_icloud,
            vault::vault_open_recent,
            vault::vault_forget_recent,
            vault::vault_use_local_drafts,
            vault::vault_set_last_board,
            vault::vault_list,
            vault::vault_set_favorite,
            vault::vault_create_board,
            vault::vault_create_folder,
            vault::vault_rename,
            vault::vault_trash,
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
