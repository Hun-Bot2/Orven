use git2::{IndexAddOption, Repository, Signature};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

fn files(root: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    fn visit(root: &Path, dir: &Path, output: &mut Vec<(PathBuf, Vec<u8>)>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let metadata = fs::symlink_metadata(&path).unwrap();
            if metadata.is_dir() {
                visit(root, &path, output);
            } else if metadata.is_file() {
                output.push((
                    path.strip_prefix(root).unwrap().to_path_buf(),
                    fs::read(path).unwrap(),
                ));
            }
        }
    }
    let mut output = Vec::new();
    visit(root, root, &mut output);
    output.sort();
    output
}

#[cfg(unix)]
#[test]
fn cli_creates_report_from_immutable_snapshot_and_rejects_invalid_commit() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("repo");
    let store = temp.path().join("store");
    fs::create_dir(&root).unwrap();
    fs::create_dir(&store).unwrap();
    fs::set_permissions(&store, fs::Permissions::from_mode(0o700)).unwrap();
    let repo = Repository::init(&root).unwrap();
    fs::write(root.join("README.md"), b"committed fixture\n").unwrap();
    let mut index = repo.index().unwrap();
    index
        .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
        .unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let sig = Signature::now("Synthetic", "synthetic@example.invalid").unwrap();
    let commit = repo
        .commit(Some("HEAD"), &sig, &sig, "fixture", &tree, &[])
        .unwrap()
        .to_string();
    fs::write(root.join("README.md"), b"dirty fixture\n").unwrap();
    let before = files(&root);
    let output = Command::new(env!("CARGO_BIN_EXE_audit-host"))
        .arg("audit")
        .arg(&root)
        .arg(&commit)
        .arg(&store)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "worker failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let path = PathBuf::from(String::from_utf8(output.stdout).unwrap().trim());
    assert!(path.starts_with(store.canonicalize().unwrap()));
    let report: serde_json::Value =
        serde_json::from_slice(&fs::read(path.join("report.json")).unwrap()).unwrap();
    assert_eq!(report["commit"], commit);
    assert_eq!(report["evidence"][0]["content"], "committed fixture\n");
    assert!(path.join("report.md").is_file());
    assert_eq!(before, files(&root));
    let before_store = files(&store);
    let failure = Command::new(env!("CARGO_BIN_EXE_audit-host"))
        .arg("audit")
        .arg(&root)
        .arg("invalid")
        .arg(&store)
        .output()
        .unwrap();
    assert!(!failure.status.success());
    assert_eq!(before_store, files(&store));
    assert_eq!(before, files(&root));
}

#[test]
fn gateway_worker_requires_parent_lease_and_stops_when_it_is_closed() {
    use std::{
        process::Stdio,
        time::{Duration, Instant},
    };
    let temp = tempfile::tempdir().unwrap();
    let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_audit-host"))
        .args([
            "--gateway-worker",
            "audit",
            temp.path().to_str().unwrap(),
            &"a".repeat(40),
            temp.path().to_str().unwrap(),
            "unapproved-identity",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    std::thread::sleep(Duration::from_millis(100));
    assert!(child.try_wait().unwrap().is_none());
    drop(child.stdin.take());
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            assert!(!status.success());
            break;
        }
        assert!(started.elapsed() < Duration::from_secs(3));
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
}
