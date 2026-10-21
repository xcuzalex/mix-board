//! File helpers shared by the vault and document commands: crash-safe writes
//! and IO errors phrased for the UI.

use std::fs;
use std::io::{self, ErrorKind, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

/// Turns an IO error into a short message the UI can show as is.
pub fn io_err(error: io::Error) -> String {
    let message = match error.kind() {
        ErrorKind::NotFound => "文件或文件夹不存在",
        ErrorKind::PermissionDenied => "没有访问权限",
        ErrorKind::ReadOnlyFilesystem => "磁盘是只读的，无法写入",
        ErrorKind::StorageFull => "磁盘空间不足",
        ErrorKind::InvalidFilename => "名称无效或过长",
        ErrorKind::AlreadyExists => "已存在同名项目",
        _ => return format!("文件操作失败：{error}"),
    };
    message.to_string()
}

/// Temp files older than this are leftovers of a crash mid-write.
const STALE_TEMP_SECS: u64 = 60 * 60;

/// The hidden sibling a write goes through first: `.<name>.<pid>-<n>.tmp`.
fn temp_path(path: &Path) -> io::Result<std::path::PathBuf> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let invalid = || io::Error::new(ErrorKind::InvalidInput, "invalid path");
    let dir = path.parent().ok_or_else(invalid)?;
    let name = path.file_name().ok_or_else(invalid)?.to_string_lossy();
    // Unique per write, so two overlapping writes never share a temp file.
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    Ok(dir.join(format!(".{name}.{}-{n}.tmp", std::process::id())))
}

/// Writes and syncs `bytes` into a fresh temp file next to `path`. Returns the
/// temp path and the written file's metadata (taken from its own handle, so it
/// describes exactly these bytes; a rename keeps size and modification time).
fn write_temp(path: &Path, bytes: &[u8]) -> io::Result<(std::path::PathBuf, fs::Metadata)> {
    let tmp = temp_path(path)?;
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        // Keep the permissions of the file being replaced.
        if let Ok(metadata) = fs::metadata(path) {
            let _ = file.set_permissions(metadata.permissions());
        }
        file.write_all(bytes)?;
        file.sync_all()?;
        file.metadata()
    })();
    match result {
        Ok(metadata) => Ok((tmp, metadata)),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

fn sync_parent(path: &Path) {
    // Best effort: persist the directory entry itself.
    if let Some(dir) = path.parent()
        && let Ok(dir) = fs::File::open(dir)
    {
        let _ = dir.sync_all();
    }
}

/// Writes `bytes` to `path` so that a crash or full disk leaves either the old
/// file or the new one, never a half-written mix: the data goes to a hidden
/// sibling temp file, is synced to disk, then renamed over the target.
/// Returns the metadata of the file as written.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<fs::Metadata> {
    let (tmp, metadata) = write_temp(path, bytes)?;
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    sync_parent(path);
    Ok(metadata)
}

/// Creates `path` with `bytes`, failing with `AlreadyExists` if it exists. The
/// complete file appears at once (hard-linked from a synced temp file), never
/// empty or half-written. On volumes without hard links (some network / FAT
/// drives) it falls back to an exclusive create, removing the file again if
/// the write fails, so a failure never leaves a truncated file behind.
pub fn create_atomic(path: &Path, bytes: &[u8]) -> io::Result<fs::Metadata> {
    let (tmp, metadata) = write_temp(path, bytes)?;
    let linked = fs::hard_link(&tmp, path);
    let _ = fs::remove_file(&tmp);
    match linked {
        Ok(()) => {
            sync_parent(path);
            Ok(metadata)
        }
        Err(e) if e.kind() == ErrorKind::AlreadyExists => Err(e),
        Err(_) => {
            let mut file = fs::OpenOptions::new().write(true).create_new(true).open(path)?;
            let written = file.write_all(bytes).and_then(|()| file.sync_all()).and_then(|()| file.metadata());
            if written.is_err() {
                drop(file);
                let _ = fs::remove_file(path);
            }
            written
        }
    }
}

/// Whether `name` is one of our temp files (`.<name>.<pid>-<n>.tmp`).
pub fn is_temp_file(name: &str) -> bool {
    let Some(rest) = name.strip_prefix('.').and_then(|rest| rest.strip_suffix(".tmp")) else { return false };
    let Some((_, counter)) = rest.rsplit_once('.') else { return false };
    let mut parts = counter.split('-');
    let is_num = |part: Option<&str>| part.is_some_and(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()));
    is_num(parts.next()) && is_num(parts.next()) && parts.next().is_none()
}

/// Removes a temp file left behind by a crash (older than an hour, so a write
/// in progress — in this or another app instance — is never touched).
pub fn remove_if_stale_temp(path: &Path, metadata: &fs::Metadata) -> bool {
    let stale = metadata
        .modified()
        .ok()
        .and_then(|time| time.elapsed().ok())
        .is_some_and(|age| age.as_secs() > STALE_TEMP_SECS);
    stale && metadata.is_file() && fs::remove_file(path).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mixnote-fs-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn leftovers(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.ends_with(".tmp"))
            .collect()
    }

    #[test]
    fn atomic_write_creates_and_replaces() {
        let dir = temp_dir("atomic");
        let path = dir.join("画板.mixnote");
        write_atomic(&path, b"first").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "first");
        write_atomic(&path, b"second, and longer").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second, and longer");
        write_atomic(&path, b"").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "");
        assert!(leftovers(&dir).is_empty(), "temp files are renamed away");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_keeps_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("perms");
        let path = dir.join("a.mixnote");
        fs::write(&path, "old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        write_atomic(&path, b"new").unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn failed_atomic_write_leaves_the_old_file() {
        let dir = temp_dir("failed");
        // Renaming a file over a non-empty directory fails after the temp file is written.
        let target = dir.join("busy");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("keep.txt"), "kept").unwrap();
        assert!(write_atomic(&target, b"data").is_err());
        assert_eq!(fs::read_to_string(target.join("keep.txt")).unwrap(), "kept");
        assert!(leftovers(&dir).is_empty(), "the temp file is cleaned up");
        // A missing parent folder is an error, not a panic.
        assert_eq!(write_atomic(&dir.join("missing/a.mixnote"), b"x").unwrap_err().kind(), ErrorKind::NotFound);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn create_atomic_is_exclusive() {
        let dir = temp_dir("create");
        let path = dir.join("新.mixnote");
        create_atomic(&path, b"one").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "one");
        assert_eq!(create_atomic(&path, b"two").unwrap_err().kind(), ErrorKind::AlreadyExists);
        assert_eq!(fs::read_to_string(&path).unwrap(), "one", "an existing file is never replaced");
        assert!(leftovers(&dir).is_empty(), "the temp file is removed");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn recognises_temp_files() {
        assert!(is_temp_file(".画板.mixnote.123-4.tmp"));
        assert!(!is_temp_file(".画板.mixnote.tmp"));
        assert!(!is_temp_file("画板.mixnote.123-4.tmp"));
        assert!(!is_temp_file(".notes.12-x.tmp"));
    }

    #[test]
    fn io_errors_read_well() {
        assert_eq!(io_err(io::Error::from(ErrorKind::NotFound)), "文件或文件夹不存在");
        assert_eq!(io_err(io::Error::from(ErrorKind::StorageFull)), "磁盘空间不足");
        assert!(io_err(io::Error::other("boom")).contains("boom"));
    }
}
