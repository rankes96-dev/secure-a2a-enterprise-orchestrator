export type SecurityEventSeverity =
  | "info"
  | "low"
  | "medium"
  | "high"
  | "critical";

export type SecurityEventOutcome =
  | "success"
  | "failure"
  | "blocked"
  | "needs_action";

export type SecurityEventEnvelope = {
  schemaVersion: string;
  id: string;
  eventType: string;
  severity: SecurityEventSeverity;
  outcome: SecurityEventOutcome;
  createdAt: string;

  tenantId?: string;
  actorProvider?: string;
  actorSubject?: string;
  actorEmail?: string;

  conversationId?: string;
  requestId?: string;
  taskId?: string;
  connectorId?: string;
  runtimeExecutionId?: string;

  resourceType?: string;
  resourceId?: string;

  safeMetadata: Record<string, unknown>;
};

export type SecurityEventSink = {
  publish(event: SecurityEventEnvelope): Promise<void>;
};
