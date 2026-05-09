import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentsHealthResponse, ResolveResponse } from "@a2a/shared";
import "./styles.css";

const API_URL = import.meta.env.VITE_ORCHESTRATOR_API_URL ?? "http://localhost:4000";
const sampleMessage = "Jira issue creation fails with 403 when creating issues in FIN project";

type Scenario = {
  label: string;
  message: string;
  subtitle: string;
  purpose?: string;
  badge?: string;
};

const scenarios: Array<{ category: string; items: Scenario[] }> = [
  {
    category: "Connector-first orchestration",
    items: [
      {
        label: "Jira connector approved diagnosis",
        message: "Jira issue creation fails with 403 when creating issues in FIN project",
        subtitle: "Approved Jira connector skill when the reference connector is onboarded",
        purpose: "Routes to the onboarded Jira connector profile and approved diagnosis skill.",
        badge: "Approved connector"
      },
      {
        label: "Jira create blocked by grants/permissions",
        message: "Create a Jira issue in FIN project for this outage",
        subtitle: "Blocked because the create action lacks grant/permission approval by default",
        purpose: "Shows why an onboarded connector can be valid while a specific action is blocked.",
        badge: "Blocked action"
      },
      {
        label: "ServiceNow incident assignment",
        message: "ServiceNow incident assignment keeps failing for network tickets",
        subtitle: "Runs when the ServiceNow reference connector is onboarded",
        purpose: "Routes to the ServiceNow connector profile and incident assignment diagnosis skill.",
        badge: "ServiceNow"
      },
      {
        label: "ServiceNow catalog request",
        message: "ServiceNow catalog request RITM keeps failing during approval",
        subtitle: "Catalog request diagnosis through the ServiceNow connector",
        purpose: "Shows another ServiceNow skill selected from the same connector profile.",
        badge: "ServiceNow"
      },
      {
        label: "GitHub repository rate limit",
        message: "GitHub repository sync is failing after API rate limit",
        subtitle: "Runs when the GitHub reference connector is onboarded",
        purpose: "Routes to the GitHub connector profile and rate-limit diagnosis skill.",
        badge: "GitHub"
      },
      {
        label: "GitHub pull request access",
        message: "GitHub pull request checks cannot read the repository",
        subtitle: "Pull request access diagnosis through the GitHub connector",
        purpose: "Shows connector-specific runtime diagnosis without Gateway-specific GitHub logic.",
        badge: "GitHub"
      },
      {
        label: "Unsupported request",
        message: "The warehouse robot arm calibration failed",
        subtitle: "No supported connector profile in this demo",
        purpose: "Offers a support ticket handoff instead of pretending a connector exists.",
        badge: "Unsupported"
      }
    ]
  }
];

type ActiveTab = "run-task" | "agent-registry" | "trust-identity" | "security-timeline";
type ResolveA2ATask = NonNullable<ResolveResponse["a2aTasks"]>[number];
type GuidedFocusTarget =
  | "run-task"
  | "composer"
  | "gateway-response"
  | "security-summary"
  | "trust-login"
  | "agent-registry"
  | "connector-catalog"
  | "zero-trust-onboarding"
  | "registered-agents"
  | "legacy-agents"
  | "security-timeline";

type ConnectionAudience = "bizapps" | "developer";
type ConnectionWizardStep =
  | "overview"
  | "gateway-registration"
  | "connection-input"
  | "discovery"
  | "verify"
  | "result";

const tabs: Array<{ id: ActiveTab; label: string }> = [
  { id: "run-task", label: "Run Task" },
  { id: "agent-registry", label: "Agent Registry" },
  { id: "trust-identity", label: "Trust & Identity" },
  { id: "security-timeline", label: "Security Timeline" }
];

const localConnectorPresets = [
  {
    label: "Use local Jira reference agent",
    agentBaseUrl: "http://localhost:4201",
    expectedAgentId: "external-jira-agent",
    expectedResourceSystem: "jira",
    expectedConnectorId: "jira-reference"
  },
  {
    label: "Use local ServiceNow reference agent",
    agentBaseUrl: "http://localhost:4202",
    expectedAgentId: "external-servicenow-agent",
    expectedResourceSystem: "servicenow",
    expectedConnectorId: "servicenow-reference"
  },
  {
    label: "Use local GitHub reference agent",
    agentBaseUrl: "http://localhost:4203",
    expectedAgentId: "external-github-agent",
    expectedResourceSystem: "github",
    expectedConnectorId: "github-reference"
  }
];

const fallbackSupportedConnectorGuardrails: SupportedConnectorGuardrail[] = [
  {
    resourceSystem: "jira",
    connectorId: "jira-reference",
    displayName: "Jira Cloud Reference Connector",
    status: "available",
    source: "local_reference",
    description: "Reference connector template for Jira issue diagnostics, permission inspection, and controlled issue creation demos.",
    category: "Work Management",
    publisher: "Secure A2A Reference",
    templateVersion: "1.0.0",
    authModel: "oauth_application_with_service_account",
    runtimeSupport: "supported",
    riskLevel: "medium",
    tags: ["jira", "issues", "permissions", "work-management"],
    setupRequirements: ["External agent discovery endpoint", "Gateway public registration", "OAuth application grants", "Service account permission attestation"],
    installed: false,
    installedCount: 0
  },
  {
    resourceSystem: "servicenow",
    connectorId: "servicenow-reference",
    displayName: "ServiceNow Reference Connector",
    status: "available",
    source: "local_reference",
    description: "Reference connector template for ServiceNow incident, catalog request, role, and ACL diagnostics.",
    category: "ITSM",
    publisher: "Secure A2A Reference",
    templateVersion: "1.0.0",
    authModel: "oauth_application_with_service_account",
    runtimeSupport: "supported",
    riskLevel: "medium",
    tags: ["servicenow", "incident", "catalog", "itsm", "acl"],
    setupRequirements: ["External agent discovery endpoint", "Gateway public registration", "OAuth application grants", "Service account role and ACL attestation"],
    installed: false,
    installedCount: 0
  },
  {
    resourceSystem: "github",
    connectorId: "github-reference",
    displayName: "GitHub Reference Connector",
    status: "available",
    source: "local_reference",
    description: "Reference connector template for GitHub repository, pull request, installation access, and rate-limit diagnostics.",
    category: "DevOps",
    publisher: "Secure A2A Reference",
    templateVersion: "1.0.0",
    authModel: "oauth_application_with_service_account",
    runtimeSupport: "supported",
    riskLevel: "medium",
    tags: ["github", "repository", "pull-request", "rate-limit", "devops"],
    setupRequirements: ["External agent discovery endpoint", "Gateway public registration", "App installation access attestation", "Repository permission attestation"],
    installed: false,
    installedCount: 0
  },
  {
    resourceSystem: "custom",
    connectorId: "custom-sdk",
    displayName: "Custom Connector SDK",
    status: "planned",
    source: "custom_sdk",
    description: "Build your own connector using the Secure A2A connector contract. Planned for V2.",
    category: "Custom",
    publisher: "Customer / Vendor",
    templateVersion: "planned",
    authModel: "custom_sdk_contract",
    runtimeSupport: "planned",
    riskLevel: "medium",
    tags: ["custom", "sdk", "bring-your-own-connector"],
    setupRequirements: ["Discovery document", "Connector profile", "Public JWKS", "Signed onboarding response", "Scoped runtime endpoint"],
    installed: false,
    installedCount: 0
  }
];

const fallbackConnectorTemplateById = new Map(fallbackSupportedConnectorGuardrails.map((template) => [template.connectorId, template]));

function enrichConnectorTemplate(template: SupportedConnectorGuardrail): SupportedConnectorGuardrail {
  return {
    ...fallbackConnectorTemplateById.get(template.connectorId),
    ...template
  };
}

const quickScenarioLabels = new Set([
  "Jira connector approved diagnosis",
  "Jira create blocked by grants/permissions",
  "ServiceNow incident assignment",
  "ServiceNow catalog request",
  "GitHub repository rate limit",
  "GitHub pull request access",
  "Unsupported request"
]);

const allScenarios: Scenario[] = scenarios.flatMap((group) => group.items);
const quickScenarios = allScenarios.filter((scenario) => quickScenarioLabels.has(scenario.label));
const advancedScenarios = allScenarios.filter((scenario) => !quickScenarioLabels.has(scenario.label));
const infrastructureAgentIds = new Set(["mock-identity-provider"]);
const installedConnectorLifecycleLabels = {
  runtime_ready: "Runtime ready",
  verified: "Verified",
  needs_reverification: "Needs re-verification",
  runtime_blocked: "Runtime blocked",
  installed: "Installed",
  disabled: "Disabled",
  revoked: "Revoked"
} as const;

function inferDemoFlowType(response: ResolveResponse): string {
  if (response.connectorRouting) {
    return "Connector-first orchestration";
  }

  if (response.requestInterpretation?.scope === "out_of_scope" || response.routingReasoningSummary.toLowerCase().includes("outside the supported enterprise") || response.agentTrace.some((entry) => entry.action === "out_of_scope")) {
    return "Out of scope";
  }

  if (response.agentTrace.some((entry) => entry.action === "manual_incident_recommended")) {
    return "Manual incident workflow";
  }

  if (response.requestInterpretation?.scope === "manual_enterprise_workflow") {
    return "Manual service request";
  }

  if (response.resolutionStatus === "unsupported") {
    return "Unsupported/manual workflow";
  }

  if (response.securityDecisions?.some((decision) => decision.decision === "Blocked" || decision.decision === "NeedsApproval" || decision.decision === "NeedsMoreContext")) {
    return "Security policy";
  }

  if (response.classification.supportMode === "end_user_support") {
    return "End-user support";
  }

  return "Technical integration";
}

function decisionClass(decision: string): string {
  return `decision-${decision.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}`;
}

function routingDescription(response: ResolveResponse): string {
  if (response.routingSource === "ai") {
    return "Secondary AI router selected agents using Agent Cards.";
  }

  if (response.requestInterpretation?.interpretationSource === "ai") {
    return "AI interpreted the request. Deterministic fallback handled agent selection.";
  }

  if (response.requestInterpretation?.interpretationSource === "fallback") {
    return "Deterministic request interpretation fallback was used.";
  }

  return "Deterministic capability routing/fallback handled agent selection.";
}

function metadataItem(label: string, value: unknown): { label: string; value: string } | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (Array.isArray(value)) {
    return { label, value: value.length ? value.join(", ") : "none" };
  }

  return { label, value: String(value) };
}

function metadataList(items: Array<{ label: string; value: unknown }>): Array<{ label: string; value: string }> {
  return items.map((item) => metadataItem(item.label, item.value)).filter((item): item is { label: string; value: string } => Boolean(item));
}

function policyStatus(decision: string): SecurityTimelineStatus {
  if (decision === "Allowed") {
    return "success";
  }

  if (decision === "Blocked") {
    return "blocked";
  }

  return "warning";
}

function agentResponseStatus(status: string): SecurityTimelineStatus {
  if (status === "diagnosed" || status === "completed") {
    return "success";
  }

  if (status === "blocked" || status === "error") {
    return "blocked";
  }

  return "warning";
}

function finalStatus(status: ResolveResponse["resolutionStatus"]): SecurityTimelineStatus {
  if (status === "resolved") {
    return "success";
  }

  if (status === "unsupported") {
    return "warning";
  }

  return "info";
}

function securityDecisions(response: ResolveResponse | null): NonNullable<ResolveResponse["securityDecisions"]> {
  if (!response) {
    return [];
  }

  return response.securityDecisions ?? (response.securityDecision ? [response.securityDecision] : []);
}

function primaryPolicyLabel(response: ResolveResponse | null): string {
  const decisions = securityDecisions(response);
  if (decisions.some((decision) => decision.decision === "Blocked")) {
    return "Blocked";
  }
  if (decisions.some((decision) => decision.decision === "NeedsApproval")) {
    return "NeedsApproval";
  }
  if (decisions.some((decision) => decision.decision === "NeedsMoreContext")) {
    return "NeedsMoreContext";
  }
  if (decisions.some((decision) => decision.decision === "Allowed")) {
    return "Allowed";
  }

  return "none";
}

function tokenStatusLabel(response: ResolveResponse | null): string {
  const tasks = response?.a2aTasks ?? [];
  if (!tasks.length) {
    return "not applicable";
  }
  if (tasks.some((task) => task.context.auth?.tokenIssued === true)) {
    return "issued";
  }
  if (tasks.some((task) => task.context.auth?.tokenIssued === false || task.context.authMode === "oauth2_client_credentials_jwt")) {
    return "not issued";
  }

  return "not applicable";
}

function delegationLabel(response: ResolveResponse | null): string {
  if (!response) {
    return "no";
  }

  const taskDelegation = response.a2aTasks?.some((task) => (task.delegationDepth ?? 0) > 0 || Boolean(task.mediatedBy)) ?? false;
  const traceDelegation = [...response.executionTrace, ...response.agentTrace].some((entry) => entry.action.toLowerCase().includes("delegation"));
  return taskDelegation || traceDelegation ? "yes" : "no";
}

function cockpitStatusClass(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes("allowed") || normalized.includes("verified") || normalized.includes("issued") || normalized.includes("resolved") || normalized === "yes") {
    return "success";
  }
  if (normalized.includes("blocked") || normalized.includes("required") || normalized.includes("not issued")) {
    return "blocked";
  }
  if (normalized.includes("approval") || normalized.includes("needs") || normalized.includes("unsupported")) {
    return "warning";
  }

  return "neutral";
}

function lastResultLabel(response: ResolveResponse | null): string {
  if (!response) {
    return "No task run yet";
  }

  const policy = primaryPolicyLabel(response);
  if (policy === "Blocked") {
    return "blocked";
  }
  if (policy === "NeedsApproval") {
    return "needs approval";
  }

  return response.resolutionStatus;
}

function statusDisplayLabel(value: string): string {
  const normalized = value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim();
  return normalized ? normalized.toUpperCase() : "NO TASK RUN YET";
}

function connectorRoutingStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    connector_skill_approved: "Connector skill approved",
    connector_skill_blocked: "Connector skill blocked",
    connector_skill_not_declared: "Connector skill not enabled",
    connector_skill_not_enabled: "Connector skill not enabled",
    connector_not_onboarded: "Connector template supported, but no agent installed",
    unsupported: "Unsupported request",
    needs_more_info: "Needs more information"
  };

  return labels[status] ?? statusDisplayLabel(status);
}

function connectorRoutingStatusClass(status: string): string {
  if (status === "connector_skill_approved") {
    return "success";
  }

  if (status === "connector_skill_blocked" || status === "connector_skill_not_declared" || status === "connector_skill_not_enabled" || status === "connector_not_onboarded" || status === "unsupported") {
    return "warning";
  }

  return "neutral";
}

function shortHash(value?: string): string {
  return value ? value.slice(0, 12) : "not declared";
}

function connectorRuntimeFailureCopy(error?: string, message?: string): { title: string; body: string; nextStep?: string } {
  if (error === "connector_configuration_changed") {
    return {
      title: "Needs re-verification",
      body: message ?? "The external connector configuration changed after the Gateway trusted its onboarding attestation.",
      nextStep: "Re-run Gateway onboarding to refresh trusted connector attestation."
    };
  }

  if (error === "skill_not_currently_approved") {
    return {
      title: "Connector runtime refused execution",
      body: message ?? "The skill is no longer approved by current connector configuration.",
      nextStep: "Enable the skill and required access in the external admin console, then re-run Gateway onboarding."
    };
  }

  return {
    title: "Connector approved, runtime failed safely",
    body: message ?? error ?? "External connector runtime failed.",
    nextStep: "Check the local external agent and Mock IdP, then retry."
  };
}

function firstSentence(text: string, maxLength = 190): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "No gateway response has been generated yet.";
  }

  const sentenceMatch = trimmed.match(/^(.+?[.!?])(\s|$)/);
  const sentence = sentenceMatch?.[1] ?? trimmed;
  if (sentence.length <= maxLength) {
    return sentence;
  }

  const clipped = sentence.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 80 ? lastSpace : maxLength).trim()}...`;
}

function recommendedActionItems(text: string): string[] {
  const items = text
    .split(/[;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length ? items : [text.trim()].filter(Boolean);
}

function policyOutcomeLabel(policy: string): string {
  if (policy === "Allowed") {
    return "Policy allowed";
  }
  if (policy === "Blocked") {
    return "Policy blocked";
  }
  if (policy === "NeedsApproval") {
    return "Policy needs approval";
  }
  if (policy === "NeedsMoreContext") {
    return "Policy needs more context";
  }

  return "Policy not evaluated";
}

function tokenOutcomeLabel(token: string): string {
  if (token === "issued") {
    return "Scoped token issued";
  }
  if (token === "not issued") {
    return "Scoped token not issued";
  }

  return "No token issued yet";
}

function buildSecurityTimelineEvents(response: ResolveResponse): SecurityTimelineEvent[] {
  const events: SecurityTimelineEvent[] = [];
  const firstTraceTimestamp = response.executionTrace[0]?.timestamp ?? response.agentTrace[0]?.timestamp;

  events.push({
    id: "identity-verified",
    category: "identity",
    title: "User identity verified",
    description: `Verified user ${response.userIdentity.email ?? "unknown"} was attached to this gateway session.`,
    status: "success",
    timestamp: firstTraceTimestamp,
    actor: response.userIdentity.email,
    metadata: metadataList([
      { label: "Email", value: response.userIdentity.email },
      { label: "Roles", value: response.userIdentity.roles ?? [] }
    ])
  });

  if (response.requestInterpretation) {
    events.push({
      id: "request-interpreted",
      category: "routing",
      title: "Request interpreted",
      description: "Gateway classified the user request before routing.",
      status: response.requestInterpretation.confidence === "high" ? "success" : "info",
      timestamp: response.executionTrace.find((entry) => entry.action === "interpret_request")?.timestamp,
      actor: "orchestrator",
      metadata: metadataList([
        { label: "Scope", value: response.requestInterpretation.scope },
        { label: "Intent", value: response.requestInterpretation.intentType },
        { label: "Target system", value: response.requestInterpretation.targetSystemText },
        { label: "Capability", value: response.requestInterpretation.requestedCapability },
        { label: "Action", value: response.requestInterpretation.requestedActionText }
      ])
    });
  }

  for (const [index, agent] of response.selectedAgents.entries()) {
    events.push({
      id: `selected-agent-${agent.agentId}-${agent.skillId ?? index}`,
      category: "routing",
      title: "Agent Card selected",
      description: `Gateway selected ${agent.agentId} based on capability metadata.`,
      status: "success",
      timestamp: response.agentTrace.find((entry) => entry.action === "select_agent" && entry.detail.includes(agent.agentId))?.timestamp,
      agentId: agent.agentId,
      metadata: metadataList([
        { label: "Agent ID", value: agent.agentId },
        { label: "Skill", value: agent.skillId },
        { label: "Capability", value: agent.matchedCapability },
        { label: "Reason", value: agent.reason }
      ])
    });
  }

  for (const [index, decision] of (response.securityDecisions ?? (response.securityDecision ? [response.securityDecision] : [])).entries()) {
    events.push({
      id: `policy-${decision.target}-${decision.requestedAction}-${index}`,
      category: "policy",
      title: `Policy decision: ${decision.decision}`,
      description: decision.reason,
      status: policyStatus(decision.decision),
      timestamp: response.agentTrace.find((entry) => entry.action.includes("POLICY") || entry.action.includes("SECURITY"))?.timestamp,
      actor: decision.caller,
      agentId: decision.target,
      metadata: metadataList([
        { label: "Agent", value: decision.target },
        { label: "Requested action", value: decision.requestedAction },
        { label: "Required permission", value: decision.requiredPermission },
        { label: "Matched policy", value: decision.matchedPolicy }
      ])
    });
  }

  for (const task of response.a2aTasks ?? []) {
    const actorAttached = Boolean(task.context.actor?.email || task.context.auth?.actor || task.context.auth?.actorRoles?.length);
    events.push({
      id: `task-${task.taskId}`,
      category: "agent",
      title: "A2A task created",
      description: `Task envelope created for ${task.toAgent}.`,
      status: "info",
      timestamp: response.executionTrace.find((entry) => entry.taskId === task.taskId)?.timestamp,
      actor: task.fromAgent,
      agentId: task.toAgent,
      metadata: metadataList([
        { label: "Task ID", value: task.taskId },
        { label: "To agent", value: task.toAgent },
        { label: "Skill", value: task.skillId },
        { label: "Auth mode", value: task.context.authMode },
        { label: "Actor attached", value: actorAttached ? "yes" : "no" }
      ])
    });

    const auth = task.context.auth;
    if (auth?.tokenIssued === true) {
      events.push({
        id: `token-issued-${task.taskId}`,
        category: "token",
        title: "Scoped A2A JWT issued",
        description: "Gateway requested an audience-bound scoped token for the selected agent. Raw token hidden.",
        status: "success",
        timestamp: response.executionTrace.find((entry) => entry.taskId === task.taskId && entry.action.includes("attach"))?.timestamp,
        actor: auth.actor ?? task.context.actor?.email,
        agentId: task.toAgent,
        metadata: metadataList([
          { label: "Audience", value: auth.audience },
          { label: "Scope", value: auth.scope },
          { label: "Token auth method", value: auth.tokenAuthMethod },
          { label: "Actor", value: auth.actor ?? task.context.actor?.email },
          { label: "Actor roles", value: auth.actorRoles ?? task.context.actor?.roles },
          { label: "Raw token", value: "hidden" }
        ])
      });
    } else if (auth?.authMode === "oauth2_client_credentials_jwt" || task.context.authMode === "oauth2_client_credentials_jwt") {
      events.push({
        id: `token-not-issued-${task.taskId}`,
        category: "token",
        title: "Scoped A2A token not issued",
        description: auth?.validationReason ?? "JWT mode was expected, but token issuance was not completed.",
        status: auth?.validationReason?.toLowerCase().includes("failed") ? "blocked" : "warning",
        timestamp: response.executionTrace.find((entry) => entry.taskId === task.taskId && entry.action.includes("token"))?.timestamp,
        agentId: task.toAgent,
        metadata: metadataList([
          { label: "Audience", value: auth?.audience ?? task.context.targetAudience },
          { label: "Scope", value: auth?.scope ?? task.context.requestedScope },
          { label: "Raw token", value: "hidden" }
        ])
      });
    }

    if ((task.delegationDepth ?? 0) > 0 || task.mediatedBy) {
      events.push({
        id: `delegation-task-${task.taskId}`,
        category: "delegation",
        title: "Delegation mediated by gateway",
        description: "Agent requested help from another agent; gateway mediated the call.",
        status: "success",
        timestamp: response.executionTrace.find((entry) => entry.taskId === task.taskId)?.timestamp,
        actor: task.fromAgent,
        agentId: task.toAgent,
        metadata: metadataList([
          { label: "From", value: task.fromAgent },
          { label: "To", value: task.toAgent },
          { label: "Mediated by", value: task.mediatedBy },
          { label: "Delegation depth", value: task.delegationDepth }
        ])
      });
    }
  }

  const traceDelegation = [...response.executionTrace, ...response.agentTrace].find((entry) => entry.action.toLowerCase().includes("delegation"));
  if (traceDelegation && !events.some((event) => event.category === "delegation")) {
    events.push({
      id: "delegation-trace",
      category: "delegation",
      title: "Delegation mediated by gateway",
      description: "Agent requested help from another agent; gateway mediated the call.",
      status: traceDelegation.decision === "Blocked" ? "blocked" : "info",
      timestamp: traceDelegation.timestamp,
      actor: "actor" in traceDelegation ? traceDelegation.actor : traceDelegation.agent,
      agentId: traceDelegation.toAgent,
      metadata: metadataList([
        { label: "Action", value: traceDelegation.action },
        { label: "From", value: traceDelegation.fromAgent },
        { label: "To", value: traceDelegation.toAgent },
        { label: "Depth", value: traceDelegation.delegationDepth }
      ])
    });
  }

  for (const [index, agentResponse] of (response.a2aResponses ?? []).entries()) {
    events.push({
      id: `agent-response-${agentResponse.agentId}-${index}`,
      category: "response",
      title: "Agent response received",
      description: `${agentResponse.agentId} returned ${agentResponse.status}.`,
      status: agentResponseStatus(agentResponse.status),
      timestamp: agentResponse.trace?.[0]?.timestamp,
      agentId: agentResponse.agentId,
      metadata: metadataList([
        { label: "Agent ID", value: agentResponse.agentId },
        { label: "Status", value: agentResponse.status },
        { label: "Summary", value: agentResponse.summary }
      ])
    });
  }

  events.push({
    id: "final-answer",
    category: "audit",
    title: "Final answer generated",
    description: "Gateway summarized agent findings and returned response.",
    status: finalStatus(response.resolutionStatus),
    timestamp: response.executionTrace[response.executionTrace.length - 1]?.timestamp,
    actor: "orchestrator",
    metadata: metadataList([
      { label: "Resolution status", value: response.resolutionStatus },
      { label: "Selected agents", value: response.selectedAgents.length },
      { label: "A2A tasks", value: response.a2aTasks?.length ?? 0 },
      { label: "Final answer", value: response.finalAnswer }
    ])
  });

  return events;
}

function securityTimelineFilterMatches(event: SecurityTimelineEvent, filter: SecurityTimelineFilter): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "response-audit") {
    return event.category === "response" || event.category === "audit";
  }

  return event.category === filter;
}

function safeTaskAuthMetadata(auth: ResolveA2ATask["context"]["auth"] | undefined) {
  if (!auth) {
    return undefined;
  }

  return {
    authMode: auth.authMode,
    issuer: auth.issuer,
    audience: auth.audience,
    scope: auth.scope,
    tokenIssued: auth.tokenIssued,
    tokenValidated: auth.tokenValidated,
    validationReason: auth.validationReason,
    delegatedBy: auth.delegatedBy,
    delegationDepth: auth.delegationDepth,
    parentTaskId: auth.parentTaskId,
    requestedByAgent: auth.requestedByAgent,
    actor: auth.actor,
    actorRoles: auth.actorRoles,
    tokenAuthMethod: auth.tokenAuthMethod,
    rawToken: "hidden"
  };
}

function safeRawExecutionData(response: ResolveResponse) {
  return {
    userIdentity: response.userIdentity,
    requestInterpretation: response.requestInterpretation,
    connectorRouting: response.connectorRouting,
    connectorRuntime: response.connectorRuntime,
    selectedAgents: response.selectedAgents,
    securityDecisions: response.securityDecisions ?? (response.securityDecision ? [response.securityDecision] : []),
    executionTrace: response.executionTrace,
    agentTrace: response.agentTrace,
    a2aTasks: response.a2aTasks?.map((task) => ({
      taskId: task.taskId,
      fromAgent: task.fromAgent,
      toAgent: task.toAgent,
      skillId: task.skillId,
      mediatedBy: task.mediatedBy,
      delegationDepth: task.delegationDepth,
      actor: task.context.actor,
      auth: safeTaskAuthMetadata(task.context.auth)
    })) ?? [],
    a2aResponses: response.a2aResponses?.map((agentResponse) => ({
      agentId: agentResponse.agentId,
      status: agentResponse.status,
      summary: agentResponse.summary,
      evidence: agentResponse.evidence,
      trace: agentResponse.trace
    })) ?? []
  };
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}

function healthClass(status: string): string {
  return `health-${status}`;
}

function endpointMetadata(endpoint: string | undefined): { endpointType: AgentCardEndpointType; endpointScheme: AgentCardEndpointScheme } {
  if (!endpoint) {
    return { endpointType: "unknown", endpointScheme: "unknown" };
  }

  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol === "session:") {
      return { endpointType: "session", endpointScheme: "session" };
    }
    if (parsed.protocol === "https:") {
      return { endpointType: "public", endpointScheme: "https" };
    }
    if (parsed.protocol === "http:") {
      return { endpointType: "public", endpointScheme: "http" };
    }
  } catch {
    return { endpointType: "unknown", endpointScheme: "unknown" };
  }

  return { endpointType: "unknown", endpointScheme: "unknown" };
}

function endpointTypeLabel(endpointType: AgentCardEndpointType | "internal", endpointScheme?: AgentCardEndpointScheme): string {
  if (endpointType === "public" && endpointScheme && endpointScheme !== "unknown") {
    return `public ${endpointScheme}`;
  }

  return endpointType;
}

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  status?: "loading" | "done";
  metadata?: ResolveResponse;
};

type AgentCardEndpointType = "public" | "session" | "unknown";
type AgentCardEndpointScheme = "https" | "http" | "session" | "unknown";

type DerivedCapability = {
  capability: string;
  label?: string;
  reason: string;
  requiredApplicationGrants?: string[];
  requiredEffectivePermissions?: string[];
  missingApplicationGrants?: string[];
  missingEffectivePermissions?: string[];
  deniedEffectivePermissions?: string[];
};

type TrustedOnboardedAgent = {
  agentId: string;
  issuer: string;
  clientId: string;
  audience: string;
  runtimeEndpoint?: string;
  connectorProfileUrl?: string;
  connectorId?: string;
  resourceSystem?: string;
  connectorDisplayName?: string;
  requestedScopes: string[];
  requestedApplicationGrants?: string[];
  agentDeclaredSkills?: string[];
  agentDeclaredCapabilities: string[];
  applicationAccessGrants?: string[];
  grantedScopes: string[];
  approvedActions?: DerivedCapability[];
  blockedActions?: DerivedCapability[];
  approvedCapabilities: DerivedCapability[];
  blockedCapabilities: DerivedCapability[];
  connectorProfile?: ConnectorProfileSummary;
  connectorProfileVerified?: boolean;
  lifecycle?: {
    state: "installed" | "verified" | "runtime_ready" | "needs_reverification" | "runtime_blocked" | "disabled" | "revoked";
    label: string;
    reason: string;
  };
  connectorDecisionSource?: string;
  externalConfigHash?: string;
  connectorProfileHash?: string;
  resourcePrincipal?: string;
  trustLevel: "untrusted" | "schema_valid" | "oauth_bound" | "signed_response_verified" | "endpoint_control_verified" | "trusted_metadata_only" | "executable_pending_runtime_validation";
  executable: false;
  executionState: "metadata_only";
  tokenEndpointAuthMethod: "private-key-jwt" | "client-secret-post" | "unknown";
  oauthApplicationBound: boolean;
};

type AgentOnboardingResult = {
  onboardingId: string;
  status: "trusted_metadata_only";
  trustLevel: TrustedOnboardedAgent["trustLevel"];
  discoveredAgent: {
    agentId: string;
    issuer: string;
    clientId: string;
    audience: string;
    requestedScopes: string[];
    requestedApplicationGrants?: string[];
    agentDeclaredSkills?: string[];
    agentDeclaredCapabilities: string[];
  };
  agent: {
    agentId: string;
    issuer: string;
    clientId: string;
    audience: string;
  };
  gatewayProof: {
    gatewayClientId: string;
    gatewayIssuer: string;
    signedChallengeVerifiedByAgent: boolean;
    rawAssertionExposed: false;
  };
  agentProof: {
    discoveryFetched: boolean;
    externalAgentContacted: boolean;
    signedResponseVerified: boolean;
    nonceMatched: boolean;
  };
  oauthApplicationProof: {
    clientBound: boolean;
    applicationAccessGrants?: string[];
    grantedScopes: string[];
    missingRequestedApplicationGrants?: string[];
    allowedClientId?: string;
    tokenEndpointAuthMethod?: "private-key-jwt" | "client-secret-post" | "unknown";
    status?: "active" | "disabled";
  };
  resourcePermissionProof: {
    principal: string;
    effectivePermissions: string[];
    deniedPermissions: string[];
  };
  externalApplicationAttestation?: {
    resourceSystem?: string;
    connectorId?: string;
    connectorProfileUrl?: string;
    connectorProfileHash?: string;
    externalConfigHash?: string;
    trustAdapter?: string;
    oauthApplication?: {
      appName?: string;
      clientId: string;
      authorizationServerIssuer: string;
      applicationAccessGrants?: string[];
      grantedScopes: string[];
      tokenEndpointAuthMethod: string;
      status: string;
    };
    servicePrincipal?: {
      principalType: string;
      principalId: string;
      effectivePermissions: string[];
      deniedPermissions: string[];
    };
  };
  connectorProfile?: ConnectorProfileSummary;
  connectorProfileVerified: boolean;
  connectorDecisionSource: string;
  skillDecision?: {
    approvedActions: DerivedCapability[];
    blockedActions: DerivedCapability[];
  };
  capabilityDecision: {
    approvedCapabilities: DerivedCapability[];
    blockedCapabilities: DerivedCapability[];
  };
  checks: Array<{ name: string; status: "passed" | "failed" | "metadata_only"; detail?: string }>;
  message: string;
  trustedAgent: TrustedOnboardedAgent;
  trustedAgents?: TrustedOnboardedAgent[];
};

type ConnectorProfileSummary = {
  connectorId: string;
  resourceSystem: string;
  displayName: string;
  version: string;
  profileSource: "external_agent" | "built_in_reference" | "custom_connector";
};

type GatewayRegistrationMetadata = {
  gatewayId: string;
  issuer: string;
  clientId: string;
  jwksUri: string;
  supportedOnboardingMethods: string[];
};

type SupportedConnectorGuardrail = {
  resourceSystem: string;
  connectorId: string;
  displayName: string;
  status: "available" | "coming_soon" | "planned";
  source?: "local_reference" | "custom_sdk";
  description?: string;
  category?: "ITSM" | "DevOps" | "Work Management" | "Custom";
  publisher?: string;
  templateVersion?: string;
  authModel?: "oauth_application_with_service_account" | "custom_sdk_contract";
  runtimeSupport?: "supported" | "planned" | "not_supported";
  riskLevel?: "low" | "medium" | "high";
  tags?: string[];
  docsUrl?: string;
  setupRequirements?: string[];
  installed?: boolean;
  installedCount?: number;
};

type AgentDiscoveryMetadata = {
  agentId: string;
  issuer: string;
  resourceSystem?: string;
  connectorId?: string;
  connectorDisplayName?: string;
  connectorProfileUrl?: string;
  externalConfigHash?: string;
  supportedConnectorProfileUrl?: string;
  trustAdapter?: string;
  jwksUri: string;
  onboardingEndpoint: string;
  runtimeEndpoint: string;
  adminConsoleUrl?: string;
  auth: {
    audience: string;
    tokenEndpointAuthMethod: "private_key_jwt" | "client_secret_post" | "unknown";
  };
  connectionRequirements?: {
    requiresGatewayRegistration: boolean;
    requiresOAuthApplication: boolean;
    requiresServicePrincipal: boolean;
  };
};

type AgentOnboardingDiscoveryResult = {
  discovered: true;
  agentBaseUrl: string;
  expectedAgentId: string;
  discovery: AgentDiscoveryMetadata;
  gatewayRegistration: GatewayRegistrationMetadata;
  connectionInstructions: {
    admin: string[];
    externalAgentDeveloper: string[];
  };
  checks: AgentOnboardingResult["checks"];
};

type RegisteredAgentSource = "zero-trust-onboarded" | "built-in" | "infrastructure";

type RegisteredAgentRow = {
  agentId: string;
  status: string;
  endpointType: AgentCardEndpointType | "internal";
  endpointScheme: AgentCardEndpointScheme;
  authMode: string;
  latencyMs?: number;
  agentCardAvailable: boolean;
  error?: string;
  canDelete: boolean;
  source: RegisteredAgentSource;
  trustLevel?: TrustedOnboardedAgent["trustLevel"];
  requestedScopes?: string[];
  agentDeclaredSkills?: string[];
  agentDeclaredCapabilities?: string[];
  grantedScopes?: string[];
  approvedActions?: DerivedCapability[];
  blockedActions?: DerivedCapability[];
  approvedCapabilities?: DerivedCapability[];
  blockedCapabilities?: DerivedCapability[];
  resourcePrincipal?: string;
  runtimeEndpoint?: string;
  connectorId?: string;
  resourceSystem?: string;
  connectorDisplayName?: string;
  externalConfigHash?: string;
  connectorProfileVerified?: boolean;
  lifecycle?: {
    state: "installed" | "verified" | "runtime_ready" | "needs_reverification" | "runtime_blocked" | "disabled" | "revoked";
    label: string;
    reason: string;
  };
  oauthApplicationBound?: boolean;
  executable?: boolean;
  executionState?: "metadata_only";
};

type IdentitySessionResponse = {
  authenticated: boolean;
  user: {
    email: string;
    name?: string;
    roles: string[];
  } | null;
  issuer: string;
  audience: "secure-a2a-gateway";
};

type TrustStatusResponse = {
  userIdentity: IdentitySessionResponse & {
    rawTokenExposed: false;
  };
  gatewayIdentity: {
    agentId: string;
    a2aAuthMode: string;
    secureAuthRequired: boolean;
    tokenAuthMethod: "private-key-jwt" | "client-secret-post" | "unknown";
    actorPropagationEnabled: boolean;
  };
  mockIdp: {
    issuer: string;
    jwksUri: string;
    tokenEndpoint: string;
    userTokenEndpoint: string;
    rawKeysExposed: boolean;
  };
  securityControls: {
    rawTokensDisplayed: boolean;
    agentOnboardingFetchesExternalUrls: boolean;
    externalAgentsExecutable: boolean;
    agentCardSecretsRejected: boolean;
    userIdentityRequiredForResolve: boolean;
    privateKeyJwtReplayProtection: "configured" | "unknown";
    ipAllowlist: "configured" | "disabled" | "unknown";
  };
};

type SecurityTimelineCategory =
  | "identity"
  | "routing"
  | "policy"
  | "token"
  | "agent"
  | "delegation"
  | "response"
  | "audit";

type SecurityTimelineStatus = "success" | "warning" | "blocked" | "info";

type SecurityTimelineEvent = {
  id: string;
  category: SecurityTimelineCategory;
  title: string;
  description: string;
  status: SecurityTimelineStatus;
  timestamp?: string;
  actor?: string;
  agentId?: string;
  metadata?: Array<{ label: string; value: string }>;
};

type SecurityTimelineFilter =
  | "all"
  | "identity"
  | "routing"
  | "policy"
  | "token"
  | "agent"
  | "delegation"
  | "response-audit";

const securityTimelineFilters: Array<{ id: SecurityTimelineFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "identity", label: "Identity" },
  { id: "routing", label: "Routing" },
  { id: "policy", label: "Policy" },
  { id: "token", label: "Token" },
  { id: "agent", label: "Agent" },
  { id: "delegation", label: "Delegation" },
  { id: "response-audit", label: "Response/Audit" }
];

const demoUserOptions = [
  { email: "ran@company.com", label: "Ran Keselman", roleLabel: "it-support" },
  { email: "analyst@company.com", label: "Security Analyst", roleLabel: "read-only" },
  { email: "admin@company.com", label: "Identity Admin", roleLabel: "identity-admin" }
];

async function friendlyApiError(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  let body: { error?: string; details?: string[]; limit?: number } | undefined;

  try {
    body = text ? JSON.parse(text) as { error?: string; details?: string[]; limit?: number } : undefined;
  } catch {
    body = undefined;
  }

  if (response.status === 429 || body?.error === "Too many requests") {
    return "Too many requests. Wait a minute and try again.";
  }

  if (body?.error === "Session required") {
    return "Your browser session expired. Refresh the page and try again.";
  }

  if (body?.error) {
    return `${fallback}: ${body.error}`;
  }

  return text ? `${fallback}: ${text}` : `${fallback} (${response.status})`;
}

function createMessageId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function MessageList({ messages }: { messages: ChatMessage[] }) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <section className="task-transcript" aria-label="Task result">
      <div className="section-heading-row">
        <div>
          <p className="active-panel-eyebrow">Gateway response</p>
          <h2>Task Result</h2>
        </div>
      </div>
      {messages.map((chatMessage) => (
        <article
          className={`task-message-card ${chatMessage.role === "user" ? "request-card" : "gateway-response-card"} ${chatMessage.status === "loading" ? "loading" : ""
            }`}
          key={chatMessage.id}
        >
          <span>{chatMessage.role === "user" ? "Request" : "Gateway response"}</span>
          <p>{chatMessage.content}</p>
        </article>
      ))}
      {messages.length === 0 ? (
        <div className="empty-state compact">Choose a security scenario or enter a task to see the gateway response.</div>
      ) : null}
      <div ref={endRef} />
    </section>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("run-task");
  const [message, setMessage] = useState(sampleMessage);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [health, setHealth] = useState<AgentsHealthResponse | null>(null);
  const [healthError, setHealthError] = useState("");
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [zeroTrustAgentBaseUrl, setZeroTrustAgentBaseUrl] = useState("http://localhost:4201");
  const [zeroTrustExpectedAgentId, setZeroTrustExpectedAgentId] = useState("external-jira-agent");
  const [zeroTrustExpectedResourceSystem, setZeroTrustExpectedResourceSystem] = useState("");
  const [zeroTrustExpectedConnectorId, setZeroTrustExpectedConnectorId] = useState("");
  const [supportedConnectorGuardrails, setSupportedConnectorGuardrails] = useState<SupportedConnectorGuardrail[]>(fallbackSupportedConnectorGuardrails);
  const [zeroTrustOnboardedAgents, setZeroTrustOnboardedAgents] = useState<TrustedOnboardedAgent[]>([]);
  const [zeroTrustDiscovery, setZeroTrustDiscovery] = useState<AgentOnboardingDiscoveryResult | null>(null);
  const [zeroTrustResult, setZeroTrustResult] = useState<AgentOnboardingResult | null>(null);
  const [zeroTrustError, setZeroTrustError] = useState("");
  const [zeroTrustCopyMessage, setZeroTrustCopyMessage] = useState("");
  const [gatewayRegistrationMetadata, setGatewayRegistrationMetadata] = useState<GatewayRegistrationMetadata | null>(null);
  const [connectionAudience, setConnectionAudience] = useState<ConnectionAudience>("bizapps");
  const [connectionWizardStep, setConnectionWizardStep] = useState<ConnectionWizardStep>("overview");
  const [connectionWizardCollapsedAfterSuccess, setConnectionWizardCollapsedAfterSuccess] = useState(false);
  const [customConnectorContractOpen, setCustomConnectorContractOpen] = useState(false);
  const [expandedInstalledAgentIds, setExpandedInstalledAgentIds] = useState<string[]>([]);
  const [isZeroTrustDiscovering, setIsZeroTrustDiscovering] = useState(false);
  const [isZeroTrustOnboarding, setIsZeroTrustOnboarding] = useState(false);
  const [identitySession, setIdentitySession] = useState<IdentitySessionResponse | null>(null);
  const [trustStatus, setTrustStatus] = useState<TrustStatusResponse | null>(null);
  const [selectedDemoUserEmail, setSelectedDemoUserEmail] = useState(demoUserOptions[0].email);
  const [identityError, setIdentityError] = useState("");
  const [identityMessage, setIdentityMessage] = useState("");
  const [isIdentityLoading, setIsIdentityLoading] = useState(false);
  const [securityTimelineFilter, setSecurityTimelineFilter] = useState<SecurityTimelineFilter>("all");
  const [pendingFocusTarget, setPendingFocusTarget] = useState<GuidedFocusTarget | null>(null);
  const runTaskRootRef = useRef<HTMLElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const taskTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gatewayResponseRef = useRef<HTMLElement | null>(null);
  const securitySummaryRef = useRef<HTMLElement | null>(null);
  const trustIdentityRootRef = useRef<HTMLElement | null>(null);
  const loginPanelRef = useRef<HTMLElement | null>(null);
  const demoUserSelectRef = useRef<HTMLSelectElement | null>(null);
  const loginButtonRef = useRef<HTMLButtonElement | null>(null);
  const agentRegistryRootRef = useRef<HTMLElement | null>(null);
  const connectorCatalogRef = useRef<HTMLElement | null>(null);
  const zeroTrustOnboardingRef = useRef<HTMLElement | null>(null);
  const registeredAgentsRef = useRef<HTMLElement | null>(null);
  const legacyAgentsRef = useRef<HTMLDetailsElement | null>(null);
  const securityTimelineRootRef = useRef<HTMLElement | null>(null);
  const timelineListRef = useRef<HTMLElement | null>(null);
  const latestResponse = useMemo(
    () => [...messages].reverse().find((item) => item.role === "assistant" && item.status === "done" && item.metadata)?.metadata ?? null,
    [messages]
  );
  const securityTimelineEvents = useMemo(
    () => latestResponse ? buildSecurityTimelineEvents(latestResponse) : [],
    [latestResponse]
  );
  const visibleSecurityTimelineEvents = useMemo(
    () => securityTimelineEvents.filter((event) => securityTimelineFilterMatches(event, securityTimelineFilter)),
    [securityTimelineEvents, securityTimelineFilter]
  );
  const healthLabel = health
    ? `${health.summary.healthy}/${health.summary.total} healthy`
    : "Agents unknown";
  const authModeLabel = health?.orchestrator.authMode === "oauth2_client_credentials_jwt"
    ? "Secure A2A JWT"
    : "Local mock";
  const userBadgeLabel = identitySession?.authenticated && identitySession.user
    ? identitySession.user.email
    : "Login required";
  const builtInAgentsCount = health?.agents.filter((agent) => agent.endpointType !== "session" && !infrastructureAgentIds.has(agent.agentId)).length ?? 0;
  const healthyAgentsCount = health?.summary.healthy ?? 0;
  const registeredAgentRows: RegisteredAgentRow[] = [
    ...zeroTrustOnboardedAgents.map((agent) => ({
      agentId: agent.agentId,
      status: "unknown",
      endpointType: "public" as const,
      endpointScheme: endpointMetadata(agent.issuer).endpointScheme,
      authMode: agent.tokenEndpointAuthMethod,
      latencyMs: undefined,
      agentCardAvailable: true,
      error: undefined,
      canDelete: false,
      source: "zero-trust-onboarded" as const,
      trustLevel: agent.trustLevel,
      requestedScopes: agent.requestedScopes,
      agentDeclaredSkills: agent.agentDeclaredSkills,
      agentDeclaredCapabilities: agent.agentDeclaredCapabilities,
      grantedScopes: agent.grantedScopes,
      approvedActions: agent.approvedActions,
      blockedActions: agent.blockedActions,
      approvedCapabilities: agent.approvedCapabilities,
      blockedCapabilities: agent.blockedCapabilities,
      resourcePrincipal: agent.resourcePrincipal,
      runtimeEndpoint: agent.runtimeEndpoint,
      connectorId: agent.connectorId ?? agent.connectorProfile?.connectorId,
      resourceSystem: agent.resourceSystem ?? agent.connectorProfile?.resourceSystem,
      connectorDisplayName: agent.connectorDisplayName ?? agent.connectorProfile?.displayName,
      externalConfigHash: agent.externalConfigHash,
      connectorProfileVerified: agent.connectorProfileVerified,
      lifecycle: agent.lifecycle,
      oauthApplicationBound: agent.oauthApplicationBound,
      executable: agent.executable,
      executionState: agent.executionState
    })),
    ...(health?.agents.map((agent) => ({
      agentId: agent.agentId,
      status: agent.status,
      endpointType: agent.endpointType,
      endpointScheme: "unknown" as const,
      authMode: "unknown",
      latencyMs: agent.latencyMs,
      agentCardAvailable: agent.details.agentCardAvailable,
      error: agent.error,
      canDelete: false,
      source: infrastructureAgentIds.has(agent.agentId) ? "infrastructure" as const : "built-in" as const
    })) ?? [])
  ];
  const latestActorAttached = latestResponse?.userIdentity.authenticated === true;
  const latestActorTokenObserved = Boolean(latestResponse?.a2aTasks?.some((task) =>
    Boolean(task.context.auth?.actor) ||
    Boolean(task.context.auth?.actorRoles?.length) ||
    Boolean(task.context.actor?.email)
  ));
  const latestActorRoles = latestResponse?.userIdentity.roles?.join(", ") ?? "none";
  const isUserAuthenticated = identitySession?.authenticated === true || trustStatus?.userIdentity.authenticated === true;
  const latestRequest = [...messages].reverse().find((item) => item.role === "user")?.content ?? "";
  const executionState = isUserAuthenticated ? "allowed" : "login required";
  const authModeSummary = health?.orchestrator.authMode ?? trustStatus?.gatewayIdentity.a2aAuthMode ?? "unknown";
  const lastResult = lastResultLabel(latestResponse);
  const policySummary = primaryPolicyLabel(latestResponse);
  const tokenSummary = tokenStatusLabel(latestResponse);
  const delegationSummary = delegationLabel(latestResponse);
  const primarySelectedAgent = latestResponse?.selectedAgents[0]?.agentId ?? "none";
  const actorEmail = latestResponse?.userIdentity.email ?? identitySession?.user?.email;
  const policyOutcome = policyOutcomeLabel(policySummary);
  const tokenOutcome = tokenOutcomeLabel(tokenSummary);

  function scrollToRef<T extends HTMLElement>(ref: React.RefObject<T | null>, options?: ScrollIntoViewOptions) {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start", ...options });
  }

  function focusElement<T extends HTMLElement>(ref: React.RefObject<T | null>) {
    ref.current?.focus({ preventScroll: true });
  }

  function highlightSection<T extends HTMLElement>(ref: React.RefObject<T | null>) {
    const element = ref.current;
    if (!element) {
      return;
    }

    element.classList.remove("focus-pulse");
    window.setTimeout(() => {
      element.classList.add("focus-pulse");
      window.setTimeout(() => element.classList.remove("focus-pulse"), 1520);
    }, 0);
  }

  function guideToTarget(target: GuidedFocusTarget) {
    setPendingFocusTarget(target);
  }

  function goToTrustIdentity() {
    setActiveTab("trust-identity");
    guideToTarget("trust-login");
  }

  function goToRunTask() {
    setActiveTab("run-task");
    guideToTarget("composer");
  }

  function goToAgentRegistry() {
    setActiveTab("agent-registry");
    guideToTarget("agent-registry");
  }

  function goToSecurityTimeline() {
    setActiveTab("security-timeline");
    guideToTarget("security-timeline");
  }

  async function checkAgentHealth() {
    setHealthError("");
    setIsHealthLoading(true);

    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/agents/health`, {
        method: "GET",
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to check agent health"));
      }

      setHealth((await response.json()) as AgentsHealthResponse);
    } catch (caughtError) {
      setHealthError(caughtError instanceof Error ? caughtError.message : "Failed to check agent health");
    } finally {
      setIsHealthLoading(false);
    }
  }

  useEffect(() => {
    void checkAgentHealth();
    void loadTrustStatus();
    void loadGatewayRegistrationMetadata();
    void loadSupportedConnectorGuardrails();
  }, []);

  useEffect(() => {
    if (activeTab === "agent-registry") {
      void loadZeroTrustOnboardedAgents();
      void checkAgentHealth();
    }
    if (activeTab === "trust-identity") {
      void loadTrustStatus();
    }
  }, [activeTab]);

  useEffect(() => {
    if (!pendingFocusTarget) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (pendingFocusTarget === "run-task") {
        scrollToRef(runTaskRootRef);
        highlightSection(runTaskRootRef);
      }
      if (pendingFocusTarget === "composer") {
        scrollToRef(composerRef);
        highlightSection(composerRef);
        focusElement(taskTextareaRef);
      }
      if (pendingFocusTarget === "gateway-response") {
        scrollToRef(gatewayResponseRef);
        highlightSection(gatewayResponseRef);
      }
      if (pendingFocusTarget === "security-summary") {
        scrollToRef(securitySummaryRef);
        highlightSection(securitySummaryRef);
      }
      if (pendingFocusTarget === "trust-login") {
        scrollToRef(loginPanelRef);
        highlightSection(loginPanelRef);
        if (demoUserSelectRef.current) {
          focusElement(demoUserSelectRef);
        } else if (loginButtonRef.current) {
          focusElement(loginButtonRef);
        }
      }
      if (pendingFocusTarget === "agent-registry") {
        scrollToRef(agentRegistryRootRef);
        highlightSection(agentRegistryRootRef);
      }
      if (pendingFocusTarget === "connector-catalog") {
        scrollToRef(connectorCatalogRef);
        highlightSection(connectorCatalogRef);
      }
      if (pendingFocusTarget === "zero-trust-onboarding") {
        scrollToRef(zeroTrustOnboardingRef);
        highlightSection(zeroTrustOnboardingRef);
      }
      if (pendingFocusTarget === "registered-agents") {
        scrollToRef(registeredAgentsRef);
        highlightSection(registeredAgentsRef);
      }
      if (pendingFocusTarget === "legacy-agents") {
        scrollToRef(legacyAgentsRef);
        highlightSection(legacyAgentsRef);
      }
      if (pendingFocusTarget === "security-timeline") {
        const targetRef = timelineListRef.current ? timelineListRef : securityTimelineRootRef;
        scrollToRef(targetRef);
        highlightSection(targetRef);
      }
      setPendingFocusTarget(null);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeTab, pendingFocusTarget, latestResponse, registeredAgentRows.length, zeroTrustResult]);

  async function ensureSession() {
    const response = await fetch(`${API_URL}/session`, {
      method: "POST",
      credentials: "include"
    });

    if (!response.ok) {
      throw new Error(await friendlyApiError(response, "Failed to create browser session"));
    }
  }

  async function loadIdentitySession() {
    setIdentityError("");
    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/identity/session`, {
        method: "GET",
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to load identity session"));
      }

      setIdentitySession((await response.json()) as IdentitySessionResponse);
    } catch (caughtError) {
      setIdentityError(caughtError instanceof Error ? caughtError.message : "Failed to load identity session");
    }
  }

  async function loadTrustStatus() {
    setIdentityError("");
    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/identity/trust-status`, {
        method: "GET",
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to load trust status"));
      }

      const body = (await response.json()) as TrustStatusResponse;
      setTrustStatus(body);
      setIdentitySession({
        authenticated: body.userIdentity.authenticated,
        user: body.userIdentity.user,
        issuer: body.userIdentity.issuer,
        audience: body.userIdentity.audience
      });
    } catch (caughtError) {
      setIdentityError(caughtError instanceof Error ? caughtError.message : "Failed to load trust status");
    }
  }

  async function loginDemoUser() {
    setIdentityError("");
    setIdentityMessage("");
    setIsIdentityLoading(true);

    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/identity/demo-login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: selectedDemoUserEmail })
      });

      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to login as demo user"));
      }

      const body = (await response.json()) as IdentitySessionResponse;
      setIdentitySession(body);
      setIdentityMessage("Demo user identity verified and attached to this gateway session.");
      await loadTrustStatus();
      guideToTarget("trust-login");
    } catch (caughtError) {
      setIdentityError(caughtError instanceof Error ? caughtError.message : "Failed to login as demo user");
    } finally {
      setIsIdentityLoading(false);
    }
  }

  async function logoutIdentity() {
    setIdentityError("");
    setIdentityMessage("");
    setIsIdentityLoading(true);

    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/identity/logout`, {
        method: "POST",
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to logout demo user"));
      }

      setIdentitySession((await response.json()) as IdentitySessionResponse);
      setIdentityMessage("Demo user identity cleared from this gateway session.");
      await loadTrustStatus();
    } catch (caughtError) {
      setIdentityError(caughtError instanceof Error ? caughtError.message : "Failed to logout demo user");
    } finally {
      setIsIdentityLoading(false);
    }
  }

  async function loadZeroTrustOnboardedAgents() {
    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/agent-onboarding`, {
        method: "GET",
        credentials: "include"
      });
      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to load zero-trust onboarded agents"));
      }
      const body = await response.json() as { agents: TrustedOnboardedAgent[] };
      setZeroTrustOnboardedAgents(body.agents);
    } catch (caughtError) {
      setZeroTrustError(caughtError instanceof Error ? caughtError.message : "Failed to load zero-trust onboarded agents");
    }
  }

  async function loadGatewayRegistrationMetadata() {
    try {
      const response = await fetch(`${API_URL}/.well-known/a2a-gateway.json`, {
        method: "GET",
        credentials: "include"
      });
      if (response.ok) {
        setGatewayRegistrationMetadata((await response.json()) as GatewayRegistrationMetadata);
      }
    } catch {
      setGatewayRegistrationMetadata(null);
    }
  }

  async function loadSupportedConnectorGuardrails() {
    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/agent-onboarding/supported-connectors`, {
        method: "GET",
        credentials: "include"
      });
      if (response.ok) {
        const body = await response.json() as { connectorTemplates?: SupportedConnectorGuardrail[]; connectors: SupportedConnectorGuardrail[] };
        setSupportedConnectorGuardrails((body.connectorTemplates ?? body.connectors).map(enrichConnectorTemplate));
      }
    } catch {
      setSupportedConnectorGuardrails(fallbackSupportedConnectorGuardrails);
    }
  }

  function resetZeroTrustConnectionState() {
    setZeroTrustDiscovery(null);
    setZeroTrustResult(null);
    setZeroTrustError("");
    setZeroTrustCopyMessage("");
    setConnectionWizardCollapsedAfterSuccess(false);
  }

  function applyLocalConnectorPreset(preset: typeof localConnectorPresets[number]) {
    setZeroTrustAgentBaseUrl(preset.agentBaseUrl);
    setZeroTrustExpectedAgentId(preset.expectedAgentId);
    setZeroTrustExpectedResourceSystem(preset.expectedResourceSystem);
    setZeroTrustExpectedConnectorId(preset.expectedConnectorId);
    resetZeroTrustConnectionState();
    setConnectionWizardStep("connection-input");
    guideToTarget("zero-trust-onboarding");
  }

  async function discoverZeroTrustAgent() {
    setZeroTrustError("");
    setZeroTrustResult(null);
    setZeroTrustDiscovery(null);
    setIsZeroTrustDiscovering(true);

    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/agent-onboarding/discover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          agentBaseUrl: zeroTrustAgentBaseUrl,
          expectedAgentId: zeroTrustExpectedAgentId,
          ...(zeroTrustExpectedResourceSystem ? { expectedResourceSystem: zeroTrustExpectedResourceSystem } : {}),
          ...(zeroTrustExpectedConnectorId ? { expectedConnectorId: zeroTrustExpectedConnectorId } : {})
        })
      });
      const body = await response.json() as AgentOnboardingDiscoveryResult | { discovered: false; details?: string[]; error?: string };
      if (!response.ok || !("discovered" in body) || body.discovered !== true) {
        const details = "details" in body && body.details?.length
          ? body.details.join(" ")
          : "Discovery failed. Start the selected reference connector instance and ensure it exposes GET /.well-known/a2a-agent.json.";
        throw new Error(details);
      }

      setZeroTrustDiscovery(body);
      setGatewayRegistrationMetadata(body.gatewayRegistration);
      setConnectionWizardStep("discovery");
      guideToTarget("zero-trust-onboarding");
    } catch (caughtError) {
      setConnectionWizardStep("discovery");
      setZeroTrustError(caughtError instanceof Error ? caughtError.message : "Discovery failed. Start the selected reference connector instance and ensure it exposes GET /.well-known/a2a-agent.json.");
      guideToTarget("zero-trust-onboarding");
    } finally {
      setIsZeroTrustDiscovering(false);
    }
  }

  async function copyGatewayRegistrationJson(value: unknown) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      setZeroTrustCopyMessage("Gateway registration JSON copied.");
    } catch {
      setZeroTrustCopyMessage("Copy failed. Select the JSON and copy it manually.");
    }
  }

  async function startZeroTrustOnboarding() {
    setZeroTrustError("");
    setZeroTrustResult(null);
    if (!zeroTrustDiscovery) {
      setZeroTrustError("Discover the external agent before verifying the connection.");
      setConnectionWizardStep("connection-input");
      guideToTarget("zero-trust-onboarding");
      return;
    }
    setConnectionWizardStep("verify");
    setIsZeroTrustOnboarding(true);

    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/agent-onboarding/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          agentBaseUrl: zeroTrustAgentBaseUrl,
          expectedAgentId: zeroTrustExpectedAgentId,
          ...(zeroTrustExpectedResourceSystem ? { expectedResourceSystem: zeroTrustExpectedResourceSystem } : {}),
          ...(zeroTrustExpectedConnectorId ? { expectedConnectorId: zeroTrustExpectedConnectorId } : {})
        })
      });
      const body = await response.json() as AgentOnboardingResult | { error: string; details?: string[]; checks?: AgentOnboardingResult["checks"] };
      if (!response.ok) {
        const details = "details" in body && body.details?.length ? ` ${body.details.join(" ")}` : "";
        throw new Error(`Zero-trust onboarding failed.${details}`);
      }
      const result = body as AgentOnboardingResult;
      setZeroTrustResult(result);
      setConnectionWizardCollapsedAfterSuccess(false);
      if (result.trustedAgents) {
        setZeroTrustOnboardedAgents(result.trustedAgents);
      } else {
        await loadZeroTrustOnboardedAgents();
      }
      await loadSupportedConnectorGuardrails();
      setConnectionWizardStep("result");
      guideToTarget("zero-trust-onboarding");
    } catch (caughtError) {
      setConnectionWizardStep("verify");
      setZeroTrustError(caughtError instanceof Error ? caughtError.message : "Zero-trust onboarding failed");
      guideToTarget("zero-trust-onboarding");
    } finally {
      setIsZeroTrustOnboarding(false);
    }
  }

  async function resolveIssue(issueText: string) {
    const trimmedIssueText = issueText.trim();

    if (!trimmedIssueText || isLoading || !isUserAuthenticated) {
      if (trimmedIssueText && !isUserAuthenticated) {
        setError("Secure execution requires verified user identity. Login in Trust & Identity before running tasks.");
        goToTrustIdentity();
      }
      return;
    }

    setError("");
    setIsLoading(true);

    const loadingMessageId = createMessageId();
    const now = new Date().toISOString();
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: createMessageId(),
        role: "user",
        content: trimmedIssueText,
        timestamp: now,
        status: "done"
      },
      {
        id: loadingMessageId,
        role: "assistant",
        content: "Starting A2A task conversation...",
        timestamp: now,
        status: "loading"
      }
    ]);

    try {
      await ensureSession();
      const apiResponse = await fetch(`${API_URL}/resolve`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({ message: trimmedIssueText, conversationId })
      });

      if (!apiResponse.ok) {
        throw new Error(`Orchestrator returned ${apiResponse.status} with body ${await apiResponse.text()}`);
      }

      const resolvedResponse = (await apiResponse.json()) as ResolveResponse;
      setConversationId(resolvedResponse.conversationId);
      setMessages((currentMessages) =>
        currentMessages.map((chatMessage) =>
          chatMessage.id === loadingMessageId
            ? {
              ...chatMessage,
              content: resolvedResponse.finalAnswer,
              timestamp: new Date().toISOString(),
              status: "done",
              metadata: resolvedResponse
            }
            : chatMessage
        )
      );
      guideToTarget("gateway-response");
    } catch (caughtError) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : "Failed to resolve issue";
      setError(errorMessage);
      setMessages((currentMessages) =>
        currentMessages.map((chatMessage) =>
          chatMessage.id === loadingMessageId
            ? {
              ...chatMessage,
              content: `Unable to resolve issue: ${errorMessage}`,
              timestamp: new Date().toISOString(),
              status: "done"
            }
            : chatMessage
        )
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function submitIssue(event: React.FormEvent) {
    event.preventDefault();
    await resolveIssue(message);
  }

  function startNewConversation() {
    setMessages([]);
    setConversationId(undefined);
    setError("");
    setMessage(sampleMessage);
  }

  function renderScenarioOptions(items: Scenario[]) {
    return (
      <div className="scenario-buttons">
        {items.map((scenario) => (
          <article className="scenario-card" key={scenario.label}>
            <div className="scenario-card-body">
              <span className={`scenario-outcome-badge status-${cockpitStatusClass(scenario.badge ?? scenario.subtitle)}`}>{scenario.badge ?? "Advanced"}</span>
              <h3>{scenario.label}</h3>
              <p>{scenario.purpose ?? scenario.subtitle}</p>
            </div>
            <div className="scenario-card-actions">
              <button
                type="button"
                className="secondary-inline-button"
                title={scenario.subtitle}
                onClick={() => {
                  setMessage(scenario.message);
                  guideToTarget("composer");
                }}
              >
                Use scenario
              </button>
              <button
                type="button"
                className="scenario-run"
                disabled={isLoading}
                onClick={() => {
                  setMessage(scenario.message);
                  if (!isUserAuthenticated) {
                    goToTrustIdentity();
                    return;
                  }
                  void resolveIssue(scenario.message);
                }}
              >
                {isUserAuthenticated ? "Run" : "Login required"}
              </button>
            </div>
          </article>
        ))}
      </div>
    );
  }

  function renderGatewayResponseCard() {
    if (!latestResponse) {
    return (
      <section className="cockpit-card gateway-response-panel empty-response-panel scroll-target" ref={gatewayResponseRef} tabIndex={-1}>
          <div>
            <p className="active-panel-eyebrow">Gateway response</p>
            <h2>No governed task result yet</h2>
          </div>
          <p>Login, choose a scenario, and run a task to see the governed response.</p>
        </section>
      );
    }

    const executiveSummary = firstSentence(latestResponse.finalAnswer);
    const actionItems = recommendedActionItems(latestResponse.diagnosis.recommendedFix);
    const showFullResponse = latestResponse.finalAnswer.trim() !== executiveSummary.trim();
    const supportingAgents = latestResponse.selectedAgents;
    const outcomeBadges = [
      { label: "Identity verified", className: "status-success" },
      ...(latestResponse.connectorRouting
        ? [
            {
              label: connectorRoutingStatusLabel(latestResponse.connectorRouting.status),
              className: `status-${connectorRoutingStatusClass(latestResponse.connectorRouting.status)}`
            }
          ]
        : []),
      { label: policyOutcome, className: `status-${cockpitStatusClass(policyOutcome)}` },
      { label: tokenOutcome, className: `status-${cockpitStatusClass(tokenOutcome)}` },
      { label: latestActorAttached ? "Actor attached" : "Actor not attached", className: latestActorAttached ? "status-success" : "status-neutral" },
      { label: delegationSummary === "yes" ? "Delegation mediated" : "No delegation", className: delegationSummary === "yes" ? "status-success" : "status-neutral" },
      { label: "Raw tokens hidden", className: "status-success" }
    ];

    return (
      <section className="cockpit-card gateway-response-panel scroll-target" ref={gatewayResponseRef} tabIndex={-1}>
        <div className="gateway-response-header">
          <div>
            <p className="active-panel-eyebrow">Gateway response</p>
            <h2>{executiveSummary}</h2>
          </div>
          <span className={`summary-result status-${cockpitStatusClass(lastResult)}`}>{statusDisplayLabel(lastResult)}</span>
        </div>
        <section className="gateway-response-section root-cause-section">
          <span>Root cause</span>
          <p>{latestResponse.diagnosis.probableCause}</p>
        </section>
        <section className="gateway-response-section recommended-actions-section">
          <span>Recommended actions</span>
          <ol>
            {actionItems.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
          </ol>
        </section>
        {latestResponse.connectorRouting ? (
          <section className="connector-decision-section">
            <div className="section-heading-row compact-heading">
              <div>
                <span>Connector Decision</span>
                <h3>{connectorRoutingStatusLabel(latestResponse.connectorRouting.status)}</h3>
              </div>
              <strong className={`summary-chip status-${connectorRoutingStatusClass(latestResponse.connectorRouting.status)}`}>
                {statusDisplayLabel(latestResponse.connectorRouting.status)}
              </strong>
            </div>
            <div className="connector-decision-grid">
              <div>
                <span>Target system</span>
                <strong>{latestResponse.connectorRouting.targetSystem ?? "unknown"}</strong>
              </div>
              <div>
                <span>Connector</span>
                <strong>{latestResponse.connectorRouting.connectorId ?? "not selected"}</strong>
              </div>
              <div>
                <span>Skill / Action</span>
                <strong>{latestResponse.connectorRouting.skillLabel ?? latestResponse.connectorRouting.skillId ?? "not mapped"}</strong>
                {latestResponse.connectorRouting.skillId ? <small>{latestResponse.connectorRouting.skillId}</small> : null}
              </div>
              <div>
                <span>Decision</span>
                <strong>{connectorRoutingStatusLabel(latestResponse.connectorRouting.status)}</strong>
              </div>
            </div>
            <p>{latestResponse.connectorRouting.reason}</p>
            {latestResponse.connectorPolicy ? (
              <p><strong>Policy:</strong> {latestResponse.connectorPolicy.reason}</p>
            ) : latestResponse.connectorRouting.status === "connector_skill_approved" ? (
              <p><strong>Policy:</strong> Default connector policy allowed this approved connector skill.</p>
            ) : latestResponse.connectorRouting.status === "connector_skill_blocked" ? (
              <p><strong>Policy:</strong> Skill was not eligible for runtime execution because Gateway action decision blocked it.</p>
            ) : null}
            <p><strong>Next step:</strong> {latestResponse.connectorRouting.recommendedNextStep}</p>
            {latestResponse.connectorRouting.status === "connector_not_onboarded" || latestResponse.connectorRouting.status === "connector_skill_not_declared" || latestResponse.connectorRouting.status === "connector_skill_not_enabled" ? (
              <button type="button" className="secondary-inline-button" onClick={goToAgentRegistry}>
                Open Connector Catalog
              </button>
            ) : null}
            {latestResponse.connectorRouting.status === "unsupported" || latestResponse.connectorRouting.status === "connector_skill_not_declared" || latestResponse.connectorRouting.status === "connector_skill_not_enabled" ? (
              <button
                type="button"
                className="secondary-inline-button"
                onClick={() => {
                  setMessage(`Create a support ticket draft for: ${latestRequest || message}`);
                  guideToTarget("composer");
                }}
              >
                Create ticket draft
              </button>
            ) : null}
          </section>
        ) : null}
        {latestResponse.connectorRuntime ? (() => {
          const runtimeFailure = !latestResponse.connectorRuntime.executed
            ? connectorRuntimeFailureCopy(latestResponse.connectorRuntime.error, latestResponse.connectorRuntime.errorMessage)
            : undefined;
          return (
          <section className="connector-runtime-section">
            <div className="section-heading-row compact-heading">
              <div>
                <span>Connector Runtime Result</span>
                <h3>{latestResponse.connectorRuntime.executed ? "Runtime executed with scoped A2A JWT" : runtimeFailure?.title}</h3>
              </div>
              <strong className={`summary-chip status-${latestResponse.connectorRuntime.executed ? "success" : "warning"}`}>
                {latestResponse.connectorRuntime.executed ? "EXECUTED" : statusDisplayLabel(latestResponse.connectorRuntime.runtimeMode)}
              </strong>
            </div>
            <div className="connector-runtime-grid">
              <div>
                <span>Runtime status</span>
                <strong>{latestResponse.connectorRuntime.executed ? "executed" : "not executed"}</strong>
              </div>
              <div>
                <span>External agent</span>
                <strong>{latestResponse.connectorRuntime.agentResponse?.agentId ?? "not available"}</strong>
              </div>
              <div>
                <span>Connector</span>
                <strong>{latestResponse.connectorRuntime.connectorId ?? latestResponse.connectorRouting?.connectorId ?? "not selected"}</strong>
              </div>
              <div>
                <span>Resource system</span>
                <strong>{latestResponse.connectorRuntime.resourceSystem ?? latestResponse.connectorRouting?.resourceSystem ?? latestResponse.connectorRouting?.targetSystem ?? "unknown"}</strong>
              </div>
              <div>
                <span>Skill / Action</span>
                <strong>{latestResponse.connectorRouting?.skillLabel ?? latestResponse.connectorRouting?.skillId ?? "not mapped"}</strong>
              </div>
              <div>
                <span>Token</span>
                <strong>{latestResponse.connectorRuntime.tokenMetadata?.tokenIssued ? "scoped A2A JWT issued" : "not issued"}</strong>
                <small>raw token hidden</small>
              </div>
              <div>
                <span>Actor</span>
                <strong>{latestResponse.connectorRuntime.tokenMetadata?.actor ? "attached" : "not attached"}</strong>
                {latestResponse.connectorRuntime.tokenMetadata?.actor ? <small>{latestResponse.connectorRuntime.tokenMetadata.actor}</small> : null}
              </div>
            </div>
            {latestResponse.connectorPolicy ? (
              <p><strong>Policy:</strong> {latestResponse.connectorPolicy.reason}</p>
            ) : null}
            {latestResponse.connectorRuntime.agentResponse ? (
              <div className="connector-runtime-diagnosis">
                <p><strong>{latestResponse.connectorRuntime.agentResponse.summary}</strong></p>
                {latestResponse.connectorRuntime.agentResponse.probableCause ? <p>{latestResponse.connectorRuntime.agentResponse.probableCause}</p> : null}
                {latestResponse.connectorRuntime.agentResponse.recommendedActions?.length ? (
                  <ol>
                    {latestResponse.connectorRuntime.agentResponse.recommendedActions.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
                  </ol>
                ) : null}
                {latestResponse.connectorRuntime.agentResponse.evidence?.length ? (
                  <details>
                    <summary>Runtime evidence</summary>
                    <JsonBlock value={latestResponse.connectorRuntime.agentResponse.evidence} />
                  </details>
                ) : null}
              </div>
            ) : runtimeFailure ? (
              <div className="connector-runtime-diagnosis">
                <p><strong>{runtimeFailure.title}</strong></p>
                <p>{runtimeFailure.body}</p>
                {runtimeFailure.nextStep ? <p><strong>Next step:</strong> {runtimeFailure.nextStep}</p> : null}
                {latestResponse.connectorRuntime.error === "connector_configuration_changed" ? (
                  <button type="button" className="secondary-inline-button" onClick={goToAgentRegistry}>
                    Go to Agent Registry
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
          );
        })() : null}
        <div className="response-security-strip" aria-label="Security outcome">
          {outcomeBadges.map((badge) => (
            <span className={badge.className} key={badge.label}>{badge.label}</span>
          ))}
          <button type="button" className="response-timeline-link" onClick={goToSecurityTimeline}>
            View security timeline
          </button>
        </div>
        <section className="supporting-agents-section">
          <div className="section-heading-row compact-heading">
            <div>
              <span>{latestResponse.connectorRouting ? "Execution path" : "Supporting agents"}</span>
            </div>
          </div>
          {latestResponse.connectorRouting ? (
            <div className="connector-execution-summary">
              <p><strong>Connector-backed route selected.</strong></p>
              <dl>
                <div>
                  <dt>Target system</dt>
                  <dd>{latestResponse.connectorRouting.targetSystem ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Connector</dt>
                  <dd>{latestResponse.connectorRouting.connectorId ?? "not selected"}</dd>
                </div>
                <div>
                  <dt>Skill / Action</dt>
                  <dd>{latestResponse.connectorRouting.skillLabel ?? latestResponse.connectorRouting.skillId ?? "not mapped"}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{connectorRoutingStatusLabel(latestResponse.connectorRouting.status)}</dd>
                </div>
                <div>
                  <dt>Runtime mode</dt>
                  <dd>{latestResponse.connectorRuntime?.executed ? "external runtime executed" : latestResponse.connectorRuntime ? "external runtime failed safely" : "metadata-only"}</dd>
                </div>
              </dl>
              <p className="muted-note">
                {latestResponse.connectorRuntime?.executed
                  ? "Runtime executed with scoped A2A JWT. Raw token hidden."
                  : latestResponse.connectorRuntime
                    ? "Connector was approved, but runtime failed safely. No legacy mock diagnosis was used."
                  : "Runtime mode: metadata-only. No external runtime call was executed yet."}
              </p>
            </div>
          ) : null}
          {supportingAgents.length ? (
            <div className="supporting-agent-list">
              {latestResponse.connectorRouting ? <p className="muted-note">Supporting legacy/internal agents</p> : null}
              {supportingAgents.map((agent) => (
                <article key={`${agent.agentId}-${agent.skillId ?? "default"}`}>
                  <strong>{agent.agentId}</strong>
                  <span>{agent.role}</span>
                  <code>{agent.skillId ?? agent.matchedCapability ?? "default skill"}</code>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted-note">{latestResponse.connectorRouting ? "No legacy internal agents were used for this connector-first route." : "No supporting agents selected yet."}</p>
          )}
        </section>
        <details className="full-gateway-response">
          <summary>{showFullResponse ? "Full gateway response" : "Original request"}</summary>
          {showFullResponse ? <p>{latestResponse.finalAnswer}</p> : null}
          <div>
            <span>Original request</span>
            <p>{latestRequest || message}</p>
          </div>
        </details>
      </section>
    );
  }

  function renderSecuritySummaryCard() {
    return (
      <section className="cockpit-card security-summary-card scroll-target" aria-label="Security Summary" ref={securitySummaryRef} tabIndex={-1}>
        <div className="section-heading-row">
          <div>
            <p className="active-panel-eyebrow">Latest outcome</p>
            <h2>Security Summary</h2>
          </div>
          <span className={`summary-result status-${cockpitStatusClass(lastResult)}`}>{lastResult}</span>
        </div>
        <div className="security-summary-grid">
          <div>
            <span>Identity</span>
            <strong>{isUserAuthenticated ? "Identity verified" : "Login required"}</strong>
          </div>
          <div>
            <span>Actor</span>
            <strong>{actorEmail ?? "No actor attached yet"}</strong>
          </div>
          <div>
            <span>Routing</span>
            <strong>{latestResponse?.connectorRouting ? `Connector route: ${connectorRoutingStatusLabel(latestResponse.connectorRouting.status)}` : latestResponse ? `${latestResponse.selectedAgents.length} selected / ${primarySelectedAgent}` : "No route selected yet"}</strong>
          </div>
          <div>
            <span>Policy</span>
            <strong className={`summary-chip status-${cockpitStatusClass(policyOutcome)}`}>{policyOutcome}</strong>
          </div>
          <div>
            <span>Token</span>
            <strong className={`summary-chip status-${cockpitStatusClass(tokenOutcome)}`}>{tokenOutcome}</strong>
          </div>
          <div>
            <span>Delegation</span>
            <strong>{delegationSummary === "yes" ? "Delegation mediated" : "No delegation observed"}</strong>
          </div>
          <div>
            <span>Result</span>
            <strong>{latestResponse?.resolutionStatus ?? "No task run yet"}</strong>
          </div>
        </div>
        {!latestResponse ? <p className="muted-note">Run a task after login to populate security outcomes.</p> : null}
      </section>
    );
  }

  function renderLatestSecurityDetails() {
    return (
      <section className="cockpit-card latest-security-card" aria-label="Execution evidence">
        <div className="section-heading-row">
          <div>
            <p className="active-panel-eyebrow">Control checks</p>
            <h2>Execution evidence</h2>
          </div>
        </div>
        <div className="security-detail-list">
          <div>
            <span>Selected agents</span>
            <strong>{latestResponse?.selectedAgents.map((agent) => agent.agentId).join(", ") || "none"}</strong>
          </div>
          <div>
            <span>Policy decision</span>
            <strong className={`summary-chip status-${cockpitStatusClass(policySummary)}`}>{policySummary}</strong>
          </div>
          <div>
            <span>Token status</span>
            <strong className={`summary-chip status-${cockpitStatusClass(tokenSummary)}`}>{tokenSummary}</strong>
          </div>
          <div>
            <span>Actor status</span>
            <strong>{latestActorAttached ? `attached: ${latestResponse?.userIdentity.email ?? "unknown"}` : "not attached"}</strong>
          </div>
          <div>
            <span>Actor propagated</span>
            <strong>{latestActorTokenObserved ? "yes" : latestResponse ? "not observed" : "none"}</strong>
          </div>
        </div>
      </section>
    );
  }

  function renderCockpitStatusStrip() {
    return (
      <div className="cockpit-status-strip" aria-label="Execution status">
        <article>
          <span>Current user</span>
          <strong>{identitySession?.authenticated ? identitySession.user?.email : "not authenticated"}</strong>
        </article>
        <article className={`status-${cockpitStatusClass(executionState)}`}>
          <span>Execution</span>
          <strong>{executionState}</strong>
        </article>
        <article>
          <span>A2A auth mode</span>
          <strong>{authModeSummary}</strong>
        </article>
        <article className={`status-${cockpitStatusClass(lastResult)}`}>
          <span>Last result</span>
          <strong>{lastResult}</strong>
        </article>
      </div>
    );
  }

  function renderTechnicalDetails() {
    if (!latestResponse) {
      return null;
    }

    return (
      <details className="technical-details">
        <summary>Technical trace (sanitized)</summary>
        <div className="technical-details-grid">
          <section>
            <h2>Classification</h2>
            <div className="classification-details">
              <div>
                <span>System</span>
                <strong>{latestResponse.classification.system}</strong>
              </div>
              <div>
                <span>Issue type</span>
                <strong>{latestResponse.classification.issueType}</strong>
              </div>
              <div>
                <span>Routing source</span>
                <strong>{latestResponse.routingSource}</strong>
              </div>
              <div>
                <span>Confidence</span>
                <strong>{latestResponse.routingConfidence}</strong>
              </div>
              <p>{routingDescription(latestResponse)} {latestResponse.routingReasoningSummary}</p>
            </div>
          </section>
          <section>
            <h2>Security Decisions</h2>
            {securityDecisions(latestResponse).length ? securityDecisions(latestResponse).map((decision, index) => (
              <div className="security-decision compact" key={`${decision.caller}-${decision.target}-${decision.requestedAction}-${index}`}>
                <div>
                  <span>Target</span>
                  <strong>{decision.target}</strong>
                </div>
                <div>
                  <span>Decision</span>
                  <strong className={`decision-badge ${decisionClass(decision.decision)}`}>{decision.decision}</strong>
                </div>
                <p>{decision.reason}</p>
              </div>
            )) : <p className="muted-note">No policy decision recorded.</p>}
          </section>
          <section>
            <h2>A2A Tasks</h2>
            {latestResponse.a2aTasks?.length ? latestResponse.a2aTasks.map((task) => (
              <article className="evidence" key={task.taskId}>
                <strong>{task.fromAgent} to {task.toAgent}</strong>
                <span>{task.skillId ?? "no skill"} / token {task.context.auth?.tokenIssued ? "issued" : "not issued"}</span>
              </article>
            )) : <p className="muted-note">No A2A task created.</p>}
          </section>
          <section>
            <h2>Sanitized JSON</h2>
            <JsonBlock value={safeRawExecutionData(latestResponse)} />
          </section>
        </div>
      </details>
    );
  }

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
    const resourceSystemOptions = [...new Map(availableConnectorTemplates.map((connector) => [connector.resourceSystem, connector])).values()];
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
      ["Runtime remains metadata-only", "External runtime execution stays disabled for this phase.", "runtime_execution_metadata_only"]
    ] as const;
    const moveStep = (direction: 1 | -1) => {
      const nextIndex = Math.min(Math.max(currentStepIndex + direction, 0), wizardSteps.length - 1);
      setConnectionWizardStep(wizardSteps[nextIndex].id);
    };
    const startAnotherConnection = () => {
      resetZeroTrustConnectionState();
      setConnectionWizardStep("overview");
    };
    const finishOnboarding = async () => {
      setZeroTrustError("");
      await Promise.all([
        loadZeroTrustOnboardedAgents(),
        loadSupportedConnectorGuardrails()
      ]);
      setConnectionWizardCollapsedAfterSuccess(true);
      guideToTarget("registered-agents");
    };
    const verifiedConnectorName = zeroTrustResult?.trustedAgent.connectorDisplayName
      ?? zeroTrustResult?.connectorProfile?.displayName
      ?? zeroTrustDiscovery?.discovery.connectorDisplayName
      ?? zeroTrustResult?.trustedAgent.connectorId
      ?? "External connector";
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
    const renderCapabilityList = (items: DerivedCapability[], emptyLabel: string) => (
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
                <input value={zeroTrustAgentBaseUrl} onChange={(event) => {
                  setZeroTrustAgentBaseUrl(event.target.value);
                  resetZeroTrustConnectionState();
                }} />
                <small>The external agent URL that exposes /.well-known/a2a-agent.json</small>
              </label>
              <label>
                <span>Expected Agent ID</span>
                <input value={zeroTrustExpectedAgentId} onChange={(event) => {
                  setZeroTrustExpectedAgentId(event.target.value);
                  resetZeroTrustConnectionState();
                }} />
                <small>Used in this demo to prevent connecting the wrong agent.</small>
              </label>
              <label>
                <span>Expected external system</span>
                <select value={zeroTrustExpectedResourceSystem} onChange={(event) => {
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
                <select value={zeroTrustExpectedConnectorId} onChange={(event) => {
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
                <strong className="metadata-only-badge">Trusted metadata only</strong>
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
                  <small>Effective permissions: {zeroTrustResult.resourcePermissionProof.effectivePermissions.join(", ") || "none"}</small>
                  <small>Denied permissions: {zeroTrustResult.resourcePermissionProof.deniedPermissions.join(", ") || "none"}</small>
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
                <button type="button" onClick={() => void finishOnboarding()}>Finish and view Installed Connectors</button>
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
              <h2>Connect External Agent</h2>
              <p className="muted-note">{verifiedConnectorName} was installed as a trusted external connector agent.</p>
            </div>
          </div>
          <div className="wizard-action-row">
            <button type="button" className="secondary-button compact-button" onClick={() => guideToTarget("registered-agents")}>View Installed Connectors</button>
            <button type="button" className="secondary-button compact-button" onClick={startAnotherConnection}>Connect another external agent</button>
            <button type="button" className="secondary-button compact-button" onClick={() => {
              setConnectionWizardCollapsedAfterSuccess(false);
              setConnectionWizardStep("result");
            }}>Show verification details</button>
          </div>
        </section>
      );
    }

    return (
      <section className="zero-trust-onboarding-panel scroll-target" ref={zeroTrustOnboardingRef} tabIndex={-1} aria-label="Zero-Trust Agent Onboarding">
        <div className="panel-header">
          <div>
            <p className="active-panel-eyebrow">External agent connection</p>
            <h2>Connect External Agent</h2>
            <p className="muted-note">Connect an external agent using a connector template through discovery, signed Gateway challenge, signed agent response, OAuth application binding, permission verification, and action approval.</p>
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

  function renderRunTaskTab() {
    return (
      <section className="control-panel demo-cockpit scroll-target" aria-label="Execution Cockpit" ref={runTaskRootRef} tabIndex={-1}>
        <div className="panel-header cockpit-header">
          <div>
            <p className="active-panel-eyebrow">Secure A2A execution</p>
            <h2>Run governed agent task</h2>
            <p className="muted-note">Secure task execution requires verified user identity. The gateway routes through Agent Cards, policy, scoped A2A JWT metadata, and audit timeline.</p>
          </div>
        </div>

        {renderCockpitStatusStrip()}

        <div className="cockpit-grid">
          <section className="cockpit-main">
            {!isUserAuthenticated ? (
              <section className="identity-gate-panel" role="status">
                <div>
                  <p className="active-panel-eyebrow">Execution locked</p>
                  <h2>Login required before execution</h2>
                  <p>This gateway blocks task execution until a verified user identity is attached to the session.</p>
                </div>
                <button type="button" onClick={goToTrustIdentity}>Go to Trust & Identity</button>
              </section>
            ) : null}

            <div className="scenario-launcher cockpit-card" aria-label="Security story scenarios">
            <div className="section-heading-row">
              <div>
                <p className="active-panel-eyebrow">Scenario picker</p>
                <h2>Connector-first scenarios</h2>
              </div>
            </div>
            {renderScenarioOptions(quickScenarios)}
            {advancedScenarios.length ? (
              <details className="advanced-scenarios">
                <summary>Advanced Scenarios</summary>
                {renderScenarioOptions(advancedScenarios)}
              </details>
            ) : null}
            </div>

            <form className="composer cockpit-card scroll-target" onSubmit={submitIssue} ref={composerRef}>
              <div className="section-heading-row">
                <div>
                  <p className="active-panel-eyebrow">Task input</p>
                  <h2>AI command composer</h2>
                </div>
              </div>
              <div className="composer-surface">
                <textarea
                  ref={taskTextareaRef}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  aria-label="Integration issue"
                  placeholder="Describe the enterprise issue or access request to run through the Secure A2A Gateway"
                />
                <div className="composer-action-row">
                  <div className="composer-helper">
                    <span>{isUserAuthenticated ? `Verified actor ${actorEmail ?? "current user"} will be attached to the A2A task and token metadata.` : "Login in Trust & Identity to unlock secure execution."}</span>
                    {!isUserAuthenticated ? (
                      <button type="button" className="composer-trust-link" onClick={goToTrustIdentity}>
                        Login to unlock execution
                      </button>
                    ) : null}
                  </div>
                  <button type="submit" className="composer-run-button" disabled={isLoading || !isUserAuthenticated}>
                    {isLoading ? "Running..." : isUserAuthenticated ? "Run secure task" : "Login required"}
                  </button>
                </div>
              </div>
            </form>

            {error ? <p className="error cockpit-error">{error}</p> : null}

            {renderGatewayResponseCard()}
          </section>

          <aside className="cockpit-side">
            {renderSecuritySummaryCard()}
            {renderLatestSecurityDetails()}
            <section className="cockpit-card selected-agents-card">
              <div className="section-heading-row">
                <div>
                  <p className="active-panel-eyebrow">Routing</p>
                  <h2>{latestResponse?.connectorRouting ? "Connector Route" : "Selected Agents"}</h2>
                </div>
              </div>
              {latestResponse?.connectorRouting ? (
                <div className="connector-side-route">
                  <strong>{connectorRoutingStatusLabel(latestResponse.connectorRouting.status)}</strong>
                  <span>{latestResponse.connectorRouting.targetSystem ?? "unknown"} / {latestResponse.connectorRouting.connectorId ?? "no connector"}</span>
                  <p>{latestResponse.connectorRouting.skillLabel ?? latestResponse.connectorRouting.skillId ?? "No skill/action mapped"}</p>
                  <small>Runtime mode: {latestResponse.connectorRuntime?.executed ? "external runtime executed" : latestResponse.connectorRuntime ? "external runtime failed safely" : "metadata-only"}</small>
                </div>
              ) : null}
              {latestResponse?.selectedAgents.length ? (
                <>
                  {latestResponse.connectorRouting ? <p className="muted-note">Supporting legacy/internal agents</p> : null}
                  <ul className="agent-list compact">
                    {latestResponse.selectedAgents.map((agent) => (
                      <li key={`${agent.agentId}-${agent.skillId ?? "default"}`}>
                        <strong>{agent.agentId}</strong>
                        <span>{agent.role}{agent.skillId ? ` / ${agent.skillId}` : ""}</span>
                        <p>{agent.matchedCapability ?? agent.reason}</p>
                      </li>
                    ))}
                  </ul>
                </>
              ) : latestResponse?.connectorRouting ? (
                <p className="muted-note">No legacy internal agents were used for this connector-first route.</p>
              ) : (
                <p className="muted-note">No agents selected yet.</p>
              )}
            </section>
            {renderTechnicalDetails()}
          </aside>
        </div>
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

    function installedCountForTemplate(template: SupportedConnectorGuardrail): number {
      return zeroTrustOnboardedAgents.filter((agent) =>
        agent.connectorId === template.connectorId ||
          agent.connectorProfile?.connectorId === template.connectorId ||
          agent.resourceSystem === template.resourceSystem ||
          agent.connectorProfile?.resourceSystem === template.resourceSystem
      ).length;
    }

    function lifecycleForInstalledAgent(agent: (typeof zeroTrustAgents)[number]) {
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

    function scenarioForResourceSystem(resourceSystem?: string): string {
      if (resourceSystem === "servicenow") {
        return "ServiceNow incident assignment keeps failing for network tickets";
      }
      if (resourceSystem === "github") {
        return "GitHub repository sync is failing after API rate limit";
      }
      return "Jira issue creation fails with 403 when creating issues in FIN project";
    }

    function runMatchingScenario(agent: (typeof zeroTrustAgents)[number]) {
      setMessage(scenarioForResourceSystem(agent.resourceSystem));
      setActiveTab("run-task");
      guideToTarget("composer");
    }

    function prefillReverification(agent: (typeof zeroTrustAgents)[number]) {
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
      setConnectionWizardCollapsedAfterSuccess(false);
      setConnectionWizardStep(zeroTrustDiscovery ? "verify" : "connection-input");
      guideToTarget("zero-trust-onboarding");
    }

    function renderAgentRegistrySummaryBar() {
      const summaryItems = [
        { label: "Connector templates:", value: registrySummary.connectorTemplates },
        { label: "Installed connectors:", value: registrySummary.installedConnectors },
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
        </section>
      );
    }

    function renderConnectorCatalog() {
      return (
        <section className="registry-section scroll-target" ref={connectorCatalogRef} tabIndex={-1}>
          <div className="section-heading-row">
            <div>
              <p className="active-panel-eyebrow">Supported templates</p>
              <h2>Connector Catalog</h2>
              <p className="muted-note">Connector templates are supported contracts, not installed or trusted agents. A customer organization starts with zero installed connectors.</p>
            </div>
          </div>
          <div className="connector-preset-grid" aria-label="Connector Catalog">
            {connectorTemplates.map((template) => {
              const preset = localConnectorPresets.find((item) => item.expectedConnectorId === template.connectorId);
              const installedCount = template.installedCount ?? installedCountForTemplate(template);
              const sourceLabel = template.source === "custom_sdk" ? "SDK / Bring your own connector" : "Local reference template";
              const runtimeSupportLabel = template.runtimeSupport === "planned" ? "Planned" : template.runtimeSupport === "not_supported" ? "Not supported" : "Supported";
              const metadataUnavailable = !template.category || !template.publisher || !template.templateVersion || !template.authModel || !template.runtimeSupport || !template.riskLevel;
              const installedBadge = installedCount > 0 ? `Installed agents: ${installedCount}` : "Not installed";
              return (
                <article className="connector-preset-card" key={template.connectorId}>
                  <div className="connector-card-heading">
                    <strong>{template.displayName}</strong>
                    <span className={`connector-template-badge ${installedCount > 0 ? "installed" : template.status === "planned" ? "planned" : "not-installed"}`}>
                      {template.connectorId === "custom-sdk" ? "Planned / V2" : installedBadge}
                    </span>
                  </div>
                  <p className="muted-note">{template.description ?? "Supported connector template for external agent onboarding."}</p>
                  <p className="connector-template-note">Template, not installed by default.</p>
                  <span>Category: {template.category ?? "Metadata unavailable"}</span>
                  <small>Source: {sourceLabel}</small>
                  <small>Status: {template.status === "planned" ? "Planned / V2" : "Available"}</small>
                  <small>Runtime support: {template.runtimeSupport ? runtimeSupportLabel : "Metadata unavailable"}</small>
                  <small>Risk level: {template.riskLevel ?? "Metadata unavailable"}</small>
                  <small>Installed count: {installedCount}</small>
                  <details className="wizard-technical-details">
                    <summary>Template details</summary>
                    <div className="registry-agent-metadata">
                      {metadataUnavailable ? <div><span>Metadata</span><strong>Metadata unavailable</strong></div> : null}
                      <div><span>Template ID</span><strong>{template.connectorId}</strong></div>
                      <div><span>Resource system</span><strong>{template.resourceSystem}</strong></div>
                      <div><span>Publisher</span><strong>{template.publisher ?? "Metadata unavailable"}</strong></div>
                      <div><span>Template version</span><strong>{template.templateVersion ?? "Metadata unavailable"}</strong></div>
                      <div><span>Auth model</span><strong>{template.authModel ?? "Metadata unavailable"}</strong></div>
                      <div><span>Setup requirements</span><strong>{template.setupRequirements?.join(", ") ?? "Metadata unavailable"}</strong></div>
                      <div><span>Tags</span><strong>{template.tags?.join(", ") ?? "Metadata unavailable"}</strong></div>
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
                      <button type="button" className="secondary-button compact-button" onClick={() => applyLocalConnectorPreset(preset)}>
                        {installedCount > 0 ? "Connect another external agent" : "Connect external agent"}
                      </button>
                      {installedCount > 0 ? (
                        <button type="button" className="secondary-button compact-button" onClick={() => guideToTarget("registered-agents")}>View installed agents</button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
          <p className="muted-note">Policies can govern which installed connector skills may execute. Advanced policy controls are planned for V2.</p>
          <details className="wizard-technical-details" open={customConnectorContractOpen} onToggle={(event) => setCustomConnectorContractOpen(event.currentTarget.open)}>
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

    function renderInstalledConnectorCard(agent: (typeof zeroTrustAgents)[number]) {
      const approved = (agent.approvedActions ?? agent.approvedCapabilities)?.length ?? 0;
      const blocked = (agent.blockedActions ?? agent.blockedCapabilities)?.length ?? 0;
      const lifecycle = lifecycleForInstalledAgent(agent);
      const detailsOpen = expandedInstalledAgentIds.includes(agent.agentId);
      return (
        <article className="registry-agent-card compact-agent-card" key={`installed-${agent.agentId}`}>
          <div className="registry-agent-card-header">
            <div className="agent-title-block">
              <strong>{agent.connectorDisplayName ?? agent.connectorId ?? agent.agentId}</strong>
              <div className="registry-agent-badges">
                <span className="source-badge">installed connector</span>
                <strong className={`health-pill ${lifecycle.state === "runtime_ready" ? "healthy" : "warning"}`}>{lifecycle.label}</strong>
              </div>
            </div>
          </div>
          <p className="muted-note">{lifecycle.reason}</p>
          <div className="registry-agent-compact-metadata">
            <span><b>Agent ID</b> {agent.agentId}</span>
            <span><b>Connector ID</b> {agent.connectorId ?? "unknown"}</span>
            <span><b>Resource system</b> {agent.resourceSystem ?? "unknown"}</span>
            <span><b>Trust level</b> {agent.trustLevel}</span>
            <span><b>Profile verified</b> {agent.connectorProfileVerified ? "yes" : "no"}</span>
            <span><b>Approved actions</b> {approved}</span>
            <span><b>Blocked actions</b> {blocked}</span>
            <span><b>Runtime endpoint</b> {agent.runtimeEndpoint ?? "not declared"}</span>
            <span><b>External config</b> {shortHash(agent.externalConfigHash)}</span>
            <span><b>Last onboarding</b> local session</span>
          </div>
          <div className="installed-connector-actions">
            <button type="button" className="secondary-button compact-button" onClick={() => {
              setExpandedInstalledAgentIds((current) =>
                current.includes(agent.agentId)
                  ? current.filter((id) => id !== agent.agentId)
                  : [...current, agent.agentId]
              );
            }}>View details</button>
            <button type="button" className="secondary-button compact-button" onClick={() => runMatchingScenario(agent)}>Run matching scenario</button>
            <button type="button" className="secondary-button compact-button" onClick={() => prefillReverification(agent)}>Re-verify</button>
          </div>
          {detailsOpen ? (
            <div className="installed-connector-details">
              <h4>Trusted connector metadata</h4>
              <div className="registry-agent-metadata">
                <div><span>Requested grants</span><strong>{agent.requestedScopes?.join(", ") || "none"}</strong></div>
                <div><span>Agent-declared skills</span><strong>{(agent.agentDeclaredSkills ?? agent.agentDeclaredCapabilities)?.join(", ") || "none"}</strong></div>
                <div><span>Approved actions</span><strong>{(agent.approvedActions ?? agent.approvedCapabilities)?.map((item) => item.label ?? item.capability).join(", ") || "none"}</strong></div>
                <div><span>Blocked actions</span><strong>{(agent.blockedActions ?? agent.blockedCapabilities)?.map((item) => `${item.label ?? item.capability}: ${item.reason}`).join("; ") || "none"}</strong></div>
                <div><span>Resource principal</span><strong>{agent.resourcePrincipal ?? "unknown"}</strong></div>
                <div><span>Execution state</span><strong>{agent.executionState}</strong></div>
              </div>
            </div>
          ) : null}
        </article>
      );
    }

    function renderInstalledConnectors() {
      const groups = [...new Map(zeroTrustAgents.map((agent) => [agent.resourceSystem ?? agent.connectorId ?? "unknown", agent])).keys()];
      return (
        <section className="registry-section scroll-target" ref={registeredAgentsRef} tabIndex={-1}>
          <div className="section-heading-row">
            <div>
              <p className="active-panel-eyebrow">Trusted agents</p>
              <h2>Installed Connectors</h2>
              <p className="muted-note">Installed connectors are external agents that passed signed onboarding and have trusted runtime metadata.</p>
            </div>
          </div>
          {zeroTrustAgents.length ? (
            <div className="registry-agent-list">
              {groups.map((group) => (
                <details className="registry-agent-group" key={group} open>
                  <summary>
                    <div>
                      <strong>{group}</strong>
                      <span>{zeroTrustAgents.filter((agent) => (agent.resourceSystem ?? agent.connectorId ?? "unknown") === group).length} installed connector agent(s)</span>
                    </div>
                    <b aria-hidden="true">v</b>
                  </summary>
                  <div className="registry-agent-group-body">
                    {zeroTrustAgents.filter((agent) => (agent.resourceSystem ?? agent.connectorId ?? "unknown") === group).map(renderInstalledConnectorCard)}
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <p className="muted-note">No connectors installed yet. Choose a connector template from the Connector Catalog to connect an external agent.</p>
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
                {agent.source === "zero-trust-onboarded" ? <small className="metadata-only-badge">metadata only</small> : null}
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
                    <strong>{(agent.approvedActions ?? agent.approvedCapabilities)?.map((item) => item.label ?? item.capability).join(", ") || "none"}</strong>
                  </div>
                  <div>
                    <span>Blocked actions</span>
                    <strong>{(agent.blockedActions ?? agent.blockedCapabilities)?.map((item) => `${item.label ?? item.capability}: ${item.reason}`).join("; ") || "none"}</strong>
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
      const navItems: Array<{ label: string; target: GuidedFocusTarget }> = [
        { label: `Connector Catalog (${registrySummary.connectorTemplates})`, target: "connector-catalog" },
        { label: "Connect Agent", target: "zero-trust-onboarding" },
        { label: `Installed Connectors (${registrySummary.installedConnectors})`, target: "registered-agents" },
        { label: "Legacy Agents", target: "legacy-agents" }
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
        <div className="panel-header">
          <div>
            <h2>Agent Registry</h2>
            <p className="muted-note">Choose connector templates from the Connector Catalog, then install trusted external connector agents through Zero-Trust onboarding.</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => {
            void loadZeroTrustOnboardedAgents();
            void checkAgentHealth();
          }} disabled={isHealthLoading}>
            {isHealthLoading ? "Refreshing..." : "Refresh registry"}
          </button>
        </div>

        {renderAgentRegistrySummaryBar()}

        {renderAgentRegistryNav()}

        {renderConnectorCatalog()}

        {renderZeroTrustOnboardingPanel()}

        {renderInstalledConnectors()}

        <details className="registry-overview-section scroll-target" ref={legacyAgentsRef} tabIndex={-1}>
          <summary>
            <div>
              <strong>Legacy Internal Demo Agents</strong>
              <span>Legacy internal mock agents are retained only for old demo flows. They are not part of the external connector product path.</span>
            </div>
            <b aria-hidden="true">v</b>
          </summary>
          <section className="registry-section">
            <div className="registry-summary-grid">
              <article>
                <span>Installed connectors</span>
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
        <div className="panel-header">
          <div>
            <h2>Trust & Identity</h2>
            <p className="muted-note">Security console for user-to-gateway identity, gateway-to-agent token posture, Mock IdP metadata, and control boundaries. Raw JWTs and A2A tokens stay hidden.</p>
          </div>
          <div className="identity-actions">
            <button type="button" className="secondary-button" onClick={() => {
              void checkAgentHealth();
              void loadTrustStatus();
            }} disabled={isHealthLoading || isIdentityLoading}>
              {isHealthLoading || isIdentityLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <section className={`trust-login-hero ${isTrustAuthenticated ? "authenticated" : "locked"} scroll-target`} ref={loginPanelRef} tabIndex={-1}>
          <div className="trust-login-copy">
            <p className="active-panel-eyebrow">Start here</p>
            <h2>{isTrustAuthenticated ? "Execution unlocked" : "Login required to unlock execution"}</h2>
            <p>{isTrustAuthenticated ? "Verified user identity is attached to this gateway session." : "Secure task execution is blocked until a verified user identity is attached to this gateway session."}</p>
          </div>
          {!isTrustAuthenticated ? (
            <div className="trust-login-form">
              <label>
                <span>Demo user</span>
                <select ref={demoUserSelectRef} value={selectedDemoUserEmail} onChange={(event) => setSelectedDemoUserEmail(event.target.value)} disabled={isIdentityLoading}>
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
                  Go to Run Task
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
        <div className="panel-header">
          <div>
            <h2>Security Timeline</h2>
            <p className="muted-note">Step-by-step view of identity, routing, policy, token issuance, agent execution, delegation, and audit for the latest task.</p>
            <p className="muted-note">Raw JWTs, bearer headers, client assertions, and secrets are intentionally redacted.</p>
          </div>
        </div>
        {latestResponse ? (
          <>
            <section className="timeline-executive-summary scroll-target" tabIndex={-1}>
              <p className="active-panel-eyebrow">Timeline Summary</p>
              <div>
                <span className="status-success">Identity verified</span>
                <span className={`status-${cockpitStatusClass(policySummary)}`}>Policy checked</span>
                <span className={`status-${cockpitStatusClass(tokenSummary)}`}>Scoped token {tokenSummary}</span>
                <span className={latestResponse.a2aResponses?.length ? "status-success" : "status-neutral"}>Agent {latestResponse.a2aResponses?.length ? "executed" : "not executed"}</span>
                <span className="status-success">Raw tokens hidden</span>
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

  return (
    <main className="shell single-panel-shell">
      <section className="workspace">
        <header className="topbar">
          <div className="topbar-copy">
            <p className="eyebrow">Secure A2A Control Plane</p>
            <h1>Secure Agent Orchestration Gateway</h1>
            <p className="subtitle">Import external agents through Agent Cards and govern execution with scoped JWTs, policy, and audit.</p>
          </div>
          <div className="topbar-actions">
            {isUserAuthenticated ? (
              <div className="status user-status authenticated">{userBadgeLabel}</div>
            ) : (
              <button type="button" className="status user-status anonymous clickable-status" onClick={goToTrustIdentity}>
                {userBadgeLabel}
              </button>
            )}
            <div className={`status execution-status ${isUserAuthenticated ? "unlocked" : "locked"}`}>Execution {isUserAuthenticated ? "unlocked" : "locked"}</div>
            <div className="status">
              {authModeLabel}
              {health?.orchestrator.secureAuthRequired ? " / Secure auth required" : ""}
            </div>
            <div className={`health-summary ${health?.summary.down ? "has-down" : health?.summary.degraded ? "has-degraded" : "all-healthy"}`}>
              <span>{isHealthLoading ? "Checking..." : healthLabel}</span>
              <small>{health?.orchestrator.status ?? "unknown"}</small>
            </div>
            <button type="button" className="secondary-button" onClick={startNewConversation} disabled={isLoading}>
              New conversation
            </button>
          </div>
        </header>

        <nav className="product-tabs" aria-label="Control plane sections">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id === "run-task") {
                  guideToTarget("composer");
                }
                if (tab.id === "agent-registry") {
                  guideToTarget("agent-registry");
                }
                if (tab.id === "trust-identity") {
                  guideToTarget("trust-login");
                }
                if (tab.id === "security-timeline") {
                  guideToTarget("security-timeline");
                }
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === "run-task" ? renderRunTaskTab() : null}
        {activeTab === "agent-registry" ? renderAgentRegistryTab() : null}
        {activeTab === "trust-identity" ? renderTrustIdentityTab() : null}
        {activeTab === "security-timeline" ? renderSecurityTimelineTab() : null}
      </section>

    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
