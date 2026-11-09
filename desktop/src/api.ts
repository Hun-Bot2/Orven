import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Bootstrap, RunListing, Report } from "./types";
type TestBridge = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
declare global {
  interface Window {
    __ORVEN_TEST_BRIDGE__?: TestBridge;
  }
}
export const testMode =
  import.meta.env.DEV && typeof window.__ORVEN_TEST_BRIDGE__ === "function";
export const nativeAvailable = isTauri();
async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (testMode)
    return window.__ORVEN_TEST_BRIDGE__!(command, args) as Promise<T>;
  if (!nativeAvailable)
    throw new Error("Open the native Orven app to access local repositories.");
  return invoke<T>(command, args);
}
export const api = {
  accountSnapshot: () =>
    call<import("./account-types").AccountView>("account_snapshot"),
  accountBegin: () => call<void>("account_begin"),
  accountPoll: () =>
    call<import("./account-types").AccountView>("account_poll"),
  accountCancel: () => call<void>("account_cancel"),
  accountLogout: () =>
    call<import("./account-types").AccountView>("account_logout"),
  gatewaySnapshot: (sessionId?: string) =>
    call<{
      ok: boolean;
      code: string;
      snapshot: import("./gateway-types").GatewaySnapshot | null;
      sessions: import("./gateway-types").GatewaySession[];
    }>("gateway_snapshot", { sessionId }),
  gatewayControl: (request: unknown) =>
    call<{
      ok: boolean;
      code: string;
      snapshot: import("./gateway-types").GatewaySnapshot | null;
      sessions: import("./gateway-types").GatewaySession[];
    }>("gateway_control", { request }),
  bootstrap: () => call<Bootstrap>("bootstrap"),
  register: () => call<Bootstrap | null>("register_project"),
  select: (projectId: string) =>
    call<Bootstrap>("select_project", { projectId }),
  runs: (projectId: string) => call<RunListing>("list_runs", { projectId }),
  report: (projectId: string, runId: string) =>
    call<Report>("read_report", { projectId, runId }),
  audit: (projectId: string, commit: string) =>
    call<string>("run_audit", { projectId, commit }),
};
