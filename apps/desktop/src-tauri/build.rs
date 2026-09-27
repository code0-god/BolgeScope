fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "select_file",
            "select_project",
            "read_granted_file",
            "check_external_revision",
            "save_granted_file",
            "save_as",
            "read_project_file",
            "save_project_file",
            "write_recovery",
            "list_recovery",
            "remove_recovery",
            "export_trace",
            "read_notes",
            "write_notes",
            "remove_notes",
            "finish_quit",
        ]),
    ))
    .expect("Tauri build failed");
}
