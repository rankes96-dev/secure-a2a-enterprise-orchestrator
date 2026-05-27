import { createHash } from "node:crypto";
import type {
  AuditEventOutcome,
  AuditEventSeverity,
  AuditEventsResponse,
  AuditViewerEvent
} from "@a2a/shared";
import { securityEventFromAuditEvent } from "../securityEvents/securityEventPublisher.js";
import type { PlatformStateStore, StoredAuditEvent, StoredAuditEventPageBoundary } from "../state/platformStateStore.js";

export type AuditEventsPageQuery = {
  cursor?: string;
  limit: number;
  tenantIdHint?: string;
  eventType?: string;
  outcome?: AuditEventOutcome;
  severity?: AuditEventSeverity;
  from?: string;
  to?: string;
  conversationId?: string;
};

export type AuditViewerPageResult =
  | { ok: true; body: AuditEventsResponse }
  | { ok: false; status: 400 | 422; error: string; message: string; scanLimit?: number };

type AuditEventsCursorPayload = {
  v: 1;
  snapshot: StoredAuditEventPageBoundary;
  position: StoredAuditEventPageBoundary;
  filterHash: string;
};

const auditViewerSourceBatchLimit = 250;
export const auditViewerDerivedFilterScanLimit = 5_000;

const protectedSummaryMarkers = [
  "access_token",
  "refresh_token",
  "authorization",
  "bearer",
  "client_assertion",
  "private_key",
  "client_secret",
  "authorization_code",
  "cookie",
  "set-cookie",
  "jwt",
  "rawtoken",
  "raw token",
  "raw prompt"
];

function protectedSummaryText(value: string): boolean {
  const normalized = value.toLowerCase();
  return protectedSummaryMarkers.some((marker) => normalized.includes(marker));
}

function safeAuditSummaryString(value: unknown, maxLength = 180): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return undefined;
  }
  if (protectedSummaryText(trimmed)) {
    return "hidden";
  }
  return trimmed.replace(/[\r\n\t]+/g, " ").slice(0, maxLength);
}

function boundaryFromAuditEvent(event: StoredAuditEvent): StoredAuditEventPageBoundary {
  return {
    createdAt: event.createdAt,
    id: event.id
  };
}

function validBoundary(value: unknown): value is StoredAuditEventPageBoundary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : "";
  const id = typeof record.id === "string" ? record.id : "";
  return (
    Boolean(createdAt) &&
    !Number.isNaN(Date.parse(createdAt)) &&
    Boolean(id) &&
    id.length <= 160 &&
    /^[A-Za-z0-9._:@/-]+$/.test(id)
  );
}

function filterHash(tenantId: string, query: AuditEventsPageQuery): string {
  return createHash("sha256").update(JSON.stringify({
    tenantId,
    eventType: query.eventType ?? null,
    outcome: query.outcome ?? null,
    severity: query.severity ?? null,
    from: query.from ?? null,
    to: query.to ?? null,
    conversationId: query.conversationId ?? null
  })).digest("hex");
}

function encodeAuditEventsCursor(payload: AuditEventsCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeAuditEventsCursor(cursor: string): AuditEventsCursorPayload | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (
      record.v !== 1 ||
      !validBoundary(record.snapshot) ||
      !validBoundary(record.position) ||
      typeof record.filterHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.filterHash)
    ) {
      return undefined;
    }
    return {
      v: 1,
      snapshot: record.snapshot,
      position: record.position,
      filterHash: record.filterHash
    };
  } catch {
    return undefined;
  }
}

export function auditViewerEventFromStoredAuditEvent(event: StoredAuditEvent, tenantId: string): AuditViewerEvent {
  const securityEvent = securityEventFromAuditEvent(event);
  const metadata = event.safeMetadata;

  return {
    id: event.id,
    tenantId: event.tenantId ?? tenantId,
    createdAt: event.createdAt,
    eventType: event.eventType,
    severity: securityEvent.severity,
    outcome: securityEvent.outcome,
    actor: {
      provider: event.actorProvider,
      email: event.actorEmail
    },
    correlation: {
      conversationId: securityEvent.conversationId,
      requestId: securityEvent.requestId,
      taskId: securityEvent.taskId,
      connectorId: securityEvent.connectorId,
      runtimeExecutionId: securityEvent.runtimeExecutionId
    },
    summary: {
      route: safeAuditSummaryString(metadata.route, 120),
      method: safeAuditSummaryString(metadata.method, 12),
      capability: safeAuditSummaryString(metadata.capability, 100),
      reason: safeAuditSummaryString(metadata.reason, 180),
      resourceType: safeAuditSummaryString(event.resourceType, 80),
      resourceId: safeAuditSummaryString(event.resourceId, 180)
    },
    proof: {
      protectedMaterialExposed: false,
      tokenMaterialStored: false,
      rawPromptStored: false
    }
  };
}

function classificationMatches(event: AuditViewerEvent, query: AuditEventsPageQuery): boolean {
  if (query.outcome && event.outcome !== query.outcome) {
    return false;
  }
  if (query.severity && event.severity !== query.severity) {
    return false;
  }
  return true;
}

export async function listAuditViewerEventsPage(params: {
  store: PlatformStateStore;
  tenantId: string;
  query: AuditEventsPageQuery;
}): Promise<AuditViewerPageResult> {
  const { store, tenantId, query } = params;
  const currentFilterHash = filterHash(tenantId, query);
  const decodedCursor = query.cursor ? decodeAuditEventsCursor(query.cursor) : undefined;
  if (query.cursor && !decodedCursor) {
    return {
      ok: false,
      status: 400,
      error: "invalid_audit_events_cursor",
      message: "Invalid audit events cursor."
    };
  }
  if (decodedCursor && decodedCursor.filterHash !== currentFilterHash) {
    return {
      ok: false,
      status: 400,
      error: "audit_events_cursor_filter_mismatch",
      message: "Audit events cursor does not match the current tenant or filters."
    };
  }

  const needsClassificationFiltering = Boolean(query.outcome || query.severity);
  const scanLimit = needsClassificationFiltering ? auditViewerDerivedFilterScanLimit : query.limit + 1;
  const matches: Array<{ source: StoredAuditEvent; item: AuditViewerEvent }> = [];
  let snapshotCeiling = decodedCursor?.snapshot;
  let cursorAfter = decodedCursor?.position;
  let scannedSourceRows = 0;
  let sourceExhausted = false;

  while (matches.length < query.limit + 1) {
    const remainingScanBudget = scanLimit - scannedSourceRows;
    if (remainingScanBudget <= 0) {
      break;
    }

    const batchLimit = Math.min(auditViewerSourceBatchLimit, remainingScanBudget);
    const sourceEvents = await store.listAuditEvents({
      tenantId,
      eventType: query.eventType,
      from: query.from,
      to: query.to,
      conversationId: query.conversationId,
      limit: batchLimit,
      cursorAfter,
      snapshotCeiling
    });

    if (!snapshotCeiling && sourceEvents[0]) {
      snapshotCeiling = boundaryFromAuditEvent(sourceEvents[0]);
    }

    scannedSourceRows += sourceEvents.length;

    for (const source of sourceEvents) {
      const item = auditViewerEventFromStoredAuditEvent(source, tenantId);
      if (classificationMatches(item, query)) {
        matches.push({ source, item });
        if (matches.length >= query.limit + 1) {
          break;
        }
      }
    }

    if (sourceEvents.length === 0 || sourceEvents.length < batchLimit) {
      sourceExhausted = true;
      break;
    }

    cursorAfter = boundaryFromAuditEvent(sourceEvents[sourceEvents.length - 1]);
  }

  if (matches.length < query.limit + 1 && !sourceExhausted) {
    return {
      ok: false,
      status: 422,
      error: "audit_events_filter_scan_limit_exceeded",
      message: "Audit filters matched too sparsely to page safely within the bounded scan limit. Narrow the time window or event type and retry.",
      scanLimit
    };
  }

  const pageMatches = matches.slice(0, query.limit);
  const hasNext = matches.length > query.limit;
  const lastReturned = pageMatches[pageMatches.length - 1]?.source;

  return {
    ok: true,
    body: {
      tenantId,
      limit: query.limit,
      hasNext,
      nextCursor: hasNext && snapshotCeiling && lastReturned
        ? encodeAuditEventsCursor({
            v: 1,
            snapshot: snapshotCeiling,
            position: boundaryFromAuditEvent(lastReturned),
            filterHash: currentFilterHash
          })
        : undefined,
      filters: {
        eventType: query.eventType,
        outcome: query.outcome,
        severity: query.severity,
        from: query.from,
        to: query.to,
        conversationId: query.conversationId
      },
      items: pageMatches.map((match) => match.item),
      responseProof: {
        safeMetadataReturned: false,
        protectedMaterialExposed: false,
        tokenMaterialStored: false,
        rawPromptStored: false
      }
    }
  };
}
