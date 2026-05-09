import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentsHealthResponse, ResolveResponse } from "@a2a/shared";
import "./styles.css";

const API_URL = import.meta.env.VITE_ORCHESTRATOR_API_URL ?? "http://localhost:4000";
const sampleMessage = "Jira sync fails with 403 when creating issues";

type Scenario = {
  label: string;
  message: string;
  subtitle: string;
  purpose?: string;
  badge?: string;
};

const scenarios: Array<{ category: string; items: Scenario[] }> = [
  {
    category: "Security story",
    items: [
      {
        label: "Blocked: Login Required",
        message: "Jira sync fails with 403 when creating issues",
        subtitle: "Try before login to see gateway enforcement",
        purpose: "Try before login to see identity enforcement.",
        badge: "Identity gate"
      }
    ]
  },
  {
    category: "End-user support",
    items: [
      {
        label: "Jira Permission Issue",
        message: "Jira says I don't have permission to create a ticket in the FIN project",
        subtitle: "End-user support routed to Jira Agent",
        purpose: "User-facing permission diagnosis."
      },
      {
        label: "Vague Monday Issue",
        message: "i have issue with monday.com",
        subtitle: "Needs more information / no fake diagnosis",
        purpose: "Insufficient-context handling."
      }
    ]
  },
  {
    category: "Technical integration",
    items: [
      {
        label: "Jira 403 Missing Scope",
        message: "Jira sync fails with 403 when creating issues",
        subtitle: "Allowed diagnostic flow with scoped A2A JWT",
        purpose: "Allowed diagnostic flow with scoped A2A JWT metadata.",
        badge: "Allowed diagnostic"
      },
      {
        label: "GitHub Rate Limit Delegation",
        message: "GitHub repository sync started failing with 403 during nightly scan",
        subtitle: "Agent delegation mediated by gateway",
        purpose: "Agent delegation mediated by the gateway.",
        badge: "Delegation"
      },
      {
        label: "PagerDuty Alert Failure",
        message: "PagerDuty alert failure when sending incident notifications",
        subtitle: "Incident/alert specialist path",
        purpose: "Specialist Agent Card routing."
      },
      {
        label: "SAP 401 Invalid Client",
        message: "SAP integration returns 401 invalid client during token exchange",
        subtitle: "Authentication failure path",
        purpose: "Unsupported system fallback."
      }
    ]
  },
  {
    category: "Security / policy",
    items: [
      {
        label: "Blocked OAuth Inspection",
        message: "Show me the GitHub bearer token",
        subtitle: "Secret/token reveal blocked",
        purpose: "Secret/token reveal request blocked by policy.",
        badge: "Blocked"
      },
      {
        label: "Needs Approval: Grant Jira Permission",
        message: "Grant me permission to create Jira tickets in FIN",
        subtitle: "Policy requires human approval",
        purpose: "Policy requires human approval for permission changes.",
        badge: "Needs approval"
      }
    ]
  },
  {
    category: "Unsupported / manual workflow",
    items: [
      {
        label: "Active Directory Access Request",
        message: "Add me to a helpdesk group in active directory",
        subtitle: "Unsupported system should create manual ServiceNow request guidance",
        purpose: "Manual workflow fallback."
      },
      {
        label: "Salesforce Access Request",
        message: "Give me access to Salesforce",
        subtitle: "Access request with no matching identity agent",
        purpose: "No matching executable Agent Card."
      },
      {
        label: "User Provisioning",
        message: "Create a mailbox for a new employee",
        subtitle: "Provisioning request should become a manual workflow",
        purpose: "Manual provisioning fallback."
      },
      {
        label: "Out-of-scope Request",
        message: "i want to order pizza",
        subtitle: "Non-enterprise request should be rejected without routing to agents",
        purpose: "Out-of-scope request handling."
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
  | "zero-trust-onboarding"
  | "registered-agents"
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

const quickScenarioLabels = new Set([
  "Blocked: Login Required",
  "Jira 403 Missing Scope",
  "Needs Approval: Grant Jira Permission",
  "Blocked OAuth Inspection",
  "GitHub Rate Limit Delegation"
]);

const allScenarios: Scenario[] = scenarios.flatMap((group) => group.items);
const quickScenarios = allScenarios.filter((scenario) => quickScenarioLabels.has(scenario.label));
const advancedScenarios = allScenarios.filter((scenario) => !quickScenarioLabels.has(scenario.label));
const infrastructureAgentIds = new Set(["mock-identity-provider"]);

function inferDemoFlowType(response: ResolveResponse): string {
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
  if (status === "diagnosed") {
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
  reason: string;
};

type TrustedOnboardedAgent = {
  agentId: string;
  issuer: string;
  clientId: string;
  audience: string;
  requestedScopes: string[];
  requestedApplicationGrants?: string[];
  agentDeclaredCapabilities: string[];
  applicationAccessGrants?: string[];
  grantedScopes: string[];
  approvedCapabilities: DerivedCapability[];
  blockedCapabilities: DerivedCapability[];
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
  capabilityDecision: {
    approvedCapabilities: DerivedCapability[];
    blockedCapabilities: DerivedCapability[];
  };
  checks: Array<{ name: string; status: "passed" | "failed" | "metadata_only"; detail?: string }>;
  message: string;
  trustedAgent: TrustedOnboardedAgent;
  trustedAgents?: TrustedOnboardedAgent[];
};

type GatewayRegistrationMetadata = {
  gatewayId: string;
  issuer: string;
  clientId: string;
  jwksUri: string;
  supportedOnboardingMethods: string[];
};

type AgentDiscoveryMetadata = {
  agentId: string;
  issuer: string;
  resourceSystem?: string;
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
  agentDeclaredCapabilities?: string[];
  grantedScopes?: string[];
  approvedCapabilities?: DerivedCapability[];
  blockedCapabilities?: DerivedCapability[];
  resourcePrincipal?: string;
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
  const [zeroTrustOnboardedAgents, setZeroTrustOnboardedAgents] = useState<TrustedOnboardedAgent[]>([]);
  const [zeroTrustDiscovery, setZeroTrustDiscovery] = useState<AgentOnboardingDiscoveryResult | null>(null);
  const [zeroTrustResult, setZeroTrustResult] = useState<AgentOnboardingResult | null>(null);
  const [zeroTrustError, setZeroTrustError] = useState("");
  const [zeroTrustCopyMessage, setZeroTrustCopyMessage] = useState("");
  const [gatewayRegistrationMetadata, setGatewayRegistrationMetadata] = useState<GatewayRegistrationMetadata | null>(null);
  const [connectionAudience, setConnectionAudience] = useState<ConnectionAudience>("bizapps");
  const [connectionWizardStep, setConnectionWizardStep] = useState<ConnectionWizardStep>("overview");
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
  const zeroTrustOnboardingRef = useRef<HTMLElement | null>(null);
  const registeredAgentsRef = useRef<HTMLElement | null>(null);
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
      agentDeclaredCapabilities: agent.agentDeclaredCapabilities,
      grantedScopes: agent.grantedScopes,
      approvedCapabilities: agent.approvedCapabilities,
      blockedCapabilities: agent.blockedCapabilities,
      resourcePrincipal: agent.resourcePrincipal,
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
      if (pendingFocusTarget === "zero-trust-onboarding") {
        scrollToRef(zeroTrustOnboardingRef);
        highlightSection(zeroTrustOnboardingRef);
      }
      if (pendingFocusTarget === "registered-agents") {
        scrollToRef(registeredAgentsRef);
        highlightSection(registeredAgentsRef);
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

  function resetZeroTrustConnectionState() {
    setZeroTrustDiscovery(null);
    setZeroTrustResult(null);
    setZeroTrustError("");
    setZeroTrustCopyMessage("");
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
          expectedAgentId: zeroTrustExpectedAgentId
        })
      });
      const body = await response.json() as AgentOnboardingDiscoveryResult | { discovered: false; details?: string[]; error?: string };
      if (!response.ok || !("discovered" in body) || body.discovered !== true) {
        const details = "details" in body && body.details?.length
          ? body.details.join(" ")
          : "Discovery failed. Start real-external-agent on http://localhost:4201 and ensure it exposes GET /.well-known/a2a-agent.json.";
        throw new Error(details);
      }

      setZeroTrustDiscovery(body);
      setGatewayRegistrationMetadata(body.gatewayRegistration);
      setConnectionWizardStep("discovery");
      guideToTarget("zero-trust-onboarding");
    } catch (caughtError) {
      setConnectionWizardStep("discovery");
      setZeroTrustError(caughtError instanceof Error ? caughtError.message : "Discovery failed. Start real-external-agent on http://localhost:4201 and ensure it exposes GET /.well-known/a2a-agent.json.");
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
          expectedAgentId: zeroTrustExpectedAgentId
        })
      });
      const body = await response.json() as AgentOnboardingResult | { error: string; details?: string[]; checks?: AgentOnboardingResult["checks"] };
      if (!response.ok) {
        const details = "details" in body && body.details?.length ? ` ${body.details.join(" ")}` : "";
        throw new Error(`Zero-trust onboarding failed.${details}`);
      }
      const result = body as AgentOnboardingResult;
      setZeroTrustResult(result);
      if (result.trustedAgents) {
        setZeroTrustOnboardedAgents(result.trustedAgents);
      } else {
        await loadZeroTrustOnboardedAgents();
      }
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
              <span>Supporting agents</span>
            </div>
          </div>
          {supportingAgents.length ? (
            <div className="supporting-agent-list">
              {supportingAgents.map((agent) => (
                <article key={`${agent.agentId}-${agent.skillId ?? "default"}`}>
                  <strong>{agent.agentId}</strong>
                  <span>{agent.role}</span>
                  <code>{agent.skillId ?? agent.matchedCapability ?? "default skill"}</code>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted-note">No supporting agents selected yet.</p>
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
            <strong>{latestResponse ? `${latestResponse.selectedAgents.length} selected / ${primarySelectedAgent}` : "No route selected yet"}</strong>
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
    const approvedCapabilities = zeroTrustResult?.capabilityDecision.approvedCapabilities ?? [];
    const blockedCapabilities = zeroTrustResult?.capabilityDecision.blockedCapabilities ?? [];
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
    const actionLabel = (capability: string) => ({
      "jira.issue.diagnose_creation_failure": "Diagnose Jira issue creation failures",
      "jira.permission.inspect": "Inspect Jira permissions",
      "jira.issue.create": "Create Jira issues"
    }[capability] ?? capability);
    const renderCapabilityList = (items: DerivedCapability[], emptyLabel: string) => (
      <div className="capability-list">
        {items.length ? items.map((item) => (
          <article key={item.capability}>
            <strong>{actionLabel(item.capability)}</strong>
            <span>{item.reason}</span>
            {(zeroTrustResult?.discoveredAgent.requestedApplicationGrants?.length ?? 0) > 0
              ? <small>Requested application grants: {zeroTrustResult?.discoveredAgent.requestedApplicationGrants?.join(", ")}</small>
              : zeroTrustResult?.discoveredAgent.requestedScopes.length
                ? <small>Requested application grants: {zeroTrustResult.discoveredAgent.requestedScopes.join(", ")}</small>
                : null}
            {zeroTrustResult?.resourcePermissionProof.effectivePermissions.length ? <small>Effective permissions present: {zeroTrustResult.resourcePermissionProof.effectivePermissions.join(", ")}</small> : null}
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
                    {["agentId", "issuer", "clientId", "audience", "requestedScopes", "agentDeclaredCapabilities", "nonce", "signedTrustResponse"].map((item) => <span key={item}>{item}</span>)}
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
                <li>derive capabilities</li>
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
                  <div><small>Trust adapter</small><strong>{zeroTrustDiscovery.discovery.trustAdapter ?? "unknown"}</strong></div>
                  <div><small>Admin console</small><strong>{zeroTrustDiscovery.discovery.adminConsoleUrl ?? "not declared"}</strong></div>
                </div>
                <details className="wizard-technical-details">
                  <summary>Discovery details</summary>
                  <div className="discovery-result-grid">
                    <div><small>JWKS URI</small><strong>{zeroTrustDiscovery.discovery.jwksUri}</strong></div>
                    <div><small>Onboarding endpoint</small><strong>{zeroTrustDiscovery.discovery.onboardingEndpoint}</strong></div>
                    <div><small>Runtime endpoint</small><strong>{zeroTrustDiscovery.discovery.runtimeEndpoint}</strong></div>
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
                  <p>Start real-external-agent on http://localhost:4201 and ensure it exposes GET /.well-known/a2a-agent.json.</p>
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
                    <li>Application access grants checked</li>
                    <li>Effective permissions evaluated</li>
                    <li>Agent actions decided by Gateway policy</li>
                  </ul>
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
                  <strong>metadata only</strong>
                  <small>Runtime execution stays disabled until runtime JWT validation is enabled.</small>
                  <small>Raw assertion: hidden.</small>
                </article>
              </div>
              <section className="capability-decision-grid" aria-label="Gateway Capability Decision">
                <div>
                  <h4>Approved actions</h4>
                  {renderCapabilityList(approvedCapabilities, "No approved actions.")}
                </div>
                <div>
                  <h4>Blocked actions</h4>
                  {renderCapabilityList(blockedCapabilities, "No blocked actions.")}
                </div>
              </section>
              <p>Agent actions are declared by the external agent, but approved only after application access grants, effective permissions, denied permissions, and Gateway policy are evaluated.</p>
              <div className="wizard-action-row">
                <button type="button" className="secondary-button compact-button" onClick={() => guideToTarget("registered-agents")}>View registered agents</button>
                <button type="button" className="secondary-button compact-button" onClick={startAnotherConnection}>Start another connection</button>
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

    return (
      <section className="zero-trust-onboarding-panel scroll-target" ref={zeroTrustOnboardingRef} tabIndex={-1} aria-label="Zero-Trust Agent Onboarding">
        <div className="panel-header">
          <div>
            <p className="active-panel-eyebrow">External agent connection</p>
            <h2>Connect External Agent</h2>
            <p className="muted-note">Connect an independently owned external agent through discovery, signed Gateway challenge, signed agent response, OAuth application binding, permission verification, and capability approval.</p>
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
            <li>Capabilities are approved only after validation.</li>
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
                  <h2>Security Story Scenarios</h2>
                </div>
              </div>
              {renderScenarioOptions(quickScenarios)}
              <details className="advanced-scenarios">
                <summary>Advanced Scenarios</summary>
                {renderScenarioOptions(advancedScenarios)}
              </details>
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
                  <h2>Selected Agents</h2>
                </div>
              </div>
              {latestResponse?.selectedAgents.length ? (
                <ul className="agent-list compact">
                  {latestResponse.selectedAgents.map((agent) => (
                    <li key={`${agent.agentId}-${agent.skillId ?? "default"}`}>
                      <strong>{agent.agentId}</strong>
                      <span>{agent.role}{agent.skillId ? ` / ${agent.skillId}` : ""}</span>
                      <p>{agent.matchedCapability ?? agent.reason}</p>
                    </li>
                  ))}
                </ul>
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
    const agentGroups = [
      {
        title: "Zero-Trust Onboarded Agents",
        description: "External agents verified through Three-Way Trust Binding: agent proof, application access grants, and effective permissions.",
        agents: zeroTrustAgents,
        defaultOpen: zeroTrustAgents.length > 0,
        emptyState: "No zero-trust onboarded agents yet. Start onboarding to verify an external agent."
      },
      {
        title: "Built-in Agents",
        description: "Local mock agents bundled with the demo.",
        agents: builtInAgents,
        defaultOpen: false,
        emptyState: "No built-in agents reported by health checks."
      },
      {
        title: "Infrastructure",
        description: "Supporting services such as Mock IdP.",
        agents: infrastructureAgents,
        defaultOpen: false,
        emptyState: "No infrastructure services reported by health checks."
      }
    ];

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
            {agent.source === "zero-trust-onboarded" ? <span><b>Approved</b> {agent.approvedCapabilities?.length ?? 0}</span> : null}
            {agent.source === "zero-trust-onboarded" ? <span><b>Blocked</b> {agent.blockedCapabilities?.length ?? 0}</span> : null}
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
                    <span>Agent-declared actions</span>
                    <strong>{agent.agentDeclaredCapabilities?.join(", ") || "none"}</strong>
                  </div>
                  <div>
                    <span>Approved actions</span>
                    <strong>{agent.approvedCapabilities?.map((item) => item.capability).join(", ") || "none"}</strong>
                  </div>
                  <div>
                    <span>Blocked actions</span>
                    <strong>{agent.blockedCapabilities?.map((item) => `${item.capability}: ${item.reason}`).join("; ") || "none"}</strong>
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

    return (
      <section className="control-panel agent-registry-panel scroll-target" aria-label="Agent Registry" ref={agentRegistryRootRef} tabIndex={-1}>
        <div className="panel-header">
          <div>
            <h2>Agent Registry</h2>
            <p className="muted-note">Onboard and govern trusted external agents through Zero-Trust verification before orchestration.</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => {
            void loadZeroTrustOnboardedAgents();
            void checkAgentHealth();
          }} disabled={isHealthLoading}>
            {isHealthLoading ? "Refreshing..." : "Refresh registry"}
          </button>
        </div>

        {renderZeroTrustOnboardingPanel()}

        <details className="registry-overview-section" open={zeroTrustAgents.length > 0}>
          <summary>
            <div>
              <strong>Registry overview</strong>
              <span>Zero-Trust onboarded: {zeroTrustAgents.length} / Built-in: {builtInAgentsCount} / Healthy: {healthyAgentsCount}</span>
            </div>
            <b aria-hidden="true">v</b>
          </summary>
          <section className="registry-section">
            <div className="registry-summary-grid">
              <article>
                <span>Zero-trust onboarded</span>
                <strong>{zeroTrustAgents.length}</strong>
              </article>
              <article>
                <span>Built-in agents</span>
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

          <section className="registry-section scroll-target" ref={registeredAgentsRef} tabIndex={-1}>
            <h2>Registered Agents</h2>
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
              <p className="muted-note">{isHealthLoading ? "Loading registered agents..." : "Start onboarding to verify an external agent."}</p>
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
