import { test, expect, type Page } from "@playwright/test";
import type { Report } from "../src/types";
const project = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Synthetic workspace",
  path: "/synthetic/workspace",
};
function makeReport(
  id: string,
  commit: string,
  path: string,
  time: number,
): Report {
  return {
    schema_version: 1,
    run_id: id,
    repository_id: project.id,
    origin: "local",
    captured_unix_seconds: time,
    commit: commit.repeat(40),
    manifest_sha256: "a".repeat(64),
    policy: "committed-text-v1",
    collector_version: "0.1.0",
    status: "complete",
    execution_status: "not_run",
    analysis_status: "unavailable",
    checks: [],
    evidence: [
      {
        id: "e1",
        path,
        blob_id: "b".repeat(40),
        sha256: "c".repeat(64),
        content: "Synthetic fixture",
        capture_status: "captured",
        byte_start: 0,
        byte_end: 17,
      },
    ],
    exclusions: [],
    findings: [
      {
        title: `Committed inventory entry: ${path}`,
        classification: "observed",
        severity: "info",
        rationale: "Observed",
        recommendation: "Review",
        limitations: "Inventory only",
        evidence_ids: ["e1"],
      },
    ],
  };
}
const reports = [
  makeReport(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "a",
    "first.md",
    1794093600,
  ),
  makeReport(
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "b",
    "second.md",
    1794093700,
  ),
];
async function mount(page: Page, populated: boolean) {
  await page.addInitScript(
    ({ project, reports, populated }) => {
      window.__ORVEN_TEST_BRIDGE__ = async (command, args) => {
        if (command === "bootstrap")
          return { projects: [project], active_project_id: project.id };
        if (command === "list_runs")
          return {
            runs: populated
              ? reports.map((r) => ({
                  run_id: r.run_id,
                  commit: r.commit,
                  captured_unix_seconds: r.captured_unix_seconds,
                  evidence_count: r.evidence.length,
                  exclusion_count: r.exclusions.length,
                  finding_count: r.findings.length,
                  status: r.status,
                }))
              : [],
            unavailable: 0,
            incomplete: 0,
          };
        if (command === "read_report") {
          (window as unknown as { selectedIds: unknown[] }).selectedIds.push(
            args?.runId,
          );
          const found = reports.find((r) => r.run_id === args?.runId);
          if (!found) throw new Error("Unknown synthetic report");
          return found;
        }
        throw new Error(`Unexpected fixture command: ${command}`);
      };
      (window as unknown as { selectedIds: unknown[] }).selectedIds = [];
    },
    { project, reports, populated },
  );
  await page.goto("/");
}
async function navigate(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name })
    .click();
}
test("page boundary: empty history does not imply a safety result", async ({
  page,
}) => {
  await mount(page, false);
  await navigate(page, "History & Snapshots");
  await expect(
    page.getByRole("heading", { name: "No saved audits yet" }),
  ).toBeVisible();
  await expect(page.locator(".history-page")).not.toContainText(
    /verified safe|passed|100%|security score/i,
  );
  await expect(
    page.getByRole("table", { name: "Saved audit runs" }),
  ).toHaveCount(0);
});
test("page boundary: saved reports do not imply connected assistants or events", async ({
  page,
}) => {
  await mount(page, true);
  await expect(
    page.getByText("Committed inventory entry: first.md"),
  ).toBeVisible();
  await navigate(page, "Connections & Security");
  const security = page.locator(".security-page");
  await expect(
    security.getByText(
      "Gateway unavailable. No live session state is available.",
    ),
  ).toBeVisible();
  await expect(
    security.getByText(
      "Remote HTTP and provider connectivity are not established by this local session.",
    ),
  ).toBeVisible();
  await expect(
    security.getByText(
      "Permissions unavailable while the gateway cannot be reached.",
    ),
  ).toBeVisible();
  await expect(security).toContainText("Unverified");
  await expect(security).not.toContainText(
    /\bconnected\b|zero.network|access ledger|events recorded/i,
  );
  await expect(security.getByRole("table")).toHaveCount(0);
});
test("page boundary: history selection loads the selected saved report", async ({
  page,
}) => {
  await mount(page, true);
  await expect(
    page.getByText("Committed inventory entry: first.md"),
  ).toBeVisible();
  await navigate(page, "History & Snapshots");
  const table = page.getByRole("table", { name: "Saved audit runs" });
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await table
    .getByRole("row")
    .filter({ hasText: "bbbbbbbb" })
    .getByRole("button", { name: "View report" })
    .click();
  await expect(
    page.getByText("Committed inventory entry: second.md"),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { selectedIds: unknown[] }).selectedIds,
      ),
    )
    .toEqual([reports[0].run_id, reports[1].run_id]);
  await navigate(page, "History & Snapshots");
  await table
    .getByRole("row")
    .filter({ hasText: "aaaaaaaa" })
    .getByRole("button", { name: "View report" })
    .click();
  await expect(
    page.getByText("Committed inventory entry: first.md"),
  ).toBeVisible();
});
