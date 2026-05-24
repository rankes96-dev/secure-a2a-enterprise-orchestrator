import { randomUUID } from "node:crypto";
import { publishSecurityEventFromAuditEvent } from "../securityEvents/securityEventPublisher.js";
import { getPlatformStateStore } from "../state/createPlatformStateStore.js";
import type { StoredAuditEvent } from "../state/platformStateStore.js";
import { defaultTenantId } from "../tenant/tenantContext.js";

export type PlatformAuditEventInput = {
  tenantId?: string;
  actorProvider?: string;
  actorSubject?: string;
  actorEmail?: string;
  eventType: string;
  resourceType?: string;
  resourceId?: string;
  safeMetadata?: Record<string, unknown>;
};

const maxDepth = 6;
const dangerousMarkers = [
  "access" + "_token",
  "refresh" + "_token",
  "authorization",
  "bearer",
  "client" + "_assertion",
  "private" + "_key",
  "client" + "_secret",
  "authorization" + "_code",
  "cookie",
  "set-cookie",
  "jwt",
  "rawtoken",
  "raw token"
];

// Metadata keys containing these markers are intentionally redacted. Audit
// proof metadata should use neutral names such as protectedMaterialExposed.
function dangerousText(value: string): boolean {
  const normalized = value.toLowerCase();
  return dangerousMarkers.some((marker) => normalized.includes(marker));
}

function sanitizeAuditMetadataValue(value: unknown, depth = 0): unknown {
  if (depth > maxDepth) {
    return "[depth-limited]";
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return dangerousText(value) ? "hidden" : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditMetadataValue(item, depth + 1));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        dangerousText(key) ? "hidden" : sanitizeAuditMetadataValue(item, depth + 1)
      ])
    );
  }

  return undefined;
}

export function sanitizeAuditMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return sanitizeAuditMetadataValue(metadata) as Record<string, unknown>;
}

export async function appendPlatformAuditEvent(input: PlatformAuditEventInput): Promise<void> {
  try {
    const event: StoredAuditEvent = {
      id: randomUUID(),
      tenantId: input.tenantId ?? defaultTenantId(),
      actorProvider: input.actorProvider,
      actorSubject: input.actorSubject,
      actorEmail: input.actorEmail,
      eventType: input.eventType,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      createdAt: new Date().toISOString(),
      safeMetadata: sanitizeAuditMetadata(input.safeMetadata)
    };
    await getPlatformStateStore().appendAuditEvent(event);
    await publishSecurityEventFromAuditEvent(event);
  } catch {
    console.warn(`[audit] append failed for eventType=${input.eventType}`);
  }
}
