mod notes;
mod notes_commands;
mod project_path;
mod recovery;
mod storage;
#[cfg(test)]
mod storage_tests;
mod trace_export;

use notes_commands::{read_notes, remove_notes, write_notes};
use project_path::project_path;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use storage::{
    canonical_file, canonical_project, error, file_revision, new_id, read_file, save_file, Grant,
    GrantStore, GrantedFile, NativeResult, ProjectGrant, SavedFile,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use trace_export::export_trace;

#[derive(Default)]
struct QuitApproval(AtomicBool);

impl QuitApproval {
    fn approve(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

fn should_guard_quit(approval: &QuitApproval, has_window: bool) -> bool {
    has_window && !approval.0.swap(false, Ordering::SeqCst)
}

#[tauri::command]
fn finish_quit(app: AppHandle, approval: State<'_, QuitApproval>) {
    approval.approve();
    app.exit(0);
}

fn file_name(path: &Path) -> String {
    path.file_name().map_or_else(
        || "Untitled".to_string(),
        |name| name.to_string_lossy().into_owned(),
    )
}

fn selected_path(path: tauri_plugin_dialog::FilePath) -> NativeResult<std::path::PathBuf> {
    path.into_path()
        .map_err(|cause| error("INVALID_PATH", cause.to_string()))
}

#[cfg(test)]
mod quit_tests {
    use super::{should_guard_quit, QuitApproval};

    #[test]
    fn quit_requires_frontend_decision_while_window_is_open() {
        let approval = QuitApproval::default();
        assert!(should_guard_quit(&approval, true));
        approval.approve();
        assert!(!should_guard_quit(&approval, true));
        assert!(should_guard_quit(&approval, true));
        assert!(!should_guard_quit(&approval, false));
    }
}

#[tauri::command]
async fn select_file(
    app: AppHandle,
    store: State<'_, GrantStore>,
) -> NativeResult<Option<GrantedFile>> {
    let Some(selection) = app
        .dialog()
        .file()
        .add_filter("Malbolge", &["mb", "mal", "nmal"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = canonical_file(&selected_path(selection)?)?;
    let grant_id = new_id();
    let file = read_file(&path, grant_id.clone(), file_name(&path))?;
    store
        .0
        .lock()
        .map_err(|_| error("IO_ERROR", "Grant table is unavailable"))?
        .insert(grant_id, Grant::File(path));
    Ok(Some(file))
}

#[tauri::command]
async fn select_project(
    app: AppHandle,
    store: State<'_, GrantStore>,
) -> NativeResult<Option<ProjectGrant>> {
    let Some(selection) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let root = canonical_project(&selected_path(selection)?)?;
    let grant_id = new_id();
    let project = ProjectGrant {
        grant_id: grant_id.clone(),
        name: file_name(&root),
    };
    store
        .0
        .lock()
        .map_err(|_| error("IO_ERROR", "Grant table is unavailable"))?
        .insert(grant_id, Grant::Project(root));
    Ok(Some(project))
}

#[tauri::command]
fn read_granted_file(grant_id: String, store: State<'_, GrantStore>) -> NativeResult<GrantedFile> {
    let guard = store
        .0
        .lock()
        .map_err(|_| error("IO_ERROR", "Grant table is unavailable"))?;
    let Some(Grant::File(path)) = guard.get(&grant_id) else {
        return Err(error("INVALID_GRANT", "Unknown file grant"));
    };
    read_file(path, grant_id, file_name(path))
}

#[tauri::command]
fn check_external_revision(grant_id: String, store: State<'_, GrantStore>) -> NativeResult<String> {
    let guard = store
        .0
        .lock()
        .map_err(|_| error("IO_ERROR", "Grant table is unavailable"))?;
    let Some(Grant::File(path)) = guard.get(&grant_id) else {
        return Err(error("INVALID_GRANT", "Unknown file grant"));
    };
    file_revision(path)
}

#[tauri::command]
fn save_granted_file(
    grant_id: String,
    bytes: Vec<u8>,
    observed_disk_revision: String,
    store: State<'_, GrantStore>,
) -> NativeResult<SavedFile> {
    let guard = store
        .0
        .lock()
        .map_err(|_| error("IO_ERROR", "Grant table is unavailable"))?;
    let Some(Grant::File(path)) = guard.get(&grant_id) else {
        return Err(error("INVALID_GRANT", "Unknown file grant"));
    };
    save_file(path, &bytes, Some(&observed_disk_revision))
}

#[tauri::command]
async fn save_as(
    app: AppHandle,
    store: State<'_, GrantStore>,
    bytes: Vec<u8>,
    suggested_name: String,
) -> NativeResult<Option<GrantedFile>> {
    if suggested_name.is_empty()
        || suggested_name.contains('/')
        || suggested_name.contains('\\')
        || suggested_name == "."
        || suggested_name == ".."
    {
        return Err(error("INVALID_PATH", "Suggested name must be a filename"));
    }
    let Some(selection) = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter("Malbolge", &["mb", "mal", "nmal"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let chosen = selected_path(selection)?;
    let name = file_name(&chosen);
    let parent = chosen
        .parent()
        .ok_or_else(|| error("INVALID_PATH", "Selected file has no parent"))?;
    let path = canonical_project(parent)?.join(&name);
    let observed = match std::fs::symlink_metadata(&path) {
        Ok(_) => Some(file_revision(&path)?),
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => None,
        Err(cause) => return Err(error("IO_ERROR", cause.to_string())),
    };
    save_file(&path, &bytes, observed.as_deref())?;
    let grant_id = new_id();
    let file = read_file(&path, grant_id.clone(), name)?;
    store
        .0
        .lock()
        .map_err(|_| error("IO_ERROR", "Grant table is unavailable"))?
        .insert(grant_id, Grant::File(path));
    Ok(Some(file))
}

#[tauri::command]
fn read_project_file(
    grant_id: String,
    relative_path: String,
    store: State<'_, GrantStore>,
) -> NativeResult<GrantedFile> {
    let guard = store
        .0
        .lock()
        .map_err(|_| error("IO_ERROR", "Grant table is unavailable"))?;
    let Some(Grant::Project(root)) = guard.get(&grant_id) else {
        return Err(error("INVALID_GRANT", "Unknown project grant"));
    };
    let path = project_path(root, &relative_path, false)?;
    read_file(&path, grant_id, relative_path)
}

#[tauri::command]
fn save_project_file(
    grant_id: String,
    relative_path: String,
    bytes: Vec<u8>,
    observed_disk_revision: Option<String>,
    store: State<'_, GrantStore>,
) -> NativeResult<SavedFile> {
    let guard = store
        .0
        .lock()
        .map_err(|_| error("IO_ERROR", "Grant table is unavailable"))?;
    let Some(Grant::Project(root)) = guard.get(&grant_id) else {
        return Err(error("INVALID_GRANT", "Unknown project grant"));
    };
    let path = project_path(root, &relative_path, true)?;
    save_file(&path, &bytes, observed_disk_revision.as_deref())
}

#[tauri::command]
fn write_recovery(
    app: AppHandle,
    document_id: String,
    source_revision: u64,
    observed_disk_revision: Option<String>,
    bytes: Vec<u8>,
) -> NativeResult<String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|cause| error("IO_ERROR", cause.to_string()))?;
    recovery::write(
        &app_data,
        &document_id,
        source_revision,
        observed_disk_revision,
        &bytes,
    )
}

#[tauri::command]
fn list_recovery(app: AppHandle) -> NativeResult<Vec<recovery::RecoveryRecord>> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|cause| error("IO_ERROR", cause.to_string()))?;
    recovery::list(&app_data)
}

#[tauri::command]
fn remove_recovery(app: AppHandle, recovery_id: String) -> NativeResult<()> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|cause| error("IO_ERROR", cause.to_string()))?;
    recovery::remove(&app_data, &recovery_id)
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(GrantStore::default())
        .manage(QuitApproval::default())
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            select_file,
            select_project,
            read_granted_file,
            check_external_revision,
            save_granted_file,
            save_as,
            read_project_file,
            save_project_file,
            write_recovery,
            list_recovery,
            remove_recovery,
            export_trace,
            read_notes,
            write_notes,
            remove_notes,
            finish_quit
        ]);
    // Test-only HTTP driver. No dependency or listener in default/release builds.
    #[cfg(feature = "e2e-webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    match builder.build(tauri::generate_context!()) {
        Ok(app) => app.run(|handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if should_guard_quit(
                    &handle.state::<QuitApproval>(),
                    handle.get_webview_window("main").is_some(),
                ) {
                    api.prevent_exit();
                    if let Err(cause) = handle.emit("bolgescope:quit-requested", ()) {
                        eprintln!("BolgeScope quit request could not reach the window: {cause}");
                    }
                }
            }
        }),
        Err(cause) => eprintln!("BolgeScope failed to start: {cause}"),
    }
}
