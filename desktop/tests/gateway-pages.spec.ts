import { test, expect, type Page } from "@playwright/test";
const project = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Synthetic workspace",
  path: "/synthetic/workspace",
};
const brief = {
  id: "request-1",
  workspace_id: project.id,
  tool: "start_audit",
  source_client: "Untrusted host",
  source_identity: "session-1",
  supplied_context: {
    present: true,
    bytes: 7,
    sha256: "d".repeat(64),
    stored: false,
  },
  received_payload_redacted: {
    workspace_id: project.id,
    commit: "a".repeat(40),
    request_id: null,
    task_context: {
      present: true,
      bytes: 7,
      sha256: "d".repeat(64),
      stored: false,
    },
  },
  validated_arguments_sha256: "e".repeat(64),
  objective: "Audit committed snapshot",
  consent: "pending",
  status: "awaiting_consent",
  created: 1794093600,
  epoch: 1,
  execution_id: null,
  report_id: null,
  outbound_preview: null,
  outbound_sha256: null,
  trace: ["request received"],
};
async function mount(page: Page) {
  await page.addInitScript(
    ({ project, brief }) => {
      const calls: unknown[] = [];
      (window as unknown as { gatewayCalls: unknown[] }).gatewayCalls = calls;
      const snapshot = {
        running: true,
        session_id: "session-1",
        transport: "stdio",
        client: "Untrusted host",
        access: [
          {
            workspace_id: project.id,
            scope: { discover: false, audit: false, reports: false },
            epoch: 1,
            root_identity: "synthetic",
          },
        ],
        briefs: [brief],
      };
      window.__ORVEN_TEST_BRIDGE__ = async (command, args) => {
        if (command === "bootstrap")
          return { projects: [project], active_project_id: project.id };
        if (command === "list_runs")
          return { runs: [], unavailable: 0, incomplete: 0 };
        const sessions = [
          { session_id: "session-1", client: "Claude" },
          { session_id: "session-2", client: "Codex" },
        ];
        if (command === "gateway_snapshot") {
          const forced = (window as unknown as { gatewaySession?: string })
            .gatewaySession;
          const target =
            forced ?? (args?.sessionId as string | undefined) ?? "session-1";
          const disconnected =
            (window as unknown as { disconnected?: boolean }).disconnected &&
            target === "session-1";
          const state = window as unknown as { delayNext?: boolean };
          if (state.delayNext && target === "session-1") {
            state.delayNext = false;
            await new Promise((resolve) => setTimeout(resolve, 700));
          }
          return {
            ok: true,
            code: "ok",
            sessions: disconnected
              ? sessions.filter((session) => session.session_id !== "session-1")
              : sessions,
            snapshot: {
              ...snapshot,
              session_id: target,
              running: !disconnected,
              access: disconnected ? [] : snapshot.access,
              briefs: disconnected ? [] : snapshot.briefs,
              client: disconnected
                ? "Disconnected"
                : target === "session-2"
                  ? "Codex"
                  : "Claude",
            },
          };
        }
        if (command === "gateway_control") {
          const request = args?.request as { session_id: string };
          calls.push(request);
          return {
            ok: true,
            code: "ok",
            sessions,
            snapshot: {
              ...snapshot,
              session_id: request.session_id,
              client: request.session_id === "session-2" ? "Codex" : "Claude",
            },
          };
        }
        throw new Error(`Unexpected synthetic command ${command}`);
      };
    },
    { project, brief },
  );
  await page.goto("/");
}
async function navigate(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name })
    .click();
}
test("gateway pages: permissions require local confirmation and start denied", async ({
  page,
}) => {
  await mount(page);
  await navigate(page, "Connections & Security");
  await expect(
    page.getByText("Client-reported name (untrusted):"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit access" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm workspace access" });
  await expect(dialog.getByRole("checkbox")).toHaveCount(3);
  for (const box of await dialog.getByRole("checkbox").all())
    await expect(box).not.toBeChecked();
  await dialog.getByLabel("Discover workspace and summary").check();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { gatewayCalls: unknown[] }).gatewayCalls
            .length,
      ),
    )
    .toBe(0);
  await dialog.getByRole("button", { name: "Confirm access" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { gatewayCalls: unknown[] }).gatewayCalls,
      ),
    )
    .toContainEqual(
      expect.objectContaining({
        operation: "for_session",
        session_id: "session-1",
        request: {
          operation: "set_access",
          workspace_id: project.id,
          scope: { discover: true, audit: false, reports: false },
          session_id: "session-1",
        },
      }),
    );
});
test("gateway pages: decision requires preview and explicit confirmation", async ({
  page,
}) => {
  await mount(page);
  await navigate(page, "Context Handoffs");
  await expect(page.getByText("Audit committed snapshot")).toBeVisible();
  await page.screenshot({
    path: "test-results/synthetic-gateway-handoff.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Review approval" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm request approval" });
  await expect(dialog).toContainText("a".repeat(40));
  await page.screenshot({
    path: "test-results/synthetic-gateway-approval.png",
  });
  await expect(dialog).toContainText(
    "Unavailable; no report result is ready for transmission.",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { gatewayCalls: unknown[] }).gatewayCalls
            .length,
      ),
    )
    .toBe(0);
  await dialog.getByRole("button", { name: "Approve request" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { gatewayCalls: unknown[] }).gatewayCalls,
      ),
    )
    .toContainEqual(
      expect.objectContaining({
        operation: "for_session",
        session_id: "session-1",
        request: {
          operation: "decide",
          request_id: "request-1",
          approve: true,
        },
      }),
    );
});

test("gateway pages: revoke uses selected workspace", async ({ page }) => {
  await mount(page);
  await navigate(page, "Connections & Security");
  await page.getByRole("button", { name: "Revoke access" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { gatewayCalls: unknown[] }).gatewayCalls,
      ),
    )
    .toContainEqual(
      expect.objectContaining({
        operation: "for_session",
        session_id: "session-1",
        request: { operation: "revoke", workspace_id: project.id },
      }),
    );
});
test("gateway pages: denial is not dispatched until confirmed", async ({
  page,
}) => {
  await mount(page);
  await navigate(page, "Context Handoffs");
  await page.getByRole("button", { name: "Review denial" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm request denial" });
  await expect(dialog).toContainText("a".repeat(40));
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { gatewayCalls: unknown[] }).gatewayCalls
            .length,
      ),
    )
    .toBe(0);
  await page.getByRole("button", { name: "Review denial" }).click();
  await page
    .getByRole("dialog", { name: "Confirm request denial" })
    .getByRole("button", { name: "Deny request" })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { gatewayCalls: unknown[] }).gatewayCalls,
      ),
    )
    .toContainEqual(
      expect.objectContaining({
        operation: "for_session",
        session_id: "session-1",
        request: {
          operation: "decide",
          request_id: "request-1",
          approve: false,
        },
      }),
    );
});

test("gateway pages: restart dismisses a scope confirmation for the old session", async ({
  page,
}) => {
  await mount(page);
  await navigate(page, "Connections & Security");
  await page.getByRole("button", { name: "Edit access" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm workspace access" });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { gatewaySession: string }).gatewaySession =
      "replacement-session";
  });
  await expect(dialog).toBeHidden({ timeout: 5000 });
  expect(
    await page.evaluate(
      () => (window as unknown as { gatewayCalls: unknown[] }).gatewayCalls,
    ),
  ).toEqual([]);
});

test("gateway pages: session selection routes grants to selected session", async ({
  page,
}) => {
  await mount(page);
  await navigate(page, "Connections & Security");
  const selector = page.getByLabel("MCP connection");
  await expect(selector).toHaveValue("session-1");
  await selector.selectOption("session-2");
  await expect(page.getByLabel("MCP connection")).toHaveValue("session-2");
  await page.getByRole("button", { name: "Edit access" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm workspace access" });
  await dialog.getByLabel("Request audits").check();
  await dialog.getByRole("button", { name: "Confirm access" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { gatewayCalls: unknown[] }).gatewayCalls,
      ),
    )
    .toContainEqual(
      expect.objectContaining({
        operation: "for_session",
        session_id: "session-2",
        request: {
          operation: "set_access",
          workspace_id: project.id,
          scope: { discover: false, audit: true, reports: false },
          session_id: "session-2",
        },
      }),
    );
});

test("gateway pages: stale snapshot cannot replace selected connection", async ({
  page,
}) => {
  await mount(page);
  await navigate(page, "Connections & Security");
  await expect(page.getByLabel("MCP connection")).toHaveValue("session-1");
  await page.evaluate(() => {
    (window as unknown as { delayNext: boolean }).delayNext = true;
  });
  await page.getByRole("button", { name: "Refresh gateway" }).click();
  await page.getByLabel("MCP connection").selectOption("session-2");
  await expect(page.getByLabel("MCP connection")).toHaveValue("session-2");
  await page.waitForTimeout(850);
  await expect(page.getByLabel("MCP connection")).toHaveValue("session-2");
});

test("gateway pages: disconnected selection can switch to a live connection", async ({
  page,
}) => {
  await mount(page);
  await navigate(page, "Connections & Security");
  await expect(page.getByLabel("MCP connection")).toHaveValue("session-1");
  await page.screenshot({
    path: "test-results/synthetic-two-mcp-sessions.png",
  });
  await page.evaluate(() => {
    (window as unknown as { disconnected: boolean }).disconnected = true;
  });
  await page.getByRole("button", { name: "Refresh gateway" }).click();
  const selector = page.getByLabel("MCP connection");
  await expect(selector).toHaveValue("session-1");
  await expect(selector.locator("option:checked")).toContainText(
    "Disconnected",
  );
  await expect(page.getByRole("button", { name: "Edit access" })).toHaveCount(
    0,
  );
  await selector.selectOption("session-2");
  await expect(page.getByLabel("MCP connection")).toHaveValue("session-2");
  await expect(page.getByRole("button", { name: "Edit access" })).toBeVisible();
});
