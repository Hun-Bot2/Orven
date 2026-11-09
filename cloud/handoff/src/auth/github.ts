import * as oauth from "oauth4webapi";

import {
  cookie,
  configuration,
  digest,
  response,
  setCookie,
  SESSION_COOKIE,
  type AuthEnv,
} from "./security.ts";
import { completeDesktopLogin } from "./desktop.ts";
export type { AuthEnv } from "./security.ts";

const server: oauth.AuthorizationServer = {
  issuer: "https://github.com/login/oauth",
  authorization_endpoint: "https://github.com/login/oauth/authorize",
  token_endpoint: "https://github.com/login/oauth/access_token",
};
const STATE_COOKIE = "__Host-orven-github-state";
const LOGIN_SECONDS = 600;
const SESSION_SECONDS = 3600;

type FailureStage =
  | "state_missing"
  | "callback_invalid"
  | "login_attempt_unavailable"
  | "token_exchange_failed"
  | "identity_lookup_failed"
  | "identity_invalid"
  | "session_storage_failed"
  | "desktop_continuation_failed"
  | "auth_storage_or_internal";
type FailureReason =
  | "validation"
  | "http_error"
  | "timeout"
  | "network_error"
  | "invalid_response"
  | "storage_error";
function transportFailure(error: unknown): FailureReason {
  return error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
    ? "timeout"
    : "network_error";
}
// Only locally defined labels, status numbers and a fresh diagnostic ID may enter logs.
// Never pass Request, Response, Error, OAuth parameters, identity or headers here.
function recordFailure(
  stage: FailureStage,
  reason: FailureReason,
  status?: number,
): string {
  const diagnosticId = crypto.randomUUID();
  console.warn({
    event: "orven_github_auth_failure",
    diagnostic_id: diagnosticId,
    stage,
    reason,
    ...(status === undefined ? {} : { upstream_status: status }),
  });
  return diagnosticId;
}

// Browser sessions identify an upstream login only. They never authorize MCP or device APIs.
export async function routeAuth(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  const config = configuration(env);
  if (!config) return response({ error: "Authentication unavailable" }, 503);
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (
    url.origin !== config.origin ||
    (origin !== null && origin !== config.origin)
  ) {
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
        env.DB.prepare(
          "DELETE FROM github_login_attempts WHERE expires_at <= ?",
        ).bind(now),
        env.DB.prepare(
          "DELETE FROM browser_sessions WHERE expires_at <= ?",
        ).bind(now),
        env.DB.prepare(
          "INSERT INTO github_login_attempts (state_hash, code_verifier, expires_at, desktop_flow_id) VALUES (?, ?, ?, ?)",
        ).bind(
          await digest(state),
          verifier,
          now + LOGIN_SECONDS * 1000,
          cookie(request, "__Host-orven-desktop-flow"),
        ),
      ]);
      const location = new URL(server.authorization_endpoint!);
      location.search = new URLSearchParams({
        client_id: config.client.client_id,
        redirect_uri: callback,
        response_type: "code",
        scope: "",
        state,
        code_challenge_method: "S256",
        code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
      }).toString();
      const result = response(null, 302);
      result.headers.set("Location", location.href);
      result.headers.append(
        "Set-Cookie",
        setCookie(STATE_COOKIE, state, LOGIN_SECONDS),
      );
      return result;
    }
    if (url.pathname === "/auth/github/callback" && request.method === "GET") {
      // Fixed stage labels only: never return upstream messages, codes, or tokens.
      let failureCode: FailureStage = "state_missing";
      let reason: FailureReason = "validation";
      let upstreamStatus: number | undefined;
      const failure = () => {
        const diagnosticId = recordFailure(failureCode, reason, upstreamStatus);
        const result = response(
          {
            error: "GitHub authentication failed; restart login",
            code: failureCode,
          },
          400,
        );
        result.headers.set("X-Orven-Auth-Error-ID", diagnosticId);
        result.headers.append("Set-Cookie", setCookie(STATE_COOKIE, "", 0));
        return result;
      };
      const state = cookie(request, STATE_COOKIE);
      if (!state || url.search.length > 4096) return failure();
      failureCode = "callback_invalid";
      let params: URLSearchParams;
      try {
        params = oauth.validateAuthResponse(server, config.client, url, state);
      } catch {
        return failure();
      }
      failureCode = "login_attempt_unavailable";
      // Atomic consume before network I/O: concurrent callbacks cannot reuse this login.
      let attempt: {
        code_verifier: string;
        desktop_flow_id: string | null;
      } | null;
      try {
        attempt = await env.DB.prepare(
          "DELETE FROM github_login_attempts WHERE state_hash = ? AND expires_at > ? RETURNING code_verifier, desktop_flow_id",
        )
          .bind(await digest(state), Date.now())
          .first<{ code_verifier: string; desktop_flow_id: string | null }>();
      } catch {
        reason = "storage_error";
        return failure();
      }
      if (!attempt) return failure();
      failureCode = "token_exchange_failed";
      reason = "network_error";
      try {
        const tokenResponse = await oauth.authorizationCodeGrantRequest(
          server,
          config.client,
          oauth.ClientSecretPost(env.GITHUB_CLIENT_SECRET!),
          params,
          callback,
          attempt.code_verifier,
          {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
          },
        );
        upstreamStatus = tokenResponse.status;
        reason = tokenResponse.ok ? "invalid_response" : "http_error";
        const tokens = await oauth.processAuthorizationCodeResponse(
          server,
          config.client,
          tokenResponse,
        );
        failureCode = "identity_lookup_failed";
        upstreamStatus = undefined;
        reason = "network_error";
        const identityResponse = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "Orven-Handoff",
            "X-GitHub-Api-Version": "2026-03-10",
          },
          // Workers rejects redirect:"error" before sending the request.
          // Manual mode exposes 3xx, which the !ok check rejects without following.
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        });
        upstreamStatus = identityResponse.status;
        if (!identityResponse.ok) {
          reason = "http_error";
          return failure();
        }
        failureCode = "identity_invalid";
        reason = "invalid_response";
        const identity: unknown = await identityResponse.json();
        if (
          !identity ||
          typeof identity !== "object" ||
          !("id" in identity) ||
          typeof identity.id !== "number" ||
          !Number.isSafeInteger(identity.id) ||
          identity.id <= 0
        )
          return failure();
        if (
          !("login" in identity) ||
          typeof identity.login !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(identity.login)
        )
          return failure();
        failureCode = "session_storage_failed";
        upstreamStatus = undefined;
        reason = "storage_error";
        const user = await env.DB.prepare(
          `
          INSERT INTO users (user_id, created_at, github_account_id, github_username) VALUES (?, ?, ?, ?)
          ON CONFLICT(github_account_id) DO UPDATE SET github_username = excluded.github_username
          RETURNING user_id
        `,
        )
          .bind(
            crypto.randomUUID(),
            Date.now(),
            String(identity.id),
            identity.login,
          )
          .first<{ user_id: string }>();
        if (!user) return failure();
        const session = oauth.generateRandomState();
        const oldSession = cookie(request, SESSION_COOKIE);
        await env.DB.batch([
          env.DB.prepare(
            "DELETE FROM browser_sessions WHERE token_hash = ?",
          ).bind(oldSession ? await digest(oldSession) : ""),
          env.DB.prepare("INSERT INTO browser_sessions VALUES (?, ?, ?)").bind(
            await digest(session),
            user.user_id,
            Date.now() + SESSION_SECONDS * 1000,
          ),
        ]);
        failureCode = "desktop_continuation_failed";
        const continuation = await completeDesktopLogin(
          request,
          env,
          attempt.desktop_flow_id,
          user.user_id,
        );
        const result = response(
          { authenticated: true },
          continuation ? 302 : 200,
        );
        if (continuation)
          result.headers.set(
            "Location",
            `${config.origin}/auth/desktop/confirm`,
          );
        result.headers.append("Set-Cookie", setCookie(STATE_COOKIE, "", 0));
        result.headers.append(
          "Set-Cookie",
          setCookie(SESSION_COOKIE, session, SESSION_SECONDS),
        );
        return result;
      } catch (error) {
        if (reason === "network_error") reason = transportFailure(error);
        return failure();
      }
    }
    if (url.pathname === "/auth/session" && request.method === "GET") {
      const token = cookie(request, SESSION_COOKIE);
      const session = token
        ? await env.DB.prepare(
            "SELECT user_id FROM browser_sessions WHERE token_hash = ? AND expires_at > ?",
          )
            .bind(await digest(token), Date.now())
            .first<{ user_id: string }>()
        : null;
      return response({ authenticated: session !== null }, session ? 200 : 401);
    }
    if (url.pathname === "/auth/logout" && request.method === "POST") {
      if (origin !== config.origin)
        return response({ error: "Forbidden" }, 403);
      const token = cookie(request, SESSION_COOKIE);
      if (token)
        await env.DB.prepare(
          "DELETE FROM browser_sessions WHERE token_hash = ?",
        )
          .bind(await digest(token))
          .run();
      const result = response({ authenticated: false });
      result.headers.append("Set-Cookie", setCookie(SESSION_COOKIE, "", 0));
      return result;
    }
    return response({ error: "Not found" }, 404);
  } catch {
    const diagnosticId = recordFailure(
      "auth_storage_or_internal",
      "storage_error",
    );
    const result = response({ error: "Authentication unavailable" }, 503);
    result.headers.set("X-Orven-Auth-Error-ID", diagnosticId);
    return result;
  }
}
