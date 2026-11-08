import { Clock3, History, Play } from "lucide-react";
import {
  Badge,
  Button,
  Distribution,
  EmptyState,
  Metric,
  OpenReport,
  PageHeading,
  Panel,
  Table,
  shortId,
  timestamp,
} from "../components";
import type { PageProps } from "../types";
import "./pages.css";

export function HistoryPage({
  project,
  historyState,
  runs,
  report,
  busy,
  onSelectRun,
  onRun,
}: PageProps) {
  const ordered = [...runs].sort(
    (a, b) =>
      b.captured_unix_seconds - a.captured_unix_seconds ||
      a.run_id.localeCompare(b.run_id),
  );
  const recent = ordered.slice(0, 5).reverse();
  const evidenceScale = Math.max(0, ...recent.map((run) => run.evidence_count));
  return (
    <div className="history-page">
      <PageHeading
        eyebrow="SNAPSHOT LEDGER"
        title="Audit History & Snapshots"
        actions={
          <Button
            icon={Play}
            primary
            disabled={!project || busy}
            onClick={onRun}
          >
            Run audit
          </Button>
        }
      >
        Review saved committed snapshots and open their evidence-linked reports.
      </PageHeading>
      {!project ? (
        <EmptyState title="Select a workspace">
          Choose a registered workspace to view its audit history.
        </EmptyState>
      ) : historyState !== "ready" ? (
        <EmptyState
          title={
            historyState === "loading"
              ? "Loading saved audit records"
              : "Saved audit records unavailable"
          }
        >
          No audit count or safety outcome can be inferred until the saved
          records are available.
        </EmptyState>
      ) : ordered.length === 0 ? (
        <EmptyState
          title="No saved audits yet"
          action={
            <Button icon={Play} primary disabled={busy} onClick={onRun}>
              Run audit
            </Button>
          }
        >
          Completed audits for {project.name} will appear here.
        </EmptyState>
      ) : (
        <>
          <Panel
            title={
              <>
                <History size={15} aria-hidden="true" /> Recent snapshots
              </>
            }
            actions={
              <span className="history-caption">Up to 5 saved runs</span>
            }
          >
            <div className="history-progress">
              <div className="history-snapshots">
                {recent.map((run) => (
                  <button
                    type="button"
                    key={run.run_id}
                    className={`history-snapshot ${report?.run_id === run.run_id ? "is-selected" : ""}`}
                    onClick={() => onSelectRun(run.run_id)}
                    aria-pressed={report?.run_id === run.run_id}
                  >
                    <span className="history-snapshot-head">
                      <strong>{shortId(run.commit)}</strong>
                      <span>{run.status}</span>
                    </span>
                    <Distribution
                      label={`Snapshot ${shortId(run.commit)} captured evidence; relative to largest shown count ${evidenceScale}`}
                      scale={evidenceScale}
                      items={[
                        {
                          label: "Evidence",
                          count: run.evidence_count,
                          tone: "info",
                        },
                      ]}
                    />
                    <span className="history-date">
                      {run.exclusion_count} excluded scope/path records
                    </span>
                    <span className="history-date">
                      {timestamp(run.captured_unix_seconds)}
                    </span>
                  </button>
                ))}
              </div>
              <div className="history-summary">
                <Metric label="SAVED RUNS" value={ordered.length}>
                  For {project.name}
                </Metric>
                <Metric
                  label="LATEST SNAPSHOT"
                  value={shortId(ordered[0].commit)}
                >
                  {timestamp(ordered[0].captured_unix_seconds)}
                </Metric>
                <p>
                  Counts describe captured evidence and exclusions, not security
                  outcomes.
                </p>
              </div>
            </div>
          </Panel>
          <Panel
            title={
              <>
                <Clock3 size={15} aria-hidden="true" /> Recorded audit runs
              </>
            }
            actions={
              <span className="history-caption">{ordered.length} saved</span>
            }
          >
            <Table
              caption="Saved audit runs"
              headers={[
                "Snapshot / commit",
                "Captured",
                "Evidence",
                "Excluded records",
                "Observations",
                "Status",
                "Action",
              ]}
            >
              {ordered.map((run) => (
                <tr
                  key={run.run_id}
                  className={
                    report?.run_id === run.run_id ? "history-selected-row" : ""
                  }
                >
                  <td>
                    <span className="history-mono">{shortId(run.commit)}</span>
                    {report?.run_id === run.run_id && (
                      <>
                        {" "}
                        <Badge>Selected</Badge>
                      </>
                    )}
                  </td>
                  <td>{timestamp(run.captured_unix_seconds)}</td>
                  <td>{run.evidence_count}</td>
                  <td>{run.exclusion_count}</td>
                  <td>{run.finding_count}</td>
                  <td>
                    <Badge>{run.status}</Badge>
                  </td>
                  <td>
                    <OpenReport onClick={() => onSelectRun(run.run_id)} />
                  </td>
                </tr>
              ))}
            </Table>
          </Panel>
          <Panel title="Snapshot comparison">
            <div className="history-comparison">
              <p>
                Open individual saved reports to review captured paths and
                content identities.
              </p>
              <Badge>Comparison unavailable</Badge>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
