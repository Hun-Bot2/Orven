#![forbid(unsafe_code)]
mod gateway;
use audit_core::RegisteredRepository;
use std::{
    process::{Command, Stdio},
    time::{Duration, Instant},
};
fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.first().is_some_and(|v| v == "mcp") {
        if args.len() != 2 {
            eprintln!("usage: audit-host mcp EXISTING_PROFILE");
            std::process::exit(1);
        }
        let runtime = tokio::runtime::Runtime::new().expect("runtime unavailable");
        if let Err(error) = runtime.block_on(gateway::run(args[1].as_ref())) {
            eprintln!("orven: {}", gateway::diagnostic(error.as_ref()));
            std::process::exit(1);
        }
        return;
    }
    if let Err(error) = run() {
        eprintln!("orven: {error}");
        std::process::exit(1);
    }
}
fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let gateway_worker = args.first().is_some_and(|v| v == "--gateway-worker");
    let worker = gateway_worker || args.first().is_some_and(|v| v == "--audit-worker");
    let params = if worker { &args[1..] } else { &args[..] };
    if params.len() != (if gateway_worker { 5 } else { 4 }) || params[0] != "audit" {
        return Err(
            "usage: audit-host audit REPOSITORY FULL_COMMIT_ID EXISTING_PRIVATE_STORE".into(),
        );
    }
    if worker {
        if gateway_worker {
            use std::io::Read;
            let mut lease = [0];
            std::io::stdin().read_exact(&mut lease)?;
            if lease != [1] {
                return Err("worker lease unavailable".into());
            }
            // Parent retains the pipe writer. EOF also terminates an orphan after SIGKILL.
            std::thread::spawn(|| {
                use std::io::Read;
                let mut byte = [0];
                loop {
                    if std::io::stdin().read(&mut byte).unwrap_or(0) == 0 {
                        std::process::exit(1);
                    }
                }
            });
        }
        use nix::sys::resource::{Resource, setrlimit};
        // Apply before opening any untrusted Git object. Fail closed on unsupported limits.
        setrlimit(Resource::RLIMIT_CPU, 10, 10)?;
        // Loose object preflight bounds decompression. RLIMIT_AS is unsupported on macOS.
        setrlimit(Resource::RLIMIT_CORE, 0, 0)?;
        let registered = RegisteredRepository::register(params[1].as_ref(), params[3].as_ref())?;
        let commit = params[2].to_str().ok_or("commit must be UTF-8")?;
        let report = if gateway_worker {
            registered.audit_authorized(commit, params[4].to_str().ok_or("identity required")?)?
        } else {
            registered.audit(commit)?
        };
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
