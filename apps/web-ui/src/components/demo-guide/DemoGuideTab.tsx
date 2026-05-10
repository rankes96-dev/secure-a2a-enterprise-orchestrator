import React from "react";
import type { ExtractedScreenContext, Scenario } from "../types";

type ScreenContext = ExtractedScreenContext;

export function DemoGuideTab({ ctx }: { ctx: ScreenContext }) {
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

  function demoReadinessStatusLabel(status: "ready" | "missing_connector" | "runtime_blocked" | "needs_setup" | "info") {
    switch (status) {
      case "ready":
        return "Ready";
      case "missing_connector":
        return "Missing connector";
      case "runtime_blocked":
        return "Blocked";
      case "needs_setup":
        return "Needs setup";
      default:
        return "Info";
    }
  }

  function demoReadinessStatusClass(status: "ready" | "missing_connector" | "runtime_blocked" | "needs_setup" | "info") {
    switch (status) {
      case "ready":
        return "success";
      case "runtime_blocked":
        return "danger";
      case "missing_connector":
      case "needs_setup":
        return "warning";
      default:
        return "info";
    }
  }

  function renderDemoReadinessPanel() {
    const jiraPreset = localConnectorPresets.find((preset) => preset.expectedConnectorId === "jira-reference") ?? localConnectorPresets[0];
    const approvedJiraScenario = "Jira issue creation fails with 403 when creating issues in FIN project";
    const blockedJiraScenario = "Create a Jira issue in FIN project for this outage";
    const serviceNowScenario = "ServiceNow incident assignment keeps failing for network tickets";
    const gitHubScenario = "GitHub repository sync is failing after API rate limit";
    const unsupportedScenario = "The warehouse robot arm calibration failed";
    const runtimeProofCaptured = latestResponse?.connectorRuntime?.executed === true;
    const blockedScenarioCaptured = latestResponse?.connectorRouting?.status === "connector_skill_blocked";
    const hasRuntimeReadyConnector = runtimeReadyConnectorAgentCount > 0;
    const runScenario = (scenario: string) => {
      setMessage(scenario);
      if (!isUserAuthenticated) {
        goToTrustIdentity();
        return;
      }
      setActiveTab("run-task");
      showGuidedStatus("Scenario loaded in Run Task");
      guideToTarget("composer");
      void resolveIssue(scenario);
    };
    const nextStep = !isUserAuthenticated
      ? {
        title: "Login to start governed execution",
        text: "Attach a verified demo user before the Gateway can run a connector-backed task.",
        primaryLabel: "Login",
        primaryAction: goToTrustIdentity,
        secondaryLabel: undefined,
        secondaryAction: undefined
      }
      : installedConnectorAgentCount === 0
        ? {
          title: "Install your first connector agent",
          text: "Choose a connector template and start signed external-agent onboarding.",
          primaryLabel: "Open Connector Catalog",
          primaryAction: goToConnectorCatalog,
          secondaryLabel: "Install Jira reference agent",
          secondaryAction: () => applyLocalConnectorPreset(jiraPreset)
        }
        : !hasRuntimeReadyConnector
          ? {
            title: "Connector installed, runtime not ready",
            text: "Review the installed connector agent and re-verify grants, permissions, and approved skills.",
            primaryLabel: "View Installed Connector Agents",
            primaryAction: goToInstalledConnectorAgents,
            secondaryLabel: undefined,
            secondaryAction: undefined
          }
          : runtimeProofCaptured
            ? {
              title: "Runtime proof captured",
              text: "Now prove that an unapproved create action is blocked before runtime execution.",
              primaryLabel: "Run blocked create scenario",
              primaryAction: () => runScenario(blockedJiraScenario),
              secondaryLabel: "Open Security Timeline",
              secondaryAction: goToSecurityTimeline
            }
            : {
              title: "Run approved runtime diagnosis",
              text: "Show approved Jira diagnosis executing through a scoped A2A JWT.",
              primaryLabel: "Run Jira approved diagnosis",
              primaryAction: () => runScenario(approvedJiraScenario),
              secondaryLabel: "View Installed Connector Agents",
              secondaryAction: goToInstalledConnectorAgents
            };
    const activeProgressStep = !isUserAuthenticated
      ? "login"
      : installedConnectorAgentCount === 0
        ? "install"
        : !hasRuntimeReadyConnector
          ? "install"
          : runtimeProofCaptured
            ? blockedScenarioCaptured ? "audit" : "blocked"
            : "approved";
    const progressSteps = [
      { id: "login", label: "Login", completed: isUserAuthenticated, explanation: "Attach verified user identity." },
      { id: "install", label: "Install Connector Agent", completed: installedConnectorAgentCount > 0, explanation: "Trust an external agent." },
      { id: "approved", label: "Run Approved Skill", completed: runtimeProofCaptured, explanation: "Execute with scoped A2A JWT." },
      { id: "blocked", label: "Show Blocked Skill", completed: blockedScenarioCaptured, explanation: "Prove blocked skills do not execute." },
      { id: "audit", label: "Show Audit", completed: activeTab === "security-timeline", explanation: "Review timeline and policy proof." }
    ];
    const checklist = [
      {
        label: "User identity verified",
        status: isUserAuthenticated ? "ready" : "needs_setup",
        cta: isUserAuthenticated ? undefined : "Login",
        action: goToTrustIdentity
      },
      {
        label: "Connector template catalog loaded",
        status: connectorTemplateCount > 0 ? "ready" : "needs_setup",
        cta: "Catalog",
        action: goToConnectorCatalog
      },
      {
        label: "Installed connector agent exists",
        status: installedConnectorAgentCount > 0 ? "ready" : "needs_setup",
        cta: installedConnectorAgentCount > 0 ? undefined : "Install",
        action: goToConnectorCatalog
      },
      {
        label: "Runtime-ready connector agent exists",
        status: hasRuntimeReadyConnector ? "ready" : installedConnectorAgentCount > 0 ? "runtime_blocked" : "needs_setup",
        cta: hasRuntimeReadyConnector ? undefined : "Review",
        action: goToInstalledConnectorAgents
      },
      { label: "Scoped JWT enabled", status: "ready", cta: undefined, action: undefined },
      { label: "Raw token hidden", status: "ready", cta: undefined, action: undefined },
      { label: "External config hash enforced", status: "ready", cta: undefined, action: undefined },
      { label: "Policy model available", status: "ready", cta: undefined, action: undefined }
    ] as const;
    const scenarioReadiness = [
      { label: "Jira diagnosis", status: readinessStatusForSkill("jira-reference", "jira.issue.diagnose_creation_failure", "approved"), proves: "Approved connector skill executes through scoped A2A JWT." },
      { label: "Jira blocked create", status: readinessStatusForSkill("jira-reference", "jira.issue.create", "blocked"), proves: "Gateway blocks unapproved skills before runtime." },
      { label: "ServiceNow incident", status: readinessStatusForSkill("servicenow-reference", "servicenow.incident.assignment.diagnose", "approved"), proves: "The route and runtime executor are connector-generic." },
      { label: "GitHub rate limit", status: readinessStatusForSkill("github-reference", "github.repository.rate_limit.diagnose", "approved"), proves: "System-specific diagnosis stays inside the external runtime." },
      { label: "Unsupported request", status: "ready", proves: "Unsupported systems get a safe ticket handoff." }
    ] as const;
    const demoScriptSteps = [
      { title: "Start with zero installed connector agents", proves: "Connector templates are not installed by default.", actionLabel: "Open Catalog", action: goToConnectorCatalog },
      { title: "Install Jira reference agent", proves: "External agents become trusted only after signed onboarding.", actionLabel: "Install Jira reference agent", action: () => applyLocalConnectorPreset(jiraPreset) },
      { title: "Run approved Jira diagnosis", proves: "Approved connector runtime execution with scoped A2A JWT.", actionLabel: "Run scenario", action: () => runScenario(approvedJiraScenario) },
      { title: "Run blocked Jira create action", proves: "Blocked or denied skills do not execute.", actionLabel: "Run scenario", action: () => runScenario(blockedJiraScenario) },
      { title: "Run ServiceNow or GitHub routing", proves: "Gateway is connector-generic, not Jira-specific.", actionLabel: "Run ServiceNow", action: () => runScenario(serviceNowScenario) }
    ];

    return (
      <section className="demo-readiness-panel" aria-label="Demo Guide progress">
        <article className="next-step-card" aria-label="Next Action">
          <div>
            <p className="active-panel-eyebrow">Next Action</p>
            <h3>{nextStep.title}</h3>
            <p>{nextStep.text}</p>
          </div>
          <div className="next-step-actions">
            <button type="button" className="scenario-run" disabled={isLoading} onClick={nextStep.primaryAction}>{nextStep.primaryLabel}</button>
            {nextStep.secondaryLabel && nextStep.secondaryAction ? (
              <button type="button" className="secondary-inline-button" onClick={nextStep.secondaryAction}>{nextStep.secondaryLabel}</button>
            ) : null}
          </div>
        </article>
        <div className="demo-path-heading">
          <p className="active-panel-eyebrow">Demo path</p>
        </div>
        <ol className="demo-progress-list" aria-label="Demo Progress">
          {progressSteps.map((step, index) => {
            const state = step.completed ? "completed" : step.id === activeProgressStep ? "active" : "waiting";
            return (
              <li className={`demo-progress-step ${state}`} key={step.id}>
                <span>{index + 1}</span>
                <div>
                  <strong>{step.label}</strong>
                  <small>{step.explanation}</small>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="demo-guide-collapsed-grid">
          <details className="readiness-checklist">
            <summary>
              <span>Proof checklist</span>
              <small>Identity, connector, runtime, and token proof.</small>
            </summary>
            <ul>
              {checklist.map((item) => (
                <li key={item.label}>
                  <span className={`check-indicator status-${demoReadinessStatusClass(item.status)}`}>{item.status === "ready" ? "OK" : "!"}</span>
                  <strong>{item.label}</strong>
                  <em>{demoReadinessStatusLabel(item.status)}</em>
                  {item.cta && item.action ? <button type="button" onClick={item.action}>{item.cta}</button> : null}
                </li>
              ))}
            </ul>
          </details>
          <details className="scenario-readiness-panel">
            <summary>
              <span>Scenario readiness</span>
              <small>Ready scenarios for the installed connector agents.</small>
            </summary>
            <div className="scenario-readiness-grid">
              {scenarioReadiness.map((item) => (
                <article key={item.label}>
                  <div className="readiness-card-heading">
                    <strong>{item.label}</strong>
                    <span className={`summary-chip status-${demoReadinessStatusClass(item.status)}`}>{demoReadinessStatusLabel(item.status)}</span>
                  </div>
                  <p><strong>What this proves:</strong> {item.proves}</p>
                </article>
              ))}
            </div>
          </details>
          <details className="demo-script-panel">
            <summary>
              <span>Full demo script</span>
              <small>Five steps, one proof point each.</small>
            </summary>
          <ol>
            {demoScriptSteps.map((step) => (
              <li key={step.title}>
                <div>
                  <strong>{step.title}</strong>
                  <p><b>What this proves:</b> {step.proves}</p>
                </div>
                <button type="button" className="secondary-inline-button" disabled={isLoading} onClick={step.action}>{step.actionLabel}</button>
              </li>
            ))}
          </ol>
            <details className="advanced-demo-script">
            <summary>Advanced proof steps</summary>
            <div className="advanced-demo-script-grid">
              <button type="button" className="secondary-inline-button" onClick={() => runScenario(gitHubScenario)}>Run GitHub rate limit</button>
              <button type="button" className="secondary-inline-button" onClick={() => runScenario(unsupportedScenario)}>Run unsupported request</button>
              <p>Change external connector config after onboarding and re-run to show stale connector configuration protection.</p>
            </div>
          </details>
          </details>
        </div>
      </section>
    );
  }

  function renderDemoGuideTab() {
    return (
      <section className="control-panel demo-guide-panel scroll-target" aria-label="Demo Guide" ref={demoGuideRootRef} tabIndex={-1}>
        <div className="demo-guide-topline">
          {renderPageHeader({
            eyebrow: "Presenter control center",
            title: "Demo Guide",
            subtitle: "Follow the guided path to present zero-trust external connector execution."
          })}
          {renderDemoReadinessPanel()}
        </div>
      </section>
    );
  }
  return renderDemoGuideTab();
}
