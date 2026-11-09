# Shared desktop UI contracts

Approved implementation baseline, 2026-11-08. Lead independently viewed all four outer Option A PNGs and checked the ZIP HTML/design note against Terra's [extraction](design-reference.md). All references are Option A. The HTML's 240px rail and 340px inspector are the unscaled layout baseline; screenshots include presentation frames that are not product chrome. The original Phase 2A toolbar was 54px. The explicitly requested 2026-11-09 [UI refinement](ui-refinement/README.md) supersedes it with a 56px toolbar, traffic-light position `(16, 30)` and a 96px native leading safe area. Native window controls overlay the toolbar with scoped drag regions, never simulated circles. Final native optical/dragging verification remains open as recorded in that review.

## Ownership and files

One React/TypeScript application under `desktop/src`, Vite build, plain CSS and bundled local fonts. No router/state library or UI framework. `App.tsx`, `api.ts`, `types.ts`, `components.tsx`, `tokens.css` and `styles.css` belong to lead. Page-local components live in `pages/`; their CSS is scoped by page class. Native implementation lives in conventional `desktop/src-tauri/`; the existing Rust core/evidence contract is authoritative. Dependencies are selected/pinned by lead only.

Terra owns only `pages/HistoryPage.tsx`, `pages/SecurityPage.tsx`, `pages/pages.css` and page-specific tests/fixtures explicitly assigned later. It may import shared contracts, never modify global tokens, shell, navigation, IPC, capabilities, Rust or dependency files. No shared-file concurrent edits.

## Visual and component rules

`tokens.css` is authoritative. Use Geist for dense application text (13px with unitless 1.5 line-height), Newsreader for major 30px/1.2 editorial page titles, and JetBrains Mono for identifiers/code. Captions use semantic type tokens; small technical metadata retains the engineering density. System Korean fallbacks remain. All fonts are emitted as local bundled files for offline use; data-URL font inlining is disabled to preserve the existing font CSP. UI icons are Lucide, 16px/1.5 stroke in navigation, 14px controls, 18px dialog actions. Buttons center icons and text on the same flex line; table numbers are tabular. Layout uses 4/8/12/16/20/24/32/48px tokens, 1px rules, 5px control corners, restrained panel/popover radii and flat white sections. Semantic colors use OKLCH primitives with exact hex fallbacks; components consume role tokens through the existing compatibility aliases. Main editorial inset 40px; compact screens 24px. Responsive inspector overlays under 1100px; navigation remains usable at 980px minimum native width.

Shared exports from `components.tsx`: Badge (neutral/success/warning/danger/info), Button, PageHeading, Panel, EmptyState, Metric, Distribution, Table, Dialog, OpenReport, shortId, timestamp. Use these for tables/statuses/headers; no page-local lookalikes. `Table` supplies overflow, caption and header semantics. Dialog owns native modal focus containment/Escape/focus restoration. Evidence viewer and workspace switcher belong to lead. Do not use raw HTML injection. React escapes repository text; code is plain text with bounded rendering, never executable markup.

## Data and page behavior

All pages accept `PageProps` from `types.ts`: selected project, scoped run summaries, explicit loading/ready/unavailable history state, selected validated report, global busy flag, onSelectRun/onEvidence/onRun callbacks. They must not call Tauri or access files directly. Dates are actual report timestamps; every chart derives from run/evidence data. Exclusion scopes are not a file-coverage denominator: report bars describe hash-linked evidence records, history bars use a common captured-record count scale, and exclusion counts are shown separately. Missing report means an explicit empty state. Inventory observations are informational, never critical vulnerabilities or passing security assertions. Execution is skipped; model analysis unavailable. Do not infer certainty, compliance, network-byte counts, filesystem mutation counters or provider connectivity.

History selects runs via callback and derives snapshot counts/bars from the supplied summaries. Comparisons require real reports and compare captured path/content identity, not invented Git/AST deltas. Security shows implemented policy separately from unverified OS isolation, and disabled/unconfigured ChatGPT/Claude adapters; no fake access ledger. MCP connection creation, handoffs, security-event history and remote operation remain unavailable in Phase 2A.

Frontend transport is a typed command boundary. Production uses Tauri only; plain browser has an explicit native-required state. Browser tests inject an explicitly labeled synthetic test bridge in development only. No demo project/report fallback appears in the installed app. Switching projects clears report/evidence immediately; request generations reject stale responses. Only one audit runs per desktop process; completion cannot select a report in another workspace. Native registry persists real roots and opaque project/run associations; only native folder selection registers a repository. Rust revalidates window identity, registered project scope, report IDs/content and storage limits on each command. Frontend never passes arbitrary repository/report file paths to auditing or reading commands.

## Scope and evidence

2A covers shell, real project registration/switching, audit execution using existing core, stored reports/history and evidence navigation. This is the local part of roadmap Phase 2. MCP serving/publication/authentication and actual host interoperability are Phase 2B; no full Phase 2 completion claim until those gates pass. Browser screenshots validate rendered layout and interactions against synthetic fixtures; native screenshots and backend tests are separately reported.


Phase 2B retains this design system. Security/Handoffs pages receive typed gateway snapshots and dispatch explicit scope/decision/revocation callbacks; they own no filesystem or authorization logic. The shell owns polling, stale-response suppression and related-report workspace selection. Pending audit and report requests require a shared confirmation dialog; report approval additionally requires the frozen exact projection. No claimed client name is trusted identity. Unknown/unreachable gateway state is shown unavailable, separately from unsupported remote/provider capabilities. Native control calls run off the UI thread and retain the main-window/origin ACL.


## Account and chrome refinement, 2026-11-09

One AccountProvider shares the existing native authentication lifecycle between the
compact top-right AccountControl and AccountPanel in settings. A verified profile is
shown only after the native backend check succeeds. Loading, waiting, expired/revoked,
signed-out and unavailable states remain distinct; a failed recheck hides the cached
verified avatar. No credential enters JavaScript storage, and no second auth system
is introduced. The popover supports Escape, outside dismissal and focus return.

The current shell uses the sidebar for workspace navigation and a Settings modal
for account/security controls; redundant top navigation and workspace breadcrumbs
were removed. The sidebar scrolls while its bottom actions remain reachable.
At compact desktop widths,
Search, Run Audit and the account control remain visible. Browser zoom/reflow widths
use the existing modal Dialog for navigation. Actual native minimum width stays 980px.
Native CSP/capabilities, MCP controls and permission/consent handlers are unchanged.
See the [audit, screenshots and exact verification limits](ui-refinement/README.md).
