# Phase 2B — consent-controlled local gateway

Implementation and test receipts: 2026-11-08, macOS Apple Silicon, Rust/Cargo 1.98.0. Final repository/receipt review resumed 2026-11-09. The local implementation and automated protocol gates pass. **Phase 2 host interoperability is not complete:** no actual Claude Desktop or ChatGPT call is claimed. Nothing was committed, pushed, released, publicly exposed or sent to a provider.

## Implemented boundary

The standalone `audit-host mcp PROFILE` process uses rmcp 3.9.0 stdio and the existing Rust Core. It handles all registered roots for one host session, initially rejected a second gateway (superseded by the concurrent-session correction below), and survives desktop storage close/reopen. Host stdin EOF stops it and reaps active workers. No Tauri window owns its lifecycle. Registry/storage DTOs moved from the desktop module into Core; the desktop keeps a re-export. Exclusive registry writers remain separate from fresh read-only gateway readers.

The explicit Phase 2B request amends ADR-004. The five tools are `list_workspaces`, `get_workspace_summary`, `start_audit`, `get_audit_status`, and `get_audit_report`. Discovery/summary, audit requests and publication requests have independent default-denied workspace grants. Audit execution requires a separate local approval for the exact workspace, commit and validated argument digest. Report release requires preview and separate approval of the exact frozen, source-free metadata projection from a validated Core report. It is consumed once. No source/evidence reader, shell, arbitrary path, registration, network endpoint or agent-execution tool is available. See [full contract](gateway-contract.md).

Session UUID and revocation epoch bind authority; a stale grant dialog cannot authorize a replacement session; claimed client names are labeled untrusted. Transitions, response commitment and worker launch are serialized. The worker rechecks approved root/Git identities on opened directory handles. Core now uses cap-std 4.0.3 capabilities for Git reads and report writes, preventing path replacement from redirecting operations outside those handles. Revocation invalidates queued/running requests and frozen approvals; regrant cannot revive old consent. The owner-only local control socket trusts the same OS account, not a model or repository document.

A single fixed self-executable worker enforces 10 CPU/15 wall seconds, polls revocation/shutdown, and is killed/reaped on cancellation. A stdin lease detects parent disappearance. This is not an OS sandbox, and the desktop's existing in-process audits retain cooperative limits. Packed/delta storage and external Git layouts remain denied.

## Desktop and handoff records

Connections & Security now displays actual gateway availability, stdio session and independent access grants. Context Handoffs displays generated Task Briefs, redacted received arguments, workspace/session scope, consent, execution ID/status, fixed trace events, exact outbound preview/digest and a link to the real stored report. Explicit confirmation dialogs protect access edits and consent decisions. The shell owns polling, stale-response suppression and related-report workspace switching. Native control commands retain main-window/origin ACLs and run blocking socket I/O off the UI thread. Existing Option A tokens, shell and shared components are preserved.

Records distinguish explicitly supplied context from deterministic generated objectives, redacted argument displays, canonical validated argument digests, transport-bound projections and actual audit results. No full ChatGPT/Claude conversation history is fetched or reconstructed. Context is optional and at most 512 UTF-8 bytes; its plaintext is never retained. A private atomic JSON journal holds at most 16 briefs for 24 hours, with cleanup while running or at next startup. Grants never persist; old decisions expire and interrupted traces are marked terminated on restart. Failure to persist a consent/release decision fails closed; control persistence failure revokes in-memory grants. The journal is not encrypted or tamper-proof.

`released` means committed to MCP transport, not acknowledged by a host/provider. Failed delivery cannot be recalled or inferred successful; request new consent rather than replaying. Stored local reports remain full Core evidence reports; MCP releases only the deliberately narrower projection. Metadata/status reads are not stored as conversation content or a comprehensive security-event log.

## Initial verified receipts — see current correction below

| Check | Observed result |
| --- | --- |
| `cargo test --workspace --offline --locked` | 32 tests: 16 Core, 4 gateway units, 2 CLI/lease, 8 actual stdio integration, 2 Tauri command/origin tests |
| Local Stage A | Actual child process initialize/discovery, exact negotiation of 2024-11-05, 2025-03-26, 2025-06-18 and 2025-11-25; all five tools; protocol stdout only |
| Independent schema validation | Python jsonschema 4.26.0 checked actual advertised output schemas and real responses for all five tools, including denied, pending, completed and released cases; per-tool required fields were inspected. This is local protocol proof only |
| Consent and protocol | Default deny, fresh per-root grants, denial without execution, approval/Core completion, one-time projection equality, replay denial, revoke/regrant stale-consent denial, concurrent approval/revocation, restart deny and redacted retained records |
| Bounds and storage | Malformed JSON and >64 KiB frames close session; unknown/invalid tool arguments rejected; traversal, static symlinks, changed Git identity, pinned store after replacement, packed/decompression limits, report/evidence integrity and no target mutation |
| Lifecycle | Second gateway denied; graceful EOF cleans socket; Workspace writer can close/reopen while gateway stays live; new registration remains hidden until granted |
| Watchdog fault tests | Sleeping child killed/reaped on injected timeout, revocation and shutdown; gateway worker waits for lease and exits when parent closes it before authorization |
| Lint/format | Workspace Clippy with `-D warnings`, Rust fmt and frontend Prettier checks passed |
| Frontend | Production build/typecheck passed; 14 Playwright tests passed, including 5 new consent/scope tests; two existing Lucide directive notices remain non-failing |
| Tauri | `npm run tauri -- build --debug --no-bundle` built the embedded native application; MockRuntime tests cover new commands' local unavailable state and denied remote/other-window dispatch |
| Dependency checks | Refreshed RustSec DB commit 309392b18f6b17022f82c701f300433126901068, 1,422 advisories: 469 locked dependencies, zero vulnerability entries and the two retained informational warnings. npm advisory query: zero vulnerabilities |

Rust socket tests and Playwright required sandbox escalation for local sockets/loopback; a restricted-sandbox failure was not counted as a pass. No macOS privacy permission was bypassed. Browser captures in `desktop/test-results/synthetic-gateway-handoff.png` and `synthetic-gateway-approval.png` were inspected by Terra and the lead; they show synthetic fixtures, not native or live-host behavior. Existing Phase 2A screenshots remain historical.

## Host compatibility and remaining gates

**Stage B — Claude Desktop:** the documented local stdio path is implemented and reproducible using the [review-only configuration fragment](phase-2b-compatibility.md). Installed Claude metadata reports 4.23118.0. Its configuration and private chats were not read/modified, and no actual tool call was made. Install presence and synthetic MCP traffic are not host compatibility receipts. Extension packaging is deferred.

**Stage C — ChatGPT:** [official custom MCP requirements](https://developers.openai.com/api/docs/guides/custom-mcp-server) require a supported URL or Secure MCP Tunnel and appropriate workspace permissions. [Tunnel documentation](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) permits forwarding to stdio with correct Platform/workspace associations and a runtime key. Account/workspace eligibility and credentials are unknown; no tunnel or public endpoint was provisioned. ChatGPT connectivity is blocked/unverified, not unsupported by assumption. See [research and advisory impacts](phase-2b-compatibility.md).

Remaining Phase 2A/native gate: manually select a folder, run an audit, switch repositories, view reports and navigate evidence in the actual macOS app. Prior AppleEvents automation was denied; the [manual checklist](macos-smoke-checklist.md) preserves that boundary. A native build and synthetic browser screenshots do not close it.

Packed-repository memory confinement remains unresolved. Watchdog branch tests do not prove CPU-limit exhaustion, abrupt gateway SIGKILL during an actual audit, every metadata-swap schedule, power-loss durability or complete accessibility. Simultaneous desktop/gateway audits create separate immutable run IDs; there is no profile-wide scheduler or desktop hard-cancellation claim. The initial singleton restriction is superseded by the concurrent-session correction below.

The two advisory impacts remain explicit: proc-macro-error 1.0.4 is unmaintained with no patched release; upstream GTK macro migration/replacement is needed. glib 0.18.5 has VariantStrIter undefined behavior, affected 0.15..<0.20, fixed >=0.20. Neither is in the verified aarch64-apple-darwin graph. GTK/Linux/BSD dependency-stack upgrades and runtime reachability remain unverified; no global advisory exemption was added.

There is no in-app purge command for retained handoffs. For an operator-requested deletion, stop the gateway and remove only its private `handoffs.json`; restart restores no grants. Automatic TTL cleanup cannot run while the process is stopped. Neither deletion nor revocation recalls metadata already delivered to a host; report-store deletion/import/export UX remains a later gate.

**Stage D / remote:** Codex and Claude Code remain optional outbound adapters behind approved bounded evidence packages; no unrestricted agent execution or orchestration is implemented. A future remote runner must use independently provisioned snapshots and separate authenticated transport. No tunnel can reach unsent changes on a sleeping Mac. Provider confinement, HTTP/OAuth, remote transfer/import and signing/release remain disabled future milestones.

## Delegation and review

Terra handled official-source/advisory research, the native checklist, isolated Security/Handoffs page UI/CSS, browser fixtures, old-label test corrections, rendered captures and actual stdio integration tests. The lead reviewed the original contracts and rendered captures, retained ownership of Core capability hardening, permission/consent semantics, gateway framing/lifecycle, journal privacy, Tauri ACLs, shell state/navigation and final integration checks. No authorization work was delegated. Source-level fixes followed observed failures (malformed codec behavior, argument replay binding and durable revocation), not an unapproved redesign.


## Current correction — concurrent host sessions, 2026-11-09

This supersedes the earlier singleton receipt and limitation above. A user-provided Claude log showed initialize and tools/list succeeding in one process while additional Cowork/Code processes repeatedly closed. Local process-parent inspection confirmed Claude owned the old profile lock; Codex was not required to reproduce the architectural conflict. The fix allows up to eight per-connection processes sharing Core registry/report services, with isolated grants, control sockets and journals. Shared MCP audit execution uses a profile-wide lease. No root lock file is deleted or bypassed, and no network broker is introduced.

Connections & Security now lets the operator select a full session identity through an untrusted client label and short display ID. Switching clears stale dialogs/results; a disconnected session stays stopped and cannot confer grants on another connection. Fixed startup diagnostics replace the blanket gateway-unavailable message. Old running Claude/Codex/Orven processes must be restarted to load the replacement binaries. Actual updated-host reconnection is not claimed before that restart.

Current checks: 35 Rust tests, including nine actual stdio protocol tests and six gateway units; 17 browser tests, including eight gateway UI cases; workspace Clippy with warnings denied, formatting, production frontend build and native debug build. New tests cover simultaneous sessions, independent discovery/consent/revocation, ambiguous control denial, stale session recovery, one session closing while another stays usable, connection cap/diagnostics, shared execution lease, unsafe lease symlinks and bounded inactive-session cleanup. Terra implemented isolated selector/state/frontend tests; the lead implemented and reviewed all authorization, session routing, worker lease and lifecycle changes and inspected the synthetic rendered selector. No Cloudflare implementation, repository-writing handoff, provider execution, commit, push or deployment was added in this correction. The Workers contract was supplied in the conversation as requested; local full-content handoff import remains future work.
