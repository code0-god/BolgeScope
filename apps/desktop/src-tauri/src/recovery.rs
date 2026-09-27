use crate::storage::{digest, error, file_revision, save_recovery, NativeResult, MAX_FILE_BYTES};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryHeader {
    document_id: String,
    source_revision: u64,
    observed_disk_revision: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryRecord {
    pub recovery_id: String,
    pub document_id: String,
    pub source_revision: u64,
    pub observed_disk_revision: Option<String>,
    pub bytes: Vec<u8>,
}

fn directory(app_data: &Path) -> NativeResult<PathBuf> {
    let path = app_data.join("recovery");
    fs::create_dir_all(&path).map_err(|cause| error("IO_ERROR", cause.to_string()))?;
    if fs::symlink_metadata(&path)
        .map_err(|cause| error("IO_ERROR", cause.to_string()))?
        .file_type()
        .is_symlink()
    {
        return Err(error(
            "INVALID_PATH",
            "Recovery directory is a symbolic link",
        ));
    }
    fs::canonicalize(path).map_err(|cause| error("IO_ERROR", cause.to_string()))
}

fn recovery_path(root: &Path, recovery_id: &str) -> NativeResult<PathBuf> {
    if recovery_id.len() != 64 || !recovery_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(error("INVALID_PATH", "Invalid recovery ID"));
    }
    Ok(root.join(format!("{recovery_id}.recovery")))
}

fn parse(path: &Path, recovery_id: String) -> NativeResult<RecoveryRecord> {
    let metadata =
        fs::symlink_metadata(path).map_err(|cause| error("IO_ERROR", cause.to_string()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(error("INVALID_PATH", "Recovery path is not a regular file"));
    }
    let mut contents = Vec::new();
    fs::File::open(path)
        .map_err(|cause| error("IO_ERROR", cause.to_string()))?
        .take((MAX_FILE_BYTES + 4098) as u64)
        .read_to_end(&mut contents)
        .map_err(|cause| error("IO_ERROR", cause.to_string()))?;
    if contents.len() > MAX_FILE_BYTES + 4097 {
        return Err(error("FILE_TOO_LARGE", "Recovery file exceeds its limit"));
    }
    let split = contents
        .iter()
        .position(|byte| *byte == b'\n')
        .ok_or_else(|| error("FILE_SCHEMA_ERROR", "Recovery header is missing"))?;
    if split > 4096 || contents.len() - split - 1 > MAX_FILE_BYTES {
        return Err(error("FILE_TOO_LARGE", "Recovery file exceeds its limit"));
    }
    let header: RecoveryHeader = serde_json::from_slice(&contents[..split])
        .map_err(|cause| error("FILE_SCHEMA_ERROR", cause.to_string()))?;
    Ok(RecoveryRecord {
        recovery_id,
        document_id: header.document_id,
        source_revision: header.source_revision,
        observed_disk_revision: header.observed_disk_revision,
        bytes: contents[split + 1..].to_vec(),
    })
}

pub fn write(
    app_data: &Path,
    document_id: &str,
    source_revision: u64,
    observed_disk_revision: Option<String>,
    bytes: &[u8],
) -> NativeResult<String> {
    if document_id.is_empty() || document_id.len() > 128 || bytes.len() > MAX_FILE_BYTES {
        return Err(error(
            "FILE_TOO_LARGE",
            "Recovery document ID or bytes exceed their limit",
        ));
    }
    let root = directory(app_data)?;
    let recovery_id = digest(document_id.as_bytes());
    let path = recovery_path(&root, &recovery_id)?;
    let current = match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(error("INVALID_PATH", "Recovery path is a symbolic link"))
        }
        Ok(_) => {
            let old = parse(&path, recovery_id.clone())?;
            if old.source_revision > source_revision {
                return Err(error(
                    "CONFLICT",
                    "A newer recovery revision already exists",
                ));
            }
            Some(file_revision(&path)?)
        }
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => None,
        Err(cause) => return Err(error("IO_ERROR", cause.to_string())),
    };
    let header = RecoveryHeader {
        document_id: document_id.to_string(),
        source_revision,
        observed_disk_revision,
    };
    let mut contents = serde_json::to_vec(&header)
        .map_err(|cause| error("FILE_SCHEMA_ERROR", cause.to_string()))?;
    if contents.len() > 4096 {
        return Err(error(
            "FILE_TOO_LARGE",
            "Recovery metadata exceeds its limit",
        ));
    }
    contents.push(b'\n');
    contents.extend_from_slice(bytes);
    save_recovery(&path, &contents, current.as_deref())?;
    Ok(recovery_id)
}

pub fn list(app_data: &Path) -> NativeResult<Vec<RecoveryRecord>> {
    let root = directory(app_data)?;
    let mut records = Vec::new();
    for entry in fs::read_dir(&root).map_err(|cause| error("IO_ERROR", cause.to_string()))? {
        let entry = entry.map_err(|cause| error("IO_ERROR", cause.to_string()))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(id) = name.strip_suffix(".recovery") {
            match recovery_path(&root, id).and_then(|path| parse(&path, id.to_string())) {
                Ok(record) => records.push(record),
                Err(cause) => eprintln!(
                    "BolgeScope skipped recovery entry {name:?}: {}: {}",
                    cause.code, cause.message
                ),
            }
        }
    }
    Ok(records)
}

pub fn remove(app_data: &Path, recovery_id: &str) -> NativeResult<()> {
    let path = recovery_path(&directory(app_data)?, recovery_id)?;
    fs::remove_file(path).map_err(|cause| error("IO_ERROR", cause.to_string()))
}
