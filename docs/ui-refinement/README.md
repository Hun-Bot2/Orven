# Orven desktop interface review and refinement

Date: 2026-11-09. Toolkit: [Jakub's skills](https://jakub.kr/skills), inspected from
[jakubkrehel/skills](https://github.com/jakubkrehel/skills). The official installation
entry point is `npx skills add jakubkrehel/skills`. For this review, the Codex
skill-installer downloaded the requested skill folders into temporary storage, without
installing provider instructions or modifying Orven's shared AGENTS.md.

Applied `interface-review`, `better-layout`, `better-typography`, `better-colors`,
`better-ui`, `better-writing`, and `better-accessibility`; `better-interface` supplied
their shared ranking and coverage format. They were applied as instructions, not
claimed as executable slash commands. The temporary download does not register
persistent slash commands in the desktop or the repository.

## Scope and evidence

The requested audit covers desktop chrome, account states, shared tokens/components,
and Connections & Security. Reports and evidence navigation received screenshot and
regression checks; History and Handoffs received regression checks rather than a
complete visual audit. This is not a whole-product WCAG certification or a remote
authentication/interoperability receipt.

`interface-review` was used for change causality, and `better-interface` for the
broader screen audit explicitly requested by the user. At start, HEAD was
`619fc4a83903058dc9a7c6d8f50a9f2e40324084`, two commits ahead of the local `origin/main`
merge base `badc6f008f13a2beeb14b9ff2ce3a8c8b6c6f47c`. The worktree already contained
Phase A.1 changes, including untracked account components. Those were preserved.
Generated files, dependency internals, lockfiles and binaries were excluded from
the UI change review; screenshots were inspected as rendered evidence.

Project conventions read: AGENTS.md, README.md, architecture, decisions, roadmap,
UI contracts and the existing React/plain CSS/Tauri implementation. No translation
catalogue exists in this frontend; existing workspace/account terminology was kept.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Account controls, popover, access dialog, native disclosures; axe, keyboard dismissal/return, focus and skip link | Automated browser checks pass; VoiceOver unverified |
| Layout | Native baseline, shell/account/security screenshots, long Korean/English workspace names, 1440/1280/980/640/490/320 widths | Browser checks pass; final native optical/dragging gate open |
| Writing | Account errors, state labels, security warnings and consent copy | Duplicate headings/diagnostics reduced; warnings and consent consequences retained |
| Typography | Existing Geist/Newsreader/JetBrains Mono faces; headings, captions, wrapping and packaged fonts | Role hierarchy clarified; local font packaging fixed |
| Colors | Existing semantic roles, rendered canvas-resolved color pairs and OKLCH fallbacks | Tested text ≥4.5:1 and input/focus pairs ≥3:1 |
| UI polish | Border/header treatment, button hit targets, selected navigation, popover and titlebar safe area | Browser verified; native geometry measured separately from paint |

## Prioritized findings before implementation

These were reported to the user after capturing the baseline and before modifying UI
code. `Introduced` identifies the pre-existing uncommitted A.1 account work; it is not
a claim that this refinement introduced the defect.

| Severity | Domain | Causality / location | Before | Change | User impact |
| --- | --- | --- | --- | --- | --- |
| HIGH | Colors / accessibility | Pre-existing; `desktop/src/tokens.css`, captions on gray surfaces | Muted text `#727279` on rail `#f3f4f3`: 4.33:1; on subtle `#eeeeed`: 4.11:1 | Darker semantic muted text; measured again | Normal text must reach 4.5:1 under WCAG 1.4.3 |
| HIGH | Accessibility | Pre-existing; shared input/control styling | Strong border `#c7c6cb` on white: 1.70:1 | Separate input-boundary and focus tokens, 3.35:1 and 6.71:1 | Form boundaries/focus need discernible non-text contrast, 1.4.11 |
| HIGH | Writing / state clarity | Introduced in A.1 worktree; `AccountPanel` | Failed re-verification could leave a cached verified profile visible beside an error | One shared controller; verified identity hidden while checking or unavailable | Avoids falsely presenting a backend-unverified session as authenticated |
| MEDIUM | Layout | Introduced omission in A.1 worktree; `App` toolbar | Account available only deep in settings | Compact account control and keyboard-accessible popover, using the same AccountPanel/native adapter | Account status remains visible without opening settings |
| MEDIUM | UI polish | Pre-existing; Tauri traffic-light position / `.brand` | Native baseline's traffic-light center and brand ink differed by about 7.75 CSS px | 56px toolbar, traffic-light y=30, 96px physical leading safe area, explicit brand drag region | Corrects intended geometry; final optical/native paint verification remains open |
| MEDIUM | Layout | Pre-existing; compact toolbar | Search removed at ≤1100px; duplicate top navigation consumes remaining room | Search retains an icon target; top navigation yields to existing sidebar; accessible navigation dialog at zoom/reflow widths | Primary actions remain reachable at supported desktop sizes and narrow reflow widths |
| MEDIUM | Layout / writing | Pre-existing; Security panels | Gray headers, nested outlines and repeated gateway explanations have equal emphasis | White document-like sections, one state summary, disclosures for diagnostics/implementation detail | Account and workspace access are easier to find; policy warnings remain |
| MEDIUM | Typography / packaging | Found during native verification; Vite build | 11 font subsets became data URLs rejected by `font-src 'self'` | Emit fonts as local files with `assetsInlineLimit: 0` | Preserves the restrictive CSP and intended typefaces |
| LOW | Typography / UI | Shared component styles | Mixed caption conventions, inconsistent spacing, small targets | Semantic type/space/radius tokens, 32px controls, useful wrapping and focus styles | Improves scanability and consistency without replacing the visual identity |

Final review also corrected label-in-name mismatches (WCAG 2.5.3): account controls
now include their visible state/action text in the accessible name, and the workspace
switcher includes the visible repository name and snapshot. These checks were added
to the state matrix rather than treating an axe pass as complete accessibility proof.

The broader review also exercised 320px browser reflow, skip navigation, selected
navigation semantics, missing avatars, expired/revoked sessions and all account states.
No auth/permission policy was changed for appearance. Native credential rejection now
returns the presentation state `expired` after the same existing credential deletion;
it does not change validation or revocation. "Session ended" deliberately covers both
expiry and revocation instead of claiming their cause can be distinguished.

## Before / after screenshots

Browser comparisons use synthetic repository/profile fixtures. The matched security,
report, compact-inspector and account settings pairs retain the same fixture family.
Additional state and resize captures use a deliberately long workspace/profile name.
The avatar fixture is intentionally synthetic, not a live GitHub identity.

| Surface | Before | After |
| --- | --- | --- |
| Connections & Security, unavailable services | [Before](before/security.png) | [After](after/security.png) |
| Report and evidence hierarchy | [Before](before/report.png) | [After](after/report.png) |
| Compact evidence inspector | [Before](before/compact.png) | [After](after/compact.png) |
| Authenticated account settings | [Before](before/account-authenticated.png) | [After](after/settings-authenticated.png) |
| Account unavailable | [Before](before/account-unavailable.png) | [After](after/settings-unavailable.png) |
| Real macOS window | [Native baseline](before/native-titlebar.png) | **Not visually verified** — see native limitation below |

Additional captures: [1440px](after/security-1440.png), [980px](after/security-980.png),
[490px reflow](after/security-490.png), [320px reflow](after/security-320.png),
[account popover](after/account-authenticated.png), [missing avatar](after/account-missing_avatar.png),
[signed out](after/account-signed_out.png), [pending](after/account-waiting.png),
[loading](after/account-loading.png), [session ended](after/account-expired.png),
[network error](after/account-error.png).

## Verification

| Check | Actual result |
| --- | --- |
| Baseline `npm test` from `desktop/` | 21 passed before implementation; screenshots captured and inspected |
| Refined `npm test` from `desktop/` | 26 passed, including original workspace/gateway regressions and five new UI verification tests |
| `npm run typecheck`, `npm run build`, `npm run format:check` | Passed; one old fixed-height test was updated from 54 to the intentional 56px contract |
| `npm run test:production` | Built assets rendered with the native CSP injected into an isolated local preview; one shell, no JS errors or CSP violations |
| Axe WCAG A/AA/2.1/2.2 tagged checks | Zero violations on the inspected security, account popover and access-dialog states; incomplete checks remain recorded |
| Rendered contrast tests | All ten tested pairs passed their applicable thresholds |
| Browser resizing / appearance | 1440, 1280, 980, 640, 490 and 320px passed; light appearance stays white under a dark system preference and reduced motion |
| `cargo test --workspace --locked --offline` | 42 passed; one opt-in real Keychain test ignored (not needed for this UI-only refinement) |
| `cargo clippy --workspace --all-targets --offline --locked -- -D warnings`, `cargo fmt --all -- --check` | Passed |
| Native debug executable / local debug .app | Built locally; no signing, distribution or live-auth claim |

Receipts: [contrast](after/contrast.json), [account matrix](after/account-states.json),
[production CSP](after/production-csp.json), [axe security](after/axe-security.json),
[axe account](after/axe-account.json), [axe access](after/axe-access.json),
[native geometry](after/native-geometry.json).

Measured examples: muted-on-rail **5.09:1**, muted-on-subtle **4.69:1**, normal
secondary text **8.80:1**, primary action text **6.71:1**, input boundary **3.35:1**.
These are measured pairs, not a claim that every pixel or state meets every WCAG
criterion. Axe incomplete results, VoiceOver and native zoom remain manual checks.
The 490px browser check models reflow at 200% of a 980px viewport; it is not an actual
native WebView zoom receipt. RTL and a dark theme are not claimed as supported.

### Native capture limitation

A real native baseline was captured. During after verification, window-only captures
were blank or unavailable while temporary, subsequently removed WebView diagnostics
confirmed a mounted shell, a 1440×1000 viewport and brand bounds x=96, y=19,
45.6875×17. Browser production assets rendered correctly. The remaining failed
[native capture](after/native-unverified.png) is failure evidence, **not an after
rendering proof**.

PID-specific foreground attempts did not activate the verification app. macOS then
denied System Events automation with error `-1743` ("Not authorized to send Apple
events to System Events"). This is an OS automation denial, not a passing native
check or a reason to weaken application permissions. No automation/privacy setting
was changed. Temporary diagnostics were removed from the final source.

After launching the final local app normally, manually check the brand/traffic-light
optical alignment, drag empty titlebar/brand areas, click Search/Run Audit/account,
resize between 980px and wide desktop sizes, and walk the account popover and settings
with VoiceOver. The initial blank captures have no confirmed single root cause;
successful DOM geometry and browser production rendering do not prove native painting.

## Files and boundaries

- `tokens.css`, `styles.css`, `account.css`, page CSS: semantic palette, typography,
  spacing, surfaces, safe area and reflow. OKLCH values were converted with culori;
  exact hex fallbacks remain. No new runtime UI/color dependency is shipped.
- `AccountContext.tsx`, `AccountControl.tsx`, `AccountPanel.tsx`, `main.tsx`: the existing
  account lifecycle is shared by the toolbar and settings, not duplicated.
- `App.tsx`, `SecurityPage.tsx`, Tauri window configuration: reachable toolbar actions,
  restrained settings layout, disclosures and titlebar geometry. CSP/capabilities stay
  unchanged. Permission handlers and consent flows retain their existing behavior.
- Native `account.rs` / `account-types.ts`: expired-or-revoked presentation metadata.
- `vite.config.ts`: local font-file emission rather than CSP relaxation.
- Tests and the production-check script: synthetic UI evidence, axe and contrast;
  development-only axe/culori dependencies. Existing unrelated work was preserved.

MCP functionality, repository access, audit policy, remote resources, deployment,
commits and pushes were not changed/performed by this refinement.

## Verdict

**Approve for the inspected browser surfaces.** No HIGH finding remains in those
checked states. **Native visual acceptance remains open**, as do VoiceOver and live
GitHub/native-login verification. Do not treat the local build or browser fixtures as
proof of those gates.

Commit recommendation: `feat(ui): refine desktop chrome and shared account states`

## Follow-up shell refinement, 2026-11-10

The final shell now places workspace navigation first, registered repositories below,
and Settings in a native modal dialog. Duplicate toolbar navigation/breadcrumbs were
removed. Sidebar scrolling, Settings focus return and nested access-edit dismissal
have regression coverage. The screenshot gallery above remains the dated earlier
review baseline/comparison, rather than a claim that those images depict the final
sidebar order or Settings modal. The current full browser suite includes these
follow-ups and the browser confirmation modal; exact final counts are recorded in
the packaging work report. Native painting/VoiceOver gates above remain open.
