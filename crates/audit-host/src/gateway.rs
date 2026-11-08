use audit_core::{
    gateway::{Access, Brief, Control, ControlReply, MAX_MESSAGE, Snapshot},
    workspace::Workspace,
};
use rmcp::{RoleServer, ServerHandler, ServiceExt, model::*, service::RequestContext};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    os::unix::{
        fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
        net::UnixListener,
    },
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_secs())
        .unwrap_or(0)
}
fn digest(value: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(value))
}
fn output(code: &str, data: Value) -> Value {
    json!({"ok":code=="OK","code":code,"data":data})
}
fn error(code: &str) -> Value {
    output(code, json!({}))
}
fn id(s: &str) -> bool {
    Uuid::parse_str(s).is_ok_and(|v| v.to_string() == s)
}
fn identity(path: &Path) -> Result<String, String> {
    let a = fs::symlink_metadata(path).map_err(|_| "WORKSPACE_UNAVAILABLE")?;
    let b = fs::symlink_metadata(path.join(".git")).map_err(|_| "WORKSPACE_UNAVAILABLE")?;
    if !a.is_dir() || !b.is_dir() || a.file_type().is_symlink() || b.file_type().is_symlink() {
        return Err("UNSAFE_ROOT".into());
    }
    Ok(format!("{}:{}:{}:{}", a.dev(), a.ino(), b.dev(), b.ino()))
}
#[derive(Deserialize, Serialize, Default)]
#[serde(deny_unknown_fields)]
struct ListArgs {
    #[serde(default)]
    cursor: usize,
    #[serde(default = "default_limit")]
    limit: usize,
}
fn default_limit() -> usize {
    10
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct WorkspaceArgs {
    workspace_id: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AuditArgs {
    workspace_id: String,
    commit: String,
    #[serde(default)]
    task_context: Option<String>,
    #[serde(default)]
    request_id: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StatusArgs {
    workspace_id: String,
    execution_id: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ReportArgs {
    workspace_id: String,
    run_id: String,
    #[serde(default)]
    request_id: Option<String>,
}
#[derive(Clone)]
struct Data {
    profile: PathBuf,
    state_dir: PathBuf,
    session: String,
    epoch: u64,
    access: HashMap<String, Access>,
    briefs: Vec<Brief>,
    client: String,
}
impl Data {
    fn workspace(&self) -> Result<Workspace, String> {
        Workspace::open_reader(&self.profile)
    }
    fn allowed(&self, workspace: &str, cap: &str) -> Result<&Access, String> {
        if !id(workspace) {
            return Err("INVALID_INPUT".into());
        }
        let a = self.access.get(workspace).ok_or("UNAUTHORIZED")?;
        let yes = match cap {
            "audit" => a.scope.audit,
            "reports" => a.scope.reports,
            _ => a.scope.discover,
        };
        if !yes {
            return Err("UNAUTHORIZED".into());
        }
        let (root, _) = self.workspace()?.audit_paths(workspace)?;
        if identity(&root)? != a.root_identity {
            return Err("ROOT_CHANGED".into());
        }
        Ok(a)
    }
    fn prune(&mut self) {
        self.briefs
            .retain(|r| now().saturating_sub(r.created) < 86400);
    }
    fn snapshot(&mut self) -> Snapshot {
        self.prune();
        Snapshot {
            running: true,
            session_id: self.session.clone(),
            transport: "stdio".into(),
            client: self.client.clone(),
            access: self.access.values().cloned().collect(),
            briefs: self.briefs.iter().rev().cloned().collect(),
        }
    }
    fn save(&self) -> Result<(), String> {
        let bytes = serde_json::to_vec(&self.briefs).map_err(|_| "UNAVAILABLE")?;
        if bytes.len() > MAX_MESSAGE {
            return Err("UNAVAILABLE".into());
        }
        let dir = cap_std::fs::Dir::open_ambient_dir(&self.state_dir, cap_std::ambient_authority())
            .map_err(|_| "UNAVAILABLE")?;
        let p = format!(".handoffs-{}", Uuid::new_v4());
        use cap_std::fs::OpenOptionsExt;
        let mut opts = cap_std::fs::OpenOptions::new();
        opts.write(true).create_new(true).mode(0o600);
        let result = (|| -> std::io::Result<()> {
            let mut f = dir.open_with(&p, &opts)?;
            f.write_all(&bytes)?;
            f.sync_all()?;
            dir.rename(&p, &dir, "handoffs.json")?;
            dir.try_clone()?.into_std_file().sync_all()
        })();
        if result.is_err() {
            let _ = dir.remove_file(&p);
            return Err("UNAVAILABLE".into());
        }
        Ok(())
    }
    fn add(
        &mut self,
        workspace: String,
        tool: &str,
        args: Value,
        context: Option<&str>,
        epoch: u64,
        preview: Option<Value>,
    ) -> Result<String, String> {
        self.prune();
        if self.briefs.len() >= 16 {
            let pos = self
                .briefs
                .iter()
                .position(|b| {
                    !matches!(b.status.as_str(), "queued" | "running" | "awaiting_consent")
                })
                .ok_or("QUEUE_FULL")?;
            self.briefs.remove(pos);
        }
        let request = Uuid::new_v4().to_string();
        let context_info = json!({"present":context.is_some(),"bytes":context.map(str::len).unwrap_or(0),"sha256":context.map(|s|digest(s.as_bytes())),"stored":false});
        let mut original = args.clone();
        if let Some(obj) = original.as_object_mut() {
            obj.remove("request_id");
        }
        original.sort_all_objects();
        let hash = digest(&serde_json::to_vec(&original).map_err(|_| "INVALID_INPUT")?);
        let mut canonical = original;
        if let Some(obj) = canonical.as_object_mut()
            && obj.contains_key("task_context")
        {
            obj.insert("task_context".into(), context_info.clone());
        }
        let objective = if tool == "start_audit" {
            format!(
                "Inspect committed snapshot {} using committed-text-v1",
                args["commit"].as_str().unwrap_or("")
            )
        } else {
            "Transmit the exact approved, source-free report projection".into()
        };
        self.briefs.push(Brief {
            id: request.clone(),
            workspace_id: Some(workspace),
            tool: tool.into(),
            source_client: self.client.clone(),
            source_identity: self.session.clone(),
            supplied_context: context_info,
            received_payload_redacted: canonical.clone(),
            validated_arguments_sha256: hash,
            objective,
            consent: "pending".into(),
            status: "awaiting_consent".into(),
            created: now(),
            epoch,
            execution_id: None,
            report_id: args
                .get("run_id")
                .and_then(Value::as_str)
                .map(str::to_string),
            outbound_sha256: preview
                .as_ref()
                .map(|v| digest(&serde_json::to_vec(v).unwrap_or_default())),
            outbound_preview: preview,
            trace: vec![
                "validated_arguments_received".into(),
                "application_consent_required".into(),
            ],
        });
        Ok(request)
    }
    fn decide(&mut self, request: &str, approve: bool) -> Result<(), String> {
        let index = self
            .briefs
            .iter()
            .position(|r| r.id == request)
            .ok_or("NOT_FOUND")?;
        let brief = &self.briefs[index];
        let wid = brief.workspace_id.clone().ok_or("INVALID_INPUT")?;
        let cap = if brief.tool == "start_audit" {
            "audit"
        } else {
            "reports"
        };
        let epoch = self.allowed(&wid, cap)?.epoch;
        if brief.source_identity != self.session
            || brief.epoch != epoch
            || brief.consent != "pending"
            || now().saturating_sub(brief.created) >= 86400
        {
            return Err("STALE_CONSENT".into());
        }
        let r = &mut self.briefs[index];
        r.consent = if approve { "approved" } else { "denied" }.into();
        r.status = if approve && r.tool == "start_audit" {
            "queued"
        } else if approve {
            "awaiting_transmission"
        } else {
            "denied"
        }
        .into();
        if approve && r.tool == "start_audit" {
            r.execution_id = Some(Uuid::new_v4().to_string());
        }
        r.trace.push(format!("application_{}", r.consent));
        Ok(())
    }
    fn revoke(&mut self, workspace: &str) {
        self.access.remove(workspace);
        self.epoch += 1;
        for r in &mut self.briefs {
            if r.workspace_id.as_deref() == Some(workspace)
                && !matches!(r.consent.as_str(), "denied" | "revoked")
            {
                r.consent = "revoked".into();
                if !matches!(r.status.as_str(), "complete" | "released") {
                    r.status = "revoked".into();
                }
                r.outbound_preview = None;
                r.trace.push("workspace_access_revoked".into());
            }
        }
    }
    fn control(&mut self, request: Control) -> ControlReply {
        let before = self.clone();
        let response = self.apply_control(request);
        if self.save().is_ok() {
            return response;
        }
        *self = before;
        let workspaces = self.access.keys().cloned().collect::<Vec<_>>();
        for wid in workspaces {
            self.revoke(&wid);
        }
        ControlReply {
            sessions: vec![],
            ok: false,
            code: "UNAVAILABLE".into(),
            snapshot: None,
        }
    }
    fn apply_control(&mut self, request: Control) -> ControlReply {
        let result: Result<(), String> = (|| {
            match request {
                Control::Snapshot => {}
                Control::ForSession { .. } => return Err("INVALID_INPUT".into()),
                Control::SetAccess {
                    workspace_id,
                    scope,
                    session_id,
                } => {
                    if session_id != self.session {
                        return Err("STALE_CONSENT".into());
                    }
                    if !id(&workspace_id) {
                        return Err("INVALID_INPUT".into());
                    }
                    let (root, _) = self.workspace()?.audit_paths(&workspace_id)?;
                    let root_identity = identity(&root)?;
                    self.revoke(&workspace_id);
                    self.access.insert(
                        workspace_id.clone(),
                        Access {
                            workspace_id,
                            scope,
                            epoch: self.epoch,
                            root_identity,
                        },
                    );
                }
                Control::Revoke { workspace_id } => {
                    if !id(&workspace_id) {
                        return Err("INVALID_INPUT".into());
                    }
                    self.revoke(&workspace_id);
                }
                Control::Decide {
                    request_id,
                    approve,
                } => self.decide(&request_id, approve)?,
            }
            Ok(())
        })();
        match result {
            Ok(()) => ControlReply {
                sessions: vec![],
                ok: true,
                code: "OK".into(),
                snapshot: Some(self.snapshot()),
            },
            Err(_) => ControlReply {
                sessions: vec![],
                ok: false,
                code: "CONTROL_REJECTED".into(),
                snapshot: None,
            },
        }
    }
    fn tool(&mut self, name: &str, args: Value) -> Value {
        self.prune();
        let result: Result<Value, String> = (|| {
            if serde_json::to_vec(&args)
                .map_err(|_| "INVALID_INPUT")?
                .len()
                > 4096
            {
                return Err("INPUT_TOO_LARGE".into());
            }
            match name {
                "list_workspaces" => {
                    let a: ListArgs = serde_json::from_value(args).map_err(|_| "INVALID_INPUT")?;
                    if a.limit == 0 || a.limit > 20 || a.cursor > 64 {
                        return Err("INVALID_INPUT".into());
                    }
                    let w = self.workspace()?;
                    let mut list = vec![];
                    for p in w.bootstrap().projects {
                        if self.allowed(&p.id, "discover").is_ok() {
                            list.push(json!({"workspace_id":p.id,"name":p.name.chars().take(80).collect::<String>()}));
                        }
                    }
                    list.sort_by_key(|p| p["workspace_id"].as_str().unwrap_or("").to_string());
                    let next = if a.cursor + a.limit < list.len() {
                        Some(a.cursor + a.limit)
                    } else {
                        None
                    };
                    Ok(
                        json!({"workspaces":list.into_iter().skip(a.cursor).take(a.limit).collect::<Vec<_>>(),"next_cursor":next}),
                    )
                }
                "get_workspace_summary" => {
                    let a: WorkspaceArgs =
                        serde_json::from_value(args).map_err(|_| "INVALID_INPUT")?;
                    self.allowed(&a.workspace_id, "discover")?;
                    let runs = self.workspace()?.list_runs(&a.workspace_id)?;
                    Ok(
                        json!({"workspace_id":a.workspace_id,"valid_runs":runs.runs.len(),"unavailable_runs":runs.unavailable,"incomplete_runs":runs.incomplete,"policy":"committed-text-v1","execution":"no_repository_commands"}),
                    )
                }
                "start_audit" => {
                    let a: AuditArgs =
                        serde_json::from_value(args.clone()).map_err(|_| "INVALID_INPUT")?;
                    let epoch = self.allowed(&a.workspace_id, "audit")?.epoch;
                    if a.commit.len() != 40
                        || !a.commit.bytes().all(|c| c.is_ascii_hexdigit())
                        || a.task_context.as_ref().is_some_and(|s| s.len() > 512)
                    {
                        return Err("INVALID_INPUT".into());
                    }
                    if a.request_id.as_deref().is_some_and(|v| !id(v)) {
                        return Err("INVALID_INPUT".into());
                    }
                    if let Some(request) = a.request_id {
                        let mut canonical = args.clone();
                        canonical.as_object_mut().unwrap().remove("request_id");
                        canonical.sort_all_objects();
                        let hash =
                            digest(&serde_json::to_vec(&canonical).map_err(|_| "INVALID_INPUT")?);
                        let r = self
                            .briefs
                            .iter()
                            .find(|r| {
                                r.id == request
                                    && r.workspace_id.as_deref() == Some(&a.workspace_id)
                                    && r.tool == name
                                    && r.validated_arguments_sha256 == hash
                                    && r.received_payload_redacted["commit"] == a.commit
                                    && r.epoch == epoch
                                    && r.source_identity == self.session
                            })
                            .ok_or("STALE_CONSENT")?;
                        Ok(
                            json!({"request_id":r.id,"consent":r.consent,"status":r.status,"execution_id":r.execution_id}),
                        )
                    } else {
                        let request = self.add(
                            a.workspace_id,
                            name,
                            args,
                            a.task_context.as_deref(),
                            epoch,
                            None,
                        )?;
                        Ok(
                            json!({"request_id":request,"consent":"pending","status":"awaiting_consent","execution_id":null}),
                        )
                    }
                }
                "get_audit_status" => {
                    let a: StatusArgs =
                        serde_json::from_value(args).map_err(|_| "INVALID_INPUT")?;
                    let epoch = self.allowed(&a.workspace_id, "audit")?.epoch;
                    if !id(&a.execution_id) {
                        return Err("INVALID_INPUT".into());
                    }
                    let r = self
                        .briefs
                        .iter()
                        .find(|r| {
                            r.execution_id.as_deref() == Some(&a.execution_id)
                                && r.workspace_id.as_deref() == Some(&a.workspace_id)
                                && r.epoch == epoch
                                && r.source_identity == self.session
                        })
                        .ok_or("NOT_FOUND")?;
                    Ok(
                        json!({"execution_id":r.execution_id,"status":r.status,"report_id":r.report_id}),
                    )
                }
                "get_audit_report" => {
                    let a: ReportArgs =
                        serde_json::from_value(args.clone()).map_err(|_| "INVALID_INPUT")?;
                    let epoch = self.allowed(&a.workspace_id, "reports")?.epoch;
                    if !id(&a.run_id) {
                        return Err("INVALID_INPUT".into());
                    }
                    if a.request_id.as_deref().is_some_and(|v| !id(v)) {
                        return Err("INVALID_INPUT".into());
                    }
                    if let Some(request) = a.request_id {
                        let r = self
                            .briefs
                            .iter_mut()
                            .find(|r| {
                                r.id == request
                                    && r.workspace_id.as_deref() == Some(&a.workspace_id)
                                    && r.report_id.as_deref() == Some(&a.run_id)
                                    && r.tool == name
                                    && r.epoch == epoch
                                    && r.source_identity == self.session
                            })
                            .ok_or("STALE_CONSENT")?;
                        if r.consent != "approved" || r.status != "awaiting_transmission" {
                            return Err("CONSENT_REQUIRED".into());
                        }
                        let payload = r.outbound_preview.take().ok_or("CONSENT_REQUIRED")?;
                        r.status = "released".into();
                        r.trace.push("projection_committed_for_transmission".into());
                        Ok(payload)
                    } else {
                        let r = self.workspace()?.read_report(&a.workspace_id, &a.run_id)?;
                        let preview = json!({"schema_version":1,"workspace_id":a.workspace_id,"run_id":r.run_id,"commit":r.commit,"manifest_sha256":r.manifest_sha256,"captured_unix_seconds":r.captured_unix_seconds,"evidence_count":r.evidence.len(),"exclusion_records":r.exclusions.len(),"observation_count":r.findings.len(),"execution_status":r.execution_status,"analysis_status":r.analysis_status,"source_content":"not_transmitted","paths":"not_transmitted"});
                        let request =
                            self.add(a.workspace_id, name, args, None, epoch, Some(preview))?;
                        Ok(
                            json!({"request_id":request,"consent":"pending","status":"awaiting_consent"}),
                        )
                    }
                }
                _ => Err("UNKNOWN_TOOL".into()),
            }
        })();
        match result {
            Ok(data) => output("OK", data),
            Err(code) => {
                let safe = match code.as_str() {
                    "UNAUTHORIZED" | "INVALID_INPUT" | "INPUT_TOO_LARGE" | "ROOT_CHANGED"
                    | "STALE_CONSENT" | "CONSENT_REQUIRED" | "NOT_FOUND" | "QUEUE_FULL"
                    | "UNKNOWN_TOOL" => code.as_str(),
                    _ => "UNAVAILABLE",
                };
                error(safe)
            }
        }
    }
}
#[derive(Clone)]
struct Gateway {
    data: Arc<Mutex<Data>>,
}
fn object_schema(properties: Value) -> Value {
    let required = properties
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    json!({"type":"object","properties":properties,"required":required,"additionalProperties":false})
}
fn result_schema(name: &str) -> Value {
    let uuid = json!({"type":"string","format":"uuid","maxLength":36});
    let count = json!({"type":"integer","minimum":0});
    let text = json!({"type":"string"});
    let nullable = json!({"type":["string","null"]});
    match name {
        "list_workspaces" => object_schema(
            json!({"workspaces":{"type":"array","maxItems":20,"items":object_schema(json!({"workspace_id":uuid,"name":{"type":"string","maxLength":80}}))},"next_cursor":{"type":["integer","null"],"minimum":0,"maximum":64}}),
        ),
        "get_workspace_summary" => object_schema(
            json!({"workspace_id":uuid,"valid_runs":count,"unavailable_runs":count,"incomplete_runs":count,"policy":{"const":"committed-text-v1"},"execution":{"const":"no_repository_commands"}}),
        ),
        "start_audit" => object_schema(
            json!({"request_id":uuid,"consent":text,"status":text,"execution_id":nullable}),
        ),
        "get_audit_status" => {
            object_schema(json!({"execution_id":uuid,"status":text,"report_id":nullable}))
        }
        _ => {
            json!({"oneOf":[object_schema(json!({"request_id":uuid,"consent":text,"status":text})),object_schema(json!({"schema_version":{"const":1},"workspace_id":uuid,"run_id":uuid,"commit":{"type":"string","pattern":"^[a-f0-9]{40}$"},"manifest_sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"captured_unix_seconds":count,"evidence_count":count,"exclusion_records":count,"observation_count":count,"execution_status":text,"analysis_status":text,"source_content":{"const":"not_transmitted"},"paths":{"const":"not_transmitted"}}))]})
        }
    }
}
fn schemas() -> Vec<Tool> {
    let uuid = json!({"type":"string","format":"uuid","maxLength":36});
    let mut out = vec![];
    for (name, description, properties, required) in [
        (
            "list_workspaces",
            "List only workspaces approved for this session; no paths.",
            json!({"cursor":{"type":"integer","minimum":0,"maximum":64},"limit":{"type":"integer","minimum":1,"maximum":20}}),
            vec![],
        ),
        (
            "get_workspace_summary",
            "Read approved workspace metadata, never source files.",
            json!({"workspace_id":uuid}),
            vec!["workspace_id"],
        ),
        (
            "start_audit",
            "Request an immutable snapshot audit. Application approval is required for each exact operation; host approval is insufficient.",
            json!({"workspace_id":uuid,"commit":{"type":"string","pattern":"^[a-fA-F0-9]{40}$"},"task_context":{"type":"string","maxLength":512},"request_id":uuid}),
            vec!["workspace_id", "commit"],
        ),
        (
            "get_audit_status",
            "Read status for an authorized execution in the approved workspace.",
            json!({"workspace_id":uuid,"execution_id":uuid}),
            vec!["workspace_id", "execution_id"],
        ),
        (
            "get_audit_report",
            "Request explicit approval of a frozen source-free report projection. Retry with request_id after approval. One transmission per consent.",
            json!({"workspace_id":uuid,"run_id":uuid,"request_id":uuid}),
            vec!["workspace_id", "run_id"],
        ),
    ] {
        let input = json!({"type":"object","properties":properties,"required":required,"additionalProperties":false});
        let mut tool = Tool::new(name, description, input.as_object().unwrap().clone());
        tool.output_schema=Some(Arc::new(json!({"type":"object","required":["ok","code","data"],"additionalProperties":false,"properties":{"ok":{"type":"boolean"},"code":{"type":"string","enum":["OK","UNAUTHORIZED","INVALID_INPUT","INPUT_TOO_LARGE","ROOT_CHANGED","STALE_CONSENT","CONSENT_REQUIRED","NOT_FOUND","QUEUE_FULL","UNKNOWN_TOOL","UNAVAILABLE"]},"data":{"anyOf":[result_schema(name),{"type":"object","maxProperties":0}]}}}).as_object().unwrap().clone()));
        let mut annotations = ToolAnnotations::default();
        annotations.read_only_hint = Some(!matches!(name, "start_audit" | "get_audit_report"));
        annotations.destructive_hint = Some(false);
        annotations.open_world_hint = Some(false);
        tool.annotations = Some(annotations);
        out.push(tool);
    }
    out
}
fn client_label(name: &str) -> String {
    let claimed = name.to_ascii_lowercase();
    if claimed.contains("claude") {
        "Claude (self-reported)"
    } else if claimed.contains("codex") {
        "Codex (self-reported)"
    } else if claimed.contains("chatgpt") {
        "ChatGPT (self-reported)"
    } else {
        "MCP client (unverified)"
    }
    .into()
}
impl ServerHandler for Gateway {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build()).with_server_info(Implementation::new("orven",env!("CARGO_PKG_VERSION"))).with_instructions("Only explicitly granted workspaces are visible. Audits require local application consent per exact commit. Reports require preview and separate consent, then retry with request_id. No shell, source reader, or conversation-history retrieval is available.")
    }
    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        if let Some(peer) = context.peer.peer_info()
            && let Ok(mut d) = self.data.lock()
        {
            d.client = client_label(&peer.client_info.name);
        }
        Ok(ListToolsResult {
            tools: schemas(),
            ..Default::default()
        })
    }
    fn get_tool(&self, name: &str) -> Option<Tool> {
        schemas().into_iter().find(|t| t.name == name)
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let mut data = self
            .data
            .lock()
            .map_err(|_| ErrorData::internal_error("Gateway unavailable", None))?;
        if let Some(peer) = context.peer.peer_info() {
            data.client = client_label(&peer.client_info.name);
        }
        let before = data.clone();
        let mut value = data.tool(
            request.name.as_ref(),
            Value::Object(request.arguments.unwrap_or_default()),
        );
        if data.save().is_err() {
            *data = before;
            value = error("UNAVAILABLE");
        }
        let mut result = CallToolResult::success(vec![ContentBlock::text(
            serde_json::to_string(&value).unwrap_or_default(),
        )]);
        result.structured_content = Some(value.clone());
        result.is_error = Some(value["ok"] != true);
        Ok(result.into())
    }
}
fn bounded_line<R: Read>(stream: R) -> Option<Vec<u8>> {
    let mut b = BufReader::new(stream.take((MAX_MESSAGE + 1) as u64));
    let mut bytes = vec![];
    b.read_until(b'\n', &mut bytes).ok()?;
    if bytes.len() > MAX_MESSAGE || bytes.last() != Some(&b'\n') {
        None
    } else {
        Some(bytes)
    }
}
fn control_server(listener: UnixListener, data: Arc<Mutex<Data>>, stop: Arc<AtomicBool>) {
    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((mut s, _)) => {
                let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
                let _ = s.set_write_timeout(Some(Duration::from_secs(2)));
                if let Some(bytes) = bounded_line(&s)
                    && let Ok(request) = serde_json::from_slice::<Control>(&bytes)
                    && let Ok(mut d) = data.lock()
                {
                    let response = d.control(request);
                    if let Ok(mut bytes) = serde_json::to_vec(&response)
                        && bytes.len() < MAX_MESSAGE
                    {
                        bytes.push(b'\n');
                        let _ = s.write_all(&bytes);
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50))
            }
            Err(_) => break,
        }
    }
}
// Production callers supply only fixed gateway workers.
fn watch_worker(
    child: &mut std::process::Child,
    stop: &AtomicBool,
    limit: Duration,
    revoked: impl Fn() -> bool,
) -> &'static str {
    let start = Instant::now();
    loop {
        let invalid = revoked();
        if invalid || stop.load(Ordering::SeqCst) || start.elapsed() >= limit {
            let _ = child.kill();
            let _ = child.wait();
            return if invalid {
                "revoked"
            } else if stop.load(Ordering::SeqCst) {
                "terminated"
            } else {
                "timed_out"
            };
        }
        match child.try_wait() {
            Ok(Some(exit)) => return if exit.success() { "finished" } else { "failed" },
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return "failed";
            }
        }
    }
}
fn executor(data: Arc<Mutex<Data>>, stop: Arc<AtomicBool>) {
    while !stop.load(Ordering::SeqCst) {
        if !data
            .lock()
            .ok()
            .is_some_and(|d| d.briefs.iter().any(|r| r.status == "queued"))
        {
            std::thread::sleep(Duration::from_millis(50));
            continue;
        }
        let Some(_audit_lease) = audit_lease(&data) else {
            std::thread::sleep(Duration::from_millis(50));
            continue;
        };
        let job = {
            let mut d = match data.lock() {
                Ok(d) => d,
                Err(_) => return,
            };
            let retained = d.briefs.len();
            d.prune();
            if d.briefs.len() != retained {
                let _ = d.save();
            }
            let found = d.briefs.iter().position(|r| r.status == "queued");
            found.and_then(|i| {
                let r = d.briefs[i].clone();
                let wid = r.workspace_id.as_deref()?;
                let approval = d
                    .allowed(wid, "audit")
                    .ok()
                    .filter(|a| a.epoch == r.epoch)
                    .cloned();
                let Some(approval) = approval else {
                    d.briefs[i].status = "revoked".into();
                    d.briefs[i].consent = "revoked".into();
                    let _ = d.save();
                    return None;
                };
                let (root, store) = d.workspace().ok()?.audit_paths(wid).ok()?;
                d.briefs[i].status = "running".into();
                d.briefs[i]
                    .trace
                    .push("core_worker_launch_committed".into());
                if d.save().is_err() {
                    d.briefs[i].status = "failed".into();
                    return None;
                }
                // Revocation is serialized with spawn; worker independently checks pinned inode identities.
                let mut result = Command::new(std::env::current_exe().unwrap_or_default())
                    .arg("--gateway-worker")
                    .arg("audit")
                    .arg(&root)
                    .arg(r.received_payload_redacted["commit"].as_str().unwrap_or(""))
                    .arg(&store)
                    .arg(approval.root_identity)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null())
                    .spawn();
                if let Ok(child) = result.as_mut()
                    && child
                        .stdin
                        .as_mut()
                        .is_none_or(|lease| lease.write_all(&[1]).is_err())
                {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                Some((r, result))
            })
        };
        if let Some((r, result)) = job {
            let mut status = "failed";
            let mut report_id = None;
            if let Ok(mut child) = result {
                status = watch_worker(&mut child, &stop, Duration::from_secs(15), || {
                    data.lock().ok().is_none_or(|d| {
                        d.allowed(r.workspace_id.as_deref().unwrap_or(""), "audit")
                            .map(|a| a.epoch != r.epoch)
                            .unwrap_or(true)
                    })
                });
                if status == "finished" {
                    status = "failed";
                    let mut bytes = vec![];
                    if let Some(stdout) = child.stdout.take() {
                        let _ = stdout.take(1024).read_to_end(&mut bytes);
                    }
                    if let Ok(path) = std::str::from_utf8(&bytes)
                        && let Some(id) =
                            Path::new(path.trim()).file_name().and_then(|n| n.to_str())
                        && let Ok(d) = data.lock()
                        && d.workspace()
                            .and_then(|w| {
                                w.read_report(r.workspace_id.as_deref().unwrap_or(""), id)
                            })
                            .is_ok()
                    {
                        report_id = Some(id.to_string());
                        status = "complete";
                    }
                }
            }

            if let Ok(mut d) = data.lock() {
                if let Some(current) = d.briefs.iter_mut().find(|v| v.id == r.id) {
                    if current.consent == "revoked" {
                        current.status = "revoked".into();
                    } else {
                        current.status = status.into();
                        current.report_id = report_id;
                    }
                    current.trace.push(format!("worker_{}", current.status));
                }
                let _ = d.save();
            }
        } else {
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}
// Reject malformed/oversized frames before rmcp's codec can silently discard them.
// Keep original frame bytes; never persist stdin or parser error contents.
async fn ingress(writer: tokio::io::DuplexStream) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
    let mut input = tokio::io::BufReader::new(tokio::io::stdin());
    let mut writer = writer;
    loop {
        let mut frame = Vec::new();
        loop {
            let available = match input.fill_buf().await {
                Ok(b) if !b.is_empty() => b,
                _ => return,
            };
            let n = available
                .iter()
                .position(|b| *b == b'\n')
                .map(|i| i + 1)
                .unwrap_or(available.len());
            if frame.len() + n > MAX_MESSAGE {
                return;
            }
            frame.extend_from_slice(&available[..n]);
            input.consume(n);
            if frame.last() == Some(&b'\n') {
                break;
            }
        }
        let valid = serde_json::from_slice::<Value>(&frame)
            .is_ok_and(|v| v.is_object() && v["jsonrpc"] == "2.0");
        if !valid || writer.write_all(&frame).await.is_err() {
            return;
        }
    }
}
struct SessionLease {
    directory: PathBuf,
    session: String,
    _lock: fs::File,
}
impl Drop for SessionLease {
    fn drop(&mut self) {
        let _ = fs::remove_file(self.directory.join("s"));
    }
}
impl SessionLease {
    fn create(profile: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        use std::os::unix::fs::DirBuilderExt;
        let base = profile.join(".g");
        if !base.exists() {
            match fs::DirBuilder::new().mode(0o700).create(&base) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(e.into()),
            }
        }
        let meta = fs::symlink_metadata(&base)?;
        if !meta.is_dir() || meta.file_type().is_symlink() || meta.permissions().mode() & 0o077 != 0
        {
            return Err("UNSAFE_SESSION_DIRECTORY".into());
        }
        let indexpath = base.join("index.lock");
        if fs::symlink_metadata(&indexpath).is_ok_and(|m| {
            !m.is_file() || m.file_type().is_symlink() || m.permissions().mode() & 0o077 != 0
        }) {
            return Err("UNSAFE_SESSION_DIRECTORY".into());
        }
        let index = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(indexpath)?;
        let started = Instant::now();
        loop {
            match index.try_lock() {
                Ok(()) => break,
                Err(std::fs::TryLockError::WouldBlock)
                    if started.elapsed() < Duration::from_secs(3) =>
                {
                    std::thread::sleep(Duration::from_millis(20))
                }
                _ => return Err("SESSION_START_BUSY".into()),
            }
        }
        let active = audit_core::gateway::live_session_dirs(profile)?;
        if active.len() >= audit_core::gateway::MAX_SESSIONS {
            return Err("MCP_SESSION_LIMIT_REACHED".into());
        }
        // Expired inactive state is bounded and removable without touching a live session.
        for entry in fs::read_dir(&base)?.take(256) {
            let entry = entry?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if name.len() != 12
                || !name.bytes().all(|c| c.is_ascii_hexdigit())
                || active.contains(&entry.path())
            {
                continue;
            }
            let m = fs::symlink_metadata(entry.path())?;
            if m.is_dir()
                && !m.file_type().is_symlink()
                && m.modified()?.elapsed().unwrap_or_default() > Duration::from_secs(86400)
            {
                fs::remove_dir_all(entry.path())?;
            }
        }
        let mut inactive = vec![];
        let mut count: usize = 0;
        for entry in fs::read_dir(&base)?.take(256) {
            let entry = entry?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if name.len() != 12 || !name.bytes().all(|c| c.is_ascii_hexdigit()) {
                continue;
            }
            count += 1;
            if !active.contains(&entry.path()) {
                let m = fs::symlink_metadata(entry.path())?;
                if m.is_dir() && !m.file_type().is_symlink() {
                    inactive.push((m.modified()?, entry.path()));
                }
            }
        }
        if count >= 240 {
            inactive.sort();
            for (_, path) in inactive.into_iter().take(count.saturating_sub(128)) {
                fs::remove_dir_all(path)?;
            }
        }
        let session = Uuid::new_v4().to_string();
        let directory = base.join(audit_core::gateway::session_key(&session)?);
        fs::DirBuilder::new().mode(0o700).create(&directory)?;
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(directory.join("lock"))?;
        lock.try_lock()?;
        Ok(Self {
            directory,
            session,
            _lock: lock,
        })
    }
}
fn audit_lease(data: &Arc<Mutex<Data>>) -> Option<fs::File> {
    let profile = data.lock().ok()?.profile.clone();
    let path = profile.join(".audit.lock");
    if fs::symlink_metadata(&path).is_ok_and(|m| {
        !m.is_file() || m.file_type().is_symlink() || m.permissions().mode() & 0o077 != 0
    }) {
        return None;
    }
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(path)
        .ok()?;
    lock.try_lock().ok()?;
    Some(lock)
}
pub async fn run(profile: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let profile = profile.canonicalize().map_err(|_| "PROFILE_UNAVAILABLE")?;
    Workspace::open_reader(&profile).map_err(|_| "PROFILE_INVALID")?;
    let lease = SessionLease::create(&profile)?;
    let socket = lease.directory.join("s");
    let listener = UnixListener::bind(&socket).map_err(|_| "LOCAL_SOCKET_UNAVAILABLE")?;
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600))?;
    listener.set_nonblocking(true)?;
    let journal = lease.directory.join("handoffs.json");
    let mut briefs: Vec<Brief> = Vec::new();
    let active = audit_core::gateway::live_session_dirs(&profile)?;
    let mut archives = vec![profile.join("handoffs.json")];
    for entry in fs::read_dir(profile.join(".g"))?.take(256) {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let m = fs::symlink_metadata(entry.path())?;
        if name.len() == 12
            && name.bytes().all(|c| c.is_ascii_hexdigit())
            && m.is_dir()
            && !m.file_type().is_symlink()
            && !active.contains(&entry.path())
        {
            archives.push(entry.path().join("handoffs.json"));
        }
    }
    archives.push(journal);
    for journal in archives {
        let m = match fs::symlink_metadata(&journal) {
            Ok(v) => v,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.into()),
        };
        if !m.is_file()
            || m.file_type().is_symlink()
            || m.len() > MAX_MESSAGE as u64
            || m.permissions().mode() & 0o077 != 0
        {
            return Err("UNSAFE_HANDOFF_JOURNAL".into());
        }
        let records: Vec<Brief> = serde_json::from_slice(&fs::read(journal)?)?;
        if records.len() > 16 {
            return Err("UNSAFE_HANDOFF_JOURNAL".into());
        }
        briefs.extend(records);
    }
    briefs.sort_by(|a, b| b.created.cmp(&a.created).then(a.id.cmp(&b.id)));
    let mut seen = std::collections::HashSet::new();
    briefs.retain(|r| seen.insert(r.id.clone()));
    briefs.truncate(16);
    briefs.retain(|r| r.created <= now() && now().saturating_sub(r.created) < 86400);
    if briefs.len() > 16 {
        return Err("Handoff retention exceeded".into());
    }
    for r in &mut briefs {
        r.outbound_preview = None;
        if !matches!(r.consent.as_str(), "denied" | "revoked") {
            r.consent = "expired".into();
        }
        if matches!(r.status.as_str(), "queued" | "running") {
            r.status = "terminated".into();
        } else if matches!(
            r.status.as_str(),
            "awaiting_consent" | "awaiting_transmission"
        ) {
            r.status = "expired".into();
        }
        if !r.trace.iter().any(|e| e == "gateway_session_ended") {
            r.trace.push("gateway_session_ended".into());
        }
    }
    let data = Arc::new(Mutex::new(Data {
        profile: profile.clone(),
        state_dir: lease.directory.clone(),
        session: lease.session.clone(),
        epoch: 1,
        access: HashMap::new(),
        briefs,
        client: "MCP client (unverified)".into(),
    }));
    data.lock().map_err(|_| "Gateway unavailable")?.save()?;
    let stop = Arc::new(AtomicBool::new(false));
    let a = {
        let d = data.clone();
        let s = stop.clone();
        std::thread::spawn(move || control_server(listener, d, s))
    };
    let b = {
        let d = data.clone();
        let s = stop.clone();
        std::thread::spawn(move || executor(d, s))
    };
    let (reader, writer) = tokio::io::duplex(MAX_MESSAGE);
    let ingress = tokio::spawn(ingress(writer));
    let transport =
        rmcp::transport::async_rw::AsyncRwTransport::new_server(reader, tokio::io::stdout())
            .with_max_line_length(MAX_MESSAGE);
    let result = Gateway { data }.serve(transport).await;
    let outcome = match result {
        Ok(service) => service
            .waiting()
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
        Err(e) => Err(e.to_string()),
    };
    ingress.abort();
    stop.store(true, Ordering::SeqCst);
    let _ = a.join();
    let _ = b.join();
    let _ = fs::remove_file(socket);
    outcome.map_err(Into::into)
}

pub fn diagnostic(error: &dyn std::error::Error) -> &'static str {
    match error.to_string().as_str() {
        "PROFILE_UNAVAILABLE" => "PROFILE_UNAVAILABLE: open Orven once to initialize its profile",
        "PROFILE_INVALID" => "PROFILE_INVALID: check owner-only profile permissions and registry",
        "MCP_SESSION_LIMIT_REACHED" => {
            "MCP_SESSION_LIMIT_REACHED: at most 8 concurrent connections per profile"
        }
        "SESSION_START_BUSY" => "SESSION_START_BUSY: retry connection startup",
        "UNSAFE_SESSION_DIRECTORY" => {
            "UNSAFE_SESSION_DIRECTORY: session storage permissions are invalid"
        }
        "LOCAL_SOCKET_UNAVAILABLE" => {
            "LOCAL_SOCKET_UNAVAILABLE: check profile path length and local socket permissions"
        }
        "UNSAFE_HANDOFF_JOURNAL" => {
            "UNSAFE_HANDOFF_JOURNAL: retained handoff data failed validation"
        }
        _ => "MCP_SESSION_FAILED: check private profile storage and restart this connection",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use audit_core::gateway::Scope;
    fn data() -> (tempfile::TempDir, Data, String, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("repo");
        fs::create_dir(&root).unwrap();
        git2::Repository::init(&root).unwrap();
        let profile = temp.path().join("profile");
        let mut workspace = Workspace::open(&profile).unwrap();
        let wid = workspace
            .register(&root)
            .unwrap()
            .active_project_id
            .unwrap();
        drop(workspace);
        let mut d = Data {
            state_dir: profile.clone(),
            profile,
            session: Uuid::new_v4().to_string(),
            epoch: 1,
            access: HashMap::new(),
            briefs: vec![],
            client: "MCP client (unverified)".into(),
        };
        assert!(
            d.control(Control::SetAccess {
                session_id: d.session.clone(),
                workspace_id: wid.clone(),
                scope: Scope {
                    discover: true,
                    audit: true,
                    reports: true
                }
            })
            .ok
        );
        (temp, d, wid, root)
    }
    #[test]
    fn exact_arguments_denial_revocation_retention_and_redaction() {
        let (_temp, mut d, wid, _root) = data();
        let args =
            json!({"workspace_id":wid,"commit":"a".repeat(40),"task_context":"secret-token"});
        let v = d.tool("start_audit", args.clone());
        let request = v["data"]["request_id"].as_str().unwrap().to_string();
        let mut canonical = args.clone();
        canonical.sort_all_objects();
        let b = &d.briefs[0];
        assert_eq!(
            b.validated_arguments_sha256,
            digest(&serde_json::to_vec(&canonical).unwrap())
        );
        d.save().unwrap();
        assert!(
            !String::from_utf8(fs::read(d.profile.join("handoffs.json")).unwrap())
                .unwrap()
                .contains("secret-token")
        );
        assert_eq!(
            d.tool(
                "start_audit",
                json!({"workspace_id":wid,"commit":"a".repeat(40),"request_id":request})
            )["code"],
            "STALE_CONSENT"
        );
        let mut reordered = serde_json::Map::new();
        for (key, value) in args.as_object().unwrap().iter().rev() {
            reordered.insert(key.clone(), value.clone());
        }
        reordered.insert("request_id".into(), json!(request));
        assert_eq!(
            d.tool("start_audit", Value::Object(reordered))["code"],
            "OK"
        );
        d.decide(&request, false).unwrap();
        assert_eq!(d.briefs[0].status, "denied");
        assert!(d.briefs[0].execution_id.is_none());
        assert!(d.decide(&request, true).is_err());
        let v = d.tool("start_audit", args.clone());
        let pending = v["data"]["request_id"].as_str().unwrap().to_string();
        d.revoke(&wid);
        assert!(d.decide(&pending, true).is_err());
        assert!(d.allowed(&wid, "audit").is_err());
        d.briefs[0].created = now() - 86401;
        d.prune();
        assert_eq!(d.briefs.len(), 1);
        let old = d.briefs[0].clone();
        for _ in 0..15 {
            let mut b = old.clone();
            b.id = Uuid::new_v4().to_string();
            b.status = "awaiting_consent".into();
            d.briefs.push(b);
        }
        d.briefs[0].status = "awaiting_consent".into();
        assert!(d.add(wid, "start_audit", args, None, 1, None).is_err());
        assert!(serde_json::to_vec(&d.snapshot()).unwrap().len() < MAX_MESSAGE);
    }
    #[test]
    fn replaced_git_root_and_symlink_scope_are_denied() {
        let (_temp, d, wid, root) = data();
        let mut fresh = d.clone();
        fresh.access.clear();
        assert!(
            !fresh
                .control(Control::SetAccess {
                    session_id: Uuid::new_v4().to_string(),
                    workspace_id: wid.clone(),
                    scope: Scope {
                        discover: true,
                        audit: true,
                        reports: true
                    }
                })
                .ok
        );
        assert!(fresh.access.is_empty());
        fs::rename(root.join(".git"), root.join("old-git")).unwrap();
        fs::create_dir(root.join(".git")).unwrap();
        assert_eq!(d.allowed(&wid, "audit").unwrap_err(), "ROOT_CHANGED");
        fs::remove_dir(root.join(".git")).unwrap();
        std::os::unix::fs::symlink(root.join("old-git"), root.join(".git")).unwrap();
        assert!(d.allowed(&wid, "audit").is_err());
    }
    #[test]
    fn watchdog_kills_and_reaps_timeout_revoke_and_shutdown() {
        for (limit, revoked, stopped, expected) in [
            (Duration::ZERO, false, false, "timed_out"),
            (Duration::from_secs(5), true, false, "revoked"),
            (Duration::from_secs(5), false, true, "terminated"),
        ] {
            let mut child = Command::new("/bin/sleep").arg("10").spawn().unwrap();
            let stop = AtomicBool::new(stopped);
            let start = Instant::now();
            assert_eq!(watch_worker(&mut child, &stop, limit, || revoked), expected);
            assert!(start.elapsed() < Duration::from_secs(2));
            assert!(child.try_wait().unwrap().is_some());
        }
    }
    #[test]
    fn shared_execution_lease_serializes_sessions_and_rejects_symlinks() {
        let (_temp, d, _, _) = data();
        let second = Arc::new(Mutex::new(d.clone()));
        let first = Arc::new(Mutex::new(d));
        let lease = audit_lease(&first).unwrap();
        assert!(audit_lease(&second).is_none());
        drop(lease);
        assert!(audit_lease(&second).is_some());
        let profile = first.lock().unwrap().profile.clone();
        fs::remove_file(profile.join(".audit.lock")).unwrap();
        std::os::unix::fs::symlink(profile.join("handoffs.json"), profile.join(".audit.lock"))
            .unwrap();
        assert!(audit_lease(&first).is_none());
    }
    #[test]
    fn inactive_session_capacity_is_pruned_without_unbounded_growth() {
        use std::os::unix::fs::DirBuilderExt;
        let (_temp, d, _, _) = data();
        let base = d.profile.join(".g");
        fs::DirBuilder::new().mode(0o700).create(&base).unwrap();
        for i in 0..240 {
            let dir = base.join(format!("{i:012x}"));
            fs::DirBuilder::new().mode(0o700).create(&dir).unwrap();
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(dir.join("lock"))
                .unwrap();
        }
        let lease = SessionLease::create(&d.profile).unwrap();
        assert_eq!(
            audit_core::gateway::live_session_dirs(&d.profile).unwrap(),
            vec![lease.directory.clone()]
        );
        assert!(fs::read_dir(base).unwrap().count() <= 130);
    }
    #[test]
    fn bounded_control_frames_and_journal_failure() {
        assert!(bounded_line(&b"{}\n"[..]).is_some());
        assert!(bounded_line(&b"{}"[..]).is_none());
        assert!(bounded_line(vec![b'a'; MAX_MESSAGE + 1].as_slice()).is_none());
        let (_temp, mut d, wid, _) = data();
        fs::remove_file(d.profile.join("handoffs.json")).unwrap();
        fs::create_dir(d.profile.join("handoffs.json")).unwrap();
        assert!(d.save().is_err());
        assert!(
            !d.control(Control::Revoke {
                workspace_id: wid.clone()
            })
            .ok
        );
        assert!(d.allowed(&wid, "audit").is_err());
        assert!(d.access.is_empty());
    }
}
