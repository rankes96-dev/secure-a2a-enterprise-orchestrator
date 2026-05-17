// V2 persistence will store these events in an audit log table.
export type AuditEvent = {
  event: string;
  timestamp: string;
  actor?: string;
  connectorId?: string;
  resourceSystem?: string;
  agentId?: string;
  skillId?: string;
  outcome: "started" | "succeeded" | "failed" | "blocked" | "metadata_only";
  reason?: string;
  metadata?: Record<string, unknown>;
};
