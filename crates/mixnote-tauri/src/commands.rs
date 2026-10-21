use crate::vault::icloud_vault_dir;

#[tauri::command]
pub fn get_icloud_path() -> Option<String> {
    icloud_vault_dir().map(|dir| dir.to_string_lossy().to_string())
}
