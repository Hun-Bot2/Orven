fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "bootstrap",
            "register_project",
            "select_project",
            "list_runs",
            "read_report",
            "run_audit",
            "gateway_snapshot",
            "gateway_control",
            "account_snapshot",
            "account_begin",
            "account_poll",
            "account_cancel",
            "account_logout",
        ]),
    ))
    .expect("Tauri build configuration failed");
}
