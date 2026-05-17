import React from "react";
import type { ExtractedScreenContext, Scenario } from "../types";

type ScreenContext = ExtractedScreenContext;

export function TrustIdentityTab({ ctx }: { ctx: ScreenContext }) {
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

  function renderTrustIdentityTab() {
    const currentUser = trustStatus?.userIdentity.user ?? identitySession?.user;
    const currentIdentity = trustStatus?.userIdentity ?? identitySession;
    const gatewayIdentity = trustStatus?.gatewayIdentity;
    const mockIdp = trustStatus?.mockIdp;
    const securityControls = trustStatus?.securityControls;
    const isTrustAuthenticated = currentIdentity?.authenticated === true;
    const flowSteps = [
      "User JWT verified",
      "Session identity stored",
      "Gateway selects Agent Card",
      "Policy evaluates scope/risk",
      "Scoped A2A JWT issued",
      "Agent validates JWT",
      "Audit/trace records actor context"
    ];

    return (
      <section className="control-panel trust-identity-panel scroll-target" aria-label="Trust and Identity" ref={trustIdentityRootRef} tabIndex={-1}>
        {renderPageHeader({
          eyebrow: "Identity control",
          title: "Trust & Identity",
          subtitle: "Authenticate a demo user and verify Gateway identity context.",
          action: <button type="button" className="secondary-button" onClick={() => {
              void checkAgentHealth();
              void loadTrustStatus();
            }} disabled={isHealthLoading || isIdentityLoading}>
              {isHealthLoading || isIdentityLoading ? "Refreshing..." : "Refresh"}
            </button>
        })}

        <section className={`trust-login-hero ${isTrustAuthenticated ? "authenticated" : "locked"} scroll-target`} ref={loginPanelRef} tabIndex={-1}>
          <div className="trust-login-copy">
            <p className="active-panel-eyebrow">Identity status</p>
            <h2>{isTrustAuthenticated ? "Execution unlocked" : "Login required to unlock execution"}</h2>
            <p>{isTrustAuthenticated ? "Verified user identity is attached to this gateway session." : "Secure task execution is blocked until a verified user identity is attached to this gateway session."}</p>
          </div>
          {!isTrustAuthenticated ? (
            <div className="trust-login-form">
              <label>
                <span>Demo user</span>
                <select ref={demoUserSelectRef} value={selectedDemoUserEmail} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setSelectedDemoUserEmail(event.target.value)} disabled={isIdentityLoading}>
                  {demoUserOptions.map((user) => (
                    <option value={user.email} key={user.email}>{user.label} / {user.roleLabel}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="trust-login-primary" ref={loginButtonRef} onClick={() => void loginDemoUser()} disabled={isIdentityLoading}>
                {isIdentityLoading ? "Verifying..." : "Login as demo user"}
              </button>
              <p>The gateway requests a signed Mock IdP User JWT, validates it via JWKS, and stores only verified claims. Raw JWTs are never shown in the UI.</p>
            </div>
          ) : (
            <div className="trust-authenticated-summary">
              <div className="trust-user-facts">
                <article>
                  <span>Email</span>
                  <strong>{currentUser?.email ?? "unknown"}</strong>
                </article>
                <article>
                  <span>Name</span>
                  <strong>{currentUser?.name ?? "unknown"}</strong>
                </article>
                <article>
                  <span>Roles</span>
                  <strong>{currentUser?.roles.join(", ") ?? "none"}</strong>
                </article>
                <article>
                  <span>Issuer</span>
                  <strong>{currentIdentity?.issuer ?? "unknown"}</strong>
                </article>
                <article>
                  <span>Audience</span>
                  <strong>{currentIdentity?.audience ?? "secure-a2a-gateway"}</strong>
                </article>
                <article>
                  <span>Raw JWT</span>
                  <strong>hidden</strong>
                </article>
              </div>
              <div className="trust-hero-actions">
                <button type="button" className="secondary-button" onClick={() => void logoutIdentity()} disabled={isIdentityLoading}>
                  Logout
                </button>
                <button type="button" className="trust-login-primary" onClick={goToRunTask}>
                  Open Run Task
                </button>
              </div>
            </div>
          )}
          {identityError ? <p className="error" role="alert">{identityError}</p> : null}
          {identityMessage ? <p className="success-note" role="status">{identityMessage}</p> : null}
        </section>

        <section className="trust-console-section">
          <p className="active-panel-eyebrow">Identity details</p>
          <h2>Key Identity Facts</h2>
          {!isTrustAuthenticated ? <p className="muted-note">Login as a demo user to attach verified user identity to gateway execution.</p> : null}
          <div className="trust-card-grid">
            <article>
              <span>Authentication status</span>
              <strong>{isTrustAuthenticated ? "authenticated" : "not authenticated"}</strong>
            </article>
            <article>
              <span>User email</span>
              <strong>{currentUser?.email ?? "none"}</strong>
            </article>
            <article>
              <span>Name</span>
              <strong>{currentUser?.name ?? "none"}</strong>
            </article>
            <article>
              <span>Roles</span>
              <strong>{currentUser?.roles.join(", ") ?? "none"}</strong>
            </article>
            <article>
              <span>User issuer</span>
              <strong>{currentIdentity?.issuer ?? "unknown"}</strong>
            </article>
            <article>
              <span>User audience</span>
              <strong>{currentIdentity?.audience ?? "secure-a2a-gateway"}</strong>
            </article>
            <article>
              <span>Raw user JWT</span>
              <strong>hidden</strong>
            </article>
          </div>
        </section>

        <details className="trust-console-section trust-details-section" open={isTrustAuthenticated}>
          <summary>
            <span className="active-panel-eyebrow">Gateway-to-agent trust</span>
            <strong>A2A Service Trust</strong>
          </summary>
          <div className="trust-card-grid">
            <article>
              <span>Gateway agent identity</span>
              <strong>{gatewayIdentity?.agentId ?? "unknown"}</strong>
            </article>
            <article>
              <span>A2A auth mode</span>
              <strong>{gatewayIdentity?.a2aAuthMode ?? health?.orchestrator.authMode ?? "unknown"}</strong>
            </article>
            <article>
              <span>Token auth method</span>
              <strong>{gatewayIdentity?.tokenAuthMethod ?? "unknown"}</strong>
            </article>
            <article>
              <span>secureAuthRequired</span>
              <strong>{typeof gatewayIdentity?.secureAuthRequired === "boolean" ? String(gatewayIdentity.secureAuthRequired) : typeof health?.orchestrator.secureAuthRequired === "boolean" ? String(health.orchestrator.secureAuthRequired) : "unknown"}</strong>
            </article>
            <article>
              <span>Actor propagation</span>
              <strong>{gatewayIdentity?.actorPropagationEnabled ? "enabled" : "unknown"}</strong>
            </article>
            <article>
              <span>Raw A2A tokens</span>
              <strong>hidden</strong>
            </article>
          </div>
        </details>

        <section className="trust-console-section">
          <p className="active-panel-eyebrow">D. Security Controls</p>
          <h2>Control Boundaries</h2>
          <div className="security-badge-grid">
            <span className="security-badge">Raw tokens displayed: {String(securityControls?.rawTokensDisplayed ?? false)}</span>
            <span className="security-badge">External URL fetching: {String(securityControls?.agentOnboardingFetchesExternalUrls ?? false)}</span>
            <span className="security-badge">External agents executable: {String(securityControls?.externalAgentsExecutable ?? false)}</span>
            <span className="security-badge positive">Agent Card secrets rejected: {String(securityControls?.agentCardSecretsRejected ?? true)}</span>
            <span className="security-badge positive">User identity required for execution: {String(securityControls?.userIdentityRequiredForResolve ?? true)}</span>
            <span className="security-badge">Replay protection: {securityControls?.privateKeyJwtReplayProtection ?? "unknown"}</span>
            <span className="security-badge">IP allowlist: {securityControls?.ipAllowlist ?? "unknown"}</span>
          </div>
        </section>

        <details className="trust-console-section trust-details-section advanced-trust-details" open={isTrustAuthenticated}>
          <summary>
            <span className="active-panel-eyebrow">Advanced technical details</span>
            <strong>Mock IdP / JWKS and trust flow</strong>
          </summary>
          <div className="advanced-trust-grid">
            <section>
              <h2>Mock IdP / JWKS</h2>
              <div className="trust-card-grid">
                <article>
                  <span>Issuer</span>
                  <strong>{mockIdp?.issuer ?? "unknown"}</strong>
                </article>
                <article>
                  <span>JWKS URI</span>
                  <strong>{mockIdp?.jwksUri ?? "unknown"}</strong>
                </article>
                <article>
                  <span>Token endpoint</span>
                  <strong>{mockIdp?.tokenEndpoint ?? "/oauth/token"}</strong>
                </article>
                <article>
                  <span>User token endpoint</span>
                  <strong>{mockIdp?.userTokenEndpoint ?? "/demo/user-token"}</strong>
                </article>
                <article>
                  <span>Raw signing keys</span>
                  <strong>{mockIdp?.rawKeysExposed ? "exposed" : "hidden"}</strong>
                </article>
              </div>
            </section>
            <section>
              <h2>Advanced trust flow</h2>
              <div className="trust-flow-row" aria-label="Trust flow">
                {flowSteps.map((step, index) => (
                  <React.Fragment key={step}>
                    <span>{step}</span>
                    {index < flowSteps.length - 1 ? <b aria-hidden="true">-&gt;</b> : null}
                  </React.Fragment>
                ))}
              </div>
            </section>
          </div>
        </details>
        {healthError ? <p className="error">{healthError}</p> : null}
      </section>
    );
  }
  return renderTrustIdentityTab();
}
