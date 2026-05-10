// @ts-nocheck
import React from "react";

type ScreenContext = Record<string, any>;

export function SecurityTimelineTab({ ctx }: { ctx: ScreenContext }) {
  const {
    activeTab, setActiveTab, message, setMessage, messages, error, isLoading, health, healthError, isHealthLoading,
    zeroTrustAgentBaseUrl, setZeroTrustAgentBaseUrl, zeroTrustExpectedAgentId, setZeroTrustExpectedAgentId,
    setSupportedConnectorGuardrails, setZeroTrustOnboardedAgents, setZeroTrustDiscovery, setZeroTrustResult, setZeroTrustError, setZeroTrustCopyMessage,
    zeroTrustExpectedResourceSystem, setZeroTrustExpectedResourceSystem, zeroTrustExpectedConnectorId, setZeroTrustExpectedConnectorId,
    supportedConnectorGuardrails, zeroTrustOnboardedAgents, zeroTrustDiscovery, zeroTrustResult, zeroTrustError, zeroTrustCopyMessage,
    setGatewayRegistrationMetadata, setIsZeroTrustDiscovering, setIsZeroTrustOnboarding, setIdentitySession, setTrustStatus, setIdentityError, setIdentityMessage, setIsIdentityLoading,
    gatewayRegistrationMetadata, connectionAudience, setConnectionAudience, connectionWizardStep, setConnectionWizardStep,
    connectionWizardCollapsedAfterSuccess, setConnectionWizardCollapsedAfterSuccess, customConnectorContractOpen, setCustomConnectorContractOpen,
    expandedInstalledAgentIds, setExpandedInstalledAgentIds, selectedInstalledConnectorTemplateId, setSelectedInstalledConnectorTemplateId,
    isZeroTrustDiscovering, isZeroTrustOnboarding, identitySession, trustStatus, selectedDemoUserEmail, setSelectedDemoUserEmail,
    identityError, identityMessage, isIdentityLoading, securityTimelineFilter, setSecurityTimelineFilter, guidedStatus,
    demoGuideRootRef, runTaskRootRef, composerRef, taskTextareaRef, gatewayResponseRef, securitySummaryRef, trustIdentityRootRef,
    loginPanelRef, demoUserSelectRef, loginButtonRef, agentRegistryRootRef, connectorCatalogRef, zeroTrustOnboardingRef,
    registeredAgentsRef, legacyAgentsRef, securityTimelineRootRef, timelineListRef,
    latestResponse, securityTimelineEvents, visibleSecurityTimelineEvents, healthLabel, authModeLabel, userBadgeLabel,
    builtInAgentsCount, healthyAgentsCount, registeredAgentRows, latestActorAttached, latestActorTokenObserved, latestActorRoles,
    isUserAuthenticated, connectorTemplateCount, installedConnectorAgentCount, runtimeReadyConnectorAgentCount, latestRequest,
    executionState, authModeSummary, lastResult, policySummary, tokenSummary, delegationSummary, primarySelectedAgent, actorEmail,
    policyOutcome, tokenOutcome,
    guideToTarget, showGuidedStatus, goToTrustIdentity, goToRunTask, goToAgentRegistry, goToConnectorCatalog,
    goToInstalledConnectorAgents, goToSecurityTimeline, hasInstalledConnector, hasApprovedSkill, hasBlockedSkill, readinessStatusForSkill,
    checkAgentHealth, loadTrustStatus, loginDemoUser, logoutIdentity, applyLocalConnectorPreset, discoverZeroTrustAgent,
    copyGatewayRegistrationJson, startZeroTrustOnboarding, resolveIssue, submitIssue, startNewConversation, resetZeroTrustConnectionState,
    loadZeroTrustOnboardedAgents, loadSupportedConnectorGuardrails, loadGatewayRegistrationMetadata,
    renderPageHeader,
    localConnectorPresets, scenarios, quickScenarios, advancedScenarios, securityTimelineFilters, demoUserOptions,
    cockpitStatusClass, statusDisplayLabel, connectorRoutingStatusLabel, connectorRoutingStatusClass, connectorRuntimeFailureCopy,
    firstSentence, recommendedActionItems, shortHash, JsonBlock, MessageList, safeRawExecutionData, healthClass,
    endpointMetadata, endpointTypeLabel, routingDescription, securityDecisions, decisionClass, sampleMessage
  } = ctx;

  function renderSecurityTimelineTab() {
    const securityDecisionsCount = latestResponse?.securityDecisions?.length ?? (latestResponse?.securityDecision ? 1 : 0);
    const tokenIssuedCount = latestResponse?.a2aTasks?.filter((task) => task.context.auth?.tokenIssued).length ?? 0;
    const traceDelegationCount = latestResponse
      ? [...latestResponse.executionTrace, ...latestResponse.agentTrace].filter((entry) => entry.action.toLowerCase().includes("delegation")).length
      : 0;
    const delegatedTaskCount = latestResponse?.a2aTasks?.filter((task) => (task.delegationDepth ?? 0) > 0 || Boolean(task.mediatedBy)).length ?? 0;
    const delegationCount = Math.max(traceDelegationCount, delegatedTaskCount);

    return (
      <section className="control-panel security-timeline-panel scroll-target" aria-label="Security Timeline" ref={securityTimelineRootRef} tabIndex={-1}>
        {renderPageHeader({
          eyebrow: "Audit proof",
          title: "Security Timeline",
          subtitle: "Inspect the end-to-end trust, policy, token, and runtime events."
        })}
        {latestResponse ? (
          <>
            <section className="timeline-executive-summary scroll-target" tabIndex={-1}>
              <p className="active-panel-eyebrow">Timeline Summary</p>
              <div>
                <span className="status-success">Identity verified</span>
                <span className={`status-${cockpitStatusClass(policySummary)}`}>Policy checked</span>
                <span className={`status-${cockpitStatusClass(tokenSummary)}`}>Scoped token {tokenSummary}</span>
                <span className={latestResponse.a2aResponses?.length ? "status-success" : "status-neutral"}>Agent {latestResponse.a2aResponses?.length ? "executed" : "not executed"}</span>
                <span className="status-success">Raw token hidden</span>
              </div>
            </section>
            <div className="security-timeline-summary">
              <article>
                <span>User</span>
                <strong>{latestResponse.userIdentity.authenticated ? "authenticated" : "not authenticated"}</strong>
              </article>
              <article>
                <span>Selected agents</span>
                <strong>{latestResponse.selectedAgents.length}</strong>
              </article>
              <article>
                <span>Policy decisions</span>
                <strong>{securityDecisionsCount}</strong>
              </article>
              <article>
                <span>A2A tasks</span>
                <strong>{latestResponse.a2aTasks?.length ?? 0}</strong>
              </article>
              <article>
                <span>Token issued</span>
                <strong>{tokenIssuedCount}</strong>
              </article>
              <article>
                <span>Delegations</span>
                <strong>{delegationCount}</strong>
              </article>
            </div>

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
              {visibleSecurityTimelineEvents.length ? visibleSecurityTimelineEvents.map((event, index) => (
                <article className={`security-timeline-event status-${event.status} category-${event.category}`} key={event.id}>
                  <div className="timeline-event-marker">{String(index + 1).padStart(2, "0")}</div>
                  <div className="timeline-event-body">
                    <div className="timeline-event-header">
                      <span className={`timeline-category-badge category-${event.category}`}>{event.category}</span>
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
          <p className="muted-note scroll-target" ref={(element) => {
            timelineListRef.current = element;
          }} tabIndex={-1}>Run a task to generate a timeline of identity, routing, policy, token issuance, and agent execution.</p>
        )}
      </section>
    );
  }
  return renderSecurityTimelineTab();
}
