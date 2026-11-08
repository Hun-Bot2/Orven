import { useState } from "react";
import { Copy, X, FileText } from "lucide-react";
import { Badge, Button, shortId } from "./components";
import type { Evidence, Report } from "./types";
export function EvidenceViewer({
  evidence,
  report,
  onClose,
}: {
  evidence: Evidence;
  report: Report;
  onClose: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const lines = evidence.content.split("\n");
  const shown = lines.slice(0, 1000);
  return (
    <aside className="evidence-sheet" aria-label="Evidence inspector">
      <header>
        <span className="inline">
          <FileText size={14} /> EVIDENCE INSPECTOR
        </span>
        <button
          className="icon-button"
          aria-label="Close evidence"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      <div className="evidence-sheet-body">
        <div className="eyebrow">CAPTURED SOURCE · {evidence.id}</div>
        <h2>{evidence.path}</h2>
        <div className="inline">
          <Badge tone="success">Captured</Badge>
          <span className="mono caption">{shortId(report.commit)}</span>
        </div>
        <div className="evidence-facts">
          <dl>
            <dt>Snapshot</dt>
            <dd>{report.commit}</dd>
            <dt>SHA-256</dt>
            <dd>{evidence.sha256}</dd>
            <dt>Git blob</dt>
            <dd>{evidence.blob_id}</dd>
            <dt>Byte range</dt>
            <dd>
              {evidence.byte_start}–{evidence.byte_end}
            </dd>
          </dl>
        </div>
        <div className="code-heading">Original captured bytes · plain text</div>
        <pre className="code-preview evidence-code">
          {shown.map((line, i) => (
            <div className="code-line" key={i}>
              <span className="line-number">{i + 1}</span>
              <code>{line || " "}</code>
            </div>
          ))}
        </pre>
        {lines.length > 1000 && (
          <p className="caption">
            Preview limited to 1,000 lines; the full captured content remains
            stored.
          </p>
        )}
        <p className="caption muted">
          This is committed content, not the current working copy. It is
          rendered as text and never executed.
        </p>
      </div>
      <footer>
        <Button
          icon={Copy}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(evidence.sha256);
              setCopyStatus("copied");
            } catch {
              setCopyStatus("failed");
            }
          }}
        >
          {copyStatus === "copied"
            ? "Hash copied"
            : copyStatus === "failed"
              ? "Copy unavailable — select hash above"
              : "Copy evidence hash"}
        </Button>
      </footer>
    </aside>
  );
}
