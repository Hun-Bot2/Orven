import { useEffect, useId, useRef, useState } from "react";
import { AccountAvatar, AccountPanel, accountLabels } from "./AccountPanel";
import { useAccount } from "./AccountContext";

export function AccountControl() {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const visibleLabel =
    account.state === "signed_out"
      ? "Sign in"
      : account.state === "expired"
        ? "Sign in again"
        : account.state === "waiting"
          ? "Signing in…"
          : account.state === "loading"
            ? "Checking…"
            : "Account unavailable";
  const label = account.verified
    ? `Open GitHub account: ${account.account.profile!.username}`
    : `${visibleLabel} — GitHub account (${accountLabels[account.state]})`;
  return (
    <div
      className="account-control"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        className={`account-trigger account-trigger-${account.state}`}
        type="button"
        ref={trigger}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        title={
          account.verified
            ? account.account.profile!.username
            : account.state === "signed_out"
              ? "Sign in with GitHub"
              : accountLabels[account.state]
        }
        onClick={() => setOpen((value) => !value)}
      >
        {account.verified ? (
          <AccountAvatar size={28} />
        ) : account.state === "signed_out" ? (
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 .7a11.3 11.3 0 0 0-3.57 22.02c.56.1.77-.24.77-.54v-2.1c-3.15.68-3.82-1.33-3.82-1.33-.52-1.31-1.26-1.66-1.26-1.66-1.03-.7.08-.69.08-.69 1.14.08 1.73 1.17 1.73 1.17 1.01 1.73 2.64 1.23 3.28.94.1-.73.4-1.23.72-1.52-2.52-.29-5.17-1.26-5.17-5.59 0-1.23.44-2.24 1.16-3.03-.12-.29-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.16a10.8 10.8 0 0 1 5.64 0c2.16-1.46 3.1-1.16 3.1-1.16.62 1.55.24 2.69.12 2.98.72.79 1.16 1.8 1.16 3.03 0 4.34-2.65 5.3-5.18 5.58.41.35.77 1.04.77 2.09v3.1c0 .3.2.65.78.54A11.3 11.3 0 0 0 12 .7Z" />
          </svg>
        ) : (
          visibleLabel
        )}
      </button>
      {open && (
        <div
          className="account-popover"
          role="dialog"
          aria-label="GitHub account options"
          id={id}
          ref={panel}
          tabIndex={-1}
        >
          <div className="account-popover-heading">
            <span>GitHub account</span>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              Close
            </button>
          </div>
          <AccountPanel compact />
        </div>
      )}
    </div>
  );
}
