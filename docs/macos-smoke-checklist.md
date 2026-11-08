# macOS and host smoke checklist

Use synthetic data only. The implemented gateway uses Unix-domain sockets and Unix filesystem APIs; the validated target is macOS Apple Silicon. Other Unix targets and Windows are unverified. This is a manual checklist, not a record of passed native or host tests. Stage A automated protocol results are recorded separately in [Phase 2B](phase-2b.md). Do not alter OS privacy controls, host configuration, credentials or network exposure without the operator's explicit authorization. Stop and record unavailable/denied states instead of bypassing permissions. A real assistant call is an external disclosure and requires preview and authorization of the exact bundle and destination.

## Local native application

- Record date, macOS version, architecture, app build/commit, binary identity and test fixture identity. Do not record credentials, private paths or source.
- Launch the actual native window. Record native screenshot separately from browser fixture screenshots; verify scaling, Korean/English text, focus/keyboard navigation and compact window behavior.
- Register a synthetic repository through the native picker. Audit its full commit; inspect evidence, scope, exclusions, skipped execution and unavailable analysis. Confirm the target file/index/ref/config bytes are unchanged.
- Switch projects while a report loads; verify no stale cross-project result. Check missing, corrupt, incomplete and unavailable runs are labeled accurately. Check deletion/retention and owner-only store permissions within an authorized synthetic store.
- Exercise denied IPC/window, invalid IDs, malformed report/evidence and HTML/script content. Capture outcomes and exact errors without sensitive bytes.

## Stdio and Claude Desktop

- First verify local MCP protocol independently: protocol revision, initialize, tool list/schema, all five advertised tools (`list_workspaces`, `get_workspace_summary`, `start_audit`, `get_audit_status`, `get_audit_report`), invalid IDs, unauthorized workspace denial, pagination, disconnection and revocation. Confirm report projection excludes source and paths; there is no evidence-reading MCP tool. Confirm stdout is protocol-only.
- Preview exact synthetic bundle, intended destination and host scope. Only after explicit authorization, preserve existing Claude configuration and review the configuration example and macOS pathname in [compatibility](phase-2b-compatibility.md), then add only a narrowly scoped server entry using the official documented method; do not inspect unrelated entries or chat history.
- Record Claude version, transport, negotiated revision, advertised tools, exact synthetic requests and outcomes. Confirm unapproved report projections are inaccessible, revoke workspace access and retest. Remove only the test entry when authorized. Treat inspector/client success separately from actual Claude behavior.

## ChatGPT

- Verify workspace eligibility and relevant Platform tunnel permissions with the operator; unknown entitlement is not a pass. No tunnel, credentials or endpoint should be provisioned automatically.
- After separate authorization and exact synthetic bundle/destination preview, connect using a supported Tunnel or authenticated HTTPS arrangement and verify actual ChatGPT discovery and calls. Record plan/workspace policy, version/date, transport, revision, schemas and approved bytes without secrets.
- Test invalid IDs, unapproved scope, revocation, empty/incomplete data and disconnected tunnel. A sleeping Mac cannot serve fresh local data through a tunnel running on that Mac.

## Receipts and open gates

Mark each case passed, failed, skipped or unavailable, with dates and reproducible non-sensitive evidence. Native screenshots, automated tests, protocol inspector, actual Claude and actual ChatGPT are separate evidence levels. Phase 2 is not complete until its [roadmap gate](roadmap.md#phase-2--desktop-and-actual-assistant-interoperability) is satisfied; no smoke result establishes release, deployment or security certification.


Current native manual status: folder picker selection, UI-triggered audit, report selection and evidence navigation require an operator session; none is marked passed by this checklist. Prior Phase 2A AppleEvents denial remains respected. The Phase 2B native debug build and browser captures do not replace those interactions. Claude configuration is documented but unchanged, and current ChatGPT account/workspace eligibility is unknown.
