import { useState } from "react";
import { Button, Badge, Panel } from "./components";
import { useAccount } from "./AccountContext";
import "./account.css";

export const accountLabels = {
  loading: "Checking account…",
  unavailable: "Verification unavailable",
  signed_out: "Signed out",
  waiting: "Waiting for GitHub",
  authenticated: "Verified",
  expired: "Session ended",
} as const;
export function AccountAvatar({ size = 40 }: { size?: number }) {
  const { account, verified } = useAccount();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = verified ? account.avatar_data_url : null;
  return src?.startsWith("data:image/") && src !== failedSrc ? (
    <img
      className="account-avatar"
      src={src}
      alt={`${account.profile?.username}'s GitHub avatar`}
      width={size}
      height={size}
      onError={() => setFailedSrc(src)}
    />
  ) : (
    <span
      className="account-avatar account-avatar-fallback"
      role="img"
      aria-label="Avatar unavailable"
      style={{ width: size, height: size }}
    >
      {verified ? account.profile!.username.slice(0, 2).toUpperCase() : "GH"}
    </span>
  );
}
export function AccountPanel({ compact = false }: { compact?: boolean }) {
  const {
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
  } = useAccount();
  const content = (
    <section
      className={`account-panel ${compact ? "account-panel-compact" : ""}`}
      aria-label="GitHub account"
      aria-busy={busy}
    >
      <div className="account-summary">
        {verified && <AccountAvatar />}
        <div className="account-summary-copy">
          {verified && <strong>{account.profile!.username}</strong>}
          <div role="status" className="account-status">
            <Badge
              tone={
                verified
                  ? "success"
                  : state === "unavailable" || state === "expired"
                    ? "warning"
                    : state === "waiting"
                      ? "info"
                      : "neutral"
              }
            >
              {accountLabels[state]}
            </Badge>
            {verified && (
              <span className="caption muted">
                GitHub identity verified by Orven
              </span>
            )}
          </div>
        </div>
      </div>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {!enabled && <p>Open native Orven to sign in with GitHub.</p>}
      {state === "expired" && (
        <p>
          Your session expired or was revoked. Sign in again to verify your
          account.
        </p>
      )}
      {state === "waiting" && (
        <p>
          Complete GitHub sign-in in your browser, confirm your account, then
          return to Orven.
        </p>
      )}
      <div className="account-actions">
        {(state === "signed_out" || state === "expired") && !uncertain && (
          <Button disabled={!enabled || busy} onClick={() => void begin()}>
            {state === "expired" ? "Sign in again" : "Sign in with GitHub"}
          </Button>
        )}
        {(account.status === "authenticated" || uncertain) && (
          <Button disabled={busy} onClick={() => void logout()}>
            Sign out
          </Button>
        )}
        {account.status === "waiting" && (
          <Button disabled={busy} onClick={() => void cancel()}>
            Cancel sign-in
          </Button>
        )}
        {account.status !== "waiting" &&
          state !== "signed_out" &&
          state !== "expired" && (
            <Button disabled={!enabled || busy} onClick={() => void restore()}>
              Retry account verification
            </Button>
          )}
      </div>
      {!compact && (
        <p className="caption muted">
          Account sign-in does not grant access to repositories or assistants.
        </p>
      )}
    </section>
  );
  return compact ? (
    content
  ) : (
    <Panel className="account-section" title="GitHub account">
      {content}
    </Panel>
  );
}
