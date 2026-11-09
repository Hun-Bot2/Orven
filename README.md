# Orven
Bridge AI assistants and local workspaces through MCP, turning discussions into traceable reports.

Orven is a **Local-first Engineering Audit Hub** built with Rust, Tauri 2, and rmcp. It inspects committed repositories without modifying them, retains evidence, and offers consent-controlled report metadata through MCP. ChatGPT and Claude are intended hosts; live interoperability remains unverified. Codex/Claude Code analysis adapters and a remote runner are optional extensions.

**Status: Phase 2B local MCP gateway implemented, 2026-11-08.** The desktop uses real registered repositories and Core reports. A separate stdio gateway provides workspace-scoped consent, audit requests and one-time source-free report release. Actual Claude Desktop/ChatGPT connectivity remains unverified; provider adapters and remote execution remain unavailable. See [Phase 2B validation](docs/phase-2b.md), [Phase 2A](docs/phase-2a.md) and [Phase 1 restrictions](docs/phase-1.md).

## Product boundary

- A useful local audit and report viewer must work without an account, model, or network.
- The initial audit reads an immutable committed Git snapshot. It does not run repository code, build scripts, hooks, tests, package managers, or remediation commands. Dirty/untracked files are explicitly outside initial coverage.
- Evidence and structured reports live in application data, outside the audited repository. Recommendations remain distinguishable from observations and executed checks.
- ChatGPT and Claude are intended MCP clients of the hub. Sending reports to either crosses a provider boundary even when the MCP process runs locally.
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

## Local MCP gateway

Build `audit-host`, then configure a local MCP host to run the absolute executable with `mcp` and the existing desktop profile as separate arguments:

```sh
cargo build --locked -p audit-host
./target/debug/audit-host mcp "$HOME/Library/Application Support/dev.orven.desktop"
```

This command expects MCP protocol frames on stdin and reserves stdout for protocol. Up to eight isolated MCP connections per profile handle the shared registered repositories. Select the intended connection in Connections & Security; grants do not propagate between connections. Starting it grants no workspace access. In **Connections & Security**, confirm the current session and explicitly grant workspace scopes. In **Context Handoffs**, review and approve/deny each audit or exact report projection. `start_audit` returns a pending request; retry the same arguments with its request_id after approval, then poll get_audit_status. Report retrieval likewise requires preview, approval and one retry. Closing the desktop leaves the gateway running; host stdin EOF stops it. The gateway neither launches nor configures assistant apps.

See [tool/consent contracts](docs/gateway-contract.md), [host setup and official requirements](docs/phase-2b-compatibility.md), and [manual macOS checklist](docs/macos-smoke-checklist.md). No full chat history is retrieved. No source excerpts or paths are transmitted by the report tool. A host may share returned metadata with its provider.

Next milestone: actual permitted Claude Desktop/ChatGPT receipts and the native picker/audit/evidence manual gate. Packed-object support, desktop hard cancellation, HTTP authorization and additional remote-host validation remains a separate gate. Remote execution and provider adapters stay disabled.

## GitHub desktop account

**Phase A.1 is implemented; on 2026-11-10 the operator reported successful GitHub
progression to the account-confirmation page.** In **Settings**, use **Sign in with GitHub**.
The system browser completes GitHub login and asks you to confirm the account before
returning to Orven. A separate revocable credential lives in macOS Keychain; account
sign-in grants no repository or MCP access. See [configuration, protocol, test evidence
and manual verification](docs/desktop-auth.md). The operator applied the remote
migrations and deployed the Worker; restart restoration and revocation remain
separate live checks. MCP OAuth and cloud MCP tools are not implemented by this phase.


The [desktop UI refinement audit](docs/ui-refinement/README.md) records the current
white-first visual system, shared toolbar/settings account state, before/after
screenshots, accessibility/contrast receipts and the remaining native visual gate.

For local release `.app` and `.dmg` artifacts, run `npm run package:macos` from
`desktop/`. See [macOS packaging and verification](docs/macos-packaging.md) for output
paths, ad-hoc signing and the remaining native/distribution gates.
