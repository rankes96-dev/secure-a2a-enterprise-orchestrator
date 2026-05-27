import type { AuditEventsResponse } from "@a2a/shared";
import type { AuditViewerFilters } from "../components/types";
import { apiErrorMessage, readApiErrorPayload } from "./errors";

const auditEventsFailureFallback = "Failed to load persisted audit events";

export type AuditEventsLoadResult =
  | { kind: "loaded"; response: AuditEventsResponse }
  | { kind: "handled_protected_response" }
  | { kind: "scan_limit"; message: string; guidance: string[] };

const fallbackAuditEventsScanLimitGuidance = [
  "Narrow the time window with from/to.",
  "Add an event type or conversation filter when possible.",
  "Reduce the page limit for very sparse outcome or severity searches."
];

export function auditEventsQuery(filters: AuditViewerFilters, defaults: { limit: number }): URLSearchParams {
  const query = new URLSearchParams();
  query.set("limit", String(filters.limit ?? defaults.limit));
  if (filters.cursor) {
    query.set("cursor", filters.cursor);
  }
  for (const [key, value] of Object.entries({
    eventType: filters.eventType,
    outcome: filters.outcome,
    severity: filters.severity,
    from: filters.from,
    to: filters.to,
    conversationId: filters.conversationId
  })) {
    if (value?.trim()) {
      query.set(key, value.trim());
    }
  }
  return query;
}

export function fetchAuditEvents(apiUrl: string, filters: AuditViewerFilters, defaults: { limit: number }): Promise<Response> {
  const query = auditEventsQuery(filters, defaults);
  return fetch(`${apiUrl}/audit/events?${query.toString()}`, {
    method: "GET",
    credentials: "include"
  });
}

async function auditEventsFailure(response: Response): Promise<AuditEventsLoadResult> {
  const payload = await readApiErrorPayload(response);
  if (response.status === 422 && payload.body?.error === "audit_events_filter_scan_limit_exceeded") {
    const diagnostics = payload.body.diagnostics;
    const scannedRows = diagnostics?.scannedRows;
    const scanLimit = diagnostics?.scanLimit ?? payload.body.scanLimit;
    const matchedRows = diagnostics?.matchedRows;
    const scanSummary = typeof scannedRows === "number" && typeof scanLimit === "number" && typeof matchedRows === "number"
      ? ` Scanned ${scannedRows} of ${scanLimit} source rows and found ${matchedRows} matching events.`
      : "";
    return {
      kind: "scan_limit",
      message: `Audit query reached the bounded scan limit.${scanSummary}`,
      guidance: payload.body.guidance?.length ? payload.body.guidance : fallbackAuditEventsScanLimitGuidance
    };
  }
  throw new Error(apiErrorMessage(payload, response.status, auditEventsFailureFallback));
}

export async function loadPersistedAuditEvents(options: {
  apiUrl: string;
  filters: AuditViewerFilters;
  defaultLimit: number;
  ensureSession: () => Promise<void>;
  handleProtectedResponse: (response: Response, fallbackMessage: string) => Promise<boolean>;
}): Promise<AuditEventsLoadResult> {
  await options.ensureSession();
  const response = await fetchAuditEvents(options.apiUrl, options.filters, { limit: options.defaultLimit });
  if (response.status === 422) {
    return auditEventsFailure(response);
  }
  if (!await options.handleProtectedResponse(response, auditEventsFailureFallback)) {
    return { kind: "handled_protected_response" };
  }
  return { kind: "loaded", response: (await response.json()) as AuditEventsResponse };
}
