# Phase 1 implementation and validation

Date: 2026-11-06. Target: macOS Apple Silicon (`aarch64-apple-darwin`), rustc/Cargo 1.98.0. This is a local committed-text inventory slice, not a general security scanner. No desktop UI, MCP endpoint, external model, remote runner, signing or release is implemented.

## Implemented boundary

- Shared `audit-core`: operator-owned repository registration, store overlap/permission denial, full SHA-1 commit selection, bounded object inspection, evidence hashes/ranges, manifest identity, observation/reference validation, explicit skipped execution/unavailable analysis, derived escaped Markdown, unique owner-only runs and atomic finalization.
- `audit-host`: fixed audit CLI, own worker subprocess, no shell or target command execution. The worker applies a 10-second CPU limit and disables core dumps; its parent enforces a 15-second wall deadline. Core library traversal uses cooperative 10-second checks. These are distinct controls: direct library callers do not inherit the CLI watchdog.
- Git reader: git2 0.21.0 with default features disabled, backed by libgit2-sys 0.18.8+1.9.7. A standalone in-memory object database receives only preflight-validated loose objects. It never opens repository configuration, index, refs, hooks, filters or network helpers. Config remains inert audit input.
- Data limits: 256 KiB per expanded loose object; 8 MiB cumulative expanded object input; 10,000 selected-tree entries; tree depth 32; Git metadata preflight limited to 20,000 entries, depth 32 and 128 MiB stored size. Zlib expansion and object identity are checked before libgit2 parses objects. History/unreachable loose objects count toward the preflight limits too.

**Deliberate restriction:** packed/delta objects, nonordinary `.git` layouts, alternates, external gitdirs, SHA-256 repositories and Git object-directory environment overrides fail closed. Full 40-hex commit IDs are required; branch/ref resolution is not implemented. Large excluded blobs also fail preflight rather than bypassing the resource bound. Do not repack or modify a target repository just to bypass these restrictions.

A real CLI test found that `RLIMIT_AS` returns `EINVAL` on this Mac. It was not silently ignored: packed-object support was restricted and bounded loose-object preflight plus an in-memory database were introduced instead. This is not an OS memory sandbox. OS resource APIs are documented by [nix](https://docs.rs/nix/0.31.3/nix/sys/resource/fn.setrlimit.html); the macOS rejection was observed locally. Resource-limit fault injection, peak-RSS measurement and packed-object support remain follow-up hardening work, not verified guarantees.

The store must be an existing owner-only directory outside the repository. Each run is finalized by rename after its files are synced. Failed/interrupted writes retain a `.incomplete-*` directory; no reader/server exists yet, and later readers must ignore it. This establishes atomic visibility, not proven power-loss durability. Audits assume the owner does not concurrently replace Git metadata or the store while inspection/save runs. A compromised owner account remains outside the threat model. No local source/evidence is published by this implementation.

## Verified results

Primary independently reviewed Terra's manifests/tests, corrected compile/API and policy issues, and reran the complete checks:

| Check | Result |
| --- | --- |
| `cargo build --workspace --offline --locked` | Passed native target |
| `cargo test --workspace --offline --locked` | 13 core integration tests + 1 actual CLI integration test passed |
| `cargo fmt --all -- --check` | Passed |
| `cargo clippy --workspace --all-targets --offline --locked -- -D warnings` | Passed |
| `cargo audit` 0.22.2 on root Cargo.lock | No known vulnerabilities or informational warnings; advisory database commit `26fd2d43f7280a1fb925a3743ec463017afe7119`, updated 2026-11-05 |
| Independent temporary Tauri/rmcp spike | Native `cargo build --offline --locked` passed with Tauri 2.12.5 defaults and rmcp 3.9.0 (`server`, `transport-io`); temporary source removed |

Tests cover stable manifest identity; committed versus dirty/untracked content; complete before/after repository file-byte comparison including index/refs/config; secret-path exclusion; symlink, submodule, LFS and non-UTF8 exclusions; external storage denial; malformed objects; compressed expansion/large objects; deep trees; corrupt evidence/broken references; unknown schema fields; escaped HTML paths; private modes; repeated saves; interrupted directories; malformed configuration/hook nonexecution; and actual worker success/failure behavior.

The Tauri/rmcp spike only compiled a Tauri Builder and rmcp server role in one executable. It did not create a window, exercise Tauri permissions, run MCP negotiation or connect to ChatGPT/Claude. Its temporary transitive lock is not the product lockfile. The dependency audit covers the retained core/host lockfile, not future desktop/MCP dependencies. No advisory result proves absence of vulnerabilities.

## Delegation and next gate

Terra handled workspace scaffolding, temporary compatibility exploration and synthetic/core/CLI integration tests. Primary owned core, security policy, worker coordination, fixes, documentation integration and independent verification. No commits or pushes were made.

Phase 1's implemented slice passes the listed tests within its declared loose-object scope. Packed repositories, concurrent metadata replacement, hard timeout fault injection and power-loss behavior remain explicit limitations. Phase 2 introduces the native viewer and three read-only MCP report tools only after publication consent/access controls are implemented. It must not expose the private report store directly or advertise live host support before actual host receipts exist. Resolve the packed-object resource boundary separately before widening reader support.
