import type { PlatformStateStore, PlatformStateStoreHealth, StoredAuditEvent, StoredConnectorTrustRecord, StoredConversationStateRecord } from "./platformStateStore.js";

function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneSafeMetadata(value: Record<string, unknown>): Record<string, unknown> {
  return deepClone(value);
}

function copyConnectorTrustRecord(record: StoredConnectorTrustRecord): StoredConnectorTrustRecord {
  return {
    ...record,
    safeMetadata: cloneSafeMetadata(record.safeMetadata)
  };
}

function copyAuditEvent(event: StoredAuditEvent): StoredAuditEvent {
  return {
    ...event,
    safeMetadata: cloneSafeMetadata(event.safeMetadata)
  };
}

function copyConversationState(record: StoredConversationStateRecord): StoredConversationStateRecord {
  return deepClone(record);
}

export class InMemoryPlatformStateStore implements PlatformStateStore {
  private readonly connectorTrustRecordsByOwner = new Map<string, StoredConnectorTrustRecord[]>();
  private readonly auditEvents: StoredAuditEvent[] = [];
  private readonly conversationStates = new Map<string, StoredConversationStateRecord>();

  async health(): Promise<PlatformStateStoreHealth> {
    return {
      driver: "memory",
      ready: true,
      details: "Local in-memory platform state store for development and tests."
    };
  }

  async listConnectorTrustRecords(ownerKey: string): Promise<StoredConnectorTrustRecord[]> {
    return (this.connectorTrustRecordsByOwner.get(ownerKey) ?? []).map(copyConnectorTrustRecord);
  }

  async upsertConnectorTrustRecord(record: StoredConnectorTrustRecord): Promise<void> {
    const current = this.connectorTrustRecordsByOwner.get(record.ownerKey) ?? [];
    const next = current.filter((item) => item.id !== record.id);
    next.push(copyConnectorTrustRecord(record));
    this.connectorTrustRecordsByOwner.set(record.ownerKey, next);
  }

  async deleteConnectorTrustRecord(ownerKey: string, id: string): Promise<void> {
    const current = this.connectorTrustRecordsByOwner.get(ownerKey) ?? [];
    this.connectorTrustRecordsByOwner.set(
      ownerKey,
      current.filter((item) => item.id !== id)
    );
  }

  async appendAuditEvent(event: StoredAuditEvent): Promise<void> {
    this.auditEvents.push(copyAuditEvent(event));
  }

  async listAuditEvents(params: {
    tenantId?: string;
    actorSubject?: string;
    resourceType?: string;
    resourceId?: string;
    limit?: number;
  }): Promise<StoredAuditEvent[]> {
    const filtered = this.auditEvents.filter((event) => {
      if (params.tenantId && event.tenantId !== params.tenantId) {
        return false;
      }
      if (params.actorSubject && event.actorSubject !== params.actorSubject) {
        return false;
      }
      if (params.resourceType && event.resourceType !== params.resourceType) {
        return false;
      }
      if (params.resourceId && event.resourceId !== params.resourceId) {
        return false;
      }
      return true;
    });
    const limited = typeof params.limit === "number" && params.limit >= 0 ? filtered.slice(-params.limit) : filtered;
    return limited.map(copyAuditEvent);
  }

  async upsertConversationState(record: StoredConversationStateRecord): Promise<void> {
    this.conversationStates.set(record.id, copyConversationState(record));
  }

  async getConversationState(id: string): Promise<StoredConversationStateRecord | undefined> {
    const record = this.conversationStates.get(id);
    return record ? copyConversationState(record) : undefined;
  }

  async listConversationStates(params: {
    actorSubject?: string;
    tenantId?: string;
    limit?: number;
  }): Promise<StoredConversationStateRecord[]> {
    const filtered = [...this.conversationStates.values()]
      .filter((record) => {
        if (params.tenantId && record.tenantId !== params.tenantId) {
          return false;
        }
        if (params.actorSubject && record.actorSubject !== params.actorSubject) {
          return false;
        }
        return true;
      })
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    const limited = typeof params.limit === "number" && params.limit >= 0 ? filtered.slice(-params.limit) : filtered;
    return limited.map(copyConversationState);
  }
}
