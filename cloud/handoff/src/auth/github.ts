import * as oauth from "oauth4webapi";

export interface AuthEnv {
  DB: D1Database;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  ORVEN_AUTH_ORIGIN?: string;
}

const server: oauth.AuthorizationServer = {
  issuer: "https://github.com",
  authorization_endpoint: "https://github.com/login/oauth/authorize",
  token_endpoint: "https://github.com/login/oauth/access_token",
};
const STATE_COOKIE = "__Host-orven-github-state";
const SESSION_COOKIE = "__Host-orven-session";
const LOGIN_SECONDS = 600;
const SESSION_SECONDS = 3600;

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}

function cookie(request: Request, name: string): string | null {
  const matches = (request.headers.get("cookie") ?? "").split(";")
    .map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

function setCookie(name: string, value: string, seconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}

function response(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: {
    "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  } });
}

function configuration(env: AuthEnv): { origin: string; client: oauth.Client } | null {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.ORVEN_AUTH_ORIGIN) return null;
  try {
    const url = new URL(env.ORVEN_AUTH_ORIGIN);
    if (url.protocol !== "https:" || url.origin !== env.ORVEN_AUTH_ORIGIN) return null;
    return { origin: url.origin, client: { client_id: env.GITHUB_CLIENT_ID } };
  } catch { return null; }
}

// Browser sessions identify an upstream login only. They never authorize MCP or device APIs.
export async function routeAuth(request: Request, env: AuthEnv): Promise<Response> {
  const config = configuration(env);
  if (!config) return response({ error: "Authentication unavailable" }, 503);
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (url.origin !== config.origin || (origin !== null && origin !== config.origin)) {
    return response({ error: "Forbidden" }, 403);
  }
  const callback = `${config.origin}/auth/github/callback`;
  try {
    if (url.pathname === "/auth/github/login" && request.method === "GET") {
      if (url.search) return response({ error: "Invalid login request" }, 400);
      const state = oauth.generateRandomState();
      const verifier = oauth.generateRandomCodeVerifier();
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare("DELETE FROM github_login_attempts WHERE expires_at <= ?").bind(now),
        env.DB.prepare("DELETE FROM browser_sessions WHERE expires_at <= ?").bind(now),
        env.DB.prepare("INSERT INTO github_login_attempts VALUES (?, ?, ?)")
          .bind(await digest(state), verifier, now + LOGIN_SECONDS * 1000),
      ]);
      const location = new URL(server.authorization_endpoint!);
      location.search = new URLSearchParams({
        client_id: config.client.client_id, redirect_uri: callback, response_type: "code",
        scope: "", state, code_challenge_method: "S256",
        code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
      }).toString();
      const result = response(null, 302);
      result.headers.set("Location", location.href);
      result.headers.append("Set-Cookie", setCookie(STATE_COOKIE, state, LOGIN_SECONDS));
      return result;
    }
    if (url.pathname === "/auth/github/callback" && request.method === "GET") {
      const failure = () => {
        const result = response({ error: "GitHub authentication failed; restart login" }, 400);
        result.headers.append("Set-Cookie", setCookie(STATE_COOKIE, "", 0));
        return result;
      };
      const state = cookie(request, STATE_COOKIE);
      if (!state || url.search.length > 4096) return failure();
      let params: URLSearchParams;
      try { params = oauth.validateAuthResponse(server, config.client, url, state); }
      catch { return failure(); }
      // Atomic consume before network I/O: concurrent callbacks cannot reuse this login.
      const attempt = await env.DB.prepare(
        "DELETE FROM github_login_attempts WHERE state_hash = ? AND expires_at > ? RETURNING code_verifier",
      ).bind(await digest(state), Date.now()).first<{ code_verifier: string }>();
      if (!attempt) return failure();
      try {
        const tokenResponse = await oauth.authorizationCodeGrantRequest(
          server, config.client, oauth.ClientSecretPost(env.GITHUB_CLIENT_SECRET!),
          params, callback, attempt.code_verifier,
          { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
        );
        const tokens = await oauth.processAuthorizationCodeResponse(server, config.client, tokenResponse);
        const identityResponse = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/vnd.github+json",
            "User-Agent": "Orven-Handoff", "X-GitHub-Api-Version": "2026-03-10" },
          redirect: "error", signal: AbortSignal.timeout(10_000),
        });
        if (!identityResponse.ok) return failure();
        const identity: unknown = await identityResponse.json();
        if (!identity || typeof identity !== "object" || !("id" in identity)
          || typeof identity.id !== "number" || !Number.isSafeInteger(identity.id) || identity.id <= 0) return failure();
        const user = await env.DB.prepare(`
          INSERT INTO users (user_id, created_at, github_account_id) VALUES (?, ?, ?)
          ON CONFLICT(github_account_id) DO UPDATE SET github_account_id = excluded.github_account_id
          RETURNING user_id
        `).bind(crypto.randomUUID(), Date.now(), String(identity.id)).first<{ user_id: string }>();
        if (!user) return failure();
        const session = oauth.generateRandomState();
        const oldSession = cookie(request, SESSION_COOKIE);
        await env.DB.batch([
          env.DB.prepare("DELETE FROM browser_sessions WHERE token_hash = ?")
            .bind(oldSession ? await digest(oldSession) : ""),
          env.DB.prepare("INSERT INTO browser_sessions VALUES (?, ?, ?)")
            .bind(await digest(session), user.user_id, Date.now() + SESSION_SECONDS * 1000),
        ]);
        const result = response({ authenticated: true });
        result.headers.append("Set-Cookie", setCookie(STATE_COOKIE, "", 0));
        result.headers.append("Set-Cookie", setCookie(SESSION_COOKIE, session, SESSION_SECONDS));
        return result;
      } catch { return failure(); }
    }
    if (url.pathname === "/auth/session" && request.method === "GET") {
      const token = cookie(request, SESSION_COOKIE);
      const session = token ? await env.DB.prepare(
        "SELECT user_id FROM browser_sessions WHERE token_hash = ? AND expires_at > ?",
      ).bind(await digest(token), Date.now()).first<{ user_id: string }>() : null;
      return response({ authenticated: session !== null }, session ? 200 : 401);
    }
    if (url.pathname === "/auth/logout" && request.method === "POST") {
      if (origin !== config.origin) return response({ error: "Forbidden" }, 403);
      const token = cookie(request, SESSION_COOKIE);
      if (token) await env.DB.prepare("DELETE FROM browser_sessions WHERE token_hash = ?")
        .bind(await digest(token)).run();
      const result = response({ authenticated: false });
      result.headers.append("Set-Cookie", setCookie(SESSION_COOKIE, "", 0));
      return result;
    }
    return response({ error: "Not found" }, 404);
  } catch {
    return response({ error: "Authentication unavailable" }, 503);
  }
}
