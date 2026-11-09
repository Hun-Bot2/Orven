# Compact toolbar account control, 2026-11-10

The operator's root `image.png` is the primary defect reference: an unlabeled
GitHub trigger above an oversized account surface with repeated Signed out/Close
controls. The private reference image is not copied into these fixtures.

## Change

- Signed out: a restrained 32px-high **Sign in** toolbar button, styled alongside
  Search while Run Audit retains primary emphasis. A 16px GitHub mark accompanies
  the visible Sign in label (and Sign in again); it never replaces the label. Verified accounts retain their
  avatar and accessible username/account label.
- Popover: 260px wide, 12px padding, 8px modest radius, subtle border/shadow,
  content-driven height; absolutely positioned 8px below and right-aligned with
  its trigger. Viewport width/height bounds prevent overflow. No modal backdrop
  or background inertness is introduced.
- Signed out content is only GitHub account and Sign in with GitHub. Authenticated
  content is avatar, full wrapping username and Sign out. Loading shows its status;
  pending/expired/error states retain only the necessary guidance and actions.
- Removed the compact Signed out badge and Close link. Full Settings content and
  detailed recovery copy remain available through the existing AccountPanel.
- Entry focuses the first available action, or the panel while loading. Escape
  returns focus to the trigger. Outside click/focus and Tab past the final action
  dismiss naturally without trapping focus. Successful begin/cancel/logout/retry
  dismiss; a failed action keeps recovery visible. A failed verification never
  displays a cached profile as verified.

Only AccountControl, the compact presentation of the existing AccountPanel, account
CSS and focused frontend tests were changed for this refinement. The shared
AccountProvider, native API calls, OAuth/session/Keychain logic, backend, migrations,
MCP and Cloudflare configuration were not modified by this work. Unrelated existing
worktree changes remain intact.

The panel keeps `role="dialog"` for nonmodal accessible grouping with ordinary
buttons; it is not an ARIA menu requiring arrow-key navigation, nor a modal dialog.
Its `aria-controls` reference exists only while open.

## Rendered comparisons

These are real Chrome renders of Orven's React UI using synthetic native bridge
responses, not design mockups. They verify UI behavior, not real GitHub login or
native WebView/VoiceOver behavior. The authenticated avatar fixture is intentionally
synthetic (a tiny local test image), not a real user's portrait. Missing-image
initials are exercised separately in the seven-state matrix.

| State | Before | After |
| --- | --- | --- |
| Signed out | [Before](signed_out-before.png) | [After](signed_out-after.png) |
| Authenticated | [Before](authenticated-before.png) | [After](authenticated-after.png) |
| Loading | [Before](loading-before.png) | [After](loading-after.png) |
| Error | [Before](error-before.png) | [After](error-after.png) |

## Verification

- Baseline state-matrix capture: passed before implementation.
- Frontend TypeScript and Prettier checks: passed.
- Full Playwright suite: **35 passed**, including prior account/settings/gateway
  regressions, seven account states, missing avatar, expiry and shared verification.
- Popover tests cover 240–280px width, short content-driven height, absence of Close
  and Signed out, entry focus, Escape return, nonmodal semantics, no layout shift,
  1440/980/640/320px resize anchoring, clipping, overlay hit testing, outside dismissal,
  successful action dismissal and failed sign-in recovery.
- A targeted test caught Tab leaving the document without a blur target; the final
  control explicitly dismisses when Tab passes its final action. The corrected test
  and full suite passed.
- Existing axe checks: zero reported violations on inspected surfaces; incomplete
  checks remain recorded and are not a complete accessibility claim.
- Existing rendered semantic contrast checks passed. No palette or focus token changed.
- Production rendering with native CSP: one app shell, zero JS errors/CSP failures.
- Debug/release packaging is local only; native rendering, VoiceOver and live OAuth
  were not reverified. No remote actions, commit or push performed.

## Follow-up: approval Origin and GitHub mark

The labeled trigger now also includes the existing GitHub mark, preserving its
accessible Sign in label and compact dimensions. The Continue form failure was a
separate Worker presentation-header bug: no-referrer caused browser form POSTs to
send Origin:null. A real-browser assertion reproduced that before correction.
The confirmation page now uses strict-origin, and tests assert both the canonical
Origin and an origin-only Referer. The server's CSRF/origin rejection is unchanged.
See the [authentication contract](../../desktop-auth.md) for details. Worker deployment
is required separately; rebuilding the app cannot change a remote response header.


## Final avatar and icon follow-up

The compact menu offers **Reload photo** when the verified account has no image.
The native adapter now requests a small, bounded raster photo and returns Base64;
see the authentication contract for the exact restrictions and verification limits.
The toolbar and packaged macOS icon use the transparent master in
[desktop branding](../../../desktop/branding/README.md).

Final frontend verification: 37 Playwright tests passed, including portrait display,
logout removal, photo retry, account states, keyboard behavior and Settings.
TypeScript/build, formatting and production CSP checks passed. Real user portrait
rendering in the native WebView remains unverified. Builds are ad-hoc signed;
Apple notarization and installed-app replacement were not performed.
