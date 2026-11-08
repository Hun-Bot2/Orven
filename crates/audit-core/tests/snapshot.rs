use audit_core::{Error, RegisteredRepository, Report};
use git2::{IndexAddOption, Repository, Signature};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tempfile::TempDir;

struct Fixture {
    _tmp: TempDir,
    root: PathBuf,
    store: PathBuf,
    commit: String,
}
impl Fixture {
    fn new(files: &[(&str, &[u8])]) -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("repo");
        let store = tmp.path().join("store");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&store).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&store, fs::Permissions::from_mode(0o700)).unwrap();
        }
        let repo = Repository::init(&root).unwrap();
        for (path, content) in files {
            let path = root.join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, content).unwrap();
        }
        let mut index = repo.index().unwrap();
        index
            .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = Signature::now("Synthetic", "synthetic@example.invalid").unwrap();
        let commit = repo
            .commit(Some("HEAD"), &sig, &sig, "fixture", &tree, &[])
            .unwrap()
            .to_string();
        Self {
            _tmp: tmp,
            root,
            store,
            commit,
        }
    }
    fn registered(&self) -> RegisteredRepository {
        RegisteredRepository::register(&self.root, &self.store).unwrap()
    }
}
fn contents(path: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(PathBuf, Vec<u8>)>) {
        for entry in fs::read_dir(dir).unwrap() {
            let p = entry.unwrap().path();
            let m = fs::symlink_metadata(&p).unwrap();
            if m.is_dir() {
                walk(root, &p, out);
            } else if m.is_file() {
                out.push((
                    p.strip_prefix(root).unwrap().to_path_buf(),
                    fs::read(&p).unwrap(),
                ));
            }
        }
    }
    let mut out = Vec::new();
    walk(path, path, &mut out);
    out.sort();
    out
}
#[test]
fn committed_snapshot_is_stable_and_does_not_mutate_target() {
    let f = Fixture::new(&[("README.md", b"committed\n"), (".env", b"secret\n")]);
    fs::write(f.root.join("README.md"), b"dirty\n").unwrap();
    fs::write(f.root.join("untracked.md"), b"untracked\n").unwrap();
    let before = contents(&f.root);
    let r = f.registered();
    let report = r.audit(&f.commit).unwrap();
    let again = r.audit(&f.commit).unwrap();
    assert_eq!(before, contents(&f.root));
    assert_eq!(report.commit, f.commit);
    assert_eq!(report.manifest_sha256, again.manifest_sha256);
    assert_eq!(report.evidence.len(), 1);
    assert_eq!(report.evidence[0].content, "committed\n");
    assert!(report.exclusions.iter().any(|e| e.path == "worktree"));
    assert!(report.exclusions.iter().any(|e| e.path == ".env"));
    assert_eq!(report.execution_status, "not_run");
    assert!(report.findings.iter().all(|finding| {
        finding
            .evidence_ids
            .iter()
            .all(|id| report.evidence.iter().any(|e| &e.id == id))
    }));
}
#[test]
fn rejects_corrupt_evidence_and_preserves_incomplete_run() {
    let f = Fixture::new(&[("README.md", b"fixture\n")]);
    let r = f.registered();
    let mut report = r.audit(&f.commit).unwrap();
    report.evidence[0].content.push('!');
    assert!(matches!(
        report.validate(),
        Err(Error::Policy("invalid evidence"))
    ));
    assert!(matches!(
        r.save(&report),
        Err(Error::Policy("invalid evidence"))
    ));
    let report = r.audit(&f.commit).unwrap();
    let incomplete = f.store.join(format!(".incomplete-{}", report.run_id));
    fs::create_dir(&incomplete).unwrap();
    fs::write(incomplete.join("sentinel"), b"keep").unwrap();
    assert!(r.save(&report).is_err());
    assert_eq!(fs::read(incomplete.join("sentinel")).unwrap(), b"keep");
}
#[test]
fn denies_external_git_layouts_and_large_blob() {
    let f = Fixture::new(&[("README.md", b"ok")]);
    fs::create_dir_all(f.root.join(".git/objects/info")).unwrap();
    fs::write(f.root.join(".git/objects/info/alternates"), b"/outside\n").unwrap();
    assert!(matches!(
        f.registered().audit(&f.commit),
        Err(Error::Policy("external Git storage unsupported"))
    ));
    fs::remove_file(f.root.join(".git/objects/info/alternates")).unwrap();
    let other = Fixture::new(&[("large.md", &vec![b'x'; 256 * 1024 + 1])]);
    assert!(matches!(
        other.registered().audit(&other.commit),
        Err(Error::Policy("object decompression limit"))
    ));
    let git = f.root.join(".git");
    fs::rename(&git, f.root.join("metadata")).unwrap();
    fs::write(&git, b"gitdir: ../external\n").unwrap();
    assert!(matches!(
        f.registered().audit(&f.commit),
        Err(Error::Policy("ordinary in-root .git directory required"))
    ));
}
#[cfg(unix)]
#[test]
fn store_permissions_overlap_and_atomic_finalization() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new(&[("README.md", b"ok")]);
    assert!(matches!(
        RegisteredRepository::register(&f.root, &f.root),
        Err(Error::Policy("store overlaps repository"))
    ));
    fs::set_permissions(&f.store, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(matches!(
        RegisteredRepository::register(&f.root, &f.store),
        Err(Error::Policy(
            "store must be an owner-only directory (mode 0700)"
        ))
    ));
    fs::set_permissions(&f.store, fs::Permissions::from_mode(0o700)).unwrap();
    let r = f.registered();
    let report = r.audit(&f.commit).unwrap();
    let saved = r.save(&report).unwrap();
    assert_eq!(
        fs::metadata(&saved).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(saved.join("report.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert!(matches!(
        r.save(&report),
        Err(Error::Policy("run already exists"))
    ));
}
#[cfg(unix)]
#[test]
fn committed_symlink_is_excluded_without_following_it() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new(&[("README.md", b"ok")]);
    symlink("/outside/secret", f.root.join("link.md")).unwrap();
    let repo = Repository::open(&f.root).unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("link.md")).unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let parent = repo
        .find_commit(git2::Oid::from_str(&f.commit).unwrap())
        .unwrap();
    let sig = Signature::now("Synthetic", "synthetic@example.invalid").unwrap();
    let commit = repo
        .commit(Some("HEAD"), &sig, &sig, "symlink", &tree, &[&parent])
        .unwrap();
    let report = f.registered().audit(&commit.to_string()).unwrap();
    assert!(
        report
            .exclusions
            .iter()
            .any(|e| e.path == "link.md" && e.reason.contains("symlink"))
    );
    assert!(!report.evidence.iter().any(|e| e.path == "link.md"));
}

#[test]
fn rejects_malformed_commit_object() {
    let f = Fixture::new(&[("README.md", b"ok")]);
    let object = f
        .root
        .join(".git/objects")
        .join(&f.commit[..2])
        .join(&f.commit[2..]);
    fs::remove_file(&object).unwrap();
    fs::write(object, b"not a valid compressed Git object").unwrap();
    assert!(matches!(f.registered().audit(&f.commit), Err(Error::Io(_))));
}

#[cfg(unix)]
#[test]
fn rejects_symlink_in_git_metadata() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new(&[("README.md", b"ok")]);
    symlink("/outside", f.root.join(".git/objects/info/unsafe-link")).unwrap();
    assert!(matches!(
        f.registered().audit(&f.commit),
        Err(Error::Policy("unsafe Git storage entry"))
    ));
}

#[test]
fn rejects_deep_tree_and_excludes_invalid_utf8() {
    let path = format!("{}README.md", "d/".repeat(34));
    let f = Fixture::new(&[(&path, b"ok")]);
    assert!(matches!(
        f.registered().audit(&f.commit),
        Err(Error::Policy("snapshot traversal limit"))
    ));
    let binary = Fixture::new(&[("binary.md", &[0xff, 0xfe])]);
    let report = binary.registered().audit(&binary.commit).unwrap();
    assert!(report.evidence.is_empty());
    assert!(
        report
            .exclusions
            .iter()
            .any(|e| e.path == "binary.md" && e.reason == "non-UTF8 content")
    );
}

#[test]
fn rejects_broken_references_and_unknown_json_fields() {
    let f = Fixture::new(&[("README.md", b"ok")]);
    let mut report = f.registered().audit(&f.commit).unwrap();
    report.findings[0].evidence_ids[0] = "missing".into();
    assert!(matches!(
        report.validate(),
        Err(Error::Policy("unsupported finding"))
    ));
    let mut json = serde_json::to_value(&report).unwrap();
    json.as_object_mut()
        .unwrap()
        .insert("unexpected".into(), true.into());
    assert!(serde_json::from_value::<Report>(json).is_err());
}

#[test]
fn markdown_escapes_html_in_repository_path() {
    let f = Fixture::new(&[("<script>.md", b"ok")]);
    let report = f.registered().audit(&f.commit).unwrap();
    let markdown = report.markdown().unwrap();
    assert!(!markdown.contains("<script>"));
    assert!(markdown.contains(r"\<script\>"));
}

#[test]
fn rejects_packed_storage_and_compressed_expansion() {
    use std::io::Write;
    let packed = Fixture::new(&[("README.md", b"ok")]);
    let pack = packed.root.join(".git/objects/pack");
    fs::create_dir_all(&pack).unwrap();
    fs::write(pack.join("fixture.pack"), b"PACK").unwrap();
    assert!(matches!(
        packed.registered().audit(&packed.commit),
        Err(Error::Policy(
            "packed object storage unsupported until memory confinement is verified"
        ))
    ));

    let bomb = Fixture::new(&[("README.md", b"ok")]);
    let object_dir = bomb.root.join(".git/objects/aa");
    fs::create_dir_all(&object_dir).unwrap();
    let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::best());
    encoder.write_all(b"blob 1048576\0").unwrap();
    encoder.write_all(&vec![b'x'; 1024 * 1024]).unwrap();
    let compressed = encoder.finish().unwrap();
    assert!(compressed.len() < 4096);
    fs::write(
        object_dir.join("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        compressed,
    )
    .unwrap();
    assert!(matches!(
        bomb.registered().audit(&bomb.commit),
        Err(Error::Policy("object decompression limit"))
    ));
}

#[test]
fn excludes_lfs_pointer_and_submodule() {
    let f = Fixture::new(&[(
        "large.md",
        b"version https://git-lfs.github.com/spec/v1\noid sha256:fixture\nsize 10\n",
    )]);
    let repo = Repository::open(&f.root).unwrap();
    let parent = repo
        .find_commit(git2::Oid::from_str(&f.commit).unwrap())
        .unwrap();
    let original = parent.tree().unwrap();
    let mut builder = repo.treebuilder(Some(&original)).unwrap();
    builder.insert("module", parent.id(), 0o160000).unwrap();
    let tree = repo.find_tree(builder.write().unwrap()).unwrap();
    let sig = Signature::now("Synthetic", "synthetic@example.invalid").unwrap();
    let commit = repo
        .commit(Some("HEAD"), &sig, &sig, "submodule", &tree, &[&parent])
        .unwrap();
    let report = f.registered().audit(&commit.to_string()).unwrap();
    assert!(
        report
            .exclusions
            .iter()
            .any(|e| e.path == "large.md" && e.reason == "LFS content not downloaded")
    );
    assert!(
        report
            .exclusions
            .iter()
            .any(|e| e.path == "module" && e.reason == "submodule not traversed")
    );
    assert!(report.evidence.is_empty());
}

#[cfg(unix)]
#[test]
fn ignores_git_config_includes_and_never_runs_hooks() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new(&[("README.md", b"ok")]);
    let sentinel = f._tmp.path().join("hook-ran");
    let hook = f.root.join(".git/hooks/post-checkout");
    fs::write(
        &hook,
        format!("#!/bin/sh\nprintf ran > '{}'\n", sentinel.display()),
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    fs::write(
        f.root.join(".git/config"),
        b"[include\nthis is deliberately malformed\n",
    )
    .unwrap();
    let before = contents(&f.root);
    let report = f.registered().audit(&f.commit).unwrap();
    assert_eq!(report.commit, f.commit);
    assert!(!sentinel.exists());
    assert_eq!(before, contents(&f.root));
}
