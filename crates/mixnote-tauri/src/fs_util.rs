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

/// Writes `bytes` to `path` so that a crash or full disk leaves either the old
/// file or the new one, never a half-written mix: the data goes to a hidden
/// sibling temp file, is synced to disk, then renamed over the target.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let invalid = || io::Error::new(ErrorKind::InvalidInput, "invalid path");
    let dir = path.parent().ok_or_else(invalid)?;
    let name = path.file_name().ok_or_else(invalid)?.to_string_lossy();
    // Unique per write, so two overlapping writes never share a temp file.
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!(".{name}.{}-{n}.tmp", std::process::id()));

    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        // Keep the permissions of the file being replaced.
        if let Ok(metadata) = fs::metadata(path) {
            let _ = file.set_permissions(metadata.permissions());
        }
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
        return result;
    }
    // Best effort: persist the rename itself.
    if let Ok(dir) = fs::File::open(dir) {
        let _ = dir.sync_all();
    }
    Ok(())
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
    fn io_errors_read_well() {
        assert_eq!(io_err(io::Error::from(ErrorKind::NotFound)), "文件或文件夹不存在");
        assert_eq!(io_err(io::Error::from(ErrorKind::StorageFull)), "磁盘空间不足");
        assert!(io_err(io::Error::other("boom")).contains("boom"));
    }
}
