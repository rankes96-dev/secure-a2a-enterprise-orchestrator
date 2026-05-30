import type { ResolveResponse } from "@a2a/shared";

type SecurityDecisionValue = NonNullable<ResolveResponse["securityDecision"]>["decision"];

const securityDecisionSeverity: Record<SecurityDecisionValue, number> = {
  Blocked: 4,
  NeedsApproval: 3,
  NeedsMoreContext: 2,
  Allowed: 1
};

function highestSeveritySecurityDecision(decisions: NonNullable<ResolveResponse["securityDecisions"]>): SecurityDecisionValue | undefined {
  return decisions
    .map((decision) => decision.decision)
    .sort((left, right) => securityDecisionSeverity[right] - securityDecisionSeverity[left])[0];
}

function planningResumed(response: ResolveResponse | null): boolean {
  return Boolean(
    response?.pendingInteractionResolution?.relation === "provide_missing_input" &&
    response.executionGateStack?.finalOutcome === "planned"
  );
}

function governedPlanningStatePresent(response: ResolveResponse | null): boolean {
  return Boolean(
    planningResumed(response) ||
    response?.pendingInteraction?.type === "missing_input" ||
    response?.evidence.some((item) => item.title === "Governed planning resume" || item.title === "Governed pending planning state")
  );
}

export function connectorRuntimeExecutionTruthLabel(response: ResolveResponse | null): string {
  if (!response) {
    return "No task run yet";
  }
  if (planningResumed(response)) {
    return "Connector planning resumed; runtime not executed";
  }
  if (response.connectorRuntime) {
    return response.connectorRuntime.executed ? "Connector runtime executed" : "Connector runtime not executed";
  }
  if (response.a2aResponses?.length) {
    return "A2A task response received";
  }
  return "Runtime not executed";
}

export function connectorRuntimeModeTruthLabel(response: ResolveResponse | null): string {
  if (!response) {
    return "runtime not executed";
  }
  if (planningResumed(response)) {
    return "connector planning resumed without runtime execution";
  }
  if (response.connectorRuntime?.executed === true) {
    return "external connector runtime executed";
  }
  if (response.connectorRuntime) {
    return "external connector runtime failed safely";
  }
  if (response.a2aResponses?.length) {
    return "A2A task response received";
  }
  return "runtime not executed";
}

export function tokenProofTruthLabel(response: ResolveResponse | null): string {
  if (!response) {
    return "No token proof yet";
  }
  if (planningResumed(response)) {
    return "No runtime token issued for planning";
  }
  if (response.connectorRuntime?.tokenMetadata) {
    return response.connectorRuntime.tokenMetadata.tokenIssued
      ? "Connector runtime token issued"
      : "Connector runtime token proof present; raw token hidden";
  }
  if (response.connectorRuntime) {
    return "Connector runtime token not issued";
  }
  if (response.a2aTasks?.some((task) => task.context.auth?.tokenIssued === true)) {
    return "Legacy A2A task token issued";
  }
  if (response.a2aTasks?.some((task) => task.context.auth?.tokenIssued === false || task.context.authMode === "oauth2_client_credentials_jwt")) {
    return "Legacy A2A task token not issued";
  }
  return "No token proof";
}

export function policyProofTruthLabel(response: ResolveResponse | null): string {
  if (!response) {
    return "Policy not evaluated";
  }
  if (planningResumed(response)) {
    return "Planning governance evaluated";
  }
  if (response.connectorPolicy) {
    return `Connector policy ${response.connectorPolicy.effect.replace(/_/g, " ")}`;
  }
  const decisions = response.securityDecisions ?? (response.securityDecision ? [response.securityDecision] : []);
  if (decisions.length) {
    return `A2A policy ${highestSeveritySecurityDecision(decisions)}`;
  }
  return "Policy not evaluated";
}

export function selectedWorkloadTruthLabel(response: ResolveResponse | null): string {
  if (!response) {
    return "No route selected yet";
  }
  if (governedPlanningStatePresent(response)) {
    return "connector planning state active / connector runtime not executed / 0 A2A tasks";
  }
  const connector = response.connectorRouting
    ? `connector route ${response.connectorRouting.connectorId ?? response.connectorRouting.resourceSystem ?? "selected"}`
    : undefined;
  const runtime = response.connectorRuntime ? `connector runtime ${response.connectorRuntime.executed ? "executed" : "not executed"}` : undefined;
  const selectedAgents = `${response.selectedAgents.length} selected agents`;
  const tasks = `${response.a2aTasks?.length ?? 0} A2A tasks`;
  return [connector, runtime, selectedAgents, tasks].filter(Boolean).join(" / ");
}
