import { LockKeyhole, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Badge, Metric, PageHeading, Panel } from "../components";
import type { PageProps } from "../types";
import "./pages.css";

export function SecurityPage(_props: PageProps) {
  return (
    <div className="security-page">
      <PageHeading
        eyebrow="LOCAL POLICY · SECURITY BOUNDARIES"
        title="Connections & Security Boundaries"
      >
        Review the current audit scope and the boundaries that still require
        verification.
      </PageHeading>
      <div className="security-metrics">
        <Metric label="SNAPSHOT INPUT" value="Committed Git">
          Loose objects only
        </Metric>
        <Metric label="REPOSITORY ACCESS" value="Read-only audit">
          No target commands are invoked
        </Metric>
        <Metric label="PROVIDER ACCESS" value="Unavailable">
          No provider connection in Phase 2A
        </Metric>
        <Metric label="OS ISOLATION" value="Unverified">
          Not an OS memory sandbox
        </Metric>
      </div>
      <div className="security-content">
        <Panel
          title={
            <>
              <LockKeyhole size={15} aria-hidden="true" /> Assistant connections
            </>
          }
          actions={<Badge>Phase 2B</Badge>}
        >
          <div className="security-connections">
            {["ChatGPT", "Claude"].map((name) => (
              <section key={name} className="security-connection">
                <header>
                  <strong>{name}</strong>
                  <Badge>Not configured</Badge>
                </header>
                <p>
                  Unavailable in Phase 2A. Report publication and host
                  interoperability require a later authorized setup.
                </p>
              </section>
            ))}
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
                  Audit reads committed Git objects; dirty and untracked files
                  are excluded.
                </li>
                <li>
                  Reports and evidence are stored outside the audited repository
                  in an owner-only store.
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
                  Secret-path exclusions, symlinks, submodules and LFS content
                  are not inspected.
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
              sandbox. A compromised owner account and concurrent replacement of
              repository metadata remain outside the current guarantees.
            </p>
            <p>
              Live MCP connections, publication access and security-event
              history are unavailable in Phase 2A.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
