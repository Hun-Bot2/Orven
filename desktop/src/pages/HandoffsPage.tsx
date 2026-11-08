import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  OpenReport,
  PageHeading,
  Panel,
  timestamp,
} from "../components";
import type { PageProps } from "../types";
import type { GatewayProps, TaskBrief } from "../gateway-types";
import "./gateway.css";
function json(value: unknown) {
  return JSON.stringify(value, null, 2) ?? "Unavailable";
}
export function HandoffsPage({
  project,
  gateway,
  gatewayError,
  onRefreshGateway,
  onDecision,
  onRelatedReport,
}: PageProps & GatewayProps) {
  const [decision, setDecision] = useState<{
    brief: TaskBrief;
    approve: boolean;
  } | null>(null);
  useEffect(() => {
    setDecision(null);
  }, [project?.id, gateway?.session_id, gateway?.running]);
  const briefs =
    gateway?.briefs.filter((b) => b.workspace_id === project?.id) ?? [];
  return (
    <div className="handoffs-page gateway-page">
      <PageHeading
        eyebrow="LOCAL CONSENT · TASK BRIEFS"
        title="Context Handoffs"
        actions={
          <Button icon={RefreshCw} onClick={onRefreshGateway}>
            Refresh gateway
          </Button>
        }
      >
        Review validated requests and the exact structured data proposed for a
        host response.
      </PageHeading>
      {gatewayError && <p role="alert">{gatewayError}</p>}
      {!project ? (
        <EmptyState title="Select a workspace">
          Choose a workspace to review its requests.
        </EmptyState>
      ) : !gateway ? (
        <EmptyState title="Gateway unavailable">
          No request state is available. Refresh after starting the local
          gateway.
        </EmptyState>
      ) : briefs.length === 0 ? (
        <EmptyState title="No task briefs">
          No retained requests for {project.name} are available in this session.
        </EmptyState>
      ) : (
        <div className="gateway-briefs">
          {briefs.map((brief) => (
            <Panel
              key={brief.id}
              title={brief.objective}
              actions={<Badge>{brief.status}</Badge>}
            >
              <div className="gateway-body">
                <div className="gateway-meta">
                  <span>
                    Request <code>{brief.id}</code>
                  </span>
                  <span>{timestamp(brief.created)}</span>
                  <span>
                    Tool: <code>{brief.tool}</code>
                  </span>
                  <span>Consent: {brief.consent}</span>
                  <span>
                    Execution:{" "}
                    <code>{brief.execution_id ?? "Not started"}</code>
                  </span>
                </div>
                <p>
                  <strong>Session:</strong> {brief.source_identity} ·{" "}
                  <strong>Client-reported name (untrusted):</strong>{" "}
                  {brief.source_client || "Not supplied"}
                </p>
                <p>
                  Validated arguments SHA-256:{" "}
                  <code className="gateway-digest">
                    {brief.validated_arguments_sha256}
                  </code>
                </p>
                <p>Supplied context (length and digest):</p>
                <pre>{json(brief.supplied_context)}</pre>
                <p>Received payload (redacted):</p>
                <pre>{json(brief.received_payload_redacted)}</pre>
                <p>
                  Outbound structured result preview{" "}
                  {brief.outbound_sha256
                    ? `(SHA-256 ${brief.outbound_sha256})`
                    : "(not available)"}
                  :
                </p>
                <pre>
                  {brief.outbound_preview === null
                    ? "Unavailable"
                    : json(brief.outbound_preview)}
                </pre>
                {brief.trace.length > 0 && (
                  <>
                    <h3>Trace</h3>
                    <ol>
                      {brief.trace.map((event, i) => (
                        <li key={`${i}-${event}`}>{event}</li>
                      ))}
                    </ol>
                  </>
                )}
                <div className="gateway-actions">
                  {brief.consent === "pending" &&
                    brief.status === "awaiting_consent" && (
                      <>
                        <Button
                          primary
                          onClick={() => setDecision({ brief, approve: true })}
                        >
                          Review approval
                        </Button>
                        <Button
                          onClick={() => setDecision({ brief, approve: false })}
                        >
                          Review denial
                        </Button>
                      </>
                    )}
                  {brief.report_id && brief.workspace_id && (
                    <OpenReport
                      onClick={() =>
                        onRelatedReport(brief.workspace_id!, brief.report_id!)
                      }
                    />
                  )}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
      {decision &&
        gateway?.briefs.some(
          (b) =>
            b.id === decision.brief.id &&
            b.consent === "pending" &&
            b.status === "awaiting_consent" &&
            b.workspace_id === project?.id &&
            JSON.stringify(b) === JSON.stringify(decision.brief),
        ) && (
          <Dialog
            title={
              decision.approve
                ? "Confirm request approval"
                : "Confirm request denial"
            }
            wide
            onClose={() => setDecision(null)}
          >
            <p>
              <strong>Workspace:</strong> {project?.name} ·{" "}
              <strong>Request:</strong> {decision.brief.id}
            </p>
            <p>
              <strong>Tool:</strong> {decision.brief.tool} ·{" "}
              <strong>Objective:</strong> {decision.brief.objective}
            </p>
            <p>
              Validated received payload (redacted; includes requested commit
              when supplied):
            </p>
            <pre className="gateway-preview">
              {json(decision.brief.received_payload_redacted)}
            </pre>
            <p>Exact outbound structured result preview:</p>
            <pre className="gateway-preview">
              {decision.brief.outbound_preview === null
                ? "Unavailable; no report result is ready for transmission."
                : json(decision.brief.outbound_preview)}
            </pre>
            <p>
              Destination: the displayed stdio session and its host. Delivery to
              a model is not acknowledged by Orven. Approval applies only to
              this request. Information returned to the host may be shared with
              its provider.
            </p>
            <div className="dialog-actions">
              <Button onClick={() => setDecision(null)}>Cancel</Button>
              <Button
                primary
                disabled={
                  decision.approve &&
                  decision.brief.tool === "get_audit_report" &&
                  decision.brief.outbound_preview === null
                }
                onClick={() => {
                  onDecision(decision.brief.id, decision.approve);
                  setDecision(null);
                }}
              >
                {decision.approve ? "Approve request" : "Deny request"}
              </Button>
            </div>
          </Dialog>
        )}
    </div>
  );
}
