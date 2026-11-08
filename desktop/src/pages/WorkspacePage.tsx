import { FileSearch, Play, ArrowRight } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  Table,
  shortId,
} from "../components";
import type { PageProps } from "../types";
export function WorkspacePage({
  project,
  report,
  busy,
  running,
  onEvidence,
  onRun,
}: PageProps & { running: boolean }) {
  const stages = [
    {
      name: "Repository registration",
      detail: project ? "Registered root" : "Choose a repository",
      done: !!project,
    },
    {
      name: "Snapshot inspection",
      detail: running
        ? "Reading committed Git objects"
        : report
          ? shortId(report.commit)
          : "Awaiting audit",
      done: !!report,
    },
    {
      name: "Evidence validation",
      detail: report
        ? `${report.evidence.length} captured records`
        : "Awaiting report",
      done: !!report,
    },
    {
      name: "Local report",
      detail: report ? "Finalized on local disk" : "No completed report",
      done: !!report,
    },
  ];
  return (
    <div className="workspace-page">
      <div className="target-strip">
        <span>
          Target: <code>{project?.name ?? "Not selected"}</code>
        </span>
        <span>
          Mode: <b>Committed snapshot</b>
        </span>
        <Badge tone={running ? "info" : "neutral"}>
          {running ? "Audit running" : "Local core"}
        </Badge>
      </div>
      <div className="workspace-intro">
        <h1>Snapshot Audit Workspace</h1>
        <p>
          Inspect committed text and preserve a traceable evidence ledger. No
          repository commands are executed.
        </p>
        <div className="stage-grid">
          {stages.map((stage, i) => (
            <div
              className={`stage ${stage.done ? "stage-done" : ""}`}
              key={stage.name}
            >
              <div className="eyebrow">
                STAGE {String(i + 1).padStart(2, "0")}{" "}
                <span>
                  {running && i === 1
                    ? "Running"
                    : stage.done
                      ? "Ready"
                      : "Pending"}
                </span>
              </div>
              <h3>{stage.name}</h3>
              <p>{stage.detail}</p>
            </div>
          ))}
        </div>
        <p className="caption muted">
          Lifecycle summary · the core does not emit a live AST or percentage
          stream.
        </p>
      </div>
      <Panel
        title={
          <span className="inline">
            <FileSearch size={15} /> Evidence collection ledger
          </span>
        }
        actions={
          <Badge>
            {report ? `${report.evidence.length} captured` : "Awaiting report"}
          </Badge>
        }
      >
        {!report ? (
          <EmptyState
            title={
              running
                ? "Audit in progress"
                : busy
                  ? "Another workspace is auditing"
                  : "Ready for a local audit"
            }
            action={
              !busy && (
                <Button primary icon={Play} disabled={!project} onClick={onRun}>
                  Run audit
                </Button>
              )
            }
          >
            {running
              ? "The selected commit is being inspected. A report appears only after validation and finalization."
              : "Choose a registered repository and provide a full commit ID."}
          </EmptyState>
        ) : (
          <Table
            caption="Captured evidence"
            headers={[
              "Evidence",
              "Committed path",
              "Bytes",
              "Capture",
              "Action",
            ]}
          >
            {report.evidence.map((e) => (
              <tr key={e.id}>
                <td className="mono">{e.id}</td>
                <td className="mono path-cell">{e.path}</td>
                <td className="mono">{e.byte_end - e.byte_start}</td>
                <td>
                  <Badge tone="success">Captured</Badge>
                </td>
                <td>
                  <Button icon={ArrowRight} onClick={() => onEvidence(e.id)}>
                    Inspect
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <div className="workspace-note">
        Model analysis unavailable · build and test results unverified · all
        evidence is local
      </div>
    </div>
  );
}
