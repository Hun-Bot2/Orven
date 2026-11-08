#![forbid(unsafe_code)]
pub mod gateway;
pub mod workspace;
// Offline, committed-snapshot inspection. Never invokes repository commands.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("policy denied: {0}")]
    Policy(&'static str),
    #[error("I/O operation failed")]
    Io(#[from] std::io::Error),
    #[error("invalid or unavailable Git object")]
    Git(#[from] git2::Error),
    #[error("invalid report encoding")]
    Json(#[from] serde_json::Error),
}
pub type Result<T> = std::result::Result<T, Error>;
fn deny(message: &'static str) -> Error {
    Error::Policy(message)
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
const POLICY: &str = "committed-text-v1";
const MAX_FILE: usize = 256 * 1024;
const MAX_BYTES: usize = 8 * 1024 * 1024;
const MAX_ENTRIES: usize = 10_000;

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Evidence {
    pub id: String,
    pub path: String,
    pub blob_id: String,
    pub sha256: String,
    pub content: String,
    pub capture_status: String,
    pub byte_start: usize,
    pub byte_end: usize,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Exclusion {
    pub path: String,
    pub reason: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Finding {
    pub title: String,
    pub classification: String,
    pub severity: String,
    pub rationale: String,
    pub recommendation: String,
    pub limitations: String,
    pub evidence_ids: Vec<String>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CheckReceipt {
    pub id: String,
    pub version: String,
    pub status: String,
    pub reason: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Report {
    pub schema_version: u32,
    pub run_id: String,
    pub repository_id: String,
    pub origin: String,
    pub captured_unix_seconds: u64,
    pub commit: String,
    pub manifest_sha256: String,
    pub policy: String,
    pub collector_version: String,
    pub status: String,
    pub execution_status: String,
    pub analysis_status: String,
    pub checks: Vec<CheckReceipt>,
    pub evidence: Vec<Evidence>,
    pub exclusions: Vec<Exclusion>,
    pub findings: Vec<Finding>,
}
fn manifest(evidence: &[Evidence], excluded: &[Exclusion], commit: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(POLICY.as_bytes());
    digest.update(commit.as_bytes());
    for item in evidence {
        for value in [&item.path, &item.blob_id, &item.sha256] {
            digest.update((value.len() as u64).to_be_bytes());
            digest.update(value.as_bytes());
        }
    }
    for item in excluded {
        for value in [&item.path, &item.reason] {
            digest.update((value.len() as u64).to_be_bytes());
            digest.update(value.as_bytes());
        }
    }
    format!("{:x}", digest.finalize())
}
impl Report {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1
            || self.policy != POLICY
            || self.status != "complete"
            || self.origin != "local"
            || self.execution_status != "not_run"
            || self.analysis_status != "unavailable"
            || self.checks.len() != 2
            || self.checks[0].id != "committed_inventory"
            || self.checks[0].status != "success"
            || self.checks[1].id != "repository_execution"
            || self.checks[1].status != "skipped"
            || Uuid::parse_str(&self.run_id).is_err()
            || Uuid::parse_str(&self.repository_id).is_err()
            || self.commit.len() != 40
            || git2::Oid::from_str(&self.commit).is_err()
            || self.evidence.len() + self.exclusions.len() > MAX_ENTRIES + 3
        {
            return Err(deny("unsupported report"));
        }
        let mut ids = std::collections::HashSet::new();
        let mut paths = std::collections::HashSet::new();
        let mut bytes = 0;
        for e in &self.evidence {
            bytes += e.content.len();
            if !safe_path(&e.path)
                || !paths.insert(&e.path)
                || !ids.insert(&e.id)
                || e.id != format!("e{}", ids.len())
                || e.content.len() > MAX_FILE
                || bytes > MAX_BYTES
                || e.capture_status != "captured"
                || e.byte_start != 0
                || e.byte_end != e.content.len()
                || hash(e.content.as_bytes()) != e.sha256
                || git2::Oid::hash_object(git2::ObjectType::Blob, e.content.as_bytes())?.to_string()
                    != e.blob_id
            {
                return Err(deny("invalid evidence"));
            }
        }
        if self.findings.iter().any(|f| {
            f.classification != "observed"
                || f.evidence_ids.is_empty()
                || f.evidence_ids.iter().any(|id| !ids.contains(id))
        }) {
            return Err(deny("unsupported finding"));
        }
        if self.manifest_sha256 != manifest(&self.evidence, &self.exclusions, &self.commit) {
            return Err(deny("manifest mismatch"));
        }
        Ok(())
    }
    pub fn markdown(&self) -> Result<String> {
        self.validate()?;
        // All repository-derived strings are escaped; no raw HTML, links or images.
        fn escape(s: &str) -> String {
            s.chars()
                .flat_map(|c| {
                    if c.is_ascii_punctuation() {
                        vec!['\\', c]
                    } else if c.is_control() {
                        vec![' ']
                    } else {
                        vec![c]
                    }
                })
                .collect()
        }
        let mut out = format!(
            "# Orven snapshot audit\n\nCommit: {}\n\nManifest: {}\n\nStatus: complete; execution: not run. Coverage is limited to committed text.\n\n",
            self.commit, self.manifest_sha256
        );
        for f in &self.findings {
            out.push_str(&format!(
                "- {} (observed; evidence: {})\n",
                escape(&f.title),
                f.evidence_ids
                    .iter()
                    .map(|s| escape(s))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        out.push_str("\n## Evidence\n\n");
        for e in &self.evidence {
            out.push_str(&format!(
                "- {}: {} (SHA256 {})\n",
                escape(&e.id),
                escape(&e.path),
                e.sha256
            ));
        }
        out.push_str("\n## Exclusions\n\n");
        for e in &self.exclusions {
            out.push_str(&format!("- {}: {}\n", escape(&e.path), escape(&e.reason)));
        }
        out.push_str(
            "\nNo finding is not proof of safety. Test declarations do not prove tests ran.\n",
        );
        Ok(out)
    }
}
fn safe_path(s: &str) -> bool {
    !s.is_empty()
        && !s.contains(['\\', '\0'])
        && !s.chars().any(char::is_control)
        && s.split('/').all(|v| !v.is_empty() && v != "." && v != "..")
        && !s.starts_with('/')
}
fn excluded(path: &str) -> Option<&'static str> {
    let lower = path.to_ascii_lowercase();
    if lower.split('/').any(|p| {
        p.starts_with(".env")
            || matches!(p, ".ssh" | ".aws" | "credentials" | "credentials.json")
            || p.ends_with(".pem")
            || p.ends_with(".key")
            || p.starts_with("id_rsa")
    }) {
        return Some("secret-path policy");
    }
    let name = lower.rsplit('/').next().unwrap_or("");
    if !(name.ends_with(".md")
        || name.ends_with(".toml")
        || name.ends_with(".json")
        || name.ends_with(".yaml")
        || name.ends_with(".yml")
        || matches!(name, "makefile" | "license"))
    {
        return Some("outside text inventory scope");
    }
    None
}
/// Operator-owned registration; the returned handle contains no model-selected path.
pub struct RegisteredRepository {
    store: PathBuf,
    id: String,
    root_dir: cap_std::fs::Dir,
    store_dir: cap_std::fs::Dir,
}
impl RegisteredRepository {
    pub fn register(root: &Path, store: &Path) -> Result<Self> {
        let root = root.canonicalize()?;
        // Require an existing store, avoiding ambiguous missing-parent resolution.
        let store = store.canonicalize()?;
        if root.starts_with(&store) || store.starts_with(&root) {
            return Err(deny("store overlaps repository"));
        }
        if !root.is_dir() || !store.is_dir() {
            return Err(deny("directories required"));
        }
        private_directory(&store)?;
        let root_dir = cap_std::fs::Dir::open_ambient_dir(&root, cap_std::ambient_authority())?;
        let store_dir = cap_std::fs::Dir::open_ambient_dir(&store, cap_std::ambient_authority())?;
        Ok(Self {
            root_dir,
            store_dir,
            store,
            id: Uuid::new_v4().to_string(),
        })
    }
    pub fn audit(&self, commit: &str) -> Result<Report> {
        self.audit_pinned(commit, None)
    }
    /// Bind MCP approval to the opened root and Git directory, not an ambient path.
    pub fn audit_authorized(&self, commit: &str, identity: &str) -> Result<Report> {
        self.audit_pinned(commit, Some(identity))
    }
    fn audit_pinned(&self, commit: &str, expected: Option<&str>) -> Result<Report> {
        if commit.len() != 40 || !commit.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err(deny("full SHA-1 commit object ID required"));
        }
        if std::env::vars_os().any(|(key, _)| {
            matches!(
                key.to_str(),
                Some(
                    "GIT_DIR"
                        | "GIT_COMMON_DIR"
                        | "GIT_OBJECT_DIRECTORY"
                        | "GIT_ALTERNATE_OBJECT_DIRECTORIES"
                        | "GIT_NAMESPACE"
                )
            )
        }) {
            return Err(deny("Git environment overrides unsupported"));
        }
        if !self.root_dir.symlink_metadata(".git")?.is_dir() {
            return Err(deny("ordinary in-root .git directory required"));
        }
        let git = self.root_dir.open_dir(".git")?;
        if let Some(expected) = expected {
            use std::os::unix::fs::MetadataExt;
            let root = self.root_dir.try_clone()?.into_std_file().metadata()?;
            let meta = git.try_clone()?.into_std_file().metadata()?;
            if format!(
                "{}:{}:{}:{}",
                root.dev(),
                root.ino(),
                meta.dev(),
                meta.ino()
            ) != expected
            {
                return Err(deny("approved root changed"));
            }
        }
        if git.symlink_metadata("commondir").is_ok()
            || git.symlink_metadata("objects/info/alternates").is_ok()
            || git.symlink_metadata("objects/info/http-alternates").is_ok()
        {
            return Err(deny("external Git storage unsupported"));
        }
        let start = Instant::now();
        let mut count = 0;
        let mut disk_bytes = 0;
        inspect_storage(&git, 0, &mut count, &mut disk_bytes, start)?;
        // Capability-relative reads cannot escape the opened Git directory during swaps.
        let odb = validate_loose_objects(&git.open_dir("objects")?, start)?;
        let repo = git2::Repository::from_odb(odb)?;
        let commit_id = git2::Oid::from_str(commit)?;
        check_object(&repo, commit_id, git2::ObjectType::Commit, MAX_FILE)?;
        let commit = repo.find_commit(commit_id)?;
        check_object(&repo, commit.tree_id(), git2::ObjectType::Tree, MAX_BYTES)?;
        let mut report = Report {
            schema_version: 1,
            run_id: Uuid::new_v4().to_string(),
            repository_id: self.id.clone(),
            origin: "local".into(),
            captured_unix_seconds: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| deny("invalid clock"))?
                .as_secs(),
            commit: commit.id().to_string(),
            manifest_sha256: String::new(),
            policy: POLICY.into(),
            collector_version: env!("CARGO_PKG_VERSION").into(),
            status: "complete".into(),
            execution_status: "not_run".into(),
            analysis_status: "unavailable".into(),
            checks: vec![
                CheckReceipt {
                    id: "committed_inventory".into(),
                    version: POLICY.into(),
                    status: "success".into(),
                    reason: "Bounded committed text inventory completed; see exclusions.".into(),
                },
                CheckReceipt {
                    id: "repository_execution".into(),
                    version: POLICY.into(),
                    status: "skipped".into(),
                    reason:
                        "Repository commands are prohibited; test/build outcomes remain unverified."
                            .into(),
                },
            ],
            evidence: vec![],
            findings: vec![],
            exclusions: vec![
                Exclusion {
                    path: "worktree".into(),
                    reason: "dirty and untracked files not inspected".into(),
                },
                Exclusion {
                    path: "dependencies".into(),
                    reason: "external dependencies not inspected".into(),
                },
            ],
        };
        let mut budget = Budget {
            entries: 0,
            bytes: 0,
            start,
        };
        walk(&repo, &commit.tree()?, "", 0, &mut budget, &mut report)?;
        report.manifest_sha256 = manifest(&report.evidence, &report.exclusions, &report.commit);
        report.validate()?;
        Ok(report)
    }
    pub fn save(&self, report: &Report) -> Result<PathBuf> {
        report.validate()?;
        if report.repository_id != self.id {
            return Err(deny("repository mismatch"));
        }
        use cap_std::fs::{DirBuilderExt, OpenOptionsExt};
        use std::io::Write;
        let pending = format!(".incomplete-{}", report.run_id);
        let final_dir = self.store.join(&report.run_id);
        if self.store_dir.symlink_metadata(&report.run_id).is_ok() {
            return Err(deny("run already exists"));
        }
        let mut builder = cap_std::fs::DirBuilder::new();
        builder.mode(0o700);
        self.store_dir.create_dir_with(&pending, &builder)?;
        let dir = self.store_dir.open_dir(&pending)?;
        for (name, bytes) in [
            ("report.json", serde_json::to_vec_pretty(report)?),
            ("report.md", report.markdown()?.into_bytes()),
        ] {
            let mut options = cap_std::fs::OpenOptions::new();
            options.write(true).create_new(true).mode(0o600);
            let mut f = dir.open_with(name, &options)?;
            f.write_all(&bytes)?;
            f.sync_all()?;
        }
        self.store_dir
            .rename(&pending, &self.store_dir, &report.run_id)?;
        Ok(final_dir)
    }
}
fn private_directory(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || metadata.permissions().mode() & 0o077 != 0
    {
        return Err(deny("store must be an owner-only directory (mode 0700)"));
    }
    Ok(())
}
fn inspect_storage(
    dir: &cap_std::fs::Dir,
    depth: usize,
    count: &mut usize,
    bytes: &mut u64,
    start: Instant,
) -> Result<()> {
    if depth > 32 || start.elapsed().as_secs() > 10 {
        return Err(deny("metadata traversal limit"));
    }
    for entry in dir.entries()? {
        let name = entry?.file_name();
        let m = dir.symlink_metadata(&name)?;
        *count += 1;
        *bytes = bytes.saturating_add(m.len());
        if *count > 20_000 || *bytes > 128 * 1024 * 1024 {
            return Err(deny("metadata storage limit"));
        }
        if m.file_type().is_symlink() || (!m.is_dir() && !m.is_file()) {
            return Err(deny("unsafe Git storage entry"));
        }
        if m.is_dir() {
            inspect_storage(&dir.open_dir(name)?, depth + 1, count, bytes, start)?;
        }
    }
    Ok(())
}
struct Budget {
    entries: usize,
    bytes: usize,
    start: Instant,
}
fn walk(
    repo: &git2::Repository,
    tree: &git2::Tree<'_>,
    prefix: &str,
    depth: usize,
    budget: &mut Budget,
    report: &mut Report,
) -> Result<()> {
    if depth > 32 || budget.start.elapsed().as_secs() > 10 {
        return Err(deny("snapshot traversal limit"));
    }
    for entry in tree {
        budget.entries += 1;
        if budget.entries > MAX_ENTRIES {
            return Err(deny("entry count limit"));
        }
        let name = entry.name().map_err(|_| deny("non-UTF8 path"))?;
        if !safe_path(name) || name.contains('/') {
            return Err(deny("unsafe tree name"));
        }
        let path = format!("{prefix}{name}");
        if entry.kind() == Some(git2::ObjectType::Tree) {
            check_object(repo, entry.id(), git2::ObjectType::Tree, MAX_BYTES)?;
            walk(
                repo,
                &repo.find_tree(entry.id())?,
                &format!("{path}/"),
                depth + 1,
                budget,
                report,
            )?;
            continue;
        }
        let reason = if entry.filemode() == 0o120000 {
            Some("symlink not followed")
        } else if entry.filemode() == 0o160000 {
            Some("submodule not traversed")
        } else if !matches!(entry.filemode(), 0o100644 | 0o100755) {
            Some("unsupported entry type")
        } else {
            excluded(&path)
        };
        if let Some(reason) = reason {
            report.exclusions.push(Exclusion {
                path,
                reason: reason.into(),
            });
            continue;
        }
        let (size, kind) = repo.odb()?.read_header(entry.id())?;
        if size > MAX_FILE || kind != git2::ObjectType::Blob {
            return Err(deny("blob size/type limit"));
        }
        budget.bytes += size;
        if budget.bytes > MAX_BYTES {
            return Err(deny("snapshot byte limit"));
        }
        let blob = repo.find_blob(entry.id())?;
        if blob
            .content()
            .starts_with(b"version https://git-lfs.github.com/spec/v1")
        {
            report.exclusions.push(Exclusion {
                path,
                reason: "LFS content not downloaded".into(),
            });
            continue;
        }
        let Ok(content) = std::str::from_utf8(blob.content()) else {
            report.exclusions.push(Exclusion {
                path,
                reason: "non-UTF8 content".into(),
            });
            continue;
        };
        let id = format!("e{}", report.evidence.len() + 1);
        report.findings.push(Finding {
            title: format!("Committed inventory entry: {path}"),
            classification: "observed".into(),
            severity: "info".into(),
            rationale: "A committed text entry was observed; no execution claim is made.".into(),
            recommendation: "Review the captured evidence before drawing engineering conclusions."
                .into(),
            limitations: "Inventory only; correctness and runtime behavior are unverified.".into(),
            evidence_ids: vec![id.clone()],
        });
        report.evidence.push(Evidence {
            id,
            path,
            blob_id: entry.id().to_string(),
            sha256: hash(blob.content()),
            content: content.into(),
            capture_status: "captured".into(),
            byte_start: 0,
            byte_end: content.len(),
        });
    }
    Ok(())
}

fn check_object(
    repo: &git2::Repository,
    id: git2::Oid,
    expected: git2::ObjectType,
    maximum: usize,
) -> Result<()> {
    let (size, kind) = repo.odb()?.read_header(id)?;
    if size > maximum || kind != expected {
        return Err(deny("object size/type limit"));
    }
    Ok(())
}

// macOS rejects RLIMIT_AS. Bound expansion before libgit2 receives any object;
// packed/delta storage needs a separately verified resource boundary.
fn validate_loose_objects(
    objects: &cap_std::fs::Dir,
    start: Instant,
) -> Result<git2::Odb<'static>> {
    use std::io::Read;
    let odb = git2::Odb::new()?;
    odb.add_new_mempack_backend(1000)?;
    let mut total = 0usize;
    for directory in objects.entries()? {
        let directory = directory?;
        let name = directory.file_name();
        let name = name
            .to_str()
            .ok_or_else(|| deny("invalid object directory"))?;
        if name == "info" {
            continue;
        }
        if name == "pack" {
            if objects.open_dir(name)?.entries()?.next().is_some() {
                return Err(deny(
                    "packed object storage unsupported until memory confinement is verified",
                ));
            }
            continue;
        }
        if name.len() != 2
            || !name.bytes().all(|b| b.is_ascii_hexdigit())
            || !directory.file_type()?.is_dir()
        {
            return Err(deny("invalid loose object directory"));
        }
        let object_dir = objects.open_dir(name)?;
        for entry in object_dir.entries()? {
            if start.elapsed().as_secs() > 10 {
                return Err(deny("object preflight deadline"));
            }
            let entry = entry?;
            let filename = entry.file_name();
            let filename = filename
                .to_str()
                .ok_or_else(|| deny("invalid object filename"))?;
            if filename.len() != 38 || !filename.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(deny("invalid object filename"));
            }
            let file = object_dir.open(filename)?;
            let mut decoded = Vec::new();
            flate2::read::ZlibDecoder::new(file.take(128 * 1024 * 1024))
                .take((MAX_FILE + 128 + 1) as u64)
                .read_to_end(&mut decoded)?;
            total += decoded.len();
            if decoded.len() > MAX_FILE + 128 || total > MAX_BYTES {
                return Err(deny("object decompression limit"));
            }
            let null = decoded
                .iter()
                .position(|b| *b == 0)
                .ok_or_else(|| deny("invalid loose object header"))?;
            if null > 64 {
                return Err(deny("invalid loose object header"));
            }
            let header = std::str::from_utf8(&decoded[..null])
                .map_err(|_| deny("invalid loose object header"))?;
            let (kind, size) = header
                .split_once(' ')
                .ok_or_else(|| deny("invalid loose object header"))?;
            let size: usize = size
                .parse()
                .map_err(|_| deny("invalid loose object size"))?;
            let payload = &decoded[null + 1..];
            if size != payload.len() || size > MAX_FILE {
                return Err(deny("object decompression limit"));
            }
            let kind = match kind {
                "blob" => git2::ObjectType::Blob,
                "tree" => git2::ObjectType::Tree,
                "commit" => git2::ObjectType::Commit,
                "tag" => git2::ObjectType::Tag,
                _ => return Err(deny("invalid loose object type")),
            };
            if git2::Oid::hash_object(kind, payload)?.to_string()
                != format!("{name}{filename}").to_ascii_lowercase()
            {
                return Err(deny("object content identity mismatch"));
            }
            odb.write(kind, payload)?;
        }
    }
    Ok(odb)
}
