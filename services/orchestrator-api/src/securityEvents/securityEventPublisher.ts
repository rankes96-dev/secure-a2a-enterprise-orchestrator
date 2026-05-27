import type { StoredAuditEvent } from "../state/platformStateStore.js";
import { getSecurityEventSink } from "./createSecurityEventSink.js";
import { outcomeForEventType, severityForEventType } from "./securityEventClassification.js";
import type { SecurityEventEnvelope } from "./securityEventTypes.js";

export const securityEventSchemaVersion = "secure-a2a.security-event.v1";

function stringMetadataValue(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}

export function securityEventFromAuditEvent(event: StoredAuditEvent): SecurityEventEnvelope {
  const safeMetadata = { ...event.safeMetadata };

  return {
    schemaVersion: securityEventSchemaVersion,
    id: event.id,
    eventType: event.eventType,
    severity: event.severity ?? severityForEventType(event.eventType),
    outcome: event.outcome ?? outcomeForEventType(event.eventType),
    createdAt: event.createdAt,
    tenantId: event.tenantId,
    actorProvider: event.actorProvider,
    actorSubject: event.actorSubject,
    actorEmail: event.actorEmail,
    conversationId: stringMetadataValue(safeMetadata, "conversationId"),
    requestId: stringMetadataValue(safeMetadata, "requestId"),
    taskId: stringMetadataValue(safeMetadata, "taskId"),
    connectorId: stringMetadataValue(safeMetadata, "connectorId"),
    runtimeExecutionId: stringMetadataValue(safeMetadata, "runtimeExecutionId"),
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    safeMetadata
  };
}

export async function publishSecurityEventFromAuditEvent(event: StoredAuditEvent): Promise<void> {
  try {
    await getSecurityEventSink().publish(securityEventFromAuditEvent(event));
  } catch {
    console.warn(`[security-event] publish failed for eventType=${event.eventType}`);
  }
}
