# Phase A.1 — GitHub account in Orven Desktop

The existing **Connections & Security / Local policy & settings** page contains a
GitHub account panel. Loading, signed-out, waiting, authenticated and unavailable
states are explicit. Backend or Keychain failures do not imply a successful logout
or a missing saved account. Local audits continue without an account.

## Configuration and current gate

The operator supplied this GitHub App callback:
`https://orven-handoff.surtrcode.workers.dev/auth/github/callback`.
The canonical `ORVEN_AUTH_ORIGIN` is consequently
`https://orven-handoff.surtrcode.workers.dev`, without the callback path. It was added
to the existing ignored local `.dev.vars`. App registration itself was not inspected
through GitHub. Client ID/secret values were neither printed nor copied into desktop
code, its build environment, frontend or bundle.

The desktop defaults to that canonical HTTPS origin. An operator can select another
trusted HTTPS origin at Rust build time with `ORVEN_DESKTOP_AUTH_ORIGIN`; this is a
backend build setting, not a WebView parameter. The Worker must use the same origin
and its OAuth App must register that origin's `/auth/github/callback`. Changing origins
selects a different Keychain account; it does not transfer existing credentials.

Wrangler's local D1 binding was confirmed as `orven-handoff-db`, with migrations
`0001_init.sql` and `0002_github_auth.sql` already applied. They were not rerun. After
inspecting the new additive migration and making a private SQLite backup outside
the public tree, `0003_desktop_auth.sql` was applied successfully using **`--local`**.
It adds profile display metadata, desktop-flow linkage and separate flow/credential
tables. Existing handoff retention and claim policies are unchanged.

**No remote migration, deployment, resource creation, GitHub App modification, commit
or push was performed.** A real GitHub login cannot close this gate until an approved
deployment serves the new routes and the remote database has the approved migration.
A read-only, unauthenticated GET to the supplied remote
`/auth/desktop/profile` endpoint returned HTTP 200 with `Hello World!`: the endpoint
is reachable but is serving a placeholder, not this authentication API. No remote
login or write was attempted. The tests below do not establish remote or GitHub
interoperability.

## Protocol and boundaries

Before opening the system browser, Rust makes an unauthenticated request to
`/auth/desktop/profile` and requires the existing API's HTTP 401 JSON
`{"error":"Unauthorized"}` response. HTTP 200 placeholders, redirects, malformed
responses and unavailable services fail closed without creating a pending login.
This is a compatibility check, not proof of GitHub or database readiness. Confirmed
again on 2026-11-09: the remote endpoint still returned HTTP 200 `Hello World!`.
The desktop now reports service unavailability instead of waiting for its callback.
No remote deployment was performed.

1. Rust checks Keychain for an existing credential, validates the service response,
   binds an ephemeral port on
   `127.0.0.1`, and generates independent state and PKCE verifier values (244 random
   bits each). An existing credential must be explicitly signed out before switching
   accounts. The fixed-origin `/auth/desktop/start` URL contains only state, port and
   S256 challenge. Rust opens it in the system browser. General frontend opener
   permissions and automatic JavaScript link opening are disabled.
2. The Worker accepts only the bounded port/state/challenge schema, constructs the
   exact loopback redirect itself, and creates a 10-minute desktop flow. It sets a
   host-only Secure HttpOnly SameSite=Lax flow cookie and enters the existing GitHub
   flow. The existing one-use state, GitHub S256 PKCE and account-ID mapping remain.
   GitHub state binds the specific desktop flow as well as the browser cookie.
3. The GitHub callback stores the provider-verified username as display metadata and
   links that verified internal user to the flow. The browser must explicitly confirm
   that account. Approval requires the browser session, flow cookie, same user,
   matching flow form value and exact same-origin `Origin`. No account name/email
   supplied by the desktop authorizes anything. Avatar URLs are derived from the
   verified GitHub account ID, never from a client-provided URL.
4. Approval atomically creates one hashed authorization code, usable for at most
   60 seconds and within the original flow deadline. The browser redirects to
   `http://127.0.0.1:<bound-port>/orven-auth/callback?code=...&state=...`.
   No provider token, browser cookie or desktop credential appears in that URL.
5. Rust accepts only a bounded GET with the exact host, port, path and state, then
   closes the listener. It exchanges the code over HTTPS with its verifier and the
   original redirect URI. D1 atomically consumes the flow only on a matching unexpired
   code/challenge/redirect. Concurrent or replayed exchanges cannot issue a second
   credential. Exchange failure requires restarting sign-in.
6. The backend issues a separate random 256-bit desktop credential, stores only its
   SHA-256 hash and returns its 30-day expiry and verified profile. Rust validates the
   response and stores the credential under `dev.orven.desktop.account.v1` in macOS
   Keychain, partitioned by canonical origin. Unsupported platforms have no plaintext
   fallback. No credential is serialized through IPC or persisted by JavaScript.
7. Settings restoration reads Keychain and calls the bearer-protected profile route.
   A backend 401 clears the credential; a network error retains it and shows an
   unavailable state. Logout calls backend revocation before deleting the Keychain
   item. Cancellation is serialized after an in-flight exchange and also revokes a
   credential that arrived during cancellation. If Keychain saving fails, immediate
   backend revocation is attempted; a simultaneous network failure can leave an
   unused credential record until its expiry. No plaintext recovery file is created.

Desktop bearer credentials are accepted only by `/auth/desktop/profile` and
`/auth/desktop/revoke`. They are not browser sessions, GitHub access tokens, MCP OAuth
tokens or inbox device credentials. `/mcp` and cloud handoff writes remain unavailable.
The Worker has no filesystem, shell, Git or local-agent capability.

The native HTTPS client verifies TLS, follows no redirects, uses no inherited proxy
and returns fixed errors without response bodies. Only Rust downloads optional
PNG/JPEG avatars from the fixed GitHub host, without any credential attached, bounded
to 256 KiB. Missing avatars get an icon fallback. The frontend receives profile data
and a data URI, retaining the existing CSP restrictions. App responses disable caching;
callback pages disable referrers. Infrastructure/browser URL-history logging of
short-lived authorization codes still needs operational review before public use.

## Automated evidence

Commands run from the owning directories; results are local only:

| Check | Evidence |
| --- | --- |
| Worker `npm test` | **35 passed**. Local Workers/D1 tests with mocked GitHub; includes desktop flow, confirmation, PKCE/redirect mismatch, parallel exchange, replay, expiry, cookie/bearer separation, malformed input and account isolation |
| Worker `npm run typecheck` | **Passed**. TypeScript contract checking |
| Desktop `npm run build` | **Passed**. TypeScript and production assets |
| Desktop `npm run tauri -- build --debug --no-bundle` with the documented Cargo PATH | **Passed**. Self-contained native debug binary; no signing or real login proof |
| Desktop `npm test` | **21 passed**. Synthetic browser UI for existing pages and account loading/waiting/profile, restoration contract, cancellation races and failed logout; not native/GitHub proof |
| `cargo test --locked --workspace` | **42 passed; one opt-in Keychain test skipped here and run separately below**. Core policy, actual loopback and Tauri IPC, plus existing workspace/gateway regression tests; native credential lifecycle tests use fake vault/backend adapters |
| `cargo test --locked -p orven-desktop native_keychain_roundtrip -- --ignored` | **1 passed**. Actual macOS Keychain save/read/delete of one disposable synthetic item, cleaned up; no existing account item read or changed |
| `cargo clippy --workspace --all-targets --locked --offline -- -D warnings` | **Passed**. Rust static checks |

Loopback tests caught and corrected macOS accepted sockets inheriting nonblocking
mode. A synthetic browser screenshot was inspected. The configured GitHub secret value was
not found in the built desktop binary, frontend assets or generated Worker types;
this bounded check does not prove that every possible secret is absent. Neither that
screenshot nor the
Keychain round-trip proves a successful real account login or restart restoration.

## Manual verification after a separately approved deployment

1. In GitHub OAuth App settings, verify that the callback is exactly the URL above.
   Configure the deployed Worker's canonical origin and GitHub secrets through secure
   configuration. Apply the approved migration and deploy only with separate approval.
2. Build the native desktop from `desktop/` using
   `npm run tauri -- build --debug --no-bundle`, then launch
   `../target/debug/orven-desktop`. For a changed trusted origin, set the Rust build
   setting before building; never pass the GitHub secret into this environment.
3. Open **Local policy & settings**. Click **Sign in with GitHub**. Confirm that the
   system browser opens, GitHub shows the intended app, and the Orven confirmation
   page displays the correct username and avatar. Decline/close if the account is
   unexpected. Continue only for the intended account.
4. Complete the return to the loopback page. Orven should regain focus and show the
   same username/avatar. A first Keychain access prompt may require user consent.
   The visible UI, JavaScript storage and logs must contain no credentials.
5. Quit and restart Orven, reopen settings, and verify that the backend-authenticated
   account is restored without another GitHub login. Do not count cached text alone
   as successful verification.
6. Sign out online. Verify that the UI becomes signed out and backend restoration
   rejects the revoked credential. Do not copy the credential into developer tools,
   shell commands or logs to check this; use an instrumented test client if needed.
7. Repeat with expired callback, cancelled login, Keychain denial, an account switch,
   and a network interruption during logout. Errors must remain explicit; reconnect
   and retry revocation before starting another account login.

## Official sources reviewed

- [Native-app browser and loopback guidance, RFC 8252](https://www.rfc-editor.org/rfc/rfc8252)
- [Tauri Rust system-browser opener](https://v2.tauri.app/plugin/opener/)
- [macOS Keychain password API](https://docs.rs/security-framework/3.7.0/security_framework/passwords/index.html)
- [GitHub authenticated user endpoint](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)

## Operator update, 2026-11-10

The operator reported successful remote migrations 0001–0003 and deployed the Worker.
Read-only checks confirmed the deployed profile endpoint rejects unauthenticated
requests with HTTP 401. After correcting GitHub's issuer and Workers redirect-mode
compatibility, the operator reached the verified-account confirmation page. This
is operator-reported upstream login progress, not an independently executed full
native credential/restoration/revocation receipt. Earlier deployment-gate notes
above describe the state at their original verification time.

The browser confirmation now uses a nonce-protected native modal dialog, explicit
same-origin approval, Cancel/Escape, and a missing-avatar fallback. Cancel dismisses
the page UI; it does not claim to revoke a server session or delete the pending flow.
The flow retains its existing expiry. This presentation change requires Worker
deployment separately from rebuilding the desktop. No additional permission is granted.
