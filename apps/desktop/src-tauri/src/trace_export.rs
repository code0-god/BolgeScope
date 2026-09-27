use crate::storage::{canonical_project, error, save_trace, trace_revision, NativeResult};
use crate::{file_name, selected_path};
use serde::Serialize;
use std::{fs, io, path::Path};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceReceipt {
    pub file_digest: String,
    pub byte_length: usize,
    pub name: String,
}

pub fn valid_name(name: &str) -> bool {
    name.len() > ".btrace.jsonl".len()
        && name.ends_with(".btrace.jsonl")
        && !name.contains(['/', '\\', ':', '\0'])
}

pub fn write(path: &Path, bytes: &[u8]) -> NativeResult<TraceReceipt> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| error("INVALID_PATH", "Trace filename is invalid"))?;
    if !valid_name(name) {
        return Err(error(
            "INVALID_PATH",
            "Trace filename must end in .btrace.jsonl",
        ));
    }
    let observed = match fs::symlink_metadata(path) {
        Ok(_) => Some(trace_revision(path)?),
        Err(cause) if cause.kind() == io::ErrorKind::NotFound => None,
        Err(cause) => return Err(error("IO_ERROR", cause.to_string())),
    };
    let saved = save_trace(path, bytes, observed.as_deref())?;
    Ok(TraceReceipt {
        file_digest: saved.disk_revision,
        byte_length: bytes.len(),
        name: name.to_string(),
    })
}

#[tauri::command]
pub(crate) async fn export_trace(
    app: AppHandle,
    bytes: Vec<u8>,
    suggested_name: String,
) -> NativeResult<Option<TraceReceipt>> {
    if !valid_name(&suggested_name) {
        return Err(error(
            "INVALID_PATH",
            "Trace filename must end in .btrace.jsonl",
        ));
    }
    let Some(selection) = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter("BolgeScope trace", &["jsonl"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let chosen = selected_path(selection)?;
    let parent = chosen
        .parent()
        .ok_or_else(|| error("INVALID_PATH", "Trace has no parent directory"))?;
    let path = canonical_project(parent)?.join(file_name(&chosen));
    write(&path, &bytes).map(Some)
}
