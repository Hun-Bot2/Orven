# Sidebar and Settings refinement, 2026-11-10

Scope: current desktop shell/sidebar, Settings modal and shared account surfaces.
Toolkit: the previously inspected Jakub `better-interface`, `better-layout`,
`better-accessibility`, `better-writing`, `better-typography`, `better-colors`,
`better-ui` skills from temporary storage. Applied as instructions, not executable
slash commands. Project conventions: AGENTS.md, README, architecture, decisions,
roadmap and UI contracts. The user authorized implementation and rebuilding debug;
this is a surface review, not a new branch-wide interface audit. Reports/history
received regression coverage but no new complete visual audit.

## Prioritized findings and changes

| Severity | Domain / location | Before | Change / evidence |
| --- | --- | --- | --- |
| MEDIUM | Layout, `desktop/src/styles.css:1357` | Native-macOS class applied the 96px traffic-light inset to sidebar contents; actual button padding was 94px and long repository names became almost unreadable | Reserve physical safe area for titlebar only. Sidebar uses 14px button padding and existing 16px alignment; brand retains x≥96px. A new regression test failed on 94px before the fix and passed afterward |
| MEDIUM | Layout / accessibility, `desktop/src/pages/SecurityPage.tsx:25`, `desktop/src/styles.css:1415` | Permissions/policy sat below the Settings scroll edge with no direct section route | Native links provide Account, Gateway, Workspace permissions and Audit policy routes. They scroll and focus the target; Audit policy opens its existing disclosure. Existing warnings and permission handlers remain |
| MEDIUM | Typography / hierarchy, `desktop/src/pages/pages.css:288` | Page-sized title/overline and stacked account action consumed modal height | Use a 24px editorial title, remove the redundant visual overline, align stable account state and action in one row. Waiting/error text retains natural reading order |
| LOW | Typography, `desktop/src/styles.css:1448` | Sidebar labels were 10px microcopy | Reuse the 12px caption token; preserve the existing fonts/palette |

No authentication/authorization policy, account storage, Worker code, permission
scope or MCP behavior was changed. Shared Dialog gained only an optional class name
for scoped Settings styling. Section navigation uses the existing content rather
than duplicating it or creating a second settings implementation.

## Coverage

| Domain | Evidence | Outcome |
| --- | --- | --- |
| Accessibility | Existing axe tagged checks; keyboard Escape/focus return; new section focus/disclosure checks | Zero reported violations in inspected states; account/access axe incomplete checks remain in the receipts. VoiceOver unverified |
| Layout | 1440/1280/980/640/490/320 widths; long Korean/English names; many repositories; native-macOS CSS class at 980px | Browser checks pass; native optical painting is separate |
| Writing | Existing account/error/permission/boundary text reviewed; concise navigation names | Warnings, untrusted-client labels and recovery actions retained |
| Typography | Caption token, Settings title and wrapped transient states | Browser screenshots inspected; no new fonts |
| Colors | Existing rendered semantic contrast tests | Ten tested pairs pass; palette unchanged. This is not a whole-product contrast claim |
| UI polish | White Settings surface, stable header, scoped content scroller, reduced-motion regression | Browser verified; no new decorative motion |

## Before / after

All captures use synthetic data. Native-class screenshots simulate CSS geometry,
not actual traffic lights or native WebView painting.

| Surface | Before | After |
| --- | --- | --- |
| 980px shell, native-macOS CSS class | [Before](shell-before.png) | [After](shell-after.png) |
| 1440px browser Settings | [Before](settings-before.png) | [After](settings-after.png) |
| Policy reached through section link | — | [After](settings-policy.png) |

## Verification

- `npm run typecheck`, `npm run format:check`: passed.
- `npm test`: 33 passed, including the new safe-area/section-navigation regression.
- New regression initially failed against the old sidebar (94px > 20px), then passed
  after the CSS fix; this was an intentional defect reproduction.
- `npm run test:production`: passed; one shell, zero JS errors and zero CSP failures.
- Debug executable/debug app and release app/DMG rebuilt from the refined source.
- Both app signatures verified. Final DMG integrity is checked separately in the
  ignored artifact receipt. Ad-hoc signing is not Apple notarization.
- No Rust/authentication/Worker behavior changed; those test suites were not rerun
  for this presentation-only change. Native compilation succeeded for both profiles.
- No commit, push, remote deployment, installation or account-data change performed.
  Existing unrelated Wrangler edits and private `kr01.md` were preserved.

Verdict: **Approve for the inspected browser states.** No HIGH finding remains in
those states. Native visual alignment, VoiceOver and installed-app behavior remain
unverified; CSS screenshots and signature checks do not close those gates.
