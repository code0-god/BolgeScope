use crate::storage::{canonical_file, digest, error, read_file, save_file, NativeResult};
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

const MAX_NOTES_BYTES: usize = 1024 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotesHeader {
    bound_digest: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesRecord {
    pub bytes: Vec<u8>,
    pub bound_digest: String,
    pub notes_revision: String,
    pub stale: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesSaved {
    pub notes_revision: String,
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn notes_path(app_data: &Path, file_path: &Path) -> NativeResult<PathBuf> {
    if canonical_file(file_path)? != file_path {
        return Err(error("INVALID_PATH", "Granted source path changed"));
    }
    let directory = app_data.join("notes");
    fs::create_dir_all(&directory).map_err(|cause| error("IO_ERROR", cause.to_string()))?;
    if fs::symlink_metadata(&directory)
        .map_err(|cause| error("IO_ERROR", cause.to_string()))?
        .file_type()
        .is_symlink()
    {
        return Err(error("INVALID_PATH", "Notes directory is a symbolic link"));
    }
    let directory =
        fs::canonicalize(directory).map_err(|cause| error("IO_ERROR", cause.to_string()))?;
    #[cfg(unix)]
    let identity = {
        use std::os::unix::ffi::OsStrExt;
        digest(file_path.as_os_str().as_bytes())
    };
    #[cfg(not(unix))]
    let identity = digest(file_path.to_string_lossy().as_bytes());
    Ok(directory.join(format!("{identity}.notes")))
}

fn load(path: &Path, logical_digest: &str) -> NativeResult<Option<NotesRecord>> {
    let file = match read_file(path, String::new(), String::new()) {
        Ok(file) => file,
        Err(cause) if cause.code == "NOT_FOUND" => return Ok(None),
        Err(cause) => return Err(cause),
    };
    let split = file
        .bytes
        .iter()
        .position(|byte| *byte == b'\n')
        .ok_or_else(|| error("FILE_SCHEMA_ERROR", "Notes header is missing"))?;
    if split > 4096 || file.bytes.len() - split - 1 > MAX_NOTES_BYTES {
        return Err(error("FILE_TOO_LARGE", "Notes file exceeds its limit"));
    }
    let header: NotesHeader = serde_json::from_slice(&file.bytes[..split])
        .map_err(|cause| error("FILE_SCHEMA_ERROR", cause.to_string()))?;
    if !valid_digest(&header.bound_digest) {
        return Err(error(
            "FILE_SCHEMA_ERROR",
            "Notes binding digest is invalid",
        ));
    }
    Ok(Some(NotesRecord {
        bytes: file.bytes[split + 1..].to_vec(),
        stale: header.bound_digest != logical_digest,
        bound_digest: header.bound_digest,
        notes_revision: file.disk_revision,
    }))
}

pub fn read(
    app_data: &Path,
    file_path: &Path,
    logical_digest: &str,
) -> NativeResult<Option<NotesRecord>> {
    if !valid_digest(logical_digest) {
        return Err(error("FILE_SCHEMA_ERROR", "Logical digest is invalid"));
    }
    load(&notes_path(app_data, file_path)?, logical_digest)
}

pub fn write(
    app_data: &Path,
    file_path: &Path,
    logical_digest: &str,
    bytes: &[u8],
    observed_notes_revision: Option<&str>,
    allow_rebind: bool,
) -> NativeResult<NotesSaved> {
    if !valid_digest(logical_digest) || bytes.len() > MAX_NOTES_BYTES {
        return Err(error(
            "FILE_SCHEMA_ERROR",
            "Notes digest or size is invalid",
        ));
    }
    let json: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|cause| error("FILE_SCHEMA_ERROR", cause.to_string()))?;
    if !json.is_object() {
        return Err(error("FILE_SCHEMA_ERROR", "Notes must be a JSON object"));
    }
    let path = notes_path(app_data, file_path)?;
    if let Some(existing) = load(&path, logical_digest)? {
        if existing.stale && !allow_rebind {
            return Err(error(
                "STALE_BINDING",
                "Notes belong to a different logical source digest",
            ));
        }
    }
    let header = serde_json::to_vec(&NotesHeader {
        bound_digest: logical_digest.to_string(),
    })
    .map_err(|cause| error("FILE_SCHEMA_ERROR", cause.to_string()))?;
    let mut contents = Vec::with_capacity(header.len() + 1 + bytes.len());
    contents.extend_from_slice(&header);
    contents.push(b'\n');
    contents.extend_from_slice(bytes);
    let saved = save_file(&path, &contents, observed_notes_revision)?;
    Ok(NotesSaved {
        notes_revision: saved.disk_revision,
    })
}

pub fn remove(
    app_data: &Path,
    file_path: &Path,
    observed_notes_revision: &str,
) -> NativeResult<()> {
    let path = notes_path(app_data, file_path)?;
    let Some(existing) = load(&path, "")? else {
        return Err(error("NOT_FOUND", "Notes were already removed"));
    };
    if existing.notes_revision != observed_notes_revision {
        return Err(error("CONFLICT", "Notes changed since they were read"));
    }
    fs::remove_file(path).map_err(|cause| {
        let code = if cause.kind() == io::ErrorKind::NotFound {
            "CONFLICT"
        } else {
            "IO_ERROR"
        };
        error(code, cause.to_string())
    })
}
