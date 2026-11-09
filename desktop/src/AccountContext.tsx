import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, nativeAvailable, testMode } from "./api";
import type { AccountView } from "./account-types";

type AccountState = "loading" | "unavailable" | AccountView["status"];
interface AccountController {
  account: AccountView;
  busy: boolean;
  error: string;
  uncertain: boolean;
  enabled: boolean;
  verified: boolean;
  state: AccountState;
  restore: () => Promise<void>;
  begin: () => Promise<void>;
  logout: () => Promise<void>;
  cancel: () => Promise<void>;
}
const AccountContext = createContext<AccountController | null>(null);
export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error("AccountProvider is required");
  return value;
}
const signedOut: AccountView = {
  status: "signed_out",
  profile: null,
  avatar_data_url: null,
};
export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState(signedOut);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const enabled = nativeAvailable || testMode;
  async function restore() {
    const token = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await api.accountSnapshot();
      if (token === generation.current) {
        setAccount(result);
        setUncertain(false);
      }
    } catch {
      if (token === generation.current) {
        setUncertain(true);
        setError(
          "Account verification is unavailable. A saved credential may still exist; retry or sign out.",
        );
      }
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (enabled) void restore();
    else setBusy(false);
    return () => {
      ++generation.current;
    };
  }, [enabled]);
  useEffect(() => {
    if (account.status !== "waiting") return;
    let active = true;
    const timer = window.setInterval(async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      const token = generation.current;
      try {
        const result = await api.accountPoll();
        if (active && token === generation.current) setAccount(result);
      } catch {
        if (active && token === generation.current) {
          setAccount(signedOut);
          setUncertain(true);
          setError(
            "Sign-in could not be completed. Retry account verification or sign out before trying again.",
          );
        }
      } finally {
        inFlight.current = false;
      }
    }, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [account.status]);
  async function begin() {
    const token = ++generation.current;
    setBusy(true);
    setError("");
    try {
      await api.accountBegin();
      if (token === generation.current)
        setAccount({ ...signedOut, status: "waiting" });
    } catch {
      if (token === generation.current) {
        setUncertain(true);
        setError(
          "Cannot start GitHub sign-in. The authentication API may be unavailable or not deployed. Check the service and macOS Keychain, then retry.",
        );
      }
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  async function logout() {
    ++generation.current;
    setBusy(true);
    setError("");
    try {
      setAccount(await api.accountLogout());
      setUncertain(false);
    } catch {
      setUncertain(true);
      setError(
        "Sign out could not be confirmed. The saved credential is retained so revocation can be retried.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    ++generation.current;
    setBusy(true);
    try {
      await api.accountCancel();
      setAccount(signedOut);
    } catch {
      setAccount(signedOut);
      setUncertain(true);
      setError(
        "Cancellation could not be confirmed. Retry sign out to revoke any credential that arrived.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const onFocus = () => {
      if (enabled && !inFlight.current && account.status !== "waiting" && !busy)
        void restore();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled, account.status, busy]);
  const verified =
    !busy &&
    !uncertain &&
    account.status === "authenticated" &&
    account.profile !== null;
  const state: AccountState = busy
    ? "loading"
    : uncertain
      ? "unavailable"
      : account.status;
  const value = {
    account,
    busy,
    error,
    uncertain,
    enabled,
    verified,
    state,
    restore,
    begin,
    logout,
    cancel,
  };
  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}
