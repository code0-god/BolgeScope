use crate::{
    notes,
    storage::{error, Grant, GrantStore, NativeResult},
};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub(crate) fn read_notes(
    app: AppHandle,
    store: State<'_, GrantStore>,
    grant_id: String,
    logical_digest: String,
) -> NativeResult<Option<notes::NotesRecord>> {
    let guard = store
        .0
        .lock()
        .map_err(|_| error("IO_ERROR", "Grant table is unavailable"))?;
    let Some(Grant::File(path)) = guard.get(&grant_id) else {
        return Err(error("INVALID_GRANT", "Unknown file grant"));
    };
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|cause| error("IO_ERROR", cause.to_string()))?;
    notes::read(&app_data, path, &logical_digest)
}

#[tauri::command]
pub(crate) fn write_notes(
    app: AppHandle,
    store: State<'_, GrantStore>,
    grant_id: String,
    logical_digest: String,
    bytes: Vec<u8>,
    observed_notes_revision: Option<String>,
    allow_rebind: bool,
) -> NativeResult<notes::NotesSaved> {
    let guard = store
        .0
        .lock()
        .map_err(|_| error("IO_ERROR", "Grant table is unavailable"))?;
    let Some(Grant::File(path)) = guard.get(&grant_id) else {
        return Err(error("INVALID_GRANT", "Unknown file grant"));
    };
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|cause| error("IO_ERROR", cause.to_string()))?;
    notes::write(
        &app_data,
        path,
        &logical_digest,
        &bytes,
        observed_notes_revision.as_deref(),
        allow_rebind,
    )
}

#[tauri::command]
pub(crate) fn remove_notes(
    app: AppHandle,
    store: State<'_, GrantStore>,
    grant_id: String,
    observed_notes_revision: String,
) -> NativeResult<()> {
    let guard = store
        .0
        .lock()
        .map_err(|_| error("IO_ERROR", "Grant table is unavailable"))?;
    let Some(Grant::File(path)) = guard.get(&grant_id) else {
        return Err(error("INVALID_GRANT", "Unknown file grant"));
    };
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|cause| error("IO_ERROR", cause.to_string()))?;
    notes::remove(&app_data, path, &observed_notes_revision)
}
