# Orven
Bridge AI assistants and local workspaces through MCP, turning discussions into traceable reports.

Orven is a planned **Local-first Engineering Audit Hub** built with Rust, Tauri 2, and rmcp. It will inspect repositories without modifying them, retain inspectable evidence, and make selected reports available to ChatGPT and Claude. Codex/Claude Code analysis adapters and a remote runner are optional extensions.

**Status: Phase 2A local desktop workspace implemented, 2026-11-08.** The Tauri app registers and switches real repositories, invokes the existing Rust core, and displays actual saved reports and evidence using the supplied Option A design. MCP serving, provider adapters, handoffs and remote execution remain unavailable. See [Phase 2A validation and screenshots](docs/phase-2a.md) and [Phase 1 limitations](docs/phase-1.md).

## Product boundary

- A useful local audit and report viewer must work without an account, model, or network.
- The initial audit reads an immutable committed Git snapshot. It does not run repository code, build scripts, hooks, tests, package managers, or remediation commands. Dirty/untracked files are explicitly outside initial coverage.
- Evidence and structured reports live in application data, outside the audited repository. Recommendations remain distinguishable from observations and executed checks.
- ChatGPT and Claude are MCP clients of the hub. Sending reports to either crosses a provider boundary even when the MCP process runs locally.
- An opt-in remote runner can audit a separately authorized snapshot while the Mac sleeps or is offline. It cannot retrieve unsent Mac changes. A completely disconnected Mac can still inspect its existing local reports.

This public source project is not a public repository-data service. Source availability grants no access to users' repositories or reports. The existing [Apache-2.0 license](LICENSE) is preserved; no publication or distribution has been performed.

## Planning documents

| Document | Purpose |
| --- | --- |
| [Architecture](docs/architecture.md) | Components, evidence contract, MCP surface, security boundaries, and offline behavior |
| [Decisions](docs/decisions.md) | Small ADR register with accepted decisions and deferred choices |
| [Compatibility](docs/compatibility.md) | Dated official-source verification and remaining proof obligations |
| [Roadmap](docs/roadmap.md) | Phases with concrete acceptance gates |
| [AGENTS.md](AGENTS.md) | Shared contributor and coding-agent instructions |

## Build and run

First validated target: macOS Apple Silicon with Rust/Cargo 1.98.0. Dependencies are locked in Cargo.lock. Initial dependency download needs network; audits do not.

```sh
cargo build --locked --workspace
cargo test --locked --workspace
mkdir -m 700 /tmp/orven-reports
cargo run --locked -p audit-host -- audit /path/to/repository FULL_40_HEX_COMMIT_ID /tmp/orven-reports
```

The store must already exist, be owner-only, and sit outside the repository. The CLI prints the finalized run directory containing report.json and report.md. No data is published or sent to a provider.

**Initial restriction:** ordinary SHA-1 repositories with loose objects only. Packed repositories, linked worktrees, external object stores and oversized objects fail closed. Every loose object is preflighted, including unreachable/history objects: limits are 256 KiB per expanded object and 8 MiB total. Inventory coverage is limited to selected text formats; dirty/untracked files, symlinks, submodules, binary content and hydrated LFS data are excluded. An inventory observation is not a vulnerability finding or evidence that tests passed.

## Native desktop

```sh
export PATH="$HOME/.cargo/bin:$PATH"
cd desktop
npm ci --ignore-scripts
npm run tauri -- dev
```

Register a repository using the native folder selector, then enter a full commit ID in **Run Audit**. Project selection and local report history persist across sessions. Reports stay in owner-only application data outside target repositories. The UI contains no default demo data or simulated assistant connections.

For a self-contained debug binary, run `npm run tauri -- build --debug --no-bundle`, then `../target/debug/orven-desktop`. This embeds local assets/fonts and does not require the development server. No signing/installer/release validation is implied.

Next milestone: the remaining native manual interaction gate and Phase 2B's explicit report publication, read-only MCP and actual host interoperability. Packed-object support remains a separate hardening gate.
