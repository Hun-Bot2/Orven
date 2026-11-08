# Phase 2A — local desktop workspace

Implemented and reviewed 2026-11-08 on macOS Apple Silicon, Rust/Cargo 1.98.0 and Node 26.8.1. This is the local desktop portion of roadmap Phase 2. MCP publishing/authorization, assistant interoperability, chat handoffs and remote execution remain later work. No connections, findings, security events, certainty scores or mutation counters are simulated in the installed application.

## Scope and responsibilities

The lead independently inspected Git state, all four outside PNGs, ZIP HTML/design notes, the approved architecture and core implementation. Terra extracted [the design specification](design-reference.md). The lead compared it with the supplied Option A screenshots and established [shared UI contracts](ui-contracts.md) before assigning page work.

Terra implemented only HistoryPage, SecurityPage, scoped page CSS and three page-boundary tests. The lead reviewed those files, integrated them and corrected comparison wording and chart semantics. Evidence records and exclusion scope/path records are not combined into a coverage percentage. History bar lengths compare captured evidence counts on a common scale across displayed runs. No unknown security outcome is turned into a score.

The lead owns the React/TypeScript shell, tokens, bundled typography, navigation, workspace switcher, toolbar, shared tables/badges/dialogs, report and workspace pages, search, evidence sheet, transport/state, Rust registration/storage and Tauri security. No separate audit engine or new evidence schema was added.

## Implemented behavior

- Native folder selection registers a real canonical repository root. The frontend cannot submit an arbitrary root path. Registered roots and active selection persist in private application storage; duplicate selection reuses a project. Desktop project IDs bind roots to private project stores; existing core report repository IDs retain their original per-registration meaning.
- Project switching immediately clears report/evidence, rejects stale responses, and serializes selection persistence. Audit completion cannot select a report in a different workspace. A single desktop audit lock prevents concurrent runs; failure releases it. An OS file lock prevents two processes from editing the same workspace profile concurrently.
- A full commit ID invokes `RegisteredRepository::audit` and `save` on a blocking worker thread. The original read-only/loose-object/size/decompression constraints remain. Stored JSON is the actual core output; Markdown remains derived. The desktop uses the core's cooperative limits, not the headless CLI's process watchdog. There is no fabricated live AST stream, percentage progress or cancellation control.
- Listings read only finalized private runs within the registered project's store. Each report is size-bounded, schema/evidence/hash validated and matched to its run directory. Invalid and incomplete reports are explicitly counted as unavailable/incomplete, never successes. Cross-project IDs, traversal, symlinked report files and corrupted evidence are denied.
- Reports show actual observations, evidence hashes/ranges, source snapshots and exclusions. History shows actual saved runs. Search is local to captured paths. Evidence is escaped plain text, capped to 1,000 displayed lines per selected file; raw HTML/scripts are not interpreted. Clipboard failure is explicit rather than reporting a successful copy.
- Security separates implemented read-only policy from unverified OS isolation. ChatGPT/Claude are not configured; handoffs, event history and snapshot comparison are unavailable. No provider or remote runner is invoked.

## Frontend and native boundary

One Vite/React application under `desktop/`; no router, state framework or UI kit. Shared tokens define 240px rail, 54px toolbar, 340px inspector, 1px rules, flat panels and local Geist/Newsreader/JetBrains Mono fonts with system Korean fallbacks. The macOS titlebar overlays the toolbar with real native controls and a scoped drag region. This follows Option A without copying its unsupported runtime claims. Dark mode is not implemented; native and web surfaces explicitly use the validated light theme.

Six app commands are explicitly declared with Tauri's generated app-command permissions. Only the main local window receives them, plus `core:window:allow-start-dragging`. The dialog plugin is called from Rust; direct frontend dialog and filesystem/shell/plugin permissions are not granted. Rust independently checks window label/origin, project membership, canonical IDs, store permissions and report integrity. Production CSP permits local assets and IPC, with frames, objects, forms and external resource connections blocked. Development additionally permits the loopback Vite server/HMR.

The browser preview has a native-required state. A synthetic bridge exists only behind Vite's development flag, is visibly labeled in tests, and is absent from the production JS bundle. There is no default demo workspace, native-path fallback or fake report in the installed app. `ORVEN_DEV_DATA_DIR` is a debug-build-only startup override used to isolate native smoke fixtures from normal app data; it is not an IPC command or release setting.

## Validation results

| Check | Observed result |
| --- | --- |
| `cargo test --workspace --offline --locked` | 18 tests passed: 13 core, 1 CLI, 4 desktop |
| Actual Tauri command dispatch with MockRuntime | Main window accepted; another window/remote origin/direct dialog-plugin command denied; invalid audit releases busy state; real core audit/read and real registered-project switching succeed; cross-project and traversal reads denied |
| Workspace persistence/storage tests | Real synthetic repositories; persistent roots/selection; second profile open denied; invalid evidence/symlink files rejected; incomplete runs counted separately |
| `cargo clippy --workspace --all-targets --offline --locked -- -D warnings` | Passed |
| Rust formatting | Passed |
| `npm run build` / `npm run typecheck` | Passed; two non-failing Lucide `use client` bundler notices in this client-only app |
| `npm run format:check` | Passed |
| `npm test` | 9 Playwright tests passed, including Terra's 3 reviewed tests |
| `npm run tauri -- build --debug --no-bundle` | Self-contained native binary with embedded production assets built successfully; no installer or distribution generated |
| Native rendering | Real macOS window captured with the development server stopped, using two actual synthetic Git repositories registered through production Workspace code and audited by the original core |
| Dependency checks | npm: 0 known vulnerabilities. RustSec: 0 vulnerability entries, **2 informational advisories retained** in the cross-platform lockfile; see [receipt](phase-2a/security-check.json) |

Browser tests cover truthful empty and unavailable states (unavailable listings remain unknown, not zero), all reference screen families, evidence/script-text rendering, local-only asset requests, audit input/failure/success, stale report response after project switching, history selection, keyboard search/Escape, modal naming and 980px inspector behavior. They assert 240px sidebar and 54px toolbar geometry. The lead inspected the rendered screenshots against original Option A references and corrected native chrome, typography, chart semantics and missing modal accessibility naming.

RustSec warnings are `RUSTSEC-2024-0370` (`proc-macro-error` unmaintained) and `RUSTSEC-2024-0429` (GLib unsoundness). `cargo tree --target aarch64-apple-darwin --invert` confirms neither package is in the validated target graph. They remain unresolved for the cross-platform dependency graph; Linux and Windows are not validated or advertised. No advisory was ignored or silently patched across incompatible upstream versions.

## Captured evidence

The browser captures use clearly labeled synthetic transport fixtures and are **not** core-integrity or native IPC proof. The native capture uses actual core-generated stored reports from synthetic repositories, with no browser test bridge. Capture contents are not findings about a user's real repository.

- [Native report, standalone window](phase-2a/report-native.png)
- [Browser report](phase-2a/report-browser.png), [workspace](phase-2a/workspace-browser.png), [history](phase-2a/history-browser.png), [security](phase-2a/security-browser.png)
- [Evidence sheet](phase-2a/evidence-browser.png), [compact inspector](phase-2a/compact-browser.png)
- [Audit dialog](phase-2a/dialog-browser.png), [workspace switcher](phase-2a/switcher-browser.png)

Native capture proves startup, embedded rendering, bundled font availability, mixed-language workspace labels and reading stored reports through the real WebView/backend. It does **not** prove a physical end-to-end click sequence through the folder picker or audit dialog. macOS denied AppleEvents UI automation (`-1743`), so that interaction remains a manual validation gate. Tauri MockRuntime command tests are explicitly separate from native captures. No signing, notarization, clean-machine installation, full accessibility audit, dark appearance or live host connection is claimed.

## Run and next milestone

From `desktop/`, with Rust on PATH:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npm ci --ignore-scripts
npm run tauri -- dev
```

Select **Register repository**, choose an ordinary loose-object Git repository, then use **Run Audit** with its full commit ID. Project switching, saved reports/history, search and evidence use local stored data. The default macOS profile is `~/Library/Application Support/dev.orven.desktop`; its root and per-project stores must remain owner-only.

For a standalone local debug binary with embedded assets:

```sh
npm run tauri -- build --debug --no-bundle
../target/debug/orven-desktop
```

Phase 2A's implemented functionality and the listed automated/rendering checks are complete; native folder-picker/manual audit interaction remains unverified. Next is that manual gate and Phase 2B's exact-bundle publication consent, revocation/deletion behavior, three read-only MCP tools, transport authorization and actual ChatGPT/Claude receipts. Packed-object support and hard timeout/cancellation remain separate hardening gates. Do not expose the private report store directly or advertise full Phase 2 completion before those gates pass. No commits, pushes, provider calls or deployment occurred.
