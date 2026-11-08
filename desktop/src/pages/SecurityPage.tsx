import { useEffect, useState } from "react";
import {
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  Metric,
  PageHeading,
  Panel,
} from "../components";
import type { PageProps } from "../types";
import type { AccessScope, GatewayProps } from "../gateway-types";
import "./pages.css";
import "./gateway.css";
export function SecurityPage({
  project,
  gateway,
  gatewayError,
  onRefreshGateway,
  onSelectGatewaySession,
  onAccess,
  onRevoke,
}: PageProps & GatewayProps) {
  const [editing, setEditing] = useState(false);
  const [accessSession, setAccessSession] = useState("");
  const [scope, setScope] = useState<AccessScope>({
    discover: false,
    audit: false,
    reports: false,
  });
  useEffect(() => {
    setEditing(false);
  }, [project?.id, gateway?.session_id, gateway?.running]);
  const access = gateway?.access.find((a) => a.workspace_id === project?.id);
  const openAccess = () => {
    setAccessSession(gateway?.session_id ?? "");
    setScope({ discover: false, audit: false, reports: false });
    setEditing(true);
  };
  return (
    <div className="security-page gateway-page">
      <PageHeading
        eyebrow="LOCAL POLICY · SECURITY BOUNDARIES"
        title="Connections & Security Boundaries"
        actions={
          <Button icon={RefreshCw} onClick={onRefreshGateway}>
            Refresh gateway
          </Button>
        }
      >
        Review the live session, workspace permissions, and boundaries requiring
        verification.
      </PageHeading>
      <div className="security-metrics">
        <Metric label="SNAPSHOT INPUT" value="Committed Git">
          Loose objects only
        </Metric>
        <Metric label="REPOSITORY ACCESS" value="Read-only audit">
          No target commands are invoked
        </Metric>
        <Metric
          label="GATEWAY"
          value={
            gateway ? (gateway.running ? "Running" : "Stopped") : "Unavailable"
          }
        >
          Local session state
        </Metric>
        <Metric label="OS ISOLATION" value="Unverified">
          Not an OS memory sandbox
        </Metric>
      </div>
      <div className="security-content">
        <Panel
          title={
            <>
              <LockKeyhole size={15} aria-hidden="true" /> Local gateway session
            </>
          }
        >
          <div className="gateway-body">
            {gatewayError && <p role="alert">{gatewayError}</p>}
            {gateway ? (
              <>
                {gateway.sessions && gateway.sessions.length > 0 && (
                  <label className="gateway-connection">
                    MCP connection{" "}
                    <select
                      aria-label="MCP connection"
                      value={gateway.session_id}
                      onChange={(event) =>
                        onSelectGatewaySession(event.target.value)
                      }
                    >
                      {!gateway.sessions.some(
                        (session) => session.session_id === gateway.session_id,
                      ) && (
                        <option value={gateway.session_id}>
                          Disconnected · {gateway.session_id.slice(0, 8)}
                        </option>
                      )}
                      {gateway.sessions.map((session) => (
                        <option
                          key={session.session_id}
                          value={session.session_id}
                        >
                          {session.client || "Unknown client"} (untrusted) ·{" "}
                          {session.session_id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p>
                  <strong>Transport:</strong> {gateway.transport} ·{" "}
                  <strong>Session:</strong> <code>{gateway.session_id}</code>
                </p>
                <p>
                  <strong>Client-reported name (untrusted):</strong>{" "}
                  {gateway.client || "Not supplied"}. The session, not this
                  name, owns authority.
                </p>
              </>
            ) : (
              <p>Gateway unavailable. No live session state is available.</p>
            )}
            <p>
              Remote HTTP and provider connectivity are not established by this
              local session.
            </p>
          </div>
        </Panel>
        <Panel
          title="Workspace permissions"
          actions={
            project && gateway?.running ? (
              <div className="gateway-actions">
                <Button onClick={openAccess}>Edit access</Button>
                <Button disabled={!access} onClick={() => onRevoke(project.id)}>
                  Revoke access
                </Button>
              </div>
            ) : undefined
          }
        >
          <div className="gateway-body">
            {!project ? (
              <p>Select a workspace to review permissions.</p>
            ) : !gateway ? (
              <p>
                Permissions unavailable while the gateway cannot be reached.
              </p>
            ) : (
              <>
                <p>
                  <strong>{project.name}</strong> ·{" "}
                  {access
                    ? `${Object.values(access.scope).filter(Boolean).length} of 3 permissions allowed`
                    : "No active grant"}
                </p>
                <div className="gateway-badges">
                  <Badge>
                    Discovery: {access?.scope.discover ? "Allowed" : "Denied"}
                  </Badge>
                  <Badge>
                    Audit: {access?.scope.audit ? "Allowed" : "Denied"}
                  </Badge>
                  <Badge>
                    Reports: {access?.scope.reports ? "Allowed" : "Denied"}
                  </Badge>
                </div>
                <p>
                  Discovery permits transmitting the workspace name. Each audit
                  and report transmission requires separate local approval; a
                  grant alone does not approve a request.
                </p>
              </>
            )}
          </div>
        </Panel>
        <Panel
          title={
            <>
              <ShieldCheck size={15} aria-hidden="true" /> Implemented audit
              policy
            </>
          }
        >
          <div className="security-policy-grid">
            <section>
              <h3>Snapshot and storage</h3>
              <ul>
                <li>
                  Committed objects only; dirty and untracked files are
                  excluded.
                </li>
                <li>
                  Private reports are stored outside the audited repository.
                </li>
                <li>
                  External Git storage, alternates and packed objects are
                  rejected.
                </li>
              </ul>
            </section>
            <section>
              <h3>Inspection limits</h3>
              <ul>
                <li>Loose object expansion and traversal are bounded.</li>
                <li>
                  Secret paths, symlinks, submodules and LFS content are
                  excluded.
                </li>
                <li>
                  Repository hooks, scripts, builds and tests are not run.
                </li>
              </ul>
            </section>
          </div>
        </Panel>
        <Panel
          title={
            <>
              <ShieldQuestion size={15} aria-hidden="true" /> Boundaries
              requiring verification
            </>
          }
          actions={<Badge tone="warning">Unverified</Badge>}
        >
          <div className="security-notice">
            <p>
              These controls do not establish OS process isolation or a memory
              sandbox. A compromised owner account and concurrent metadata
              replacement remain outside current guarantees.
            </p>
            <p>
              Remote transport, actual host interoperability and security-event
              history remain unverified.
            </p>
          </div>
        </Panel>
      </div>
      {editing && project && accessSession === gateway?.session_id && (
        <Dialog
          title="Confirm workspace access"
          onClose={() => setEditing(false)}
        >
          <p>
            Choose permissions for <strong>{project.name}</strong>. Discovery
            transmits this workspace name to the host and potentially its
            provider. Audit and report operations require separate approval for
            each request.
          </p>
          <fieldset className="gateway-permissions">
            <legend>Session permissions (default denied)</legend>
            {(["discover", "audit", "reports"] as const).map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={scope[key]}
                  onChange={(e) =>
                    setScope({ ...scope, [key]: e.target.checked })
                  }
                />
                <span>
                  {key === "discover"
                    ? "Discover workspace and summary"
                    : key === "audit"
                      ? "Request audits"
                      : "Request report transmission"}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="dialog-actions">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button
              primary
              onClick={() => {
                onAccess(project.id, scope, accessSession);
                setEditing(false);
              }}
            >
              Confirm access
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
