import type * as oauth from "oauth4webapi";

export interface AuthEnv {
  DB: D1Database;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  ORVEN_AUTH_ORIGIN?: string;
}

export const SESSION_COOKIE = "__Host-orven-session";

export async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export function cookie(request: Request, name: string): string | null {
  const matches = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export function setCookie(
  name: string,
  value: string,
  seconds: number,
): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}

export function response(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function configuration(
  env: AuthEnv,
): { origin: string; client: oauth.Client } | null {
  if (
    !env.GITHUB_CLIENT_ID ||
    !env.GITHUB_CLIENT_SECRET ||
    !env.ORVEN_AUTH_ORIGIN
  )
    return null;
  try {
    const url = new URL(env.ORVEN_AUTH_ORIGIN);
    if (url.protocol !== "https:" || url.origin !== env.ORVEN_AUTH_ORIGIN)
      return null;
    return { origin: url.origin, client: { client_id: env.GITHUB_CLIENT_ID } };
  } catch {
    return null;
  }
}
