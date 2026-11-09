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
      decoding="async"
      draggable={false}
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
export function AccountPanel({
  compact = false,
  onActionStart,
}: {
  compact?: boolean;
  onActionStart?: () => void;
}) {
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
  const run = (action: () => Promise<void>) => {
    onActionStart?.();
    void action();
  };
  if (compact) {
    const status =
      state === "loading"
        ? "Checking account…"
        : state === "waiting"
          ? "Complete sign-in in your browser."
          : state === "expired"
            ? "Session ended. Sign in again."
            : "";
    return (
      <div className="account-panel account-panel-compact" aria-busy={busy}>
        {verified && (
          <div className="account-summary">
            <AccountAvatar size={32} />
            <strong className="account-username">
              {account.profile!.username}
            </strong>
          </div>
        )}
        <div className="account-compact-status" role="status">
          {status}
        </div>
        {state === "unavailable" && (
          <p className="account-error" role="alert">
            Couldn’t verify your account. A saved session may remain.
          </p>
        )}
        {!enabled && <p>Open native Orven to sign in.</p>}
        <div className="account-actions">
          {(state === "signed_out" || state === "expired") && !uncertain && (
            <Button disabled={!enabled || busy} onClick={() => run(begin)}>
              {state === "expired" ? "Sign in again" : "Sign in with GitHub"}
            </Button>
          )}
          {verified && !account.avatar_data_url && (
            <Button disabled={busy} onClick={() => run(restore)}>
              Reload photo
            </Button>
          )}
          {verified && (
            <Button disabled={busy} onClick={() => run(logout)}>
              Sign out
            </Button>
          )}
          {state === "unavailable" && (
            <>
              <Button
                disabled={!enabled || busy}
                aria-label="Retry account verification"
                onClick={() => run(restore)}
              >
                Retry
              </Button>
              <Button disabled={busy} onClick={() => run(logout)}>
                Sign out
              </Button>
            </>
          )}
          {state === "waiting" && (
            <Button disabled={busy} onClick={() => run(cancel)}>
              Cancel sign-in
            </Button>
          )}
        </div>
      </div>
    );
  }
  const content = (
    <section
      className={`account-panel account-panel-${state}`}
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
  return (
    <Panel className="account-section" title="GitHub account">
      {content}
    </Panel>
  );
}
