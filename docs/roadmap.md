# Phased development roadmap

Phase 1 has an initial implemented slice; see [validation and scope restrictions](phase-1.md). Phase 2A local desktop work is implemented within the [recorded validation limits](phase-2a.md). Phase 2B local gateway is implemented; live hosts and native manual gates remain open in [its receipt](phase-2b.md). Later integration phases remain future work. Gates define evidence required to proceed; they are not completed checks. Phases 3 and 4 are optional independent extensions after Phase 2. The original documentation-only initialization is complete; implementation is now authorized incrementally.

## Phase 0 — Architecture baseline

**Completed in this change:** product scope, component boundaries, evidence contract, ADR register, contributor instructions, official-source compatibility review and this roadmap. **Not completed:** a build, schema implementation, native app, live MCP integration or deployment.

## Phase 1 — Prove the smallest local audit

Choose the first macOS architecture, published Rust/Tauri/rmcp versions and a Git reader. Create only the core and headless paths needed for a committed-snapshot audit, plus a minimal temporary compatibility spike for Tauri. No provider integration or network endpoint.

Build one deterministic vertical slice: register a root → resolve a commit → collect bounded evidence → make a versioned JSON report → render Markdown. Select explicit file/count/byte/runtime limits and initial secret-path exclusions. Remove throwaway spike scaffolding after recording its result; do not retain a second architecture.

**Exit gate:** a locked native build demonstrates the chosen stack; a synthetic repository yields correctly linked evidence and stable snapshot identity. Verify the target repository's content/index/refs/config are unchanged; hostile symlinks, external gitdirs/object alternates, malformed objects and limits fail closed. Show dirty/untracked exclusions, corrupt evidence rejection, interrupted-run handling and unknown check status. No target hooks, scripts, builds, tests or network requests execute. If the Git reader cannot meet this boundary, resolve ADR-002 before proceeding.

## Phase 2 — Desktop and actual assistant interoperability

Execution split: **2A** is the local desktop shell, registered project switching, existing-core audit execution, stored reports/history and evidence viewing using Option A. See [2A receipts and remaining manual gate](phase-2a.md). **2B** adds explicit publication/retention/revocation/deletion, MCP transports/auth and actual host interoperability. The full exit gate below is not met by 2A alone.

Add the Tauri viewer and native registration/run/export flow. Choose a small frontend. Implement scoped IPC and safe Markdown rendering. Under amended ADR-004, add the five consent-controlled workspace tools in headless stdio. HTTP remains deferred until authorization and host validation are available. Published bundles contain only previewed data; disabling publication removes access to those bundles without changing local source evidence.

Use an operator-configured supported tunnel for a ChatGPT private connection where available; it is connectivity, not a runner. Use Claude Desktop stdio for local integration. Provision no public endpoint automatically. Implement HTTP authorization before any Internet exposure.

**Exit gate:** native macOS capture demonstrates an offline audit and evidence navigation; IPC denied-window and path/ID tests pass. Actual Claude Desktop and ChatGPT sessions read the same approved source-free report projection, with correct schemas and no access to unpublished runs. Record versions, account policy, transport and negotiated revision; inspect provider-bound bytes. Test invalid IDs, missing evidence, pagination limits, disconnection, publication revocation and empty findings with incomplete coverage. Validate store permissions/deletion, script/HTML injection resistance and report freshness display. Inspector/API tests alone do not establish host support. If host entitlement is unavailable, retain the local milestone and mark that host gate blocked/unverified.

## Phase 3 — Optional remote runner for an offline Mac

Choose one runner OS, existing hosting/TLS/OAuth infrastructure and a bounded transfer format. Use a single-owner batch invocation of the existing headless executable; no queue service or job API. Provision an explicitly approved commit snapshot; separate acquisition credentials, audit execution, and bundle-serving permissions. Reuse the same report contract and MCP tools.

**Exit gate:** with the Mac asleep or disconnected, audit pre-provisioned commit A and read its approved report through ChatGPT and Claude remote connections. Prove unsent commit B/dirty changes are unavailable and never labeled current. Demonstrate wrong audience/scope/principal, expired/revoked access and traversal/oversized imports are denied; the serving process cannot read source snapshots. Reconnect and import a verified bundle without overwriting local history. Record runner identity, policy/version, origin, hashes and transport. Document what still depends on the operator's remote administrator; hashes do not attest execution integrity.

## Phase 4 — Optional Codex and Claude Code analysis

Implement one adapter at a time behind the same bounded evidence-input/candidate-finding contract. Choose a validated executable version, credentials, configuration isolation, target-OS process sandbox, egress allowlist and time/output/cost limits. Disable adapters by default. Do not add provider-specific skills or an agent framework.

**Exit gate:** actual adapter output passes schema and evidence-reference checks. Malicious repository prompts cannot start tools, read outside the approved package, load hooks/plugins, write source, or exfiltrate to another destination. Test missing executable/authentication, unsupported version, refusal, timeout, cancellation, malformed JSON, unknown token usage and budget exhaustion; deterministic reports survive all failures. Record provider/model/version where supplied and label nondeterministic analysis as inference. If confinement cannot be enforced, ship without that adapter.

## Phase 5 — Public release readiness

Review selected dependency licenses, packaging, signing/notarization, private-data exclusion, upgrade/schema compatibility, retention/deletion and concise setup instructions backed by actual commands. Choose supported OS/architectures from receipts; do not inherit support claims from Tauri's platform list. Verify installation on a clean machine.

**Exit gate:** publishable source and artifacts contain only synthetic examples; security boundaries and known limitations match tested behavior. Local-only use works without provider credentials or a remote account. Review exact external payloads and obtain publication authorization before upload. Public plugin-directory submission and managed hosting remain separate decisions with their own requirements.

## Deferred until evidence justifies them

Worktree capture; execution of tests/builds; remediation; multi-user SaaS; automatic Git/cloud synchronization; distributed scheduling; vector databases; a plugin marketplace; rich host widgets; background autonomous agents. Add one only for a concrete user workflow and an ADR covering its added authority and maintenance cost.
