import { env } from "cloudflare:workers";
import {
  calculatePKCECodeChallenge,
  generateRandomCodeVerifier,
  generateRandomState,
} from "oauth4webapi";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { confirmationPage } from "../src/auth/confirmation.ts";
import { routeRequest } from "../src/http/router.ts";
import type { AuthEnv } from "../src/auth/github.ts";

const origin = "https://orven.example";
const bindings: AuthEnv = {
  DB: env.DB,
  GITHUB_CLIENT_ID: "synthetic",
  GITHUB_CLIENT_SECRET: "synthetic-secret",
  ORVEN_AUTH_ORIGIN: origin,
};
const call = (path: string, init?: RequestInit) =>
  routeRequest(new Request(origin + path, init), bindings);
const cookie = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((v) => v.startsWith(name + "="))!
    .split(";")[0];
const flowName = "__Host-orven-desktop-flow";
const sessionName = "__Host-orven-session";
const redirect = "http://127.0.0.1:45123/orven-auth/callback";

beforeEach(async () => {
  await env.DB.batch(
    [
      "desktop_credentials",
      "desktop_login_flows",
      "browser_sessions",
      "github_login_attempts",
      "handoffs",
      "targets",
      "users",
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function flow(accountId = 42) {
  const verifier = generateRandomCodeVerifier();
  const state = generateRandomState();
  const start = await call(
    "/auth/desktop/start?" +
      new URLSearchParams({
        port: "45123",
        state,
        code_challenge: await calculatePKCECodeChallenge(verifier),
      }),
  );
  expect(start.status).toBe(302);
  const flowCookie = cookie(start, flowName);
  const flowId = flowCookie.split("=")[1];
  const login = await call("/auth/github/login", {
    headers: { Cookie: flowCookie },
  });
  const githubState = new URL(login.headers.get("Location")!).searchParams.get(
    "state",
  )!;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) =>
      String(input) === "https://github.com/login/oauth/access_token"
        ? Response.json({
            access_token: "github-private-token",
            token_type: "bearer",
          })
        : Response.json({
            id: accountId,
            login: `fixture-${accountId}`,
            avatar_url: "https://attacker.example/untrusted-avatar",
          }),
    ),
  );
  const callback = await call(
    `/auth/github/callback?code=github-code&state=${githubState}&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth`,
    {
      headers: {
        Cookie: flowCookie + "; " + cookie(login, "__Host-orven-github-state"),
      },
    },
  );
  expect(callback.status).toBe(302);
  expect(callback.headers.get("Location")).toBe(
    origin + "/auth/desktop/confirm",
  );
  const browserCookie = cookie(callback, sessionName);
  const Cookie = flowCookie + "; " + browserCookie;
  return { verifier, state, flowId, flowCookie, browserCookie, Cookie };
}
async function approve(f: Awaited<ReturnType<typeof flow>>) {
  return call("/auth/desktop/approve", {
    method: "POST",
    headers: {
      Origin: origin,
      Cookie: f.Cookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ flow_id: f.flowId }),
  });
}
async function exchange(
  code: string,
  verifier: string,
  redirectUri = redirect,
) {
  return call("/auth/desktop/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  });
}
async function approved() {
  const f = await flow();
  const approval = await approve(f);
  expect(approval.status).toBe(303);
  const callback = new URL(approval.headers.get("Location")!);
  expect(callback.origin + callback.pathname).toBe(redirect);
  expect(callback.searchParams.get("state")).toBe(f.state);
  return { ...f, code: callback.searchParams.get("code")! };
}

it("completes browser-confirmed desktop login and returns only an Orven credential", async () => {
  const f = await flow();
  const confirmation = await call("/auth/desktop/confirm", {
    headers: { Cookie: f.Cookie },
  });
  expect(confirmation.status).toBe(200);
  expect(confirmation.headers.get("Referrer-Policy")).toBe("strict-origin");
  const html = await confirmation.text();
  expect(html).toContain("Continue as fixture-42");
  expect(html).not.toContain("github-private-token");
  expect(html).not.toContain("attacker.example");
  const approval = await approve(f);
  const callback = new URL(approval.headers.get("Location")!);
  expect(callback.searchParams.get("state")).toBe(f.state);
  const code = callback.searchParams.get("code")!;
  expect(approval.headers.get("Location")).not.toContain(
    "github-private-token",
  );
  expect((await approve(f)).status).toBe(400);
  const result = await exchange(code, f.verifier);
  expect(result.status).toBe(200);
  expect(result.headers.get("Set-Cookie")).toBeNull();
  expect(result.headers.get("Cache-Control")).toBe("no-store");
  const data = await result.json<{
    desktop_credential: string;
    profile: {
      github_account_id: string;
      username: string;
      avatar_url: string;
    };
  }>();
  expect(data.desktop_credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(data.profile).toMatchObject({
    github_account_id: "42",
    username: "fixture-42",
    avatar_url: "https://avatars.githubusercontent.com/u/42?v=4",
  });
  const stored = await env.DB.prepare(
    "SELECT token_hash FROM desktop_credentials",
  ).first();
  expect(stored?.token_hash).not.toBe(data.desktop_credential);
  const headers = { Authorization: `Bearer ${data.desktop_credential}` };
  const restored = await call("/auth/desktop/profile", { headers });
  expect(await restored.json()).toEqual(data.profile);
  expect((await exchange(code, f.verifier)).status).toBe(400);
  expect(
    (await call("/auth/desktop/revoke", { method: "POST", headers })).status,
  ).toBe(200);
  expect((await call("/auth/desktop/profile", { headers })).status).toBe(401);
});

it("rejects wrong PKCE or redirect and atomically exchanges concurrent code requests", async () => {
  const f = await approved();
  expect((await exchange(f.code, generateRandomCodeVerifier())).status).toBe(
    400,
  );
  expect(
    (
      await exchange(
        f.code,
        f.verifier,
        "http://127.0.0.1:45124/orven-auth/callback",
      )
    ).status,
  ).toBe(400);
  const results = await Promise.all([
    exchange(f.code, f.verifier),
    exchange(f.code, f.verifier),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM desktop_credentials",
    ).first(),
  ).toEqual({ n: 1 });
});

it("requires browser binding, same-origin approval and the same verified account", async () => {
  const first = await flow(42);
  expect((await call("/auth/desktop/confirm")).status).toBe(400);
  expect(
    (
      await call("/auth/desktop/confirm", {
        headers: { Cookie: first.flowCookie },
      })
    ).status,
  ).toBe(400);
  const body = new URLSearchParams({ flow_id: first.flowId });
  for (const originHeader of [undefined, "null", "https://attacker.example"]) {
    const headers: Record<string, string> = {
      Cookie: first.Cookie,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (originHeader) headers.Origin = originHeader;
    expect(
      (await call("/auth/desktop/approve", { method: "POST", headers, body }))
        .status,
    ).toBe(403);
  }
  const other = await flow(43);
  const mixed = first.flowCookie + "; " + other.browserCookie;
  expect(
    (await call("/auth/desktop/confirm", { headers: { Cookie: mixed } }))
      .status,
  ).toBe(400);
  expect(
    (
      await call("/auth/desktop/approve", {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: mixed,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      })
    ).status,
  ).toBe(400);
  // A credential for account 43 cannot select account 42 through a user_id parameter.
  const approval = await approve(other);
  const code = new URL(approval.headers.get("Location")!).searchParams.get(
    "code",
  )!;
  const token = await (
    await exchange(code, other.verifier)
  ).json<{ desktop_credential: string }>();
  const profile = await call("/auth/desktop/profile?user_id=42", {
    headers: { Authorization: `Bearer ${token.desktop_credential}` },
  });
  expect(await profile.json()).toMatchObject({ github_account_id: "43" });
});

it("expires flows, authorization codes and desktop credentials", async () => {
  const f = await flow();
  await env.DB.prepare("UPDATE desktop_login_flows SET expires_at = 0").run();
  expect((await approve(f)).status).toBe(400);
  const next = await approved();
  await env.DB.prepare("UPDATE desktop_login_flows SET expires_at = 0").run();
  expect((await exchange(next.code, next.verifier)).status).toBe(400);
  const final = await approved();
  const token = await (
    await exchange(final.code, final.verifier)
  ).json<{ desktop_credential: string }>();
  await env.DB.prepare("UPDATE desktop_credentials SET expires_at = 0").run();
  expect(
    (
      await call("/auth/desktop/profile", {
        headers: { Authorization: `Bearer ${token.desktop_credential}` },
      })
    ).status,
  ).toBe(401);
});

it("never accepts browser cookies, GitHub tokens or a caller's identity as desktop authentication", async () => {
  const f = await flow();
  for (const headers of [
    { Cookie: f.Cookie },
    { Authorization: "Bearer github-private-token" },
    { "X-User-Id": "42" },
  ] as Record<string, string>[]) {
    expect((await call("/auth/desktop/profile", { headers })).status).toBe(401);
    expect(
      (await call("/auth/desktop/revoke", { method: "POST", headers })).status,
    ).toBe(401);
  }
  expect((await call("/mcp", { method: "POST" })).status).toBe(404);
});

it("rejects arbitrary redirects, duplicate parameters, malformed or oversized requests", async () => {
  const params = {
    port: "45123",
    state: generateRandomState(),
    code_challenge: await calculatePKCECodeChallenge(
      generateRandomCodeVerifier(),
    ),
  };
  for (const suffix of [
    "&redirect_uri=https://attacker.example",
    "&port=45124",
    "&user_id=42",
  ]) {
    expect(
      (
        await call(
          "/auth/desktop/start?" + new URLSearchParams(params) + suffix,
        )
      ).status,
    ).toBe(400);
  }
  for (const port of ["0", "80", "65536", "45123/../../", "example.com"]) {
    expect(
      (
        await call(
          "/auth/desktop/start?" + new URLSearchParams({ ...params, port }),
        )
      ).status,
    ).toBe(400);
  }
  for (const body of [
    "{",
    "{}",
    "x".repeat(4097),
    JSON.stringify({
      code: "bad",
      code_verifier: "bad",
      redirect_uri: redirect,
      user_id: "42",
    }),
  ]) {
    expect(
      (
        await call("/auth/desktop/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        })
      ).status,
    ).toBe(400);
  }
});

it("escapes confirmation content and authorizes only its nonce-bound presentation script", async () => {
  const page = confirmationPage(
    "<script>private-marker</script>",
    'https://avatars.githubusercontent.com/u/42?x=" onerror="private-marker',
    '" autofocus onfocus="private-marker',
    redirect,
  );
  const body = await page.text();
  expect(body).not.toContain("<script>private-marker</script>");
  expect(body).toContain("&lt;script&gt;private-marker&lt;/script&gt;");
  expect(body).not.toContain(' onerror="private-marker');
  expect(body).not.toContain(' onfocus="private-marker');
  const policy = page.headers.get("Content-Security-Policy")!;
  expect(policy).not.toContain("unsafe-inline");
  expect(policy).toContain(`form-action 'self' ${redirect};`);
  expect(policy).not.toContain("http://127.0.0.1:*");
  expect(policy).toContain("frame-ancestors 'none'");
  const nonce = /script-src 'nonce-([^']+)'/.exec(policy)![1];
  expect(body).toContain(`<script nonce="${nonce}">`);
  expect(
    confirmationPage(
      "fixture",
      "https://avatars.githubusercontent.com/u/42",
      "flow",
      redirect,
    ).headers.get("Content-Security-Policy"),
  ).not.toBe(policy);
});

it.each(["duplicate", "unknown", "malformed", "missing"])(
  "Zod rejects %s approval form fields before issuing a code",
  async (mode) => {
    const f = await flow();
    const form = new URLSearchParams();
    if (mode !== "missing")
      form.append("flow_id", mode === "malformed" ? "invalid" : f.flowId);
    if (mode === "duplicate") form.append("flow_id", f.flowId);
    if (mode === "unknown") form.append("user_id", "forged-user");
    const result = await call("/auth/desktop/approve", {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: f.Cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({
      code: "invalid_form",
      stage: "approve",
    });
    expect(
      await env.DB.prepare(
        "SELECT code_hash FROM desktop_login_flows WHERE flow_id = ?",
      )
        .bind(f.flowId)
        .first(),
    ).toEqual({ code_hash: null });
  },
);

it("distinguishes approval failures without logging identity or authorization material", async () => {
  const f = await flow();
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const request = async (Cookie: string, flowId = f.flowId) =>
    call("/auth/desktop/approve", {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ flow_id: flowId }),
    });
  const noCookie = await request(f.browserCookie);
  expect(await noCookie.json()).toMatchObject({
    code: "flow_cookie_missing",
    stage: "approve",
  });
  expect(log.mock.calls[0]).toEqual([
    {
      event: "orven_desktop_auth_failure",
      diagnostic_id: noCookie.headers.get("X-Orven-Auth-Error-ID"),
      stage: "approve",
      code: "flow_cookie_missing",
    },
  ]);
  expect(await (await request(f.flowCookie)).json()).toMatchObject({
    code: "browser_session_unavailable",
  });
  expect(await (await request(f.Cookie, "x".repeat(43))).json()).toMatchObject({
    code: "flow_binding_mismatch",
  });
  await env.DB.prepare(
    "UPDATE desktop_login_flows SET expires_at = 0 WHERE flow_id = ?",
  )
    .bind(f.flowId)
    .run();
  expect(await (await request(f.Cookie)).json()).toMatchObject({
    code: "flow_expired_or_unavailable",
  });
  const text = JSON.stringify(log.mock.calls);
  for (const value of [
    f.flowId,
    f.state,
    f.verifier,
    f.browserCookie,
    "github-private-token",
    "fixture-42",
  ])
    expect(text).not.toContain(value);
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM desktop_credentials",
    ).first(),
  ).toEqual({ n: 0 });
});

it("allows only one concurrent approval and diagnoses reuse", async () => {
  const f = await flow();
  const results = await Promise.all([approve(f), approve(f)]);
  expect(results.map((r) => r.status).sort()).toEqual([303, 400]);
  const failure = await results
    .find((r) => r.status === 400)!
    .json<{ code: string }>();
  expect(["approval_already_used", "approval_consumed_or_expired"]).toContain(
    failure.code,
  );
  expect(await (await approve(f)).json()).toMatchObject({
    code: "approval_already_used",
  });
});

it.each([
  "https://127.0.0.1:45123/orven-auth/callback",
  "http://localhost:45123/orven-auth/callback",
  "http://127.0.0.1:80/orven-auth/callback",
  "http://127.0.0.1:65536/orven-auth/callback",
  "http://127.0.0.1:45123/orven-auth/callback?target=elsewhere",
  "http://attacker.example:45123/orven-auth/callback",
  "javascript:alert(1)",
])("rejects unsafe confirmation callback %s", (candidate) => {
  expect(() =>
    confirmationPage(
      "fixture",
      "https://avatars.githubusercontent.com/u/42?v=4",
      "flow",
      candidate,
    ),
  ).toThrow("Invalid desktop callback configuration");
});
