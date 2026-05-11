import React from "react";
import type { AgentRegistryContext, ConnectorAction, ConnectorTemplate, ConnectionWizardStep, LocalConnectorPreset, OnboardingCheck, RegisteredAgentRow, TrustedOnboardedAgent } from "./types";

export function AgentRegistryTab({ ctx }: { ctx: AgentRegistryContext }) {
  const {
    isLoading,
    health,
    healthError,
    isHealthLoading,
    zeroTrustAgentBaseUrl,
    setZeroTrustAgentBaseUrl,
    zeroTrustExpectedAgentId,
    setZeroTrustExpectedAgentId,
    setActiveTab,
    setZeroTrustDiscovery,
    setZeroTrustResult,
    setZeroTrustCopyMessage,
    zeroTrustExpectedResourceSystem,
    setZeroTrustExpectedResourceSystem,
    zeroTrustExpectedConnectorId,
    setZeroTrustExpectedConnectorId,
    supportedConnectorGuardrails,
    zeroTrustOnboardedAgents,
    zeroTrustDiscovery,
    zeroTrustResult,
    zeroTrustError,
    setZeroTrustError,
    zeroTrustCopyMessage,
    gatewayRegistrationMetadata,
    connectionAudience,
    setConnectionAudience,
    connectionWizardStep,
    setConnectionWizardStep,
    connectionWizardCollapsedAfterSuccess,
    setConnectionWizardCollapsedAfterSuccess,
    customConnectorContractOpen,
    setCustomConnectorContractOpen,
    expandedInstalledAgentIds,
    setExpandedInstalledAgentIds,
    selectedInstalledConnectorTemplateId,
    setSelectedInstalledConnectorTemplateId,
    isZeroTrustDiscovering,
    isZeroTrustOnboarding,
    agentRegistryRootRef,
    connectorCatalogRef,
    zeroTrustOnboardingRef,
    registeredAgentsRef,
    legacyAgentsRef,
    registeredAgentRows,
    localConnectorPresets,
    builtInAgentsCount,
    healthyAgentsCount,
    applyLocalConnectorPreset,
    discoverZeroTrustAgent,
    copyGatewayRegistrationJson,
    startZeroTrustOnboarding,
    loadZeroTrustOnboardedAgents,
    loadSupportedConnectorGuardrails,
    resetZeroTrustConnectionState,
    renderPageHeader,
    guideToTarget,
    goToConnectorCatalog,
    showGuidedStatus,
    setMessage,
    resolveIssue,
    statusDisplayLabel,
    shortHash,
    JsonBlock,
    checkAgentHealth,
    healthClass,
    endpointTypeLabel
  } = ctx;

  function renderZeroTrustOnboardingPanel() {
    const approvedActions = zeroTrustResult?.skillDecision?.approvedActions ?? zeroTrustResult?.capabilityDecision.approvedCapabilities ?? [];
    const blockedActions = zeroTrustResult?.skillDecision?.blockedActions ?? zeroTrustResult?.capabilityDecision.blockedCapabilities ?? [];
    const wizardSteps: Array<{ id: ConnectionWizardStep; label: string }> = [
      { id: "overview", label: "Overview" },
      { id: "gateway-registration", label: "Register Gateway" },
      { id: "connection-input", label: "Enter Agent URL" },
      { id: "discovery", label: "Discover Agent" },
      { id: "verify", label: "Verify Connection" },
      { id: "result", label: "Review Result" }
    ];
    const gatewayMetadata = zeroTrustDiscovery?.gatewayRegistration ?? gatewayRegistrationMetadata ?? {
      gatewayId: "secure-a2a-gateway",
      clientId: "secure-a2a-gateway-client",
      issuer: "http://localhost:4000",
      jwksUri: "http://localhost:4000/.well-known/jwks.json",
      supportedOnboardingMethods: ["signed_gateway_challenge", "private_key_jwt"]
    };
    const gatewayRegistration = {
      gatewayId: gatewayMetadata.gatewayId,
      clientId: gatewayMetadata.clientId,
      issuer: gatewayMetadata.issuer,
      jwksUri: gatewayMetadata.jwksUri,
      onboardingMethod: gatewayMetadata.supportedOnboardingMethods[0] ?? "signed_gateway_challenge"
    };
    const discoveryCheckStatus = (name: string) => zeroTrustDiscovery?.checks.find((check) => check.name === name)?.status;
    const resultCheckStatus = (name: string) => zeroTrustResult?.checks.find((check) => check.name === name)?.status;
    const checkStatus = (name: string) => resultCheckStatus(name) ?? discoveryCheckStatus(name);
    const activeStepIndex = wizardSteps.findIndex((step) => step.id === connectionWizardStep);
    const adminConsoleUrl = zeroTrustDiscovery?.discovery.adminConsoleUrl ?? "http://localhost:4201/admin";
    const availableConnectorTemplates = supportedConnectorGuardrails.filter((connector) => connector.status === "available");
    const resourceSystemOptions = [...new Map<string, ConnectorTemplate>(availableConnectorTemplates.map((connector) => [connector.resourceSystem, connector])).values()];
    const currentStepIndex = activeStepIndex >= 0 ? activeStepIndex : 0;
    const wizardStatus = (step: ConnectionWizardStep, index: number): "waiting" | "active" | "completed" | "failed" => {
      if (zeroTrustError && step === connectionWizardStep && (step === "discovery" || step === "verify")) {
        return "failed";
      }
      if (step === connectionWizardStep) {
        return "active";
      }
      if (zeroTrustResult && index < wizardSteps.length - 1) {
        return "completed";
      }
      if (zeroTrustDiscovery && (step === "overview" || step === "gateway-registration" || step === "connection-input" || step === "discovery") && index < currentStepIndex) {
        return "completed";
      }
      if (index < currentStepIndex) {
        return "completed";
      }
      return "waiting";
    };
    const progressSteps = [
      ["Signed Gateway challenge created", "Create a signed Gateway assertion for the expected external agent.", "gateway_identity_verified"],
      ["External agent contacted", "Send the signed challenge to the discovered onboarding endpoint.", "external_agent_contacted"],
      ["Signed agent response verified", "Verify the external agent trust response with its JWKS.", "signed_agent_response_verified"],
      ["OAuth application binding checked", "Match client, issuer, audience, and token auth method.", "oauth_application_bound"],
      ["Resource permissions loaded", "Load effective and denied permissions for the app principal.", "resource_permissions_loaded"],
      ["Actions decided", "Approve or block actions from application access grants and effective permissions.", "capabilities_derived"],
      ["Runtime not executed", "External runtime execution stays disabled for this phase.", "runtime_execution_metadata_only"]
    ] as const;
    const moveStep = (direction: 1 | -1) => {
      const nextIndex = Math.min(Math.max(currentStepIndex + direction, 0), wizardSteps.length - 1);
      setConnectionWizardStep(wizardSteps[nextIndex].id);
    };
    const startAnotherConnection = () => {
      setSelectedInstalledConnectorTemplateId(undefined);
      resetZeroTrustConnectionState();
      setConnectionWizardStep("overview");
    };
    const finishOnboarding = async () => {
      setZeroTrustError("");
      await Promise.all([
        loadZeroTrustOnboardedAgents(),
        loadSupportedConnectorGuardrails()
      ]);
      const installedConnectorId = zeroTrustResult?.trustedAgent.connectorId ?? zeroTrustResult?.connectorProfile?.connectorId;
      if (installedConnectorId) {
        setSelectedInstalledConnectorTemplateId(installedConnectorId);
      }
      setConnectionWizardCollapsedAfterSuccess(true);
      guideToTarget("registered-agents");
    };
    const verifiedConnectorName = zeroTrustResult?.trustedAgent.connectorDisplayName
      ?? zeroTrustResult?.connectorProfile?.displayName
      ?? zeroTrustDiscovery?.discovery.connectorDisplayName
      ?? zeroTrustResult?.trustedAgent.connectorId
      ?? "External connector";
    const shouldShowCompactConnectPrompt =
      connectionWizardStep === "overview" &&
      !zeroTrustDiscovery &&
      !zeroTrustResult &&
      !zeroTrustError &&
      !isZeroTrustDiscovering &&
      !isZeroTrustOnboarding;
    const failureTitle = zeroTrustError.toLowerCase().includes("oauth")
      ? "OAuth application binding failed"
      : zeroTrustError.toLowerCase().includes("permission")
        ? "Resource permissions failed"
        : zeroTrustError.toLowerCase().includes("gateway")
          ? "Gateway registration mismatch"
          : zeroTrustError.toLowerCase().includes("proof") || zeroTrustError.toLowerCase().includes("signature")
            ? "Agent proof failed"
            : connectionWizardStep === "discovery"
              ? "External agent discovery failed."
              : "Connection verification failed";
    const renderBackButton = () => (
      <button type="button" className="secondary-button compact-button" onClick={() => moveStep(-1)} disabled={currentStepIndex === 0 || isZeroTrustDiscovering || isZeroTrustOnboarding}>
        Back
      </button>
    );
    const renderDecisionValues = (label: string, values?: string[]) => values?.length ? (
      <small>{label}: {values.join(", ")}</small>
    ) : null;
    const renderCapabilityList = (items: ConnectorAction[], emptyLabel: string) => (
      <div className="capability-list">
        {items.length ? items.map((item) => (
          <article key={item.capability}>
            <strong>{item.label ?? item.capability}</strong>
            <small>{item.capability}</small>
            <span>{item.reason}</span>
            {renderDecisionValues("Required application grants", item.requiredApplicationGrants)}
            {renderDecisionValues("Required effective permissions", item.requiredEffectivePermissions)}
            {renderDecisionValues("Missing application grants", item.missingApplicationGrants)}
            {renderDecisionValues("Missing effective permissions", item.missingEffectivePermissions)}
            {renderDecisionValues("Denied permissions", item.deniedEffectivePermissions)}
          </article>
        )) : <p className="muted-note">{emptyLabel}</p>}
      </div>
    );
    const renderStep = () => {
      if (connectionWizardStep === "overview") {
        return (
          <article className="wizard-step-panel">
            {connectionAudience === "bizapps" ? (
              <>
                <h3>Connect an external agent</h3>
                <p>This wizard connects an external agent without trusting pasted JSON. The Gateway discovers the agent, proves Gateway identity, verifies the agent signature, checks OAuth application binding, validates effective permissions, and decides approved actions.</p>
                <div className="wizard-card-grid three-up">
                  <article>
                    <span>What you provide</span>
                    <ul>
                      <li>Agent base URL</li>
                      <li>Expected agent ID</li>
                    </ul>
                  </article>
                  <article>
                    <span>What the external agent owner configures</span>
                    <ul>
                      <li>Gateway registration</li>
                      <li>OAuth application</li>
                      <li>Service principal</li>
                      <li>Declared agent actions</li>
                    </ul>
                  </article>
                  <article>
                    <span>What the Gateway verifies</span>
                    <ul>
                      <li>Signed challenge</li>
                      <li>Signed trust response</li>
                      <li>Application access grants</li>
                      <li>Effective permissions</li>
                      <li>Approved/blocked actions</li>
                    </ul>
                  </article>
                </div>
                <div className="wizard-action-row">
                  <button type="button" onClick={() => setConnectionWizardStep("gateway-registration")}>Continue</button>
                </div>
              </>
            ) : (
              <>
                <h3>External Agent Integration Contract</h3>
                <div className="endpoint-contract-list">
                  <code>GET /.well-known/a2a-agent.json</code>
                  <code>GET /.well-known/jwks.json</code>
                  <code>POST /onboarding/challenge</code>
                  <code>POST /a2a/task</code>
                </div>
                <p>The external agent must validate signed Gateway challenges before returning signed trust responses.</p>
                <details className="wizard-technical-details">
                  <summary>Expected discovery JSON shape</summary>
                  <pre>{`{
  "agentId": "external-jira-agent",
  "issuer": "http://localhost:4201",
  "jwksUri": "http://localhost:4201/.well-known/jwks.json",
  "onboardingEndpoint": "http://localhost:4201/onboarding/challenge",
  "runtimeEndpoint": "http://localhost:4201/a2a/task",
  "auth": {
    "audience": "external-jira-agent",
    "tokenEndpointAuthMethod": "private_key_jwt"
  }
}`}</pre>
                </details>
                <details className="wizard-technical-details">
                  <summary>Expected signed trust response fields</summary>
                  <div className="concept-pill-row">
                    {["agentId", "issuer", "clientId", "audience", "requestedScopes", "agentDeclaredSkills", "agentDeclaredCapabilities", "nonce", "signedTrustResponse"].map((item) => <span key={item}>{item}</span>)}
                  </div>
                </details>
                <div className="wizard-action-row">
                  <button type="button" onClick={() => setConnectionWizardStep("gateway-registration")}>Continue to Gateway registration</button>
                </div>
              </>
            )}
          </article>
        );
      }

      if (connectionWizardStep === "gateway-registration") {
        return (
          <article className="wizard-step-panel">
            {connectionAudience === "bizapps" ? (
              <>
                <h3>Register this Gateway in the external agent</h3>
                <p>Copy this Gateway registration into the external agent admin console. In this local demo, the real-external-agent is already preconfigured.</p>
                <div className="gateway-registration-facts">
                  <div><small>Gateway Client ID</small><strong>{gatewayRegistration.clientId}</strong></div>
                  <div><small>Gateway Issuer</small><strong>{gatewayRegistration.issuer}</strong></div>
                  <div><small>Gateway JWKS URI</small><strong>{gatewayRegistration.jwksUri}</strong></div>
                  <div><small>Onboarding method</small><strong>{gatewayRegistration.onboardingMethod}</strong></div>
                </div>
                <a className="secondary-button compact-button external-console-link" href={adminConsoleUrl} target="_blank" rel="noreferrer">Open external agent admin console</a>
              </>
            ) : (
              <>
                <h3>Gateway registration JSON</h3>
                <p>This JSON contains only public Gateway identity metadata. It does not include private keys, tokens, client secrets, or Authorization headers.</p>
                <details className="wizard-technical-details">
                  <summary>Show Gateway registration JSON</summary>
                  <pre>{JSON.stringify(gatewayRegistration, null, 2)}</pre>
                  <button type="button" className="secondary-button compact-button" onClick={() => void copyGatewayRegistrationJson(gatewayRegistration)}>Copy JSON</button>
                  {zeroTrustCopyMessage ? <small>{zeroTrustCopyMessage}</small> : null}
                </details>
                <a className="secondary-button compact-button external-console-link" href={adminConsoleUrl} target="_blank" rel="noreferrer">Open external agent admin console</a>
              </>
            )}
            <div className="wizard-action-row">
              {renderBackButton()}
              <button type="button" onClick={() => setConnectionWizardStep("connection-input")}>Next</button>
            </div>
          </article>
        );
      }

      if (connectionWizardStep === "connection-input") {
        return (
          <article className="wizard-step-panel">
            <h3>Enter Agent URL</h3>
            <p>The connector template defines the expected profile contract, skills, grants, permissions, and runtime response shape. The external agent instance must still prove identity and return a signed attestation before it becomes installed and trusted.</p>
            <div className="connector-preset-grid" aria-label="Local reference connectors">
              {localConnectorPresets.map((preset) => (
                <button
                  type="button"
                  className="connector-preset-card"
                  key={preset.expectedConnectorId}
                  onClick={() => applyLocalConnectorPreset(preset)}
                >
                  <strong>{preset.label}</strong>
                  <span>{preset.agentBaseUrl}</span>
                  <small>{preset.expectedConnectorId}</small>
                </button>
              ))}
            </div>
            <div className="zero-trust-form wizard-form">
              <label>
                <span>Agent Base URL</span>
                <input value={zeroTrustAgentBaseUrl} onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setZeroTrustAgentBaseUrl(event.target.value);
                  resetZeroTrustConnectionState();
                }} />
                <small>The external agent URL that exposes /.well-known/a2a-agent.json</small>
              </label>
              <label>
                <span>Expected Agent ID</span>
                <input value={zeroTrustExpectedAgentId} onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setZeroTrustExpectedAgentId(event.target.value);
                  resetZeroTrustConnectionState();
                }} />
                <small>Used in this demo to prevent connecting the wrong agent.</small>
              </label>
              <label>
                <span>Expected external system</span>
                <select value={zeroTrustExpectedResourceSystem} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                  setZeroTrustExpectedResourceSystem(event.target.value);
                  resetZeroTrustConnectionState();
                }}>
                  <option value="">Auto-detect</option>
                  {resourceSystemOptions.map((connector) => (
                    <option value={connector.resourceSystem} key={connector.resourceSystem}>{connector.displayName.replace(" Reference Connector", "")}</option>
                  ))}
                </select>
                <small>Optional guardrail. Discovery remains the source of truth.</small>
              </label>
              <label>
                <span>Expected connector</span>
                <select value={zeroTrustExpectedConnectorId} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                  setZeroTrustExpectedConnectorId(event.target.value);
                  resetZeroTrustConnectionState();
                }}>
                  <option value="">Auto-detect</option>
                  {availableConnectorTemplates.map((connector) => (
                    <option value={connector.connectorId} key={connector.connectorId}>{connector.connectorId}</option>
                  ))}
                </select>
                <small>Optional guardrail for the connector profile ID.</small>
              </label>
            </div>
            <div className="wizard-action-row">
              {renderBackButton()}
              <button type="button" onClick={() => void discoverZeroTrustAgent()} disabled={isZeroTrustDiscovering || isZeroTrustOnboarding}>
                {isZeroTrustDiscovering ? "Discovering..." : "Discover agent"}
              </button>
            </div>
            <div className="compact-checklist">
              <span>The Gateway will:</span>
              <ul>
                <li>fetch discovery</li>
                <li>prepare signed challenge</li>
                <li>verify signed response</li>
                <li>validate OAuth binding</li>
                <li>decide actions</li>
              </ul>
            </div>
          </article>
        );
      }

      if (connectionWizardStep === "discovery") {
        return (
          <article className="wizard-step-panel">
            {zeroTrustDiscovery ? (
              <>
                <h3>Agent discovered</h3>
                <div className="discovery-summary-card">
                  <div><small>Agent ID</small><strong>{zeroTrustDiscovery.discovery.agentId}</strong></div>
                  <div><small>Issuer</small><strong>{zeroTrustDiscovery.discovery.issuer}</strong></div>
                  <div><small>Resource system</small><strong>{zeroTrustDiscovery.discovery.resourceSystem ?? "unknown"}</strong></div>
                  <div><small>Connector</small><strong>{zeroTrustDiscovery.discovery.connectorDisplayName ?? zeroTrustDiscovery.discovery.connectorId ?? "unknown"}</strong></div>
                  <div><small>Admin console</small><strong>{zeroTrustDiscovery.discovery.adminConsoleUrl ?? "not declared"}</strong></div>
                </div>
                <details className="wizard-technical-details">
                  <summary>Discovery details</summary>
                  <div className="discovery-result-grid">
                    <div><small>JWKS URI</small><strong>{zeroTrustDiscovery.discovery.jwksUri}</strong></div>
                    <div><small>Onboarding endpoint</small><strong>{zeroTrustDiscovery.discovery.onboardingEndpoint}</strong></div>
                    <div><small>Runtime endpoint</small><strong>{zeroTrustDiscovery.discovery.runtimeEndpoint}</strong></div>
                    <div><small>Connector profile URL</small><strong>{zeroTrustDiscovery.discovery.connectorProfileUrl ?? "not declared"}</strong></div>
                    <div><small>Runtime audience</small><strong>{zeroTrustDiscovery.discovery.auth.audience}</strong></div>
                    <div><small>Token auth method</small><strong>{zeroTrustDiscovery.discovery.auth.tokenEndpointAuthMethod}</strong></div>
                    <div><small>Connection requirements</small><strong>{zeroTrustDiscovery.discovery.connectionRequirements ? Object.entries(zeroTrustDiscovery.discovery.connectionRequirements).map(([key, value]) => `${key}: ${value}`).join(", ") : "not declared"}</strong></div>
                  </div>
                </details>
                <p>Discovery is a declaration. Trust is not granted until signed challenge, OAuth binding, and permission validation pass.</p>
                <div className="wizard-action-row">
                  {renderBackButton()}
                  <button type="button" onClick={() => void startZeroTrustOnboarding()} disabled={isZeroTrustOnboarding || isZeroTrustDiscovering}>
                    {isZeroTrustOnboarding ? "Verifying..." : "Verify connection"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="focused-error-panel" role="alert">
                  <h3>{failureTitle}</h3>
                  <p>Start the selected real-external-agent connector instance and ensure it exposes GET /.well-known/a2a-agent.json.</p>
                </div>
                <div className="wizard-action-row">
                  {renderBackButton()}
                  <button type="button" onClick={() => void discoverZeroTrustAgent()} disabled={isZeroTrustDiscovering || isZeroTrustOnboarding}>
                    {isZeroTrustDiscovering ? "Discovering..." : "Try discovery again"}
                  </button>
                </div>
              </>
            )}
          </article>
        );
      }

      if (connectionWizardStep === "verify") {
        return (
          <article className="wizard-step-panel">
            <h3>{isZeroTrustOnboarding ? "Verifying connection..." : zeroTrustResult ? "Connection verified" : "Verify Connection"}</h3>
            {zeroTrustError ? (
              <div className="focused-error-panel" role="alert">
                <h3>{failureTitle}</h3>
                <p>{zeroTrustError}</p>
                <details className="wizard-technical-details">
                  <summary>Technical details</summary>
                  <p>{zeroTrustError}</p>
                </details>
              </div>
            ) : null}
            <ol className="onboarding-progress-list vertical">
              {progressSteps.map(([title, description, checkName]) => {
                const status = isZeroTrustOnboarding && !zeroTrustResult ? "pending" : checkStatus(checkName) ?? "pending";
                return (
                  <li className={`progress-${status}`} key={checkName}>
                    <strong>{title}</strong>
                    <span>{description}</span>
                    <small>{status.replace(/_/g, " ")}</small>
                  </li>
                );
              })}
            </ol>
            <div className="wizard-action-row">
              {renderBackButton()}
              {zeroTrustResult ? (
                <button type="button" onClick={() => setConnectionWizardStep("result")}>Review result</button>
              ) : (
                <button type="button" onClick={() => void startZeroTrustOnboarding()} disabled={isZeroTrustOnboarding || isZeroTrustDiscovering || !zeroTrustDiscovery}>
                  {isZeroTrustOnboarding ? "Verifying..." : "Verify connection"}
                </button>
              )}
            </div>
          </article>
        );
      }

      return (
        <article className="wizard-step-panel">
          {zeroTrustResult ? (
            <>
              <div className="result-title-row">
                <div>
                  <h3>Connection verified</h3>
                  <p>{zeroTrustResult.message}</p>
                </div>
              <strong className="metadata-only-badge">Trusted summary</strong>
              </div>
              <div className="wizard-card-grid two-up">
                <article>
                  <span>What was proven</span>
                  <ul>
                    <li>Gateway identity verified by external agent</li>
                    <li>Agent identity verified by Gateway</li>
                    <li>Connector profile fetched and validated</li>
                    <li>Application access grants checked</li>
                    <li>Effective permissions evaluated</li>
                    <li>Agent actions decided by Gateway policy</li>
                  </ul>
                </article>
                <article>
                  <span>Connector Profile</span>
                  <strong>{zeroTrustResult.connectorProfile?.displayName ?? zeroTrustDiscovery?.discovery.connectorDisplayName ?? "missing connector profile"}</strong>
                  <small>Connector ID: {zeroTrustResult.connectorProfile?.connectorId ?? zeroTrustDiscovery?.discovery.connectorId ?? "unknown"}</small>
                  <small>Resource system: {zeroTrustResult.connectorProfile?.resourceSystem ?? zeroTrustDiscovery?.discovery.resourceSystem ?? "unknown"}</small>
                  <small>Profile source: {zeroTrustResult.connectorProfile?.profileSource ?? "unknown"}</small>
                  <small>Profile verified: {zeroTrustResult.connectorProfileVerified ? "yes" : "no"}</small>
                  <small>Decision source: {zeroTrustResult.connectorDecisionSource}</small>
                  <small>External config hash: {shortHash(zeroTrustResult.externalApplicationAttestation?.externalConfigHash ?? zeroTrustResult.trustedAgent.externalConfigHash)}</small>
                  <small>Connector profile hash: {shortHash(zeroTrustResult.externalApplicationAttestation?.connectorProfileHash ?? zeroTrustResult.trustedAgent.connectorProfileHash)}</small>
                </article>
                <article>
                  <span>Application Access Proof</span>
                  <strong>{zeroTrustResult.externalApplicationAttestation?.oauthApplication?.appName ?? zeroTrustResult.externalApplicationAttestation?.oauthApplication?.clientId ?? zeroTrustResult.discoveredAgent.clientId}</strong>
                  <small>Client ID: {zeroTrustResult.externalApplicationAttestation?.oauthApplication?.clientId ?? zeroTrustResult.discoveredAgent.clientId}</small>
                  <small>Authorization server issuer: {zeroTrustResult.externalApplicationAttestation?.oauthApplication?.authorizationServerIssuer ?? zeroTrustResult.discoveredAgent.issuer}</small>
                  <small>Application access grants: {(zeroTrustResult.oauthApplicationProof.applicationAccessGrants ?? zeroTrustResult.oauthApplicationProof.grantedScopes).join(", ") || "none"}</small>
                  <small>OAuth scopes / application access grants: {zeroTrustResult.oauthApplicationProof.grantedScopes.join(", ") || "none"}</small>
                  <small>App status: {zeroTrustResult.oauthApplicationProof.status ?? zeroTrustResult.externalApplicationAttestation?.oauthApplication?.status ?? "unknown"}</small>
                </article>
                <article>
                  <span>Effective Permission Proof</span>
                  <strong>{zeroTrustResult.externalApplicationAttestation?.servicePrincipal?.principalId ?? zeroTrustResult.resourcePermissionProof.principal}</strong>
                  <small>Effective permissions: {(zeroTrustResult.resourcePermissionProof.effectivePermissions ?? []).join(", ") || "none"}</small>
                  <small>Denied permissions: {(zeroTrustResult.resourcePermissionProof.deniedPermissions ?? []).join(", ") || "none"}</small>
                </article>
                <article>
                  <span>Runtime</span>
                  <strong>approved-skill runtime available</strong>
                  <small>Run Task executes only approved connector skills with scoped A2A JWT validation.</small>
                  <small>Raw assertion: hidden.</small>
                </article>
              </div>
              <section className="capability-decision-grid" aria-label="Gateway action decision">
                <div>
                  <h4>Approved actions</h4>
                  {renderCapabilityList(approvedActions, "No approved actions.")}
                </div>
                <div>
                  <h4>Blocked actions</h4>
                  {renderCapabilityList(blockedActions, "No blocked actions.")}
                </div>
              </section>
              <p>The external agent protocol is universal. System-specific action requirements come from the connector profile.</p>
              <p>Agent actions are declared by the external agent, but approved only after application access grants, effective permissions, denied permissions, and Gateway policy are evaluated.</p>
              <div className="wizard-action-row">
                <button type="button" onClick={() => void finishOnboarding()}>Finish and view Installed Connector Agents</button>
                <button type="button" className="secondary-button compact-button" onClick={startAnotherConnection}>Connect another external agent</button>
              </div>
              <details className="wizard-technical-details">
                <summary>View technical details</summary>
                <h4>Raw checks</h4>
                <JsonBlock value={zeroTrustResult.checks} />
                <h4>Full discovery metadata</h4>
                <JsonBlock value={zeroTrustDiscovery?.discovery ?? zeroTrustResult.discoveredAgent} />
                <h4>Full onboarding result JSON</h4>
                <JsonBlock value={zeroTrustResult} />
              </details>
            </>
          ) : (
            <>
              <h3>Review Result</h3>
              <p>Verify the connection before reviewing the result.</p>
              <div className="wizard-action-row">
                {renderBackButton()}
                <button type="button" onClick={() => setConnectionWizardStep("verify")}>Go to verification</button>
              </div>
            </>
          )}
        </article>
      );
    };

    if (connectionWizardCollapsedAfterSuccess && zeroTrustResult) {
      return (
        <section className="zero-trust-onboarding-panel collapsed-success scroll-target" ref={zeroTrustOnboardingRef} tabIndex={-1} aria-label="Zero-Trust Agent Onboarding">
          <div className="panel-header">
            <div>
              <p className="active-panel-eyebrow">Connection verified</p>
              <h2>2. Connect External Agent</h2>
              <p className="muted-note">{verifiedConnectorName} was installed as a trusted external connector agent.</p>
            </div>
          </div>
          <div className="wizard-action-row">
            <button type="button" className="secondary-button compact-button" onClick={() => guideToTarget("registered-agents")}>View Installed Connector Agents</button>
            <button type="button" className="secondary-button compact-button" onClick={startAnotherConnection}>Connect another external agent</button>
            <button type="button" className="secondary-button compact-button" onClick={() => {
              setConnectionWizardCollapsedAfterSuccess(false);
              setConnectionWizardStep("result");
            }}>Show verification details</button>
          </div>
        </section>
      );
    }

    if (shouldShowCompactConnectPrompt) {
      return (
        <section className="zero-trust-onboarding-panel compact-connect-panel scroll-target" ref={zeroTrustOnboardingRef} tabIndex={-1} aria-label="Zero-Trust Agent Onboarding">
          <div className="panel-header">
            <div>
              <p className="active-panel-eyebrow">2. Connect external agent</p>
              <h2>Connect External Agent</h2>
              <p className="muted-note">Choose a connector template from the catalog, or start a manual connection.</p>
            </div>
            <div className="wizard-action-row">
              <button type="button" className="secondary-button" onClick={() => {
                setSelectedInstalledConnectorTemplateId(undefined);
                setConnectionWizardStep("connection-input");
              }}>Start manual connection</button>
              <button type="button" className="secondary-button" onClick={() => guideToTarget("connector-catalog")}>View Connector Catalog</button>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="zero-trust-onboarding-panel scroll-target" ref={zeroTrustOnboardingRef} tabIndex={-1} aria-label="Zero-Trust Agent Onboarding">
        <div className="panel-header">
          <div>
            <p className="active-panel-eyebrow">2. Connect external agent</p>
            <h2>Connect External Agent</h2>
            <p className="muted-note">Verify the external agent identity, grants, permissions, and approved skills.</p>
          </div>
        </div>
        <div className="audience-toggle" aria-label="Audience">
          <span>Audience:</span>
          <button type="button" className={connectionAudience === "bizapps" ? "active" : ""} onClick={() => setConnectionAudience("bizapps")}>BizApps / Admin</button>
          <button type="button" className={connectionAudience === "developer" ? "active" : ""} onClick={() => setConnectionAudience("developer")}>Developer</button>
        </div>
        <ol className="onboarding-wizard-steps" aria-label="External agent onboarding steps">
          {wizardSteps.map((step, index) => {
            const status = wizardStatus(step.id, index);
            return (
            <li className={`wizard-${status}`} key={step.id}>
              <span>{index + 1}</span>
              <strong>{step.label}</strong>
              <small>{status}</small>
            </li>
            );
          })}
        </ol>
        {renderStep()}
        <details className="why-zero-trust-card">
          <summary>Why this is Zero Trust</summary>
          <ul>
            <li>The Gateway does not trust pasted JSON.</li>
            <li>The external agent must validate a signed Gateway challenge.</li>
            <li>The external agent must return a signed trust response.</li>
            <li>OAuth scopes are checked against application registration.</li>
            <li>Resource permissions are checked through the external-side attestation / adapter.</li>
            <li>Actions are approved only after validation.</li>
            <li>Runtime execution stays disabled until runtime JWT validation is enabled.</li>
          </ul>
        </details>
      </section>
    );
  }


  function renderAgentRegistryTab() {
    const builtInAgents = registeredAgentRows.filter((agent) => agent.source === "built-in");
    const infrastructureAgents = registeredAgentRows.filter((agent) => agent.source === "infrastructure");
    const zeroTrustAgents = registeredAgentRows.filter((agent) => agent.source === "zero-trust-onboarded");
    const connectorTemplates = supportedConnectorGuardrails.some((connector) => connector.connectorId === "custom-sdk")
      ? supportedConnectorGuardrails
      : [
          ...supportedConnectorGuardrails,
          { resourceSystem: "custom", connectorId: "custom-sdk", displayName: "Custom Connector SDK", status: "planned" as const, source: "custom_sdk" as const, installed: false, installedCount: 0 }
        ];
    const agentGroups = [
      {
        title: "Legacy Internal Demo Agents",
        description: "Local mock agents retained for internal demo flows. External connector onboarding is the primary product path.",
        agents: builtInAgents,
        defaultOpen: false,
        emptyState: "No legacy internal demo agents reported by health checks."
      },
      {
        title: "Infrastructure",
        description: "Supporting services such as Mock IdP.",
        agents: infrastructureAgents,
        defaultOpen: false,
        emptyState: "No infrastructure services reported by health checks."
      }
    ];

    function installedAgentMatchesTemplate(agent: TrustedOnboardedAgent | RegisteredAgentRow, template: ConnectorTemplate): boolean {
      if (agent.connectorId) {
        return agent.connectorId === template.connectorId;
      }

      return agent.resourceSystem === template.resourceSystem;
    }

    function installedCountForTemplate(template: ConnectorTemplate): number {
      return zeroTrustOnboardedAgents.filter((agent) => installedAgentMatchesTemplate(agent, template)).length;
    }

    function templateForAgent(agent: RegisteredAgentRow): ConnectorTemplate | undefined {
      return connectorTemplates.find((template) => installedAgentMatchesTemplate(agent, template));
    }

    function lifecycleForInstalledAgent(agent: RegisteredAgentRow) {
      const approved = (agent.approvedActions ?? agent.approvedCapabilities)?.length ?? 0;
      return agent.lifecycle ?? (
        approved > 0 && agent.connectorProfileVerified && agent.runtimeEndpoint
          ? { state: "runtime_ready" as const, label: "Runtime ready", reason: "Approved skills can execute through the trusted runtime endpoint with scoped A2A JWT." }
          : { state: "runtime_blocked" as const, label: "Runtime blocked", reason: "No approved runtime skills are currently available." }
      );
    }

    const registrySummary = {
      connectorTemplates: connectorTemplates.length,
      installedConnectors: zeroTrustAgents.length,
      runtimeReady: zeroTrustAgents.filter((agent) => lifecycleForInstalledAgent(agent).state === "runtime_ready").length,
      needsReverification: zeroTrustAgents.filter((agent) => lifecycleForInstalledAgent(agent).state === "needs_reverification").length,
      blockedSkills: zeroTrustAgents.reduce((total, agent) => total + ((agent.blockedActions ?? agent.blockedCapabilities)?.length ?? 0), 0)
    };

    const approvedSkillScenarioMap: Record<string, string> = {
      "jira.issue.diagnose_creation_failure": "Jira issue creation fails with 403 when creating issues in FIN project",
      "jira.permission.inspect": "Jira inspect project roles for a user",
      "jira.issue.create": "Create a Jira issue in FIN project for this outage",
      "servicenow.incident.assignment.diagnose": "ServiceNow incident assignment keeps failing for network tickets",
      "servicenow.catalog.request.diagnose": "ServiceNow catalog request RITM keeps failing during approval",
      "servicenow.user.role.inspect": "ServiceNow user ACL access issue keeps blocking assignment",
      "github.repository.rate_limit.diagnose": "GitHub repository sync is failing after API rate limit",
      "github.repository.permission.inspect": "GitHub repository permission issue blocks installation access",
      "github.pull_request.access.diagnose": "GitHub pull request checks cannot read the repository"
    };

    function scenarioForApprovedSkill(agent: RegisteredAgentRow): string | undefined {
      const approved: ConnectorAction[] = agent.approvedActions ?? agent.approvedCapabilities ?? [];
      for (const action of approved) {
        const scenario = approvedSkillScenarioMap[action.capability];
        if (scenario) {
          return scenario;
        }
      }
      return undefined;
    }

    function runMatchingScenario(agent: RegisteredAgentRow) {
      const scenario = scenarioForApprovedSkill(agent);
      if (!scenario) {
        return;
      }
      setMessage(scenario);
      setActiveTab("run-task");
      showGuidedStatus("Scenario loaded in Run Task");
      guideToTarget("composer");
    }

    function prefillReverification(agent: RegisteredAgentRow) {
      const preset = localConnectorPresets.find((item) =>
        item.expectedConnectorId === agent.connectorId ||
          item.expectedResourceSystem === agent.resourceSystem
      );
      if (preset) {
        setZeroTrustAgentBaseUrl(preset.agentBaseUrl);
        setZeroTrustExpectedAgentId(preset.expectedAgentId);
        setZeroTrustExpectedResourceSystem(preset.expectedResourceSystem);
        setZeroTrustExpectedConnectorId(preset.expectedConnectorId);
      }
      setZeroTrustDiscovery(null);
      setZeroTrustResult(null);
      setZeroTrustError("");
      setZeroTrustCopyMessage("");
      setConnectionWizardCollapsedAfterSuccess(false);
      setConnectionWizardStep("connection-input");
      showGuidedStatus("Re-verification form loaded");
      guideToTarget("zero-trust-onboarding");
    }

    function renderAgentRegistrySummaryBar() {
      const summaryItems = [
        { label: "Connector templates:", value: registrySummary.connectorTemplates },
        { label: "Installed connector agents:", value: registrySummary.installedConnectors },
        { label: "Runtime ready:", value: registrySummary.runtimeReady },
        { label: "Needs re-verification:", value: registrySummary.needsReverification },
        { label: "Blocked skills:", value: registrySummary.blockedSkills }
      ];

      return (
        <section className="agent-registry-summary-bar" aria-label="Agent Registry summary">
          {summaryItems.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
          {registrySummary.installedConnectors > 0 ? (
            <div className="agent-registry-summary-action">
              <span>Validation</span>
              <button type="button" className="secondary-inline-button" onClick={() => {
                setActiveTab("connector-test-center");
                showGuidedStatus("Moved to Connector Test Center");
                guideToTarget("connector-test-center");
              }}>
                Open Connector Test Center
              </button>
            </div>
          ) : null}
        </section>
      );
    }

    function renderConnectorCatalog() {
      return (
        <section className="registry-section scroll-target" ref={connectorCatalogRef} tabIndex={-1}>
          <div className="section-heading-row">
            <div>
              <p className="active-panel-eyebrow">1. Choose template</p>
              <h2>Connector Catalog</h2>
              <p className="strong-note">Choose a connector template</p>
              <p className="muted-note">Templates are not trusted until an external agent completes onboarding.</p>
            </div>
          </div>
          <div className="connector-preset-grid" aria-label="Connector Catalog">
            {connectorTemplates.map((template) => {
              const preset = localConnectorPresets.find((item) => item.expectedConnectorId === template.connectorId);
              const installedCount = installedCountForTemplate(template);
              const sourceLabel = template.source === "custom_sdk" ? "SDK / Bring your own connector" : "Local reference template";
              const runtimeSupportLabel = template.runtimeSupport === "planned" ? "Planned" : template.runtimeSupport === "not_supported" ? "Not supported" : "Supported";
              const metadataUnavailable = !template.category || !template.publisher || !template.templateVersion || !template.authModel || !template.runtimeSupport || !template.riskLevel;
              const installedBadge = installedCount > 0 ? `${installedCount} installed agent${installedCount === 1 ? "" : "s"}` : "Not installed";
              return (
                <article className={`connector-preset-card ${template.connectorId === "custom-sdk" ? "planned-template-card" : ""}`} key={template.connectorId}>
                  <div className="connector-card-heading">
                    <strong>{template.displayName}</strong>
                    <span className={`connector-template-badge ${installedCount > 0 ? "installed" : template.status === "planned" ? "planned" : "not-installed"}`}>
                      {template.connectorId === "custom-sdk" ? "Planned / V2" : installedBadge}
                    </span>
                  </div>
                  <div className="connector-template-facts">
                    <span>{template.category ?? "Metadata unavailable"}</span>
                    <span>Installed agents: {installedCount}</span>
                    <span>Runtime support: {template.runtimeSupport ? runtimeSupportLabel : "Metadata unavailable"}</span>
                    <span>Risk level: {template.riskLevel ?? "Metadata unavailable"}</span>
                  </div>
                  <details className="wizard-technical-details">
                    <summary>Template details</summary>
                    <div className="registry-agent-metadata">
                      {metadataUnavailable ? <div><span>Metadata</span><strong>Metadata unavailable</strong></div> : null}
                      <div><span>Template ID</span><strong>{template.connectorId}</strong></div>
                      <div><span>Resource system</span><strong>{template.resourceSystem}</strong></div>
                      <div><span>Publisher</span><strong>{template.publisher ?? "Metadata unavailable"}</strong></div>
                      <div><span>Source</span><strong>{sourceLabel}</strong></div>
                      <div><span>Status</span><strong>{template.status === "planned" ? "Planned / V2" : "Available"}</strong></div>
                      <div><span>Template version</span><strong>{template.templateVersion ?? "Metadata unavailable"}</strong></div>
                      <div><span>Auth model</span><strong>{template.authModel ?? "Metadata unavailable"}</strong></div>
                      <div><span>Setup requirements</span><strong>{template.setupRequirements?.join(", ") ?? "Metadata unavailable"}</strong></div>
                      <div><span>Tags</span><strong>{template.tags?.join(", ") ?? "Metadata unavailable"}</strong></div>
                      <div><span>Description</span><strong>{template.description ?? "Supported connector template for external agent onboarding."}</strong></div>
                    </div>
                  </details>
                  {template.connectorId === "custom-sdk" ? (
                    <>
                      <p className="muted-note">Build your own connector using the Secure A2A connector contract. Planned for V2.</p>
                      <button type="button" className="secondary-button compact-button" disabled>Planned</button>
                      <button type="button" className="secondary-button compact-button" onClick={() => setCustomConnectorContractOpen(true)}>View connector contract</button>
                    </>
                  ) : preset ? (
                    <div className="connector-card-actions">
                      <button type="button" className="scenario-run compact-button" onClick={() => applyLocalConnectorPreset(preset)}>
                        {installedCount > 0 ? "Connect another external agent" : "Install connector agent"}
                      </button>
                      {installedCount > 0 ? (
                        <button type="button" className="secondary-button compact-button" onClick={() => {
                          setSelectedInstalledConnectorTemplateId(template.connectorId);
                          guideToTarget("registered-agents");
                        }}>View installed agents</button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
          <p className="muted-note">Policies can govern which installed connector agent skills may execute. Advanced policy controls are planned for V2.</p>
          <details className="wizard-technical-details" open={customConnectorContractOpen} onToggle={(event: React.SyntheticEvent<HTMLDetailsElement>) => setCustomConnectorContractOpen(event.currentTarget.open)}>
            <summary>Build your own connector</summary>
            <p>Organizations or vendors will be able to implement the Secure A2A connector contract.</p>
            <ul>
              <li>discovery document</li>
              <li>connector profile</li>
              <li>public JWKS</li>
              <li>signed onboarding response</li>
              <li>OAuth/application access attestation</li>
              <li>service account permission attestation</li>
              <li>scoped runtime endpoint</li>
            </ul>
            <p className="muted-note">Status: Planned / V2.</p>
          </details>
        </section>
      );
    }

    function renderInstalledConnectorCard(agent: RegisteredAgentRow) {
      const approved = (agent.approvedActions ?? agent.approvedCapabilities)?.length ?? 0;
      const blocked = (agent.blockedActions ?? agent.blockedCapabilities)?.length ?? 0;
      const lifecycle = lifecycleForInstalledAgent(agent);
      const detailsOpen = expandedInstalledAgentIds.includes(agent.agentId);
      const template = templateForAgent(agent);
      const matchingScenario = scenarioForApprovedSkill(agent);
      return (
        <article className="registry-agent-card compact-agent-card" key={`installed-${agent.agentId}`}>
          <div className="registry-agent-card-header">
            <div className="agent-title-block">
              <strong>{agent.connectorDisplayName ?? agent.connectorId ?? agent.agentId}</strong>
              <small>Agent ID: {agent.agentId}</small>
              <div className="registry-agent-badges">
                <span className="source-badge">installed connector agent</span>
                <strong className={`health-pill ${lifecycle.state === "runtime_ready" ? "healthy" : "warning"}`}>{lifecycle.label}</strong>
              </div>
            </div>
          </div>
          <div className="registry-agent-compact-metadata">
            <span><b>Connector</b> {template?.displayName ?? agent.connectorDisplayName ?? agent.connectorId ?? "unknown"}</span>
            <span><b>Agent ID</b> <code>{agent.agentId}</code></span>
            <span><b>Lifecycle</b> {lifecycle.label}</span>
            <span><b>Approved actions</b> {approved}</span>
            <span><b>Blocked actions</b> {blocked}</span>
            <span className="runtime-endpoint-chip"><b>Runtime endpoint</b> <code>{agent.runtimeEndpoint ?? "not declared"}</code></span>
          </div>
          <p className="muted-note compact-lifecycle-reason">{lifecycle.reason}</p>
          <div className="installed-connector-actions">
            <button type="button" className="secondary-button compact-button" onClick={() => {
              setExpandedInstalledAgentIds((current) =>
                current.includes(agent.agentId)
                  ? current.filter((id) => id !== agent.agentId)
                  : [...current, agent.agentId]
              );
            }}>View details</button>
            <button type="button" className="scenario-run compact-button" disabled={!matchingScenario} title={matchingScenario ? "Run a scenario for the first approved skill." : "No approved runtime scenario available."} onClick={() => runMatchingScenario(agent)}>Run scenario</button>
            <button type="button" className="secondary-button compact-button" onClick={() => prefillReverification(agent)}>Re-verify</button>
          </div>
          {!matchingScenario ? <p className="muted-note">No approved runtime scenario available.</p> : null}
          {detailsOpen ? (
            <div className="installed-connector-details">
              <h4>Trusted connector metadata</h4>
              <div className="registry-agent-metadata">
                <div><span>Requested grants</span><strong>{agent.requestedScopes?.join(", ") || "none"}</strong></div>
                <div><span>Agent-declared skills</span><strong>{(agent.agentDeclaredSkills ?? agent.agentDeclaredCapabilities)?.join(", ") || "none"}</strong></div>
                <div><span>Resource system</span><strong>{agent.resourceSystem ?? "unknown"}</strong></div>
                <div><span>Trust level</span><strong>{agent.trustLevel}</strong></div>
                <div><span>Profile verified</span><strong>{agent.connectorProfileVerified ? "yes" : "no"}</strong></div>
                <div><span>External config</span><strong>{shortHash(agent.externalConfigHash)}</strong></div>
                <div><span>Approved actions</span><strong>{(agent.approvedActions ?? agent.approvedCapabilities)?.map((item: ConnectorAction) => item.label ?? item.capability).join(", ") || "none"}</strong></div>
                <div><span>Blocked actions</span><strong>{(agent.blockedActions ?? agent.blockedCapabilities)?.map((item: ConnectorAction) => `${item.label ?? item.capability}: ${item.reason}`).join("; ") || "none"}</strong></div>
                <div><span>Resource principal</span><strong>{agent.resourcePrincipal ?? "unknown"}</strong></div>
                <div><span>Execution state</span><strong>{agent.executionState}</strong></div>
              </div>
            </div>
          ) : null}
        </article>
      );
    }

    function renderInstalledConnectors() {
      const selectedTemplate = selectedInstalledConnectorTemplateId
        ? connectorTemplates.find((template) => template.connectorId === selectedInstalledConnectorTemplateId)
        : undefined;
      const matchingAgents = selectedTemplate
        ? zeroTrustAgents.filter((agent) => installedAgentMatchesTemplate(agent, selectedTemplate))
        : zeroTrustAgents;
      const groups = [...new Map<string, RegisteredAgentRow>(matchingAgents.map((agent) => [agent.resourceSystem ?? agent.connectorId ?? "unknown", agent])).keys()];
      return (
        <section className="registry-section scroll-target" ref={registeredAgentsRef} tabIndex={-1}>
          <div className="section-heading-row">
            <div>
              <p className="active-panel-eyebrow">3. Review installed agents</p>
              <h2>Installed Connector Agents</h2>
              <p className="muted-note">External agent instances that passed signed onboarding from a connector template.</p>
            </div>
          </div>
          {selectedTemplate ? (
            <div className="installed-filter-banner">
              <span>Showing installed agents for {selectedTemplate.displayName}</span>
              <button type="button" className="secondary-button compact-button" onClick={() => setSelectedInstalledConnectorTemplateId(undefined)}>Clear filter</button>
            </div>
          ) : null}
          {matchingAgents.length ? (
            <div className="registry-agent-list">
              {groups.map((group) => (
                <details className="registry-agent-group" key={group} open>
                  <summary>
                    <div>
                      <strong>{group}</strong>
                      <span>{matchingAgents.filter((agent) => (agent.resourceSystem ?? agent.connectorId ?? "unknown") === group).length} installed agent(s)</span>
                    </div>
                    <b aria-hidden="true">v</b>
                  </summary>
                  <div className="registry-agent-group-body">
                    {matchingAgents.filter((agent) => (agent.resourceSystem ?? agent.connectorId ?? "unknown") === group).map(renderInstalledConnectorCard)}
                  </div>
                </details>
              ))}
            </div>
          ) : selectedTemplate ? (
            <div className="installed-filter-empty">
              <p className="muted-note">No installed agents from this template yet.</p>
              {localConnectorPresets.find((item) => item.expectedConnectorId === selectedTemplate.connectorId) ? (
                <button type="button" className="secondary-button compact-button" onClick={() => applyLocalConnectorPreset(localConnectorPresets.find((item) => item.expectedConnectorId === selectedTemplate.connectorId)!)}>Connect external agent</button>
              ) : null}
            </div>
          ) : (
            <div className="installed-empty-state">
              <div>
                <p className="strong-note">No connector agent installed yet.</p>
                <p className="muted-note">Choose a connector template to install a trusted external agent. Connector templates are not installed by default.</p>
              </div>
              <div className="wizard-action-row">
                <button type="button" className="secondary-button compact-button" onClick={goToConnectorCatalog}>Open Connector Catalog</button>
                <button type="button" className="secondary-button compact-button" onClick={() => applyLocalConnectorPreset(localConnectorPresets[0])}>Use local Jira reference agent</button>
              </div>
            </div>
          )}
        </section>
      );
    }

    function renderRegisteredAgentCard(agent: (typeof registeredAgentRows)[number]) {
      return (
        <article className="registry-agent-card compact-agent-card" key={agent.agentId}>
          <div className="registry-agent-card-header">
            <div className="agent-title-block">
              <strong>{agent.agentId}</strong>
              <div className="registry-agent-badges">
                <span className="source-badge">{agent.source}</span>
                <strong className={`health-pill ${healthClass(agent.status)}`}>{agent.status}</strong>
                {agent.source === "zero-trust-onboarded" ? <small className="metadata-only-badge">trusted summary</small> : null}
              </div>
            </div>
          </div>
          <div className="registry-agent-compact-metadata">
            {agent.source === "zero-trust-onboarded" ? <span><b>Trust</b> {agent.trustLevel}</span> : null}
            {agent.source === "zero-trust-onboarded" ? <span><b>Approved</b> {(agent.approvedActions ?? agent.approvedCapabilities)?.length ?? 0}</span> : null}
            {agent.source === "zero-trust-onboarded" ? <span><b>Blocked</b> {(agent.blockedActions ?? agent.blockedCapabilities)?.length ?? 0}</span> : null}
            <span><b>Auth</b> {agent.authMode}</span>
            <span><b>Endpoint</b> {endpointTypeLabel(agent.endpointType, agent.endpointScheme)}</span>
            <span><b>Agent Card</b> {agent.agentCardAvailable ? "yes" : "no"}</span>
            {agent.source === "zero-trust-onboarded" ? <span><b>Executable</b> {String(agent.executable)}</span> : null}
          </div>
          <details className="agent-advanced-details">
            <summary>Advanced details</summary>
            <div className="registry-agent-metadata">
              <div>
                <span>Latency</span>
                <strong>{typeof agent.latencyMs === "number" ? `${agent.latencyMs} ms` : "unknown"}</strong>
              </div>
              <div>
                <span>Endpoint type</span>
                <strong>{endpointTypeLabel(agent.endpointType, agent.endpointScheme)}</strong>
              </div>
              <div>
                <span>Auth mode</span>
                <strong>{agent.authMode}</strong>
              </div>
              <div>
                <span>Source</span>
                <strong>{agent.source}</strong>
              </div>
              {agent.source === "zero-trust-onboarded" ? (
                <>
                  <div>
                    <span>OAuth app bound</span>
                    <strong>{agent.oauthApplicationBound ? "yes" : "no"}</strong>
                  </div>
                  <div>
                    <span>Application access grants</span>
                    <strong>{agent.grantedScopes?.join(", ") || "none"}</strong>
                  </div>
                  <div>
                    <span>Agent-declared skills</span>
                    <strong>{(agent.agentDeclaredSkills ?? agent.agentDeclaredCapabilities)?.join(", ") || "none"}</strong>
                  </div>
                  <div>
                    <span>Approved actions</span>
                    <strong>{(agent.approvedActions ?? agent.approvedCapabilities)?.map((item: ConnectorAction) => item.label ?? item.capability).join(", ") || "none"}</strong>
                  </div>
                  <div>
                    <span>Blocked actions</span>
                    <strong>{(agent.blockedActions ?? agent.blockedCapabilities)?.map((item: ConnectorAction) => `${item.label ?? item.capability}: ${item.reason}`).join("; ") || "none"}</strong>
                  </div>
                  <div>
                    <span>Resource principal</span>
                    <strong>{agent.resourcePrincipal ?? "unknown"}</strong>
                  </div>
                  <div>
                    <span>Execution state</span>
                    <strong>{agent.executionState}</strong>
                  </div>
                </>
              ) : null}
            </div>
            {agent.error ? <p className="registry-agent-error">{agent.error}</p> : null}
          </details>
        </article>
      );
    }

    function renderAgentRegistryNav() {
      const navItems: Array<{ label: string; target: import("./types").GuidedFocusTarget }> = [
        { label: `1. Choose template (${registrySummary.connectorTemplates})`, target: "connector-catalog" },
        { label: "2. Connect external agent", target: "zero-trust-onboarding" },
        { label: `3. Installed Connector Agents (${registrySummary.installedConnectors})`, target: "registered-agents" },
        { label: "Legacy agents", target: "legacy-agents" }
      ];

      return (
        <nav className="agent-registry-anchor-nav" aria-label="Agent Registry sections">
          {navItems.map((item) => (
            <button type="button" key={item.target} onClick={() => guideToTarget(item.target)}>
              {item.label}
            </button>
          ))}
        </nav>
      );
    }

    return (
      <section className="control-panel agent-registry-panel scroll-target" aria-label="Agent Registry" ref={agentRegistryRootRef} tabIndex={-1}>
        {renderPageHeader({
          eyebrow: "Connector governance",
          title: "Agent Registry",
          subtitle: "Choose connector templates and install trusted external connector agents.",
          action: <button type="button" className="secondary-button" onClick={() => {
            void loadZeroTrustOnboardedAgents();
            void checkAgentHealth();
          }} disabled={isHealthLoading}>
            {isHealthLoading ? "Refreshing..." : "Refresh registry"}
          </button>
        })}

        {renderAgentRegistrySummaryBar()}

        {renderAgentRegistryNav()}

        {renderConnectorCatalog()}

        {renderZeroTrustOnboardingPanel()}

        {renderInstalledConnectors()}

        <details className="registry-overview-section scroll-target" ref={legacyAgentsRef} tabIndex={-1}>
          <summary>
            <div>
              <strong>Legacy Internal Demo Agents</strong>
              <small className="connector-template-badge planned">Advanced / legacy demo only</small>
              <span>Legacy internal mock agents are retained only for old demo flows. They are not part of the external connector product path.</span>
            </div>
            <b aria-hidden="true">v</b>
          </summary>
          <section className="registry-section">
            <div className="registry-summary-grid">
              <article>
                <span>Installed connector agents</span>
                <strong>{zeroTrustAgents.length}</strong>
              </article>
              <article>
                <span>Legacy internal demo agents</span>
                <strong>{builtInAgentsCount}</strong>
              </article>
              <article>
                <span>Healthy services</span>
                <strong>{healthyAgentsCount}</strong>
              </article>
              <article>
                <span>Auth mode</span>
                <strong>{health?.orchestrator.authMode ?? "unknown"}</strong>
              </article>
            </div>
          </section>

          <section className="registry-section">
            <h2>Legacy Internal Demo Agents</h2>
            {healthError ? <p className="error">{healthError}</p> : null}
            {registeredAgentRows.length ? (
              <div className="registry-agent-list">
                {agentGroups.map((group) => (
                  <details className="registry-agent-group" key={group.title} open={group.defaultOpen}>
                    <summary>
                      <div>
                        <strong>{group.title} ({group.agents.length})</strong>
                        <span>{group.description}</span>
                      </div>
                      <b aria-hidden="true">v</b>
                    </summary>
                    <div className="registry-agent-group-body">
                      {group.agents.length ? group.agents.map(renderRegisteredAgentCard) : <p className="muted-note">{group.emptyState}</p>}
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <p className="muted-note">{isHealthLoading ? "Loading legacy internal demo agents..." : "No legacy internal demo agents reported yet."}</p>
            )}
          </section>
        </details>
      </section>
    );
  }

  return renderAgentRegistryTab();
}
