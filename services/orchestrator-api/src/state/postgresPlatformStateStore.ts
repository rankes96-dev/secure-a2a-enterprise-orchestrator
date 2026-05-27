import { Pool, type QueryResultRow } from "pg";
import { outcomeForEventType, severityForEventType } from "../securityEvents/securityEventClassification.js";
import { postgresConfigFromEnv } from "./postgresConfig.js";
import type {
  PlatformStateStore,
  PlatformStateStoreHealth,
  StoredAuditEvent,
  StoredAuditEventClassificationListParams,
  StoredAuditEventListParams,
  StoredAuditEventPageBoundary,
  StoredConnectorTrustRecord,
  StoredConversationMessage,
  StoredConversationStateRecord,
  StoredPlatformUser,
  StoredPlatformUserStatus,
  StoredPendingInteractionRecord
} from "./platformStateStore.js";
import { platformOwnerKeyHash } from "./stateKeyHash.js";

type DbConnectorTrustRecord = QueryResultRow & {
  id: string;
  tenant_id: string | null;
  owner_key_hash: string;
  connector_id: string | null;
  resource_system: string | null;
  agent_id: string;
  issuer: string;
  audience: string;
  runtime_endpoint: string | null;
  connector_profile_hash: string | null;
  external_config_hash: string | null;
  trusted_at: Date | string;
  updated_at: Date | string;
  safe_metadata: unknown;
};

type DbAuditEvent = QueryResultRow & {
  id: string;
  tenant_id: string | null;
  actor_provider: string | null;
  actor_subject: string | null;
  actor_email: string | null;
  event_type: string;
  resource_type: string | null;
  resource_id: string | null;
  created_at: Date | string;
  outcome: ReturnType<typeof outcomeForEventType> | null;
  severity: ReturnType<typeof severityForEventType> | null;
  safe_metadata: unknown;
};

type DbConversationState = QueryResultRow & {
  id: string;
  tenant_id: string | null;
  actor_provider: string | null;
  actor_subject: string | null;
  actor_email: string | null;
  owner_session_hash: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  last_resolution_status: string | null;
  needs_more_info_count: number;
  messages: unknown;
  pending_interaction: unknown;
  pending_follow_up: unknown;
  last_request_interpretation: unknown;
  safe_metadata: unknown;
};

type DbPlatformUser = QueryResultRow & {
  id: string;
  tenant_id: string;
  provider: string | null;
  issuer: string | null;
  subject: string | null;
  email: string;
  display_name: string | null;
  roles: unknown;
  status: StoredPlatformUserStatus;
  created_at: Date | string;
  updated_at: Date | string;
};

function recordFromJson(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayFromJson<T>(value: unknown): T[] {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed as T[] : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value as T[] : [];
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function optional(value: string | null): string | undefined {
  return value ?? undefined;
}

function limitValue(limit: number | undefined): number {
  return typeof limit === "number" && Number.isInteger(limit) && limit >= 0 ? Math.min(limit, 500) : 100;
}

function connectorTrustRecordFromRow(row: DbConnectorTrustRecord): StoredConnectorTrustRecord {
  return {
    id: row.id,
    tenantId: optional(row.tenant_id),
    ownerKeyHash: row.owner_key_hash,
    connectorId: optional(row.connector_id),
    resourceSystem: optional(row.resource_system),
    agentId: row.agent_id,
    issuer: row.issuer,
    audience: row.audience,
    runtimeEndpoint: optional(row.runtime_endpoint),
    connectorProfileHash: optional(row.connector_profile_hash),
    externalConfigHash: optional(row.external_config_hash),
    trustedAt: iso(row.trusted_at),
    updatedAt: iso(row.updated_at),
    safeMetadata: recordFromJson(row.safe_metadata)
  };
}

function auditEventFromRow(row: DbAuditEvent): StoredAuditEvent {
  return {
    id: row.id,
    tenantId: optional(row.tenant_id),
    actorProvider: optional(row.actor_provider),
    actorSubject: optional(row.actor_subject),
    actorEmail: optional(row.actor_email),
    eventType: row.event_type,
    resourceType: optional(row.resource_type),
    resourceId: optional(row.resource_id),
    createdAt: iso(row.created_at),
    outcome: row.outcome ?? outcomeForEventType(row.event_type),
    severity: row.severity ?? severityForEventType(row.event_type),
    safeMetadata: recordFromJson(row.safe_metadata)
  };
}

function conversationStateFromRow(row: DbConversationState): StoredConversationStateRecord {
  return {
    id: row.id,
    tenantId: optional(row.tenant_id),
    actorProvider: optional(row.actor_provider),
    actorSubject: optional(row.actor_subject),
    actorEmail: optional(row.actor_email),
    ownerSessionHash: optional(row.owner_session_hash),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    lastResolutionStatus: optional(row.last_resolution_status),
    needsMoreInfoCount: row.needs_more_info_count,
    messages: arrayFromJson<StoredConversationMessage>(row.messages),
    pendingInteraction: row.pending_interaction ? recordFromJson(row.pending_interaction) as StoredPendingInteractionRecord : undefined,
    pendingFollowUp: row.pending_follow_up ? recordFromJson(row.pending_follow_up) : undefined,
    lastRequestInterpretation: row.last_request_interpretation ? recordFromJson(row.last_request_interpretation) : undefined,
    safeMetadata: recordFromJson(row.safe_metadata)
  };
}

function platformUserFromRow(row: DbPlatformUser): StoredPlatformUser {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    provider: optional(row.provider),
    issuer: optional(row.issuer),
    subject: optional(row.subject),
    email: row.email.toLowerCase(),
    displayName: optional(row.display_name),
    roles: arrayFromJson<string>(row.roles),
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

export class PostgresPlatformStateStore implements PlatformStateStore {
  private readonly pool: Pool;

  constructor(pool?: Pool) {
    if (pool) {
      this.pool = pool;
      return;
    }

    const config = postgresConfigFromEnv();
    if (config.driver !== "postgres" || !config.databaseUrl) {
      throw new Error("PostgresPlatformStateStore requires PLATFORM_STATE_STORE_DRIVER=postgres and DATABASE_URL.");
    }

    this.pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined
    });
  }

  async health(): Promise<PlatformStateStoreHealth> {
    await this.pool.query("select 1 as ok");
    return {
      driver: "postgres",
      ready: true,
      details: "Postgres platform state store is reachable."
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async listConnectorTrustRecords(ownerKey: string): Promise<StoredConnectorTrustRecord[]> {
    const ownerKeyHash = platformOwnerKeyHash(ownerKey);
    const result = await this.pool.query<DbConnectorTrustRecord>(
      `select id, tenant_id, owner_key_hash, connector_id, resource_system, agent_id, issuer, audience,
        runtime_endpoint, connector_profile_hash, external_config_hash, trusted_at, updated_at, safe_metadata
       from connector_trust_records
       where owner_key_hash = $1
       order by updated_at desc`,
      [ownerKeyHash]
    );
    return result.rows.map(connectorTrustRecordFromRow);
  }

  async upsertConnectorTrustRecord(record: StoredConnectorTrustRecord): Promise<void> {
    await this.pool.query(
      `insert into connector_trust_records (
        id, tenant_id, owner_key_hash, connector_id, resource_system, agent_id, issuer, audience,
        runtime_endpoint, connector_profile_hash, external_config_hash, trusted_at, updated_at, safe_metadata
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
      on conflict (id) do update set
        tenant_id = excluded.tenant_id,
        owner_key_hash = excluded.owner_key_hash,
        connector_id = excluded.connector_id,
        resource_system = excluded.resource_system,
        agent_id = excluded.agent_id,
        issuer = excluded.issuer,
        audience = excluded.audience,
        runtime_endpoint = excluded.runtime_endpoint,
        connector_profile_hash = excluded.connector_profile_hash,
        external_config_hash = excluded.external_config_hash,
        trusted_at = excluded.trusted_at,
        updated_at = excluded.updated_at,
        safe_metadata = excluded.safe_metadata`,
      [
        record.id,
        record.tenantId ?? null,
        record.ownerKeyHash,
        record.connectorId ?? null,
        record.resourceSystem ?? null,
        record.agentId,
        record.issuer,
        record.audience,
        record.runtimeEndpoint ?? null,
        record.connectorProfileHash ?? null,
        record.externalConfigHash ?? null,
        record.trustedAt,
        record.updatedAt,
        JSON.stringify(record.safeMetadata)
      ]
    );
  }

  async deleteConnectorTrustRecord(ownerKey: string, id: string): Promise<void> {
    const ownerKeyHash = platformOwnerKeyHash(ownerKey);
    await this.pool.query(
      "delete from connector_trust_records where owner_key_hash = $1 and id = $2",
      [ownerKeyHash, id]
    );
  }

  async appendAuditEvent(event: StoredAuditEvent): Promise<void> {
    const outcome = outcomeForEventType(event.eventType);
    const severity = severityForEventType(event.eventType);
    await this.pool.query(
      `insert into audit_events (
        id, tenant_id, actor_provider, actor_subject, actor_email, event_type,
        resource_type, resource_id, created_at, outcome, severity, safe_metadata
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
      [
        event.id,
        event.tenantId ?? null,
        event.actorProvider ?? null,
        event.actorSubject ?? null,
        event.actorEmail ?? null,
        event.eventType,
        event.resourceType ?? null,
        event.resourceId ?? null,
        event.createdAt,
        outcome,
        severity,
        JSON.stringify(event.safeMetadata)
      ]
    );
  }

  private async listAuditEventsInternal(params: StoredAuditEventClassificationListParams): Promise<StoredAuditEvent[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown): void => {
      values.push(value);
      where.push(sql.replace("?", `$${values.length}`));
    };
    if (params.tenantId) add("tenant_id = ?", params.tenantId);
    if (params.actorSubject) add("actor_subject = ?", params.actorSubject);
    if (params.eventType) add("event_type = ?", params.eventType);
    if (params.resourceType) add("resource_type = ?", params.resourceType);
    if (params.resourceId) add("resource_id = ?", params.resourceId);
    if (params.from) add("created_at >= ?", params.from);
    if (params.to) add("created_at <= ?", params.to);
    if (params.conversationId) add("safe_metadata ->> 'conversationId' = ?", params.conversationId);
    if (params.outcome) add("outcome = ?", params.outcome);
    if (params.severity) add("severity = ?", params.severity);
    if (params.snapshotCeiling) {
      values.push(params.snapshotCeiling.createdAt);
      const createdAtParameter = values.length;
      values.push(params.snapshotCeiling.id);
      const idParameter = values.length;
      where.push(`(created_at < $${createdAtParameter} or (created_at = $${createdAtParameter} and id <= $${idParameter}))`);
    }
    if (params.cursorAfter) {
      values.push(params.cursorAfter.createdAt);
      const createdAtParameter = values.length;
      values.push(params.cursorAfter.id);
      const idParameter = values.length;
      where.push(`(created_at < $${createdAtParameter} or (created_at = $${createdAtParameter} and id < $${idParameter}))`);
    }
    values.push(limitValue(params.limit));
    const limitParameter = values.length;

    const result = await this.pool.query<DbAuditEvent>(
      `select id, tenant_id, actor_provider, actor_subject, actor_email, event_type,
        resource_type, resource_id, created_at, outcome, severity, safe_metadata
       from audit_events
       ${where.length ? `where ${where.join(" and ")}` : ""}
       order by created_at desc, id desc
       limit $${limitParameter}`,
      values
    );
    return result.rows.map(auditEventFromRow);
  }

  async listAuditEvents(params: StoredAuditEventListParams): Promise<StoredAuditEvent[]> {
    return this.listAuditEventsInternal(params);
  }

  async listAuditEventsByClassification(params: StoredAuditEventClassificationListParams): Promise<StoredAuditEvent[]> {
    return this.listAuditEventsInternal(params);
  }

  async findUserByEmail(params: {
    tenantId: string;
    email: string;
  }): Promise<StoredPlatformUser | undefined> {
    const result = await this.pool.query<DbPlatformUser>(
      `select id, tenant_id, provider, issuer, subject, email, display_name, roles, status, created_at, updated_at
       from users
       where tenant_id = $1
         and lower(email) = lower($2)
       limit 1`,
      [params.tenantId, params.email]
    );
    return result.rows[0] ? platformUserFromRow(result.rows[0]) : undefined;
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
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<DbPlatformUser>(
        `select id, tenant_id, provider, issuer, subject, email, display_name, roles, status, created_at, updated_at
         from users
         where id = $1
         for update`,
        [params.userId]
      );
      const user = current.rows[0];
      if (!user) {
        throw new Error("User directory entry was not found.");
      }
      if (user.subject || user.provider || user.issuer) {
        if (user.provider !== params.provider || user.issuer !== (params.issuer ?? null) || user.subject !== params.subject) {
          throw new Error("User directory identity binding mismatch.");
        }
      }

      const updated = await client.query<DbPlatformUser>(
        `update users
         set provider = $2,
             issuer = coalesce($3, issuer),
             subject = $4,
             email = lower($5),
             display_name = coalesce($6, display_name),
             roles = coalesce($7::jsonb, roles),
             status = case when status = 'invited' then 'active' else status end,
             updated_at = now()
         where id = $1
         returning id, tenant_id, provider, issuer, subject, email, display_name, roles, status, created_at, updated_at`,
        [
          params.userId,
          params.provider,
          params.issuer ?? null,
          params.subject,
          params.email,
          params.displayName ?? null,
          params.roles ? JSON.stringify(params.roles) : null
        ]
      );
      await client.query("commit");
      return platformUserFromRow(updated.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertConversationState(record: StoredConversationStateRecord): Promise<void> {
    await this.pool.query(
      `insert into conversation_states (
        id, tenant_id, actor_provider, actor_subject, actor_email, owner_session_hash,
        created_at, updated_at, last_resolution_status, needs_more_info_count, messages,
        pending_interaction, pending_follow_up, last_request_interpretation, safe_metadata
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb)
      on conflict (id) do update set
        tenant_id = excluded.tenant_id,
        actor_provider = excluded.actor_provider,
        actor_subject = excluded.actor_subject,
        actor_email = excluded.actor_email,
        owner_session_hash = excluded.owner_session_hash,
        updated_at = excluded.updated_at,
        last_resolution_status = excluded.last_resolution_status,
        needs_more_info_count = excluded.needs_more_info_count,
        messages = excluded.messages,
        pending_interaction = excluded.pending_interaction,
        pending_follow_up = excluded.pending_follow_up,
        last_request_interpretation = excluded.last_request_interpretation,
        safe_metadata = excluded.safe_metadata`,
      [
        record.id,
        record.tenantId ?? null,
        record.actorProvider ?? null,
        record.actorSubject ?? null,
        record.actorEmail ?? null,
        record.ownerSessionHash ?? null,
        record.createdAt,
        record.updatedAt,
        record.lastResolutionStatus ?? null,
        record.needsMoreInfoCount,
        JSON.stringify(record.messages),
        record.pendingInteraction ? JSON.stringify(record.pendingInteraction) : null,
        record.pendingFollowUp ? JSON.stringify(record.pendingFollowUp) : null,
        record.lastRequestInterpretation ? JSON.stringify(record.lastRequestInterpretation) : null,
        JSON.stringify(record.safeMetadata)
      ]
    );
  }

  async getConversationState(id: string): Promise<StoredConversationStateRecord | undefined> {
    const result = await this.pool.query<DbConversationState>(
      `select id, tenant_id, actor_provider, actor_subject, actor_email, owner_session_hash,
        created_at, updated_at, last_resolution_status, needs_more_info_count, messages,
        pending_interaction, pending_follow_up, last_request_interpretation, safe_metadata
       from conversation_states
       where id = $1`,
      [id]
    );
    return result.rows[0] ? conversationStateFromRow(result.rows[0]) : undefined;
  }

  async listConversationStates(params: {
    actorSubject?: string;
    tenantId?: string;
    limit?: number;
  }): Promise<StoredConversationStateRecord[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown): void => {
      values.push(value);
      where.push(sql.replace("?", `$${values.length}`));
    };
    if (params.actorSubject) add("actor_subject = ?", params.actorSubject);
    if (params.tenantId) add("tenant_id = ?", params.tenantId);
    values.push(limitValue(params.limit));

    const result = await this.pool.query<DbConversationState>(
      `select id, tenant_id, actor_provider, actor_subject, actor_email, owner_session_hash,
        created_at, updated_at, last_resolution_status, needs_more_info_count, messages,
        pending_interaction, pending_follow_up, last_request_interpretation, safe_metadata
       from conversation_states
       ${where.length ? `where ${where.join(" and ")}` : ""}
       order by updated_at desc
       limit $${values.length}`,
      values
    );
    return result.rows.map(conversationStateFromRow);
  }
}
