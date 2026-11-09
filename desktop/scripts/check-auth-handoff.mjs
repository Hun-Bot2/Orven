// Browser + actual local Worker/D1 integration. No remote resources or real accounts.
// Uses the already locked Cloudflare toolchain installed under cloud/handoff.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  readFileSync,
  readdirSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
const workerRoot = fileURLToPath(
  new URL("../../cloud/handoff/", import.meta.url),
);
const requireWorker = createRequire(
  new URL("../../cloud/handoff/package.json", import.meta.url),
);
const { build } = requireWorker("esbuild");
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } =
  requireWorker("miniflare");
let origin;
let mf;
const secret = () => randomBytes(32).toString("base64url");
const callbacks = [];
let callbackFailure;
let browser, workerServer, providerServer, tlsRoot;
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  try {
    assert.equal(url.pathname, "/orven-auth/callback");
    assert(!req.headers.origin, "Origin header must not reach native callback");
    assert(
      !req.headers.cookie,
      "Remote session cookie must not reach native callback",
    );
  } catch (error) {
    callbackFailure = error;
    res.writeHead(400);
    res.end("Synthetic callback rejected");
    return;
  }
  callbacks.push({
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
  });
  res.writeHead(200, {
    "Content-Type": "text/plain",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'",
  });
  res.end("Synthetic loopback callback received");
});
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const redirect = `http://127.0.0.1:${server.address().port}/orven-auth/callback`;
  // A real local HTTPS hop preserves browser cookies/redirect behavior. Only this
  // disposable test context ignores its self-signed certificate; production does not.
  tlsRoot = mkdtempSync(join(tmpdir(), "orven-auth-browser-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(tlsRoot, "key.pem"),
      "-out",
      join(tlsRoot, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  const tls = {
    key: readFileSync(join(tlsRoot, "key.pem")),
    cert: readFileSync(join(tlsRoot, "cert.pem")),
  };
  let providerOrigin;
  let lastApprovalStatus;
  workerServer = createHttpsServer(tls, async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = await mf.dispatchFetch(origin + req.url, {
        method: req.method,
        headers: req.headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
        redirect: "manual",
      });
      if (req.url === "/auth/desktop/approve")
        lastApprovalStatus = response.status;
      const headers = Object.fromEntries(response.headers);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) headers["set-cookie"] = cookies;
      if (
        headers.location?.startsWith(
          "https://github.com/login/oauth/authorize?",
        )
      ) {
        const upstream = new URL(headers.location);
        headers.location = providerOrigin + upstream.pathname + upstream.search;
      }
      delete headers["transfer-encoding"];
      delete headers["connection"];
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500);
      res.end("Synthetic gateway failure");
    }
  });
  providerServer = createHttpsServer(tls, (req, res) => {
    const request = new URL(req.url, "https://localhost");
    if (request.pathname !== "/login/oauth/authorize") {
      res.writeHead(404);
      res.end();
      return;
    }
    const callback = new URL(request.searchParams.get("redirect_uri"));
    callback.searchParams.set("state", request.searchParams.get("state"));
    callback.searchParams.set("code", "synthetic-provider-code");
    callback.searchParams.set("iss", "https://github.com/login/oauth");
    res.writeHead(302, {
      Location: callback.href,
      "Referrer-Policy": "no-referrer",
    });
    res.end();
  });
  await new Promise((resolve) => workerServer.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) =>
    providerServer.listen(0, "127.0.0.1", resolve),
  );
  origin = `https://orven.localhost:${workerServer.address().port}`;
  providerOrigin = `https://provider.localhost:${providerServer.address().port}`;
  const bundled = await build({
    absWorkingDir: workerRoot,
    entryPoints: ["src/index.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundled.outputFiles[0].text,
      compatibilityDate: "2026-11-09",
      d1Databases: ["DB"],
      cf: false,
      log: new Log(LogLevel.NONE),
      bindings: {
        ORVEN_AUTH_ORIGIN: origin,
        GITHUB_CLIENT_ID: "synthetic",
        GITHUB_CLIENT_SECRET: "synthetic",
      },
      outboundService: async (request) => {
        if (request.url === "https://github.com/login/oauth/access_token")
          return Response.json({
            access_token: "synthetic-provider-token",
            token_type: "bearer",
            scope: "",
          });
        if (request.url === "https://api.github.com/user") {
          assert.equal(
            request.headers.get("Authorization"),
            "Bearer synthetic-provider-token",
          );
          return Response.json({ id: 42, login: "fixture-engineer" });
        }
        throw new Error(
          "Unexpected outbound request denied by integration harness",
        );
      },
    }),
  );

  const db = await mf.getD1Database("DB");
  for (const name of readdirSync(
    new URL("../../cloud/handoff/migrations/", import.meta.url),
  )
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(
      new URL(`../../cloud/handoff/migrations/${name}`, import.meta.url),
      "utf8",
    ).replace(/--[^\n]*/g, "");
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(statement).run();
  }
  browser = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: [
      "--host-resolver-rules=MAP orven.localhost 127.0.0.1, MAP provider.localhost 127.0.0.1",
    ],
  });
  const results = [];
  for (const mode of [
    "complete",
    "expired",
    "missing_session",
    "duplicate_form",
  ]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    context.setDefaultTimeout(10_000);
    try {
      const page = await context.newPage();
      const cspErrors = [];
      page.on("console", (message) => {
        if (/Content Security Policy|form-action/.test(message.text()))
          cspErrors.push(message.text());
      });
      await context.route("https://avatars.githubusercontent.com/**", (route) =>
        route.abort(),
      );
      const verifier = secret(),
        state = secret();
      const params = new URLSearchParams({
        port: String(server.address().port),
        state,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
      });
      await page.goto(`${origin}/auth/desktop/start?${params}`);
      await page.waitForURL(`${origin}/auth/desktop/confirm`);
      await page
        .getByRole("dialog", { name: "Sign in to Orven Desktop" })
        .waitFor();
      const cookies = await context.cookies(origin);
      assert(cookies.some((c) => c.name === "__Host-orven-session"));
      const flow = cookies.find((c) => c.name === "__Host-orven-desktop-flow");
      assert(flow);
      if (mode === "expired")
        await db
          .prepare(
            "UPDATE desktop_login_flows SET expires_at = 0 WHERE flow_id = ?",
          )
          .bind(flow.value)
          .run();
      if (mode === "missing_session")
        await context.clearCookies({ name: "__Host-orven-session" });
      if (mode === "duplicate_form")
        await page
          .locator('form[action="/auth/desktop/approve"]')
          .evaluate((form) => {
            form.append(
              form.querySelector('input[name="flow_id"]').cloneNode(),
            );
          });
      const before = callbacks.length;
      await page
        .getByRole("button", { name: "Continue as fixture-engineer" })
        .click();
      if (mode === "complete") {
        try {
          await page.waitForURL(redirect + "?**", { timeout: 5000 });
        } catch {
          let failureCode;
          try {
            failureCode = JSON.parse(
              await page.locator("body").innerText(),
            ).code;
          } catch {}
          throw new Error(
            JSON.stringify({
              step: "loopback_navigation",
              path: new URL(page.url()).pathname,
              approval_status: lastApprovalStatus,
              failure_code: failureCode,
              csp_violations: cspErrors.length,
              form_action_rejected: cspErrors.some((text) =>
                text.includes("form-action"),
              ),
            }),
          );
        }
        assert(!callbackFailure, callbackFailure?.message);
        assert.equal(callbacks.length, before + 1);
        assert.equal(callbacks.at(-1).state, state);
        assert.deepEqual(cspErrors, []);
        const payload = {
          code: callbacks.at(-1).code,
          code_verifier: verifier,
          redirect_uri: redirect,
        };
        const exchange = () =>
          mf.dispatchFetch(origin + "/auth/desktop/exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        const exchanged = await exchange();
        assert.equal(exchanged.status, 200);
        const data = await exchanged.json();
        assert.equal(data.profile.github_account_id, "42");
        assert.equal(
          data.profile.avatar_url,
          "https://avatars.githubusercontent.com/u/42?v=4",
        );
        assert.match(data.desktop_credential, /^[A-Za-z0-9_-]{43}$/);
        assert.equal((await exchange()).status, 400);
        const headers = { Authorization: `Bearer ${data.desktop_credential}` };
        assert.equal(
          (
            await mf.dispatchFetch(origin + "/auth/desktop/profile", {
              headers,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await mf.dispatchFetch(origin + "/auth/desktop/revoke", {
              method: "POST",
              headers,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await mf.dispatchFetch(origin + "/auth/desktop/profile", {
              headers,
            })
          ).status,
          401,
        );
      } else {
        await page.waitForURL(origin + "/auth/desktop/approve");
        const failure = JSON.parse(await page.locator("body").innerText());
        assert.equal(
          failure.code,
          {
            expired: "flow_expired_or_unavailable",
            missing_session: "browser_session_unavailable",
            duplicate_form: "invalid_form",
          }[mode],
        );
        assert.equal(callbacks.length, before);
        assert.equal(
          (
            await db
              .prepare("SELECT COUNT(*) AS n FROM desktop_credentials")
              .first()
          ).n,
          0,
        );
      }
      results.push({ mode, passed: true });
    } finally {
      await context.close();
    }
  }
  const receipt = {
    runtime: "Chrome + local workerd/D1",
    provider: "synthetic",
    results,
    nativeKeychainVerified: false,
  };
  const output = new URL("../test-results/", import.meta.url);
  mkdirSync(output, { recursive: true });
  writeFileSync(
    new URL("auth-handoff-integration.json", output),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      runtime: "Chrome + local workerd/D1",
      provider: "synthetic; all external egress intercepted",
      results,
      nativeKeychainVerified: false,
    }),
  );
} finally {
  await browser?.close();
  await mf?.dispose();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  if (workerServer?.listening)
    await new Promise((resolve) => workerServer.close(resolve));
  if (providerServer?.listening)
    await new Promise((resolve) => providerServer.close(resolve));
  if (tlsRoot) rmSync(tlsRoot, { recursive: true, force: true });
}
