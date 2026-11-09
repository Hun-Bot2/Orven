import { confirmationPage } from "./confirmation.ts";
import { calculatePKCECodeChallenge, generateRandomState } from "oauth4webapi";
import { z } from "zod/v4";
import {
  cookie,
  configuration,
  digest,
  response,
  setCookie,
  SESSION_COOKIE,
  type AuthEnv,
} from "./security.ts";

const FLOW_COOKIE = "__Host-orven-desktop-flow";
const FLOW_SECONDS = 600;
const CREDENTIAL_SECONDS = 30 * 24 * 60 * 60;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const startSchema = z.strictObject({
  port: z
    .string()
    .regex(/^\d{1,5}$/)
    .refine((v) => Number(v) >= 1024 && Number(v) <= 65535),
  state: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  code_challenge: z.string().regex(tokenPattern),
});
const approvalSchema = z.strictObject({
  flow_id: z.string().regex(tokenPattern),
});
const exchangeSchema = z.strictObject({
  code: z.string().regex(tokenPattern),
  code_verifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  redirect_uri: z.string().max(128),
});

interface Flow {
  flow_id: string;
  code_challenge: string;
  redirect_uri: string;
  state: string;
  expires_at: number;
  user_id: string | null;
  code_hash: string | null;
}
interface Profile {
  user_id: string;
  github_account_id: string;
  username: string;
  avatar_url: string;
}

async function profile(
  db: D1Database,
  userId: string,
): Promise<Profile | null> {
  const user = await db
    .prepare(
      "SELECT user_id, github_account_id, github_username FROM users WHERE user_id = ?",
    )
    .bind(userId)
    .first<{
      user_id: string;
      github_account_id: string | null;
      github_username: string | null;
    }>();
  if (!user?.github_account_id || !user.github_username) return null;
  return {
    user_id: user.user_id,
    github_account_id: user.github_account_id,
    username: user.github_username,
    avatar_url: `https://avatars.githubusercontent.com/u/${user.github_account_id}?v=4`,
  };
}

async function browserUser(
  request: Request,
  db: D1Database,
): Promise<string | null> {
  const token = cookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await db
    .prepare(
      "SELECT user_id FROM browser_sessions WHERE token_hash = ? AND expires_at > ?",
    )
    .bind(await digest(token), Date.now())
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

async function boundFlow(
  request: Request,
  db: D1Database,
): Promise<Flow | null> {
  const id = cookie(request, FLOW_COOKIE);
  if (!id) return null;
  return db
    .prepare(
      "SELECT * FROM desktop_login_flows WHERE flow_id = ? AND expires_at > ?",
    )
    .bind(id, Date.now())
    .first<Flow>();
}

export async function completeDesktopLogin(
  request: Request,
  env: AuthEnv,
  flowId: string | null,
  userId: string,
): Promise<boolean> {
  if (!flowId || cookie(request, FLOW_COOKIE) !== flowId) return false;
  const linked = await env.DB.prepare(
    `UPDATE desktop_login_flows SET user_id = ?
    WHERE flow_id = ? AND expires_at > ? AND user_id IS NULL AND code_hash IS NULL RETURNING flow_id`,
  )
    .bind(userId, flowId, Date.now())
    .first();
  return linked !== null;
}

async function boundedBody(request: Request): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 4096) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function bearer(request: Request): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
    request.headers.get("Authorization") ?? "",
  );
  return match?.[1] ?? null;
}
type DesktopFailureCode =
  | "invalid_request"
  | "invalid_form"
  | "origin_rejected"
  | "request_type_rejected"
  | "flow_cookie_missing"
  | "flow_expired_or_unavailable"
  | "browser_session_unavailable"
  | "account_mismatch"
  | "flow_binding_mismatch"
  | "approval_already_used"
  | "approval_consumed_or_expired"
  | "profile_unavailable"
  | "exchange_invalid_or_expired"
  | "storage_or_internal_failure";

export async function routeDesktopAuth(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  const config = configuration(env);
  if (!config) return response({ error: "Authentication unavailable" }, 503);
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const stage =
    (
      {
        "/auth/desktop/start": "start",
        "/auth/desktop/confirm": "confirm",
        "/auth/desktop/approve": "approve",
        "/auth/desktop/exchange": "exchange",
      } as Record<string, string>
    )[url.pathname] ?? "desktop_request";
  const invalid = (
    code: DesktopFailureCode = "invalid_request",
    status = 400,
  ) => {
    const diagnosticId = crypto.randomUUID();
    // Only fixed labels and an unrelated random ID. Never log the request, cookies,
    // flow ID/state, profile, authorization code, credential or raw exception.
    console.warn({
      event: "orven_desktop_auth_failure",
      diagnostic_id: diagnosticId,
      stage,
      code,
    });
    const result = response(
      {
        error:
          status === 403
            ? "Forbidden"
            : status === 503
              ? "Authentication unavailable"
              : "Invalid or expired desktop authorization; restart sign-in",
        code,
        stage,
      },
      status,
    );
    result.headers.set("X-Orven-Auth-Error-ID", diagnosticId);
    return result;
  };
  if (
    url.origin !== config.origin ||
    (origin !== null && origin !== config.origin)
  )
    return invalid("origin_rejected", 403);
  try {
    if (url.pathname === "/auth/desktop/start" && request.method === "GET") {
      if (
        url.search.length > 1024 ||
        Array.from(url.searchParams.keys()).length !== 3
      )
        return invalid();
      const parsed = startSchema.safeParse(
        Object.fromEntries(url.searchParams),
      );
      if (!parsed.success) return invalid();
      const flowId = generateRandomState();
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM desktop_login_flows WHERE expires_at <= ?",
        ).bind(now),
        env.DB.prepare(
          "DELETE FROM desktop_credentials WHERE expires_at <= ?",
        ).bind(now),
        env.DB.prepare(
          `INSERT INTO desktop_login_flows
          (flow_id, code_challenge, redirect_uri, state, expires_at) VALUES (?, ?, ?, ?, ?)`,
        ).bind(
          flowId,
          parsed.data.code_challenge,
          `http://127.0.0.1:${Number(parsed.data.port)}/orven-auth/callback`,
          parsed.data.state,
          now + FLOW_SECONDS * 1000,
        ),
      ]);
      const result = response(null, 302);
      result.headers.set("Location", `${config.origin}/auth/github/login`);
      result.headers.append(
        "Set-Cookie",
        setCookie(FLOW_COOKIE, flowId, FLOW_SECONDS),
      );
      return result;
    }
    if (url.pathname === "/auth/desktop/confirm" && request.method === "GET") {
      const [flow, userId] = await Promise.all([
        boundFlow(request, env.DB),
        browserUser(request, env.DB),
      ]);
      if (!cookie(request, FLOW_COOKIE)) return invalid("flow_cookie_missing");
      if (!flow) return invalid("flow_expired_or_unavailable");
      if (!userId) return invalid("browser_session_unavailable");
      if (flow.user_id !== userId) return invalid("account_mismatch");
      if (flow.code_hash !== null) return invalid("approval_already_used");
      const user = await profile(env.DB, userId);
      if (!user || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(user.username))
        return invalid("profile_unavailable");
      return confirmationPage(
        user.username,
        user.avatar_url,
        flow.flow_id,
        flow.redirect_uri,
      );
    }
    if (url.pathname === "/auth/desktop/approve" && request.method === "POST") {
      if (origin !== config.origin) return invalid("origin_rejected", 403);
      if (
        request.headers.get("Content-Type")?.split(";")[0] !==
        "application/x-www-form-urlencoded"
      )
        return invalid("request_type_rejected", 403);
      const raw = await boundedBody(request);
      if (raw === null) return invalid();
      const form = new URLSearchParams(raw);
      // Object.fromEntries alone silently discards duplicate fields.
      if (Array.from(form).length !== 1) return invalid("invalid_form");
      const submitted = approvalSchema.safeParse(Object.fromEntries(form));
      if (!submitted.success) return invalid("invalid_form");
      const [flow, userId] = await Promise.all([
        boundFlow(request, env.DB),
        browserUser(request, env.DB),
      ]);
      if (!cookie(request, FLOW_COOKIE)) return invalid("flow_cookie_missing");
      if (!flow) return invalid("flow_expired_or_unavailable");
      if (!userId) return invalid("browser_session_unavailable");
      if (flow.user_id !== userId) return invalid("account_mismatch");
      if (submitted.data.flow_id !== flow.flow_id)
        return invalid("flow_binding_mismatch");
      if (flow.code_hash !== null) return invalid("approval_already_used");
      const code = generateRandomState();
      const approved = await env.DB.prepare(
        `UPDATE desktop_login_flows SET code_hash = ?, expires_at = MIN(expires_at, ?)
        WHERE flow_id = ? AND user_id = ? AND expires_at > ? AND code_hash IS NULL RETURNING flow_id`,
      )
        .bind(
          await digest(code),
          Date.now() + 60_000,
          flow.flow_id,
          userId,
          Date.now(),
        )
        .first();
      if (!approved) return invalid("approval_consumed_or_expired");
      const location = new URL(flow.redirect_uri);
      location.search = new URLSearchParams({
        code,
        state: flow.state,
      }).toString();
      const result = response(null, 303);
      result.headers.set("Location", location.href);
      result.headers.append("Set-Cookie", setCookie(FLOW_COOKIE, "", 0));
      return result;
    }
    if (
      url.pathname === "/auth/desktop/exchange" &&
      request.method === "POST"
    ) {
      if (
        request.headers.get("Content-Type")?.split(";")[0] !==
        "application/json"
      )
        return invalid();
      const raw = await boundedBody(request);
      if (raw === null) return invalid();
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        return invalid();
      }
      const parsed = exchangeSchema.safeParse(value);
      if (!parsed.success) return invalid();
      const flow = await env.DB.prepare(
        `DELETE FROM desktop_login_flows
        WHERE code_hash = ? AND code_challenge = ? AND redirect_uri = ? AND expires_at > ? AND user_id IS NOT NULL RETURNING user_id`,
      )
        .bind(
          await digest(parsed.data.code),
          await calculatePKCECodeChallenge(parsed.data.code_verifier),
          parsed.data.redirect_uri,
          Date.now(),
        )
        .first<{ user_id: string }>();
      if (!flow) return invalid("exchange_invalid_or_expired");
      const user = await profile(env.DB, flow.user_id);
      if (!user) return invalid("profile_unavailable");
      const credential = generateRandomState();
      const expiresAt = Date.now() + CREDENTIAL_SECONDS * 1000;
      await env.DB.prepare("INSERT INTO desktop_credentials VALUES (?, ?, ?)")
        .bind(await digest(credential), flow.user_id, expiresAt)
        .run();
      return response({
        desktop_credential: credential,
        expires_at: expiresAt,
        profile: user,
      });
    }
    if (url.pathname === "/auth/desktop/profile" && request.method === "GET") {
      const token = bearer(request);
      if (!token) return response({ error: "Unauthorized" }, 401);
      const credential = await env.DB.prepare(
        "SELECT user_id FROM desktop_credentials WHERE token_hash = ? AND expires_at > ?",
      )
        .bind(await digest(token), Date.now())
        .first<{ user_id: string }>();
      const user = credential
        ? await profile(env.DB, credential.user_id)
        : null;
      return user ? response(user) : response({ error: "Unauthorized" }, 401);
    }
    if (url.pathname === "/auth/desktop/revoke" && request.method === "POST") {
      const token = bearer(request);
      if (!token) return response({ error: "Unauthorized" }, 401);
      const revoked = await env.DB.prepare(
        "DELETE FROM desktop_credentials WHERE token_hash = ? RETURNING token_hash",
      )
        .bind(await digest(token))
        .first();
      return revoked
        ? response({ revoked: true })
        : response({ error: "Unauthorized" }, 401);
    }
    return response({ error: "Not found" }, 404);
  } catch {
    return invalid("storage_or_internal_failure", 503);
  }
}
