//! The vault ("资料库"): one user-chosen folder holding every board as a
//! `*.mixnote` file (boards from the MixBoard days, `*.mixboard`, still
//! open). The webview never gets a free-form path into this
//! module: a vault root is only set from the native folder picker, the iCloud
//! folder, or the recent list kept here, and every file command checks that its
//! target lies inside the open vault. Boards are read and written through
//! `read_document` / `write_document` (atomically), so a vault never needs an fs
//! plugin scope: the webview's own fs access stays limited to files the user
//! picked in a dialog.

use std::collections::BTreeMap;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;

use crate::fs_util::{io_err, write_atomic};

const CONFIG_FILE: &str = "vaults.json";
const BOARD_EXTENSION: &str = "mixnote";
/// Boards created before the MixNote rename; still listed and opened.
const LEGACY_BOARD_EXTENSION: &str = "mixboard";
const ICLOUD_PLACEHOLDER_SUFFIX: &str = ".icloud";
const MAX_RECENT: usize = 8;
const MAX_DEPTH: usize = 12;
/// The library lists at most this many boards and folders…
const MAX_ENTRIES: usize = 10_000;
/// …and looks at no more than this many directory items to find them.
const MAX_VISITED: usize = 100_000;
/// Longest board or folder name, in UTF-8 bytes (file names stop at 255).
const MAX_NAME_BYTES: usize = 200;
const UNTITLED_BOARD: &str = "未命名";
const UNTITLED_FOLDER: &str = "新建文件夹";
/// Per-vault metadata folder; it travels (and syncs) with the vault.
const META_DIR: &str = ".mixnote";
/// Metadata folder from before the rename; read when the new one is absent.
const LEGACY_META_DIR: &str = ".mixboard";
/// App config folder from before the bundle identifier changed.
const LEGACY_CONFIG_DIR: &str = "com.mixboard.whiteboard";
const FAVORITES_FILE: &str = "favorites.json";

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultConfig {
    #[serde(default)]
    current: Option<PathBuf>,
    #[serde(default)]
    recent: Vec<PathBuf>,
    /// The user picked "只用本机草稿" on the welcome screen.
    #[serde(default)]
    local_only: bool,
    /// Last board opened in each vault, keyed by vault path.
    #[serde(default)]
    last_boards: BTreeMap<PathBuf, PathBuf>,
}

pub struct VaultState {
    config_path: Option<PathBuf>,
    config: Mutex<VaultConfig>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    path: String,
    name: String,
    exists: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    current: Option<VaultInfo>,
    recent: Vec<VaultInfo>,
    needs_welcome: bool,
    last_board: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    path: String,
    parent: String,
    name: String,
    kind: &'static str,
    /// Milliseconds since the Unix epoch.
    modified: u64,
    /// False for iCloud placeholders that haven't been downloaded yet.
    downloaded: bool,
    /// Starred in the library (stored in `<vault>/.mixnote/favorites.json`).
    favorite: bool,
}

type CommandResult<T> = Result<T, String>;

fn err(message: impl std::fmt::Display) -> String {
    message.to_string()
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn vault_info(path: &Path) -> VaultInfo {
    VaultInfo {
        path: path.to_string_lossy().to_string(),
        name: display_name(path),
        exists: path.is_dir(),
    }
}

/// `~/Library/Mobile Documents/com~apple~CloudDocs/MixNote`, created if needed.
/// `None` when iCloud Drive itself is missing (signed out, or Drive turned off):
/// only the `MixNote` leaf is ever created, never iCloud's own folders.
fn icloud_vault_dir() -> Option<PathBuf> {
    let drive = dirs::home_dir()?.join("Library/Mobile Documents/com~apple~CloudDocs");
    if !drive.is_dir() {
        return None;
    }
    let dir = drive.join("MixNote");
    match fs::create_dir(&dir) {
        Ok(()) => Some(dir),
        Err(e) if e.kind() == ErrorKind::AlreadyExists && dir.is_dir() => Some(dir),
        Err(_) => None,
    }
}

/// Folders that must not become a vault: the disk root, the home folder itself,
/// and `~/Library` (app data), except iCloud Drive inside `~/Library/Mobile Documents`.
fn refuse_unsafe_root(root: &Path, home: Option<&Path>) -> CommandResult<()> {
    if root.parent().is_none() {
        return Err(err("不能把整个磁盘用作资料库，请选择其中的一个文件夹"));
    }
    let Some(home) = home else { return Ok(()) };
    if root == home {
        return Err(err("不能把整个个人文件夹用作资料库，请选择其中的一个文件夹"));
    }
    let library = home.join("Library");
    let mobile_documents = library.join("Mobile Documents");
    let in_icloud = root.starts_with(&mobile_documents) && root != mobile_documents;
    if root.starts_with(&library) && !in_icloud {
        return Err(err("不能把“资源库”（~/Library）中的文件夹用作资料库，请选择其他文件夹"));
    }
    Ok(())
}

fn check_vault_root(root: &Path) -> CommandResult<()> {
    let home = dirs::home_dir().map(|home| home.canonicalize().unwrap_or(home));
    refuse_unsafe_root(root, home.as_deref())
}

/// Reads a `vaults.json`; `Ok(None)` when there is none. One that exists but
/// doesn't parse yields the defaults, after being copied to `vaults.json.bak`
/// when `backup` is set (the next save replaces it).
fn read_config(path: &Path, backup: bool) -> std::io::Result<Option<VaultConfig>> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    match serde_json::from_str(&text) {
        Ok(config) => Ok(Some(config)),
        Err(e) => {
            eprintln!("MixNote: {} is unreadable ({e}); starting with defaults", path.display());
            if backup {
                let mut name = path.as_os_str().to_owned();
                name.push(".bak");
                if let Err(e) = fs::copy(path, PathBuf::from(name)) {
                    eprintln!("MixNote: could not back up {}: {e}", path.display());
                }
            }
            Ok(Some(VaultConfig::default()))
        }
    }
}

impl VaultState {
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> Self {
        let config_path = app.path().app_config_dir().ok().map(|dir| dir.join(CONFIG_FILE));
        // Fall back to the config saved under the old bundle identifier.
        let legacy_path = config_path
            .as_ref()
            .and_then(|path| path.parent()?.parent().map(|dir| dir.join(LEGACY_CONFIG_DIR).join(CONFIG_FILE)));
        let loaded = match &config_path {
            Some(path) => read_config(path, true),
            None => Ok(None),
        };
        let mut config = match loaded {
            Ok(Some(config)) => config,
            Ok(None) => legacy_path
                .and_then(|path| read_config(&path, false).ok().flatten())
                .unwrap_or_default(),
            Err(e) => {
                eprintln!("MixNote: could not read the vault config: {e}");
                VaultConfig::default()
            }
        };

        // A vault that went missing (unmounted drive, deleted folder) sends the
        // user back to the welcome screen instead of silently using drafts.
        config.current = config
            .current
            .take()
            .filter(|current| current.is_dir() && check_vault_root(current).is_ok());

        Self { config_path, config: Mutex::new(config) }
    }

    fn save(&self, config: &VaultConfig) {
        let Some(path) = &self.config_path else { return };
        let result = serde_json::to_string_pretty(config)
            .map_err(std::io::Error::other)
            .and_then(|text| {
                if let Some(dir) = path.parent() {
                    fs::create_dir_all(dir)?;
                }
                write_atomic(path, text.as_bytes())
            });
        if let Err(e) = result {
            eprintln!("MixNote: could not save {}: {e}", path.display());
        }
    }

    fn root(&self) -> CommandResult<PathBuf> {
        self.config
            .lock()
            .unwrap()
            .current
            .clone()
            .ok_or_else(|| err("没有打开的资料库"))
    }

    fn status(&self) -> VaultStatus {
        // Copy what we need, then touch the disk without holding the lock: a
        // slow or unmounted volume must not stall every other vault command.
        let (current, recent, local_only, last_board) = {
            let config = self.config.lock().unwrap();
            let last_board = config.current.as_ref().and_then(|root| config.last_boards.get(root)).cloned();
            (config.current.clone(), config.recent.clone(), config.local_only, last_board)
        };
        VaultStatus {
            needs_welcome: current.is_none() && !local_only,
            current: current.as_deref().map(vault_info),
            recent: recent.iter().map(|path| vault_info(path)).collect(),
            last_board: last_board
                .filter(|path| path.is_file())
                .map(|path| path.to_string_lossy().to_string()),
        }
    }

    fn open(&self, path: &Path) -> CommandResult<VaultStatus> {
        let root = path.canonicalize().map_err(|e| err(format!("无法打开文件夹：{}", io_err(e))))?;
        if !root.is_dir() {
            return Err(err("所选路径不是文件夹"));
        }
        check_vault_root(&root)?;
        {
            let mut config = self.config.lock().unwrap();
            config.recent.retain(|recent| recent != &root);
            config.recent.insert(0, root.clone());
            config.recent.truncate(MAX_RECENT);
            config.current = Some(root);
            config.local_only = false;
            // Forget the last board of vaults that fell off the recent list.
            let VaultConfig { recent, last_boards, .. } = &mut *config;
            last_boards.retain(|vault, _| recent.contains(vault));
            self.save(&config);
        }
        Ok(self.status())
    }
}

/// Resolves `path` (which may not exist yet) and requires it to sit strictly
/// inside the vault root.
fn inside_vault(root: &Path, path: &str) -> CommandResult<PathBuf> {
    let path = Path::new(path);
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(err("无效的路径"));
    }
    let resolved = if path.exists() {
        path.canonicalize().map_err(io_err)?
    } else {
        let parent = path.parent().ok_or_else(|| err("无效的路径"))?;
        let name = path.file_name().ok_or_else(|| err("无效的路径"))?;
        parent.canonicalize().map_err(io_err)?.join(name)
    };
    if resolved != root && resolved.starts_with(root) {
        Ok(resolved)
    } else {
        Err(err("路径不在当前资料库中"))
    }
}

/// Folders passed as a destination may be the vault root itself.
fn folder_in_vault(root: &Path, dir: Option<&str>) -> CommandResult<PathBuf> {
    match dir {
        None => Ok(root.to_path_buf()),
        Some(dir) if Path::new(dir) == root => Ok(root.to_path_buf()),
        Some(dir) => {
            let dir = inside_vault(root, dir)?;
            if dir.is_dir() { Ok(dir) } else { Err(err("文件夹不存在")) }
        }
    }
}

/// A board the webview may read or write: a board file inside the open vault,
/// or a file the user picked in an open/save dialog (the dialog plugin adds
/// those to the fs scope). Dialog paths must not be symlinks, and their parent
/// folder is resolved so the atomic write lands next to the real file.
fn document_path(vault: Option<&Path>, allowed: impl Fn(&Path) -> bool, path: &str) -> CommandResult<PathBuf> {
    if let Some(root) = vault
        && let Ok(resolved) = inside_vault(root, path)
        && is_board(&resolved)
    {
        return Ok(resolved);
    }

    let target = Path::new(path);
    if !target.is_absolute() || target.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(err("无效的路径"));
    }
    if !allowed(target) {
        return Err(err("没有权限访问该文件，请通过“打开”或“另存为”重新选择"));
    }
    if fs::symlink_metadata(target).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err(err("不支持读写符号链接（替身）文件"));
    }
    let parent = target.parent().ok_or_else(|| err("无效的路径"))?;
    let name = target.file_name().ok_or_else(|| err("无效的路径"))?;
    Ok(parent.canonicalize().map_err(io_err)?.join(name))
}

fn resolve_document<R: Runtime>(app: &AppHandle<R>, state: &VaultState, path: &str) -> CommandResult<PathBuf> {
    let vault = state.config.lock().unwrap().current.clone();
    let scope = app.fs_scope();
    let resolved = document_path(vault.as_deref(), |path| scope.is_allowed(path), path)?;
    if resolved.is_dir() {
        return Err(err("所选路径是文件夹，不是笔记文件"));
    }
    Ok(resolved)
}

fn validate_name(name: &str) -> CommandResult<&str> {
    let name = name.trim();
    if name.is_empty() {
        return Err(err("名称不能为空"));
    }
    if name.starts_with('.') || name.contains(['/', '\\', ':']) {
        return Err(err("名称不能以 . 开头，也不能包含 / \\ :"));
    }
    if name.chars().any(char::is_control) {
        return Err(err("名称不能包含换行等控制字符"));
    }
    if name.len() > MAX_NAME_BYTES {
        return Err(err("名称太长了，请缩短一些"));
    }
    Ok(name)
}

fn is_board(path: &Path) -> bool {
    path.extension().is_some_and(|ext| {
        ext.eq_ignore_ascii_case(BOARD_EXTENSION) || ext.eq_ignore_ascii_case(LEGACY_BOARD_EXTENSION)
    })
}

fn modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Collects the vault's boards and folders, depth-first, within the caps.
#[derive(Default)]
struct Walk {
    entries: Vec<VaultEntry>,
    visited: usize,
}

impl Walk {
    fn full(&self) -> bool {
        self.entries.len() >= MAX_ENTRIES || self.visited >= MAX_VISITED
    }

    fn walk(&mut self, dir: &Path, depth: usize) {
        let Ok(read_dir) = fs::read_dir(dir) else { return };
        for item in read_dir.flatten() {
            if self.full() {
                return;
            }
            self.visited += 1;
            let path = item.path();
            let file_name = item.file_name().to_string_lossy().to_string();
            let Ok(metadata) = item.metadata() else { continue };
            let parent = dir.to_string_lossy().to_string();

            // iCloud keeps not-yet-downloaded files as hidden `.Name.ext.icloud` stubs.
            if let Some(stub) = file_name
                .strip_prefix('.')
                .and_then(|rest| rest.strip_suffix(ICLOUD_PLACEHOLDER_SUFFIX))
            {
                let real = dir.join(stub);
                if is_board(&real) && !real.exists() {
                    self.entries.push(VaultEntry {
                        path: real.to_string_lossy().to_string(),
                        parent,
                        name: board_stem(&real),
                        kind: "board",
                        modified: modified_ms(&metadata),
                        downloaded: false,
                        favorite: false,
                    });
                }
                continue;
            }
            if file_name.starts_with('.') {
                continue;
            }

            if metadata.is_dir() {
                self.entries.push(VaultEntry {
                    path: path.to_string_lossy().to_string(),
                    parent,
                    name: file_name,
                    kind: "folder",
                    modified: modified_ms(&metadata),
                    downloaded: true,
                    favorite: false,
                });
                if depth < MAX_DEPTH {
                    self.walk(&path, depth + 1);
                }
            } else if metadata.is_file() && is_board(&path) {
                self.entries.push(VaultEntry {
                    path: path.to_string_lossy().to_string(),
                    parent,
                    name: board_stem(&path),
                    kind: "board",
                    modified: modified_ms(&metadata),
                    downloaded: true,
                    favorite: false,
                });
            }
        }
    }
}

fn board_stem(path: &Path) -> String {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Picks `<base>.<ext>`, then `<base> 2.<ext>`, … and creates it atomically.
fn create_unique(dir: &Path, base: &str, extension: Option<&str>, make: impl Fn(&Path) -> std::io::Result<()>) -> CommandResult<PathBuf> {
    for n in 1..10_000 {
        let stem = if n == 1 { base.to_string() } else { format!("{base} {n}") };
        let name = match extension {
            Some(ext) => format!("{stem}.{ext}"),
            None => stem,
        };
        let path = dir.join(name);
        match make(&path) {
            Ok(()) => return Ok(path),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(io_err(e)),
        }
    }
    Err(err("无法生成新名称"))
}

// --- Favorites (vault-relative paths, so they survive moving the vault) ---

fn favorites_file(root: &Path) -> PathBuf {
    root.join(META_DIR).join(FAVORITES_FILE)
}

/// The vault's favorites. Errors when the file exists but can't be read or
/// parsed, so callers never rewrite it from a list that lost the user's stars.
fn read_favorites(root: &Path) -> CommandResult<Vec<String>> {
    let text = match fs::read_to_string(favorites_file(root)) {
        Ok(text) => text,
        Err(e) if e.kind() == ErrorKind::NotFound => {
            // The pre-rename file is never rewritten, so a broken one is just skipped.
            return Ok(fs::read_to_string(root.join(LEGACY_META_DIR).join(FAVORITES_FILE))
                .ok()
                .and_then(|text| serde_json::from_str(&text).ok())
                .unwrap_or_default());
        }
        Err(e) => return Err(err(format!("无法读取收藏列表：{}", io_err(e)))),
    };
    serde_json::from_str(&text)
        .map_err(|_| err(format!("收藏列表文件已损坏，为避免覆盖暂不修改：{}", favorites_file(root).display())))
}

fn write_favorites(root: &Path, favorites: &[String]) -> CommandResult<()> {
    let path = favorites_file(root);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(io_err)?;
    }
    let text = serde_json::to_string_pretty(favorites).map_err(err)?;
    write_atomic(&path, text.as_bytes()).map_err(io_err)
}

fn relative_key(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/")
}

fn is_under(key: &str, prefix: &str) -> bool {
    key == prefix || key.strip_prefix(prefix).is_some_and(|rest| rest.starts_with('/'))
}

/// Keeps favorites pointing at the right files after a rename (`to`) or trash
/// (`None`). Leaves an unreadable favorites file alone rather than replacing it.
fn update_favorites(root: &Path, from: &Path, to: Option<&Path>) {
    let favorites = match read_favorites(root) {
        Ok(favorites) => favorites,
        Err(e) => {
            eprintln!("MixNote: favorites not updated: {e}");
            return;
        }
    };
    let from = relative_key(root, from);
    if !favorites.iter().any(|key| is_under(key, &from)) {
        return;
    }
    let updated: Vec<String> = favorites
        .into_iter()
        .filter_map(|key| {
            if !is_under(&key, &from) {
                return Some(key);
            }
            to.map(|to| format!("{}{}", relative_key(root, to), &key[from.len()..]))
        })
        .collect();
    if let Err(e) = write_favorites(root, &updated) {
        eprintln!("MixNote: favorites not updated: {e}");
    }
}

#[cfg(target_os = "macos")]
fn move_to_trash(path: &Path) -> CommandResult<()> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|e| err(e.localizedDescription()))
}

#[cfg(not(target_os = "macos"))]
fn move_to_trash(_path: &Path) -> CommandResult<()> {
    Err(err("此平台暂不支持移到废纸篓"))
}

// --- Commands ---

/// Runs off the main thread: it stats every recent vault, which can stall on
/// a sleeping or unmounted volume.
#[tauri::command(async)]
pub fn vault_status(state: State<'_, VaultState>) -> CommandResult<VaultStatus> {
    Ok(state.status())
}

#[tauri::command]
pub async fn vault_pick_folder<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, VaultState>,
) -> CommandResult<Option<VaultStatus>> {
    let mut dialog = app.dialog().file().set_title("选择用作资料库的文件夹");
    if let Some(documents) = dirs::document_dir() {
        dialog = dialog.set_directory(documents);
    }
    let Some(picked) = dialog.blocking_pick_folder() else { return Ok(None) };
    let path = picked.into_path().map_err(err)?;
    state.open(&path).map(Some)
}

#[tauri::command]
pub fn vault_use_icloud(state: State<'_, VaultState>) -> CommandResult<VaultStatus> {
    let dir = icloud_vault_dir().ok_or_else(|| err("iCloud 云盘不可用，请在系统设置中登录 iCloud 并开启 iCloud 云盘"))?;
    state.open(&dir)
}

#[tauri::command]
pub fn vault_open_recent(state: State<'_, VaultState>, path: String) -> CommandResult<VaultStatus> {
    let path = PathBuf::from(path);
    if !state.config.lock().unwrap().recent.contains(&path) {
        return Err(err("该文件夹不在最近的资料库中"));
    }
    state.open(&path)
}

#[tauri::command]
pub fn vault_forget_recent(state: State<'_, VaultState>, path: String) -> VaultStatus {
    {
        let mut config = state.config.lock().unwrap();
        let path = PathBuf::from(path);
        config.recent.retain(|recent| recent != &path);
        config.last_boards.remove(&path);
        state.save(&config);
    }
    state.status()
}

#[tauri::command]
pub fn vault_use_local_drafts(state: State<'_, VaultState>) -> VaultStatus {
    {
        let mut config = state.config.lock().unwrap();
        config.current = None;
        config.local_only = true;
        state.save(&config);
    }
    state.status()
}

#[tauri::command]
pub fn vault_set_last_board(state: State<'_, VaultState>, path: Option<String>) -> CommandResult<()> {
    let root = state.root()?;
    let mut config = state.config.lock().unwrap();
    match path {
        Some(path) => {
            let path = inside_vault(&root, &path)?;
            config.last_boards.insert(root, path);
        }
        None => {
            config.last_boards.remove(&root);
        }
    }
    state.save(&config);
    Ok(())
}

/// Runs off the main thread: a big or iCloud-backed vault can take a while to walk.
#[tauri::command(async)]
pub fn vault_list(state: State<'_, VaultState>) -> CommandResult<Vec<VaultEntry>> {
    let root = state.root()?;
    let mut walk = Walk::default();
    walk.walk(&root, 0);
    let mut entries = walk.entries;
    // An unreadable favorites file only hides the stars; the list still loads.
    let favorites = read_favorites(&root).unwrap_or_default();
    if !favorites.is_empty() {
        for entry in &mut entries {
            let key = relative_key(&root, Path::new(&entry.path));
            entry.favorite = favorites.contains(&key);
        }
    }
    Ok(entries)
}

#[tauri::command]
pub fn vault_set_favorite(state: State<'_, VaultState>, path: String, favorite: bool) -> CommandResult<()> {
    let root = state.root()?;
    let key = relative_key(&root, &inside_vault(&root, &path)?);
    let mut favorites = read_favorites(&root)?;
    favorites.retain(|existing| existing != &key);
    if favorite {
        favorites.push(key);
    }
    write_favorites(&root, &favorites)
}

/// Creates `未命名 N.mixnote` in `dir` (the vault root when omitted) holding
/// `content`, and returns its path.
#[tauri::command]
pub fn vault_create_board(state: State<'_, VaultState>, dir: Option<String>, content: String) -> CommandResult<String> {
    let root = state.root()?;
    let dir = folder_in_vault(&root, dir.as_deref())?;
    let path = create_unique(&dir, UNTITLED_BOARD, Some(BOARD_EXTENSION), |path| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(path)?;
        file.write_all(content.as_bytes())
    })?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn vault_create_folder(state: State<'_, VaultState>, dir: Option<String>) -> CommandResult<String> {
    let root = state.root()?;
    let dir = folder_in_vault(&root, dir.as_deref())?;
    let path = create_unique(&dir, UNTITLED_FOLDER, None, |path| fs::create_dir(path))?;
    Ok(path.to_string_lossy().to_string())
}

/// Renames a board (keeping its extension) or folder in place; returns the new path.
#[tauri::command]
pub fn vault_rename(state: State<'_, VaultState>, path: String, name: String) -> CommandResult<String> {
    let root = state.root()?;
    let source = inside_vault(&root, &path)?;
    if !source.exists() {
        return Err(err("文件不存在"));
    }
    let name = validate_name(&name)?;
    let file_name = if source.is_file() && is_board(&source) {
        // Keep the board's own extension (a legacy `.mixboard` stays one).
        let ext = source.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_else(|| BOARD_EXTENSION.into());
        format!("{name}.{ext}")
    } else {
        name.to_string()
    };
    let target = source.with_file_name(file_name);
    if target == source {
        return Ok(path);
    }
    // On a case-insensitive volume, "a" → "A" finds the source itself.
    let same_file = target.canonicalize().is_ok_and(|resolved| resolved == source);
    if target.exists() && !same_file {
        return Err(err(format!("已存在名为「{name}」的项目")));
    }
    fs::rename(&source, &target).map_err(io_err)?;
    update_favorites(&root, &source, Some(&target));

    let mut config = state.config.lock().unwrap();
    if let Some(last) = config.last_boards.get_mut(&root)
        && let Ok(rest) = last.strip_prefix(&source)
    {
        *last = target.join(rest);
        state.save(&config);
    }
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn vault_trash(state: State<'_, VaultState>, path: String) -> CommandResult<()> {
    let root = state.root()?;
    let target = inside_vault(&root, &path)?;
    if !target.exists() {
        return Err(err("文件不存在"));
    }
    move_to_trash(&target)?;
    update_favorites(&root, &target, None);
    Ok(())
}

/// Reads a board (see `document_path` for which files are allowed).
#[tauri::command(async)]
pub fn read_document<R: Runtime>(app: AppHandle<R>, state: State<'_, VaultState>, path: String) -> CommandResult<String> {
    let path = resolve_document(&app, &state, &path)?;
    fs::read_to_string(&path).map_err(io_err)
}

/// Saves a board atomically, so a crash or a full disk mid-write can't leave a
/// truncated file (see `document_path` for which files are allowed).
#[tauri::command(async)]
pub fn write_document<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, VaultState>,
    path: String,
    content: String,
) -> CommandResult<()> {
    let path = resolve_document(&app, &state, &path)?;
    write_atomic(&path, content.as_bytes()).map_err(io_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn favorites_follow_renames_and_trash() {
        let root = temp_vault("favorites");
        write_favorites(&root, &["项目/a.mixnote".into(), "项目2/b.mixnote".into(), "c.mixnote".into()]).unwrap();
        update_favorites(&root, &root.join("项目"), Some(&root.join("工作")));
        assert_eq!(read_favorites(&root).unwrap(), vec!["工作/a.mixnote", "项目2/b.mixnote", "c.mixnote"]);
        update_favorites(&root, &root.join("c.mixnote"), None);
        assert_eq!(read_favorites(&root).unwrap(), vec!["工作/a.mixnote", "项目2/b.mixnote"]);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn broken_favorites_are_never_overwritten() {
        let root = temp_vault("broken-favorites");
        fs::create_dir(root.join(META_DIR)).unwrap();
        let broken = r#"["a.mixnote", "b.mix"#;
        fs::write(favorites_file(&root), broken).unwrap();
        assert!(read_favorites(&root).is_err());
        update_favorites(&root, &root.join("a.mixnote"), None);
        assert_eq!(fs::read_to_string(favorites_file(&root)).unwrap(), broken);
        fs::remove_dir_all(&root).unwrap();
    }

    fn temp_vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mixnote-vault-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn paths_must_stay_inside_the_vault() {
        let root = temp_vault("inside");
        fs::create_dir(root.join("notes")).unwrap();
        let s = |p: &Path| p.to_string_lossy().to_string();

        assert!(inside_vault(&root, &s(&root.join("notes"))).is_ok());
        assert!(inside_vault(&root, &s(&root.join("notes/new.mixnote"))).is_ok());
        assert!(inside_vault(&root, &s(&root)).is_err(), "the root itself is not an entry");
        assert!(inside_vault(&root, &s(&root.join("../escape.mixnote"))).is_err());
        assert!(inside_vault(&root, "relative.mixnote").is_err());
        assert!(inside_vault(&root, "/etc/hosts").is_err());
        assert!(folder_in_vault(&root, None).unwrap() == root);
        assert!(folder_in_vault(&root, Some(&s(&root.join("missing")))).is_err());
        fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn documents_are_vault_boards_or_dialog_picks() {
        let root = temp_vault("documents");
        let outside = temp_vault("documents-outside");
        fs::write(root.join("a.mixnote"), "{}").unwrap();
        fs::write(outside.join("picked.mixnote"), "{}").unwrap();
        std::os::unix::fs::symlink(outside.join("picked.mixnote"), outside.join("link.mixnote")).unwrap();
        let s = |p: &Path| p.to_string_lossy().to_string();
        let nothing_picked = |_: &Path| false;
        let everything_picked = |_: &Path| true;

        // Vault boards, existing or new.
        assert_eq!(document_path(Some(&root), nothing_picked, &s(&root.join("a.mixnote"))).unwrap(), root.join("a.mixnote"));
        assert!(document_path(Some(&root), nothing_picked, &s(&root.join("new.mixnote"))).is_ok());
        // Not a board, or outside the vault, without a dialog pick.
        assert!(document_path(Some(&root), nothing_picked, &s(&root.join(".mixnote/favorites.json"))).is_err());
        assert!(document_path(Some(&root), nothing_picked, &s(&outside.join("picked.mixnote"))).is_err());
        assert!(document_path(None, nothing_picked, &s(&root.join("a.mixnote"))).is_err());
        // Dialog picks: allowed, but never through a symlink or `..`.
        assert_eq!(
            document_path(None, everything_picked, &s(&outside.join("picked.mixnote"))).unwrap(),
            outside.join("picked.mixnote")
        );
        assert!(document_path(None, everything_picked, &s(&outside.join("link.mixnote"))).is_err());
        assert!(document_path(None, everything_picked, &s(&outside.join("../x.mixnote"))).is_err());
        assert!(document_path(None, everything_picked, "relative.mixnote").is_err());
        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn unsafe_vault_roots_are_refused() {
        let home = Path::new("/Users/someone");
        let refused = |path: &str| refuse_unsafe_root(Path::new(path), Some(home)).is_err();
        assert!(refused("/"));
        assert!(refused("/Users/someone"));
        assert!(refused("/Users/someone/Library"));
        assert!(refused("/Users/someone/Library/Application Support/MixNote"));
        assert!(refused("/Users/someone/Library/Mobile Documents"));
        assert!(!refused("/Users/someone/Library/Mobile Documents/com~apple~CloudDocs/MixNote"));
        assert!(!refused("/Users/someone/Documents/Notes"));
        assert!(!refused("/Users/someone/LibraryNotes"));
        assert!(!refused("/Volumes/Data/Notes"));
        assert!(refuse_unsafe_root(Path::new("/"), None).is_err());
    }

    #[test]
    fn broken_config_is_backed_up() {
        let dir = temp_vault("config");
        let path = dir.join(CONFIG_FILE);
        assert!(read_config(&path, true).unwrap().is_none(), "a missing config is not an error");
        fs::write(&path, r#"{"current": "/a", "rec"#).unwrap();
        let config = read_config(&path, true).unwrap().unwrap();
        assert!(config.current.is_none());
        assert_eq!(fs::read_to_string(dir.join("vaults.json.bak")).unwrap(), r#"{"current": "/a", "rec"#);
        fs::write(&path, r#"{"current": "/a", "recent": ["/a"]}"#).unwrap();
        assert_eq!(read_config(&path, true).unwrap().unwrap().current, Some(PathBuf::from("/a")));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn legacy_boards_and_favorites_still_work() {
        let root = temp_vault("legacy");
        assert!(is_board(&root.join("old.mixboard")));
        assert!(is_board(&root.join("new.mixnote")));
        assert!(!is_board(&root.join("notes.json")));
        fs::create_dir(root.join(LEGACY_META_DIR)).unwrap();
        fs::write(root.join(LEGACY_META_DIR).join(FAVORITES_FILE), r#"["old.mixboard"]"#).unwrap();
        assert_eq!(read_favorites(&root).unwrap(), vec!["old.mixboard"]);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn names_are_validated() {
        assert_eq!(validate_name("  周报 ").unwrap(), "周报");
        assert!(validate_name("").is_err());
        assert!(validate_name(".hidden").is_err());
        assert!(validate_name("a/b").is_err());
        assert!(validate_name("a:b").is_err());
        assert!(validate_name("a\nb").is_err());
        assert!(validate_name("tab\there").is_err());
        assert!(validate_name("bell\u{7}").is_err());
        // 66 three-byte characters = 198 bytes is fine; 67 = 201 bytes is not.
        assert!(validate_name(&"周".repeat(66)).is_ok());
        assert!(validate_name(&"周".repeat(67)).is_err());
        assert!(validate_name(&"a".repeat(200)).is_ok());
        assert!(validate_name(&"a".repeat(201)).is_err());
    }

    #[test]
    fn untitled_boards_get_unique_names() {
        let root = temp_vault("unique");
        let make = |path: &Path| fs::OpenOptions::new().write(true).create_new(true).open(path).map(|_| ());
        let first = create_unique(&root, UNTITLED_BOARD, Some(BOARD_EXTENSION), make).unwrap();
        let second = create_unique(&root, UNTITLED_BOARD, Some(BOARD_EXTENSION), make).unwrap();
        assert_eq!(first.file_name().unwrap(), "未命名.mixnote");
        assert_eq!(second.file_name().unwrap(), "未命名 2.mixnote");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn listing_finds_boards_folders_and_icloud_placeholders() {
        let root = temp_vault("list");
        fs::create_dir(root.join("项目")).unwrap();
        fs::create_dir(root.join(".mixnote")).unwrap();
        fs::write(root.join("a.mixnote"), "{}").unwrap();
        // Boards from before the rename are still listed.
        fs::write(root.join("项目/b.mixboard"), "{}").unwrap();
        fs::write(root.join("notes.txt"), "").unwrap();
        fs::write(root.join(".c.mixnote.icloud"), "").unwrap();
        // Leftover temp files from an interrupted save stay hidden.
        fs::write(root.join(".d.mixnote.1-0.tmp"), "").unwrap();

        let mut walk = Walk::default();
        walk.walk(&root, 0);
        let mut seen: Vec<_> = walk.entries.iter().map(|e| (e.name.as_str(), e.kind, e.downloaded)).collect();
        seen.sort();
        assert_eq!(seen, vec![("a", "board", true), ("b", "board", true), ("c", "board", false), ("项目", "folder", true)]);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn listing_stops_at_the_cap() {
        let mut walk = Walk { visited: MAX_VISITED, ..Walk::default() };
        let root = temp_vault("cap");
        fs::write(root.join("a.mixnote"), "{}").unwrap();
        walk.walk(&root, 0);
        assert!(walk.entries.is_empty());
        fs::remove_dir_all(&root).unwrap();
    }
}
