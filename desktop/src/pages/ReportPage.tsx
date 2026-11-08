import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Shield,
  Hash,
  BookOpen,
} from "lucide-react";
import {
  Badge,
  Button,
  Distribution,
  EmptyState,
  Metric,
  PageHeading,
  shortId,
  timestamp,
} from "../components";
import type { PageProps } from "../types";
export function ReportPage({ project, report, onEvidence }: PageProps) {
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(0);
  const [query, setQuery] = useState("");
  if (!report)
    return (
      <>
        <PageHeading
          eyebrow="EVIDENCE-LINKED REPORT"
          title="Reports & Findings"
        >
          A durable record of what was inspected, what was excluded, and what
          remains unknown.
        </PageHeading>
        <EmptyState
          title={project ? "No report selected" : "Choose a workspace"}
        >
          Run a local audit or select a saved run from History. Findings appear
          only when backed by captured evidence.
        </EmptyState>
      </>
    );
  const observations = report.findings
    .map((f, index) => ({ f, index }))
    .filter(
      ({ f }) =>
        (filter === "all" || f.classification === filter) &&
        f.title.toLowerCase().includes(query.toLowerCase()),
    );
  return (
    <div className="report-page">
      <PageHeading
        eyebrow={`RUN ${shortId(report.run_id)} · ${project?.name ?? "WORKSPACE"} · ${shortId(report.commit)}`}
        title="Committed Snapshot Engineering Report"
        actions={<Badge tone="success">Local snapshot</Badge>}
      >
        Evidence-linked inventory of committed text in{" "}
        <strong>{project?.name}</strong>. Captured{" "}
        {timestamp(report.captured_unix_seconds)}. Runtime behavior, test
        outcomes, and security compliance remain unverified.
      </PageHeading>
      <div className="report-metrics">
        <Metric
          label="EVIDENCE LEDGER"
          value={`${report.evidence.length} captured`}
        >
          <Distribution
            label="Captured evidence records with validated content hashes"
            items={[
              {
                label: "Hash-linked",
                count: report.evidence.length,
                tone: "success",
              },
            ]}
          />
          <span>{report.exclusions.length} excluded scope/path records</span>
        </Metric>
        <Metric label="CLAIM CLASSIFICATION" value="Observed">
          <Distribution
            label="Claim classification"
            items={[
              {
                label: "Observed",
                count: report.findings.length,
                tone: "info",
              },
            ]}
          />
        </Metric>
        <Metric
          label="SNAPSHOT IDENTITY"
          value={<span className="mono">{shortId(report.commit)}</span>}
        >
          Fixed commit · worktree excluded
          <br />
          Freshness beyond this snapshot is unknown
        </Metric>
        <Metric
          label="EXECUTION BOUNDARY"
          value={
            <span className="inline">
              <Shield size={15} /> Not executed
            </span>
          }
        >
          Hooks, builds, tests & scripts skipped
          <br />
          Model analysis unavailable
        </Metric>
      </div>
      <div className="filter-toolbar">
        <div className="segmented" aria-label="Finding classification">
          {[
            ["all", "All"],
            ["observed", "Observations"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label} <span className="muted">{report.findings.length}</span>
            </button>
          ))}
        </div>
        <label className="search-field">
          <span className="sr-only">Filter findings</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter observations…"
          />
        </label>
        <span className="caption muted">
          Inventory is not a security verdict
        </span>
      </div>
      <div className="findings">
        {observations.map(({ f, index }) => {
          const evidence = report.evidence.find(
            (e) => e.id === f.evidence_ids[0],
          );
          const open = expanded === index;
          return (
            <article
              className={`finding ${open ? "expanded" : ""}`}
              key={`${report.run_id}-${index}`}
            >
              <button
                className="finding-toggle"
                aria-expanded={open}
                onClick={() => setExpanded(open ? -1 : index)}
              >
                {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <Badge tone="info">Observation</Badge>
                <span className="finding-title">
                  {evidence?.path ?? f.title}
                </span>
                <span className="mono muted finding-source">
                  {f.evidence_ids.join(", ")}
                </span>
              </button>
              {open && (
                <div className="finding-body">
                  <div className="finding-metadata">
                    <span className="eyebrow">
                      OBSERVATION {String(index + 1).padStart(2, "0")}
                    </span>
                    <Badge>
                      {f.severity === "info" ? "Informational" : f.severity}
                    </Badge>
                    <span className="mono muted">{shortId(report.commit)}</span>
                  </div>
                  <h2>{f.title}</h2>
                  <p className="editorial">{f.rationale}</p>
                  <p className="editorial muted">{f.limitations}</p>
                  {evidence && (
                    <>
                      <div className="code-heading">
                        <span className="inline">
                          <FileText size={13} />
                          {evidence.path}
                        </span>
                        <span>
                          Bytes {evidence.byte_start}–{evidence.byte_end}
                        </span>
                      </div>
                      <pre className="code-preview">
                        {evidence.content
                          .split("\n")
                          .slice(0, 8)
                          .map((line, i) => (
                            <div className="code-line" key={i}>
                              <span className="line-number">{i + 1}</span>
                              <code>{line || " "}</code>
                            </div>
                          ))}
                      </pre>
                      <div className="finding-actions">
                        <Button
                          icon={BookOpen}
                          onClick={() => onEvidence(evidence.id)}
                        >
                          Inspect evidence
                        </Button>
                        <span className="mono caption muted inline">
                          <Hash size={12} />
                          {shortId(evidence.sha256)} · SHA-256
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </article>
          );
        })}
        {!observations.length && (
          <EmptyState title="No observations in this filter">
            Coverage remains limited to the captured scope.
          </EmptyState>
        )}
      </div>
      <div className="note-strip">
        <Shield size={15} />
        <span>
          {report.policy} · {report.evidence.length} evidence records retained.
        </span>
        <span className="muted">
          Original bytes and snapshot identity are preserved.
        </span>
      </div>
    </div>
  );
}
