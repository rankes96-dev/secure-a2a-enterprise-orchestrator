import React from "react";
import type { ExtractedScreenContext } from "../types";

type ScreenContext = ExtractedScreenContext;

type DemoReadinessStatus = "ready" | "missing_connector" | "runtime_blocked" | "needs_setup" | "info";

export function DemoGuideTab({ ctx }: { ctx: ScreenContext }) {
  const {
    activeTab,
    setActiveTab,
    setMessage,
    isLoading,
    latestResponse,
    isUserAuthenticated,
    installedConnectorAgentCount,
    runtimeReadyConnectorAgentCount,
    demoGuideRootRef,
    guideToTarget,
    showGuidedStatus,
    goToTrustIdentity,
    goToRunTask,
    goToAgentRegistry,
    goToInstalledConnectorAgents,
    goToSecurityTimeline,
    applyLocalConnectorPreset,
    renderPageHeader,
    localConnectorPresets
  } = ctx;

  function demoReadinessStatusLabel(status: DemoReadinessStatus) {
    switch (status) {
      case "ready":
        return "Ready";
      case "missing_connector":
        return "Missing connector";
      case "runtime_blocked":
        return "Needs review";
      case "needs_setup":
        return "Needs setup";
      default:
        return "Info";
    }
  }

  function demoReadinessStatusClass(status: DemoReadinessStatus) {
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

  function openConnectorTestCenter() {
    setActiveTab("connector-test-center");
    showGuidedStatus("Moved to Connector Test Center");
    guideToTarget("connector-test-center");
  }

  function loadAccessPlanningFlow() {
    setMessage("I need access to the system");
    goToRunTask();
    showGuidedStatus("End-user access planning flow loaded");
  }

  function renderDemoReadinessPanel() {
    const referencePreset = localConnectorPresets[0];
    const nextStep = installedConnectorAgentCount === 0
      ? {
        title: "Install a connector agent",
        text: "BizApps / IT installs and verifies an external connector agent before employees can select that system.",
        primaryLabel: "Open Agent Registry",
        primaryAction: goToAgentRegistry,
        secondaryLabel: referencePreset ? "Load reference connector" : undefined,
        secondaryAction: referencePreset ? () => applyLocalConnectorPreset(referencePreset) : undefined
      }
      : !latestResponse
        ? {
          title: "Run the end-user access planning flow",
          text: "Start with a simple employee request, let the Gateway ask for the target system, then continue the safe check.",
          primaryLabel: "Open Run Task",
          primaryAction: loadAccessPlanningFlow,
          secondaryLabel: "Open Connector Test Center",
          secondaryAction: openConnectorTestCenter
        }
        : {
          title: "View security proof",
          text: "Show how identity, policy, token, runtime, and audit proof explain the Gateway decision.",
          primaryLabel: "Open Security Timeline",
          primaryAction: goToSecurityTimeline,
          secondaryLabel: "Open Connector Test Center",
          secondaryAction: openConnectorTestCenter
        };

    const storySteps = [
      "End user asks for help in natural language.",
      "Gateway asks a simple follow-up if the request is unclear.",
      "User selects an installed system.",
      "Connector returns a safe plan or approved diagnostic.",
      "Gateway blocks unsafe write/admin paths.",
      "BizApps / IT validates installed connectors in Test Center.",
      "Security Timeline proves the decision."
    ];
    const personas = [
      {
        title: "End user",
        text: "Any employee asking for help or access in natural language."
      },
      {
        title: "BizApps / IT",
        text: "Technical operator who installs connector agents and validates governance."
      },
      {
        title: "Security / Audit",
        text: "Reviewer who checks identity, policy, token, runtime, and audit proof."
      }
    ];
    const demoPath = [
      { label: "Agent Registry", detail: "install a reference connector.", action: goToAgentRegistry },
      { label: "Run Task", detail: "ask: I need access to the system.", action: loadAccessPlanningFlow },
      { label: "Run Task", detail: "select an installed system.", action: goToRunTask },
      { label: "Run Task", detail: "confirm the safe check.", action: goToRunTask },
      { label: "Connector Test Center", detail: "validate connector-published tests and generic Gateway tests.", action: openConnectorTestCenter },
      { label: "Security Timeline", detail: "show proof.", action: goToSecurityTimeline }
    ];
    const progressSteps = [
      { id: "install", label: "Install connector agent", completed: installedConnectorAgentCount > 0, explanation: "BizApps / IT trusts an external agent." },
      { id: "task", label: "Run end-user request", completed: Boolean(latestResponse), explanation: "Employee asks in natural language." },
      { id: "test-center", label: "Validate connector", completed: installedConnectorAgentCount > 0, explanation: "Review connector-published tests." },
      { id: "audit", label: "Show security proof", completed: activeTab === "security-timeline", explanation: "Security / Audit reviews the timeline." }
    ];
    const checklist: Array<{ label: string; status: DemoReadinessStatus; cta?: string; action?: () => void }> = [
      {
        label: "User identity verified",
        status: isUserAuthenticated ? "ready" : "needs_setup",
        cta: isUserAuthenticated ? undefined : "Login",
        action: goToTrustIdentity
      },
      {
        label: "Installed connector agents",
        status: installedConnectorAgentCount > 0 ? "ready" : "needs_setup",
        cta: installedConnectorAgentCount > 0 ? undefined : "Install",
        action: goToAgentRegistry
      },
      {
        label: "Runtime-ready connector agents",
        status: runtimeReadyConnectorAgentCount > 0 ? "ready" : installedConnectorAgentCount > 0 ? "runtime_blocked" : "needs_setup",
        cta: runtimeReadyConnectorAgentCount > 0 ? undefined : "Review",
        action: goToInstalledConnectorAgents
      },
      {
        label: "Safe plan or approved diagnostic",
        status: latestResponse ? "ready" : "info",
        cta: latestResponse ? undefined : "Run Task",
        action: goToRunTask
      },
      {
        label: "Security proof",
        status: latestResponse ? "ready" : "info",
        cta: latestResponse ? "Timeline" : undefined,
        action: goToSecurityTimeline
      }
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

        <section className="demo-story-panel" aria-label="V1 story">
          <div className="section-heading-row">
            <div>
              <p className="active-panel-eyebrow">V1 story</p>
              <h2>Natural language request, governed connector action, security proof.</h2>
            </div>
          </div>
          <ol className="demo-story-list">
            {storySteps.map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                <strong>{step}</strong>
              </li>
            ))}
          </ol>
        </section>

        <section className="demo-persona-grid" aria-label="Demo personas">
          {personas.map((persona) => (
            <article key={persona.title}>
              <h3>{persona.title}</h3>
              <p>{persona.text}</p>
            </article>
          ))}
        </section>

        <section className="demo-path-panel" aria-label="V1 demo path">
          <div className="section-heading-row">
            <div>
              <p className="active-panel-eyebrow">V1 demo path</p>
              <h2>Six concise steps</h2>
            </div>
          </div>
          <ol className="demo-script-compact">
            {demoPath.map((step, index) => (
              <li key={`${step.label}-${index}`}>
                <span>{index + 1}</span>
                <div>
                  <strong>{step.label}</strong>
                  <p>{step.detail}</p>
                </div>
                <button type="button" className="secondary-inline-button" onClick={step.action}>{step.label}</button>
              </li>
            ))}
          </ol>
        </section>

        <ol className="demo-progress-list" aria-label="Demo Progress">
          {progressSteps.map((step, index) => {
            const state = step.completed ? "completed" : index === 0 || progressSteps[index - 1]?.completed ? "active" : "waiting";
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

        <details className="readiness-checklist">
          <summary>
            <span>Proof checklist</span>
            <small>Identity, connector, safe action, and security proof.</small>
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
      </section>
    );
  }

  return (
    <section className="control-panel demo-guide-panel scroll-target" aria-label="Demo Guide" ref={demoGuideRootRef} tabIndex={-1}>
      <div className="demo-guide-topline">
        {renderPageHeader({
          eyebrow: "Presenter control center",
          title: "Demo Guide",
          subtitle: "Follow the V1 story from employee request to connector validation and security proof."
        })}
        {renderDemoReadinessPanel()}
      </div>
    </section>
  );
}
