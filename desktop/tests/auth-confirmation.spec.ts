import { test, expect } from "@playwright/test";
import { confirmationPage } from "../../cloud/handoff/src/auth/confirmation";

async function mount(page: import("@playwright/test").Page) {
  await page.route(
    "https://orven.example/auth/desktop/confirm",
    async (route) => {
      const response = confirmationPage(
        "fixture-engineer",
        "https://avatars.githubusercontent.com/u/42?v=4",
        "synthetic-flow",
        "http://127.0.0.1:45123/orven-auth/callback",
      );
      await route.fulfill({
        status: 200,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    },
  );
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.abort(),
  );
  await page.goto("https://orven.example/auth/desktop/confirm");
}

test("confirmation is a centered native modal with CSP and explicit approval", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy"))
      violations.push(message.text());
  });
  await mount(page);
  const dialog = page.getByRole("dialog", { name: "Sign in to Orven Desktop" });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(true);
  await expect(
    dialog.getByText("fixture-engineer", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText(
      "This signs in the desktop app. It grants no repository or MCP access.",
    ),
  ).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(Math.abs(bounds!.x + bounds!.width / 2 - 720)).toBeLessThan(2);
  await page.screenshot({ path: "/tmp/orven-confirm-modal-1440.png" });
  expect(violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sign-in not completed" }),
  ).toBeVisible();
});

test("confirmation reflows and cancellation never submits approval", async ({
  page,
}) => {
  let approvals = 0;
  await page.route(
    "https://orven.example/auth/desktop/approve",
    async (route) => {
      approvals++;
      await route.fulfill({ body: "Unexpected approval" });
    },
  );
  await page.setViewportSize({ width: 320, height: 640 });
  await mount(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/orven-confirm-modal-320.png" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(approvals).toBe(0);
});

test("Continue posts only the flow to the existing same-origin endpoint", async ({
  page,
}) => {
  await mount(page);
  let submittedOrigin: string | null = null;
  let submittedReferrer: string | null = null;
  await page.route(
    "https://orven.example/auth/desktop/approve",
    async (route) => {
      submittedOrigin = await route.request().headerValue("origin");
      submittedReferrer = await route.request().headerValue("referer");
      expect(route.request().method()).toBe("POST");
      expect(route.request().postData()).toBe("flow_id=synthetic-flow");
      await route.fulfill({
        contentType: "text/plain",
        body: "Synthetic approval received",
      });
    },
  );
  await page
    .getByRole("button", { name: "Continue as fixture-engineer" })
    .click();
  await expect(page.getByText("Synthetic approval received")).toBeVisible();
  expect(submittedOrigin).toBe("https://orven.example");
  expect(submittedReferrer).toBe("https://orven.example/");
});
