// Run against an isolated production preview with the exact native CSP.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", resolve);
});
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { stdio: "ignore" },
);
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Production preview exited before verification");
    try {
      ready = (await fetch(origin)).ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Production preview unavailable");
  const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  browser = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.cspFailures = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.cspFailures.push(event.violatedDirective),
    );
  });
  await page.route(origin + "/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "content-security-policy": config.app.security.csp,
      },
    });
  });
  await page.goto(origin);
  await page.evaluate(() => document.fonts.ready);
  const result = {
    shells: await page.locator(".app").count(),
    scriptErrors: errors,
    cspFailures: await page.evaluate(() => window.cspFailures),
  };
  const output = resolve("../docs/ui-refinement/after");
  mkdirSync(output, { recursive: true });
  writeFileSync(
    resolve(output, "production-csp.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  process.stdout.write(JSON.stringify(result) + "\n");
  if (result.shells !== 1 || errors.length || result.cspFailures.length)
    process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
