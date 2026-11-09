import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeRequest } from "../src/http/router.ts";
import { calculatePKCECodeChallenge } from "oauth4webapi";
import type { AuthEnv } from "../src/auth/github.ts";

const origin = "https://orven.example";
const authEnv: AuthEnv = { DB: env.DB, GITHUB_CLIENT_ID: "synthetic-client",
  GITHUB_CLIENT_SECRET: "synthetic-secret", ORVEN_AUTH_ORIGIN: origin };
const stateName = "__Host-orven-github-state";
const sessionName = "__Host-orven-session";
const request = (path: string, init?: RequestInit, bindings = authEnv) =>
  routeRequest(new Request(origin + path, init), bindings);
function cookies(response: Response): string[] {
  return response.headers.getSetCookie();
}
function sessionCookie(response: Response): string {
  return cookies(response).find(value => value.startsWith(sessionName + "="))!.split(";")[0];
}
async function login() {
  const response = await request("/auth/github/login");
  expect(response.status).toBe(302);
  const url = new URL(response.headers.get("location")!);
  const state = url.searchParams.get("state")!;
  const cookie = cookies(response)[0].split(";")[0];
  return { response, url, state, cookie, callback: `/auth/github/callback?code=synthetic-code&state=${state}&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth` };
}
function mockGitHub(id = 42) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url === "https://github.com/login/oauth/access_token") {
      const body = new URLSearchParams(init?.body as URLSearchParams);
      expect(body.get("client_id")).toBe("synthetic-client");
      expect(body.get("client_secret")).toBe("synthetic-secret");
      expect(body.get("redirect_uri")).toBe(origin + "/auth/github/callback");
      expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      return Response.json({ access_token: "upstream-private-token", token_type: "bearer", scope: "" });
    }
    expect(url).toBe("https://api.github.com/user");
    // Construct a real workerd Request: a fetch mock alone hides invalid options.
    const identityRequest = new Request(input, init);
    expect(identityRequest.redirect).toBe("manual");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer upstream-private-token");
    return Response.json({ id, login: "untrusted-display-name" });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM browser_sessions"), env.DB.prepare("DELETE FROM github_login_attempts"),
    env.DB.prepare("DELETE FROM handoffs"), env.DB.prepare("DELETE FROM targets"), env.DB.prepare("DELETE FROM users"),
  ]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("GitHub authentication", () => {
  it("fails closed without trusted configuration or for foreign origins", async () => {
    expect((await request("/auth/github/login", undefined, { DB: env.DB })).status).toBe(503);
    expect((await request("/auth/github/login", undefined, { ...authEnv, ORVEN_AUTH_ORIGIN: "http://orven.example" })).status).toBe(503);
    expect((await request("/auth/github/login", { headers: { Origin: "https://attacker.example" } })).status).toBe(403);
    expect((await routeRequest(new Request("https://attacker.example/auth/github/login"), authEnv)).status).toBe(403);
    expect((await request("/auth/github/login?redirect_uri=https://attacker.example")).status).toBe(400);
  });

  it("creates browser-bound state with PKCE and no repository scopes", async () => {
    const { response, url, state } = await login();
    expect(url.origin).toBe("https://github.com");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toHaveLength(43);
    expect(url.searchParams.get("scope")).toBe("");
    expect(cookies(response)[0]).toContain("HttpOnly; Secure; SameSite=Lax; Max-Age=600");
    const row = await env.DB.prepare("SELECT state_hash, code_verifier FROM github_login_attempts").first();
    expect(row?.state_hash).not.toBe(state);
    expect(await calculatePKCECodeChallenge(row?.code_verifier as string))
      .toBe(url.searchParams.get("code_challenge"));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects missing, mismatched, duplicate and expired state without contacting GitHub", async () => {
    const upstream = mockGitHub();
    const flow = await login();
    expect((await request(flow.callback)).status).toBe(400);
    expect((await request(flow.callback + "&state=duplicate", { headers: { Cookie: flow.cookie } })).status).toBe(400);
    expect((await request(flow.callback + "&code=duplicate", { headers: { Cookie: flow.cookie } })).status).toBe(400);
    expect((await request(flow.callback.replace(flow.state, "wrong"), { headers: { Cookie: flow.cookie } })).status).toBe(400);
    expect((await request(flow.callback, { headers: { Cookie: flow.cookie + "; " + flow.cookie } })).status).toBe(400);
    await env.DB.prepare("UPDATE github_login_attempts SET expires_at = 0").run();
    expect((await request(flow.callback, { headers: { Cookie: flow.cookie } })).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("maps verified account IDs, rotates sessions, and never returns upstream tokens", async () => {
    mockGitHub();
    const flow = await login();
    const result = await request(flow.callback, { headers: { Cookie: flow.cookie } });
    expect(result.status).toBe(200);
    expect(await result.clone().json()).toEqual({ authenticated: true });
    expect(await result.text()).not.toContain("upstream-private-token");
    expect(cookies(result).join()).not.toContain("upstream-private-token");
    const firstSession = sessionCookie(result);
    expect((await request("/auth/session", { headers: { Cookie: firstSession } })).status).toBe(200);
    const user = await env.DB.prepare("SELECT user_id, github_account_id FROM users").first();
    expect(user?.github_account_id).toBe("42");
    expect(user?.user_id).not.toBe("42");
    const secondFlow = await login();
    const second = await request(secondFlow.callback, { headers: { Cookie: secondFlow.cookie + "; " + firstSession } });
    expect(second.status).toBe(200);
    expect((await request("/auth/session", { headers: { Cookie: firstSession } })).status).toBe(401);
    expect(sessionCookie(second)).not.toBe(firstSession);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first()).toEqual({ n: 1 });
    const stored = await env.DB.prepare("SELECT token_hash FROM browser_sessions").first();
    expect(stored?.token_hash).not.toBe(sessionCookie(second).split("=")[1]);
  });

  it("atomically consumes concurrent callbacks once", async () => {
    const upstream = mockGitHub();
    const flow = await login();
    const results = await Promise.all([1, 2].map(() => request(flow.callback, { headers: { Cookie: flow.cookie } })));
    expect(results.map(r => r.status).sort()).toEqual([200, 400]);
    expect(upstream).toHaveBeenCalledTimes(2); // One token exchange and one identity request.
    expect((await request(flow.callback, { headers: { Cookie: flow.cookie } })).status).toBe(400);
  });

  it("maps concurrent first logins for one GitHub account to one internal user", async () => {
    mockGitHub();
    const [one, two] = await Promise.all([login(), login()]);
    const results = await Promise.all([one, two].map(flow =>
      request(flow.callback, { headers: { Cookie: flow.cookie } })));
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first()).toEqual({ n: 1 });
    const rows = await env.DB.prepare("SELECT user_id FROM browser_sessions").all<{ user_id: string }>();
    expect(rows.results).toHaveLength(2);
    expect(new Set(rows.results.map(row => row.user_id)).size).toBe(1);
  });

  it("keeps different verified accounts isolated", async () => {
    mockGitHub(42);
    const first = await login();
    await request(first.callback, { headers: { Cookie: first.cookie } });
    mockGitHub(43);
    const second = await login();
    await request(second.callback, { headers: { Cookie: second.cookie } });
    const rows = await env.DB.prepare("SELECT user_id FROM users").all<{ user_id: string }>();
    expect(rows.results).toHaveLength(2);
    expect(new Set(rows.results.map(row => row.user_id)).size).toBe(2);
  });

  it("expires sessions and requires same-origin logout", async () => {
    mockGitHub();
    const flow = await login();
    const result = await request(flow.callback, { headers: { Cookie: flow.cookie } });
    const Cookie = sessionCookie(result);
    expect((await request("/auth/logout", { method: "POST", headers: { Cookie } })).status).toBe(403);
    expect((await request("/auth/logout", { method: "POST", headers: { Cookie, Origin: "https://attacker.example" } })).status).toBe(403);
    expect((await request("/auth/session", { headers: { Cookie } })).status).toBe(200);
    expect((await request("/auth/logout", { method: "POST", headers: { Cookie, Origin: origin } })).status).toBe(200);
    expect((await request("/auth/session", { headers: { Cookie } })).status).toBe(401);
    const next = await login();
    const nextResult = await request(next.callback, { headers: { Cookie: next.cookie } });
    await env.DB.prepare("UPDATE browser_sessions SET expires_at = 0").run();
    expect((await request("/auth/session", { headers: { Cookie: sessionCookie(nextResult) } })).status).toBe(401);
    expect((await request("/auth/session?user_id=forged", { headers: { Authorization: "Bearer upstream-private-token" } })).status).toBe(401);
  });

  it.each(["denied", "exchange", "identity", "malformed"])("fails safely on %s", async mode => {
    const flow = await login();
    let calls = 0;
    const upstream = vi.fn(async () => {
      calls++;
      if (mode === "exchange") return Response.json({ error: "bad_verification_code", error_description: "private-detail" }, { status: 400 });
      if (mode === "identity" && calls === 2) return Response.json({}, { status: 401 });
      return Response.json({ access_token: "upstream-private-token", token_type: "bearer" });
    });
    vi.stubGlobal("fetch", upstream);
    const callback = mode === "denied" ? flow.callback.replace("code=synthetic-code", "error=access_denied") : flow.callback;
    const result = await request(callback, { headers: { Cookie: flow.cookie } });
    expect(result.status).toBe(400);
    const body = await result.json() as { error: string; code: string };
    expect(body.code).toBe(mode === "denied" ? "callback_invalid" : mode === "exchange" ? "token_exchange_failed" : mode === "identity" ? "identity_lookup_failed" : "identity_invalid");
    expect(JSON.stringify(body)).not.toMatch(/private-detail|upstream-private-token/);
    if (mode === "denied") expect(upstream).not.toHaveBeenCalled();
    expect((await request("/auth/session")).status).toBe(401);
  });

  it.each([0, -1, 1.5, "42", null, 9007199254740992])("rejects invalid GitHub account ID %s", async id => {
    const flow = await login();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ++calls === 1
      ? Response.json({ access_token: "upstream-private-token", token_type: "bearer" })
      : Response.json({ id })));
    expect((await request(flow.callback, { headers: { Cookie: flow.cookie } })).status).toBe(400);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first()).toEqual({ n: 0 });
  });

  it("fails closed on network and storage errors without leaking details", async () => {
    const flow = await login();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("private upstream failure"); }));
    const result = await request(flow.callback, { headers: { Cookie: flow.cookie } });
    expect(result.status).toBe(400);
    expect(await result.text()).not.toContain("private upstream failure");
    const broken = { ...authEnv, DB: { batch() { throw new Error("private database detail"); } } as unknown as D1Database };
    const unavailable = await request("/auth/github/login", undefined, broken);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain("private database detail");
  });

  it("uses verified identity rather than a callback-supplied user ID", async () => {
    mockGitHub(42);
    const flow = await login();
    const result = await request(flow.callback + "&user_id=forged", { headers: { Cookie: flow.cookie } });
    expect(result.status).toBe(200);
    const user = await env.DB.prepare("SELECT user_id, github_account_id FROM users").first();
    expect(user?.github_account_id).toBe("42");
    expect(user?.user_id).not.toBe("forged");
  });

  it("does not enable MCP or handoff writes", async () => {
    expect((await request("/mcp", { method: "POST" })).status).toBe(404);
    expect((await request("/v1/handoffs", { method: "POST" })).status).toBe(501);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM handoffs").first())).toEqual({ n: 0 });
  });
});


it("reports a bounded missing-state diagnostic without upstream requests", async () => {
  const upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
  const result = await request("/auth/github/callback?code=private-code&state=private-state");
  expect(await result.json()).toEqual({ error: "GitHub authentication failed; restart login", code: "state_missing" });
  expect(upstream).not.toHaveBeenCalled();
});


it("accepts GitHub's documented issuer in a code callback", async () => {
  mockGitHub();
  const flow = await login();
  const result = await request(flow.callback, { headers: { Cookie: flow.cookie } });
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ authenticated: true });
});

it.each(["https://github.com", "https://attacker.example", "https://github.com/login/oauth/"])("rejects a mismatched issuer %s before exchanging a code", async issuer => {
  const upstream = mockGitHub();
  const flow = await login();
  const callback = new URL(origin + flow.callback);
  callback.searchParams.set("iss", issuer);
  const result = await request(callback.pathname + callback.search, { headers: { Cookie: flow.cookie } });
  expect(result.status).toBe(400);
  expect(await result.json()).toEqual({ error: "GitHub authentication failed; restart login", code: "callback_invalid" });
  expect(upstream).not.toHaveBeenCalled();
});


it.each([401, 403, 429, 500])("logs only safe metadata for GitHub identity HTTP %s", async status => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const flow = await login();
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn(async () => ++calls === 1
    ? Response.json({ access_token: "private-token-sentinel", token_type: "bearer" })
    : Response.json({ message: "private-body-sentinel", login: "private-user-sentinel" }, { status, headers: { "X-Private": "private-header-sentinel" } })));
  const result = await request(flow.callback, { headers: { Cookie: flow.cookie } });
  expect(result.status).toBe(400);
  expect(log).toHaveBeenCalledTimes(1);
  expect(log.mock.calls[0]).toEqual([{
    event: "orven_github_auth_failure", stage: "identity_lookup_failed", reason: "http_error", upstream_status: status,
    diagnostic_id: result.headers.get("X-Orven-Auth-Error-ID"),
  }]);
  expect(result.headers.get("X-Orven-Auth-Error-ID")).toMatch(/^[a-f0-9-]{36}$/);
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-|synthetic-|state=|code=|Bearer|cookie/i);
  expect(JSON.stringify(log.mock.calls)).not.toContain(flow.state);
  expect((await request("/auth/session")).status).toBe(401);
});

it.each(["network", "timeout", "malformed"])("diagnoses identity %s without logging exception or body", async mode => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const flow = await login();
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (++calls === 1) return Response.json({ access_token: "private-token-sentinel", token_type: "bearer" });
    if (mode === "malformed") return new Response("private-body-sentinel", { headers: { "Content-Type": "application/json" } });
    if (mode === "timeout") throw new DOMException("private-error-sentinel", "TimeoutError");
    throw new Error("private-error-sentinel");
  }));
  const result = await request(flow.callback, { headers: { Cookie: flow.cookie } });
  expect(result.status).toBe(400);
  expect(log).toHaveBeenCalledTimes(1);
  expect(log.mock.calls[0][0]).toMatchObject({
    stage: mode === "malformed" ? "identity_invalid" : "identity_lookup_failed",
    reason: mode === "malformed" ? "invalid_response" : mode === "timeout" ? "timeout" : "network_error",
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("private-");
  expect(JSON.stringify(log.mock.calls)).not.toContain(flow.state);
});


it("uses a redirect mode supported by the actual Workers Request implementation", () => {
  expect(() => new Request("https://api.github.com/user", { redirect: "error" })).toThrow(TypeError);
  expect(new Request("https://api.github.com/user", { redirect: "manual" }).redirect).toBe("manual");
});

it.each([301, 302, 307, 308])("rejects GitHub identity redirect %s without forwarding credentials", async status => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const flow = await login();
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    if (calls.length === 1) return Response.json({ access_token: "private-token-sentinel", token_type: "bearer" });
    const req = new Request(input, init);
    expect(req.redirect).toBe("manual");
    return new Response(null, { status, headers: { Location: "https://attacker.example/collect" } });
  }));
  const result = await request(flow.callback, { headers: { Cookie: flow.cookie } });
  expect(result.status).toBe(400);
  expect(calls).toEqual(["https://github.com/login/oauth/access_token", "https://api.github.com/user"]);
  expect(log.mock.calls[0][0]).toMatchObject({ stage: "identity_lookup_failed", reason: "http_error", upstream_status: status });
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-token|attacker/);
  expect((await request("/auth/session")).status).toBe(401);
});
