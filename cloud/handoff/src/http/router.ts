import { routeDesktopAuth } from "../auth/desktop.ts";
import { routeAuth, type AuthEnv } from "../auth/github.ts";
import { jsonResponse } from "./response";

export async function routeRequest(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/auth/desktop/"))
    return routeDesktopAuth(request, env);
  if (url.pathname.startsWith("/auth/")) return routeAuth(request, env);

  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({
      status: "ok",
      service: "orven-handoff",
    });
  }

  if (request.method === "POST" && url.pathname === "/v1/handoffs") {
    return jsonResponse({ error: "Not implemented" }, 501);
  }

  return jsonResponse({ error: "Not found" }, 404);
}
