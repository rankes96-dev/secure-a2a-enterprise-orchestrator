import { defaultTenantId } from "../tenant/tenantContext.js";
import type { PlatformStateStore, PlatformStateStoreHealth, StoredAuditEvent, StoredConnectorTrustRecord, StoredConversationStateRecord, StoredPlatformUser } from "./platformStateStore.js";
import { platformOwnerKeyHash } from "./stateKeyHash.js";

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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function userKey(tenantId: string, email: string): string {
  return `${tenantId}:${normalizeEmail(email)}`;
}

function copyPlatformUser(user: StoredPlatformUser): StoredPlatformUser {
  return {
    ...user,
    roles: [...user.roles]
  };
}

export class InMemoryPlatformStateStore implements PlatformStateStore {
  private readonly connectorTrustRecordsByOwnerHash = new Map<string, StoredConnectorTrustRecord[]>();
  private readonly auditEvents: StoredAuditEvent[] = [];
  private readonly conversationStates = new Map<string, StoredConversationStateRecord>();
  private readonly usersByTenantEmail = new Map<string, StoredPlatformUser>();

  constructor(seedUsers: StoredPlatformUser[] = []) {
    const now = new Date().toISOString();
    for (const email of (process.env.PLATFORM_ALLOWED_USER_EMAILS ?? "").split(",")) {
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) {
        continue;
      }
      const tenantId = defaultTenantId();
      const user: StoredPlatformUser = {
        id: `${tenantId}:${normalizedEmail}`,
        tenantId,
        email: normalizedEmail,
        roles: [],
        status: "active",
        createdAt: now,
        updatedAt: now
      };
      this.usersByTenantEmail.set(userKey(tenantId, normalizedEmail), copyPlatformUser(user));
    }

    for (const user of seedUsers) {
      this.usersByTenantEmail.set(userKey(user.tenantId, user.email), copyPlatformUser({
        ...user,
        email: normalizeEmail(user.email)
      }));
    }
  }

  async health(): Promise<PlatformStateStoreHealth> {
    return {
      driver: "memory",
      ready: true,
      details: "Local in-memory platform state store for development and tests."
    };
  }

  async listConnectorTrustRecords(ownerKey: string): Promise<StoredConnectorTrustRecord[]> {
    const ownerKeyHash = platformOwnerKeyHash(ownerKey);
    return (this.connectorTrustRecordsByOwnerHash.get(ownerKeyHash) ?? []).map(copyConnectorTrustRecord);
  }

  async upsertConnectorTrustRecord(record: StoredConnectorTrustRecord): Promise<void> {
    const current = this.connectorTrustRecordsByOwnerHash.get(record.ownerKeyHash) ?? [];
    const next = current.filter((item) => item.id !== record.id);
    next.push(copyConnectorTrustRecord(record));
    this.connectorTrustRecordsByOwnerHash.set(record.ownerKeyHash, next);
  }

  async deleteConnectorTrustRecord(ownerKey: string, id: string): Promise<void> {
    const ownerKeyHash = platformOwnerKeyHash(ownerKey);
    const current = this.connectorTrustRecordsByOwnerHash.get(ownerKeyHash) ?? [];
    this.connectorTrustRecordsByOwnerHash.set(
      ownerKeyHash,
      current.filter((item) => item.id !== id)
    );
  }

  async appendAuditEvent(event: StoredAuditEvent): Promise<void> {
    this.auditEvents.push(copyAuditEvent(event));
  }

  async listAuditEvents(params: {
    tenantId?: string;
    actorSubject?: string;
    eventType?: string;
    resourceType?: string;
    resourceId?: string;
    from?: string;
    to?: string;
    conversationId?: string;
    limit?: number;
    offset?: number;
  }): Promise<StoredAuditEvent[]> {
    const fromTime = params.from ? Date.parse(params.from) : undefined;
    const toTime = params.to ? Date.parse(params.to) : undefined;
    const filtered = this.auditEvents.filter((event) => {
      if (params.tenantId && event.tenantId !== params.tenantId) {
        return false;
      }
      if (params.actorSubject && event.actorSubject !== params.actorSubject) {
        return false;
      }
      if (params.eventType && event.eventType !== params.eventType) {
        return false;
      }
      if (params.resourceType && event.resourceType !== params.resourceType) {
        return false;
      }
      if (params.resourceId && event.resourceId !== params.resourceId) {
        return false;
      }
      const createdAt = Date.parse(event.createdAt);
      if (typeof fromTime === "number" && createdAt < fromTime) {
        return false;
      }
      if (typeof toTime === "number" && createdAt > toTime) {
        return false;
      }
      if (params.conversationId && event.safeMetadata.conversationId !== params.conversationId) {
        return false;
      }
      return true;
    }).sort((left, right) => {
      const createdAtOrder = right.createdAt.localeCompare(left.createdAt);
      return createdAtOrder || right.id.localeCompare(left.id);
    });
    const offset = typeof params.offset === "number" && Number.isInteger(params.offset) && params.offset >= 0 ? params.offset : 0;
    const limit = typeof params.limit === "number" && params.limit >= 0 ? params.limit : filtered.length;
    const limited = filtered.slice(offset, offset + limit);
    return limited.map(copyAuditEvent);
  }

  async findUserByEmail(params: {
    tenantId: string;
    email: string;
  }): Promise<StoredPlatformUser | undefined> {
    const user = this.usersByTenantEmail.get(userKey(params.tenantId, params.email));
    return user ? copyPlatformUser(user) : undefined;
  }

  async bindUserIdentity(params: {
    userId: string;
    provider: string;
    issuer?: string;
    subject: string;
    email: string;
    displayName?: string;
    roles?: string[];
  }): Promise<StoredPlatformUser> {
    const entry = [...this.usersByTenantEmail.entries()].find(([, user]) => user.id === params.userId);
    if (!entry) {
      throw new Error("User directory entry was not found.");
    }

    const [currentKey, user] = entry;
    if (user.subject || user.provider || user.issuer) {
      if (user.provider !== params.provider || user.issuer !== params.issuer || user.subject !== params.subject) {
        throw new Error("User directory identity binding mismatch.");
      }
    }

    const updated: StoredPlatformUser = {
      ...user,
      provider: params.provider,
      issuer: params.issuer ?? user.issuer,
      subject: params.subject,
      email: normalizeEmail(params.email),
      displayName: params.displayName ?? user.displayName,
      roles: params.roles ?? user.roles,
      status: user.status === "invited" ? "active" : user.status,
      updatedAt: new Date().toISOString()
    };
    this.usersByTenantEmail.delete(currentKey);
    this.usersByTenantEmail.set(userKey(updated.tenantId, updated.email), copyPlatformUser(updated));
    return copyPlatformUser(updated);
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
