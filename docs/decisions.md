# Architecture decision records

Date: 2026-11-06. **Accepted** means chosen for this architecture; nothing here claims implementation. **Proposed** means a candidate that must pass its gate. **Open** means not selected. Keep this single register until its size warrants individual ADR files.

## ADR-001 — Shared Rust core with thin desktop and headless entry points

**Status: Accepted.** Rust, Tauri 2 and rmcp are product requirements. Keep audit policy, evidence and rendering in one reusable core library. Tauri calls it in process; the headless executable supplies CLI and MCP modes. Share data contracts, not a mandatory network daemon. Start with the three implementation units described in [architecture](architecture.md).

**Reason:** Desktop and optional runner must produce the same evidence without shipping a WebView on the runner. Modules inside these units are sufficient.

**Alternatives and consequences:** A desktop-only engine blocks headless reuse; microservices and provider-specific engines duplicate policy and add operation costs. Separate entry points require packaging and contract checks, but not a plugin framework, DI container, or language bridge. Phase 2A selects React/TypeScript, Vite and shared plain CSS; no router/state/UI framework. Native app-command permissions and Rust-side checks protect the local boundary. See [UI contracts](ui-contracts.md).

## ADR-002 — Committed-snapshot inspection, no repository execution

**Status: Accepted.** Initial audits inspect immutable committed Git trees without checkout. No builds, tests, hooks, package installation, code modification, network dependency lookup, or agent access to the live checkout. Store all outputs outside audited roots.

**Reason:** A “read-only command” can still execute hostile project scripts. Snapshot inspection provides reproducible scope with a smaller boundary.

**Alternatives and consequences:** Auditing a live worktree is more convenient but introduces races and escape paths. Sandboxed execution may add useful evidence later, but is a distinct product mode. Initial reports explicitly omit dirty/untracked changes, submodule contents and hydrated LFS data. Phase 1 selects git2 0.21.0 with a bounded loose-object preflight and in-memory object database. Actual macOS RLIMIT_AS failure is evidence for initially rejecting packed/delta storage; see [validation](phase-1.md). Linked worktrees/external storage remain denied. This narrows supported input without widening authority.

## ADR-003 — Evidence-first local files, model analysis optional

**Status: Accepted.** Versioned JSON is canonical; Markdown is derived. Use immutable per-run files with atomic finalization. Findings reference captured evidence and separate observation, inference and unknowns. The local deterministic workflow has no provider dependency.

**Reason:** Reports must remain inspectable and useful after a provider fails or credentials disappear.

**Alternatives and consequences:** A prose-only transcript loses provenance. SQLite, vector search and an event-sourced ledger have no demonstrated initial requirement. File storage needs explicit limits, deletion and revision rules; it is not an encrypted vault or tamper-proof audit log. Add an index only after measured query needs justify it.

## ADR-004 — Consent-controlled workspace MCP gateway

**Status: Accepted, amended 2026-11-08 by the explicit Phase 2B request.** Supersedes the previous three-tool, report-only proposal. One standalone `audit-host mcp PROFILE` stdio process manages every registered workspace, independently of Tauri. Local grants default deny and are bound to a concrete session, opaque workspace, root/Git directory identity and revocation epoch. Each exact audit and each frozen source-free report projection needs separate application consent. The five tools and precise limits are in [the gateway contract](gateway-contract.md).

**Reason:** The approved Phase 2B workflow explicitly requires assistant-requested audits and traceable handoffs. Reusing Core registration, snapshot inspection and validated reports keeps one audit engine while local consent prevents model instructions or host dialogs from granting authority.

**Alternatives and consequences:** No generic file/shell/execution tool, source publication, provider orchestration or conversation-history retrieval. Amended 2026-11-09 after actual Claude Cowork/Code subprocess failures: a profile permits up to eight isolated stdio sessions, with per-session grants/control/journals and a shared Core registry/report store. A profile-wide worker lease serializes MCP audits; no broker or duplicate audit engine is introduced. This supersedes the singleton restriction based on observed host behavior. Unix control socket permissions trust the owner OS account, not claimed client names. Atomic redacted JSON retains at most 16 briefs with 24-hour retention (cleanup while running or at next startup); stopped cleanup resumes next launch. Grants never persist. Directory capabilities and pinned inode checks address root replacement; they are not an OS sandbox. Report release records transport commitment, not provider receipt. Stdio traffic is verified with a synthetic client; actual host receipts remain open. HTTP/OAuth, tunnel deployment and desktop extensions remain disabled until separately validated. See [Phase 2B evidence](phase-2b.md).

## ADR-005 — Optional single-owner runner and bounded agent adapters

**Status: Accepted for boundaries; Proposed for concrete integration choices.** A remote runner uses the same headless executable on independently provisioned snapshots and serves only approved bundles. It does not synchronize the Mac. Optional outbound agent drivers receive an approved evidence package and cannot change core authority or evidence.

**Proposed interfaces:** Codex App Server over stdio; Claude Code non-interactive JSON output. These avoid assuming native Rust SDKs and stay behind a small internal input/result contract. Exact versions, authentication, configuration isolation, OS sandbox and provider terms remain unverified for this product.

**Reason:** Offline-Mac operation requires compute and data away from the Mac; adding optional providers must not make every audit network-dependent.

**Alternatives and consequences:** An always-on Mac relay fails when that Mac is offline. Managed SaaS tenancy, workflow engines, provider SDK sidecar services and model-to-model orchestration are deferred. A runner introduces operator trust and export risk; an adapter introduces executable/configuration/egress risk. Neither is enabled merely because its underlying protocol exists.

## Open questions and decision gates

| Question | Current assumption or candidate | Resolve by |
| --- | --- | --- |
| First supported OS/architecture | macOS Apple Silicon CLI validated with Rust 1.98.0; desktop built/rendered; manual picker gate pending | Phase 1: choose target and native toolchain, record exact versions |
| Versions/MSRV and Git reader | Rust 1.98.0; git2 0.21.0 loose-object reader selected. Tauri 2.12.5/rmcp 3.9.0 compiled in temporary spike; stdio integrated; live host gates pending | Phase 1: locked compile and hostile-layout tests |
| UI and storage retention | React/TypeScript/Vite bundled UI selected in 2A; local private files. Retention duration and encryption mechanism remain open | Phase 2: native prototype and deletion/permission checks |
| Working-copy auditing | Outside initial scope | Separate ADR with race-safe capture and dirty-state provenance |
| Host/account entitlement | Operator can enable custom MCP; account/workspace policy unknown | Phase 2: actual Claude Desktop and ChatGPT connection receipts |
| Remote hosting and identity | Single owner; existing TLS/OAuth infrastructure; runner OS and transfer packaging open | Phase 3: documented deployment choice and authorization tests |
| Agent execution and billing | External executables explicitly installed/authenticated by operator; no included model entitlement | Phase 4: protocol, confinement, budget and terms verification |
| Public distribution | Existing Apache-2.0 license; no hosted-data business or store submission selected | Phase 5: dependency, packaging and publication review |

Change an accepted boundary by superseding its ADR with rationale and migration consequences. Do not quietly convert a candidate into a confirmed implementation.
