import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeftRight,
  BookOpen,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  History,
  LayoutGrid,
  LockKeyhole,
  Play,
  Plus,
  Search,
  Shield,
  SlidersHorizontal,
} from "lucide-react";
import { api, nativeAvailable, testMode } from "./api";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Metric,
  PageHeading,
  Panel,
  shortId,
  timestamp,
} from "./components";
import { EvidenceViewer } from "./EvidenceViewer";
import { ReportPage } from "./pages/ReportPage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { HistoryPage } from "./pages/HistoryPage";
import { HandoffsPage } from "./pages/HandoffsPage";
import type { GatewaySnapshot, AccessScope } from "./gateway-types";
import { SecurityPage } from "./pages/SecurityPage";
import type { Bootstrap, Report, RunListing, View } from "./types";
const navigation = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "workspace", label: "Audit Workspace", icon: Activity },
  { id: "reports", label: "Reports & Findings", icon: FileText },
  { id: "handoffs", label: "Context Handoffs", icon: ArrowLeftRight },
  { id: "evidence", label: "Evidence Explorer", icon: BookOpen },
  { id: "history", label: "History & Snapshots", icon: History },
  { id: "security", label: "Connections & Security", icon: Shield },
] as const;
const noRuns: RunListing = { runs: [], unavailable: 0, incomplete: 0 };
export default function App() {
  const [gateway, setGateway] = useState<GatewaySnapshot | null>(null);
  const [gatewayError, setGatewayError] = useState("");
  const gatewayGeneration = useRef(0);
  const gatewayMutation = useRef(false);
  const gatewaySession = useRef<string | undefined>(undefined);
  async function refreshGateway(
    target = gatewaySession.current,
    force = false,
  ) {
    if (gatewayMutation.current && !force) return;
    const token = ++gatewayGeneration.current;
    try {
      const response = await api.gatewaySnapshot(target);
      if (token !== gatewayGeneration.current) return;
      if (!response.ok) throw new Error(response.code);
      if (target && response.snapshot?.session_id !== target)
        throw new Error("Selected MCP connection unavailable");
      gatewaySession.current = response.snapshot?.session_id;
      setGateway(
        response.snapshot
          ? { ...response.snapshot, sessions: response.sessions ?? [] }
          : null,
      );
      setGatewayError("");
    } catch {
      if (token === gatewayGeneration.current) {
        setGateway(null);
        setGatewayError(
          "Standalone gateway unavailable; no live connection is verified.",
        );
      }
    }
  }
  function selectGatewaySession(id: string) {
    if (id === gatewaySession.current) return;
    gatewaySession.current = id;
    ++gatewayGeneration.current;
    setGateway(null);
    setGatewayError("");
    void refreshGateway(id, true);
  }
  async function controlGateway(request: unknown, expectedSession?: string) {
    const target = gatewaySession.current;
    if (
      gatewayMutation.current ||
      !target ||
      (expectedSession && expectedSession !== target)
    )
      return;
    gatewayMutation.current = true;
    const token = ++gatewayGeneration.current;
    try {
      const response = await api.gatewayControl({
        operation: "for_session",
        session_id: target,
        request,
      });
      if (token !== gatewayGeneration.current) return;
      if (!response.ok) throw new Error(response.code);
      if (response.snapshot?.session_id !== target)
        throw new Error("Selected MCP connection unavailable");
      setGateway({ ...response.snapshot, sessions: response.sessions ?? [] });
      setGatewayError("");
    } catch (e) {
      if (token === gatewayGeneration.current)
        setGatewayError(e instanceof Error ? e.message : String(e));
    } finally {
      gatewayMutation.current = false;
    }
  }

  const [bootstrap, setBootstrap] = useState<Bootstrap>({
    projects: [],
    active_project_id: null,
  });
  const [registryReady, setRegistryReady] = useState(false);
  const [historyState, setHistoryState] = useState<
    "loading" | "ready" | "unavailable"
  >("unavailable");
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const [view, setView] = useState<View>("reports");
  useEffect(() => {
    if (view !== "security" && view !== "handoffs") return;
    void refreshGateway();
    const timer = window.setInterval(() => void refreshGateway(), 2000);
    return () => clearInterval(timer);
  }, [view]);
  const [listing, setListing] = useState(noRuns);
  const [report, setReport] = useState<Report | null>(null);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [auditTarget, setAuditTarget] = useState<string | null>(null);
  const selectionQueue = useRef(Promise.resolve());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"audit" | "switcher" | "search" | null>(
    null,
  );
  const [commit, setCommit] = useState("");
  const [search, setSearch] = useState("");
  const generation = useRef(0);
  const reportGeneration = useRef(0);
  const project = bootstrap.projects.find((p) => p.id === selected) ?? null;
  const evidence = report?.evidence.find((e) => e.id === evidenceId);
  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : String(e));
  }
  async function loadReport(projectId: string, runId: string) {
    const request = ++reportGeneration.current;
    setLoading(true);
    setReport(null);
    setEvidenceId(null);
    try {
      const data = await api.report(projectId, runId);
      if (
        request === reportGeneration.current &&
        selectedRef.current === projectId
      )
        setReport(data);
    } catch (e) {
      if (request === reportGeneration.current) fail(e);
    } finally {
      if (request === reportGeneration.current) setLoading(false);
    }
  }
  async function refresh(projectId: string, runId?: string) {
    const request = ++generation.current;
    try {
      const data = await api.runs(projectId);
      if (request !== generation.current || selectedRef.current !== projectId)
        return;
      setListing(data);
      setHistoryState(
        data.unavailable > 0 && data.runs.length === 0
          ? "unavailable"
          : "ready",
      );
      const id = runId ?? data.runs[0]?.run_id;
      if (id) await loadReport(projectId, id);
    } catch (e) {
      if (request === generation.current) {
        setHistoryState("unavailable");
        fail(e);
      }
    }
  }
  function activate(id: string | null, runId?: string) {
    selectedRef.current = id;
    setSelected(id);
    ++generation.current;
    ++reportGeneration.current;
    setReport(null);
    setEvidenceId(null);
    setListing(noRuns);
    setHistoryState(id ? "loading" : "unavailable");
    setLoading(false);
    setError("");
    if (id) void refresh(id, runId);
  }
  useEffect(() => {
    if (!nativeAvailable && !testMode) return;
    let cancelled = false;
    api
      .bootstrap()
      .then((data) => {
        if (cancelled) return;
        setBootstrap(data);
        setRegistryReady(true);
        activate(data.active_project_id ?? data.projects[0]?.id ?? null);
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setModal("search");
      }
      if (e.key === "Escape" && !document.querySelector("dialog[open]"))
        setEvidenceId(null);
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  async function switchProject(id: string, runId?: string) {
    setModal(null);
    activate(id, runId);
    try {
      selectionQueue.current = selectionQueue.current
        .catch(() => {})
        .then(async () => {
          if (selectedRef.current === id) await api.select(id);
        });
      await selectionQueue.current;
    } catch (e) {
      if (selectedRef.current === id) fail(e);
    }
  }
  async function register() {
    try {
      setError("");
      const data = await api.register();
      if (data) {
        setBootstrap(data);
        setRegistryReady(true);
        activate(data.active_project_id);
        setModal(null);
      }
    } catch (e) {
      fail(e);
    }
  }
  async function runAudit() {
    if (!project || busy || !/^[a-fA-F0-9]{40}$/.test(commit)) return;
    const target = project.id;
    const snapshot = commit;
    ++generation.current;
    ++reportGeneration.current;
    setReport(null);
    setEvidenceId(null);
    setLoading(false);
    setAuditTarget(target);
    setBusy(true);
    setModal(null);
    setError("");
    setView("workspace");
    try {
      const id = await api.audit(target, snapshot);
      if (selectedRef.current === target) {
        await refresh(target, id);
        setView("reports");
      }
    } catch (e) {
      if (selectedRef.current === target) fail(e);
    } finally {
      setBusy(false);
    }
  }
  function selectRun(id: string) {
    if (selected) {
      setView("reports");
      void loadReport(selected, id);
    }
  }
  function openEvidence(id: string) {
    setEvidenceId(id);
  }
  const pageProps = {
    historyState,
    project,
    runs: listing.runs,
    report,
    busy,
    onSelectRun: selectRun,
    onEvidence: openEvidence,
    onRun: () => {
      setCommit("");
      setModal("audit");
    },
  };
  const gatewayProps = {
    gateway,
    gatewayError,
    onRefreshGateway: () => void refreshGateway(),
    onSelectGatewaySession: selectGatewaySession,
    onAccess: (id: string, scope: AccessScope, sessionId: string) =>
      void controlGateway(
        {
          operation: "set_access",
          workspace_id: id,
          scope,
          session_id: sessionId,
        },
        sessionId,
      ),
    onRevoke: (id: string) =>
      void controlGateway({ operation: "revoke", workspace_id: id }),
    onDecision: (id: string, approve: boolean) =>
      void controlGateway({ operation: "decide", request_id: id, approve }),
    onRelatedReport: (wid: string, rid: string) => {
      void switchProject(wid, rid);
      setView("reports");
    },
  };
  const matches =
    report?.evidence
      .filter((e) => e.path.toLowerCase().includes(search.toLowerCase()))
      .slice(0, 50) ?? [];
  return (
    <div
      className={`app ${evidence ? "has-inspector" : ""} ${nativeAvailable && navigator.platform.startsWith("Mac") ? "native-macos" : ""}`}
    >
      <header className="toolbar" data-tauri-drag-region>
        <div className="brand">Orven</div>
        <span className="toolbar-divider" />
        <button
          className="workspace-crumb"
          onClick={() => setModal("switcher")}
          aria-label="Switch workspace"
        >
          <span>{project?.name ?? "Workspace"}</span>
          {report && <code>{shortId(report.commit)}</code>}
          <ChevronDown size={12} />
        </button>
        <nav className="top-navigation" aria-label="Primary navigation">
          {(
            [
              "overview",
              "workspace",
              "reports",
              "evidence",
              "history",
            ] as View[]
          ).map((id) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => {
                setView(id);
                setEvidenceId(null);
              }}
            >
              {id === "workspace"
                ? "Audit Workspace"
                : id[0].toUpperCase() + id.slice(1)}
            </button>
          ))}
        </nav>
        <div className="toolbar-actions">
          <span className="local-chip">
            <span className="dot" /> Local only <LockKeyhole size={11} />
          </span>
          <Button
            icon={Search}
            onClick={() => setModal("search")}
            aria-label="Search evidence"
          >
            Search <kbd>⌘K</kbd>
          </Button>
          <Button
            icon={Play}
            primary
            disabled={!project || busy}
            onClick={() => {
              setCommit("");
              setModal("audit");
            }}
          >
            {busy ? "Auditing…" : "Run Audit"}
          </Button>
        </div>
      </header>
      <aside className="sidebar">
        <div className="engine">
          <span className="engine-mark">OE</span>
          <div>
            <strong>Core Engine</strong>
            <span className="caption muted inline">
              <span className={`dot ${busy ? "dot-blue" : ""}`} />
              {busy ? "inspecting snapshot" : "local · committed-text-v1"}
            </span>
          </div>
        </div>
        <div className="rail-label">
          <span>
            WORKSPACES ({registryReady ? bootstrap.projects.length : "—"})
          </span>
          <button
            className="icon-button"
            aria-label="Register repository"
            disabled={!nativeAvailable && !testMode}
            onClick={() => void register()}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="workspace-list">
          {bootstrap.projects.map((p) => (
            <button
              key={p.id}
              className={`workspace-item ${p.id === selected ? "active" : ""}`}
              onClick={() => void switchProject(p.id)}
              title={p.path}
            >
              {p.id === selected ? (
                <FolderOpen size={15} />
              ) : (
                <Folder size={15} />
              )}
              <span>{p.name}</span>
              {p.id === selected && <Badge>Active</Badge>}
            </button>
          ))}
          {!bootstrap.projects.length && (
            <p className="rail-empty">
              {registryReady
                ? "No repositories registered"
                : "Open native Orven to view repositories"}
            </p>
          )}
        </div>
        <div className="rail-divider" />
        <div className="rail-label">
          WORKSPACE: {project?.name.toUpperCase() ?? "NONE"}
        </div>
        <nav className="side-navigation" aria-label="Workspace navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => {
                setView(id);
                setEvidenceId(null);
              }}
            >
              <Icon size={16} strokeWidth={1.5} />
              <span>{label}</span>
              {id === "reports" && report && (
                <span className="nav-count">{report.findings.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Button
            icon={Plus}
            disabled={!nativeAvailable && !testMode}
            onClick={() => void register()}
          >
            Register repository
          </Button>
          <button onClick={() => setView("security")}>
            <SlidersHorizontal size={15} /> Local policy & settings
          </button>
          <div className="caption muted">Private reports stay on this Mac.</div>
        </div>
      </aside>
      <main
        className={`main ${view === "workspace" ? "main-workspace" : ""}`}
        id="main-content"
      >
        {testMode && (
          <div className="fixture-banner">
            SYNTHETIC VISUAL TEST FIXTURE — no real repository or connection
          </div>
        )}
        {!nativeAvailable && !testMode && (
          <div className="notice">
            <b>Native workspace unavailable in this browser.</b> Open the Orven
            desktop app to register local repositories and run audits.
          </div>
        )}
        {error && (
          <div className="error-notice" role="alert">
            <span>{error}</span>
            <button className="text-button" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
        {(listing.unavailable > 0 || listing.incomplete > 0) && (
          <div className="notice">
            {listing.unavailable} unavailable or invalid reports ·{" "}
            {listing.incomplete} incomplete runs. These are not counted as
            successful audits.
          </div>
        )}
        {loading && (
          <div className="loading-note" role="status">
            Loading validated report…
          </div>
        )}
        {view === "reports" && <ReportPage {...pageProps} />}
        {view === "workspace" && (
          <WorkspacePage
            {...pageProps}
            running={busy && auditTarget === selected}
          />
        )}
        {view === "history" && <HistoryPage {...pageProps} />}
        {view === "security" && (
          <SecurityPage {...pageProps} {...gatewayProps} />
        )}
        {view === "overview" && (
          <>
            <PageHeading
              eyebrow="LOCAL ENGINEERING WORKSPACE"
              title={
                project
                  ? `${project.name} — Workspace Overview`
                  : "Your engineering audit workspace"
              }
            >
              Committed evidence. Inspectable reports. Clear boundaries.
            </PageHeading>
            <div className="overview-metrics">
              <Metric label="REGISTERED ROOT" value={project?.name ?? "None"}>
                {project?.path ?? "Choose a local repository"}
              </Metric>
              <Metric
                label="SAVED RUNS"
                value={
                  historyState === "ready" ? listing.runs.length : "Unknown"
                }
              >
                Valid finalized reports
              </Metric>
              <Metric
                label="LATEST SNAPSHOT"
                value={report ? shortId(report.commit) : "Not selected"}
              >
                {report
                  ? timestamp(report.captured_unix_seconds)
                  : "Select an available saved report"}
              </Metric>
            </div>
            <Panel title="Start with a committed snapshot">
              <div className="panel-body">
                <p>
                  Inspect an immutable Git commit without changing the
                  repository. Dirty changes, external dependencies and
                  unsupported storage stay outside scope.
                </p>
                <div className="actions">
                  <Button
                    primary
                    icon={Play}
                    disabled={!project || busy}
                    onClick={pageProps.onRun}
                  >
                    Run local audit
                  </Button>
                  <Button
                    icon={Plus}
                    onClick={() => void register()}
                    disabled={!nativeAvailable && !testMode}
                  >
                    Register repository
                  </Button>
                </div>
              </div>
            </Panel>
          </>
        )}
        {view === "evidence" && (
          <>
            <PageHeading
              eyebrow="CAPTURED SOURCE · IMMUTABLE SNAPSHOT"
              title="Evidence Explorer"
            >
              Browse the exact source bytes retained by the selected audit.
            </PageHeading>
            <Panel
              title="Evidence index"
              actions={
                <Badge>
                  {report
                    ? `${report.evidence.length} records`
                    : "No report selected"}
                </Badge>
              }
            >
              <div className="evidence-index">
                {report?.evidence.length ? (
                  report.evidence.map((e) => (
                    <button key={e.id} onClick={() => openEvidence(e.id)}>
                      <FileText size={15} />
                      <span className="mono">{e.path}</span>
                      <span className="muted mono">
                        {e.id} · {e.byte_end} bytes
                      </span>
                    </button>
                  ))
                ) : (
                  <EmptyState title="No captured evidence">
                    Select a validated report or run a local audit.
                  </EmptyState>
                )}
              </div>
            </Panel>
          </>
        )}
        {view === "handoffs" && (
          <HandoffsPage {...pageProps} {...gatewayProps} />
        )}
      </main>
      {evidence && report && (
        <EvidenceViewer
          key={`${report.run_id}-${evidence.id}`}
          evidence={evidence}
          report={report}
          onClose={() => setEvidenceId(null)}
        />
      )}
      <footer className="statusbar">
        <span className="inline">
          <span className="dot" /> {busy ? "Audit running" : "Local workspace"}
        </span>
        <span>engine: committed-text-v1</span>
        <span>
          snapshot: {report ? shortId(report.commit) : "not selected"}
        </span>
        <span className="status-spacer" />
        <span>Provider: unavailable</span>
        <span>UTF-8 · Local storage</span>
        <span className="inline">
          <LockKeyhole size={11} /> Repository read-only
        </span>
      </footer>
      {modal === "audit" && (
        <Dialog
          title="Run a local snapshot audit"
          onClose={() => setModal(null)}
        >
          <p>
            Target: <b>{project?.name}</b>
          </p>
          <label className="field-label" htmlFor="commit">
            Full commit ID
          </label>
          <input
            id="commit"
            autoFocus
            className="text-input mono"
            value={commit}
            onChange={(e) => setCommit(e.target.value.trim())}
            placeholder="40 hexadecimal characters"
            onKeyDown={(e) => {
              if (e.key === "Enter") void runAudit();
            }}
          />
          <p className="caption muted">
            Only committed loose Git objects are supported. Hooks, builds, tests
            and scripts will not run. Output stays in private application
            storage.
          </p>
          <div className="dialog-actions">
            <Button onClick={() => setModal(null)}>Cancel</Button>
            <Button
              primary
              icon={Play}
              disabled={!project || busy || !/^[a-fA-F0-9]{40}$/.test(commit)}
              onClick={() => void runAudit()}
            >
              Run audit
            </Button>
          </div>
        </Dialog>
      )}
      {modal === "switcher" && (
        <Dialog title="Switch workspace" onClose={() => setModal(null)}>
          <div className="switcher-list">
            {bootstrap.projects.map((p) => (
              <button key={p.id} onClick={() => void switchProject(p.id)}>
                <Folder size={16} />
                <span>
                  <b>{p.name}</b>
                  <small>{p.path}</small>
                </span>
                {p.id === selected && <Badge>Active</Badge>}
              </button>
            ))}
          </div>
          <Button
            icon={Plus}
            onClick={() => void register()}
            disabled={!nativeAvailable && !testMode}
          >
            Register repository…
          </Button>
        </Dialog>
      )}
      {modal === "search" && (
        <Dialog
          title="Search captured evidence"
          onClose={() => {
            setModal(null);
            setSearch("");
          }}
        >
          <input
            className="text-input"
            aria-label="Search captured paths"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search paths in the selected report…"
          />
          <div className="search-results">
            {matches.map((e) => (
              <button
                key={e.id}
                onClick={() => {
                  setModal(null);
                  setEvidenceId(e.id);
                  setSearch("");
                }}
              >
                <FileText size={15} />
                <span>{e.path}</span>
                <code>{e.id}</code>
              </button>
            ))}
            {!matches.length && (
              <p className="muted">No captured paths match.</p>
            )}
          </div>
          <p className="caption muted">
            Search is local to the selected saved report. Maximum 50 results.
          </p>
        </Dialog>
      )}
    </div>
  );
}
