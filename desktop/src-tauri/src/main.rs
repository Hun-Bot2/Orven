#![forbid(unsafe_code)]
mod workspace;
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::{Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use workspace::{Bootstrap, RunListing, Workspace};
struct DesktopState {
    workspace: Mutex<Workspace>,
    busy: AtomicBool,
}
fn permitted(label: &str, url: &tauri::Url) -> bool {
    label == "main"
        && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
            || (cfg!(debug_assertions)
                && url.scheme() == "http"
                && url.host_str() == Some("127.0.0.1")
                && url.port() == Some(1420)))
}
fn authorize<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    if permitted(
        window.label(),
        &window.url().map_err(|_| "Window unavailable")?,
    ) {
        Ok(())
    } else {
        Err("Window is not authorized".into())
    }
}
#[tauri::command]
fn bootstrap<R: tauri::Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, DesktopState>,
) -> Result<Bootstrap, String> {
    authorize(&window)?;
    Ok(state
        .workspace
        .lock()
        .map_err(|_| "Workspace unavailable")?
        .bootstrap())
}
#[tauri::command]
async fn register_project<R: tauri::Runtime>(
    window: WebviewWindow<R>,
    app: tauri::AppHandle<R>,
) -> Result<Option<Bootstrap>, String> {
    authorize(&window)?;
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Register a read-only repository")
            .blocking_pick_folder()
    })
    .await
    .map_err(|_| "Folder dialog failed")?;
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let root = chosen.into_path().map_err(|_| "Local folder required")?;
    let state = window.state::<DesktopState>();
    let result = state
        .workspace
        .lock()
        .map_err(|_| "Workspace unavailable")?
        .register(&root)?;
    Ok(Some(result))
}
#[tauri::command]
fn select_project<R: tauri::Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, DesktopState>,
    project_id: String,
) -> Result<Bootstrap, String> {
    authorize(&window)?;
    state
        .workspace
        .lock()
        .map_err(|_| "Workspace unavailable")?
        .select(&project_id)
}
#[tauri::command]
async fn list_runs<R: tauri::Runtime>(
    window: WebviewWindow<R>,
    app: tauri::AppHandle<R>,
    project_id: String,
) -> Result<RunListing, String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<DesktopState>()
            .workspace
            .lock()
            .map_err(|_| "Workspace unavailable")?
            .list_runs(&project_id)
    })
    .await
    .map_err(|_| "Report listing failed")?
}
#[tauri::command]
async fn read_report<R: tauri::Runtime>(
    window: WebviewWindow<R>,
    app: tauri::AppHandle<R>,
    project_id: String,
    run_id: String,
) -> Result<audit_core::Report, String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<DesktopState>()
            .workspace
            .lock()
            .map_err(|_| "Workspace unavailable")?
            .read_report(&project_id, &run_id)
    })
    .await
    .map_err(|_| "Report loading failed")?
}
#[tauri::command]
async fn run_audit<R: tauri::Runtime>(
    window: WebviewWindow<R>,
    app: tauri::AppHandle<R>,
    project_id: String,
    commit: String,
) -> Result<String, String> {
    authorize(&window)?;
    let state = app.state::<DesktopState>();
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err("An audit is already running".into());
    }
    // The async task owns reset through all normal/error/unwind exits.
    struct Reset<R: tauri::Runtime>(tauri::AppHandle<R>);
    impl<R: tauri::Runtime> Drop for Reset<R> {
        fn drop(&mut self) {
            self.0
                .state::<DesktopState>()
                .busy
                .store(false, Ordering::SeqCst);
        }
    }
    let reset = Reset(app.clone());
    tauri::async_runtime::spawn_blocking(move || {
        let _reset = reset;
        let reg = app
            .state::<DesktopState>()
            .workspace
            .lock()
            .map_err(|_| "Workspace unavailable")?
            .prepare_audit(&project_id)?;
        let report = reg.audit(&commit).map_err(|e| e.to_string())?;
        reg.save(&report).map_err(|e| e.to_string())?;
        Ok(report.run_id)
    })
    .await
    .map_err(|_| "Audit interrupted; incomplete output is not a completed report")?
}
fn context<R: tauri::Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let base = if cfg!(debug_assertions) {
                std::env::var_os("ORVEN_DEV_DATA_DIR")
                    .map(std::path::PathBuf::from)
                    .unwrap_or(app.path().app_data_dir()?)
            } else {
                app.path().app_data_dir()?
            };
            if let Some(parent) = base.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let workspace = Workspace::open(&base).map_err(std::io::Error::other)?;
            app.manage(DesktopState {
                workspace: Mutex::new(workspace),
                busy: AtomicBool::new(false),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            register_project,
            select_project,
            list_runs,
            read_report,
            run_audit
        ])
        .run(context())
        .expect("Orven native application failed");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn actual_tauri_ipc_allows_main_and_denies_other_window() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("repo");
        std::fs::create_dir(&root).unwrap();
        let git = git2::Repository::init(&root).unwrap();
        let blob = git.blob(b"native command fixture\n").unwrap();
        let mut builder = git.treebuilder(None).unwrap();
        builder.insert("README.md", blob, 0o100644).unwrap();
        let tree = git.find_tree(builder.write().unwrap()).unwrap();
        let signature = git2::Signature::now("Fixture", "fixture@example.invalid").unwrap();
        let commit = git
            .commit(Some("HEAD"), &signature, &signature, "fixture", &tree, &[])
            .unwrap()
            .to_string();
        let mut workspace = Workspace::open(&temp.path().join("profile")).unwrap();
        let project = workspace
            .register(&root)
            .unwrap()
            .active_project_id
            .unwrap();
        let other_root = temp.path().join("other-repo");
        std::fs::create_dir(&other_root).unwrap();
        git2::Repository::init(&other_root).unwrap();
        let second_project = workspace
            .register(&other_root)
            .unwrap()
            .active_project_id
            .unwrap();
        workspace.select(&project).unwrap();
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_dialog::init())
            .manage(DesktopState {
                workspace: Mutex::new(workspace),
                busy: AtomicBool::new(false),
            })
            .invoke_handler(tauri::generate_handler![
                bootstrap,
                select_project,
                list_runs,
                read_report,
                run_audit
            ])
            .build(context())
            .unwrap();
        let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let other = tauri::WebviewWindowBuilder::new(&app, "other", Default::default())
            .build()
            .unwrap();
        fn request() -> tauri::webview::InvokeRequest {
            tauri::webview::InvokeRequest {
                cmd: "bootstrap".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: Default::default(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            }
        }
        let allowed = tauri::test::get_ipc_response(&main, request());
        assert!(allowed.is_ok(), "main IPC failed: {allowed:?}");
        let denied = tauri::test::get_ipc_response(&other, request());
        assert!(denied.is_err());
        let mut remote = request();
        remote.url = "https://example.com".parse().unwrap();
        assert!(tauri::test::get_ipc_response(&main, remote).is_err());
        let mut forbidden_dialog = request();
        forbidden_dialog.cmd = "plugin:dialog|open".into();
        forbidden_dialog.body = tauri::ipc::InvokeBody::Json(serde_json::json!({"options":{}}));
        let dialog_error = tauri::test::get_ipc_response(&main, forbidden_dialog).unwrap_err();
        assert!(
            dialog_error.to_string().contains("not allowed"),
            "expected ACL denial: {dialog_error}"
        );
        let mut invalid_audit = request();
        invalid_audit.cmd = "run_audit".into();
        invalid_audit.body = tauri::ipc::InvokeBody::Json(
            serde_json::json!({"projectId":project,"commit":"invalid"}),
        );
        assert!(tauri::test::get_ipc_response(&main, invalid_audit).is_err());
        assert!(!app.state::<DesktopState>().busy.load(Ordering::SeqCst));
        let mut execute = request();
        execute.cmd = "run_audit".into();
        execute.body =
            tauri::ipc::InvokeBody::Json(serde_json::json!({"projectId":project,"commit":commit}));
        let run_id: String = tauri::test::get_ipc_response(&main, execute)
            .unwrap()
            .deserialize()
            .unwrap();
        let mut read = request();
        read.cmd = "read_report".into();
        read.body =
            tauri::ipc::InvokeBody::Json(serde_json::json!({"projectId":project,"runId":run_id}));
        let report: audit_core::Report = tauri::test::get_ipc_response(&main, read)
            .unwrap()
            .deserialize()
            .unwrap();
        assert_eq!(report.evidence[0].content, "native command fixture\n");
        assert_eq!(report.commit, commit);
        let mut switch = request();
        switch.cmd = "select_project".into();
        switch.body = tauri::ipc::InvokeBody::Json(serde_json::json!({"projectId":second_project}));
        let selected: serde_json::Value = tauri::test::get_ipc_response(&main, switch)
            .unwrap()
            .deserialize()
            .unwrap();
        assert_eq!(selected["active_project_id"], second_project);
        let mut cross_project = request();
        cross_project.cmd = "read_report".into();
        cross_project.body = tauri::ipc::InvokeBody::Json(
            serde_json::json!({"projectId":second_project,"runId":run_id}),
        );
        assert!(tauri::test::get_ipc_response(&main, cross_project).is_err());

        let mut denied_read = request();
        denied_read.cmd = "read_report".into();
        denied_read.body = tauri::ipc::InvokeBody::Json(
            serde_json::json!({"projectId":project,"runId":"../registry.json"}),
        );
        assert!(tauri::test::get_ipc_response(&main, denied_read).is_err());
    }
    #[test]
    fn window_origin_policy_denies_other_windows_and_remote_content() {
        assert!(permitted(
            "main",
            &"tauri://localhost/index.html".parse().unwrap()
        ));
        assert!(!permitted(
            "other",
            &"tauri://localhost/index.html".parse().unwrap()
        ));
        assert!(!permitted("main", &"https://example.com".parse().unwrap()));
        assert!(!permitted(
            "main",
            &"http://127.0.0.1:3000".parse().unwrap()
        ));
    }
}
