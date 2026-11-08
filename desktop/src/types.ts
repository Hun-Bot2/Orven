export interface Evidence {
  id: string;
  path: string;
  blob_id: string;
  sha256: string;
  content: string;
  capture_status: string;
  byte_start: number;
  byte_end: number;
}
export interface Finding {
  title: string;
  classification: string;
  severity: string;
  rationale: string;
  recommendation: string;
  limitations: string;
  evidence_ids: string[];
}
export interface CheckReceipt {
  id: string;
  version: string;
  status: string;
  reason: string;
}
export interface Report {
  schema_version: number;
  run_id: string;
  repository_id: string;
  origin: string;
  captured_unix_seconds: number;
  commit: string;
  manifest_sha256: string;
  policy: string;
  collector_version: string;
  status: string;
  execution_status: string;
  analysis_status: string;
  checks: CheckReceipt[];
  evidence: Evidence[];
  exclusions: { path: string; reason: string }[];
  findings: Finding[];
}
export interface Project {
  id: string;
  name: string;
  path: string;
}
export interface RunSummary {
  run_id: string;
  commit: string;
  captured_unix_seconds: number;
  evidence_count: number;
  exclusion_count: number;
  finding_count: number;
  status: string;
}
export interface RunListing {
  runs: RunSummary[];
  unavailable: number;
  incomplete: number;
}
export interface Bootstrap {
  projects: Project[];
  active_project_id: string | null;
}
export type View =
  | "overview"
  | "workspace"
  | "reports"
  | "evidence"
  | "history"
  | "security"
  | "handoffs";
export interface PageProps {
  historyState: "loading" | "ready" | "unavailable";
  project: Project | null;
  runs: RunSummary[];
  report: Report | null;
  busy: boolean;
  onSelectRun: (id: string) => void;
  onEvidence: (id: string) => void;
  onRun: () => void;
}
