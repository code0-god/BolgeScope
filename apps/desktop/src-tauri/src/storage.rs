use serde::Serialize;
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use uuid::Uuid;

pub const MAX_FILE_BYTES: usize = 2 * 1024 * 1024;
const MAX_STORED_BYTES: usize = MAX_FILE_BYTES + 4097;
const MAX_TRACE_BYTES: usize = 64 * 1024 * 1024;

struct SaveContent<'a> {
    bytes: &'a [u8],
    observed: Option<&'a str>,
    max_bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeError {
    pub code: &'static str,
    pub message: String,
}

pub type NativeResult<T> = Result<T, NativeError>;

pub fn error(code: &'static str, message: impl Into<String>) -> NativeError {
    NativeError {
        code,
        message: message.into(),
    }
}

pub(crate) fn io_error(cause: std::io::Error) -> NativeError {
    let code = match cause.kind() {
        std::io::ErrorKind::NotFound => "NOT_FOUND",
        std::io::ErrorKind::PermissionDenied => "PERMISSION_DENIED",
        _ => "IO_ERROR",
    };
    error(code, cause.to_string())
}

#[derive(Clone)]
pub enum Grant {
    File(PathBuf),
    Project(PathBuf),
}

#[derive(Default)]
pub struct GrantStore(pub Mutex<HashMap<String, Grant>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantedFile {
    pub grant_id: String,
    pub target_id: String,
    pub request_id: Option<String>,
    pub name: String,
    pub bytes: Vec<u8>,
    pub disk_revision: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGrant {
    pub grant_id: String,
    pub target_id: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedFile {
    pub disk_revision: String,
}

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn path_identity(path: &Path) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        digest(path.as_os_str().as_bytes())
    }
    #[cfg(not(unix))]
    {
        digest(path.to_string_lossy().as_bytes())
    }
}

fn regular_file(path: &Path) -> NativeResult<()> {
    let metadata = fs::symlink_metadata(path).map_err(io_error)?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || fs::canonicalize(path).map_err(io_error)? != path
    {
        return Err(error(
            "INVALID_PATH",
            "File grant no longer points to the selected regular file",
        ));
    }
    Ok(())
}

pub fn canonical_file(path: &Path) -> NativeResult<PathBuf> {
    let canonical = fs::canonicalize(path).map_err(io_error)?;
    regular_file(&canonical)?;
    if fs::symlink_metadata(path)
        .map_err(io_error)?
        .file_type()
        .is_symlink()
    {
        return Err(error(
            "INVALID_PATH",
            "Symbolic links cannot be selected as files",
        ));
    }
    Ok(canonical)
}

pub fn canonical_project(path: &Path) -> NativeResult<PathBuf> {
    if fs::symlink_metadata(path)
        .map_err(io_error)?
        .file_type()
        .is_symlink()
    {
        return Err(error(
            "INVALID_PATH",
            "Symbolic links cannot be selected as projects",
        ));
    }
    let canonical = fs::canonicalize(path).map_err(io_error)?;
    if !fs::metadata(&canonical).map_err(io_error)?.is_dir() {
        return Err(error("INVALID_PATH", "Project grant must be a directory"));
    }
    Ok(canonical)
}

pub fn read_file(path: &Path, grant_id: String, name: String) -> NativeResult<GrantedFile> {
    regular_file(path)?;
    let file = File::open(path).map_err(io_error)?;
    let mut bytes = Vec::new();
    file.take((MAX_FILE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(error("FILE_TOO_LARGE", "File exceeds the 2 MiB limit"));
    }
    let disk_revision = digest(&bytes);
    Ok(GrantedFile {
        grant_id,
        target_id: path_identity(path),
        request_id: None,
        name,
        bytes,
        disk_revision,
    })
}

pub fn file_revision(path: &Path) -> NativeResult<String> {
    file_revision_with_limit(path, MAX_STORED_BYTES)
}

pub fn file_revision_with_limit(path: &Path, max_bytes: usize) -> NativeResult<String> {
    regular_file(path)?;
    let file = File::open(path).map_err(io_error)?;
    let mut bytes = Vec::new();
    file.take((max_bytes + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() > max_bytes {
        return Err(error("FILE_TOO_LARGE", "File exceeds its size limit"));
    }
    Ok(digest(&bytes))
}

pub fn save_file(path: &Path, bytes: &[u8], observed: Option<&str>) -> NativeResult<SavedFile> {
    save_content(
        path,
        SaveContent {
            bytes,
            observed,
            max_bytes: MAX_FILE_BYTES,
        },
    )
}

// Recovery has a bounded metadata header in addition to the source bytes.
// This allowance must not leak into ordinary source/project saves.
pub fn save_recovery(path: &Path, bytes: &[u8], observed: Option<&str>) -> NativeResult<SavedFile> {
    save_content(
        path,
        SaveContent {
            bytes,
            observed,
            max_bytes: MAX_STORED_BYTES,
        },
    )
}

pub fn save_trace(path: &Path, bytes: &[u8], observed: Option<&str>) -> NativeResult<SavedFile> {
    save_content(
        path,
        SaveContent {
            bytes,
            observed,
            max_bytes: MAX_TRACE_BYTES,
        },
    )
}

pub fn trace_revision(path: &Path) -> NativeResult<String> {
    file_revision_with_limit(path, MAX_TRACE_BYTES)
}

fn save_content(path: &Path, content: SaveContent<'_>) -> NativeResult<SavedFile> {
    if content.bytes.len() > content.max_bytes {
        return Err(error("FILE_TOO_LARGE", "File exceeds its size limit"));
    }
    let parent = checked_parent(path)?;
    check_target(path, content.observed, content.max_bytes)?;
    #[cfg(unix)]
    let permissions = if content.observed.is_some() {
        Some(fs::metadata(path).map_err(io_error)?.permissions())
    } else {
        None
    };
    let temporary = parent.join(format!(".bolgescope-{}.tmp", Uuid::new_v4()));
    let write_result = (|| -> NativeResult<()> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(&temporary).map_err(io_error)?;
        file.write_all(content.bytes).map_err(io_error)?;
        #[cfg(unix)]
        if let Some(permissions) = permissions {
            file.set_permissions(permissions).map_err(io_error)?;
        }
        file.sync_all().map_err(io_error)?;
        commit_temporary(path, &temporary, content.observed, content.max_bytes)
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result?;
    Ok(SavedFile {
        disk_revision: digest(content.bytes),
    })
}

fn checked_parent(path: &Path) -> NativeResult<&Path> {
    let parent = path
        .parent()
        .ok_or_else(|| error("INVALID_PATH", "File has no parent directory"))?;
    if fs::canonicalize(parent).map_err(io_error)? != parent {
        return Err(error("INVALID_PATH", "Selected directory changed"));
    }
    Ok(parent)
}

fn check_target(path: &Path, observed: Option<&str>, max_bytes: usize) -> NativeResult<()> {
    let current = match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(error("INVALID_PATH", "Target is not a regular file"));
            }
            Some(file_revision_with_limit(path, max_bytes)?)
        }
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => None,
        Err(cause) => return Err(io_error(cause)),
    };
    if current.as_deref() != observed {
        return Err(error(
            "CONFLICT",
            "File changed on disk since it was opened",
        ));
    }
    Ok(())
}

pub(crate) fn commit_temporary(
    path: &Path,
    temporary: &Path,
    observed: Option<&str>,
    max_bytes: usize,
) -> NativeResult<()> {
    let parent = checked_parent(path)?;
    check_target(path, observed, max_bytes)?;
    if observed.is_some() {
        fs::rename(temporary, path).map_err(io_error)?;
    } else {
        fs::hard_link(temporary, path).map_err(|cause| {
            if cause.kind() == std::io::ErrorKind::AlreadyExists {
                error("CONFLICT", "File was created since the save began")
            } else {
                io_error(cause)
            }
        })?;
        fs::remove_file(temporary).map_err(io_error)?;
    }
    File::open(parent)
        .map_err(io_error)?
        .sync_all()
        .map_err(io_error)
}

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}
