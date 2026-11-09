# Cloud Handoff — Phase A and desktop identity handoff

Phase A implements GitHub browser authentication only. MCP OAuth authorization-server
metadata, client registration, Orven access tokens, MCP tools, device APIs and desktop
writing remain unimplemented. A browser session grants none of those permissions.
The handoff schema/domain/persistence and its 24-hour expiration remain unchanged.

Phase A.1 adds the browser-confirmed desktop credential handoff described in
[the protocol, configuration and manual verification gate](../../docs/desktop-auth.md).
It reuses Phase A's login and callback, while keeping browser cookies and GitHub
tokens out of the desktop. MCP OAuth and tools remain unimplemented.

## Configuration

Keep `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in local `.dev.vars` or deployed
Worker secrets. Also set `ORVEN_AUTH_ORIGIN` to the exact canonical HTTPS origin,
without a trailing slash, path, query, or credentials. It may be a non-secret Worker
variable. The service fails closed if any required setting is missing or invalid.
Phase A.1 now configures the operator-supplied canonical origin locally; see the
linked desktop contract for its exact value and callback.

The GitHub OAuth App callback must exactly match
`<ORVEN_AUTH_ORIGIN>/auth/github/callback`. HTTPS is required for host-only Secure
cookies, including when testing the real browser flow locally. No HTTP exception is
enabled. Do not use `wrangler dev --remote` for local validation.

Migration `0002_github_auth.sql` adds a nullable unique GitHub account ID to existing
users and adds login-attempt and browser-session tables. Tests apply migrations only
to disposable local D1. Applying migrations to the operator's existing local or
remote database is a separate operation; it was not performed in this phase.
No KV binding or new Cloudflare resource is required for Phase A.

## Routes and policy

| Route | Behavior |
| --- | --- |
| `GET /auth/github/login` | Reject query parameters; create 10-minute login state and S256 PKCE verifier; redirect to GitHub with no requested scopes |
| `GET /auth/github/callback` | Check state against the browser cookie; atomically consume unexpired D1 state; exchange code and fetch GitHub `/user`; create a fresh browser session |
| `GET /auth/session` | Return only `{ authenticated: boolean }`; expired/missing sessions return 401 |
| `POST /auth/logout` | Require exact same-origin `Origin`; delete the presented session and clear its cookie |

The identity key is GitHub's verified numeric account ID, never login name, email,
or caller-supplied user ID. A unique upsert maps it to a random internal UUID,
including during concurrent first logins. Existing unlinked users and targets are
not automatically reassigned: account linking needs a separate explicit policy.
Login does not register targets or grant repository access.

State and session tokens have 256 bits of randomness; only SHA-256 hashes are stored
for lookup. The upstream PKCE verifier is retained for at most its usable 10-minute
lifetime. A valid callback consumes its state before network I/O. Failure after
consumption requires restarting login. GitHub tokens are used only in memory for
the fixed GitHub identity endpoint, never returned to clients or persisted. GitHub
may retain an issued grant/token after a failed or completed login; this phase does
not revoke upstream grants.

Cookies are `__Host-`, Secure, HttpOnly, SameSite=Lax, Path=/, without Domain. Browser
sessions expire after one hour and rotate on login; the old session presented by
that browser is revoked. Multiple separate browsers can have separate sessions.
Responses disable caching and referrer disclosure. Request URL and any supplied
Origin must match the configured origin; untrusted forwarded headers are unused.
No caller-selected redirect destination is accepted.

Expired rows are removed on subsequent login attempts; no scheduled deletion is
claimed. This is application-level authentication, not protection against an owner
with database access or a compromised browser/OS. A public deployment still needs
rate limits, operational request/query-log review and a real GitHub browser receipt.
No request bodies, codes, tokens or provider errors are logged by this implementation.

## Validation

Run from this directory:

```sh
npm test
npm run typecheck
```

Tests use synthetic credentials and mocked GitHub HTTP responses with real local
Workers/D1 storage. They do not read `.dev.vars`, contact GitHub, use remote D1, or
prove browser, Cloudflare deployment or ChatGPT interoperability. In a sandbox,
Workers tests need loopback access. The generated types' credential declarations
are `string` types; the actual local secret value was not found in that file.

## Official references

- [GitHub OAuth web flow, state and PKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [Authenticated GitHub user endpoint](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)
- [oauth4webapi library and runtime support](https://github.com/panva/oauth4webapi)
- [D1 database API and transactional batches](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [KV eventual consistency and atomic-operation limitations](https://developers.cloudflare.com/kv/concepts/how-kv-works/)

## Callback troubleshooting

Failed callbacks return the generic error and a fixed `code` identifying the step:
`state_missing` (missing/invalid state cookie), `callback_invalid` (state mismatch,
denial or malformed callback), `login_attempt_unavailable` (expired/consumed login),
`token_exchange_failed`, `identity_lookup_failed`, `identity_invalid`,
`session_storage_failed`, or `desktop_continuation_failed`. These contain no upstream
error details or secrets and do not relax state, PKCE or one-time consumption.
Always restart sign-in from Orven after failure; refreshing a callback replays a
consumed authorization. Share only this diagnostic code, never the callback URL,
authorization code, cookies, token response or client secret.

The configured upstream issuer is exactly `https://github.com/login/oauth`, per
[GitHub's issuer documentation](https://docs.github.com/en/apps/github-authentication-discovery-endpoints#issuer).
The former `https://github.com` value rejected callbacks carrying GitHub's `iss`
parameter. Regression fixtures now include the documented issuer and reject other
issuer values before token exchange. State and PKCE validation remain enabled.

### Privacy-preserving failure logs

Authentication failures emit one structured `orven_github_auth_failure` warning.
Fields are restricted to a locally defined `stage`, `reason`, optional numeric
`upstream_status`, and a new random `diagnostic_id`. The response header
`X-Orven-Auth-Error-ID` contains the same ID for lookup. It is not a login/session ID.
No request URL/query, headers/cookies, token, PKCE/state value, identity, upstream
body, exception message or stack is included in these application logs.
HTTP rejection, network failure, timeout, invalid response and storage failure are
separate categories; an HTTP 200 token response rejected by the OAuth library is
an invalid response rather than an HTTP failure. Unknown provider failure details
remain private. No automatic retries reuse consumed authorization codes.

After an approved deployment, reproduce one login and filter Worker logs for
`orven_github_auth_failure`. For `identity_lookup_failed`, inspect `reason` and
`upstream_status` rather than the callback's browser-facing HTTP 400. Example:

```json
{"event":"orven_github_auth_failure","diagnostic_id":"synthetic-example","stage":"identity_lookup_failed","reason":"http_error","upstream_status":403}
```

These rules cover application-generated diagnostics. Cloudflare invocation/access
logging is configured separately and may capture request URLs, including OAuth
callback queries. Review platform retention/access and invocation-log settings;
do not export or share entire callback log records. Enabling platform logs alone
does not sanitize their automatically captured metadata.

### Workers redirect compatibility correction (2026-11-10)

GitHub identity requests use `redirect: "manual"` and reject all non-2xx responses,
including redirects. Workers does not support `redirect: "error"`; the previous
option threw before network I/O and was grouped into `network_error`. Existing
fetch mocks had hidden that runtime incompatibility. Regression tests now construct
a real Workers `Request` from the identity fetch options and verify redirect denial
without forwarding the bearer credential. No real GitHub login is established by
these synthetic tests.

Reference: [Workers Request redirect modes](https://developers.cloudflare.com/workers/runtime-apis/request/).
