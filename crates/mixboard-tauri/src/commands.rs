#[tauri::command]
pub fn get_icloud_path() -> Option<String> {
    let home = dirs::home_dir()?;
    let icloud = home
        .join("Library/Mobile Documents/com~apple~CloudDocs")
        .join("MixBoard");
    if icloud.exists() || std::fs::create_dir_all(&icloud).is_ok() {
        Some(icloud.to_string_lossy().to_string())
    } else {
        None
    }
}
