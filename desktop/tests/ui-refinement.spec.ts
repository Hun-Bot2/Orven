import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const artifacts = resolve("../docs/ui-refinement/after");
const profile = {
  user_id: "11111111-1111-4111-8111-111111111111",
  github_account_id: "42",
  username: "fixture-github-engineer-with-long-name",
  avatar_url: "https://avatars.githubusercontent.com/u/42?v=4",
};
type Mode =
  | "signed_out"
  | "authenticated"
  | "waiting"
  | "expired"
  | "error"
  | "loading"
  | "missing_avatar";
async function mount(page: Page, mode: Mode = "authenticated", long = false) {
  await page.addInitScript(
    ({ profile, mode, long }) => {
      const out = {
        status: "signed_out",
        profile: null,
        avatar_data_url: null,
      };
      let state = mode;
      const project = {
        id: "11111111-1111-4111-8111-111111111111",
        name: long
          ? "Orven-한글-Engineering-Workspace-with-a-very-long-repository-name-for-review"
          : "Orven fixture",
        path: "/synthetic/orven-fixture",
      };
      (
        window as unknown as {
          snapshotCount: number;
          forceAccountError: boolean;
        }
      ).snapshotCount = 0;
      (window as unknown as { forceAccountError: boolean }).forceAccountError =
        false;
      window.__ORVEN_TEST_BRIDGE__ = async (command) => {
        if (command === "bootstrap")
          return { projects: [project], active_project_id: project.id };
        if (command === "list_runs")
          return { runs: [], unavailable: 0, incomplete: 0 };
        if (command === "account_snapshot") {
          (window as unknown as { snapshotCount: number }).snapshotCount++;
          if (state === "loading") await new Promise(() => {});
          if (
            state === "error" ||
            (window as unknown as { forceAccountError: boolean })
              .forceAccountError
          )
            throw new Error("Synthetic network outage");
          if (state === "expired") return { ...out, status: "expired" };
          if (state === "waiting") return { ...out, status: "waiting" };
          return state === "signed_out"
            ? out
            : {
                status: "authenticated",
                profile,
                avatar_data_url:
                  state === "missing_avatar"
                    ? null
                    : "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1kAAAAASUVORK5CYII=",
              };
        }
        if (command === "account_poll") return { ...out, status: "waiting" };
        if (command === "account_begin") {
          state = "waiting";
          return null;
        }
        if (command === "account_cancel" || command === "account_logout") {
          state = "signed_out";
          return out;
        }
        if (command === "gateway_snapshot")
          return {
            ok: true,
            code: "ok",
            sessions: [
              { session_id: "synthetic-session-1", client: "Fixture host" },
            ],
            snapshot: {
              running: true,
              session_id: "synthetic-session-1",
              transport: "stdio",
              client: "Fixture host",
              access: [],
              briefs: [],
            },
          };
        throw new Error("Synthetic operation unavailable");
      };
    },
    { profile, mode, long },
  );
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  if (mode !== "loading")
    await expect(page.locator(".account-trigger-loading")).toHaveCount(0);
}
async function security(page: Page) {
  if (await page.getByRole("button", { name: "Open navigation" }).isVisible()) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("dialog", { name: "Navigation" })
      .getByRole("button", { name: "Settings", exact: true })
      .click();
  } else
    await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Connections & Security", exact: true }),
  ).toBeVisible();
}

test("account toolbar exposes every auth state without asserting unknown authentication", async ({
  page,
}) => {
  mkdirSync(artifacts, { recursive: true });
  const results = [];
  for (const mode of [
    "signed_out",
    "authenticated",
    "waiting",
    "expired",
    "error",
    "loading",
    "missing_avatar",
  ] as const) {
    await mount(page, mode);
    const trigger = page.locator(".account-trigger");
    await expect(trigger).toBeVisible();
    const visibleLabel = (await trigger.innerText()).trim();
    if (visibleLabel && mode !== "authenticated" && mode !== "missing_avatar")
      expect(await trigger.getAttribute("aria-label")).toContain(visibleLabel);
    await trigger.click();
    const popover = page.getByRole("dialog", {
      name: "GitHub account options",
    });
    await expect(popover).toBeVisible();
    if (mode !== "authenticated" && mode !== "missing_avatar") {
      await expect(trigger.getByRole("img")).toHaveCount(0);
      await expect(popover.getByText("Verified", { exact: true })).toHaveCount(
        0,
      );
    }
    if (mode === "expired")
      await expect(
        popover.getByRole("button", { name: "Sign in again" }),
      ).toBeVisible();
    if (mode === "error")
      await expect(
        popover.getByRole("button", { name: "Sign in with GitHub" }),
      ).toHaveCount(0);
    if (mode === "missing_avatar")
      await expect(
        trigger.getByRole("img", { name: "Avatar unavailable" }),
      ).toBeVisible();
    await page.screenshot({ path: resolve(artifacts, `account-${mode}.png`) });
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(trigger).toBeFocused();
    results.push({ mode, visible: true, keyboardDismissal: true });
  }
  writeFileSync(
    resolve(artifacts, "account-states.json"),
    JSON.stringify(results, null, 2),
  );
});

test("settings and toolbar share verification; a failed recheck removes the verified avatar", async ({
  page,
}) => {
  await mount(page);
  await security(page);
  expect(
    await page.evaluate(
      () => (window as unknown as { snapshotCount: number }).snapshotCount,
    ),
  ).toBe(1);
  await page.evaluate(() => {
    (window as unknown as { forceAccountError: boolean }).forceAccountError =
      true;
  });
  await page
    .getByRole("region", { name: "GitHub account" })
    .getByRole("button", { name: "Retry account verification" })
    .click();
  await expect(page.locator(".account-trigger-unavailable")).toBeVisible();
  await expect(page.locator(".account-trigger img")).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "GitHub account" })
      .getByText("Verified", { exact: true }),
  ).toHaveCount(0);
});

test("desktop widths, zoom-equivalent reflow and long names keep Search, Run Audit and account reachable", async ({
  page,
}) => {
  for (const width of [1440, 1280, 980, 640, 490, 320]) {
    await page.setViewportSize({ width, height: width > 800 ? 900 : 780 });
    await mount(page, "signed_out", true);
    await security(page);
    await expect(
      page.getByRole("button", { name: "Search evidence" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Run Audit", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".account-trigger")).toBeVisible();
    const bounds = await page.locator(".toolbar").evaluate((element) => ({
      scroll: element.scrollWidth,
      width: element.clientWidth,
    }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: resolve(artifacts, `security-${width}.png`),
    });
    if (width >= 980) {
      // Browser geometry of the native safe-area class; actual traffic lights are captured separately.
      await page
        .locator(".app")
        .evaluate((element) => element.classList.add("native-macos"));
      const brand = await page.locator(".brand").boundingBox();
      expect(brand!.x).toBeGreaterThanOrEqual(96);
      expect(Math.abs(brand!.y + brand!.height / 2 - 28)).toBeLessThan(1);
      const toolbar = await page
        .locator(".toolbar")
        .evaluate((element) => element.scrollWidth <= element.clientWidth);
      expect(toolbar).toBe(true);
    }
  }
});

test("account popover, disclosures and access dialog pass automated WCAG checks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mount(page);
  await security(page);
  await page.getByText("Implemented audit policy", { exact: false }).click();
  const results = [];
  for (const surface of ["security", "account", "access"] as const) {
    if (surface === "account") {
      await page.keyboard.press("Escape");
      await page.locator(".account-trigger").click();
    }
    if (surface === "access") {
      await page.keyboard.press("Escape");
      await security(page);
      await page.getByRole("button", { name: "Edit access" }).click();
    }
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    writeFileSync(
      resolve(artifacts, `axe-${surface}.json`),
      JSON.stringify(
        {
          violations: audit.violations,
          incomplete: audit.incomplete.map((result) => ({
            id: result.id,
            impact: result.impact,
          })),
        },
        null,
        2,
      ),
    );
    results.push({
      surface,
      violations: audit.violations.map((result) => ({
        id: result.id,
        nodes: result.nodes.map((node) => node.target),
      })),
    });
  }
  expect(results).toEqual(
    results.map((result) => ({ ...result, violations: [] })),
  );
});

test("rendered semantic text, controls and focus colors meet AA thresholds", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await mount(page);
  const appearance = await page.locator(".main").evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = getComputedStyle(element).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    return {
      scheme: getComputedStyle(element).colorScheme,
      rgb: Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3),
    };
  });
  expect(appearance.scheme).toBe("light");
  expect(appearance.rgb).toEqual([255, 255, 255]);
  const pairs = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    const rgb = (color: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
    };
    const luminance = (color: number[]) =>
      color
        .map((c) => c / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    return [
      ["--muted", "--rail", 4.5],
      ["--muted", "--subtle", 4.5],
      ["--secondary", "--paper", 4.5],
      ["--color-selection-text", "--color-selection-bg", 4.5],
      ["--color-success-text", "--color-success-bg", 4.5],
      ["--color-warning-text", "--color-warning-bg", 4.5],
      ["--color-danger-text", "--color-danger-bg", 4.5],
      ["--paper", "--color-action-solid", 4.5],
      ["--color-input-border", "--paper", 3],
      ["--color-focus", "--paper", 3],
    ].map(([fg, bg, threshold]) => {
      const foreground = rgb(styles.getPropertyValue(fg as string));
      const background = rgb(styles.getPropertyValue(bg as string));
      const a = luminance(foreground),
        b = luminance(background);
      return {
        fg,
        bg,
        foreground,
        background,
        threshold,
        contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      };
    });
  });
  writeFileSync(
    resolve(artifacts, "contrast.json"),
    JSON.stringify(pairs, null, 2),
  );
  for (const pair of pairs)
    expect(pair.contrast, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(
      pair.threshold as number,
    );
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  const outline = await page
    .getByRole("link", { name: "Skip to content" })
    .evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe("none");
});

test("sidebar overflow and settings preserve navigation and focus", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const projects = Array.from({ length: 35 }, (_, i) => ({
      id: `project-${i}`,
      name:
        i === 0
          ? "Long-한글-repository-name-that-must-remain-readable-with-overflow"
          : `Repository ${i}`,
      path: `/synthetic/repository-${i}`,
    }));
    window.__ORVEN_TEST_BRIDGE__ = async (command) => {
      if (command === "bootstrap")
        return { projects, active_project_id: projects[0].id };
      if (command === "list_runs")
        return { runs: [], unavailable: 0, incomplete: 0 };
      if (command === "select_project") return null;
      if (command === "account_snapshot")
        return { status: "signed_out", profile: null, avatar_data_url: null };
      if (command === "gateway_snapshot")
        return { ok: true, snapshot: null, sessions: [] };
      throw new Error("Unavailable synthetic command");
    };
  });
  await page.goto("/");
  await expect(page.locator(".workspace-item")).toHaveCount(35);
  const list = page.locator(".workspace-list");
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
    true,
  );
  await expect(page.locator(".workspace-item").first()).toHaveAttribute(
    "aria-current",
    "true",
  );
  for (const width of [1440, 980]) {
    await page.setViewportSize({ width, height: 800 });
    const brand = await page.locator(".brand").boundingBox();
    const item = await page
      .locator(".side-navigation button")
      .first()
      .boundingBox();
    const padding = await page
      .locator(".side-navigation button")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    expect(Math.abs(brand!.x - (item!.x + padding + 2))).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: `test-results/navigation-after-${width}.png`,
    });
  }
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: "test-results/navigation-settings.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(settings).toBeFocused();
  await page.setViewportSize({ width: 490, height: 650 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.screenshot({
    path: "test-results/navigation-settings-narrow.png",
  });
});
