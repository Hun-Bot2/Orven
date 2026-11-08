#![forbid(unsafe_code)]
use audit_core::RegisteredRepository;
use std::{
    process::{Command, Stdio},
    time::{Duration, Instant},
};
fn main() {
    if let Err(error) = run() {
        eprintln!("orven: {error}");
        std::process::exit(1);
    }
}
fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let worker = args.first().is_some_and(|v| v == "--audit-worker");
    let params = if worker { &args[1..] } else { &args[..] };
    if params.len() != 4 || params[0] != "audit" {
        return Err(
            "usage: audit-host audit REPOSITORY FULL_COMMIT_ID EXISTING_PRIVATE_STORE".into(),
        );
    }
    if worker {
        use nix::sys::resource::{Resource, setrlimit};
        // Apply before opening any untrusted Git object. Fail closed on unsupported limits.
        setrlimit(Resource::RLIMIT_CPU, 10, 10)?;
        // Loose object preflight bounds decompression. RLIMIT_AS is unsupported on macOS.
        setrlimit(Resource::RLIMIT_CORE, 0, 0)?;
        let registered = RegisteredRepository::register(params[1].as_ref(), params[3].as_ref())?;
        let report = registered.audit(params[2].to_str().ok_or("commit must be UTF-8")?)?;
        let path = registered.save(&report)?;
        println!("{}", path.display());
    } else {
        // Only our own fixed worker executable is launched; no target commands or shell.
        let mut child = Command::new(std::env::current_exe()?)
            .arg("--audit-worker")
            .args(params)
            .stdin(Stdio::null())
            .spawn()?;
        let started = Instant::now();
        loop {
            if let Some(status) = child.try_wait()? {
                if !status.success() {
                    return Err("audit worker failed; no successful run is claimed".into());
                }
                break;
            }
            if started.elapsed() > Duration::from_secs(15) {
                child.kill()?;
                child.wait()?;
                return Err("audit exceeded 15-second wall limit".into());
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    Ok(())
}
