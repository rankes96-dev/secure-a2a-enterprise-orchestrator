import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  A2AAgentResponse,
  A2ATask,
  AgentEvidence,
  AgentHealthCheck,
  AgentName,
  AgentResponse,
  AgentTraceEntry,
  AgentsHealthResponse,
  Classification,
  ExecutionTraceStep,
  FollowUpInterpretation,
  ResolveRequest,
  ResolveResponse,
  RequestInterpretation,
  SecurityDecision,
  SelectedAgent
} from "@a2a/shared";
import { postJson, readJsonBody, sendJson, startJsonServer } from "@a2a/shared/src/http";
import { combineAgentCards, discoverAgentCards, getAgentCard, getExecutableAgentCards, validateExecutableAgentCards, type AgentCard, type AgentCardSkill } from "./agentCards";
import { routeWithAI } from "./aiRouter";
import { getAiConfig } from "./config/aiConfig";
import { evaluateDelegationPolicy, evaluateSecurityPolicy } from "./security/policyEngine";
import { getA2AAccessToken } from "./security/tokenClient";
import { applyFollowUpToIncidentContext, buildIncidentFollowUpQuestion, buildManualIncidentAnswer, extractIncidentContext, mergeIncidentContext, type IncidentContext } from "./incidentContext";
import { interpretFollowUp } from "./followUpInterpreter";
import { createSessionCookie, getSessionToken, hasValidSession } from "./security/sessionManager";
import { buildManualWorkflowAnswer } from "./requestInterpreter";
import { detectSensitiveAction } from "./sensitiveActionGuard";
import { addDemoAgentCard, buildDemoAgentCard, deleteDemoAgentCard, listDemoAgentCards, validateDemoAgentCard, type DemoAgentCardInput } from "./demoAgentCards";

dotenv.config({ path: new URL("../.env", import.meta.url) });

const port = Number(process.env.PORT ?? 4000);
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const rateLimitMaxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 30);
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const orchestratorAgentId = "servicenow-orchestrator-agent";
const MAX_DELEGATION_DEPTH = 1;
const a2aAuthMode = process.env.A2A_AUTH_MODE === "oauth2_client_credentials_jwt" ? "oauth2_client_credentials_jwt" : "mock_internal_token";

type ConversationState = {
  conversationId: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp: string;
  }>;
  needsMoreInfoCount: number;
  lastRequestInterpretation?: RequestInterpretation;
  lastFollowUpInterpretation?: FollowUpInterpretation;
  lastIncidentContext?: IncidentContext;
  lastSelectedAgents?: SelectedAgent[];
  lastResolutionStatus?: "resolved" | "needs_more_info" | "unsupported";
};

const conversations = new Map<string, ConversationState>();

function clientIp(request: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string {
  const forwardedFor = request.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return firstForwarded?.split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";
}

function allowByRateLimit(request: Parameters<typeof clientIp>[0], response: Parameters<typeof sendJson>[0]): boolean {
  const now = Date.now();
  const key = clientIp(request);
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
    return true;
  }

  if (bucket.count >= rateLimitMaxRequests) {
    sendJson(response, 429, { error: "Too many requests" });
    return false;
  }

  bucket.count += 1;
  return true;
}

function hasValidClientApiKey(request: IncomingMessage): boolean {
  const expected = process.env.ORCHESTRATOR_API_KEY;
  return Boolean(expected && request.headers["x-api-key"] === expected);
}

function requireClientAccess(request: IncomingMessage, response: ServerResponse): boolean {
  if (hasValidSession(request) || hasValidClientApiKey(request)) {
    return true;
  }

  sendJson(response, 401, { error: "Unauthorized" });
  return false;
}

function trace(action: string, detail: string): AgentTraceEntry {
  return {
    agent: "orchestrator",
    action,
    detail,
    timestamp: new Date().toISOString()
  };
}

function executionStep(actor: ExecutionTraceStep["actor"], action: string, detail: string): ExecutionTraceStep {
  return {
    actor,
    action,
    detail,
    timestamp: new Date().toISOString()
  };
}

function getOrCreateConversationState(conversationId?: string): ConversationState {
  if (conversationId) {
    const existing = conversations.get(conversationId);
    if (existing) {
      return existing;
    }
  }

  const state: ConversationState = {
    conversationId: createTaskId(),
    messages: [],
    needsMoreInfoCount: 0
  };
  conversations.set(state.conversationId, state);
  return state;
}

function appendConversationMessage(state: ConversationState, role: "user" | "assistant", content: string): void {
  state.messages.push({
    role,
    content,
    timestamp: new Date().toISOString()
  });
  state.messages = state.messages.slice(-10);
}

function updateConversationState(state: ConversationState, response: ResolveResponse, incidentContext?: IncidentContext): void {
  appendConversationMessage(state, "assistant", response.finalAnswer);
  state.lastRequestInterpretation = response.requestInterpretation;
  state.lastFollowUpInterpretation = response.followUpInterpretation;
  if (incidentContext) {
    state.lastIncidentContext = mergeIncidentContext(state.lastIncidentContext, incidentContext);
  }
  state.lastSelectedAgents = response.selectedAgents;
  state.lastResolutionStatus = response.resolutionStatus;

  if (response.resolutionStatus === "needs_more_info" || response.a2aResponses?.some((item) => item.status === "needs_more_info")) {
    state.needsMoreInfoCount += 1;
  }
}

function lastUserMessageBeforeLatest(state: ConversationState): string | undefined {
  return [...state.messages]
    .slice(0, -1)
    .reverse()
    .find((message) => message.role === "user")?.content;
}

function lastAssistantMessage(state: ConversationState): string | undefined {
  return [...state.messages]
    .slice(0, -1)
    .reverse()
    .find((message) => message.role === "assistant")?.content;
}

function buildEffectiveMessageForRouting(state: ConversationState, currentMessage: string, followUp: FollowUpInterpretation): string {
  if (!followUp.isFollowUp) {
    return currentMessage;
  }

  const previous = state.lastRequestInterpretation;

  return [
    "Previous enterprise support issue:",
    lastUserMessageBeforeLatest(state) ?? "unknown",
    "",
    "Previous interpretation:",
    `scope=${previous?.scope ?? "unknown"}`,
    `intent=${previous?.intentType ?? "unknown"}`,
    `targetSystem=${previous?.targetSystemText ?? "unknown"}`,
    `requestedAction=${previous?.requestedActionText ?? "unknown"}`,
    "",
    "User follow-up:",
    currentMessage,
    "",
    "Interpret the follow-up as additional context for the previous issue. Do not treat it as a new standalone request."
  ].join("\n");
}

function buildDiagnosis(agentResponses: A2AAgentResponse[]): ResolveResponse["diagnosis"] {
  const diagnosed =
    agentResponses.find((response) => response.status === "diagnosed" && response.probableCause && response.agentId !== "end-user-triage-agent") ??
    agentResponses.find((response) => response.status === "diagnosed" && response.probableCause);

  if (diagnosed?.probableCause) {
    return {
      probableCause: diagnosed.probableCause,
      recommendedFix: diagnosed.recommendedActions?.join("; ") ?? diagnosed.summary
    };
  }

  const needsMoreInfo = agentResponses.find((response) => response.status === "needs_more_info");

  if (needsMoreInfo) {
    return {
      probableCause: "More information is needed before an external agent can diagnose the issue",
      recommendedFix: needsMoreInfo.clarifyingQuestions?.join("; ") ?? needsMoreInfo.summary
    };
  }

  return {
    probableCause: "No external agent returned a diagnosis",
    recommendedFix: "Review the A2A conversation trace and retry with more issue detail."
  };
}

function sentence(value: string): string {
  return /[.!?]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`;
}

function isEnterpriseIncidentIntent(interpretation?: RequestInterpretation): boolean {
  return Boolean(
    interpretation?.scope === "enterprise_support" &&
      (interpretation.intentType === "incident_diagnosis" || interpretation.intentType === "integration_failure" || interpretation.intentType === "unknown")
  );
}

function hasOnlyGenericFallbackAgents(selectedAgents: SelectedAgent[]): boolean {
  return (
    selectedAgents.length === 0 ||
    selectedAgents.every((agent) => agent.agentId === "end-user-triage-agent" || agent.agentId === "api-health-agent")
  );
}

function shouldReturnManualIncidentGuidance(params: {
  state: ConversationState;
  interpretation?: RequestInterpretation;
  selectedAgents: SelectedAgent[];
  context: IncidentContext;
}): boolean {
  return (
    params.state.needsMoreInfoCount >= 1 &&
    isEnterpriseIncidentIntent(params.interpretation) &&
    params.interpretation?.intentType !== "security_sensitive_action" &&
    hasOnlyGenericFallbackAgents(params.selectedAgents) &&
    params.context.hasMinimumDetails &&
    Boolean(params.context.errorText || params.context.impact)
  );
}

function buildFinalAnswer(params: {
  classification: Classification;
  agentResponses: A2AAgentResponse[];
  securityDecisions?: SecurityDecision[];
  requestInterpretation?: RequestInterpretation;
  manualIncidentContext?: IncidentContext;
}): string {
  const approvalDecision = params.securityDecisions?.find((decision) => decision.decision === "NeedsApproval");

  if (approvalDecision) {
    return `Needs approval: ${approvalDecision.reason}`;
  }

  const needsMoreInfo = params.agentResponses.find((response) => response.status === "needs_more_info");

  if (needsMoreInfo) {
    if (params.manualIncidentContext) {
      return buildManualIncidentAnswer(params.manualIncidentContext);
    }

    const questions = needsMoreInfo.clarifyingQuestions?.join(" ");
    return questions ? `${needsMoreInfo.summary} ${questions}` : needsMoreInfo.summary;
  }

  const diagnosed = params.agentResponses.filter((response) => response.status === "diagnosed");
  const blockedDecision = params.securityDecisions?.find((decision) => decision.decision === "Blocked");

  if (blockedDecision && diagnosed.length === 0) {
    return `Blocked by policy: ${blockedDecision.reason}`;
  }

  if (diagnosed.length === 0) {
    if (params.manualIncidentContext) {
      return buildManualIncidentAnswer(params.manualIncidentContext);
    }

    return "I could not complete the A2A diagnosis. Please provide the failed action, exact error, and affected system or record.";
  }

  const primary = diagnosed.find((response) => response.agentId !== "end-user-triage-agent") ?? diagnosed[0];
  const actions = primary.recommendedActions?.length ? ` Recommended actions: ${primary.recommendedActions.join("; ")}.` : "";
  const supporting = diagnosed
    .filter((response) => response !== primary)
    .map((response) => `${response.agentId}: ${response.summary}`)
    .join(" ");

  if (params.classification.supportMode === "end_user_support") {
    return `${primary.summary}${actions}${supporting ? ` Supporting findings: ${supporting}` : ""}`;
  }

  return `${primary.summary}${primary.probableCause ? ` Probable cause: ${sentence(primary.probableCause)}` : ""}${actions}${supporting ? ` Supporting findings: ${supporting}` : ""}`;
}

function primarySecurityDecision(decisions: SecurityDecision[]): SecurityDecision | undefined {
  return (
    decisions.find((decision) => decision.decision === "Blocked") ??
    decisions.find((decision) => decision.decision === "NeedsApproval") ??
    decisions.find((decision) => decision.decision === "NeedsMoreContext") ??
    decisions[0]
  );
}

function getSkillMetadata(agentId: AgentName, skillId?: string, cards?: AgentCard[]): AgentCardSkill | undefined {
  return getAgentCard(agentId, cards)?.skills.find((skill) => skill.id === skillId);
}

function requestedActionForSkill(skill?: AgentCardSkill): string | undefined {
  return skill?.requestedAction;
}

function requiredPermissionForSkill(skill?: AgentCardSkill): string | undefined {
  return skill?.requiredPermission ?? skill?.requiredScopes?.[0];
}

function requestedScopesForSkill(skill?: AgentCardSkill): string[] {
  return skill?.requiredScopes ?? (skill?.requiredPermission ? [skill.requiredPermission] : []);
}

function createTaskId(): string {
  return randomUUID();
}

function createA2ATask(params: {
  conversationId: string;
  fromAgent?: string;
  toAgent: AgentName;
  skillId?: string;
  message: string;
  classification: Classification;
  securityDecision?: SecurityDecision;
  requestedScope?: string;
  mediatedBy?: string;
  delegationDepth?: number;
  parentTaskId?: string;
  requestedByAgent?: string;
  delegationContext?: Record<string, unknown>;
  authMode?: A2ATask["context"]["authMode"];
  cards?: AgentCard[];
}): A2ATask {
  const card = getAgentCard(params.toAgent, params.cards);

  return {
    taskId: createTaskId(),
    conversationId: params.conversationId,
    fromAgent: params.fromAgent ?? orchestratorAgentId,
    toAgent: params.toAgent,
    mediatedBy: params.mediatedBy,
    delegationDepth: params.delegationDepth,
    parentTaskId: params.parentTaskId,
    requestedByAgent: params.requestedByAgent,
    skillId: params.skillId,
    userMessage: params.message,
    classification: params.classification,
    context: {
      reporterType: params.classification.reporterType,
      supportMode: params.classification.supportMode,
      sourceSystem: "ServiceNow",
      affectedSystem: params.classification.system,
      securityDecision: params.securityDecision,
      callerAgentId: "servicenow-orchestrator-agent",
      targetAgentId: params.toAgent,
      targetAudience: card?.auth.audience,
      requestedScope: params.requestedScope,
      authMode: params.authMode ?? "mock_internal_token",
      auth: {
        authMode: params.authMode ?? "mock_internal_token",
        audience: card?.auth.audience,
        scope: params.requestedScope,
        tokenIssued: false
      },
      delegationContext: params.delegationContext
      // TODO: replace mock_internal_token with OAuth 2.0 Client Credentials, JWT access tokens,
      // audience/issuer/scope/JWKS validation, and optional mTLS or DPoP.
    }
  };
}

function shouldUseJwtForAgent(agentId: string, cards?: AgentCard[]): boolean {
  return a2aAuthMode === "oauth2_client_credentials_jwt" && Boolean(getAgentCard(agentId, cards));
}

async function prepareA2ARequestAuth(params: {
  task: A2ATask;
  targetAudience?: string;
  requestedScope?: string;
  delegatedBy?: string;
  delegationDepth?: number;
  parentTaskId?: string;
  requestedByAgent?: string;
  executionSteps: ExecutionTraceStep[];
  traceEntries: AgentTraceEntry[];
  cards?: AgentCard[];
}): Promise<Record<string, string>> {
  if (!shouldUseJwtForAgent(params.task.toAgent, params.cards)) {
    return {
      "x-internal-service-token": process.env.INTERNAL_SERVICE_TOKEN ?? ""
    };
  }

  if (!params.targetAudience || !params.requestedScope) {
    const missingAudience = !params.targetAudience;
    const action = missingAudience ? "missing_a2a_audience_metadata" : "missing_a2a_scope_metadata";
    const detail = missingAudience
      ? "Cannot issue A2A JWT because target agent is missing audience metadata."
      : "Cannot issue A2A JWT because selected skill is missing required scope metadata.";
    params.executionSteps.push({
      ...executionStep("orchestrator", action, detail),
      taskId: params.task.taskId,
      conversationId: params.task.conversationId,
      fromAgent: params.task.fromAgent,
      toAgent: params.task.toAgent,
      skillId: params.task.skillId
    });
    params.traceEntries.push(trace(action, detail));
    throw new Error(detail);
  }

  const isDelegatedToken = Boolean(params.delegatedBy) || (params.delegationDepth ?? 0) > 0;
  const requestAction = isDelegatedToken ? "request_delegated_a2a_access_token" : "request_a2a_access_token";
  const attachAction = isDelegatedToken ? "attach_delegated_a2a_bearer_token" : "attach_a2a_bearer_token";
  const requestDetail = isDelegatedToken
    ? `Requested delegated scoped JWT for audience ${params.targetAudience} and scope ${params.requestedScope} delegated by ${params.delegatedBy ?? "unknown"} at depth ${params.delegationDepth ?? 0}`
    : `Requested scoped JWT for audience ${params.targetAudience} and scope ${params.requestedScope}`;
  const attachDetail = isDelegatedToken
    ? "Attached delegated Bearer token metadata to A2A request; raw token not logged"
    : "Attached Bearer token metadata to A2A request; raw token not logged";

  params.executionSteps.push({
    ...executionStep("orchestrator", requestAction, requestDetail),
    taskId: params.task.taskId,
    conversationId: params.task.conversationId,
    fromAgent: params.task.fromAgent,
    toAgent: params.task.toAgent,
    skillId: params.task.skillId,
    delegationDepth: params.task.delegationDepth
  });
  params.traceEntries.push({
    ...trace(requestAction, requestDetail),
    fromAgent: params.task.fromAgent,
    toAgent: params.task.toAgent,
    mediatedBy: params.task.mediatedBy,
    skillId: params.task.skillId,
    delegationDepth: params.task.delegationDepth
  });

  const issued = await getA2AAccessToken({
    audience: params.targetAudience,
    scope: params.requestedScope,
    delegatedBy: params.delegatedBy,
    delegationDepth: params.delegationDepth,
    parentTaskId: params.parentTaskId,
    requestedByAgent: params.requestedByAgent
  });
  params.task.context.authMode = "oauth2_client_credentials_jwt";
  params.task.context.auth = {
    ...issued.metadata,
    authMode: "oauth2_client_credentials_jwt"
  };

  params.executionSteps.push({
    ...executionStep("orchestrator", attachAction, attachDetail),
    taskId: params.task.taskId,
    conversationId: params.task.conversationId,
    fromAgent: params.task.fromAgent,
    toAgent: params.task.toAgent,
    skillId: params.task.skillId,
    delegationDepth: params.task.delegationDepth
  });
  params.traceEntries.push({
    ...trace(attachAction, attachDetail),
    fromAgent: params.task.fromAgent,
    toAgent: params.task.toAgent,
    mediatedBy: params.task.mediatedBy,
    skillId: params.task.skillId,
    delegationDepth: params.task.delegationDepth
  });

  return {
    authorization: `Bearer ${issued.accessToken}`
  };
}

function normalizeAgentResponse(agentId: AgentName, response: AgentResponse | A2AAgentResponse): A2AAgentResponse {
  if ("agentId" in response && "status" in response) {
    return response;
  }

  return {
    agentId,
    status: response.evidence.length > 0 ? "diagnosed" : "unsupported",
    summary: response.evidence[0]?.title ?? "Agent returned legacy evidence.",
    evidence: response.evidence.map((item) => ({ title: item.title, data: item.data })),
    trace: response.trace
  };
}

function endpointForPath(endpoint: string, pathname: "/health" | "/agent-card"): string {
  const url = new URL(endpoint);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function mockIdentityProviderHealthUrl(): string {
  const url = new URL(process.env.A2A_IDP_URL ?? "http://localhost:4110");
  url.pathname = "/health";
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function checkAgentHealth(card: ReturnType<typeof getExecutableAgentCards>[number]): Promise<AgentHealthCheck> {
  const checkedAt = new Date().toISOString();
  const healthUrl = endpointForPath(card.endpoint, "/health");
  const startTime = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(healthUrl, { signal: controller.signal });
    const body = await response.text();
    const latencyMs = Math.max(0, Math.round(performance.now() - startTime));

    if (!response.ok) {
      return {
        agentId: card.agentId,
        url: healthUrl,
        status: "down",
        latencyMs,
        checkedAt,
        details: {
          healthEndpoint: "/health",
          agentCardAvailable: Boolean(getAgentCard(card.agentId))
        },
        error: `Health endpoint returned ${response.status}${body ? ` with body ${body}` : ""}`
      };
    }

    const parsed = body ? JSON.parse(body) as { status?: unknown } : {};
    const status = parsed.status === "ok" ? "ok" : "degraded";

    return {
      agentId: card.agentId,
      url: healthUrl,
      status,
      latencyMs,
      checkedAt,
      details: {
        healthEndpoint: "/health",
        agentCardAvailable: Boolean(getAgentCard(card.agentId))
      },
      error: status === "degraded" ? `Unexpected health payload: ${body}` : undefined
    };
  } catch (error) {
    return {
      agentId: card.agentId,
      url: healthUrl,
      status: "down",
      latencyMs: Math.max(0, Math.round(performance.now() - startTime)),
      checkedAt,
      details: {
        healthEndpoint: "/health",
        agentCardAvailable: Boolean(getAgentCard(card.agentId))
      },
      error: error instanceof Error ? error.message : "Unknown health check failure"
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkMockIdentityProviderHealth(): Promise<AgentHealthCheck> {
  const checkedAt = new Date().toISOString();
  const healthUrl = mockIdentityProviderHealthUrl();
  const startTime = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(healthUrl, { signal: controller.signal });
    const body = await response.text();
    const latencyMs = Math.max(0, Math.round(performance.now() - startTime));

    if (!response.ok) {
      return {
        agentId: "mock-identity-provider",
        url: healthUrl,
        status: "down",
        latencyMs,
        checkedAt,
        details: {
          healthEndpoint: "/health",
          agentCardAvailable: false
        },
        error: `Health endpoint returned ${response.status}${body ? ` with body ${body}` : ""}`
      };
    }

    const parsed = body ? JSON.parse(body) as { status?: unknown } : {};
    const status = parsed.status === "ok" ? "ok" : "degraded";

    return {
      agentId: "mock-identity-provider",
      url: healthUrl,
      status,
      latencyMs,
      checkedAt,
      details: {
        healthEndpoint: "/health",
        agentCardAvailable: false
      },
      error: status === "degraded" ? `Unexpected health payload: ${body}` : undefined
    };
  } catch (error) {
    return {
      agentId: "mock-identity-provider",
      url: healthUrl,
      status: "down",
      latencyMs: Math.max(0, Math.round(performance.now() - startTime)),
      checkedAt,
      details: {
        healthEndpoint: "/health",
        agentCardAvailable: false
      },
      error: error instanceof Error ? error.message : "Unknown health check failure"
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isDemoAgentCard(card: AgentCard | undefined): boolean {
  return Boolean(card?.endpoint.startsWith("session://demo-agent/"));
}

function createDemoAgentResponse(card: AgentCard, skill?: AgentCardSkill): A2AAgentResponse {
  return {
    agentId: card.agentId,
    status: "diagnosed",
    summary: "Demo agent selected from session Agent Card.",
    probableCause: "This demo agent advertised the requested capability through its Agent Card.",
    recommendedActions: [
      "Replace this demo response with a vendor-owned agent endpoint in production."
    ],
    evidence: [
      {
        title: "Session Agent Card capability match",
        data: {
          agentId: card.agentId,
          capability: skill?.capabilities?.[0],
          requiredScopes: skill?.requiredScopes ?? [],
          riskLevel: skill?.riskLevel ?? "low",
          supportingCapabilities: skill?.supportingCapabilities ?? []
        }
      }
    ],
    trace: [
      {
        agent: card.agentId,
        action: "demo_agent_card_selected",
        detail: "Returned safe mock response for a session-scoped demo Agent Card.",
        timestamp: new Date().toISOString()
      }
    ]
  };
}

function demoInputFromRequestBody(value: unknown): DemoAgentCardInput {
  const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const firstSkill = Array.isArray(record.skills) && typeof record.skills[0] === "object" && record.skills[0] !== null
    ? record.skills[0] as Record<string, unknown>
    : undefined;

  return {
    system: typeof record.system === "string"
      ? record.system
      : Array.isArray(record.systems) && typeof record.systems[0] === "string"
        ? record.systems[0]
        : "",
    agentSlug: typeof record.agentSlug === "string" ? record.agentSlug : undefined,
    agentId: typeof record.agentId === "string" ? record.agentId : undefined,
    agentName: typeof record.agentName === "string" ? record.agentName : typeof record.name === "string" ? record.name : undefined,
    description: typeof record.description === "string" ? record.description : undefined,
    capability: typeof record.capability === "string"
      ? record.capability
      : Array.isArray(firstSkill?.capabilities) && typeof firstSkill.capabilities[0] === "string"
        ? firstSkill.capabilities[0]
        : undefined,
    requiredScope: typeof record.requiredScope === "string"
      ? record.requiredScope
      : Array.isArray(firstSkill?.requiredScopes) && typeof firstSkill.requiredScopes[0] === "string"
        ? firstSkill.requiredScopes[0]
        : undefined,
    riskLevel: record.riskLevel === "low" || record.riskLevel === "medium" || record.riskLevel === "high" || record.riskLevel === "sensitive"
      ? record.riskLevel
      : firstSkill?.riskLevel === "low" || firstSkill?.riskLevel === "medium" || firstSkill?.riskLevel === "high" || firstSkill?.riskLevel === "sensitive"
        ? firstSkill.riskLevel
        : undefined,
    resourceTypes: Array.isArray(record.resourceTypes)
      ? record.resourceTypes.filter((item): item is string => typeof item === "string")
      : typeof record.resourceTypes === "string"
        ? record.resourceTypes.split(",")
        : firstSkill?.scope && typeof firstSkill.scope === "object" && Array.isArray((firstSkill.scope as { resourceTypes?: unknown }).resourceTypes)
          ? ((firstSkill.scope as { resourceTypes?: unknown[] }).resourceTypes ?? []).filter((item): item is string => typeof item === "string")
          : undefined,
    examples: Array.isArray(record.examples)
      ? record.examples.filter((item): item is string => typeof item === "string")
      : typeof record.examples === "string"
        ? record.examples.split(",")
        : Array.isArray(firstSkill?.examples)
          ? firstSkill.examples.filter((item): item is string => typeof item === "string")
          : undefined,
    supportingCapabilities: Array.isArray(record.supportingCapabilities)
      ? record.supportingCapabilities.filter((item): item is string => typeof item === "string")
      : typeof record.supportingCapabilities === "string"
        ? record.supportingCapabilities.split(",")
        : Array.isArray(firstSkill?.supportingCapabilities)
          ? firstSkill.supportingCapabilities.filter((item): item is string => typeof item === "string")
          : undefined
  };
}

function requireSessionToken(request: IncomingMessage, response: ServerResponse): string | undefined {
  const token = getSessionToken(request);
  if (!token) {
    sendJson(response, 401, { error: "Session required" }, request);
    return undefined;
  }
  return token;
}

async function checkSessionDemoAgentHealth(card: AgentCard): Promise<AgentHealthCheck> {
  return {
    agentId: card.agentId,
    url: card.endpoint,
    status: "ok",
    latencyMs: 0,
    checkedAt: new Date().toISOString(),
    details: {
      healthEndpoint: "/health",
      agentCardAvailable: true
    }
  };
}

async function buildAgentsHealthResponse(sessionToken?: string): Promise<AgentsHealthResponse> {
  const sessionDemoCards = sessionToken ? listDemoAgentCards(sessionToken) : [];
  const agents = await Promise.all([
    ...getExecutableAgentCards().map((card) => checkAgentHealth(card)),
    ...sessionDemoCards.map((card) => checkSessionDemoAgentHealth(card)),
    checkMockIdentityProviderHealth()
  ]);

  return {
    orchestrator: {
      agentId: orchestratorAgentId,
      status: "ok",
      timestamp: new Date().toISOString()
    },
    agents,
    summary: {
      total: agents.length,
      healthy: agents.filter((agent) => agent.status === "ok").length,
      degraded: agents.filter((agent) => agent.status === "degraded").length,
      down: agents.filter((agent) => agent.status === "down").length
    }
  };
}

async function resolveIssue(requestBody: ResolveRequest, sessionToken?: string): Promise<ResolveResponse> {
  const conversationState = getOrCreateConversationState(requestBody.conversationId);
  const requestAgentCards = combineAgentCards(getExecutableAgentCards(), sessionToken ? listDemoAgentCards(sessionToken) : []);
  appendConversationMessage(conversationState, "user", requestBody.message);
  const followUp = await interpretFollowUp({
    currentMessage: requestBody.message,
    previousUserMessage: lastUserMessageBeforeLatest(conversationState),
    previousAssistantMessage: lastAssistantMessage(conversationState),
    previousInterpretation: conversationState.lastRequestInterpretation,
    previousIncidentContext: conversationState.lastIncidentContext
  });
  const effectiveMessage = buildEffectiveMessageForRouting(conversationState, requestBody.message, followUp);
  const routingDecision = await routeWithAI(effectiveMessage, { agentCards: requestAgentCards });
  const classification = routingDecision.classification;
  const conversationId = conversationState.conversationId;
  const incidentInterpretation =
    followUp.isFollowUp && conversationState.lastRequestInterpretation
      ? {
          ...(routingDecision.requestInterpretation ?? conversationState.lastRequestInterpretation),
          targetSystemText:
            followUp.addsTargetSystemText ??
            (followUp.shouldPreservePreviousTargetSystem ? conversationState.lastRequestInterpretation.targetSystemText : routingDecision.requestInterpretation?.targetSystemText),
          targetResourceType: [
            followUp.shouldPreservePreviousAction ? conversationState.lastRequestInterpretation.targetResourceType : undefined,
            routingDecision.requestInterpretation?.targetResourceType
          ].filter(Boolean).join(" ") || undefined,
          targetResourceName:
            routingDecision.requestInterpretation?.targetResourceName ?? conversationState.lastRequestInterpretation.targetResourceName,
          requestedActionText: [
            followUp.shouldPreservePreviousAction ? conversationState.lastRequestInterpretation.requestedActionText : undefined,
            routingDecision.requestInterpretation?.requestedActionText
          ].filter(Boolean).join(" ") || undefined
        }
      : routingDecision.requestInterpretation;
  const incidentContext = extractIncidentContext(effectiveMessage, incidentInterpretation);
  const mergedIncidentContext = applyFollowUpToIncidentContext({
    previous: conversationState.lastIncidentContext,
    current: incidentContext,
    followUp
  });
  const sensitiveAction = detectSensitiveAction(
    `${effectiveMessage}\n${requestBody.message}\n${conversationState.lastRequestInterpretation?.requestedActionText ?? ""}\n${conversationState.lastIncidentContext?.errorText ?? ""}`,
    incidentInterpretation ?? routingDecision.requestInterpretation
  );
  const finalize = (response: ResolveResponse): ResolveResponse => {
    const finalResponse = {
      ...response,
      conversationId,
      followUpInterpretation: response.followUpInterpretation ?? followUp,
      incidentContext: response.incidentContext ?? mergedIncidentContext
    };
    updateConversationState(conversationState, finalResponse, mergedIncidentContext);
    return finalResponse;
  };

  if (sensitiveAction.isSensitive && sensitiveAction.requestedAction) {
    const policyDecision = evaluateSecurityPolicy({
      callerAgentId: orchestratorAgentId,
      targetAgentId: "security-oauth-agent",
      requestedAction: sensitiveAction.requestedAction
    }) as SecurityDecision;
    const diagnosis = {
      probableCause: "Sensitive security action blocked by policy",
      recommendedFix: "Use approved security review workflows; raw tokens, headers, and secrets are not exposed by this demo."
    };

    return finalize({
      finalAnswer: `Blocked by policy: ${policyDecision.reason}`,
      classification,
      selectedAgents: [],
      skippedAgents: routingDecision.skippedAgents,
      routingSource: routingDecision.routingSource,
      routingConfidence: routingDecision.routingConfidence,
      routingReasoningSummary: sensitiveAction.reason,
      resolutionStatus: "resolved",
      evidence: [],
      agentTrace: [
        trace("classify_issue", `Detected ${classification.system}, ${classification.errorCode ?? "no error code"}, ${classification.issueType}`),
        {
          ...trace("SENSITIVE_ACTION_DETECTED", sensitiveAction.reason),
          toAgent: "security-oauth-agent",
          skillId: sensitiveAction.requestedAction,
          decision: policyDecision.decision
        },
        {
          ...trace("SECURITY_BLOCKED", policyDecision.reason),
          toAgent: "security-oauth-agent",
          skillId: sensitiveAction.requestedAction,
          decision: policyDecision.decision
        }
      ],
      executionTrace: [
        executionStep("user", "submit_issue", requestBody.message),
        ...(routingDecision.requestInterpretation
          ? [
              executionStep(
                "orchestrator",
                "interpret_request",
                `${routingDecision.requestInterpretation.scope} / ${routingDecision.requestInterpretation.intentType}: ${routingDecision.requestInterpretation.reason}`
              )
            ]
          : []),
        executionStep("orchestrator", "detect_sensitive_action", sensitiveAction.reason),
        {
          ...executionStep("orchestrator", "security_policy_evaluated", `${policyDecision.decision}: ${policyDecision.reason}`),
          toAgent: "security-oauth-agent",
          skillId: sensitiveAction.requestedAction,
          decision: policyDecision.decision
        },
        executionStep("orchestrator", "skip_agent_execution", "Did not invoke any agent because the request asks to reveal protected token, header, or secret material.")
      ],
      securityDecision: policyDecision,
      securityDecisions: [policyDecision],
      requestInterpretation: incidentInterpretation ?? routingDecision.requestInterpretation,
      followUpInterpretation: followUp,
      incidentContext: mergedIncidentContext,
      a2aTasks: [],
      a2aResponses: [],
      diagnosis,
      conversationId
    });
  }

  if (
    shouldReturnManualIncidentGuidance({
      state: conversationState,
      interpretation: incidentInterpretation,
      selectedAgents: routingDecision.selectedAgents,
      context: mergedIncidentContext
    })
  ) {
    const finalAnswer = buildManualIncidentAnswer(mergedIncidentContext);
    const diagnosis = {
      probableCause: "Unsupported enterprise incident workflow",
      recommendedFix: "Open a ServiceNow incident manually with the suggested fields."
    };

    return finalize({
      conversationId,
      finalAnswer,
      classification,
      selectedAgents: [],
      skippedAgents: routingDecision.skippedAgents,
      routingSource: routingDecision.routingSource,
      routingConfidence: routingDecision.routingConfidence,
      routingReasoningSummary: "No specialist Agent Card capability is currently available for this enterprise incident.",
      resolutionStatus: "unsupported",
      evidence: [],
      agentTrace: [
        trace("classify_issue", `Detected ${classification.system}, ${classification.errorCode ?? "no error code"}, ${classification.issueType}`),
        ...(followUp.isFollowUp ? [trace("merge_follow_up_context", "Interpreted the short user reply as context for the previous enterprise support issue.")] : []),
        trace("manual_incident_recommended", "Enough incident context was provided, but no specialist Agent Card capability is available.")
      ],
      executionTrace: [
        executionStep("user", "submit_issue", requestBody.message),
        ...(followUp.isFollowUp ? [executionStep("orchestrator", "merge_follow_up_context", "Interpreted the short user reply as context for the previous enterprise support issue.")] : []),
        ...(routingDecision.requestInterpretation
          ? [
              executionStep(
                "orchestrator",
                "interpret_request",
                `${routingDecision.requestInterpretation.scope} / ${routingDecision.requestInterpretation.intentType}: ${routingDecision.requestInterpretation.reason}`
              )
            ]
          : []),
        executionStep("orchestrator", "return_manual_incident_guidance", "Returned manual ServiceNow incident guidance for an unsupported enterprise incident.")
      ],
      securityDecisions: [],
      requestInterpretation: incidentInterpretation ?? routingDecision.requestInterpretation,
      followUpInterpretation: followUp,
      incidentContext: mergedIncidentContext,
      a2aTasks: [],
      a2aResponses: [],
      diagnosis
    });
  }

  if (
    followUp.isFollowUp &&
    isEnterpriseIncidentIntent(incidentInterpretation) &&
    mergedIncidentContext.targetSystemText &&
    mergedIncidentContext.symptom &&
    mergedIncidentContext.environment &&
    !mergedIncidentContext.errorText &&
    !mergedIncidentContext.impact
  ) {
    const finalAnswer = buildIncidentFollowUpQuestion(mergedIncidentContext);
    const diagnosis = {
      probableCause: "More incident detail is needed before manual incident guidance can be completed",
      recommendedFix: "Collect the exact error and impact, then open a ServiceNow incident if no specialist Agent Card capability exists."
    };

    return finalize({
      conversationId,
      finalAnswer,
      classification,
      selectedAgents: [],
      skippedAgents: routingDecision.skippedAgents,
      routingSource: routingDecision.routingSource,
      routingConfidence: routingDecision.routingConfidence,
      routingReasoningSummary: "Interpreted short follow-up as context for the active enterprise incident.",
      resolutionStatus: "needs_more_info",
      evidence: [],
      agentTrace: [
        trace("classify_issue", `Detected ${classification.system}, ${classification.errorCode ?? "no error code"}, ${classification.issueType}`),
        trace("merge_follow_up_context", "Interpreted the short user reply as context for the previous enterprise support issue."),
        trace("ask_for_remaining_incident_context", "Captured environment but still needs exact error and impact details.")
      ],
      executionTrace: [
        executionStep("user", "submit_issue", requestBody.message),
        executionStep("orchestrator", "merge_follow_up_context", "Interpreted the short user reply as context for the previous enterprise support issue."),
        executionStep("orchestrator", "ask_for_remaining_incident_context", "Asked for exact error and impact details before manual incident handoff.")
      ],
      securityDecisions: [],
      requestInterpretation: incidentInterpretation ?? routingDecision.requestInterpretation,
      followUpInterpretation: followUp,
      incidentContext: mergedIncidentContext,
      a2aTasks: [],
      a2aResponses: [],
      diagnosis
    });
  }

  if (routingDecision.selectedAgents.length === 0) {
    const needsMoreInfo = routingDecision.resolutionStatus === "needs_more_info";
    const interpretation = incidentInterpretation ?? routingDecision.requestInterpretation;
    const unsupportedManualWorkflow = routingDecision.resolutionStatus === "unsupported" && interpretation?.scope === "manual_enterprise_workflow";
    const outOfScope = routingDecision.resolutionStatus === "unsupported" && interpretation?.scope === "out_of_scope";
    const diagnosis = unsupportedManualWorkflow
      ? {
          probableCause: "Unsupported manual access request workflow",
          recommendedFix: "Open a ServiceNow request manually for the requested enterprise workflow."
        }
      : outOfScope
        ? {
          probableCause: "Request is outside enterprise support scope",
          recommendedFix: "Ask for help with IT incidents, integration failures, access requests, security policy checks, or supported enterprise systems."
        }
      : needsMoreInfo
      ? {
          probableCause: "Not enough diagnostic detail to route the issue",
          recommendedFix:
            "Please provide the exact error message or code, the failed operation, the affected system or integration, and when the issue started."
        }
      : {
          probableCause: "Scenario not implemented yet",
          recommendedFix: "Provide more details so the orchestrator can match the request to an Agent Card capability."
    };
    const finalAnswer = unsupportedManualWorkflow
      ? buildManualWorkflowAnswer(interpretation)
      : outOfScope
        ? buildManualWorkflowAnswer(interpretation)
      : needsMoreInfo
      ? "I need more details before I can route this to the right specialist agent. Please provide the exact error message or code, the failed operation, the affected system or integration, and when the issue started."
      : `${diagnosis.probableCause}. ${diagnosis.recommendedFix}`;

    return finalize({
      conversationId,
      finalAnswer,
      classification,
      selectedAgents: routingDecision.selectedAgents,
      skippedAgents: routingDecision.skippedAgents,
      routingSource: routingDecision.routingSource,
      routingConfidence: routingDecision.routingConfidence,
      routingReasoningSummary: routingDecision.routingReasoningSummary,
      resolutionStatus: routingDecision.resolutionStatus,
      evidence: [],
      agentTrace: [
        trace("classify_issue", `Detected ${classification.system}, ${classification.errorCode ?? "no error code"}, ${classification.issueType}`),
        trace(
          outOfScope ? "out_of_scope" : unsupportedManualWorkflow ? "unsupported_manual_workflow" : needsMoreInfo ? "needs_more_info" : "skip_unimplemented_scenario",
          outOfScope
            ? "Request is outside enterprise support scope"
            : unsupportedManualWorkflow
            ? "No matching enterprise workflow agent capability is available"
            : needsMoreInfo
            ? "No specialist agents were executed because the issue lacks diagnostic details"
            : "No local specialist workflow is implemented for this scenario yet"
        )
      ],
      executionTrace: [
        executionStep("user", "submit_issue", requestBody.message),
        ...(interpretation
          ? [
              executionStep(
                "orchestrator",
                "interpret_request",
                `${interpretation.scope} / ${interpretation.intentType}: ${interpretation.reason}`
              )
            ]
          : []),
        executionStep(
          "orchestrator",
          "classify_issue",
          `Classified as ${classification.confidence} confidence / ${classification.issueType}`
        ),
        executionStep(
          "orchestrator",
          outOfScope || unsupportedManualWorkflow ? "skip_agent_execution" : needsMoreInfo ? "skip_agent_execution" : "return_not_implemented",
          outOfScope
            ? "Did not execute specialist agents because the request is outside enterprise support scope"
            : unsupportedManualWorkflow
            ? "Did not execute specialist agents because no matching Agent Card capability is available"
            : needsMoreInfo
            ? "Did not execute specialist agents because the issue lacks diagnostic details"
            : "Scenario not implemented yet"
        ),
        executionStep(
          "orchestrator",
          outOfScope ? "return_supported_scope_guidance" : unsupportedManualWorkflow ? "return_manual_request_guidance" : needsMoreInfo ? "ask_for_more_information" : "return_response",
          outOfScope
            ? "Returned supported enterprise scope guidance"
            : unsupportedManualWorkflow
            ? "Returned manual ServiceNow access request guidance"
            : needsMoreInfo
              ? "Asked the user for the error code, failed operation, and integration direction"
              : "Returned placeholder response"
        )
      ],
      a2aTasks: [],
      a2aResponses: [],
      securityDecisions: [],
      requestInterpretation: interpretation,
      diagnosis
    });
  }

  const orchestratorTrace = [
    trace("route_issue", `${routingDecision.routingSource} selected ${routingDecision.selectedAgents.map((agent) => agent.agentId).join(", ")}`),
    trace("classify_issue", `Detected ${classification.system}, ${classification.errorCode ?? "no error code"}, ${classification.issueType}`),
    ...routingDecision.selectedAgents.map((agent) => trace("select_agent", `Selected ${agent.agentId} as ${agent.role}: ${agent.reason}`))
  ];

  const a2aTasks: A2ATask[] = [];
  const a2aResponses: A2AAgentResponse[] = [];
  const executedDelegations = new Set<string>();
  const delegationExecutionSteps: ExecutionTraceStep[] = [];
  const securityDecisions: SecurityDecision[] = [];

  async function processRequestedDelegations(agentResponse: A2AAgentResponse, parentTask: A2ATask): Promise<void> {
    for (const delegation of agentResponse.requestedDelegations ?? []) {
      const fromAgent = agentResponse.agentId;
      const targetCard = getAgentCard(delegation.targetAgentId, requestAgentCards);
      const targetSkill = targetCard?.skills.find((skill) => skill.id === delegation.skillId);
      const currentDepth = parentTask.delegationDepth ?? 0;
      const nextDepth = currentDepth + 1;
      const delegationKey = `${parentTask.conversationId}:${fromAgent}:${delegation.targetAgentId}:${delegation.skillId}`;

      orchestratorTrace.push({
        ...trace("DELEGATION_REQUESTED", `${fromAgent} requested ${delegation.targetAgentId}/${delegation.skillId}: ${delegation.reason}`),
        fromAgent,
        toAgent: delegation.targetAgentId,
        mediatedBy: orchestratorAgentId,
        skillId: delegation.skillId,
        delegationDepth: nextDepth
      });
      delegationExecutionSteps.push({
        ...executionStep(fromAgent as ExecutionTraceStep["actor"], "request_delegation", delegation.reason),
        taskId: parentTask.taskId,
        conversationId: parentTask.conversationId,
        fromAgent,
        toAgent: delegation.targetAgentId,
        mediatedBy: orchestratorAgentId,
        skillId: delegation.skillId,
        delegationDepth: nextDepth
      });

      const validationFailure =
        !targetCard
          ? `Target agent ${delegation.targetAgentId} is not present in Agent Cards.`
          : !targetCard.endpoint
            ? `Target agent ${delegation.targetAgentId} has no executable endpoint.`
            : !targetSkill
              ? `Skill ${delegation.skillId} is not present on ${delegation.targetAgentId}.`
              : currentDepth >= MAX_DELEGATION_DEPTH
                ? `Delegation depth ${nextDepth} exceeds max depth ${MAX_DELEGATION_DEPTH}.`
                : executedDelegations.has(delegationKey)
                  ? `Delegation ${fromAgent} -> ${delegation.targetAgentId}/${delegation.skillId} already executed in this conversation.`
                  : undefined;

      if (validationFailure) {
        orchestratorTrace.push({
          ...trace("DELEGATION_BLOCKED", validationFailure),
          fromAgent,
          toAgent: delegation.targetAgentId,
          mediatedBy: orchestratorAgentId,
          skillId: delegation.skillId,
          decision: "Blocked",
          delegationDepth: nextDepth
        });
        delegationExecutionSteps.push({
          ...executionStep("orchestrator", "validate_delegation", validationFailure),
          taskId: parentTask.taskId,
          conversationId: parentTask.conversationId,
          fromAgent,
          toAgent: delegation.targetAgentId,
          mediatedBy: orchestratorAgentId,
          skillId: delegation.skillId,
          decision: "Blocked",
          delegationDepth: nextDepth
        });
        a2aResponses.push({
          agentId: delegation.targetAgentId,
          status: "blocked",
          summary: `Delegation from ${fromAgent} to ${delegation.targetAgentId} was blocked by orchestrator validation.`,
          probableCause: validationFailure,
          recommendedActions: ["Review the delegated Agent Card target, skill, depth, and duplicate request."],
          trace: [
            {
              agent: "orchestrator",
              action: "DELEGATION_BLOCKED",
              detail: validationFailure,
              timestamp: new Date().toISOString()
            }
          ]
        });
        continue;
      }

      delegationExecutionSteps.push({
        ...executionStep("orchestrator", "validate_delegation", `Validated ${fromAgent} -> ${delegation.targetAgentId}/${delegation.skillId}`),
        taskId: parentTask.taskId,
        conversationId: parentTask.conversationId,
        fromAgent,
        toAgent: delegation.targetAgentId,
        mediatedBy: orchestratorAgentId,
        skillId: delegation.skillId,
        decision: "Allowed",
        delegationDepth: nextDepth
      });

      // Delegation policy is skill-based. Security permission policy is action-based.
      const policyDecision = evaluateDelegationPolicy({
        callerAgentId: fromAgent,
        targetAgentId: delegation.targetAgentId,
        requestedAction: delegation.skillId
      }) as SecurityDecision;
      securityDecisions.push(policyDecision);

      orchestratorTrace.push({
        ...trace(
          policyDecision.decision === "Allowed" ? "SECURITY_POLICY_ALLOWED" : "SECURITY_BLOCKED",
          `${policyDecision.decision}: ${policyDecision.caller} -> ${policyDecision.target} requested ${policyDecision.requestedAction}`
        ),
        fromAgent,
        toAgent: delegation.targetAgentId,
        mediatedBy: orchestratorAgentId,
        skillId: delegation.skillId,
        decision: policyDecision.decision,
        delegationDepth: nextDepth
      });
      delegationExecutionSteps.push({
        ...executionStep(
          "orchestrator",
          "security_policy_evaluated",
          `${policyDecision.decision}: ${policyDecision.reason}`
        ),
        taskId: parentTask.taskId,
        conversationId: parentTask.conversationId,
        fromAgent,
        toAgent: delegation.targetAgentId,
        mediatedBy: orchestratorAgentId,
        skillId: delegation.skillId,
        decision: policyDecision.decision,
        delegationDepth: nextDepth
      });

      if (policyDecision.decision !== "Allowed") {
        orchestratorTrace.push({
          ...trace("DELEGATION_BLOCKED", policyDecision.reason),
          fromAgent,
          toAgent: delegation.targetAgentId,
          mediatedBy: orchestratorAgentId,
          skillId: delegation.skillId,
          decision: policyDecision.decision,
          delegationDepth: nextDepth
        });
        a2aResponses.push({
          agentId: delegation.targetAgentId,
          status: "blocked",
          summary: `Delegation from ${fromAgent} to ${delegation.targetAgentId} was blocked by policy.`,
          probableCause: policyDecision.reason,
          recommendedActions: ["Use an allowed delegation policy or request approval."],
          trace: [
            {
              agent: "orchestrator",
              action: "DELEGATION_BLOCKED",
              detail: policyDecision.reason,
              timestamp: new Date().toISOString()
            }
          ]
        });
        continue;
      }

      executedDelegations.add(delegationKey);
      const delegatedRequestedScope = targetSkill?.requiredPermission ?? targetSkill?.requiredScopes?.[0];
      const delegatedTask = createA2ATask({
        conversationId: parentTask.conversationId,
        fromAgent,
        toAgent: delegation.targetAgentId,
        skillId: delegation.skillId,
        message: parentTask.userMessage,
        classification,
        securityDecision: policyDecision,
        requestedScope: delegatedRequestedScope,
        mediatedBy: orchestratorAgentId,
        delegationDepth: nextDepth,
        parentTaskId: parentTask.taskId,
        requestedByAgent: fromAgent,
            delegationContext: delegation.context,
            cards: requestAgentCards
      });
      a2aTasks.push(delegatedTask);

      try {
        const headers = await prepareA2ARequestAuth({
          task: delegatedTask,
          targetAudience: targetCard!.auth.audience,
          requestedScope: delegatedRequestedScope,
          delegatedBy: fromAgent,
          delegationDepth: nextDepth,
          parentTaskId: parentTask.taskId,
          requestedByAgent: fromAgent,
          executionSteps: delegationExecutionSteps,
          traceEntries: orchestratorTrace,
          cards: requestAgentCards
        });
        const response = await postJson<AgentResponse | A2AAgentResponse>(targetCard!.endpoint, delegatedTask, headers);
        const normalizedResponse = normalizeAgentResponse(delegation.targetAgentId, response);
        a2aResponses.push(normalizedResponse);
        delegationExecutionSteps.push({
          ...executionStep("orchestrator", "execute_delegated_task", `Executed delegated task on ${delegation.targetAgentId}`),
          taskId: delegatedTask.taskId,
          conversationId: delegatedTask.conversationId,
          fromAgent: delegatedTask.fromAgent,
          toAgent: delegatedTask.toAgent,
          mediatedBy: delegatedTask.mediatedBy,
          skillId: delegatedTask.skillId,
          decision: policyDecision.decision,
          delegationDepth: delegatedTask.delegationDepth
        });
        await processRequestedDelegations(normalizedResponse, delegatedTask);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown delegated agent call failure";
        orchestratorTrace.push({
          ...trace("AGENT_CALL_FAILED", `${delegation.targetAgentId}: ${detail}`),
          fromAgent,
          toAgent: delegation.targetAgentId,
          mediatedBy: orchestratorAgentId,
          skillId: delegation.skillId,
          delegationDepth: nextDepth
        });
        a2aResponses.push({
          agentId: delegation.targetAgentId,
          status: "error",
          summary: `${delegation.targetAgentId} failed during delegated A2A task execution.`,
          probableCause: detail,
          recommendedActions: ["Retry the local mock service or inspect its logs."],
          trace: [
            {
              agent: "orchestrator",
              action: "AGENT_CALL_FAILED",
              detail,
              timestamp: new Date().toISOString()
            }
          ]
        });
      }
    }
  }

  for (const agent of routingDecision.selectedAgents) {
    const card = getAgentCard(agent.agentId, requestAgentCards);

    if (!card?.endpoint) {
      continue;
    }

    const skillMetadata = getSkillMetadata(agent.agentId, agent.skillId, requestAgentCards);
    const requestedAction = requestedActionForSkill(skillMetadata);
    let taskSecurityDecision: SecurityDecision | undefined;

    if (isDemoAgentCard(card)) {
      orchestratorTrace.push(trace("DEMO_AGENT_POLICY_SKIPPED", `Session demo agent ${agent.agentId} is executed as a local mock response only.`));
    } else if (requestedAction) {
      const policyDecision = evaluateSecurityPolicy({
        callerAgentId: orchestratorAgentId,
        targetAgentId: agent.agentId,
        requestedAction
      }) as SecurityDecision;

      securityDecisions.push(policyDecision);
      taskSecurityDecision = policyDecision;
      orchestratorTrace.push(
        trace(
          "SECURITY_POLICY_EVALUATED",
          `${policyDecision.decision}: ${policyDecision.caller} -> ${policyDecision.target} requires ${policyDecision.requiredPermission}`
        )
      );

      if (policyDecision.decision !== "Allowed") {
        const action = policyDecision.decision === "NeedsApproval" ? "SECURITY_NEEDS_APPROVAL" : "SECURITY_BLOCKED";
        orchestratorTrace.push(trace(action, policyDecision.reason));
        a2aResponses.push({
          agentId: agent.agentId,
          status: "blocked",
          summary:
            policyDecision.decision === "NeedsApproval"
              ? `Task requires approval before invoking ${agent.agentId}.`
              : `Task was blocked by policy before invoking ${agent.agentId}.`,
          probableCause: policyDecision.reason,
          recommendedActions:
            policyDecision.decision === "NeedsApproval"
              ? ["Request approval from the Jira project owner or access administrator."]
              : ["Use an allowed security action or request approval."],
          trace: [
            {
              agent: "orchestrator",
              action,
              detail: policyDecision.reason,
              timestamp: new Date().toISOString()
            }
          ]
        });
        continue;
      }
    } else {
      orchestratorTrace.push(trace("POLICY_METADATA_MISSING", "No requestedAction metadata found for selected skill; policy check skipped for read-only diagnostic mock."));
    }

    const requestedScopes = requestedScopesForSkill(skillMetadata);
    const requestedScope = requiredPermissionForSkill(skillMetadata) ?? requestedScopes[0];
    const a2aTask = createA2ATask({
      conversationId,
      toAgent: agent.agentId,
      skillId: agent.skillId,
      message: requestBody.message,
      classification,
      securityDecision: taskSecurityDecision,
      requestedScope,
      cards: requestAgentCards,
      authMode: isDemoAgentCard(card) ? a2aAuthMode : undefined
    });
    a2aTasks.push(a2aTask);

    if (isDemoAgentCard(card)) {
      a2aTask.context.auth = {
        ...a2aTask.context.auth,
        authMode: a2aAuthMode,
        audience: card.auth.audience,
        scope: requestedScope,
        tokenIssued: false,
        validationReason: "Session demo agent uses a safe mock runtime; JWT validation is documented but not enforced by a live HTTP service."
      };
      orchestratorTrace.push(trace("SESSION_DEMO_JWT_DOCUMENTED", `Session demo agent uses audience ${card.auth.audience} and scope ${requestedScope ?? "none"}; raw token not exposed.`));
      orchestratorTrace.push(trace("SESSION_DEMO_TOKEN_METADATA_RECEIVED", "Session demo agent mock runtime received token metadata; raw token not exposed."));
      a2aResponses.push(createDemoAgentResponse(card, skillMetadata));
      orchestratorTrace.push(trace("DEMO_AGENT_EXECUTED", `Returned safe mock response for ${agent.agentId}; no user-defined endpoint was fetched.`));
      continue;
    }

    const executableCard = card;
    try {
      const headers = await prepareA2ARequestAuth({
        task: a2aTask,
        targetAudience: executableCard.auth.audience,
        requestedScope,
        executionSteps: delegationExecutionSteps,
        traceEntries: orchestratorTrace,
        cards: requestAgentCards
      });
      const response = await postJson<AgentResponse | A2AAgentResponse>(executableCard.endpoint, a2aTask, headers);
      const normalizedResponse = normalizeAgentResponse(agent.agentId, response);
      a2aResponses.push(normalizedResponse);
      await processRequestedDelegations(normalizedResponse, a2aTask);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown agent call failure";
      orchestratorTrace.push(trace("AGENT_CALL_FAILED", `${agent.agentId}: ${detail}`));
      a2aResponses.push({
        agentId: agent.agentId,
        status: "error",
        summary: `${agent.agentId} failed during A2A task execution.`,
        probableCause: detail,
        recommendedActions: ["Retry the local mock service or inspect its logs."],
        trace: [
          {
            agent: "orchestrator",
            action: "AGENT_CALL_FAILED",
            detail,
            timestamp: new Date().toISOString()
          }
        ]
      });
    }
  }

  const evidence: AgentEvidence[] = a2aResponses.flatMap((response) =>
    (response.evidence ?? []).map((item) => ({
      agent: response.agentId as AgentName,
      title: item.title,
      data: item.data as Record<string, unknown>
    }))
  );
  const agentTrace = [...orchestratorTrace, ...a2aResponses.flatMap((response) => response.trace ?? [])] as AgentTraceEntry[];
  const diagnosis = buildDiagnosis(a2aResponses);
  const securityDecision = primarySecurityDecision(securityDecisions);
  const resolutionStatus = a2aResponses.some((response) => response.status === "needs_more_info")
    ? "needs_more_info"
    : routingDecision.resolutionStatus;
  const executionTrace = [
    executionStep("user", "submit_issue", requestBody.message),
    ...(routingDecision.requestInterpretation
      ? [
          executionStep(
            "orchestrator",
            "interpret_request",
            `${routingDecision.requestInterpretation.scope} / ${routingDecision.requestInterpretation.intentType}: ${routingDecision.requestInterpretation.reason}`
          )
        ]
      : []),
    executionStep("orchestrator", "route_issue", `${routingDecision.routingSource} routing decision: ${routingDecision.routingReasoningSummary}`),
    executionStep("orchestrator", "classify_issue", `Detected ${classification.system}, ${classification.errorCode ?? "no error code"}, ${classification.issueType}`),
    ...routingDecision.selectedAgents.map((agent) => ({
      ...executionStep("orchestrator", "select_agent", `Selected ${agent.agentId} as ${agent.role}: ${agent.reason}`),
      skillId: agent.skillId
    })),
    ...a2aTasks.filter((task) => !task.mediatedBy).map((task) => ({
      ...executionStep("orchestrator", "send_a2a_task", `Sent A2A task to ${task.toAgent}${task.skillId ? ` for ${task.skillId}` : ""}`),
      taskId: task.taskId,
      conversationId: task.conversationId,
      fromAgent: task.fromAgent,
      toAgent: task.toAgent,
      mediatedBy: task.mediatedBy,
      skillId: task.skillId,
      decision: task.context.securityDecision?.decision,
      delegationDepth: task.delegationDepth
    })),
    ...delegationExecutionSteps,
    ...a2aResponses.flatMap((response) =>
      (response.trace ?? []).map((entry) => executionStep("orchestrator", entry.action, `${entry.agent}: ${entry.detail}`))
    ),
    executionStep("orchestrator", "generate_final_diagnosis", diagnosis.probableCause)
  ];

  const manualIncidentContext =
    shouldReturnManualIncidentGuidance({
      state: conversationState,
      interpretation: incidentInterpretation ?? routingDecision.requestInterpretation,
      selectedAgents: routingDecision.selectedAgents,
      context: mergedIncidentContext
    })
      ? mergedIncidentContext
      : undefined;

  return finalize({
    conversationId,
    finalAnswer: buildFinalAnswer({
      classification,
      agentResponses: a2aResponses,
      securityDecisions,
      requestInterpretation: incidentInterpretation ?? routingDecision.requestInterpretation,
      manualIncidentContext
    }),
    classification,
    selectedAgents: routingDecision.selectedAgents,
    skippedAgents: routingDecision.skippedAgents,
    routingSource: routingDecision.routingSource,
    routingConfidence: routingDecision.routingConfidence,
    routingReasoningSummary: routingDecision.routingReasoningSummary,
    resolutionStatus,
    evidence,
    agentTrace,
    executionTrace,
    securityDecision,
    securityDecisions,
    requestInterpretation: incidentInterpretation ?? routingDecision.requestInterpretation,
    a2aTasks,
    a2aResponses,
    diagnosis
  });
}

async function start(): Promise<void> {
  await discoverAgentCards();
  for (const warning of validateExecutableAgentCards()) {
    console.warn(`[agent-cards] ${warning}`);
  }

  startJsonServer(port, async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      ok: true
    });
    return;
  }

  if (request.method === "GET" && request.url === "/agents/health") {
    if (!requireClientAccess(request, response)) {
      return;
    }

    sendJson(response, 200, await buildAgentsHealthResponse(getSessionToken(request)));
    return;
  }

  if (request.method === "GET" && request.url === "/debug/ai-config") {
    if (!requireClientAccess(request, response)) {
      return;
    }

    const aiConfig = getAiConfig();
    sendJson(response, 200, {
      provider: aiConfig.provider,
      model: aiConfig.model,
      hasApiKey: aiConfig.hasApiKey
    });
    return;
  }

  if (request.method === "POST" && request.url === "/session") {
    if (getSessionToken(request)) {
      sendJson(response, 200, { ok: true }, request);
      return;
    }

    sendJson(
      response,
      200,
      { ok: true },
      request,
      {
        "set-cookie": createSessionCookie()
      }
    );
    return;
  }

  if (request.method === "GET" && request.url === "/demo-agent-cards") {
    const sessionToken = requireSessionToken(request, response);
    if (!sessionToken) {
      return;
    }

    sendJson(response, 200, { agentCards: listDemoAgentCards(sessionToken) }, request);
    return;
  }

  if (request.method === "POST" && request.url === "/demo-agent-cards/generate") {
    const sessionToken = requireSessionToken(request, response);
    if (!sessionToken) {
      return;
    }

    const input = demoInputFromRequestBody(await readJsonBody<unknown>(request));
    if (!input.system.trim()) {
      sendJson(response, 400, { error: "system is required" }, request);
      return;
    }

    const agentCard = buildDemoAgentCard(input);
    sendJson(response, 200, { agentCard, warnings: validateDemoAgentCard(agentCard) }, request);
    return;
  }

  if (request.method === "POST" && request.url === "/demo-agent-cards") {
    const sessionToken = requireSessionToken(request, response);
    if (!sessionToken) {
      return;
    }

    const input = demoInputFromRequestBody(await readJsonBody<unknown>(request));
    if (!input.system.trim()) {
      sendJson(response, 400, { error: "system is required" }, request);
      return;
    }

    const agentCard = addDemoAgentCard(sessionToken, buildDemoAgentCard(input));
    sendJson(response, 200, {
      agentCard,
      agentCards: listDemoAgentCards(sessionToken),
      warnings: validateDemoAgentCard(agentCard)
    }, request);
    return;
  }

  if (request.method === "DELETE" && request.url?.startsWith("/demo-agent-cards/")) {
    const sessionToken = requireSessionToken(request, response);
    if (!sessionToken) {
      return;
    }

    const agentId = decodeURIComponent(request.url.slice("/demo-agent-cards/".length));
    sendJson(response, 200, {
      deleted: deleteDemoAgentCard(sessionToken, agentId),
      agentCards: listDemoAgentCards(sessionToken)
    }, request);
    return;
  }

  if (request.method !== "POST" || request.url !== "/resolve") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (!requireClientAccess(request, response)) {
    return;
  }

  if (!allowByRateLimit(request, response)) {
    return;
  }

  const requestBody = await readJsonBody<ResolveRequest>(request);

  if (!requestBody.message?.trim()) {
    sendJson(response, 400, { error: "message is required" });
    return;
  }

  sendJson(response, 200, await resolveIssue(requestBody, getSessionToken(request)));
  });
}

void start();
