import { expect, test, type Page } from "@playwright/test";
const profile = {
  user_id: "11111111-1111-4111-8111-111111111111",
  github_account_id: "42",
  username: "fixture-user",
  avatar_url: "https://avatars.githubusercontent.com/u/42?v=4",
};
const avatar =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1kAAAAASUVORK5CYII=";
async function fixture(
  page: Page,
  mode:
    | "signed_out"
    | "restored"
    | "unavailable"
    | "slow_cancel"
    | "start_unavailable" = "signed_out",
) {
  await page.addInitScript(
    ({ profile, avatar, mode }) => {
      const out = {
        status: "signed_out",
        profile: null,
        avatar_data_url: null,
      };
      const authenticated = {
        status: "authenticated",
        profile,
        avatar_data_url: avatar,
      };
      let signedIn = mode === "restored";
      let logoutAttempts = 0;
      (window as unknown as { accountCalls: string[] }).accountCalls = [];
      window.__ORVEN_TEST_BRIDGE__ = async (command) => {
        if (command.startsWith("account_"))
          (window as unknown as { accountCalls: string[] }).accountCalls.push(
            command,
          );
        if (command === "bootstrap")
          return { projects: [], active_project_id: null };
        if (command === "account_snapshot") {
          if (mode === "unavailable") throw new Error("Synthetic outage");
          return signedIn ? authenticated : out;
        }
        if (command === "account_begin") {
          if (mode === "start_unavailable")
            throw new Error("Authentication API unavailable");
          return null;
        }
        if (command === "account_poll") {
          if (mode === "slow_cancel")
            await new Promise((resolve) => setTimeout(resolve, 1500));
          signedIn = true;
          return authenticated;
        }
        if (command === "account_cancel") return null;
        if (command === "account_logout") {
          if (mode === "restored" && ++logoutAttempts === 1)
            throw new Error("Synthetic revocation outage");
          signedIn = false;
          return out;
        }
        throw new Error("Unavailable synthetic command");
      };
    },
    { profile, avatar, mode },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  return page.getByRole("region", { name: "GitHub account" });
}

test("settings signs in through Rust and renders verified profile without browser requests or tokens", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      !request.url().startsWith("http://127.0.0.1:1420")
    )
      external.push(request.url());
  });
  const account = await fixture(page);
  await account.getByRole("button", { name: "Sign in with GitHub" }).click();
  await expect(
    account.getByText("Complete GitHub sign-in", { exact: false }),
  ).toBeVisible();
  await expect(
    account.getByText("fixture-user", { exact: true }),
  ).toBeVisible();
  await expect(
    account.getByRole("img", { name: "fixture-user's GitHub avatar" }),
  ).toBeVisible();
  await expect(account.getByRole("button", { name: "Sign out" })).toBeVisible();
  expect(external).toEqual([]);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  await page.screenshot({ path: "test-results/account-authenticated.png" });
});

test("restored session and failed revocation remain explicit until retry succeeds", async ({
  page,
}) => {
  const account = await fixture(page, "restored");
  await expect(
    account.getByText("fixture-user", { exact: true }),
  ).toBeVisible();
  await account.getByRole("button", { name: "Sign out" }).click();
  await expect(account.getByRole("alert")).toContainText("retained");
  await expect(account.getByText("fixture-user", { exact: true })).toHaveCount(
    0,
  );
  await account.getByRole("button", { name: "Sign out" }).click();
  await expect(
    account.getByRole("button", { name: "Sign in with GitHub" }),
  ).toBeVisible();
});

test("unverified saved account does not appear signed out or allow an account switch", async ({
  page,
}) => {
  const account = await fixture(page, "unavailable");
  await expect(account.getByRole("alert")).toContainText(
    "verification is unavailable",
  );
  await expect(
    account.getByRole("button", { name: "Sign in with GitHub" }),
  ).toHaveCount(0);
  await expect(account.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(
    account.getByRole("button", { name: "Retry account verification" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/account-unavailable.png" });
});

test("cancellation ignores a late callback result", async ({ page }) => {
  const account = await fixture(page, "slow_cancel");
  await account.getByRole("button", { name: "Sign in with GitHub" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { accountCalls: string[] }).accountCalls.includes(
          "account_poll",
        ),
      ),
    )
    .toBe(true);
  await account.getByRole("button", { name: "Cancel sign-in" }).click();
  await expect(
    account.getByRole("button", { name: "Sign in with GitHub" }),
  ).toBeVisible();
  await page.waitForTimeout(1600);
  await expect(account.getByText("fixture-user", { exact: true })).toHaveCount(
    0,
  );
});

test("unavailable authentication backend does not leave the app waiting for GitHub", async ({
  page,
}) => {
  const panel = await fixture(page, "start_unavailable");
  await panel.getByRole("button", { name: "Sign in with GitHub" }).click();
  await expect(
    panel.getByText(/authentication API may be unavailable or not deployed/),
  ).toBeVisible();
  await expect(
    page.getByText("Waiting for GitHub", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".account-trigger")).toHaveText(
    "Account unavailable",
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { accountCalls: string[] }).accountCalls,
    ),
  ).not.toContain("account_poll");
});
