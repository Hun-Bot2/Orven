//! Shared consent contracts and local control transport. No MCP or model dependency.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    path::Path,
};

pub const MAX_MESSAGE: usize = 65536;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scope {
    pub discover: bool,
    pub audit: bool,
    pub reports: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Brief {
    pub id: String,
    pub workspace_id: Option<String>,
    pub tool: String,
    pub source_client: String,
    pub source_identity: String,
    pub supplied_context: Value,
    pub received_payload_redacted: Value,
    pub validated_arguments_sha256: String,
    pub objective: String,
    pub consent: String,
    pub status: String,
    pub created: u64,
    pub epoch: u64,
    pub execution_id: Option<String>,
    pub report_id: Option<String>,
    pub outbound_preview: Option<Value>,
    pub outbound_sha256: Option<String>,
    pub trace: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Access {
    pub workspace_id: String,
    pub scope: Scope,
    pub epoch: u64,
    pub root_identity: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub running: bool,
    pub session_id: String,
    pub transport: String,
    pub client: String,
    pub access: Vec<Access>,
    pub briefs: Vec<Brief>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum Control {
    Snapshot,
    ForSession {
        session_id: String,
        request: Box<Control>,
    },
    SetAccess {
        workspace_id: String,
        scope: Scope,
        session_id: String,
    },
    Revoke {
        workspace_id: String,
    },
    Decide {
        request_id: String,
        approve: bool,
    },
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlReply {
    #[serde(default)]
    pub sessions: Vec<SessionSummary>,
    pub ok: bool,
    pub code: String,
    pub snapshot: Option<Snapshot>,
}
fn control_at(path: &Path, request: &Control) -> Result<ControlReply, String> {
    let mut stream = UnixStream::connect(path).map_err(|_| "Gateway unavailable".to_string())?;
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(2)))
        .map_err(|_| "Control timeout unavailable")?;
    stream
        .set_write_timeout(Some(std::time::Duration::from_secs(2)))
        .map_err(|_| "Control timeout unavailable")?;
    let mut data = serde_json::to_vec(request).map_err(|_| "Invalid control request")?;
    data.push(b'\n');
    stream
        .write_all(&data)
        .map_err(|_| "Gateway write failed")?;
    let mut reader = BufReader::new(stream);
    let mut bytes = Vec::new();
    loop {
        let available = reader.fill_buf().map_err(|_| "Gateway read failed")?;
        if available.is_empty() {
            return Err("Gateway closed response".into());
        }
        let n = available
            .iter()
            .position(|b| *b == b'\n')
            .map(|i| i + 1)
            .unwrap_or(available.len());
        if bytes.len() + n > MAX_MESSAGE {
            return Err("Gateway response exceeds limit".into());
        }
        bytes.extend_from_slice(&available[..n]);
        reader.consume(n);
        if bytes.last() == Some(&b'\n') {
            break;
        }
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid gateway response".into())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionSummary {
    pub session_id: String,
    pub client: String,
}

pub const MAX_SESSIONS: usize = 8;
/// Only owner-private, live session leases are eligible for local control routing.
pub fn live_session_dirs(profile: &Path) -> Result<Vec<std::path::PathBuf>, String> {
    use std::{fs, os::unix::fs::PermissionsExt};
    let base = profile.join(".g");
    let entries = match fs::read_dir(&base) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(_) => return Err("Session directory unavailable".into()),
    };
    let meta = fs::symlink_metadata(&base).map_err(|_| "Session directory unavailable")?;
    if !meta.is_dir() || meta.file_type().is_symlink() || meta.permissions().mode() & 0o077 != 0 {
        return Err("Unsafe session directory".into());
    }
    let mut dirs = vec![];
    for (count, entry) in entries.enumerate() {
        if count >= 256 {
            return Err("Session history limit reached".into());
        }
        let entry = entry.map_err(|_| "Session entry unavailable")?;
        let name = entry.file_name();
        let Some(key) = name.to_str() else { continue };
        if key.len() != 12 || !key.bytes().all(|c| c.is_ascii_hexdigit()) {
            continue;
        }
        let meta = fs::symlink_metadata(entry.path()).map_err(|_| "Session entry unavailable")?;
        if !meta.is_dir() || meta.file_type().is_symlink() || meta.permissions().mode() & 0o077 != 0
        {
            return Err("Unsafe session directory".into());
        }
        let path = entry.path().join("lock");
        let meta = match fs::symlink_metadata(&path) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if !meta.is_file()
            || meta.file_type().is_symlink()
            || meta.permissions().mode() & 0o077 != 0
        {
            return Err("Unsafe session lease".into());
        }
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .map_err(|_| "Session lease unavailable")?;
        match lock.try_lock() {
            Err(std::fs::TryLockError::WouldBlock) => dirs.push(entry.path()),
            Ok(()) => {}
            Err(_) => return Err("Session lease unavailable".into()),
        }
    }
    if dirs.len() > MAX_SESSIONS {
        return Err("Too many MCP sessions".into());
    }
    dirs.sort();
    Ok(dirs)
}
pub fn session_key(id: &str) -> Result<String, String> {
    let uuid = uuid::Uuid::parse_str(id).map_err(|_| "Invalid session ID")?;
    if uuid.to_string() != id {
        return Err("Invalid session ID".into());
    }
    Ok(uuid.simple().to_string()[..12].to_string())
}

pub fn control(profile: &Path, request: &Control) -> Result<ControlReply, String> {
    let dirs = live_session_dirs(profile)?;
    if dirs.is_empty() {
        // Compatibility with a still-running pre-multisession binary; never delete its lock.
        if let Control::ForSession {
            session_id,
            request,
        } = request
        {
            session_key(session_id)?;
            if matches!(request.as_ref(), Control::ForSession { .. }) {
                return Err("Invalid control request".into());
            }
            let current = control_at(&profile.join("gateway.sock"), &Control::Snapshot)?;
            if current
                .snapshot
                .as_ref()
                .is_none_or(|s| s.session_id != *session_id)
            {
                return Err("Selected MCP connection unavailable".into());
            }
            return control_at(&profile.join("gateway.sock"), request);
        }
        return control_at(&profile.join("gateway.sock"), request);
    }
    let (target, inner) = match request {
        Control::ForSession {
            session_id,
            request,
        } => {
            session_key(session_id)?;
            if matches!(request.as_ref(), Control::ForSession { .. }) {
                return Err("Invalid control request".into());
            }
            (Some(session_id.as_str()), request.as_ref())
        }
        Control::SetAccess { session_id, .. } => (Some(session_id.as_str()), request),
        Control::Snapshot => (None, request),
        _ if dirs.len() == 1 => (None, request),
        _ => return Err("Select the target MCP connection".into()),
    };
    let mut live = Vec::new();
    for dir in dirs {
        if let Ok(reply) = control_at(&dir.join("s"), &Control::Snapshot)
            && let Some(snapshot) = reply.snapshot
            && session_key(&snapshot.session_id).ok().as_deref()
                == dir.file_name().and_then(|v| v.to_str())
        {
            live.push((snapshot, dir));
        }
    }
    live.sort_by(|a, b| a.0.session_id.cmp(&b.0.session_id));
    let summaries: Vec<SessionSummary> = live
        .iter()
        .map(|(s, _)| SessionSummary {
            session_id: s.session_id.clone(),
            client: s.client.clone(),
        })
        .collect();
    if let Some(id) = target
        && !live.iter().any(|(s, _)| s.session_id == id)
        && matches!(inner, Control::Snapshot)
    {
        return Ok(ControlReply {
            ok: true,
            code: "OK".into(),
            sessions: summaries,
            snapshot: Some(Snapshot {
                running: false,
                session_id: id.into(),
                transport: "stdio".into(),
                client: "Disconnected".into(),
                access: vec![],
                briefs: vec![],
            }),
        });
    }
    let selected = if let Some(id) = target {
        live.iter().find(|(s, _)| s.session_id == id)
    } else {
        live.first()
    }
    .ok_or("Selected MCP connection unavailable")?;
    let mut reply = if matches!(inner, Control::Snapshot) {
        ControlReply {
            ok: true,
            code: "OK".into(),
            snapshot: Some(selected.0.clone()),
            sessions: vec![],
        }
    } else {
        control_at(&selected.1.join("s"), inner)?
    };
    reply.sessions = summaries;
    Ok(reply)
}
