use mixboard_core::document::Document;
use mixboard_core::serialization;

#[tauri::command]
pub fn new_document() -> Result<String, String> {
    let doc = Document::new();
    serialization::serialize(&doc).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_document(json: String) -> Result<String, String> {
    // Validate the JSON, then return it back
    let doc = serialization::deserialize(&json).map_err(|e| e.to_string())?;
    serialization::serialize(&doc).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_document(json: String) -> Result<String, String> {
    // Validate before saving
    let _doc = serialization::deserialize(&json).map_err(|e| e.to_string())?;
    Ok(json)
}

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
