//! Application-owned registration and bounded access to local audit reports.
use crate::{RegisteredRepository, Report};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;
const MAX_REPORT: u64 = 64 * 1024 * 1024;
const MAX_REGISTRY: u64 = 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Registry {
    projects: Vec<Project>,
    active_project_id: Option<String>,
}
#[derive(Serialize)]
pub struct Bootstrap {
    pub projects: Vec<Project>,
    pub active_project_id: Option<String>,
}
#[derive(Serialize)]
pub struct RunSummary {
    pub run_id: String,
    pub commit: String,
    pub captured_unix_seconds: u64,
    pub evidence_count: usize,
    pub exclusion_count: usize,
    pub finding_count: usize,
    pub status: String,
}
#[derive(Serialize)]
pub struct RunListing {
    pub runs: Vec<RunSummary>,
    pub unavailable: usize,
    pub incomplete: usize,
}
pub struct Workspace {
    _profile_lock: Option<fs::File>,
    base: PathBuf,
    registry: Registry,
}
fn message(s: &'static str) -> String {
    s.into()
}
fn canonical_id(id: &str) -> Result<()> {
    if Uuid::parse_str(id).is_ok_and(|parsed| parsed.to_string() == id) {
        Ok(())
    } else {
        Err(message("Invalid identifier"))
    }
}
fn private_directory(path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path).map_err(|_| message("Storage directory unavailable"))?;
    if !meta.is_dir() || meta.file_type().is_symlink() || meta.permissions().mode() & 0o077 != 0 {
        return Err(message("Storage must be an owner-only directory"));
    }
    Ok(())
}
fn ensure_private(path: &Path) -> Result<()> {
    if !path.exists() {
        fs::DirBuilder::new()
            .mode(0o700)
            .create(path)
            .map_err(|_| message("Cannot create private storage"))?;
    }
    private_directory(path)
}
fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let meta = fs::symlink_metadata(path).map_err(|_| message("Stored data unavailable"))?;
    if !meta.is_file()
        || meta.file_type().is_symlink()
        || meta.len() > limit
        || meta.permissions().mode() & 0o077 != 0
    {
        return Err(message("Invalid stored data or permissions"));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| message("Stored data unavailable"))?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| message("Stored data unreadable"))?;
    if bytes.len() as u64 > limit {
        return Err(message("Stored data exceeds size limit"));
    }
    Ok(bytes)
}
impl Workspace {
    pub fn open_reader(base: &Path) -> Result<Self> {
        Self::open_mode(base, false)
    }
    pub fn open(base: &Path) -> Result<Self> {
        Self::open_mode(base, true)
    }
    pub fn base(&self) -> &Path {
        &self.base
    }
    pub fn audit_paths(&self, id: &str) -> Result<(PathBuf, PathBuf)> {
        Ok((self.project(id)?.path.clone(), self.store(id)?))
    }
    fn open_mode(base: &Path, writer: bool) -> Result<Self> {
        ensure_private(base)?;
        let base = base
            .canonicalize()
            .map_err(|_| message("Storage unavailable"))?;
        let profile_lock = if writer {
            let lock_path = base.join(".workspace.lock");
            if fs::symlink_metadata(&lock_path).is_ok_and(|m| {
                !m.is_file() || m.file_type().is_symlink() || m.permissions().mode() & 0o077 != 0
            }) {
                return Err(message("Invalid workspace lock"));
            }
            let profile_lock = fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .mode(0o600)
                .open(lock_path)
                .map_err(|_| message("Workspace lock unavailable"))?;
            profile_lock
                .try_lock()
                .map_err(|_| message("Workspace is already open in another Orven process"))?;
            Some(profile_lock)
        } else {
            None
        };
        ensure_private(&base.join("projects"))?;
        let registry_path = base.join("registry.json");
        let registry: Registry = if registry_path.exists() {
            serde_json::from_slice(&read_bounded(&registry_path, MAX_REGISTRY)?)
                .map_err(|_| message("Workspace registry invalid"))?
        } else {
            Registry::default()
        };
        if registry.projects.len() > 64 {
            return Err(message("Project limit exceeded"));
        }
        let mut ids = std::collections::HashSet::new();
        let mut roots = std::collections::HashSet::new();
        for p in &registry.projects {
            canonical_id(&p.id)?;
            if !ids.insert(p.id.clone()) || !roots.insert(p.path.clone()) || !p.path.is_absolute() {
                return Err(message("Invalid project registry"));
            }
        }
        if registry
            .active_project_id
            .as_ref()
            .is_some_and(|id| !ids.contains(id))
        {
            return Err(message("Active project is not registered"));
        }
        Ok(Self {
            _profile_lock: profile_lock,
            base,
            registry,
        })
    }
    pub fn bootstrap(&self) -> Bootstrap {
        Bootstrap {
            projects: self.registry.projects.clone(),
            active_project_id: self.registry.active_project_id.clone(),
        }
    }
    fn persist(&self) -> Result<()> {
        private_directory(&self.base)?;
        let temp = self.base.join(format!(".registry-{}", Uuid::new_v4()));
        let data = serde_json::to_vec_pretty(&self.registry)
            .map_err(|_| message("Cannot encode registry"))?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)
            .map_err(|_| message("Cannot save registry"))?;
        file.write_all(&data)
            .and_then(|_| file.sync_all())
            .map_err(|_| message("Cannot save registry"))?;
        fs::rename(&temp, self.base.join("registry.json"))
            .map_err(|_| message("Cannot finalize registry"))?;
        Ok(())
    }
    pub fn register(&mut self, chosen_root: &Path) -> Result<Bootstrap> {
        if self._profile_lock.is_none() {
            return Err(message("Read-only workspace handle"));
        }
        let root = chosen_root
            .canonicalize()
            .map_err(|_| message("Selected folder unavailable"))?;
        if root.starts_with(&self.base) || self.base.starts_with(&root) {
            return Err(message("Repository overlaps application storage"));
        }
        if !fs::symlink_metadata(root.join(".git"))
            .is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())
        {
            return Err(message(
                "Choose a repository with an ordinary .git directory",
            ));
        }
        if let Some(project) = self.registry.projects.iter().find(|p| p.path == root) {
            let id = project.id.clone();
            return self.select(&id);
        }
        if self.registry.projects.len() >= 64 {
            return Err(message("Project limit reached"));
        }
        let id = Uuid::new_v4().to_string();
        let project_store = self.base.join("projects").join(&id);
        ensure_private(&project_store)?;
        RegisteredRepository::register(&root, &project_store).map_err(|e| e.to_string())?;
        let name = root
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Repository".into());
        let previous_active = self.registry.active_project_id.clone();
        self.registry.projects.push(Project {
            id: id.clone(),
            name,
            path: root,
        });
        self.registry.active_project_id = Some(id);
        if let Err(error) = self.persist() {
            self.registry.projects.pop();
            self.registry.active_project_id = previous_active;
            return Err(error);
        }
        Ok(self.bootstrap())
    }
    pub fn select(&mut self, id: &str) -> Result<Bootstrap> {
        if self._profile_lock.is_none() {
            return Err(message("Read-only workspace handle"));
        }
        self.project(id)?;
        let previous = self.registry.active_project_id.clone();
        self.registry.active_project_id = Some(id.into());
        if let Err(e) = self.persist() {
            self.registry.active_project_id = previous;
            return Err(e);
        }
        Ok(self.bootstrap())
    }
    fn project(&self, id: &str) -> Result<&Project> {
        canonical_id(id)?;
        self.registry
            .projects
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| message("Project is not registered"))
    }
    fn store(&self, id: &str) -> Result<PathBuf> {
        self.project(id)?;
        let path = self.base.join("projects").join(id);
        private_directory(&self.base)?;
        private_directory(&self.base.join("projects"))?;
        private_directory(&path)?;
        Ok(path)
    }
    pub fn prepare_audit(&self, id: &str) -> Result<RegisteredRepository> {
        let project = self.project(id)?;
        let store = self.store(id)?;
        RegisteredRepository::register(&project.path, &store).map_err(|e| e.to_string())
    }
    pub fn read_report(&self, project_id: &str, run_id: &str) -> Result<Report> {
        canonical_id(run_id)?;
        let directory = self.store(project_id)?.join(run_id);
        private_directory(&directory)?;
        let report: Report =
            serde_json::from_slice(&read_bounded(&directory.join("report.json"), MAX_REPORT)?)
                .map_err(|_| message("Report schema invalid"))?;
        report
            .validate()
            .map_err(|_| message("Report evidence validation failed"))?;
        if report.run_id != run_id {
            return Err(message("Report identity mismatch"));
        }
        Ok(report)
    }
    pub fn list_runs(&self, project_id: &str) -> Result<RunListing> {
        let store = self.store(project_id)?;
        let mut out = RunListing {
            runs: vec![],
            unavailable: 0,
            incomplete: 0,
        };
        let started = std::time::Instant::now();
        let mut read_bytes = 0u64;
        for (count, entry) in fs::read_dir(&store)
            .map_err(|_| message("Reports unavailable"))?
            .enumerate()
        {
            if count >= 1000 || started.elapsed() > std::time::Duration::from_secs(2) {
                return Err(message("Report listing limit reached"));
            }
            let entry = entry.map_err(|_| message("Report entry unavailable"))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with(".incomplete-") {
                out.incomplete += 1;
                continue;
            }
            if canonical_id(&name).is_err() {
                out.unavailable += 1;
                continue;
            }
            if let Ok(meta) = fs::symlink_metadata(store.join(&name).join("report.json")) {
                read_bytes = read_bytes.saturating_add(meta.len());
            }
            if read_bytes > 64 * 1024 * 1024 {
                return Err(message("Report listing byte limit reached"));
            }
            match self.read_report(project_id, &name) {
                Ok(r) => out.runs.push(RunSummary {
                    run_id: r.run_id,
                    commit: r.commit,
                    captured_unix_seconds: r.captured_unix_seconds,
                    evidence_count: r.evidence.len(),
                    exclusion_count: r.exclusions.len(),
                    finding_count: r.findings.len(),
                    status: r.status,
                }),
                Err(_) => out.unavailable += 1,
            }
        }
        out.runs.sort_by(|a, b| {
            b.captured_unix_seconds
                .cmp(&a.captured_unix_seconds)
                .then(b.run_id.cmp(&a.run_id))
        });
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, Signature};
    fn fixture(root: &Path) -> String {
        fs::create_dir(root).unwrap();
        let r = Repository::init(root).unwrap();
        let id = r.blob(b"real fixture\n").unwrap();
        let mut b = r.treebuilder(None).unwrap();
        b.insert("README.md", id, 0o100644).unwrap();
        let tree = r.find_tree(b.write().unwrap()).unwrap();
        let sig = Signature::now("Fixture", "fixture@example.invalid").unwrap();
        r.commit(Some("HEAD"), &sig, &sig, "test", &tree, &[])
            .unwrap()
            .to_string()
    }
    #[test]
    fn persistent_registration_scopes_real_reports_and_ignores_partial_runs() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("first");
        let second = t.path().join("second");
        let commit = fixture(&root);
        fixture(&second);
        let base = t.path().join("data");
        let mut w = Workspace::open(&base).unwrap();
        let p1 = w.register(&root).unwrap().active_project_id.unwrap();
        let p2 = w.register(&second).unwrap().active_project_id.unwrap();
        assert_ne!(p1, p2);
        let registered = w.prepare_audit(&p1).unwrap();
        let report = registered.audit(&commit).unwrap();
        registered.save(&report).unwrap();
        assert_eq!(w.list_runs(&p1).unwrap().runs.len(), 1);
        assert!(w.list_runs(&p2).unwrap().runs.is_empty());
        assert!(w.read_report(&p2, &report.run_id).is_err());
        assert!(w.read_report(&p1, "../registry.json").is_err());
        assert!(w.select(&Uuid::new_v4().to_string()).is_err());
        assert_eq!(
            w.read_report(&p1, &report.run_id).unwrap().evidence[0].content,
            "real fixture\n"
        );
        fs::create_dir(w.store(&p1).unwrap().join(".incomplete-abandoned")).unwrap();
        assert_eq!(w.list_runs(&p1).unwrap().incomplete, 1);
        w.select(&p1).unwrap();
        assert!(Workspace::open(&base).is_err());
        drop(w);
        let restored = Workspace::open(&base).unwrap();
        assert_eq!(restored.bootstrap().active_project_id, Some(p1));
        assert_eq!(restored.bootstrap().projects.len(), 2);
    }
    #[test]
    fn refuses_symlinked_report_and_corrupt_evidence() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("repo");
        let commit = fixture(&root);
        let mut w = Workspace::open(&t.path().join("data")).unwrap();
        let id = w.register(&root).unwrap().active_project_id.unwrap();
        let reg = w.prepare_audit(&id).unwrap();
        let mut r = reg.audit(&commit).unwrap();
        let path = reg.save(&r).unwrap();
        r.evidence[0].content.push('!');
        fs::write(path.join("report.json"), serde_json::to_vec(&r).unwrap()).unwrap();
        assert!(w.read_report(&id, &r.run_id).is_err());
        assert_eq!(w.list_runs(&id).unwrap().unavailable, 1);
        fs::remove_file(path.join("report.json")).unwrap();
        std::os::unix::fs::symlink("/etc/passwd", path.join("report.json")).unwrap();
        assert!(w.read_report(&id, &r.run_id).is_err());
    }
}
