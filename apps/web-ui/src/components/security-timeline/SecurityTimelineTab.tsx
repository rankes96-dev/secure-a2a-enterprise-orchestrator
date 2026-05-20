import React from "react";
import type { ResolveResponse } from "@a2a/shared";
import type { ExtractedScreenContext, SecurityTimelineEvent } from "../types";

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

function tokenIssued(response: ResolveResponse): string {
  if (response.connectorRuntime?.tokenMetadata?.tokenIssued) {
    return "Yes";
  }
  if (response.a2aTasks?.some((task) => task.context.auth?.tokenIssued)) {
    return "Yes";
  }
  return "No";
}

function runtimeExecuted(response: ResolveResponse): string {
  if (response.connectorRuntime) {
    return response.connectorRuntime.executed ? "Yes" : "No";
  }
  return response.a2aResponses?.length ? "Yes" : "No";
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

  function openConnectorTestCenter() {
    setActiveTab("connector-test-center");
    showGuidedStatus("Moved to Connector Test Center");
    guideToTarget("connector-test-center");
  }

  function renderProofSummary(response: ResolveResponse) {
    const actor = response.userIdentity.email ?? response.userIdentity.name ?? (response.userIdentity.authenticated ? "Authenticated user" : "Not authenticated");
    const actorRoles = response.userIdentity.roles?.join(", ") || "none";
    const actorRuntimeContext = response.connectorRuntime?.tokenMetadata?.actor ? "Included" : "Not included";
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
      { label: "Token issued", value: tokenIssued(response) },
      { label: "Runtime executed", value: runtimeExecuted(response) },
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
    </section>
  );
}
