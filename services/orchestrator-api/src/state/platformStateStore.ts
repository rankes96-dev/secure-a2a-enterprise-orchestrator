export type PlatformStateStoreDriver = "memory" | "postgres";

export type PlatformStateStoreHealth = {
  driver: PlatformStateStoreDriver;
  ready: boolean;
  details?: string;
};

export type StoredConnectorTrustRecord = {
  id: string;
  tenantId?: string;
  ownerKeyHash: string;
  connectorId?: string;
  resourceSystem?: string;
  agentId: string;
  issuer: string;
  audience: string;
  runtimeEndpoint?: string;
  connectorProfileHash?: string;
  externalConfigHash?: string;
  trustedAt: string;
  updatedAt: string;
  safeMetadata: Record<string, unknown>;
};

export type StoredAuditEvent = {
  id: string;
  tenantId?: string;
  actorProvider?: string;
  actorSubject?: string;
  actorEmail?: string;
  eventType: string;
  resourceType?: string;
  resourceId?: string;
  createdAt: string;
  safeMetadata: Record<string, unknown>;
};

export type StoredConversationMessage = {
  role: "user" | "assistant";
  timestamp: string;
  safeSummary: string;
};

export type StoredPendingInteractionRecord = {
  id: string;
  type: string;
  createdAt: string;
  expiresAt?: string;
  safeOriginalUserRequestSummary?: string;
  safeContext: Record<string, unknown>;
};

export type StoredConversationStateRecord = {
  id: string;
  ownerSessionHash?: string;
  tenantId?: string;
  actorProvider?: string;
  actorSubject?: string;
  actorEmail?: string;
  createdAt: string;
  updatedAt: string;
  lastResolutionStatus?: string;
  needsMoreInfoCount: number;
  messages: StoredConversationMessage[];
  pendingInteraction?: StoredPendingInteractionRecord;
  pendingFollowUp?: Record<string, unknown>;
  lastRequestInterpretation?: Record<string, unknown>;
  safeMetadata: Record<string, unknown>;
};

export type PlatformStateStore = {
  health(): Promise<PlatformStateStoreHealth>;

  // Connector trust registry: first durable target for Phase 2.1.
  listConnectorTrustRecords(ownerKey: string): Promise<StoredConnectorTrustRecord[]>;
  upsertConnectorTrustRecord(record: StoredConnectorTrustRecord): Promise<void>;
  deleteConnectorTrustRecord(ownerKey: string, id: string): Promise<void>;

  // Audit events: future Phase 2.2.
  appendAuditEvent(event: StoredAuditEvent): Promise<void>;
  listAuditEvents(params: {
    tenantId?: string;
    actorSubject?: string;
    resourceType?: string;
    resourceId?: string;
    limit?: number;
  }): Promise<StoredAuditEvent[]>;

  // Conversation snapshots: future Phase 2.3 read-path persistence.
  upsertConversationState(record: StoredConversationStateRecord): Promise<void>;
  getConversationState(id: string): Promise<StoredConversationStateRecord | undefined>;
  listConversationStates(params: {
    actorSubject?: string;
    tenantId?: string;
    limit?: number;
  }): Promise<StoredConversationStateRecord[]>;
};
