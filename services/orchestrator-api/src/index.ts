import dotenv from "dotenv";
import { createHash, randomUUID } from "node:crypto";
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
  SelectedAgent,
  UserIdentitySummary
} from "@a2a/shared";
import { assertSecureA2AAuthMode, secureA2AAuthRequired } from "@a2a/shared";
import { postJson, readJsonBody, sendJson, startJsonServer } from "@a2a/shared/src/http";
import { discoverAgentCards, getAgentCard, getExecutableAgentCards, validateExecutableAgentCards, type AgentCard, type AgentCardSkill } from "./agentCards";
import { routeWithAI } from "./aiRouter";
import { getSafeAiConfigSummary } from "./config/aiConfig";
import { evaluateDelegationPolicy, evaluateSecurityPolicy } from "./security/policyEngine";
import { getA2AAccessToken } from "./security/tokenClient";
import {
  bearerTokenFromHeaders,
  expectedUserIdentityIssuer,
  publicUserIdentity,
  userIdentityJwksUri,
  validateUserIdentityJwt,
  type VerifiedUserIdentity
} from "./security/userIdentity";
import { applyFollowUpToIncidentContext, buildIncidentFollowUpQuestion, buildManualIncidentAnswer, extractIncidentContext, mergeIncidentContext, type IncidentContext } from "./incidentContext";
import { interpretFollowUp } from "./followUpInterpreter";
import { createSessionCookie, getSessionToken, hasValidSession } from "./security/sessionManager";
import { gatewayMetadata, gatewayPublicJwks } from "./security/gatewayIdentity";
import { buildManualWorkflowAnswer } from "./requestInterpreter";
import { detectSensitiveAction } from "./sensitiveActionGuard";
import { discoverAgentOnboarding, listSupportedConnectorTemplates, listTrustedOnboardedAgents, startAgentOnboarding } from "./agentOnboarding";
import { routeConnectorRequest, type ConnectorRoutingDecision } from "./connectorRouting";
import { executeApprovedConnectorSkill, type ConnectorRuntimeResult } from "./connectorRuntime";
import { AuditEvents } from "./audit/auditEvents";
import { evaluateConnectorPolicy } from "./policy/connectorPolicy";

dotenv.config({ path: new URL("../.env", import.meta.url) });

const port = Number(process.env.PORT ?? 4000);
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const orchestratorAgentId = "servicenow-orchestrator-agent";
const MAX_DELEGATION_DEPTH = 1;
const a2aAuthMode = assertSecureA2AAuthMode("orchestrator-api");
const secureAuthRequired = secureA2AAuthRequired();

type RateLimitConfig = {
  name: string;
  windowMs: number;
  maxRequests: number;
};

const resolveRateLimit: RateLimitConfig = {
  name: "resolve",
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  maxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 30)
};
const sessionRateLimit: RateLimitConfig = {
  name: "session",
  windowMs: Number(process.env.SESSION_RATE_LIMIT_WINDOW_MS ?? 60_000),
  maxRequests: Number(process.env.SESSION_RATE_LIMIT_MAX_REQUESTS ?? 20)
};
const agentOnboardingRateLimit: RateLimitConfig = {
  name: "agent-onboarding",
  windowMs: Number(process.env.AGENT_ONBOARDING_RATE_LIMIT_WINDOW_MS ?? 60_000),
  maxRequests: Number(process.env.AGENT_ONBOARDING_RATE_LIMIT_MAX_REQUESTS ?? 20)
};
const healthRateLimit: RateLimitConfig = {
  name: "health",
  windowMs: Number(process.env.HEALTH_RATE_LIMIT_WINDOW_MS ?? 60_000),
  maxRequests: Number(process.env.HEALTH_RATE_LIMIT_MAX_REQUESTS ?? 30)
};

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
const userIdentitiesBySession = new Map<string, VerifiedUserIdentity>();

function clientIp(request: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string {
  if (process.env.TRUST_PROXY_HEADERS !== "true") {
    return request.socket.remoteAddress || "unknown";
  }

  const forwardedFor = request.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return firstForwarded?.split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";
}

function allowByRateLimit(request: Parameters<typeof clientIp>[0], response: Parameters<typeof sendJson>[0], config: RateLimitConfig = resolveRateLimit): boolean {
  const now = Date.now();
  const key = `${config.name}:${clientIp(request)}`;
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + config.windowMs });
    return true;
  }

  if (bucket.count >= config.maxRequests) {
    sendJson(response, 429, { error: "Too many requests" });
    return false;
  }

  bucket.count += 1;
  return true;
}

function clientApiKey(request: IncomingMessage): string | undefined {
  const value = request.headers["x-api-key"];
  return Array.isArray(value) ? value[0] : value;
}

function hasValidClientApiKey(request: IncomingMessage): boolean {
  const expected = process.env.ORCHESTRATOR_API_KEY;
  return Boolean(expected && clientApiKey(request) === expected);
}

function requireClientAccess(request: IncomingMessage, response: ServerResponse): boolean {
  if (hasValidSession(request) || hasValidClientApiKey(request)) {
    return true;
  }

  sendJson(response, 401, { error: "Unauthorized" });
  return false;
}

function tokenAuthMethod(): "private_key_jwt" | "client_secret_post" | "unknown" {
  const configured = process.env.ORCHESTRATOR_TOKEN_AUTH_METHOD;
  if (configured === "private_key_jwt" || configured === "client_secret_post") {
    return configured;
  }

  if (process.env.ORCHESTRATOR_PRIVATE_JWK_JSON) {
    return "private_key_jwt";
  }

  return "client_secret_post";
}

function safeTokenAuthMethodLabel(): "private-key-jwt" | "client-secret-post" | "unknown" {
  const method = tokenAuthMethod();
  if (method === "private_key_jwt") {
    return "private-key-jwt";
  }

  if (method === "client_secret_post") {
    return "client-secret-post";
  }

  return "unknown";
}

function privateKeyJwtReplayProtectionStatus(): "configured" | "unknown" {
  return tokenAuthMethod() === "private_key_jwt" || process.env.ORCHESTRATOR_PRIVATE_KEY_JWT_ENABLED === "true"
    ? "configured"
    : "unknown";
}

function ipAllowlistStatus(): "configured" | "disabled" | "unknown" {
  if (process.env.MOCK_IDP_ENFORCE_IP_ALLOWLIST === "true") {
    return process.env.MOCK_IDP_ALLOWED_SOURCE_IPS?.trim() ? "configured" : "unknown";
  }

  if (process.env.MOCK_IDP_ENFORCE_IP_ALLOWLIST === "false" || process.env.MOCK_IDP_ENFORCE_IP_ALLOWLIST === undefined) {
    return "disabled";
  }

  return "unknown";
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

  const secureJwtBlocked = params.agentResponses.find((response) =>
    (response.status === "blocked" || response.status === "error") &&
    response.trace?.some((entry) => entry.action === "SESSION_DEMO_EXECUTION_BLOCKED")
  );

  if (secureJwtBlocked) {
    return "Secure A2A execution was blocked because scoped JWT issuance failed.";
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

function connectorRoutingStatusLabel(status: ConnectorRoutingDecision["status"]): string {
  const labels: Record<ConnectorRoutingDecision["status"], string> = {
    connector_skill_approved: "Connector skill approved",
    connector_skill_blocked: "Connector skill blocked",
    connector_skill_not_declared: "Connector skill not enabled",
    connector_skill_not_enabled: "Connector skill not enabled",
    connector_not_onboarded: "Connector template supported, but no agent installed",
    unsupported: "Unsupported request",
    needs_more_info: "Needs more information"
  };

  return labels[status];
}

function connectorRoutingFinalAnswer(decision: ConnectorRoutingDecision): string {
  const target = decision.targetSystem ? `${decision.targetSystem} ` : "";
  const skill = decision.skillLabel ?? decision.skillId ?? "requested skill/action";

  if (decision.status === "connector_skill_approved") {
    return `${connectorRoutingStatusLabel(decision.status)}: ${target}${skill} is approved by the onboarded connector profile. Runtime execution is available only for allowlisted external connector runtimes.`;
  }

  if (decision.status === "connector_skill_blocked") {
    return `${connectorRoutingStatusLabel(decision.status)}: ${target}${skill} is blocked. ${decision.reason} ${decision.recommendedNextStep}`;
  }

  if (decision.status === "connector_skill_not_declared" || decision.status === "connector_skill_not_enabled") {
    return `${connectorRoutingStatusLabel(decision.status)}: ${target}${skill} is known to the connector but is not enabled for this onboarded external agent. ${decision.reason} ${decision.recommendedNextStep}`;
  }

  if (decision.status === "connector_not_onboarded") {
    return `${connectorRoutingStatusLabel(decision.status)}: ${decision.reason} ${decision.recommendedNextStep}`;
  }

  if (decision.status === "unsupported") {
    return `Unsupported request: no connector template or profile exists for the requested system or action. ${decision.recommendedNextStep}`;
  }

  return `${connectorRoutingStatusLabel(decision.status)}: ${decision.reason} ${decision.recommendedNextStep}`;
}

function connectorRuntimeFinalAnswer(decision: ConnectorRoutingDecision, runtime: ConnectorRuntimeResult): string {
  if (runtime.executed && runtime.agentResponse) {
    const actions = runtime.agentResponse.recommendedActions?.length
      ? ` Recommended actions: ${runtime.agentResponse.recommendedActions.join("; ")}.`
      : "";
    return `${runtime.agentResponse.summary}${runtime.agentResponse.probableCause ? ` Probable cause: ${sentence(runtime.agentResponse.probableCause)}` : ""}${actions}`;
  }

  if (runtime.runtimeMode === "external_runtime_failed") {
    if (runtime.error === "connector_configuration_changed") {
      return `Connector configuration changed after onboarding. ${runtime.errorMessage ?? "Re-run Gateway onboarding to refresh trusted connector attestation."}`;
    }
    if (runtime.error === "skill_not_currently_approved") {
      return `Connector runtime refused execution because the skill is no longer approved by current connector configuration. ${runtime.errorMessage ?? decision.recommendedNextStep}`;
    }
    return `Connector runtime execution failed safely for ${decision.skillLabel ?? decision.skillId ?? "the approved skill"}. ${runtime.errorMessage ?? runtime.error ?? "External connector runtime failed."}`;
  }

  return connectorRoutingFinalAnswer(decision);
}

function connectorRoutingDiagnosis(decision: ConnectorRoutingDecision): ResolveResponse["diagnosis"] {
  if (decision.status === "connector_skill_approved") {
    return {
      probableCause: "Connector profile and action decision are available",
      recommendedFix: "Use the connector-backed diagnosis flow. Runtime execution is intentionally metadata-only until external runtime JWT validation is enabled."
    };
  }

  if (decision.status === "connector_skill_blocked") {
    return {
      probableCause: "The onboarded connector profile blocks the requested action",
      recommendedFix: decision.recommendedNextStep
    };
  }

  if (decision.status === "connector_skill_not_declared" || decision.status === "connector_skill_not_enabled") {
    return {
      probableCause: "The connector exists, but the requested skill is not enabled on the onboarded external agent",
      recommendedFix: decision.recommendedNextStep
    };
  }

  if (decision.status === "connector_not_onboarded") {
    return {
      probableCause: "Supported connector is not onboarded",
      recommendedFix: decision.recommendedNextStep
    };
  }

  if (decision.status === "unsupported") {
    return {
      probableCause: "No supported connector profile matches this request",
      recommendedFix: decision.recommendedNextStep
    };
  }

  return {
    probableCause: "More connector routing detail is needed",
    recommendedFix: decision.recommendedNextStep
  };
}

function connectorRuntimeDiagnosis(decision: ConnectorRoutingDecision, runtime: ConnectorRuntimeResult): ResolveResponse["diagnosis"] {
  if (runtime.executed && runtime.agentResponse) {
    return {
      probableCause: runtime.agentResponse.probableCause ?? runtime.agentResponse.summary,
      recommendedFix: runtime.agentResponse.recommendedActions?.join("; ") ?? "Review the external connector runtime response."
    };
  }

  if (runtime.runtimeMode === "external_runtime_failed") {
    if (runtime.error === "connector_configuration_changed") {
      return {
        probableCause: "External connector configuration changed after Gateway onboarding",
        recommendedFix: "Re-run Gateway onboarding to refresh the trusted connector attestation before runtime execution."
      };
    }
    if (runtime.error === "skill_not_currently_approved") {
      return {
        probableCause: "The external connector runtime refused execution because the skill is no longer approved by current configuration",
        recommendedFix: "Enable the skill and required access in the external admin console, then re-run Gateway onboarding."
      };
    }
    return {
      probableCause: "Approved connector runtime execution failed",
      recommendedFix: "Retry after confirming the local external agent, Mock IdP, and scoped A2A JWT configuration are running."
    };
  }

  return connectorRoutingDiagnosis(decision);
}

function connectorRoutingResolutionStatus(decision: ConnectorRoutingDecision): ResolveResponse["resolutionStatus"] {
  if (decision.status === "connector_skill_approved" || decision.status === "connector_skill_blocked" || decision.status === "connector_skill_not_declared" || decision.status === "connector_skill_not_enabled") {
    return "resolved";
  }

  if (decision.status === "needs_more_info") {
    return "needs_more_info";
  }

  return "unsupported";
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
  actor?: VerifiedUserIdentity;
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
      delegationContext: params.delegationContext,
      actor: params.actor
        ? {
            email: params.actor.email,
            name: params.actor.name,
            roles: [...params.actor.roles]
          }
        : undefined
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
  const requestAction = isDelegatedToken ? "request_delegated_a2a_scoped_token" : "request_a2a_scoped_token";
  const attachAction = isDelegatedToken ? "attach_delegated_a2a_scoped_token_metadata" : "attach_a2a_scoped_token_metadata";
  const requestDetail = isDelegatedToken
    ? `Requested delegated scoped JWT for audience ${params.targetAudience} and scope ${params.requestedScope} delegated by ${params.delegatedBy ?? "unknown"} at depth ${params.delegationDepth ?? 0}`
    : `Requested scoped JWT for audience ${params.targetAudience} and scope ${params.requestedScope}`;
  const attachDetail = isDelegatedToken
    ? "Attached delegated scoped token metadata to A2A request; raw token not logged"
    : "Attached scoped token metadata to A2A request; raw token not logged";

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
    requestedByAgent: params.requestedByAgent,
    actor: params.task.context.actor?.email,
    actorRoles: params.task.context.actor?.roles
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

function mockIdentityProviderDemoUserTokenUrl(): string {
  const url = new URL(process.env.A2A_IDP_URL ?? "http://localhost:4110");
  url.pathname = "/demo/user-token";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function safeTrustUrl(value: string): string {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const internalHost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".railway.internal") ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

    return internalHost ? `${url.pathname}${url.search}` : url.toString();
  } catch {
    return "unknown";
  }
}

function buildTrustStatus(sessionToken?: string) {
  const userIdentity = publicUserIdentity(currentUserIdentity(sessionToken));

  return {
    userIdentity: {
      ...userIdentity,
      rawTokenExposed: false
    },
    gatewayIdentity: {
      agentId: orchestratorAgentId,
      a2aAuthMode,
      secureAuthRequired,
      tokenAuthMethod: safeTokenAuthMethodLabel(),
      actorPropagationEnabled: true
    },
    mockIdp: {
      issuer: expectedUserIdentityIssuer(),
      jwksUri: safeTrustUrl(userIdentityJwksUri()),
      tokenEndpoint: "/oauth/token",
      userTokenEndpoint: "/demo/user-token",
      rawKeysExposed: false
    },
    securityControls: {
      rawTokensDisplayed: false,
      agentOnboardingFetchesExternalUrls: false,
      externalAgentsExecutable: false,
      agentCardSecretsRejected: true,
      userIdentityRequiredForResolve: true,
      privateKeyJwtReplayProtection: privateKeyJwtReplayProtectionStatus(),
      ipAllowlist: ipAllowlistStatus()
    }
  };
}

async function requestDemoUserToken(email: string): Promise<{ accessToken: string }> {
  const response = await fetch(mockIdentityProviderDemoUserTokenUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email })
  });
  const body = await response.json() as { accessToken?: unknown; error?: unknown };

  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "demo_user_token_failed");
  }

  if (typeof body.accessToken !== "string" || !body.accessToken) {
    throw new Error("demo_user_token_missing");
  }

  return { accessToken: body.accessToken };
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
        ...healthEndpointMetadata(healthUrl),
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
      ...healthEndpointMetadata(healthUrl),
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
      ...healthEndpointMetadata(healthUrl),
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
        ...healthEndpointMetadata(healthUrl),
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
      ...healthEndpointMetadata(healthUrl),
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
      ...healthEndpointMetadata(healthUrl),
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

function requireSessionToken(request: IncomingMessage, response: ServerResponse): string | undefined {
  const token = getSessionToken(request);
  if (!token) {
    sendJson(response, 401, { error: "Session required" }, request);
    return undefined;
  }
  return token;
}

function currentUserIdentity(sessionToken?: string): VerifiedUserIdentity | undefined {
  return sessionToken ? userIdentitiesBySession.get(sessionToken) : undefined;
}

function safeUserIdentity(sessionToken?: string): UserIdentitySummary {
  const identity = currentUserIdentity(sessionToken);
  return identity
    ? {
        authenticated: true,
        email: identity.email,
        name: identity.name,
        roles: [...identity.roles]
      }
    : { authenticated: false };
}

function agentCardRegistryKey(request: IncomingMessage, response: ServerResponse): string | undefined {
  const sessionToken = getSessionToken(request);
  if (sessionToken) {
    return sessionToken;
  }

  const apiKey = clientApiKey(request);
  if (apiKey && process.env.ORCHESTRATOR_API_KEY && apiKey === process.env.ORCHESTRATOR_API_KEY) {
    return `api:${createHash("sha256").update(apiKey).digest("hex")}`;
  }

  sendJson(response, 401, { error: "Unauthorized" }, request);
  return undefined;
}

function showInternalHealthUrls(): boolean {
  return process.env.SHOW_INTERNAL_HEALTH_URLS === "true";
}

function healthEndpointType(endpoint: string): AgentHealthCheck["endpointType"] {
  try {
    const parsed = new URL(endpoint);
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".railway.internal") ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    ) {
      return "internal";
    }

    return parsed.protocol === "http:" || parsed.protocol === "https:" ? "public" : "unknown";
  } catch {
    return "unknown";
  }
}

function healthEndpointMetadata(endpoint: string): Pick<AgentHealthCheck, "endpointType" | "url"> {
  return {
    endpointType: healthEndpointType(endpoint),
    ...(showInternalHealthUrls() ? { url: endpoint } : {})
  };
}

async function buildAgentsHealthResponse(): Promise<AgentsHealthResponse> {
  const agents = await Promise.all([
    ...getExecutableAgentCards().map((card) => checkAgentHealth(card)),
    checkMockIdentityProviderHealth()
  ]);

  return {
    orchestrator: {
      agentId: orchestratorAgentId,
      status: "ok",
      timestamp: new Date().toISOString(),
      authMode: a2aAuthMode,
      secureAuthRequired
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
  const verifiedUser = currentUserIdentity(sessionToken);
  const responseUserIdentity = safeUserIdentity(sessionToken);
  const requestAgentCards = getExecutableAgentCards();
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
  const connectorRouting = routeConnectorRequest(
    effectiveMessage,
    sessionToken ? listTrustedOnboardedAgents(sessionToken) : []
  );
  const finalize = (response: Omit<ResolveResponse, "userIdentity">): ResolveResponse => {
    const userIdentityTrace = verifiedUser
      ? [
          executionStep(
            "orchestrator",
            "user_identity_verified",
            `Verified user ${verifiedUser.email} via Mock IdP User JWT; actor context attached to gateway session.`
          )
        ]
      : [];
    const finalResponse = {
      ...response,
      conversationId,
      userIdentity: responseUserIdentity,
      executionTrace: [...userIdentityTrace, ...response.executionTrace],
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

  if (connectorRouting.status !== "needs_more_info") {
    const connectorStatus = connectorRoutingStatusLabel(connectorRouting.status);
    const connectorPolicy = evaluateConnectorPolicy({ connectorRouteStatus: connectorRouting.status });
    const connectorRuntime = connectorRouting.status === "connector_skill_approved"
      ? await executeApprovedConnectorSkill({
          message: effectiveMessage,
          conversationId,
          connectorRoute: connectorRouting,
          actor: verifiedUser
        })
      : undefined;
    const runtimeAgentResponse = connectorRuntime?.agentResponse;
    const diagnosis = connectorRuntime ? connectorRuntimeDiagnosis(connectorRouting, connectorRuntime) : connectorRoutingDiagnosis(connectorRouting);
    const connectorEvidence: AgentEvidence[] = [
      {
        agent: orchestratorAgentId,
        title: "Connector route decision",
        data: {
          status: connectorRouting.status,
          targetSystem: connectorRouting.targetSystem,
          connectorId: connectorRouting.connectorId,
          skillId: connectorRouting.skillId,
          skillLabel: connectorRouting.skillLabel,
          reason: connectorRouting.reason,
          recommendedNextStep: connectorRouting.recommendedNextStep,
          policy: connectorPolicy
        }
      }
    ];
    const runtimeEvidence: AgentEvidence[] = runtimeAgentResponse?.evidence?.map((item) => ({
      agent: runtimeAgentResponse.agentId as AgentName,
      title: item.title,
      data: item.data as Record<string, unknown>
    })) ?? [];
    const skippedAgents = requestAgentCards.map((card) => ({
      agentId: card.agentId,
      reason: "Connector-first routing handled this request; legacy internal demo agents were not invoked."
    }));
    const runtimeTrace = runtimeAgentResponse?.trace?.map((entry) => ({
      ...trace(entry.action, entry.detail),
      agent: entry.agent,
      toAgent: connectorRouting.connectorId,
      skillId: connectorRouting.skillId,
      timestamp: entry.timestamp
    })) ?? [];
    const runtimeExecutionTrace = connectorRuntime
      ? [
          executionStep(
            "orchestrator",
            connectorRuntime.tokenMetadata?.tokenIssued ? AuditEvents.CONNECTOR_RUNTIME_TOKEN_ISSUED : AuditEvents.CONNECTOR_RUNTIME_TOKEN_REQUESTED,
            connectorRuntime.tokenMetadata?.tokenIssued
              ? `Scoped A2A JWT issued for audience=${connectorRuntime.tokenMetadata.audience} scope=${connectorRuntime.tokenMetadata.scope}; raw token hidden.`
              : "Requested scoped A2A JWT for connector runtime; raw token hidden."
          ),
          executionStep(
            "orchestrator",
            AuditEvents.CONNECTOR_RUNTIME_CALL_STARTED,
            connectorRuntime.executed
              ? `Called allowlisted external connector runtime for ${connectorRouting.skillId}.`
              : `External connector runtime was not executed: ${connectorRuntime.error ?? "unknown failure"}.`
          ),
          executionStep(
            "orchestrator",
            connectorRuntime.executed
              ? AuditEvents.CONNECTOR_RUNTIME_CALL_SUCCEEDED
              : connectorRuntime.error === "connector_configuration_changed"
                ? AuditEvents.CONNECTOR_RUNTIME_CONFIG_STALE
                : AuditEvents.CONNECTOR_RUNTIME_CALL_FAILED,
            connectorRuntime.executed
              ? `${runtimeAgentResponse?.agentId ?? "external connector"} returned ${runtimeAgentResponse?.status ?? "unknown"}.`
              : "External connector runtime failed safely without falling back to a mock diagnosis."
          )
        ]
      : [];
    const a2aResponses = runtimeAgentResponse ? [runtimeAgentResponse] : [];

    return finalize({
      conversationId,
      finalAnswer: connectorRuntime ? connectorRuntimeFinalAnswer(connectorRouting, connectorRuntime) : connectorRoutingFinalAnswer(connectorRouting),
      classification,
      selectedAgents: [],
      skippedAgents,
      routingSource: "rules_fallback",
      routingConfidence: routingDecision.routingConfidence,
      routingReasoningSummary: connectorRouting.reason,
      resolutionStatus: connectorRoutingResolutionStatus(connectorRouting),
      evidence: [...connectorEvidence, ...runtimeEvidence],
      agentTrace: [
        trace("classify_issue", `Detected ${classification.system}, ${classification.errorCode ?? "no error code"}, ${classification.issueType}`),
        {
          ...trace("connector_intent_detected", connectorRouting.reason),
          toAgent: connectorRouting.connectorId,
          skillId: connectorRouting.skillId,
          decision: connectorRouting.status === "connector_skill_approved" ? "Allowed" : connectorRouting.status === "connector_skill_blocked" || connectorRouting.status === "connector_skill_not_declared" || connectorRouting.status === "connector_skill_not_enabled" ? "Blocked" : "NeedsMoreContext"
        },
        {
          ...trace("connector_route_decision", `${connectorStatus}: ${connectorRouting.recommendedNextStep}`),
          toAgent: connectorRouting.connectorId,
          skillId: connectorRouting.skillId,
          decision: connectorRouting.status === "connector_skill_approved" ? "Allowed" : connectorRouting.status === "connector_skill_blocked" || connectorRouting.status === "connector_skill_not_declared" || connectorRouting.status === "connector_skill_not_enabled" ? "Blocked" : "NeedsMoreContext"
        },
        ...runtimeTrace
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
        executionStep("orchestrator", "route_connector_intent", `${connectorRouting.targetSystem ?? "unknown"} / ${connectorRouting.connectorId ?? "no connector"} / ${connectorRouting.skillId ?? "no skill"}`),
        executionStep("orchestrator", "evaluate_onboarded_connector", `${connectorStatus}: ${connectorRouting.reason}`),
        ...runtimeExecutionTrace,
        executionStep(
          "orchestrator",
          connectorRuntime?.executed ? "return_connector_runtime_response" : connectorRouting.status === "connector_skill_approved" ? "return_connector_runtime_failure" : "return_connector_guidance",
          connectorRouting.recommendedNextStep
        )
      ],
      securityDecisions: [],
      requestInterpretation: incidentInterpretation ?? routingDecision.requestInterpretation,
      followUpInterpretation: followUp,
      incidentContext: mergedIncidentContext,
      connectorRouting,
      connectorPolicy,
      connectorRuntime,
      a2aTasks: [],
      a2aResponses,
      diagnosis
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
        actor: verifiedUser,
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

    if (requestedAction) {
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
      actor: verifiedUser
    });
    a2aTasks.push(a2aTask);

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

  if (request.method === "GET" && request.url === "/.well-known/a2a-gateway.json") {
    sendJson(response, 200, gatewayMetadata());
    return;
  }

  if (request.method === "GET" && request.url === "/.well-known/jwks.json") {
    sendJson(response, 200, await gatewayPublicJwks());
    return;
  }

  if (request.method === "GET" && request.url === "/agents/health") {
    if (!requireClientAccess(request, response)) {
      return;
    }

    if (!allowByRateLimit(request, response, healthRateLimit)) {
      return;
    }

    sendJson(response, 200, await buildAgentsHealthResponse());
    return;
  }

  if (request.method === "GET" && request.url === "/debug/ai-config") {
    if (!requireClientAccess(request, response)) {
      return;
    }

    sendJson(response, 200, getSafeAiConfigSummary());
    return;
  }

  if (request.method === "POST" && request.url === "/session") {
    if (!allowByRateLimit(request, response, sessionRateLimit)) {
      return;
    }

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

  if (request.method === "GET" && request.url === "/identity/session") {
    const sessionToken = requireSessionToken(request, response);
    if (!sessionToken) {
      return;
    }

    sendJson(response, 200, publicUserIdentity(currentUserIdentity(sessionToken)), request);
    return;
  }

  if (request.method === "GET" && request.url === "/identity/trust-status") {
    if (!requireClientAccess(request, response)) {
      return;
    }

    sendJson(response, 200, buildTrustStatus(getSessionToken(request)), request);
    return;
  }

  if (request.method === "POST" && request.url === "/identity/session") {
    const sessionToken = requireSessionToken(request, response);
    if (!sessionToken) {
      return;
    }

    const token = bearerTokenFromHeaders(request.headers);
    if (!token) {
      sendJson(response, 401, { error: "missing_user_identity_bearer_token" }, request);
      return;
    }

    try {
      const identity = await validateUserIdentityJwt(token);
      userIdentitiesBySession.set(sessionToken, identity);
      sendJson(response, 200, publicUserIdentity(identity), request);
    } catch (error) {
      sendJson(response, 401, {
        error: "invalid_user_identity_token",
        detail: error instanceof Error ? error.message : "User identity validation failed"
      }, request);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/identity/demo-login") {
    const sessionToken = requireSessionToken(request, response);
    if (!sessionToken) {
      return;
    }

    const body = await readJsonBody<{ email?: unknown }>(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) {
      sendJson(response, 400, { error: "invalid_demo_user_email" }, request);
      return;
    }

    try {
      const { accessToken } = await requestDemoUserToken(email);
      const identity = await validateUserIdentityJwt(accessToken);
      userIdentitiesBySession.set(sessionToken, identity);
      sendJson(response, 200, publicUserIdentity(identity), request);
    } catch (error) {
      sendJson(response, 400, {
        error: "demo_login_failed",
        detail: error instanceof Error ? error.message : "Demo login failed"
      }, request);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/identity/logout") {
    const sessionToken = requireSessionToken(request, response);
    if (!sessionToken) {
      return;
    }

    userIdentitiesBySession.delete(sessionToken);
    sendJson(response, 200, publicUserIdentity(undefined), request);
    return;
  }

  if (request.method === "GET" && request.url === "/agent-onboarding") {
    const registryKey = agentCardRegistryKey(request, response);
    if (!registryKey) {
      return;
    }

    if (!allowByRateLimit(request, response, agentOnboardingRateLimit)) {
      return;
    }

    sendJson(response, 200, { agents: listTrustedOnboardedAgents(registryKey) }, request);
    return;
  }

  if (request.method === "GET" && request.url === "/agent-onboarding/supported-connectors") {
    const registryKey = agentCardRegistryKey(request, response);
    if (!registryKey) {
      return;
    }

    const installedAgents = listTrustedOnboardedAgents(registryKey);
    const connectorTemplates = listSupportedConnectorTemplates().map((template) => {
      const installedCount = installedAgents.filter((agent) =>
        agent.connectorId === template.connectorId ||
          agent.connectorProfile?.connectorId === template.connectorId ||
          agent.resourceSystem === template.resourceSystem ||
          agent.connectorProfile?.resourceSystem === template.resourceSystem
      ).length;
      return {
        ...template,
        installed: installedCount > 0,
        installedCount
      };
    });

    sendJson(response, 200, {
      connectorTemplates,
      connectors: connectorTemplates.filter((connector) => connector.status === "available")
    }, request);
    return;
  }

  if (request.method === "POST" && request.url === "/agent-onboarding/discover") {
    if (!agentCardRegistryKey(request, response)) {
      return;
    }

    if (!allowByRateLimit(request, response, agentOnboardingRateLimit)) {
      return;
    }

    const result = await discoverAgentOnboarding(await readJsonBody<unknown>(request));
    if (!result.discovered) {
      sendJson(response, 400, result, request);
      return;
    }

    sendJson(response, 200, result, request);
    return;
  }

  if (request.method === "POST" && request.url === "/agent-onboarding/start") {
    const registryKey = agentCardRegistryKey(request, response);
    if (!registryKey) {
      return;
    }

    if (!allowByRateLimit(request, response, agentOnboardingRateLimit)) {
      return;
    }

    const result = await startAgentOnboarding(registryKey, await readJsonBody<unknown>(request));
    if ("error" in result) {
      sendJson(response, 400, result, request);
      return;
    }

    sendJson(response, 200, {
      ...result,
      trustedAgents: listTrustedOnboardedAgents(registryKey)
    }, request);
    return;
  }

  if (request.method !== "POST" || request.url !== "/resolve") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const sessionToken = requireSessionToken(request, response);
  if (!sessionToken) {
    return;
  }

  if (!currentUserIdentity(sessionToken)) {
    sendJson(response, 401, {
      error: "user_identity_required",
      message: "Login as a demo user before running secure A2A tasks."
    }, request);
    return;
  }

  if (!allowByRateLimit(request, response, resolveRateLimit)) {
    return;
  }

  const requestBody = await readJsonBody<ResolveRequest>(request);

  if (!requestBody.message?.trim()) {
    sendJson(response, 400, { error: "message is required" });
    return;
  }

  sendJson(response, 200, await resolveIssue(requestBody, sessionToken));
  });
}

void start();
