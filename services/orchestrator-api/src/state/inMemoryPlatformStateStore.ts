import type { PlatformStateStore, PlatformStateStoreHealth, StoredAuditEvent, StoredConnectorTrustRecord } from "./platformStateStore.js";

function copyConnectorTrustRecord(record: StoredConnectorTrustRecord): StoredConnectorTrustRecord {
  return {
    ...record,
    safeMetadata: { ...record.safeMetadata }
  };
}

function copyAuditEvent(event: StoredAuditEvent): StoredAuditEvent {
  return {
    ...event,
    safeMetadata: { ...event.safeMetadata }
  };
}

export class InMemoryPlatformStateStore implements PlatformStateStore {
  private readonly connectorTrustRecordsByOwner = new Map<string, StoredConnectorTrustRecord[]>();
  private readonly auditEvents: StoredAuditEvent[] = [];

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
}
