import { test, expect, type Page } from "@playwright/test";
import type { Report, Project } from "../src/types";
const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const projects: Project[] = [
  { id: first, name: "orven-fixture", path: "/synthetic/orven-fixture" },
  { id: second, name: "한글-workspace", path: "/synthetic/한글-workspace" },
];
function report(run: string, commit: string, paths: string[]): Report {
  return {
    schema_version: 1,
    run_id: run,
    repository_id: first,
    origin: "local",
    captured_unix_seconds: 1794093600,
    commit,
    manifest_sha256: "a".repeat(64),
    policy: "committed-text-v1",
    collector_version: "0.1.0",
    status: "complete",
    execution_status: "not_run",
    analysis_status: "unavailable",
    checks: [
      {
        id: "committed_inventory",
        status: "success",
        version: "committed-text-v1",
        reason: "Bounded inventory completed",
      },
      {
        id: "repository_execution",
        status: "skipped",
        version: "committed-text-v1",
        reason: "Target commands not run",
      },
    ],
    evidence: paths.map((path, i) => ({
      id: `e${i + 1}`,
      path,
      blob_id: "b".repeat(40),
      sha256: "c".repeat(64),
      content:
        "# Synthetic visual fixture\n\nRead-only committed snapshot.\n<script>window.pwned=true</script>\n한글 evidence retained\n",
      capture_status: "captured",
      byte_start: 0,
      byte_end: 100,
    })),
    exclusions: [
      { path: "worktree", reason: "Dirty/untracked files excluded" },
      { path: ".env", reason: "Secret-path policy" },
    ],
    findings: paths.map((path, i) => ({
      title: `Committed inventory entry: ${path}`,
      classification: "observed",
      severity: "info",
      rationale:
        "A committed text entry was observed; no execution claim is made.",
      recommendation:
        "Review the captured evidence before drawing engineering conclusions.",
      limitations:
        "Inventory only; correctness and runtime behavior are unverified.",
      evidence_ids: [`e${i + 1}`],
    })),
  };
}
const reports = [
  report("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "a".repeat(40), [
    "Cargo.toml",
    "docs/architecture.md",
    "README.md",
    "src/workspace.json",
  ]),
  report("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "b".repeat(40), [
    "README.md",
    "docs/decisions.md",
  ]),
];
async function fixture(page: Page, delay = false, failListing = false) {
  await page.addInitScript(
    ({ projects, reports, delay, failListing }) => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      window.__ORVEN_TEST_BRIDGE__ = async (command, args) => {
        if (command === "bootstrap")
          return { projects, active_project_id: projects[0].id };
        if (command === "select_project")
          return { projects, active_project_id: args?.projectId };
        if (command === "register_project") return null;
        if (command === "list_runs") {
          if (failListing) throw new Error("Saved records unavailable");
          if (args?.projectId === projects[1].id)
            return { runs: [], unavailable: 0, incomplete: 0 };
          return {
            runs: reports.map((r) => ({
              run_id: r.run_id,
              commit: r.commit,
              captured_unix_seconds: r.captured_unix_seconds,
              evidence_count: r.evidence.length,
              exclusion_count: r.exclusions.length,
              finding_count: r.findings.length,
              status: r.status,
            })),
            unavailable: 0,
            incomplete: 0,
          };
        }
        if (command === "read_report") {
          if (delay) await wait(500);
          return reports.find((r) => r.run_id === args?.runId);
        }
        if (command === "run_audit") {
          await wait(200);
          if (args?.commit === "0".repeat(40))
            throw new Error("Requested commit unavailable");
          return reports[0].run_id;
        }
        throw new Error("Unexpected synthetic test command");
      };
    },
    { projects, reports, delay, failListing },
  );
  await page.goto("/");
}
test("Option A report, history, security and evidence render without fictitious connections", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:1420")) requests.push(r.url());
  });
  await fixture(page);
  await expect(
    page.getByRole("heading", {
      name: "Committed Snapshot Engineering Report",
    }),
  ).toBeVisible();
  await expect(page.getByText("SYNTHETIC VISUAL TEST FIXTURE")).toBeVisible();
  expect(
    await page
      .locator(".sidebar")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBe(240);
  expect(
    await page
      .locator(".toolbar")
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBe(54);
  expect(
    await page.locator("h1").evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain("Newsreader");
  await page.screenshot({ path: "test-results/phase2a-report.png" });
  await page
    .getByRole("button", { name: "Inspect evidence", exact: true })
    .click();
  await expect(page.getByLabel("Evidence inspector")).toBeVisible();
  await expect(page.locator(".evidence-code")).toContainText(
    "<script>window.pwned=true</script>",
  );
  expect(await page.evaluate(() => "pwned" in window)).toBe(false);
  await page.screenshot({ path: "test-results/phase2a-evidence.png" });
  await page.getByRole("button", { name: "Close evidence" }).click();
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: "History & Snapshots" })
    .click();
  await expect(
    page.getByRole("table", { name: "Saved audit runs" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/phase2a-history.png" });
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: "Connections & Security" })
    .click();
  await expect(
    page.getByText("Gateway unavailable. No live session state is available."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Remote HTTP and provider connectivity are not established by this local session.",
    ),
  ).toBeVisible();
  await expect(page.getByText("OS ISOLATION")).toBeVisible();
  await page.screenshot({ path: "test-results/phase2a-security.png" });
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: "Audit Workspace" })
    .click();
  await expect(
    page.getByRole("table", { name: "Captured evidence" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/phase2a-workspace.png" });
  expect(requests).toEqual([]);
});
test("workspace switch clears evidence; stale report response cannot populate another project", async ({
  page,
}) => {
  await fixture(page, true);
  await page
    .getByRole("button", { name: "한글-workspace", exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: "No report selected" }),
  ).toBeVisible();
  await page.waitForTimeout(650);
  await expect(
    page.getByText("Committed inventory entry: Cargo.toml"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await expect(
    page.getByRole("dialog", { name: "Switch workspace" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/phase2a-switcher.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("audit dialog validates input, handles failure and returns saved report on success", async ({
  page,
}) => {
  await fixture(page);
  await expect(
    page.getByRole("button", { name: "Inspect evidence", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run Audit", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Run audit", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Full commit ID").fill("0".repeat(40));
  await page.screenshot({ path: "test-results/phase2a-audit-dialog.png" });
  await dialog.getByRole("button", { name: "Run audit", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Requested commit unavailable",
  );
  await page.getByRole("button", { name: "Run Audit", exact: true }).click();
  await page.getByLabel("Full commit ID").fill("a".repeat(40));
  await dialog.getByRole("button", { name: "Run audit", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Committed Snapshot Engineering Report",
    }),
  ).toBeVisible();
});
test("keyboard search and compact inspector retain usable geometry", async ({
  page,
}) => {
  await fixture(page);
  await expect(
    page.getByRole("button", { name: "Inspect evidence", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", { name: "Search captured paths" })
    .fill("architecture");
  await expect(page.locator(".search-results button")).toHaveCount(1);
  await page.locator(".search-results button").click();
  await page.setViewportSize({ width: 980, height: 760 });
  await expect(page.getByLabel("Evidence inspector")).toBeVisible();
  await page.screenshot({ path: "test-results/phase2a-compact.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("plain browser never fabricates projects or native connectivity", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("Native workspace unavailable in this browser."),
  ).toBeVisible();
  await expect(
    page.getByText("Open native Orven to view repositories"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run Audit", exact: true }),
  ).toBeDisabled();
});

test("unavailable saved records stay unknown rather than recorded zero", async ({
  page,
}) => {
  await fixture(page, false, true);
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: "History & Snapshots" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Saved audit records unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No saved audits yet" }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: "Overview" })
    .click();
  await expect(page.getByText("Unknown", { exact: true })).toBeVisible();
});
