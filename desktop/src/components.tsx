import {
  useEffect,
  useRef,
  useId,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { X, FileText, ArrowRight, type LucideIcon } from "lucide-react";
export type Tone = "neutral" | "success" | "warning" | "danger" | "info";
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Button({
  children,
  icon: Icon,
  primary = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className={`button ${primary ? "button-primary" : ""}`}
      {...props}
    >
      {Icon && <Icon size={14} aria-hidden="true" />}
      {children}
    </button>
  );
}
export function PageHeading({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div className="eyebrow">{eyebrow}</div>
      <div className="heading-row">
        <h1>{title}</h1>
        {actions && <div className="actions">{actions}</div>}
      </div>
      {children && <div className="editorial page-description">{children}</div>}
    </header>
  );
}
export function Panel({
  title,
  actions,
  children,
  className = "",
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-header">
        <h2>{title}</h2>
        {actions && <div className="actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <FileText size={26} strokeWidth={1.25} aria-hidden="true" />
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Metric({
  label,
  value,
  children,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="metric">
      <div className="eyebrow">{label}</div>
      <strong className="metric-value">{value}</strong>
      <div className="caption muted">{children}</div>
    </div>
  );
}
export function Distribution({
  items,
  label,
  scale,
}: {
  items: { label: string; count: number; tone: Tone }[];
  label: string;
  scale?: number;
}) {
  const total = scale ?? items.reduce((s, i) => s + i.count, 0);
  return (
    <div
      className="distribution"
      role="img"
      aria-label={`${label}: ${items.map((i) => `${i.count} ${i.label}`).join(", ")}`}
    >
      <div className="bar">
        {items.map((i) => (
          <span
            key={i.label}
            className={`bar-${i.tone}`}
            style={{ width: total ? `${(i.count / total) * 100}%` : "0" }}
          />
        ))}
      </div>
      <div className="bar-legend">
        {items.map((i) => (
          <span key={i.label}>
            {i.label} <b>{i.count}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
export function Table({
  headers,
  children,
  caption,
}: {
  headers: string[];
  children: ReactNode;
  caption: string;
}) {
  return (
    <div className="table-scroll">
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {headers.map((h) => (
              <th scope="col" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    const old = document.activeElement as HTMLElement | null;
    node?.showModal();
    return () => {
      node?.close();
      old?.focus();
    };
  }, []);
  return (
    <dialog
      aria-labelledby={titleId}
      className={`dialog ${wide ? "dialog-wide" : ""}`}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
export function OpenReport({ onClick }: { onClick: () => void }) {
  return (
    <Button icon={ArrowRight} onClick={onClick}>
      View report
    </Button>
  );
}
export function shortId(id: string) {
  return id.slice(0, 8);
}
export function timestamp(seconds: number) {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    timeZoneName: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(seconds * 1000));
}
