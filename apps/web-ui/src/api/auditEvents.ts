import type { AuditViewerFilters } from "../components/types";

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
