use audit_core::{
    gateway::{Control, Scope, control},
    workspace::Workspace,
};
use git2::{IndexAddOption, Repository, Signature};
use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    time::{Duration, Instant},
};
use tempfile::TempDir;

struct Client {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Receiver<String>,
    next: u64,
}
impl Client {
    fn start(profile: &Path) -> Self {
        Self::start_version(profile, "2025-11-25")
    }
    fn start_version(profile: &Path, revision: &str) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_audit-host"))
            .arg("mcp")
            .arg(profile)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        let mut c = Self {
            child,
            stdin: Some(stdin),
            lines,
            next: 1,
        };
        let result=c.request("initialize",json!({"protocolVersion":revision,"capabilities":{},"clientInfo":{"name":"synthetic-test","version":"1"}}));
        assert_eq!(
            result["result"]["protocolVersion"], revision,
            "requested revision {revision}: {result}"
        );
        c.send(json!({"jsonrpc":"2.0","method":"notifications/initialized"}));
        c
    }
    fn send(&mut self, v: Value) {
        let stdin = self.stdin.as_mut().unwrap();
        writeln!(stdin, "{v}").unwrap();
        stdin.flush().unwrap();
    }
    fn request(&mut self, method: &str, params: Value) -> Value {
        let id = self.next;
        self.next += 1;
        self.send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}));
        loop {
            let line = self
                .lines
                .recv_timeout(Duration::from_secs(20))
                .expect("MCP response timeout");
            let v: Value =
                serde_json::from_str(&line).expect("protocol stdout must contain JSON only");
            if v["id"] == id {
                return v;
            }
        }
    }
    fn tool(&mut self, name: &str, args: Value) -> Value {
        let v = self.request("tools/call", json!({"name":name,"arguments":args}));
        assert!(v.get("error").is_none(), "{v}");
        v["result"]["structuredContent"].clone()
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
struct Fixture {
    _tmp: TempDir,
    profile: PathBuf,
    workspace: String,
    commit: String,
}
impl Fixture {
    fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("synthetic");
        let profile = tmp.path().join("profile");
        fs::create_dir(&root).unwrap();
        let repo = Repository::init(&root).unwrap();
        fs::write(root.join("README.md"), b"SYNTHETIC_SECRET_SOURCE\n").unwrap();
        let mut index = repo.index().unwrap();
        index
            .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = Signature::now("Synthetic", "fixture@example.invalid").unwrap();
        let commit = repo
            .commit(Some("HEAD"), &sig, &sig, "fixture", &tree, &[])
            .unwrap()
            .to_string();
        let mut w = Workspace::open(&profile).unwrap();
        let registered = w.register(&root).unwrap();
        let workspace = registered.active_project_id.unwrap();
        drop(w);
        Self {
            _tmp: tmp,
            profile,
            workspace,
            commit,
        }
    }
    fn grant(&self) -> audit_core::gateway::ControlReply {
        control(
            &self.profile,
            &Control::SetAccess {
                session_id: control(&self.profile, &Control::Snapshot)
                    .unwrap()
                    .snapshot
                    .unwrap()
                    .session_id,
                workspace_id: self.workspace.clone(),
                scope: Scope {
                    discover: true,
                    audit: true,
                    reports: true,
                },
            },
        )
        .unwrap()
    }
    fn decide(&self, id: &str, approve: bool) -> audit_core::gateway::ControlReply {
        control(
            &self.profile,
            &Control::Decide {
                request_id: id.into(),
                approve,
            },
        )
        .unwrap()
    }
}
fn wait_socket(profile: &Path) {
    let started = Instant::now();
    while control(profile, &Control::Snapshot).is_err() {
        assert!(started.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(20));
    }
}
#[test]
fn actual_stdio_consent_projection_revocation_and_restart() {
    let f = Fixture::new();
    let mut c = Client::start(&f.profile);
    wait_socket(&f.profile);
    let schemas = c.request("tools/list", json!({}));
    let mut names = schemas["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect::<Vec<_>>();
    names.sort();
    assert_eq!(
        names,
        vec![
            "get_audit_report",
            "get_audit_status",
            "get_workspace_summary",
            "list_workspaces",
            "start_audit"
        ]
    );
    let list = c.tool("list_workspaces", json!({}));
    assert_eq!(list["data"]["workspaces"], json!([]));
    let denied = c.tool(
        "start_audit",
        json!({"workspace_id":f.workspace,"commit":f.commit}),
    );
    assert_eq!(denied["code"], "UNAUTHORIZED");
    assert!(f.grant().ok);
    let list = c.tool("list_workspaces", json!({}));
    assert_eq!(list["data"]["workspaces"].as_array().unwrap().len(), 1);
    assert_eq!(
        c.tool(
            "get_workspace_summary",
            json!({"workspace_id":"../../outside"})
        )["code"],
        "INVALID_INPUT"
    );
    assert_eq!(
        c.tool(
            "start_audit",
            json!({"workspace_id":f.workspace,"commit":"bad"})
        )["code"],
        "INVALID_INPUT"
    );
    assert_eq!(
        c.tool("list_workspaces", json!({"unexpected":true}))["code"],
        "INVALID_INPUT"
    );
    let request = c.tool(
        "start_audit",
        json!({"workspace_id":f.workspace,"commit":f.commit,"task_context":"private context"}),
    );
    assert_eq!(request["data"]["consent"], "pending");
    let request_id = request["data"]["request_id"].as_str().unwrap().to_string();
    let snap = control(&f.profile, &Control::Snapshot)
        .unwrap()
        .snapshot
        .unwrap();
    let brief = snap.briefs.iter().find(|b| b.id == request_id).unwrap();
    assert!(
        !serde_json::to_string(brief)
            .unwrap()
            .contains("private context")
    );
    assert!(f.decide(&request_id, true).ok);
    let started = Instant::now();
    let report_id = loop {
        let result = c.tool(
            "start_audit",
            json!({"workspace_id":f.workspace,"commit":f.commit,"task_context":"private context","request_id":request_id}),
        );
        if let Some(execution) = result["data"]["execution_id"].as_str() {
            let status = c.tool(
                "get_audit_status",
                json!({"workspace_id":f.workspace,"execution_id":execution}),
            );
            if status["data"]["status"] == "complete" {
                break status["data"]["report_id"].as_str().unwrap().to_string();
            }
            assert!(
                !matches!(
                    status["data"]["status"].as_str(),
                    Some("failed" | "timed_out" | "revoked")
                ),
                "{status}"
            );
        }
        assert!(
            started.elapsed() < Duration::from_secs(20),
            "audit timed out"
        );
        std::thread::sleep(Duration::from_millis(50));
    };
    let publish = c.tool(
        "get_audit_report",
        json!({"workspace_id":f.workspace,"run_id":report_id}),
    );
    let publish_id = publish["data"]["request_id"].as_str().unwrap().to_string();
    assert_eq!(publish["data"]["consent"], "pending");
    let snap = control(&f.profile, &Control::Snapshot)
        .unwrap()
        .snapshot
        .unwrap();
    let preview = snap
        .briefs
        .iter()
        .find(|b| b.id == publish_id)
        .unwrap()
        .outbound_preview
        .clone()
        .unwrap();
    assert!(f.decide(&publish_id, true).ok);
    let sent = c.tool(
        "get_audit_report",
        json!({"workspace_id":f.workspace,"run_id":report_id,"request_id":publish_id}),
    );
    assert_eq!(sent["data"], preview);
    let text = sent.to_string();
    assert!(!text.contains("SYNTHETIC_SECRET_SOURCE"));
    assert!(!text.contains("README.md"));
    assert_eq!(
        c.tool(
            "get_audit_report",
            json!({"workspace_id":f.workspace,"run_id":report_id,"request_id":publish_id})
        )["code"],
        "CONSENT_REQUIRED"
    );
    let pending = c.tool(
        "get_audit_report",
        json!({"workspace_id":f.workspace,"run_id":report_id}),
    );
    let old = pending["data"]["request_id"].as_str().unwrap();
    assert!(
        control(
            &f.profile,
            &Control::Revoke {
                workspace_id: f.workspace.clone()
            }
        )
        .unwrap()
        .ok
    );
    assert!(f.grant().ok);
    assert!(!f.decide(old, true).ok);
    assert_eq!(
        c.tool(
            "get_audit_report",
            json!({"workspace_id":f.workspace,"run_id":report_id,"request_id":old})
        )["code"],
        "STALE_CONSENT"
    );
    drop(c);
    let mut restarted = Client::start(&f.profile);
    assert_eq!(
        restarted.tool("list_workspaces", json!({}))["data"]["workspaces"],
        json!([])
    );
}

fn await_exit(child: &mut Child) -> std::process::ExitStatus {
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            return status;
        }
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "child did not exit"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn denial_never_starts_worker_and_graceful_eof_cleans_socket() {
    let f = Fixture::new();
    let mut c = Client::start(&f.profile);
    assert!(f.grant().ok);
    let request = c.tool(
        "start_audit",
        json!({"workspace_id":f.workspace,"commit":f.commit}),
    );
    let id = request["data"]["request_id"].as_str().unwrap();
    assert!(f.decide(id, false).ok);
    std::thread::sleep(Duration::from_millis(250));
    let snapshot = control(&f.profile, &Control::Snapshot)
        .unwrap()
        .snapshot
        .unwrap();
    let brief = snapshot.briefs.iter().find(|b| b.id == id).unwrap();
    assert_eq!(brief.consent, "denied");
    assert_eq!(brief.status, "denied");
    assert!(brief.execution_id.is_none());
    assert!(brief.report_id.is_none());
    let workspace = Workspace::open_reader(&f.profile).unwrap();
    assert!(workspace.list_runs(&f.workspace).unwrap().runs.is_empty());
    drop(c.stdin.take());
    assert!(await_exit(&mut c.child).success());
    assert!(
        audit_core::gateway::live_session_dirs(&f.profile)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn simultaneous_clients_have_independent_scope_and_lifecycle() {
    let f = Fixture::new();
    let mut first = Client::start(&f.profile);
    let a = control(&f.profile, &Control::Snapshot)
        .unwrap()
        .snapshot
        .unwrap()
        .session_id;
    assert!(f.grant().ok);
    let mut second = Client::start(&f.profile);
    let reply = control(&f.profile, &Control::Snapshot).unwrap();
    assert_eq!(reply.sessions.len(), 2);
    let b = reply
        .sessions
        .iter()
        .find(|s| s.session_id != a)
        .unwrap()
        .session_id
        .clone();
    assert_ne!(a, b);
    assert_eq!(
        first.tool("list_workspaces", json!({}))["data"]["workspaces"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        second.tool("list_workspaces", json!({}))["data"]["workspaces"],
        json!([])
    );
    assert!(
        !control(
            &f.profile,
            &Control::ForSession {
                session_id: b.clone(),
                request: Box::new(Control::SetAccess {
                    session_id: a.clone(),
                    workspace_id: f.workspace.clone(),
                    scope: Scope {
                        discover: true,
                        audit: true,
                        reports: true
                    }
                })
            }
        )
        .unwrap()
        .ok
    );
    let grant = control(
        &f.profile,
        &Control::ForSession {
            session_id: b.clone(),
            request: Box::new(Control::SetAccess {
                session_id: b.clone(),
                workspace_id: f.workspace.clone(),
                scope: Scope {
                    discover: true,
                    audit: true,
                    reports: true,
                },
            }),
        },
    )
    .unwrap();
    assert!(grant.ok);
    let request = first.tool(
        "start_audit",
        json!({"workspace_id":f.workspace,"commit":f.commit}),
    );
    let id = request["data"]["request_id"].as_str().unwrap();
    assert!(
        !control(
            &f.profile,
            &Control::ForSession {
                session_id: b.clone(),
                request: Box::new(Control::Decide {
                    request_id: id.into(),
                    approve: true
                })
            }
        )
        .unwrap()
        .ok
    );
    assert!(
        control(
            &f.profile,
            &Control::Revoke {
                workspace_id: f.workspace.clone()
            }
        )
        .is_err(),
        "ambiguous controls must fail closed"
    );
    assert!(
        control(
            &f.profile,
            &Control::ForSession {
                session_id: a.clone(),
                request: Box::new(Control::Revoke {
                    workspace_id: f.workspace.clone()
                })
            }
        )
        .unwrap()
        .ok
    );
    assert_eq!(
        first.tool("list_workspaces", json!({}))["data"]["workspaces"],
        json!([])
    );
    assert_eq!(
        second.tool("list_workspaces", json!({}))["data"]["workspaces"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    drop(first.stdin.take());
    assert!(await_exit(&mut first.child).success());
    assert_eq!(
        control(&f.profile, &Control::Snapshot)
            .unwrap()
            .sessions
            .len(),
        1
    );
    let disconnected = control(
        &f.profile,
        &Control::ForSession {
            session_id: a,
            request: Box::new(Control::Snapshot),
        },
    )
    .unwrap();
    assert!(!disconnected.snapshot.unwrap().running);
    assert_eq!(second.tool("list_workspaces", json!({}))["code"], "OK");
}

#[test]
fn connection_cap_and_startup_errors_are_explicit() {
    let f = Fixture::new();
    let _clients = (0..8)
        .map(|_| Client::start(&f.profile))
        .collect::<Vec<_>>();
    let output = Command::new(env!("CARGO_BIN_EXE_audit-host"))
        .arg("mcp")
        .arg(&f.profile)
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("MCP_SESSION_LIMIT_REACHED")
    );
    let output = Command::new(env!("CARGO_BIN_EXE_audit-host"))
        .arg("mcp")
        .arg(f.profile.join("missing"))
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("PROFILE_UNAVAILABLE")
    );
}

#[test]
fn malformed_protocol_input_is_bounded() {
    let f = Fixture::new();
    let mut c = Client::start(&f.profile);
    let stdin = c.stdin.as_mut().unwrap();
    stdin.write_all(b"{not-json}\n").unwrap();
    stdin.flush().unwrap();
    // Invalid JSON must never be accepted as a tool call: either a JSON-RPC error or termination.
    match c.lines.recv_timeout(Duration::from_secs(5)) {
        Ok(line) => {
            let response: Value = serde_json::from_str(&line).unwrap();
            assert!(response.get("error").is_some(), "{response}");
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {}
        Err(e) => panic!("malformed input neither rejected nor terminated: {e}"),
    }
}

#[test]
fn oversized_protocol_input_is_bounded() {
    let f = Fixture::new();
    let mut c = Client::start(&f.profile);
    let stdin = c.stdin.as_mut().unwrap();
    let oversized = format!("{}\n", "x".repeat(70_000));
    let _ = stdin.write_all(oversized.as_bytes());
    let _ = stdin.flush();
    match c.lines.recv_timeout(Duration::from_secs(5)) {
        Ok(line) => {
            let response: Value = serde_json::from_str(&line).unwrap();
            assert!(response.get("error").is_some(), "{response}");
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {}
        Err(e) => panic!("oversized input neither rejected nor terminated: {e}"),
    }
}

#[test]
fn concurrent_revoke_and_approval_cannot_restore_old_consent() {
    let f = Fixture::new();
    let mut c = Client::start(&f.profile);
    assert!(f.grant().ok);
    let request = c.tool(
        "start_audit",
        json!({"workspace_id":f.workspace,"commit":f.commit,"task_context":"private-race-context"}),
    );
    let id = request["data"]["request_id"].as_str().unwrap().to_string();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
    let profile = f.profile.clone();
    let wid = f.workspace.clone();
    let b = barrier.clone();
    let revoke = std::thread::spawn(move || {
        b.wait();
        control(&profile, &Control::Revoke { workspace_id: wid }).unwrap()
    });
    let profile = f.profile.clone();
    let request_id = id.clone();
    let b = barrier.clone();
    let approval = std::thread::spawn(move || {
        b.wait();
        control(
            &profile,
            &Control::Decide {
                request_id,
                approve: true,
            },
        )
        .unwrap()
    });
    barrier.wait();
    assert!(revoke.join().unwrap().ok);
    let _ = approval.join().unwrap();
    assert!(f.grant().ok);
    assert!(!f.decide(&id, true).ok);
    assert_eq!(c.tool("start_audit",json!({"workspace_id":f.workspace,"commit":f.commit,"task_context":"private-race-context","request_id":id}))["code"],"STALE_CONSENT");
    let snapshot = control(&f.profile, &Control::Snapshot)
        .unwrap()
        .snapshot
        .unwrap();
    let old = snapshot.briefs.iter().find(|b| b.id == id).unwrap();
    assert_eq!(old.consent, "revoked");
    drop(c.stdin.take());
    assert!(await_exit(&mut c.child).success());
    let session = snapshot.session_id.clone();
    let retained = fs::read_to_string(
        f.profile
            .join(".g")
            .join(audit_core::gateway::session_key(&session).unwrap())
            .join("handoffs.json"),
    )
    .unwrap();
    assert!(!retained.contains("private-race-context"));
    let mut c = Client::start(&f.profile);
    assert!(f.grant().ok);
    assert!(!f.decide(&id, true).ok);
    assert_eq!(c.tool("start_audit",json!({"workspace_id":f.workspace,"commit":f.commit,"task_context":"private-race-context","request_id":id}))["code"],"STALE_CONSENT");
    let snapshot = control(&f.profile, &Control::Snapshot)
        .unwrap()
        .snapshot
        .unwrap();
    let retained_brief = snapshot
        .briefs
        .iter()
        .find(|b| b.id == id)
        .expect("record must survive restart");
    assert_eq!(retained_brief.consent, "revoked");
    assert_eq!(retained_brief.supplied_context["stored"], false);
    assert_eq!(retained_brief.supplied_context["bytes"], 20);
    assert!(retained_brief.supplied_context["sha256"].is_string());
    assert!(
        !serde_json::to_string(&snapshot)
            .unwrap()
            .contains("private-race-context")
    );
}

#[test]
fn legacy_protocol_revisions_negotiate_and_discover_tools() {
    for revision in ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"] {
        let f = Fixture::new();
        let mut client = Client::start_version(&f.profile, revision);
        let result = client.request("tools/list", json!({}));
        let tools = result["result"]["tools"]
            .as_array()
            .expect("tool discovery result");
        assert_eq!(tools.len(), 5, "revision {revision}: {result}");
        assert!(tools.iter().any(|tool| tool["name"] == "start_audit"));
        drop(client.stdin.take());
        assert!(await_exit(&mut client.child).success());
    }
}

#[test]
fn writer_can_reopen_and_new_project_requires_its_own_grant() {
    let f = Fixture::new();
    let mut client = Client::start(&f.profile);
    let writer = Workspace::open(&f.profile).expect("writer opens while gateway is running");
    drop(writer);
    let mut writer = Workspace::open(&f.profile).expect("writer can reopen");
    let second_root = f._tmp.path().join("second-synthetic");
    fs::create_dir(&second_root).unwrap();
    Repository::init(&second_root).unwrap();
    let registered = writer.register(&second_root).unwrap();
    let second = registered.active_project_id.unwrap();
    assert_ne!(second, f.workspace);
    drop(writer);
    assert!(f.grant().ok);
    let before = client.tool("list_workspaces", json!({}));
    let items = before["data"]["workspaces"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["workspace_id"], f.workspace);
    assert!(
        control(
            &f.profile,
            &Control::SetAccess {
                session_id: control(&f.profile, &Control::Snapshot)
                    .unwrap()
                    .snapshot
                    .unwrap()
                    .session_id,
                workspace_id: second.clone(),
                scope: Scope {
                    discover: true,
                    audit: false,
                    reports: false
                }
            }
        )
        .unwrap()
        .ok
    );
    let after = client.tool("list_workspaces", json!({}));
    let items = after["data"]["workspaces"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert!(items.iter().any(|entry| entry["workspace_id"] == second));
}
