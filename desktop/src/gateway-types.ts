export interface AccessScope {
  discover: boolean;
  audit: boolean;
  reports: boolean;
}
export interface TaskBrief {
  id: string;
  workspace_id: string | null;
  tool: string;
  source_client: string;
  source_identity: string;
  supplied_context: unknown;
  received_payload_redacted: unknown;
  validated_arguments_sha256: string;
  objective: string;
  consent: string;
  status: string;
  created: number;
  epoch: number;
  execution_id: string | null;
  report_id: string | null;
  outbound_preview: unknown | null;
  outbound_sha256: string | null;
  trace: string[];
}
export interface GatewaySession {
  session_id: string;
  client: string;
}
export interface GatewaySnapshot {
  sessions?: GatewaySession[];
  running: boolean;
  session_id: string;
  transport: string;
  client: string;
  access: {
    workspace_id: string;
    scope: AccessScope;
    epoch: number;
    root_identity: string;
  }[];
  briefs: TaskBrief[];
}
export interface GatewayProps {
  gateway: GatewaySnapshot | null;
  gatewayError: string;
  onRefreshGateway: () => void;
  onSelectGatewaySession: (id: string) => void;
  onAccess: (id: string, scope: AccessScope, sessionId: string) => void;
  onRevoke: (id: string) => void;
  onDecision: (id: string, approve: boolean) => void;
  onRelatedReport: (workspaceId: string, reportId: string) => void;
}
