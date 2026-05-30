import React, { useState } from "react";
import type { AuditViewerEvent, ResolveResponse } from "@a2a/shared";
import type { AuditViewerFilters, ExtractedScreenContext, SecurityTimelineEvent } from "../types";
import { connectorRuntimeExecutionTruthLabel, policyProofTruthLabel, selectedWorkloadTruthLabel, tokenProofTruthLabel } from "../RunTaskSummaryCards";

type ScreenContext = ExtractedScreenContext;

const timelineGroupLabels: Record<string, string> = {
  identity: "Identity",
  routing: "AI / interpretation",
  policy: "Gateway decision",
  token: "OAuth scope gate",
  agent: "Token / runtime",
  delegation: "Token / runtime",
  "response-audit": "Audit result"
};

function outcomeLabel(response: ResolveResponse): string {
  const gateLabels: Record<NonNullable<ResolveResponse["executionGateStack"]>["finalOutcome"], string> = {
    planned: "Planned",
    diagnosed: "Diagnosed",
    executed: "Executed",
    blocked_at_gateway: "Blocked",
    blocked_at_oauth_scope: "Blocked at OAuth scope gate",
    blocked_at_service_account_permission: "Blocked at service-account permission gate",
    runtime_failed: "Runtime failed",
    unsupported: "Unsupported",
    needs_more_info: "Needs more info"
  };
  return response.executionGateStack ? gateLabels[response.executionGateStack.finalOutcome] : response.resolutionStatus.replace(/_/g, " ");
}

function gateStoppedAt(response: ResolveResponse): string {
  const stoppedAt = response.executionGateStack?.stoppedAt;
  if (!stoppedAt) {
    return response.executionGateStack?.finalOutcome === "executed" || response.executionGateStack?.finalOutcome === "diagnosed"
      ? "Runtime execution"
      : "Not stopped";
  }
  return response.executionGateStack?.gates.find((gate) => gate.id === stoppedAt)?.label ?? stoppedAt.replace(/_/g, " ");
}

function targetConnectorSystem(response: ResolveResponse): string {
  const route = response.connectorRouting;
  if (!route) {
    return response.classification.system;
  }
  return [
    route.connectorId,
    route.targetSystem ?? route.resourceSystem
  ].filter(Boolean).join(" / ") || "No connector selected";
}

function groupedEvents(events: SecurityTimelineEvent[]): Array<{ label: string; events: SecurityTimelineEvent[] }> {
  const groups: Array<{ key: string; label: string; events: SecurityTimelineEvent[] }> = [
    { key: "identity", label: "Identity", events: [] },
    { key: "routing", label: "AI / interpretation", events: [] },
    { key: "policy", label: "Gateway decision", events: [] },
    { key: "token", label: "OAuth scope gate", events: [] },
    { key: "service-account", label: "Service-account permission gate", events: [] },
    { key: "runtime", label: "Token / runtime", events: [] },
    { key: "audit", label: "Audit result", events: [] }
  ];

  for (const event of events) {
    if (event.category === "identity") {
      groups[0].events.push(event);
    } else if (event.category === "routing") {
      groups[1].events.push(event);
    } else if (event.category === "policy") {
      groups[2].events.push(event);
    } else if (event.category === "token") {
      groups[3].events.push(event);
    } else if (event.category === "agent" || event.category === "delegation") {
      groups[5].events.push(event);
    } else {
      groups[6].events.push(event);
    }
  }

  return groups.filter((group) => group.events.length > 0);
}

export function SecurityTimelineTab({ ctx }: { ctx: ScreenContext }) {
  const {
    latestResponse,
    securityTimelineFilter,
    setSecurityTimelineFilter,
    visibleSecurityTimelineEvents,
    securityTimelineFilters,
    auditEventsResponse,
    auditEventsError,
    auditEventsGuidance,
    isAuditEventsLoading,
    loadAuditEvents,
    securityTimelineRootRef,
    timelineListRef,
    renderPageHeader,
    goToRunTask,
    setActiveTab,
    showGuidedStatus,
    guideToTarget,
    JsonBlock,
    safeRawExecutionData
  } = ctx;
  const [auditFilters, setAuditFilters] = useState<AuditViewerFilters>({
    limit: auditEventsResponse?.limit ?? 25,
    eventType: auditEventsResponse?.filters.eventType ?? "",
    outcome: auditEventsResponse?.filters.outcome ?? "",
    severity: auditEventsResponse?.filters.severity ?? "",
    from: auditEventsResponse?.filters.from ?? "",
    to: auditEventsResponse?.filters.to ?? "",
    conversationId: auditEventsResponse?.filters.conversationId ?? ""
  });
  const [auditCursorHistory, setAuditCursorHistory] = useState<string[]>([]);

  function openConnectorTestCenter() {
    setActiveTab("connector-test-center");
    showGuidedStatus("Moved to Connector Test Center");
    guideToTarget("connector-test-center");
  }

  function auditEventSummary(event: AuditViewerEvent): string {
    const route = [
      event.summary.method,
      event.summary.route
    ].filter(Boolean).join(" ");
    return [
      route,
      event.summary.capability ? `Capability ${event.summary.capability}` : undefined,
      event.summary.reason ? `Reason ${event.summary.reason}` : undefined
    ].filter(Boolean).join(" / ") || event.summary.resourceType || "Audit event";
  }

  function auditActor(event: AuditViewerEvent): string {
    return event.actor.email ?? event.actor.provider ?? "System";
  }

  function setAuditFilterValue(key: Exclude<keyof AuditViewerFilters, "cursor" | "limit">, value: string) {
    setAuditCursorHistory([]);
    setAuditFilters((current) => ({
      ...current,
      [key]: value
    }));
  }

  function submitAuditFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuditCursorHistory([]);
    const nextFilters = { ...auditFilters, cursor: undefined };
    setAuditFilters(nextFilters);
    void loadAuditEvents(nextFilters);
  }

  function resetAuditFilters() {
    setAuditCursorHistory([]);
    const nextFilters: AuditViewerFilters = { limit: auditFilters.limit ?? 25 };
    setAuditFilters(nextFilters);
    void loadAuditEvents(nextFilters);
  }

  function refreshAuditPage() {
    const cursor = auditCursorHistory[auditCursorHistory.length - 1];
    void loadAuditEvents({ ...auditFilters, cursor });
  }

  function loadNextAuditPage() {
    const nextCursor = auditEventsResponse?.nextCursor;
    if (!nextCursor) {
      return;
    }
    setAuditCursorHistory((current) => [...current, nextCursor]);
    void loadAuditEvents({ ...auditFilters, cursor: nextCursor });
  }

  function loadPreviousAuditPage() {
    const nextHistory = auditCursorHistory.slice(0, -1);
    const cursor = nextHistory[nextHistory.length - 1];
    setAuditCursorHistory(nextHistory);
    void loadAuditEvents({ ...auditFilters, cursor });
  }

  function renderPersistedAuditViewer() {
    const page = auditCursorHistory.length + 1;
    const limit = auditEventsResponse?.limit ?? auditFilters.limit ?? 25;
    const hasPreviousPage = auditCursorHistory.length > 0;
    const hasNextPage = Boolean(auditEventsResponse?.hasNext && auditEventsResponse.nextCursor);

    return (
      <section className="persisted-audit-viewer" aria-label="Persisted audit viewer">
        <div className="section-heading-row">
          <div>
            <p className="active-panel-eyebrow">Persisted audit viewer</p>
            <h2>Tenant audit events</h2>
          </div>
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={refreshAuditPage}
            disabled={isAuditEventsLoading}
          >
            {isAuditEventsLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <form className="audit-filter-grid" onSubmit={submitAuditFilters}>
          <label>
            <span>Event type</span>
            <input
              value={auditFilters.eventType ?? ""}
              onChange={(event) => setAuditFilterValue("eventType", event.target.value)}
              placeholder="tenant.access.denied"
            />
          </label>
          <label>
            <span>Outcome</span>
            <select value={auditFilters.outcome ?? ""} onChange={(event) => setAuditFilterValue("outcome", event.target.value)}>
              <option value="">Any</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="blocked">Blocked</option>
              <option value="needs_action">Needs action</option>
            </select>
          </label>
          <label>
            <span>Severity</span>
            <select value={auditFilters.severity ?? ""} onChange={(event) => setAuditFilterValue("severity", event.target.value)}>
              <option value="">Any</option>
              <option value="info">Info</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label>
            <span>From</span>
            <input
              type="datetime-local"
              value={auditFilters.from ?? ""}
              onChange={(event) => setAuditFilterValue("from", event.target.value)}
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="datetime-local"
              value={auditFilters.to ?? ""}
              onChange={(event) => setAuditFilterValue("to", event.target.value)}
            />
          </label>
          <label>
            <span>Conversation</span>
            <input
              value={auditFilters.conversationId ?? ""}
              onChange={(event) => setAuditFilterValue("conversationId", event.target.value)}
              placeholder="conversation id"
            />
          </label>
          <label>
            <span>Limit</span>
            <select
              value={String(limit)}
              onChange={(event) => {
                setAuditCursorHistory([]);
                setAuditFilters((current) => ({
                  ...current,
                  limit: Number(event.target.value),
                  cursor: undefined
                }));
              }}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
          <div className="audit-filter-actions">
            <button type="submit" className="scenario-run" disabled={isAuditEventsLoading}>
              Apply
            </button>
            <button type="button" className="secondary-inline-button" onClick={resetAuditFilters} disabled={isAuditEventsLoading}>
              Reset
            </button>
          </div>
        </form>

        {auditEventsError ? (
          <div className="inline-error audit-scan-limit-guidance">
            <p>{auditEventsError}</p>
            {auditEventsGuidance.length ? (
              <ul>
                {auditEventsGuidance.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="audit-viewer-table-wrap">
          <table className="audit-viewer-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Event</th>
                <th>Outcome</th>
                <th>Severity</th>
                <th>Actor</th>
                <th>Tenant</th>
                <th>Route / capability</th>
              </tr>
            </thead>
            <tbody>
              {auditEventsResponse?.items.length ? auditEventsResponse.items.map((event) => (
                <tr key={event.id}>
                  <td><time>{new Date(event.createdAt).toLocaleString()}</time></td>
                  <td>
                    <strong>{event.eventType}</strong>
                    {event.correlation.conversationId ? <span>{event.correlation.conversationId}</span> : null}
                  </td>
                  <td><span className={`audit-status-badge status-${event.outcome}`}>{event.outcome.replace(/_/g, " ")}</span></td>
                  <td><span className={`audit-severity-badge severity-${event.severity}`}>{event.severity}</span></td>
                  <td>{auditActor(event)}</td>
                  <td>{event.tenantId}</td>
                  <td>{auditEventSummary(event)}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7}>{isAuditEventsLoading ? "Loading persisted audit events..." : "No persisted events match the current filters."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="audit-pagination-row">
          <span>Page {page}</span>
          <div>
            <button
              type="button"
              className="secondary-inline-button"
              onClick={loadPreviousAuditPage}
              disabled={!hasPreviousPage || isAuditEventsLoading}
            >
              Previous
            </button>
            <button
              type="button"
              className="secondary-inline-button"
              onClick={loadNextAuditPage}
              disabled={!hasNextPage || isAuditEventsLoading}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    );
  }

  function renderProofSummary(response: ResolveResponse) {
    const actor = response.userIdentity.email ?? response.userIdentity.name ?? (response.userIdentity.authenticated ? "Authenticated user" : "Not authenticated");
    const actorRoles = response.userIdentity.roles?.join(", ") || "none";
    const actorRuntimeContext = response.connectorRuntime?.tokenMetadata?.actor ||
      response.connectorRuntime?.tokenMetadata?.actorRoles?.length ||
      response.connectorRuntime?.tokenMetadata?.actorProvider ||
      response.connectorRuntime?.tokenMetadata?.actorIssuer ||
      response.connectorRuntime?.tokenMetadata?.actorSubject
      ? "Included"
      : "Not included";
    const securityIntent = response.securityIntent?.detected
      ? `${response.securityIntent.category ?? "detected"}`
      : "No";
    const fields = [
      { label: "Actor", value: actor },
      { label: "Identity provider", value: response.userIdentity.provider ?? "unknown" },
      { label: "Actor roles", value: actorRoles },
      { label: "Runtime actor context", value: actorRuntimeContext },
      { label: "Outcome", value: outcomeLabel(response) },
      { label: "Target connector / system", value: targetConnectorSystem(response) },
      { label: "Gate stopped at", value: gateStoppedAt(response) },
      { label: "Policy proof", value: policyProofTruthLabel(response) },
      { label: "Token proof", value: tokenProofTruthLabel(response) },
      { label: "Connector runtime execution", value: connectorRuntimeExecutionTruthLabel(response) },
      { label: "Route / task activity", value: selectedWorkloadTruthLabel(response) },
      { label: "Raw tokens exposed", value: "No" },
      { label: "Security intent detected", value: securityIntent }
    ];

    return (
      <section className="security-proof-summary" aria-label="Security proof summary">
        <div className="section-heading-row">
          <div>
            <p className="active-panel-eyebrow">Security proof summary</p>
            <h2>What happened and why</h2>
          </div>
        </div>
        <div className="security-proof-grid">
          {fields.map((field) => (
            <article key={field.label}>
              <span>{field.label}</span>
              <strong>{field.value}</strong>
            </article>
          ))}
        </div>
      </section>
    );
  }

  function renderEvent(event: SecurityTimelineEvent, index: number) {
    const groupLabel = timelineGroupLabels[event.category] ?? "Audit result";
    return (
      <article className={`security-timeline-event status-${event.status} category-${event.category}`} key={event.id}>
        <div className="timeline-event-marker">{String(index + 1).padStart(2, "0")}</div>
        <div className="timeline-event-body">
          <div className="timeline-event-header">
            <span className={`timeline-category-badge category-${event.category}`}>{groupLabel}</span>
            <span className={`timeline-status-badge status-${event.status}`}>{event.status}</span>
            {event.timestamp ? <time>{new Date(event.timestamp).toLocaleTimeString()}</time> : null}
          </div>
          <h3>{event.title}</h3>
          <p>{event.description}</p>
          {event.actor || event.agentId ? (
            <div className="timeline-event-context">
              {event.actor ? <span>Actor: {event.actor}</span> : null}
              {event.agentId ? <span>Agent: {event.agentId}</span> : null}
            </div>
          ) : null}
          {event.metadata?.length ? (
            <dl className="timeline-metadata-grid">
              {event.metadata.map((item) => (
                <div key={`${event.id}-${item.label}`}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <section className="control-panel security-timeline-panel scroll-target" aria-label="Security Timeline" ref={securityTimelineRootRef} tabIndex={-1}>
      {renderPageHeader({
        eyebrow: "Audit proof",
        title: "Security Timeline",
        subtitle: "Inspect identity, Gateway decision, token, runtime, and audit proof."
      })}
      {latestResponse ? (
        <>
          {renderProofSummary(latestResponse)}

          <div className="timeline-filter-bar" aria-label="Timeline filters">
            {securityTimelineFilters.map((filter) => (
              <button
                type="button"
                key={filter.id}
                className={securityTimelineFilter === filter.id ? "active" : ""}
                onClick={() => setSecurityTimelineFilter(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="visual-security-timeline scroll-target" ref={(element) => {
            timelineListRef.current = element;
          }} tabIndex={-1}>
            {visibleSecurityTimelineEvents.length ? groupedEvents(visibleSecurityTimelineEvents).map((group) => (
              <section className="timeline-event-group" key={group.label} aria-label={group.label}>
                <h2>{group.label}</h2>
                {group.events.map((event, index) => renderEvent(event, index))}
              </section>
            )) : (
              <p className="muted-note">No events match this filter.</p>
            )}
          </div>

          <details className="raw-execution-data">
            <summary>Technical trace (sanitized)</summary>
            <JsonBlock value={safeRawExecutionData(latestResponse)} />
          </details>
        </>
      ) : (
        <section className="security-timeline-empty scroll-target" ref={(element) => {
          timelineListRef.current = element;
        }} tabIndex={-1}>
          <h2>Run a task to populate security proof.</h2>
          <p>Use Run Task or Connector Test Center, then return here to review the Gateway decision.</p>
          <div className="next-step-actions">
            <button type="button" className="scenario-run" onClick={goToRunTask}>Open Run Task</button>
            <button type="button" className="secondary-inline-button" onClick={openConnectorTestCenter}>Open Connector Test Center</button>
          </div>
        </section>
      )}
      {renderPersistedAuditViewer()}
    </section>
  );
}
