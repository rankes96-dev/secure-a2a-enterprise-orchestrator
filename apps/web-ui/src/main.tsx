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
  | "agent-import"
  | "agent-validation"
  | "registered-agents"
  | "generated-agent-card"
  | "security-timeline";

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

function endpointMetadata(endpoint: string | undefined): { endpointType: AgentCardEndpointType; endpointScheme: AgentCardValidationSummary["endpointScheme"] } {
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

function endpointTypeLabel(endpointType: AgentCardEndpointType | "internal", endpointScheme?: AgentCardValidationSummary["endpointScheme"]): string {
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

type DemoAgentCard = {
  agentId: string;
  name: string;
  description: string;
  systems: string[];
  endpoint: string;
  auth: { type: string; audience: string };
  skills: Array<{
    id: string;
    name: string;
    description: string;
    examples?: string[];
    requiredScopes?: string[];
    capabilities?: string[];
    supportingCapabilities?: string[];
    requestedAction?: string;
    requiredPermission?: string;
    riskLevel?: "low" | "medium" | "high" | "sensitive";
    owner?: string;
    scope?: {
      systems?: string[];
      resourceTypes?: string[];
    };
    sensitive?: boolean;
  }>;
};

type AgentCardEndpointType = "public" | "session" | "unknown";

type AgentCardValidationSummary = {
  agentId: string;
  name: string;
  authType: string;
  audience: string;
  capabilities: string[];
  requiredScopes: string[];
  riskLevels: Array<"low" | "medium" | "high" | "sensitive">;
  endpointType: AgentCardEndpointType;
  endpointScheme: "https" | "http" | "session" | "unknown";
};

type AgentCardValidationResult =
  | {
      valid: true;
      agentCard: DemoAgentCard;
      summary: AgentCardValidationSummary;
      warnings: string[];
    }
  | {
      valid: false;
      error: "invalid_agent_card";
      details: string[];
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
    agentCardImportFetchesExternalUrls: boolean;
    importedAgentsExecutable: boolean;
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

type DemoAgentCardInput = {
  system: string;
  agentSlug: string;
  agentName: string;
  description: string;
  diagnosisGoal: string;
  capability: string;
  requiredScope: string;
  riskLevel: "low" | "medium" | "high" | "sensitive";
  resourceTypes: string;
  examples: string;
  supportingHelpOptions: string[];
};

const emptyDemoAgentInput: DemoAgentCardInput = {
  system: "",
  agentSlug: "",
  agentName: "",
  description: "",
  diagnosisGoal: "",
  capability: "",
  requiredScope: "",
  riskLevel: "low",
  resourceTypes: "incident, ticket, account",
  examples: "",
  supportingHelpOptions: []
};

const sampleAgentCardJson = `{
  "agentId": "external-salesforce-access-agent",
  "name": "Salesforce Access Agent",
  "description": "Diagnoses Salesforce login and permission issues.",
  "systems": ["salesforce"],
  "endpoint": "https://agents.example.com/salesforce/task",
  "auth": {
    "type": "oauth2_client_credentials_jwt",
    "audience": "external-salesforce-access-agent"
  },
  "skills": [
    {
      "id": "salesforce-access-diagnose",
      "name": "Diagnose Salesforce access",
      "description": "Checks Salesforce access issues and missing permissions.",
      "capabilities": ["salesforce.access.diagnose"],
      "requiredScopes": ["salesforce.access.read"],
      "riskLevel": "medium",
      "examples": ["I cannot login to Salesforce", "User cannot access Salesforce account"],
      "scope": {
        "systems": ["salesforce"],
        "resourceTypes": ["user", "account", "permission"]
      }
    }
  ]
}`;

const supportingHelpOptions = [
  { value: "oauth_scope_compare", label: "OAuth scope comparison" },
  { value: "api_health", label: "API health / rate limit" },
  { value: "security_policy", label: "Security policy evaluation" }
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

  if (body?.error === "demo_agent_limit_reached") {
    return `You can create up to ${body.limit ?? 5} session sample agents. Delete one before adding another.`;
  }

  if (body?.error === "invalid_demo_agent_input") {
    const details = body.details?.length ? ` ${body.details.join(" ")}` : "";
    return `Sample Agent Card input is invalid.${details}`;
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
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [deleteAgentError, setDeleteAgentError] = useState("");
  const [deleteAgentMessage, setDeleteAgentMessage] = useState("");
  const [demoAgentInput, setDemoAgentInput] = useState<DemoAgentCardInput>(emptyDemoAgentInput);
  const [demoAgentPreview, setDemoAgentPreview] = useState<DemoAgentCard | null>(null);
  const [demoAgentCards, setDemoAgentCards] = useState<DemoAgentCard[]>([]);
  const [importedAgentCards, setImportedAgentCards] = useState<DemoAgentCard[]>([]);
  const [demoAgentWarnings, setDemoAgentWarnings] = useState<string[]>([]);
  const [demoAgentError, setDemoAgentError] = useState("");
  const [demoAgentSuccessMessage, setDemoAgentSuccessMessage] = useState("");
  const [recentlyAddedDemoAgentId, setRecentlyAddedDemoAgentId] = useState("");
  const [agentCardJson, setAgentCardJson] = useState("");
  const [agentCardValidation, setAgentCardValidation] = useState<AgentCardValidationResult | null>(null);
  const [agentCardImportError, setAgentCardImportError] = useState("");
  const [agentCardImportSuccess, setAgentCardImportSuccess] = useState("");
  const [isAgentCardValidating, setIsAgentCardValidating] = useState(false);
  const [isAgentCardImporting, setIsAgentCardImporting] = useState(false);
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
  const importAgentCardRef = useRef<HTMLElement | null>(null);
  const agentCardValidationRef = useRef<HTMLDivElement | null>(null);
  const registeredAgentsRef = useRef<HTMLElement | null>(null);
  const generatedAgentCardRef = useRef<HTMLElement | null>(null);
  const securityTimelineRootRef = useRef<HTMLElement | null>(null);
  const timelineListRef = useRef<HTMLElement | null>(null);
  const demoAgentListRef = useRef<HTMLDivElement | null>(null);
  const agentCardImportRef = useRef<HTMLDivElement | null>(null);
  const sampleAgentBuilderRef = useRef<HTMLDivElement | null>(null);
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
  const healthAgentIds = new Set(health?.agents.map((agent) => agent.agentId) ?? []);
  const demoAgentCardById = new Map(demoAgentCards.map((card) => [card.agentId, card]));
  const importedAgentCardById = new Map(importedAgentCards.map((card) => [card.agentId, card]));
  const builtInAgentsCount = health?.agents.filter((agent) => agent.endpointType !== "session" && !infrastructureAgentIds.has(agent.agentId)).length ?? 0;
  const sessionDemoAgentsCount = demoAgentCards.length || health?.agents.filter((agent) => agent.endpointType === "session").length || 0;
  const healthyAgentsCount = health?.summary.healthy ?? 0;
  const registeredAgentRows = [
    ...(health?.agents.map((agent) => {
      const demoAgentCard = demoAgentCardById.get(agent.agentId);
      const importedAgentCard = importedAgentCardById.get(agent.agentId);
      return {
        agentId: agent.agentId,
        status: agent.status,
        endpointType: agent.endpointType,
        endpointScheme: endpointMetadata(demoAgentCard?.endpoint ?? importedAgentCard?.endpoint).endpointScheme,
        authMode: demoAgentCard?.auth?.type ?? importedAgentCard?.auth?.type ?? "unknown",
        latencyMs: agent.latencyMs,
        agentCardAvailable: agent.details.agentCardAvailable || Boolean(demoAgentCard) || Boolean(importedAgentCard),
        error: agent.error,
        canDelete: agent.endpointType === "session",
        source: infrastructureAgentIds.has(agent.agentId) ? "infrastructure" : demoAgentCard ? "session-generated" : importedAgentCard ? "session-imported" : "built-in"
      };
    }) ?? []),
    ...demoAgentCards
      .filter((card) => !healthAgentIds.has(card.agentId))
      .map((card) => ({
        agentId: card.agentId,
        status: "unknown",
        endpointType: "session" as const,
        endpointScheme: "session" as const,
        authMode: card.auth?.type ?? "unknown",
        latencyMs: undefined,
        agentCardAvailable: true,
        error: undefined,
        canDelete: true,
        source: "session-generated"
      })),
    ...importedAgentCards
      .filter((card) => !healthAgentIds.has(card.agentId))
      .map((card) => {
        const endpoint = endpointMetadata(card.endpoint);
        return {
          agentId: card.agentId,
          status: "unknown",
          endpointType: endpoint.endpointType,
          endpointScheme: endpoint.endpointScheme,
          authMode: card.auth?.type ?? "unknown",
          latencyMs: undefined,
          agentCardAvailable: true,
          error: undefined,
          canDelete: true,
          source: "session-imported"
        };
      })
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

  function resetDemoAgentDraft() {
    setDemoAgentInput(emptyDemoAgentInput);
    setDemoAgentPreview(null);
    setDemoAgentWarnings([]);
    setDemoAgentError("");
  }

  function clearDemoAgentStatus() {
    setDemoAgentSuccessMessage("");
    setRecentlyAddedDemoAgentId("");
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

  async function deleteRegistryAgent(agentId: string, source: string) {
    if (source !== "session-generated" && source !== "session-imported") {
      return;
    }

    const confirmed = window.confirm(`Remove agent ${agentId} from this orchestrator session?`);
    if (!confirmed) {
      return;
    }

    setDeleteAgentError("");
    setDeleteAgentMessage("");
    setDeletingAgentId(agentId);

    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/${source === "session-imported" ? "agent-cards" : "agents"}/${encodeURIComponent(agentId)}`, {
        method: "DELETE",
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error(await friendlyApiError(response, source === "session-imported" ? "Failed to delete imported Agent Card" : "Failed to delete generated sample Agent"));
      }

      const body = await response.json() as { deleted: boolean; agentId: string; remainingAgents?: string[]; agentCards?: DemoAgentCard[] };
      if (source === "session-imported" && body.agentCards) {
        setImportedAgentCards(body.agentCards);
      }
      setDeleteAgentMessage(source === "session-imported" ? "Removed imported Agent Card from this session." : "Removed generated sample Agent from this session.");
      await loadDemoAgentCards();
      await loadImportedAgentCards();
      await checkAgentHealth();
    } catch (caughtError) {
      setDeleteAgentError(caughtError instanceof Error ? caughtError.message : "Failed to delete agent");
    } finally {
      setDeletingAgentId(null);
    }
  }

  useEffect(() => {
    void checkAgentHealth();
    void loadTrustStatus();
  }, []);

  useEffect(() => {
    if (activeTab === "agent-registry") {
      void loadDemoAgentCards();
      void loadImportedAgentCards();
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
      if (pendingFocusTarget === "agent-import") {
        scrollToRef(importAgentCardRef);
        highlightSection(importAgentCardRef);
      }
      if (pendingFocusTarget === "agent-validation") {
        scrollToRef(agentCardValidationRef);
        highlightSection(agentCardValidationRef);
        if (agentCardValidation?.valid === false) {
          focusElement(agentCardValidationRef);
        }
      }
      if (pendingFocusTarget === "registered-agents") {
        scrollToRef(registeredAgentsRef);
        highlightSection(registeredAgentsRef);
      }
      if (pendingFocusTarget === "generated-agent-card") {
        const targetRef = generatedAgentCardRef.current ? generatedAgentCardRef : sampleAgentBuilderRef;
        scrollToRef(targetRef);
        highlightSection(targetRef);
      }
      if (pendingFocusTarget === "security-timeline") {
        const targetRef = timelineListRef.current ? timelineListRef : securityTimelineRootRef;
        scrollToRef(targetRef);
        highlightSection(targetRef);
      }
      setPendingFocusTarget(null);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeTab, pendingFocusTarget, latestResponse, agentCardValidation, demoAgentPreview, registeredAgentRows.length]);

  async function ensureSession() {
    const response = await fetch(`${API_URL}/session`, {
      method: "POST",
      credentials: "include"
    });

    if (!response.ok) {
      throw new Error(await friendlyApiError(response, "Failed to create browser session"));
    }
  }

  function demoRequestBody() {
    return {
      ...demoAgentInput,
      resourceTypes: demoAgentInput.resourceTypes.split(",").map((item) => item.trim()).filter(Boolean),
      examples: demoAgentInput.examples.split(",").map((item) => item.trim()).filter(Boolean),
      capability: demoAgentInput.capability.trim() || undefined,
      requiredScope: demoAgentInput.requiredScope.trim() || undefined
    };
  }

  function toggleSupportingHelpOption(option: string) {
    clearDemoAgentStatus();
    setDemoAgentInput((current) => {
      const enabled = current.supportingHelpOptions.includes(option);
      return {
        ...current,
        supportingHelpOptions: enabled
          ? current.supportingHelpOptions.filter((item) => item !== option)
          : [...current.supportingHelpOptions, option]
      };
    });
  }

  async function loadDemoAgentCards() {
    setDemoAgentError("");
    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/demo-agent-cards`, {
        method: "GET",
        credentials: "include"
      });
      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to load sample Agent Cards"));
      }
      const body = await response.json() as { agentCards: DemoAgentCard[] };
      setDemoAgentCards(body.agentCards);
    } catch (caughtError) {
      setDemoAgentError(caughtError instanceof Error ? caughtError.message : "Failed to load sample Agent Cards");
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

  async function loadImportedAgentCards() {
    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/agent-cards`, {
        method: "GET",
        credentials: "include"
      });
      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to load imported Agent Cards"));
      }
      const body = await response.json() as { agentCards: DemoAgentCard[] };
      setImportedAgentCards(body.agentCards);
    } catch (caughtError) {
      setAgentCardImportError(caughtError instanceof Error ? caughtError.message : "Failed to load imported Agent Cards");
    }
  }

function parsePastedAgentCard(): unknown | undefined {
    if (!agentCardJson.trim()) {
      setAgentCardValidation({ valid: false, error: "invalid_agent_card", details: ["Paste Agent Card JSON before validating."] });
      setAgentCardImportError("");
      guideToTarget("agent-validation");
      return undefined;
    }

    try {
      return JSON.parse(agentCardJson) as unknown;
    } catch {
      setAgentCardValidation({ valid: false, error: "invalid_agent_card", details: ["Invalid JSON. Check the pasted Agent Card syntax."] });
      setAgentCardImportError("");
      guideToTarget("agent-validation");
      return undefined;
    }
  }

  async function validatePastedAgentCard() {
    const parsedAgentCard = parsePastedAgentCard();
    if (!parsedAgentCard) {
      return;
    }

    setAgentCardImportError("");
    setAgentCardImportSuccess("");
    setIsAgentCardValidating(true);

    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/agent-cards/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ agentCard: parsedAgentCard })
      });
      const body = await response.json() as AgentCardValidationResult;
      setAgentCardValidation(body);
      if (!response.ok && body.valid !== false) {
        throw new Error("Failed to validate Agent Card");
      }
      guideToTarget("agent-validation");
    } catch (caughtError) {
      setAgentCardImportError(caughtError instanceof Error ? caughtError.message : "Failed to validate Agent Card");
      guideToTarget("agent-validation");
    } finally {
      setIsAgentCardValidating(false);
    }
  }

  async function importPastedAgentCard() {
    const parsedAgentCard = parsePastedAgentCard();
    if (!parsedAgentCard || agentCardValidation?.valid !== true) {
      return;
    }

    setAgentCardImportError("");
    setAgentCardImportSuccess("");
    setIsAgentCardImporting(true);

    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/agent-cards/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ agentCard: parsedAgentCard })
      });
      const body = await response.json() as { imported?: boolean; agentCard?: DemoAgentCard; agentCards?: DemoAgentCard[]; warnings?: string[] } | AgentCardValidationResult;
      if (!response.ok) {
        if ("valid" in body && body.valid === false) {
          setAgentCardValidation(body);
        }
        throw new Error("Failed to import Agent Card");
      }
      if ("agentCards" in body && body.agentCards) {
        setImportedAgentCards(body.agentCards);
      }
      setAgentCardImportSuccess("Agent Card imported into this session as metadata. Execution is disabled until external runtime validation is enabled.");
      await loadImportedAgentCards();
      await loadDemoAgentCards();
      await checkAgentHealth();
      guideToTarget("registered-agents");
    } catch (caughtError) {
      setAgentCardImportError(caughtError instanceof Error ? caughtError.message : "Failed to import Agent Card");
    } finally {
      setIsAgentCardImporting(false);
    }
  }

  function clearPastedAgentCard() {
    setAgentCardJson("");
    setAgentCardValidation(null);
    setAgentCardImportError("");
    setAgentCardImportSuccess("");
  }

  async function generateDemoAgentPreview() {
    setDemoAgentError("");
    clearDemoAgentStatus();
    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/demo-agent-cards/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(demoRequestBody())
      });
      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to generate sample Agent Card"));
      }
      const body = await response.json() as { agentCard: DemoAgentCard; warnings: string[] };
      setDemoAgentPreview(body.agentCard);
      setDemoAgentWarnings(body.warnings);
      guideToTarget("generated-agent-card");
    } catch (caughtError) {
      setDemoAgentError(caughtError instanceof Error ? caughtError.message : "Failed to generate sample Agent Card");
    }
  }

  async function addDemoAgentToSession() {
    setDemoAgentError("");
    setDemoAgentSuccessMessage("");
    setRecentlyAddedDemoAgentId("");
    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/demo-agent-cards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(demoAgentPreview ?? demoRequestBody())
      });
      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to add sample Agent Card"));
      }
      const body = await response.json() as { agentCard: DemoAgentCard; agentCards: DemoAgentCard[]; warnings: string[] };
      setDemoAgentCards(body.agentCards);
      setDemoAgentWarnings(body.warnings);
      setDemoAgentSuccessMessage("Sample Agent added to this session.");
      setRecentlyAddedDemoAgentId(body.agentCard.agentId);
      setDemoAgentInput(emptyDemoAgentInput);
      setDemoAgentPreview(null);
      if (messages.length > 0) {
        startNewConversation();
      }
      await checkAgentHealth();
      guideToTarget("registered-agents");
    } catch (caughtError) {
      setDemoAgentError(caughtError instanceof Error ? caughtError.message : "Failed to add sample Agent Card");
    }
  }

  async function deleteSessionDemoAgent(agentId: string) {
    setDemoAgentError("");
    clearDemoAgentStatus();
    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/demo-agent-cards/${encodeURIComponent(agentId)}`, {
        method: "DELETE",
        credentials: "include"
      });
      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to delete sample Agent Card"));
      }
      const body = await response.json() as { agentCards: DemoAgentCard[] };
      setDemoAgentCards(body.agentCards);
      if (demoAgentPreview?.agentId === agentId) {
        setDemoAgentPreview(null);
      }
      await checkAgentHealth();
    } catch (caughtError) {
      setDemoAgentError(caughtError instanceof Error ? caughtError.message : "Failed to delete sample Agent Card");
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

  function renderAgentCardImport() {
    const validationSummary = agentCardValidation?.valid ? agentCardValidation.summary : null;
    const validationWarnings = agentCardValidation?.valid ? agentCardValidation.warnings : [];
    const validationDetails = agentCardValidation?.valid === false ? agentCardValidation.details : [];

    return (
      <section className="agent-card-import" aria-label="Import Agent Card">
        <div className="panel-header">
          <div>
            <p className="active-panel-eyebrow">Paste import</p>
            <h2>Import Agent Card</h2>
            <p className="muted-note">Paste a standardized Agent Card JSON published by an external agent. The gateway validates capabilities, scopes, auth audience, risk level, and endpoint metadata before allowing orchestration.</p>
            <p className="muted-note">Imported Agent Cards are registered as metadata only in this phase. The gateway validates their contract, but does not call the external endpoint or execute the agent yet.</p>
          </div>
        </div>
        <textarea
          value={agentCardJson}
          onChange={(event) => {
            setAgentCardJson(event.target.value);
            setAgentCardValidation(null);
            setAgentCardImportError("");
            setAgentCardImportSuccess("");
          }}
          placeholder={sampleAgentCardJson}
          aria-label="Agent Card JSON"
        />
        <div className="demo-agent-actions">
          <button type="button" onClick={() => void validatePastedAgentCard()} disabled={isAgentCardValidating || isAgentCardImporting}>
            {isAgentCardValidating ? "Validating..." : "Validate"}
          </button>
          <button type="button" onClick={() => void importPastedAgentCard()} disabled={agentCardValidation?.valid !== true || isAgentCardImporting || isAgentCardValidating}>
            {isAgentCardImporting ? "Importing..." : "Import Agent Card"}
          </button>
          <button type="button" onClick={clearPastedAgentCard} disabled={isAgentCardImporting || isAgentCardValidating}>Clear</button>
          <button type="button" onClick={() => {
            setAgentCardJson(sampleAgentCardJson);
            setAgentCardValidation(null);
            setAgentCardImportError("");
            setAgentCardImportSuccess("");
          }} disabled={isAgentCardImporting || isAgentCardValidating}>Use sample</button>
        </div>
        {agentCardImportError ? <p className="demo-agent-error" role="alert">{agentCardImportError}</p> : null}
        {agentCardImportSuccess ? <p className="demo-agent-success" role="status">{agentCardImportSuccess}</p> : null}
        {agentCardValidation ? (
          <div className={`agent-card-validation ${agentCardValidation.valid ? "valid" : "invalid"} scroll-target`} ref={agentCardValidationRef} tabIndex={-1}>
            <strong>{agentCardValidation.valid ? "Valid Agent Card" : "Invalid Agent Card"}</strong>
            {validationSummary ? (
              <div className="agent-card-summary">
                <div>
                  <span>Agent ID</span>
                  <strong>{validationSummary.agentId}</strong>
                </div>
                <div>
                  <span>Name</span>
                  <strong>{validationSummary.name}</strong>
                </div>
                <div>
                  <span>Auth type</span>
                  <strong>{validationSummary.authType}</strong>
                </div>
                <div>
                  <span>Audience</span>
                  <strong>{validationSummary.audience}</strong>
                </div>
                <div>
                  <span>Endpoint type</span>
                  <strong>{endpointTypeLabel(validationSummary.endpointType, validationSummary.endpointScheme)}</strong>
                </div>
                <div>
                  <span>Capabilities</span>
                  <strong>{validationSummary.capabilities.join(", ") || "none"}</strong>
                </div>
                <div>
                  <span>Required scopes</span>
                  <strong>{validationSummary.requiredScopes.join(", ") || "none"}</strong>
                </div>
                <div>
                  <span>Risk levels</span>
                  <strong>{validationSummary.riskLevels.join(", ") || "none"}</strong>
                </div>
              </div>
            ) : null}
            {validationWarnings.length > 0 ? (
              <div>
                <span>Warnings</span>
                <ul className="demo-agent-warnings">
                  {validationWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            ) : null}
            {validationDetails.length > 0 ? (
              <div>
                <span>Details</span>
                <ul className="demo-agent-warnings validation-details">
                  {validationDetails.map((detail) => <li key={detail}>{detail}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  function renderDemoAgentBuilder() {
    return (
      <section className="demo-agent-builder" aria-label="Generate sample Agent Card">
        <div className="panel-header">
          <div>
            <p className="active-panel-eyebrow">Section C</p>
            <h2>Generate sample Agent Card</h2>
            <p className="muted-note">This creates a session-scoped sample Agent Card simulating a vendor-owned external agent.</p>
          </div>
        </div>
        <h2>Describe the external agent</h2>
        <div className="demo-agent-form">
          <label>
            <span>System / product</span>
            <input value={demoAgentInput.system} onChange={(event) => {
              clearDemoAgentStatus();
              setDemoAgentInput({ ...demoAgentInput, system: event.target.value });
            }} placeholder="Salesforce" />
            <small>The product or domain this external agent owns, for example Salesforce, Slack, Datadog, Okta.</small>
          </label>
          <label>
            <span>Agent name</span>
            <input value={demoAgentInput.agentName} onChange={(event) => {
              clearDemoAgentStatus();
              setDemoAgentInput({ ...demoAgentInput, agentName: event.target.value });
            }} placeholder="Salesforce Access Agent" />
            <small>Friendly name shown in the Agent Registry.</small>
          </label>
          <label className="wide-field">
            <span>What can this agent diagnose?</span>
            <input value={demoAgentInput.diagnosisGoal} onChange={(event) => {
              clearDemoAgentStatus();
              setDemoAgentInput({ ...demoAgentInput, diagnosisGoal: event.target.value });
            }} placeholder="Diagnose Salesforce access issues" />
            <small>The gateway uses this to generate safe routing metadata such as capability and requested action.</small>
          </label>
          <label>
            <span>Risk level</span>
            <select value={demoAgentInput.riskLevel} onChange={(event) => {
              clearDemoAgentStatus();
              setDemoAgentInput({ ...demoAgentInput, riskLevel: event.target.value as DemoAgentCardInput["riskLevel"] });
            }}>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="sensitive">sensitive</option>
            </select>
            <small>Read-only diagnosis should be low/medium. High/sensitive actions should require approval or be blocked.</small>
          </label>
          <label>
            <span>Resource types</span>
            <input value={demoAgentInput.resourceTypes} onChange={(event) => {
              clearDemoAgentStatus();
              setDemoAgentInput({ ...demoAgentInput, resourceTypes: event.target.value });
            }} />
            <small>Objects this agent understands, for example user, account, incident, repository, service.</small>
          </label>
          <label>
            <span>Description</span>
            <input value={demoAgentInput.description} onChange={(event) => {
              clearDemoAgentStatus();
              setDemoAgentInput({ ...demoAgentInput, description: event.target.value });
            }} placeholder="Sample agent that diagnoses Salesforce issues." />
          </label>
          <label>
            <span>Examples</span>
            <input value={demoAgentInput.examples} onChange={(event) => {
              clearDemoAgentStatus();
              setDemoAgentInput({ ...demoAgentInput, examples: event.target.value });
            }} placeholder="Salesforce login fails, cannot access account" />
          </label>
          <div className="wide-field demo-agent-checkboxes">
            <span>Can this agent ask another agent for help?</span>
            <small>The agent does not directly call another agent. It can request delegated help, and the orchestrator validates policy, prevents loops, and mediates the task.</small>
            <div>
              {supportingHelpOptions.map((option) => (
                <label key={option.value}>
                  <input
                    type="checkbox"
                    checked={demoAgentInput.supportingHelpOptions.includes(option.value)}
                    onChange={() => toggleSupportingHelpOption(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
              <label>
                <input
                  type="checkbox"
                  checked={demoAgentInput.supportingHelpOptions.length === 0}
                  onChange={() => {
                    clearDemoAgentStatus();
                    setDemoAgentInput({ ...demoAgentInput, supportingHelpOptions: [] });
                  }}
                />
                <span>None</span>
              </label>
            </div>
          </div>
          <details className="wide-field demo-agent-advanced">
            <summary>Advanced generated metadata</summary>
            <div className="demo-agent-form nested-demo-agent-form">
              <label>
                <span>Agent slug</span>
                <input value={demoAgentInput.agentSlug} onChange={(event) => {
                  clearDemoAgentStatus();
                  setDemoAgentInput({ ...demoAgentInput, agentSlug: event.target.value });
                }} placeholder="salesforce-access" />
                <small>Optional. Generates IDs like demo-salesforce-access-agent. Leave blank for a unique generated ID.</small>
              </label>
              <label>
                <span>Capability override</span>
                <input value={demoAgentInput.capability} onChange={(event) => {
                  clearDemoAgentStatus();
                  setDemoAgentInput({ ...demoAgentInput, capability: event.target.value });
                }} placeholder="salesforce.access.diagnose" />
                <small>Stable routing key generated by default from the diagnosis goal.</small>
              </label>
              <label>
                <span>Required scope override</span>
                <input value={demoAgentInput.requiredScope} onChange={(event) => {
                  clearDemoAgentStatus();
                  setDemoAgentInput({ ...demoAgentInput, requiredScope: event.target.value });
                }} placeholder="salesforce.diagnose" />
                <small>Permission encoded into the A2A JWT. Generated by default from the system.</small>
              </label>
            </div>
          </details>
        </div>
        <div className="demo-agent-actions">
          <button type="button" onClick={() => void generateDemoAgentPreview()}>Generate preview</button>
          <button type="button" onClick={() => void addDemoAgentToSession()}>Add sample Agent</button>
          <button type="button" onClick={() => {
            clearDemoAgentStatus();
            resetDemoAgentDraft();
          }}>New draft</button>
        </div>
        {(demoAgentError || demoAgentSuccessMessage) ? (
          <div className="demo-agent-feedback" role={demoAgentError ? "alert" : "status"}>
            {demoAgentError ? <p className="demo-agent-error">{demoAgentError}</p> : null}
            {demoAgentSuccessMessage ? <p className="demo-agent-success">{demoAgentSuccessMessage}</p> : null}
          </div>
        ) : null}
        {demoAgentPreview ? (
          <div className="demo-agent-auth-note">
            <strong>Generated A2A security metadata</strong>
            <small>These values are generated from your form. In production, the external vendor agent would publish them in its Agent Card.</small>
            <strong>agentId</strong>
            <span>{demoAgentPreview.agentId}</span>
            <strong>audience</strong>
            <span>{demoAgentPreview.auth.audience}</span>
            <strong>required scope</strong>
            <span>{demoAgentPreview.skills[0]?.requiredScopes?.[0] ?? "none"}</span>
            <strong>capability</strong>
            <span>{demoAgentPreview.skills[0]?.capabilities?.[0] ?? "none"}</span>
            <strong>auth mode</strong>
            <span>{demoAgentPreview.auth.type}</span>
          </div>
        ) : null}
        {demoAgentWarnings.length > 0 ? (
          <ul className="demo-agent-warnings">
            {demoAgentWarnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        ) : null}
        <div className="demo-agent-list" ref={demoAgentListRef}>
          <h2>Session sample agents</h2>
          {demoAgentCards.length ? demoAgentCards.map((card) => (
            <article className={recentlyAddedDemoAgentId === card.agentId ? "recently-added-demo-agent" : ""} key={card.agentId}>
              <strong>{card.agentId}</strong>
              <span>{card.skills[0]?.capabilities?.[0] ?? "no capability"}</span>
              <button type="button" onClick={() => {
                setDemoAgentPreview(card);
                setDemoAgentWarnings([]);
                setDemoAgentError("");
                setDemoAgentSuccessMessage("");
              }}>View JSON</button>
              <button type="button" onClick={() => void deleteSessionDemoAgent(card.agentId)}>Delete</button>
            </article>
          )) : <p className="muted-note">No session sample Agent Cards yet.</p>}
        </div>
        {demoAgentPreview ? (
          <details className="demo-agent-preview raw-agent-card-json scroll-target" ref={(element) => {
            generatedAgentCardRef.current = element;
          }}>
            <summary>Raw Agent Card JSON</summary>
            <p className="muted-note">This JSON is generated from the sample Agent Card form. In a real A2A federation, this JSON would be hosted by the external vendor/domain agent.</p>
            <JsonBlock value={demoAgentPreview} />
          </details>
        ) : null}
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
    return (
      <section className="control-panel agent-registry-panel scroll-target" aria-label="Agent Registry" ref={agentRegistryRootRef} tabIndex={-1}>
        <div className="panel-header">
          <div>
            <h2>Agent Registry</h2>
            <p className="muted-note">Import, validate, and govern external agent contracts before orchestration.</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => {
            void loadDemoAgentCards();
            void loadImportedAgentCards();
            void checkAgentHealth();
          }} disabled={isHealthLoading}>
            {isHealthLoading ? "Refreshing..." : "Refresh registry"}
          </button>
        </div>

        <section className="registry-action-grid" aria-label="Agent Registry primary actions">
          <article>
            <div>
              <p className="active-panel-eyebrow">Onboard vendor agent</p>
              <h2>Import Agent Card</h2>
              <p>Paste an Agent Card JSON and validate auth audience, scopes, capabilities, risk, and endpoint metadata.</p>
            </div>
            <button type="button" onClick={() => guideToTarget("agent-import")}>Start import</button>
          </article>
          <article>
            <div>
              <p className="active-panel-eyebrow">Sample registry data</p>
              <h2>Generate sample Agent Card</h2>
              <p>Create a session-scoped sample Agent Card to simulate an external vendor agent contract.</p>
            </div>
            <button type="button" onClick={() => guideToTarget("generated-agent-card")}>Generate sample</button>
          </article>
        </section>

        <section className="registry-section scroll-target" ref={registeredAgentsRef} tabIndex={-1}>
          <p className="active-panel-eyebrow">Section A</p>
          <h2>Registry Summary</h2>
          <div className="registry-summary-grid">
            <article>
              <span>Built-in agents</span>
              <strong>{builtInAgentsCount}</strong>
            </article>
            <article>
              <span>Session sample agents</span>
              <strong>{sessionDemoAgentsCount}</strong>
            </article>
            <article>
              <span>Healthy agents</span>
              <strong>{healthyAgentsCount}</strong>
            </article>
            <article>
              <span>Auth mode</span>
              <strong>{health?.orchestrator.authMode ?? "unknown"}</strong>
            </article>
          </div>
        </section>

        <section className="registry-section">
          <p className="active-panel-eyebrow">Section B</p>
          <h2>Registered Agents</h2>
          {healthError ? <p className="error">{healthError}</p> : null}
          {deleteAgentError ? <p className="error">{deleteAgentError}</p> : null}
          {deleteAgentMessage ? <p className="success-note">{deleteAgentMessage}</p> : null}
          {registeredAgentRows.length ? (
            <div className="registry-agent-list">
              {registeredAgentRows.map((agent) => (
                <article className="registry-agent-card" key={agent.agentId}>
                  <div className="registry-agent-card-header">
                    <div>
                      <span>Agent ID</span>
                      <strong>{agent.agentId}</strong>
                    </div>
                    <div className="registry-agent-badges">
                      <span className="source-badge">{agent.source}</span>
                      {agent.source === "session-imported" ? <small className="metadata-only-badge">metadata only</small> : null}
                      <strong className={`health-pill ${healthClass(agent.status)}`}>{agent.status}</strong>
                    </div>
                  </div>
                  <div className="registry-agent-metadata">
                    <div>
                      <span>Endpoint type</span>
                      <strong>{endpointTypeLabel(agent.endpointType, agent.endpointScheme)}</strong>
                    </div>
                    <div>
                      <span>Auth mode</span>
                      <strong>{agent.authMode}</strong>
                    </div>
                    <div>
                      <span>Agent Card</span>
                      <strong>{agent.agentCardAvailable ? "yes" : "no"}</strong>
                    </div>
                    <div>
                      <span>Latency</span>
                      <strong>{typeof agent.latencyMs === "number" ? `${agent.latencyMs} ms` : "unknown"}</strong>
                    </div>
                    <div className="registry-agent-actions">
                      <span>Actions</span>
                      {agent.canDelete ? (
                        <button
                          type="button"
                          className="agent-delete-button"
                          disabled={isHealthLoading || deletingAgentId === agent.agentId}
                          onClick={() => void deleteRegistryAgent(agent.agentId, agent.source)}
                        >
                          {deletingAgentId === agent.agentId ? "..." : "Delete"}
                        </button>
                      ) : (
                        <strong>None</strong>
                      )}
                    </div>
                  </div>
                  {agent.error ? <p className="registry-agent-error">{agent.error}</p> : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="muted-note">{isHealthLoading ? "Loading registered agents..." : "Import or generate an Agent Card to simulate external agent onboarding."}</p>
          )}
        </section>

        <div className="registry-section scroll-target" ref={(element) => {
          agentCardImportRef.current = element;
          importAgentCardRef.current = element;
        }}>
          {renderAgentCardImport()}
        </div>

        <div className="registry-section scroll-target" ref={sampleAgentBuilderRef}>
          {renderDemoAgentBuilder()}
        </div>
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
          {identityError ? <p className="demo-agent-error" role="alert">{identityError}</p> : null}
          {identityMessage ? <p className="demo-agent-success" role="status">{identityMessage}</p> : null}
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
            <span className="security-badge">Agent Card import fetches external URLs: {String(securityControls?.agentCardImportFetchesExternalUrls ?? false)}</span>
            <span className="security-badge">Imported agents executable: {String(securityControls?.importedAgentsExecutable ?? false)}</span>
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
