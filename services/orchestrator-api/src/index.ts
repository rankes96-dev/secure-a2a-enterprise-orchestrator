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
  AuditEventOutcome,
  AuditEventSeverity,
  AuditEventsResponse,
  Classification,
  ConnectorPlanningTargetResolution,
  ExecutionTraceStep,
  FollowUpInterpretation,
  PendingInteraction,
  PendingInteractionResolution,
  PlanningFollowUpResolution,
  OgenA2AOutboundTaskEnvelope,
  ResolveRequest,
  ResolveResponse,
  RuntimeAuthorizationRequest,
  RuntimeAuthorizationResponse,
  RequestInterpretation,
  SafeTargetSelection,
  SecurityDecision,
  SelectedAgent,
  UserIdentitySummary
} from "@a2a/shared";
import {
  A2A_CONTENT_TYPE,
  OGEN_ACTION_CATEGORIES,
  OGEN_APPROVAL_MODES,
  OGEN_FIELD_CLASSES,
  OGEN_RESOURCE_SENSITIVITIES,
  a2aJsonRequestHeaders,
  assertSecureA2AAuthMode,
  buildUnsupportedA2AProtocolVersionResponse,
  internalA2AResponseToOutboundA2AEnvelope,
  normalizeResolveRequestInput,
  outboundA2AEnvelopeToAgentResponse,
  secureA2AAuthRequired,
  unsupportedExplicitA2AProtocolVersion,
  validateOgenA2AOutboundTaskEnvelope
} from "@a2a/shared";
import { postJson, readJsonBody, sendJson, startJsonServer } from "@a2a/shared/http";
import { discoverAgentCards, getAgentCard, getExecutableAgentCards, validateExecutableAgentCards, type AgentCard, type AgentCardSkill } from "./agentCards.js";
import { routeWithAIWithProof } from "./aiRouter.js";
import { getSafeAiConfigSummary } from "./config/aiConfig.js";
import { startOgenFastifyServer } from "./http/startOgenFastifyServer.js";
import { evaluateDelegationPolicy, evaluateSecurityPolicy } from "./security/policyEngine.js";
import { getA2AAccessToken } from "./security/tokenClient.js";
import {
  bearerTokenFromHeaders,
  type VerifiedUserIdentity
} from "./security/userIdentity.js";
import { getIdentityProvider } from "./identity/identityConfig.js";
import { publicIdentitySession } from "./identity/userIdentityMapper.js";
import { verifyUserDirectoryAccess } from "./identity/userDirectoryAccess.js";
import { applyFollowUpToIncidentContext, buildIncidentFollowUpQuestion, buildManualIncidentAnswer, extractIncidentContext, mergeIncidentContext, type IncidentContext } from "./incidentContext.js";
import { interpretFollowUp } from "./followUpInterpreter.js";
import { cleanupExpiredSessions, createSessionCookieForToken, createSessionToken, getSessionToken, hasValidSession } from "./security/sessionManager.js";
import { createCsrfTokenForSession, csrfCookieHeader, shouldBypassCsrfForTrustedInternalRequest, verifyCsrfRequestForSession } from "./security/csrfProtection.js";
import { gatewayMetadata, gatewayPublicJwks } from "./security/gatewayIdentity.js";
import { buildManualWorkflowAnswer } from "./requestInterpreter.js";
import { detectSensitiveAction } from "./sensitiveActionGuard.js";
import { discoverAgentOnboarding, listSupportedConnectorTemplates, listTrustedOnboardedAgentsForOwner, startAgentOnboarding } from "./agentOnboarding.js";
import type { TrustedOnboardedAgent } from "./agentOnboarding.js";
import { listAuditViewerEventsPage, type AuditEventsPageQuery } from "./audit/auditViewerPagination.js";
import { routeConnectorRequest, type ConnectorRoutingDecision } from "./connectorRouting.js";
import { reconcileConnectorSupportedInterpretation } from "./connectorSupportedInterpretationReconciliation.js";
import { executeApprovedConnectorSkill, type ConnectorRuntimeResult } from "./connectorRuntime.js";
import { requestConnectorActionPlan } from "./connectorActionPlanner.js";
import { evaluateConnectorActionPlan } from "./connectorActionPlanEvaluation.js";
import { interpretGovernedAccessIntent, type GovernedAccessIntent } from "./governedAccessIntent.js";
import { AuditEvents } from "./audit/auditEvents.js";
import { appendPlatformAuditEvent } from "./audit/platformAuditStore.js";
import { evaluateGatewayAuthorization, isGatewayAuthorized } from "./authorization/gatewayAuthorization.js";
import type { GatewayAuthorizationDecision, GatewayCapability } from "./authorization/gatewayAuthorizationTypes.js";
import { getPlatformStateStore } from "./state/createPlatformStateStore.js";
import type { OgenInterpretationProof } from "./interpretation/interpretationTypes.js";
import type { OgenAiRoutingProof } from "./interpretation/routingProofTypes.js";
import { requireRequestedTenantAllowed, resolveTenantContext, type ResolvedTenantContext } from "./tenant/tenantResolution.js";
import { evaluateConnectorPolicy, type ConnectorPolicyEvaluation } from "./policy/connectorPolicy.js";
import { evaluateRuntimeAuthorization } from "./runtimeAuthorization/runtimeAuthorizationEvaluator.js";
import { detectAdversarialIntent } from "./adversarialIntent.js";
import { buildExecutionGateStack } from "./executionGateStack.js";
import { resolvePendingInteraction } from "./pendingInteractionResolver.js";
import type { ConversationState } from "./conversation/conversationTypes.js";
import { persistConversationStateSnapshot, safeConversationSummary } from "./conversation/conversationStateStore.js";
import { applyConversationOwner, conversationBelongsToOwner, conversationOwnerContext, type ConversationOwnerContext } from "./conversation/conversationOwnership.js";

dotenv.config({ path: new URL("../.env", import.meta.url) });

const port = Number(process.env.PORT ?? 4000);
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const orchestratorAgentId = "servicenow-orchestrator-agent";
const MAX_DELEGATION_DEPTH = 1;
const a2aAuthMode = assertSecureA2AAuthMode("orchestrator-api");
const secureAuthRequired = secureA2AAuthRequired();
const userIdentityProvider = getIdentityProvider();
const demoUserTokenTimeoutMs = 5_000;
const endUserDemoConnectorRequests = [
  {
    agentBaseUrl: "http://localhost:4201",
    expectedAgentId: "external-jira-agent",
    expectedResourceSystem: "jira",
    expectedConnectorId: "jira-reference"
  },
  {
    agentBaseUrl: "http://localhost:4202",
    expectedAgentId: "external-servicenow-agent",
    expectedResourceSystem: "servicenow",
    expectedConnectorId: "servicenow-reference"
  },
  {
    agentBaseUrl: "http://localhost:4203",
    expectedAgentId: "external-github-agent",
    expectedResourceSystem: "github",
    expectedConnectorId: "github-reference"
  }
] as const;

type RateLimitConfig = {
  name: string;
  windowMs: number;
  maxRequests: number;
  preferSessionToken?: boolean;
  error?: string;
};

type FreshIdentitySession = {
  sessionToken: string;
  identity: VerifiedUserIdentity;
  tenantContext: ResolvedTenantContext;
  gatewayRoles: string[];
};

const resolveRateLimit: RateLimitConfig = {
  name: "resolve",
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  maxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 30)
};
const runtimeAuthorizeRateLimit: RateLimitConfig = {
  name: "runtime-authorize",
  windowMs: Number(process.env.RUNTIME_AUTHORIZE_RATE_LIMIT_WINDOW_MS ?? process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  maxRequests: Number(process.env.RUNTIME_AUTHORIZE_RATE_LIMIT_MAX_REQUESTS ?? process.env.RATE_LIMIT_MAX_REQUESTS ?? 30),
  preferSessionToken: true
};
const sessionRateLimit: RateLimitConfig = {
  name: "session",
  windowMs: Number(process.env.SESSION_RATE_LIMIT_WINDOW_MS ?? 60_000),
  maxRequests: Number(process.env.SESSION_RATE_LIMIT_MAX_REQUESTS ?? 20)
};
const demoLoginRateLimit: RateLimitConfig = {
  name: "demo-login",
  windowMs: Number(process.env.DEMO_LOGIN_RATE_LIMIT_WINDOW_MS ?? process.env.SESSION_RATE_LIMIT_WINDOW_MS ?? 60_000),
  maxRequests: Number(process.env.DEMO_LOGIN_RATE_LIMIT_MAX_REQUESTS ?? 10),
  preferSessionToken: true,
  error: "rate_limit_exceeded"
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
  const sessionKey = config.preferSessionToken ? getSessionToken(request as IncomingMessage) : undefined;
  const key = `${config.name}:${sessionKey ? `session:${sessionKey}` : `ip:${clientIp(request)}`}`;
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + config.windowMs });
    return true;
  }

  if (bucket.count >= config.maxRequests) {
    sendJson(response, 429, { error: config.error ?? "Too many requests" });
    return false;
  }

  bucket.count += 1;
  return true;
}

function requireCsrfForBrowserMutation(request: IncomingMessage, response: ServerResponse): boolean {
  if (shouldBypassCsrfForTrustedInternalRequest(request)) {
    return true;
  }

  const sessionToken = getSessionToken(request);
  if (sessionToken && verifyCsrfRequestForSession(request, sessionToken)) {
    return true;
  }

  sendJson(response, 403, {
    error: "csrf_required",
    message: "Missing or invalid CSRF token"
  }, request);
  return false;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringHint(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
}

function safeOptionalString(value: unknown): string | undefined {
  return stringHint(value);
}

function requestedTenantIdFromBody(value: unknown): string | undefined {
  return safeOptionalString(objectRecord(value)?.tenantId);
}

function safeConversationIdFromBody(value: unknown): string | undefined {
  return safeOptionalString(objectRecord(value)?.conversationId);
}

function safeRequestIdFromBody(value: unknown): string | undefined {
  return safeOptionalString(objectRecord(value)?.requestId);
}

const auditEventOutcomeValues = new Set<AuditEventOutcome>(["success", "failure", "blocked", "needs_action"]);
const auditEventSeverityValues = new Set<AuditEventSeverity>(["info", "low", "medium", "high", "critical"]);

function safeAuditQueryString(value: string | null, maxLength = 160): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.length > maxLength) {
    return undefined;
  }
  return /^[A-Za-z0-9._:@/-]+$/.test(trimmed) ? trimmed : undefined;
}

function positiveIntegerQuery(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function auditTimestampQuery(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function safeAuditCursorString(value: string | null): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.length > 2048) {
    return undefined;
  }
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : undefined;
}

function parseAuditEventsQuery(searchParams: URLSearchParams): { ok: true; query: AuditEventsPageQuery } | { ok: false; message: string } {
  const limit = positiveIntegerQuery(searchParams.get("limit"), 25, 100);
  const cursor = searchParams.has("cursor") ? safeAuditCursorString(searchParams.get("cursor")) : undefined;
  const tenantIdHint = searchParams.has("tenantId") ? safeAuditQueryString(searchParams.get("tenantId")) : undefined;
  const eventType = searchParams.has("eventType") ? safeAuditQueryString(searchParams.get("eventType")) : undefined;
  const conversationId = searchParams.has("conversationId") ? safeAuditQueryString(searchParams.get("conversationId")) : undefined;
  const outcomeRaw = searchParams.get("outcome")?.trim();
  const severityRaw = searchParams.get("severity")?.trim();
  const outcomeValue = outcomeRaw || undefined;
  const severityValue = severityRaw || undefined;
  const from = auditTimestampQuery(searchParams.get("from"));
  const to = auditTimestampQuery(searchParams.get("to"));

  if (searchParams.has("page")) {
    return { ok: false, message: "Use cursor pagination with cursor and limit; page is not supported." };
  }
  if (searchParams.has("cursor") && !cursor) {
    return { ok: false, message: "Invalid cursor." };
  }
  if (searchParams.has("tenantId") && !tenantIdHint) {
    return { ok: false, message: "Invalid tenantId filter." };
  }
  if (searchParams.has("eventType") && !eventType) {
    return { ok: false, message: "Invalid eventType filter." };
  }
  if (searchParams.has("conversationId") && !conversationId) {
    return { ok: false, message: "Invalid conversationId filter." };
  }
  if (searchParams.has("outcome") && !outcomeValue) {
    return { ok: false, message: "Invalid outcome filter." };
  }
  if (searchParams.has("severity") && !severityValue) {
    return { ok: false, message: "Invalid severity filter." };
  }
  if (outcomeValue && !auditEventOutcomeValues.has(outcomeValue as AuditEventOutcome)) {
    return { ok: false, message: "Invalid outcome filter." };
  }
  if (severityValue && !auditEventSeverityValues.has(severityValue as AuditEventSeverity)) {
    return { ok: false, message: "Invalid severity filter." };
  }
  if (searchParams.has("from") && !from) {
    return { ok: false, message: "Invalid from timestamp." };
  }
  if (searchParams.has("to") && !to) {
    return { ok: false, message: "Invalid to timestamp." };
  }
  if (from && to && Date.parse(from) > Date.parse(to)) {
    return { ok: false, message: "from must be before to." };
  }

  return {
    ok: true,
    query: {
      cursor,
      limit,
      tenantIdHint,
      eventType,
      outcome: outcomeValue as AuditEventOutcome | undefined,
      severity: severityValue as AuditEventSeverity | undefined,
      from,
      to,
      conversationId
    }
  };
}

function requestMayHaveJsonBody(request: IncomingMessage): boolean {
  const contentLength = Array.isArray(request.headers["content-length"]) ? request.headers["content-length"][0] : request.headers["content-length"];
  return Boolean(request.headers["transfer-encoding"] || (contentLength && Number(contentLength) > 0));
}

async function readOptionalJsonBody<T>(request: IncomingMessage): Promise<T | undefined> {
  if (!requestMayHaveJsonBody(request)) {
    return undefined;
  }

  return readJsonBody<T>(request);
}

function tenantContextForRequest(identity?: VerifiedUserIdentity, requestedTenantId?: unknown): ResolvedTenantContext {
  return resolveTenantContext({ identity, requestedTenantId });
}

function sendTenantAccessDenied(response: ServerResponse, request: IncomingMessage, tenantContext: ResolvedTenantContext): void {
  sendJson(response, 403, {
    error: "tenant_access_denied",
    message: "Requested tenant is not available for this identity.",
    tenantResolution: {
      source: tenantContext.source,
      requestedTenantId: tenantContext.requestedTenantId,
      requestedTenantAccepted: tenantContext.requestedTenantAccepted
    }
  }, request);
}

const runtimeToolSourceTypes = new Set([
  "mcp_tool_manifest",
  "a2a_agent_card_skill",
  "connector_profile_action",
  "sdk_action_catalog",
  "manually_imported_catalog"
]);

const runtimeToolMappingStatuses = new Set([
  "mapped",
  "incomplete_metadata",
  "unsupported_tool_shape",
  "blocked_unknown_tool"
]);
const runtimeActionCategories: ReadonlySet<string> = new Set(OGEN_ACTION_CATEGORIES);
const runtimeApprovalModes: ReadonlySet<string> = new Set(OGEN_APPROVAL_MODES);
const runtimeResourceSensitivities: ReadonlySet<string> = new Set(OGEN_RESOURCE_SENSITIVITIES);
const runtimeFieldClasses: ReadonlySet<string> = new Set(OGEN_FIELD_CLASSES);
const runtimeActionConstraintKeys: ReadonlySet<string> = new Set([
  "bulkAllowed",
  "maxRecordsPerRequest",
  "maxActionsPerHour",
  "requiresConnectedAccount",
  "auditRequired"
]);

function explicitRuntimeStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function explicitRuntimeFieldClassArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && runtimeFieldClasses.has(item));
}

function runtimePositiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function explicitRuntimeActionConstraints(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value as Record<string, unknown>).every(([key, entry]) => {
    if (!runtimeActionConstraintKeys.has(key)) {
      return false;
    }
    if (entry === undefined) {
      return true;
    }
    if (key === "maxRecordsPerRequest" || key === "maxActionsPerHour") {
      return runtimePositiveInteger(entry);
    }
    return entry === true || entry === false;
  });
}

function validateMappedRuntimeActionMetadata(action: Record<string, unknown>): string | undefined {
  for (const field of ["provider", "resourceSystem"]) {
    if (typeof action[field] !== "string" || !String(action[field]).trim()) {
      return `action.${field} is required for mapped tool metadata`;
    }
  }

  if (action.requiresApproval !== true && action.requiresApproval !== false) {
    return "action.requiresApproval is required for mapped tool metadata";
  }
  if (action.sensitivity !== "standard" && action.sensitivity !== "sensitive") {
    return "action.sensitivity is required for mapped tool metadata";
  }
  if (!runtimeActionCategories.has(String(action.actionCategory))) {
    return "action.actionCategory is required for mapped tool metadata";
  }
  if (!runtimeApprovalModes.has(String(action.approvalMode))) {
    return "action.approvalMode is required for mapped tool metadata";
  }
  if (!runtimeResourceSensitivities.has(String(action.resourceSensitivity))) {
    return "action.resourceSensitivity is required for mapped tool metadata";
  }
  if (!explicitRuntimeFieldClassArray(action.fieldClasses)) {
    return "action.fieldClasses must be an explicit field-class array for mapped tool metadata";
  }
  if (!explicitRuntimeActionConstraints(action.actionConstraints)) {
    return "action.actionConstraints must be an explicit action constraints object for mapped tool metadata";
  }
  for (const field of ["requiredApplicationGrants", "requiredEffectivePermissions", "requestedScopes"]) {
    if (!explicitRuntimeStringArray(action[field])) {
      return `action.${field} must be an explicit string array for mapped tool metadata`;
    }
  }

  return undefined;
}

function validateRuntimeAuthorizationRequest(value: unknown): string | undefined {
  const body = objectRecord(value);
  if (!body) {
    return "request body must be an object";
  }

  if ("requestId" in body && body.requestId !== undefined && typeof body.requestId !== "string") {
    return "requestId must be a string when provided";
  }

  if ("conversationId" in body && body.conversationId !== undefined && typeof body.conversationId !== "string") {
    return "conversationId must be a string when provided";
  }

  if ("tenantId" in body && body.tenantId !== undefined && typeof body.tenantId !== "string") {
    return "tenantId must be a string when provided";
  }

  const action = objectRecord(body.action);
  if (!action) {
    return "action is required";
  }

  if (typeof action.skillId !== "string" || !action.skillId.trim()) {
    return "action.skillId is required";
  }

  if (
    action.executionType !== "diagnostic_read_only" &&
    action.executionType !== "inspection_read_only" &&
    action.executionType !== "write_action" &&
    action.executionType !== "unsupported"
  ) {
    return "action.executionType is required";
  }

  if (
    action.riskLevel !== "low" &&
    action.riskLevel !== "medium" &&
    action.riskLevel !== "high" &&
    action.riskLevel !== "sensitive"
  ) {
    return "action.riskLevel is required";
  }

  const toolMappingStatus = typeof action.toolMappingStatus === "string" ? action.toolMappingStatus : undefined;
  if (toolMappingStatus !== undefined && !runtimeToolMappingStatuses.has(toolMappingStatus)) {
    return "action.toolMappingStatus must be a supported tool mapping status";
  }

  const toolMappingProof = objectRecord(action.toolMappingProof);
  if (action.toolMappingProof !== undefined && !toolMappingProof) {
    return "action.toolMappingProof must be an object when provided";
  }

  if (toolMappingStatus === "mapped" && !toolMappingProof) {
    return "action.toolMappingProof is required for mapped tool metadata";
  }

  if (toolMappingProof) {
    if (!runtimeToolSourceTypes.has(String(toolMappingProof.sourceType))) {
      return "action.toolMappingProof.sourceType is required";
    }

    for (const field of ["sourceId", "toolId"]) {
      if (typeof toolMappingProof[field] !== "string" || !String(toolMappingProof[field]).trim()) {
        return `action.toolMappingProof.${field} is required`;
      }
    }

    if (
      toolMappingProof.deterministicMapping !== true ||
      toolMappingProof.aiInferred !== false ||
      toolMappingProof.rawDescriptionStored !== false ||
      toolMappingProof.protectedMaterialExposed !== false
    ) {
      return "action.toolMappingProof must be deterministic, non-AI-derived, and audit-safe";
    }
  }

  const connectorRoute = objectRecord(body.connectorRoute);
  const targetAgent = objectRecord(body.targetAgent);
  const resource = objectRecord(body.resource);
  const trustedResourceSystem =
    typeof connectorRoute?.resourceSystem === "string" && connectorRoute.resourceSystem.trim()
      ? connectorRoute.resourceSystem.trim()
      : typeof targetAgent?.resourceSystem === "string" && targetAgent.resourceSystem.trim()
        ? targetAgent.resourceSystem.trim()
        : typeof resource?.resourceSystem === "string" && resource.resourceSystem.trim()
          ? resource.resourceSystem.trim()
          : undefined;
  if (toolMappingStatus === "mapped") {
    const mappedToolMappingProof = toolMappingProof as Record<string, unknown>;
    for (const field of ["provider", "resourceSystem"]) {
      if (typeof mappedToolMappingProof[field] !== "string" || !String(mappedToolMappingProof[field]).trim()) {
        return `action.toolMappingProof.${field} is required for mapped tool proof`;
      }
    }

    const mappedActionMetadataError = validateMappedRuntimeActionMetadata(action);
    if (mappedActionMetadataError) {
      return mappedActionMetadataError;
    }

    if (mappedToolMappingProof.toolId !== action.skillId) {
      return "action.toolMappingProof.toolId must match action.skillId";
    }

    if (mappedToolMappingProof.provider !== String(action.provider).trim()) {
      return "action.toolMappingProof.provider must match action.provider";
    }

    if (mappedToolMappingProof.resourceSystem !== String(action.resourceSystem).trim()) {
      return "action.toolMappingProof.resourceSystem must match action.resourceSystem";
    }

    if (trustedResourceSystem && mappedToolMappingProof.resourceSystem !== trustedResourceSystem) {
      return "action.toolMappingProof.resourceSystem must match trusted route resourceSystem";
    }
  }

  return undefined;
}

function validateResolveRequest(value: unknown): string | undefined {
  const body = objectRecord(value);
  if (!body) {
    return "request body must be an object";
  }

  if (typeof body.message !== "string" || !body.message.trim()) {
    return "message must be a non-empty string";
  }

  if ("conversationId" in body && body.conversationId !== undefined && typeof body.conversationId !== "string") {
    return "conversationId must be a string when provided";
  }

  if ("tenantId" in body && body.tenantId !== undefined && typeof body.tenantId !== "string") {
    return "tenantId must be a string when provided";
  }

  return undefined;
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
  cleanupExpiredUserIdentities();
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

export function getOrCreateConversationState(conversationId: string | undefined, owner: ConversationOwnerContext): ConversationState {
  if (conversationId) {
    const existing = conversations.get(conversationId);
    if (existing && conversationBelongsToOwner(existing, owner)) {
      return existing;
    }
  }

  const state = applyConversationOwner({
    conversationId: createTaskId(),
    messages: [],
    needsMoreInfoCount: 0
  }, owner);
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
  if (response.pendingInteraction) {
    state.pendingInteraction = response.pendingInteraction;
  } else if (
    response.pendingInteractionResolution?.relation === "confirm" ||
    response.pendingInteractionResolution?.relation === "cancel" ||
    response.pendingInteractionResolution?.relation === "provide_missing_target" ||
    response.pendingInteractionResolution?.relation === "provide_missing_input" ||
    response.pendingInteractionResolution?.relation === "unrelated_new_request" ||
    response.pendingInteractionResolution?.relation === "adversarial_attempt"
  ) {
    state.pendingInteraction = undefined;
  }
  if (response.connectorPlanningTargetResolution?.strategy === "needs_clarification") {
    state.pendingFollowUp = {
      type: "connector_planning_target",
      originalMessage: response.pendingFollowUp?.originalMessage ?? lastUserMessageBeforeLatest(state) ?? "",
      detectedIntentClasses: response.connectorPlanningTargetResolution.detectedIntentClasses,
      missingFields: ["targetSystem"],
      createdAt: response.pendingFollowUp?.createdAt ?? new Date().toISOString()
    };
    state.pendingInteraction = response.pendingInteraction ?? {
      id: createTaskId(),
      type: "target_selection",
      originalUserRequest: response.pendingFollowUp?.originalMessage ?? lastUserMessageBeforeLatest(state) ?? "",
      createdAt: response.pendingFollowUp?.createdAt ?? new Date().toISOString(),
      context: {
        detectedIntentClasses: response.connectorPlanningTargetResolution.detectedIntentClasses,
        missingFields: ["targetSystem"]
      }
    };
  } else if (state.pendingFollowUp?.type === "connector_planning_target" && response.pendingInteraction?.type !== "target_selection") {
    state.pendingFollowUp = undefined;
  }

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

type InstalledTrustedAgents = TrustedOnboardedAgent[];

function explicitPlanningTargetMention(message: string, installedAgents: InstalledTrustedAgents): boolean {
  const normalized = message.toLowerCase();
  return installedAgents
    .some((agent) => {
      const connectorId = agent.connectorId ?? agent.connectorProfile?.connectorId ?? "";
      const resourceSystem = agent.resourceSystem ?? agent.connectorProfile?.resourceSystem ?? "";
      const displayName = agent.connectorProfile?.displayName ?? "";
      const explicitTerms = [
        connectorId,
        connectorId.replace("-reference", ""),
        resourceSystem,
        displayName
      ].map((term) => term.toLowerCase()).filter(Boolean);
      return explicitTerms.some((term) => normalized.includes(term));
    });
}

function planningSupported(agent: TrustedOnboardedAgent): boolean {
  return agent.connectorProfile?.planning?.supported === true;
}

function targetSystemLabel(resourceSystem: string): string {
  const normalized = resourceSystem.toLowerCase();
  if (normalized === "jira") return "Jira";
  if (normalized === "servicenow") return "ServiceNow";
  if (normalized === "github") return "GitHub";
  return resourceSystem;
}

function targetSystemDescription(resourceSystem: string): string {
  const normalized = resourceSystem.toLowerCase();
  if (normalized === "jira") return "Projects, issues, and Jira permissions";
  if (normalized === "servicenow") return "Incidents, catalog requests, and ITSM access";
  if (normalized === "github") return "Repositories, pull requests, and DevOps access";
  return "Governed access requests for this system";
}

function knownTargetSystemFromMessage(message: string): { value: string; label: string } | undefined {
  const normalized = message.toLowerCase();
  if (/\bjira\b/.test(normalized)) return { value: "jira", label: "Jira" };
  if (/\bservice\s*now\b|\bservicenow\b/.test(normalized)) return { value: "servicenow", label: "ServiceNow" };
  if (/\bgithub\b|\bgit\s*hub\b/.test(normalized)) return { value: "github", label: "GitHub" };
  return undefined;
}

function normalizePlanningTargetAnswer(message: string): string {
  return message
    .trim()
    .replace(/^use\s+/i, "")
    .replace(/^it'?s\s+/i, "")
    .replace(/^it\s+is\s+/i, "")
    .replace(/^for\s+/i, "")
    .replace(/^the\s+system\s+is\s+/i, "")
    .replace(/\s+for\s+(?:the\s+)?previous\s+access\s+request$/i, "")
    .replace(/[,:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPreviousAccessRequestTargetSelection(message: string): boolean {
  return /\bprevious access request\b/i.test(message);
}

function resolvedPlanningMessage(originalMessage: string, normalizedAnswer: string): string {
  if (/\bproject\b/i.test(normalizedAnswer)) {
    return `I need access to ${normalizedAnswer}`;
  }

  if (/\bproject\b/i.test(originalMessage)) {
    return originalMessage.replace(/\b(?:a|the)\s+project\b/i, `${normalizedAnswer} project`);
  }

  if (/\bsystem\b/i.test(originalMessage)) {
    return originalMessage.replace(/\b(?:a|the)\s+system\b/i, normalizedAnswer);
  }

  return `${originalMessage} in ${normalizedAnswer}`;
}

function buildPlanningFollowUpResolution(params: {
  state: ConversationState;
  currentMessage: string;
  installedAgents: InstalledTrustedAgents;
}): PlanningFollowUpResolution | undefined {
  const pending = params.state.pendingFollowUp;
  if (pending?.type !== "connector_planning_target") {
    return undefined;
  }

  const originalMessage = pending.originalMessage;
  const followUpAnswer = params.currentMessage.trim();
  const normalizedAnswer = normalizePlanningTargetAnswer(followUpAnswer);
  const hasExplicitTarget = explicitPlanningTargetMention(followUpAnswer, params.installedAgents);
  const isUiTargetSelection = isPreviousAccessRequestTargetSelection(followUpAnswer);
  const resolvedMessage = hasExplicitTarget
    ? !isUiTargetSelection && isConnectorAccessPlanningRequest(followUpAnswer)
      ? followUpAnswer
      : resolvedPlanningMessage(originalMessage, normalizedAnswer)
    : [
        originalMessage,
        `Follow-up answer: ${followUpAnswer}`
      ].join("\n");

  return {
    type: "connector_planning_target",
    originalMessage,
    followUpAnswer,
    resolvedMessage
  };
}

function isOtherTargetSelection(message: string): boolean {
  return /\b(other|not listed|another system|unsupported system)\b/i.test(message);
}

function buildSafeTargetSelection(intentClasses: string[], installedAgents: InstalledTrustedAgents): SafeTargetSelection {
  const seenSystems = new Set<string>();
  const installedOptions = installedAgents
    .map((agent) => agent.resourceSystem ?? agent.connectorProfile?.resourceSystem)
    .filter((resourceSystem): resourceSystem is string => Boolean(resourceSystem))
    .filter((resourceSystem) => {
      const normalized = resourceSystem.toLowerCase();
      if (seenSystems.has(normalized)) {
        return false;
      }
      seenSystems.add(normalized);
      return true;
    })
    .map((resourceSystem) => ({
      id: resourceSystem.toLowerCase(),
      label: targetSystemLabel(resourceSystem),
      value: resourceSystem.toLowerCase(),
      description: targetSystemDescription(resourceSystem),
      kind: "supported_system" as const
    }));

  return {
    intent: intentClasses.includes("permission_request") ? "permission_request" : "access_request",
    reason: installedOptions.length
      ? "Access-planning intent detected, but target system was not specified."
      : "No installed systems are available for governed access planning yet.",
    question: "Which system do you need access to?",
    searchPlaceholder: "Search installed systems...",
    options: [
      ...installedOptions,
      {
        id: "other",
        label: "Other / not listed",
        value: "other",
        description: installedOptions.length
          ? "Open a support ticket for another system"
          : "Open a support ticket with the system name and access details",
        kind: "other"
      }
    ]
  };
}

function safePlannedOption(evaluatedActionPlan?: ResolveResponse["evaluatedActionPlan"]): NonNullable<ResolveResponse["evaluatedActionPlan"]>["options"][number] | undefined {
  if (!evaluatedActionPlan?.options.length) {
    return undefined;
  }

  const recommendedOptionId = evaluatedActionPlan.recommendedOptionDecision?.optionId ?? evaluatedActionPlan.plan.recommendedOptionId;
  const candidates = [
    ...(recommendedOptionId ? evaluatedActionPlan.options.filter((item) => item.option.actionId === recommendedOptionId) : []),
    ...evaluatedActionPlan.options
  ];

  return candidates.find((item) =>
    item.decision === "allowed" &&
    item.option.sideEffects === "none" &&
    (item.option.executionType === "inspection_read_only" || item.option.executionType === "diagnostic_read_only")
  );
}

function buildPlannedSafeActionPendingInteraction(params: {
  originalUserRequest: string;
  evaluatedActionPlan: NonNullable<ResolveResponse["evaluatedActionPlan"]>;
}): PendingInteraction | undefined {
  const option = safePlannedOption(params.evaluatedActionPlan);
  if (!option) {
    return undefined;
  }

  return {
    id: createTaskId(),
    type: "planned_safe_action",
    originalUserRequest: params.originalUserRequest,
    createdAt: new Date().toISOString(),
    context: {
      planId: params.evaluatedActionPlan.plan.planId,
      connectorId: params.evaluatedActionPlan.plan.connectorId,
      resourceSystem: params.evaluatedActionPlan.plan.resourceSystem,
      recommendedActionId: option.option.actionId,
      recommendedActionLabel: option.option.label,
      decision: "allowed",
      executionType: option.option.executionType,
      sideEffects: option.option.sideEffects
    }
  };
}

function pendingString(context: Record<string, unknown>, key: string): string | undefined {
  const value = context[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const governedPlanningPendingTtlMs = 15 * 60 * 1000;

type GovernedPlanningState = {
  intentType?: GovernedAccessIntent["intentType"];
  intentSource?: GovernedAccessIntent["source"];
  intentConfidence?: GovernedAccessIntent["confidence"];
  connectorId?: string;
  resourceSystem?: string;
  targetResourceSystem: string;
  targetResourceType?: string;
  targetResourceName?: string;
  requestedAccessLevel?: string;
  businessReason?: string;
  missingInputs: string[];
};

function governedPlanningCollectedInputs(state: GovernedPlanningState): Record<string, string> {
  return Object.fromEntries([
    ["targetResourceSystem", state.targetResourceSystem],
    ["targetResourceType", state.targetResourceType],
    ["targetResourceName", state.targetResourceName],
    ["accessLevel", state.requestedAccessLevel],
    ["businessReason", state.businessReason]
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0));
}

function governedPlanningInputSchema() {
  return {
    schemaVersion: "governed-planning.missing-input.v1",
    allowAiAssistedExtraction: true,
    strongUnrelatedIntentHints: [
      "new request",
      "different request",
      "separate request",
      "unrelated to that",
      "ignore the previous request",
      "start over"
    ],
    slots: [
      {
        name: "targetResourceName",
        required: true,
        maxLength: 100,
        description: "Target project, repository, site, group, or resource name for the planned access request."
      },
      {
        name: "accessLevel",
        required: true,
        allowedValues: ["viewer", "contributor", "project admin"],
        maxLength: 32,
        description: "Requested planning access level."
      },
      {
        name: "businessReason",
        required: true,
        maxLength: 240,
        description: "Concise business justification for the planned access request."
      }
    ]
  };
}

function pendingStringArray(context: Record<string, unknown>, key: string): string[] {
  const value = context[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function planningConnectorForResource(resourceSystem: string | undefined, installedAgents: InstalledTrustedAgents): TrustedOnboardedAgent | undefined {
  const normalized = resourceSystem?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return installedAgents.find((agent) =>
    agent.connectorProfile?.planning?.supported === true &&
    [agent.resourceSystem, agent.connectorProfile?.resourceSystem]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase() === normalized)
  );
}

function governedPlanningMissingInputs(input: {
  targetResourceName?: string;
  requestedAccessLevel?: string;
  businessReason?: string;
}): string[] {
  return [
    input.targetResourceName ? undefined : "targetResourceName",
    input.requestedAccessLevel ? undefined : "accessLevel",
    input.businessReason ? undefined : "businessReason"
  ].filter((item): item is string => Boolean(item));
}

function governedPlanningQuestion(missingInputs: string[]): string {
  const fields = missingInputs.map((field) => {
    if (field === "accessLevel") {
      return "access level (viewer, contributor, or project admin)";
    }
    if (field === "businessReason") {
      return "business reason";
    }
    if (field === "targetResourceName") {
      return "resource/project/site";
    }
    return field;
  });
  if (fields.length <= 1) {
    return `I need the ${fields[0] ?? "missing detail"} before I can continue planning.`;
  }
  return `I need the ${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]} before I can continue planning.`;
}

function governedPlanningTargetLine(state: Pick<GovernedPlanningState, "targetResourceSystem" | "targetResourceName">): string {
  return state.targetResourceName
    ? `Target: ${state.targetResourceSystem} ${state.targetResourceName}.`
    : `Target system: ${state.targetResourceSystem}.`;
}

function governedPlanningClassification(targetResourceSystem: string): Classification {
  return {
    system: targetResourceSystem,
    issueType: "AUTHORIZATION_FAILURE",
    confidence: "high",
    reasoningSummary: "Deterministic connector planning state handled an access request without runtime execution.",
    classificationSource: "rules_fallback",
    reporterType: "end_user",
    supportMode: "end_user_support"
  };
}

function governedPlanningRoutingSource(state: Pick<GovernedPlanningState, "intentSource">): ResolveResponse["routingSource"] {
  return state.intentSource === "ai" ? "ai" : "rules_fallback";
}

function governedPlanningRoutingConfidence(state: Pick<GovernedPlanningState, "intentConfidence">): ResolveResponse["routingConfidence"] {
  return state.intentConfidence ?? "high";
}

function governedPlanningInterpretation(state: GovernedPlanningState): RequestInterpretation {
  const intentType: RequestInterpretation["intentType"] =
    state.intentType === "permission_request" ? "permission_change" :
    state.intentType === "service_request" ? "manual_service_request" :
    "access_request";
  const targetText = state.targetResourceName
    ? `${state.targetResourceSystem} ${state.targetResourceName}`
    : state.targetResourceSystem;
  return {
    scope: "enterprise_support",
    intentType,
    requestedCapability: "access.request.prepare",
    targetSystemText: state.targetResourceSystem,
    targetResourceType: state.targetResourceType ?? "resource",
    targetResourceName: state.targetResourceName,
    requestedActionText: [
      state.requestedAccessLevel ? `${state.requestedAccessLevel} access` : "access",
      `to ${targetText}`
    ].join(" "),
    requiresApproval: true,
    confidence: state.intentConfidence ?? "high",
    reason: "Governed connector planning state preserved normalized target resource fields and collected missing planning inputs.",
    interpretationSource: state.intentSource === "ai" ? "ai" : "fallback"
  };
}

function hashOriginalUserRequest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildGovernedPlanningPendingInteraction(params: {
  originalUserRequest: string;
  tenantContext: ResolvedTenantContext;
  conversationState: ConversationState;
  actor?: VerifiedUserIdentity;
  state: GovernedPlanningState;
  createdAt?: Date;
}): PendingInteraction {
  const createdAt = params.createdAt ?? new Date();
  const expiresAt = new Date(createdAt.getTime() + governedPlanningPendingTtlMs);
  const safeOriginalUserRequestSummary = safeConversationSummary(params.originalUserRequest);
  const originalUserRequestHash = hashOriginalUserRequest(params.originalUserRequest);
  const proof = {
    rawPromptStored: false as const,
    tokenMaterialStored: false as const,
    protectedMaterialExposed: false as const
  };

  return {
    id: createTaskId(),
    type: "missing_input",
    originalUserRequest: safeOriginalUserRequestSummary,
    safeOriginalUserRequestSummary,
    originalUserRequestHash,
    tenantId: params.tenantContext.tenantId,
    conversationId: params.conversationState.conversationId,
    actorProvider: params.actor?.provider,
    actorSubject: params.actor?.subject,
    actorEmail: params.actor?.email,
    ...proof,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    context: {
      tenantId: params.tenantContext.tenantId,
      conversationId: params.conversationState.conversationId,
      actorProvider: params.actor?.provider,
      actorSubject: params.actor?.subject,
      actorEmail: params.actor?.email,
      originalUserRequestHash,
      originalUserRequest: safeOriginalUserRequestSummary,
      safeOriginalUserRequestSummary,
      intentType: params.state.intentType,
      intentSource: params.state.intentSource,
      intentConfidence: params.state.intentConfidence,
      connectorId: params.state.connectorId,
      resourceSystem: params.state.resourceSystem,
      targetResourceSystem: params.state.targetResourceSystem,
      targetResourceType: params.state.targetResourceType,
      targetResourceName: params.state.targetResourceName,
      requestedAccessLevel: params.state.requestedAccessLevel,
      businessReason: params.state.businessReason,
      missingInputs: params.state.missingInputs,
      collectedInputs: governedPlanningCollectedInputs(params.state),
      inputSchema: governedPlanningInputSchema(),
      inputHints: {
        expectedSlots: ["targetResourceName", "accessLevel", "businessReason"],
        cancellationPhrases: ["cancel", "never mind", "stop", "forget it", "don't continue"],
        confirmationPhrases: []
      },
      recommendedAction: "access.request.prepare",
      planContext: "governed_connector_access_planning",
      ...proof
    }
  };
}

function buildGovernedAccessTargetSelectionPendingInteraction(params: {
  originalUserRequest: string;
  tenantContext: ResolvedTenantContext;
  conversationState: ConversationState;
  actor?: VerifiedUserIdentity;
  intent: GovernedAccessIntent;
  detectedIntentClasses: string[];
  createdAt?: Date;
}): PendingInteraction {
  const createdAt = params.createdAt ?? new Date();
  const expiresAt = new Date(createdAt.getTime() + governedPlanningPendingTtlMs);
  const safeOriginalUserRequestSummary = safeConversationSummary(params.originalUserRequest);
  const originalUserRequestHash = hashOriginalUserRequest(params.originalUserRequest);
  const proof = {
    rawPromptStored: false as const,
    tokenMaterialStored: false as const,
    protectedMaterialExposed: false as const
  };

  return {
    id: createTaskId(),
    type: "target_selection",
    originalUserRequest: safeOriginalUserRequestSummary,
    safeOriginalUserRequestSummary,
    originalUserRequestHash,
    tenantId: params.tenantContext.tenantId,
    conversationId: params.conversationState.conversationId,
    actorProvider: params.actor?.provider,
    actorSubject: params.actor?.subject,
    actorEmail: params.actor?.email,
    ...proof,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    context: {
      tenantId: params.tenantContext.tenantId,
      conversationId: params.conversationState.conversationId,
      actorProvider: params.actor?.provider,
      actorSubject: params.actor?.subject,
      actorEmail: params.actor?.email,
      originalUserRequestHash,
      originalUserRequest: safeOriginalUserRequestSummary,
      safeOriginalUserRequestSummary,
      detectedIntentClasses: params.detectedIntentClasses,
      missingFields: [
        params.intent.targetResourceSystem ? undefined : "targetSystem",
        params.intent.targetResourceName ? undefined : "targetResourceName"
      ].filter((item): item is string => Boolean(item)),
      intentType: params.intent.intentType,
      intentSource: params.intent.source,
      intentConfidence: params.intent.confidence,
      targetResourceSystem: params.intent.targetResourceSystem,
      targetResourceType: params.intent.targetResourceType,
      targetResourceName: params.intent.targetResourceName,
      requestedAccessLevel: params.intent.requestedAccessLevel,
      businessReason: params.intent.businessReason,
      planContext: "governed_connector_access_planning_target_selection",
      ...proof
    }
  };
}

function pendingGovernedPlanningState(pending: PendingInteraction): GovernedPlanningState | undefined {
  const targetResourceSystem = pendingString(pending.context, "targetResourceSystem");
  const targetResourceName = pendingString(pending.context, "targetResourceName");
  if (pending.type !== "missing_input" || !targetResourceSystem) {
    return undefined;
  }

  const requestedAccessLevel = pendingString(pending.context, "requestedAccessLevel");
  const businessReason = pendingString(pending.context, "businessReason");
  const collectedInputs = typeof pending.context.collectedInputs === "object" && pending.context.collectedInputs !== null && !Array.isArray(pending.context.collectedInputs)
    ? pending.context.collectedInputs as Record<string, unknown>
    : {};
  const collectedAccessLevel = typeof collectedInputs.accessLevel === "string" ? collectedInputs.accessLevel.trim() : undefined;
  const collectedBusinessReason = typeof collectedInputs.businessReason === "string" ? collectedInputs.businessReason.trim() : undefined;
  const collectedTargetResourceName = typeof collectedInputs.targetResourceName === "string" ? collectedInputs.targetResourceName.trim() : undefined;
  return {
    intentType: pendingString(pending.context, "intentType") as GovernedAccessIntent["intentType"] | undefined,
    intentSource: pendingString(pending.context, "intentSource") as GovernedAccessIntent["source"] | undefined,
    intentConfidence: pendingString(pending.context, "intentConfidence") as GovernedAccessIntent["confidence"] | undefined,
    connectorId: pendingString(pending.context, "connectorId"),
    resourceSystem: pendingString(pending.context, "resourceSystem"),
    targetResourceSystem,
    targetResourceType: pendingString(pending.context, "targetResourceType"),
    targetResourceName: targetResourceName ?? collectedTargetResourceName,
    requestedAccessLevel: requestedAccessLevel ?? collectedAccessLevel,
    businessReason: businessReason ?? collectedBusinessReason,
    missingInputs: pendingStringArray(pending.context, "missingInputs").length
      ? pendingStringArray(pending.context, "missingInputs")
      : governedPlanningMissingInputs({ targetResourceName: targetResourceName ?? collectedTargetResourceName, requestedAccessLevel: requestedAccessLevel ?? collectedAccessLevel, businessReason: businessReason ?? collectedBusinessReason })
  };
}

function pendingInteractionExpired(pending: PendingInteraction, now = new Date()): boolean {
  return Boolean(pending.expiresAt && Number.isFinite(Date.parse(pending.expiresAt)) && Date.parse(pending.expiresAt) <= now.getTime());
}

function pendingInteractionMatchesResolvedOwner(params: {
  pending: PendingInteraction;
  conversationState: ConversationState;
  tenantContext: ResolvedTenantContext;
  actor?: VerifiedUserIdentity;
}): boolean {
  const pendingTenantId = params.pending.tenantId ?? pendingString(params.pending.context, "tenantId");
  if (pendingTenantId && pendingTenantId !== params.tenantContext.tenantId) {
    return false;
  }
  const pendingConversationId = params.pending.conversationId ?? pendingString(params.pending.context, "conversationId");
  if (pendingConversationId && pendingConversationId !== params.conversationState.conversationId) {
    return false;
  }
  const pendingActorProvider = params.pending.actorProvider ?? pendingString(params.pending.context, "actorProvider");
  const pendingActorSubject = params.pending.actorSubject ?? pendingString(params.pending.context, "actorSubject");
  const pendingActorEmail = params.pending.actorEmail ?? pendingString(params.pending.context, "actorEmail");
  if ((pendingActorProvider || pendingActorSubject || pendingActorEmail) && !params.actor) {
    return false;
  }
  if (pendingActorProvider && params.actor?.provider && pendingActorProvider !== params.actor.provider) {
    return false;
  }
  if (pendingActorSubject && params.actor?.subject && pendingActorSubject !== params.actor.subject) {
    return false;
  }
  if (pendingActorEmail && params.actor?.email && pendingActorEmail !== params.actor.email) {
    return false;
  }
  return true;
}

function mergeGovernedPlanningInputs(params: {
  pending: PendingInteraction;
  resolution: PendingInteractionResolution;
}): { state: GovernedPlanningState; collectedInputs: string[] } | undefined {
  const current = pendingGovernedPlanningState(params.pending);
  if (!current) {
    return undefined;
  }

  const extracted = params.resolution.extractedValues ?? {};
  const targetResourceName = extracted.targetResourceName ?? extracted.target ?? current.targetResourceName;
  const requestedAccessLevel = extracted.accessLevel ?? current.requestedAccessLevel;
  const businessReason = extracted.businessReason ?? current.businessReason;
  const missingInputs = governedPlanningMissingInputs({
    targetResourceName,
    requestedAccessLevel,
    businessReason
  });
  return {
    state: {
      ...current,
      targetResourceName,
      requestedAccessLevel,
      businessReason,
      missingInputs
    },
    collectedInputs: [
      Boolean(extracted.targetResourceName ?? extracted.target) ? "targetResourceName" : undefined,
      extracted.accessLevel ? "accessLevel" : undefined,
      extracted.businessReason ? "businessReason" : undefined
    ].filter((key): key is string => Boolean(key))
  };
}

function initialGovernedPlanningState(params: {
  intent: GovernedAccessIntent;
  installedAgents: InstalledTrustedAgents;
}): GovernedPlanningState | undefined {
  const intent = params.intent;
  if (
    intent.intentType === "unknown" ||
    intent.confidence === "low" ||
    !intent.targetResourceSystem
  ) {
    return undefined;
  }
  const planningConnector = planningConnectorForResource(intent.targetResourceSystem, params.installedAgents);
  if (!planningConnector) {
    return undefined;
  }

  return {
    intentType: intent.intentType,
    intentSource: intent.source,
    intentConfidence: intent.confidence,
    connectorId: planningConnector.connectorId ?? planningConnector.connectorProfile?.connectorId,
    resourceSystem: planningConnector.resourceSystem ?? planningConnector.connectorProfile?.resourceSystem ?? intent.targetResourceSystem,
    targetResourceSystem: intent.targetResourceSystem,
    targetResourceType: intent.targetResourceType,
    targetResourceName: intent.targetResourceName,
    requestedAccessLevel: intent.requestedAccessLevel,
    businessReason: intent.businessReason,
    missingInputs: governedPlanningMissingInputs({
      targetResourceName: intent.targetResourceName,
      requestedAccessLevel: intent.requestedAccessLevel,
      businessReason: intent.businessReason
    })
  };
}

function governedPlanningRuntimeExecutionProof() {
  return {
    executed: false,
    runtimeTokenIssued: false,
    externalRuntimeCalled: false
  };
}

function governedPlanningEvidence(params: {
  state: GovernedPlanningState;
  pendingInteractionId?: string;
  pendingInteractionResumed: boolean;
  missingInputsCollected?: string[];
}) {
  return {
    agent: orchestratorAgentId,
    title: params.pendingInteractionResumed ? "Governed planning resume" : "Governed pending planning state",
    data: {
      pendingInteractionId: params.pendingInteractionId,
      pendingInteractionResumed: params.pendingInteractionResumed,
      missingInputsCollected: params.missingInputsCollected ?? [],
      requestSubmitted: false,
      runtimeExecution: governedPlanningRuntimeExecutionProof(),
      connectorId: params.state.connectorId,
      resourceSystem: params.state.resourceSystem,
      intentType: params.state.intentType,
      intentSource: params.state.intentSource,
      intentConfidence: params.state.intentConfidence,
      targetResourceSystem: params.state.targetResourceSystem,
      targetResourceType: params.state.targetResourceType,
      targetResourceName: params.state.targetResourceName,
      accessLevel: params.state.requestedAccessLevel,
      businessReason: params.state.businessReason,
      missingInputs: params.state.missingInputs,
      rawPromptStored: false,
      tokenMaterialStored: false,
      protectedMaterialExposed: false
    }
  };
}

function governedPlanningGateStack(params: {
  finalOutcome: NonNullable<ResolveResponse["executionGateStack"]>["finalOutcome"];
  stoppedAt: NonNullable<ResolveResponse["executionGateStack"]>["stoppedAt"];
  gatewayReason: string;
  aiReason?: string;
}): NonNullable<ResolveResponse["executionGateStack"]> {
  return {
    stoppedAt: params.stoppedAt,
    finalOutcome: params.finalOutcome,
    gates: [
      {
        id: "ai_interpretation",
        label: "AI Interpretation",
        status: "not_evaluated",
        reason: params.aiReason ?? "Governed pending planning state was evaluated before new AI routing."
      },
      {
        id: "gateway_governance",
        label: "Gateway Governance",
        status: params.finalOutcome === "blocked_at_gateway" ? "blocked" : "passed",
        reason: params.gatewayReason
      },
      {
        id: "oauth_scope",
        label: "OAuth Scope Gate",
        status: "not_evaluated",
        reason: "No runtime token was issued for connector planning."
      },
      {
        id: "service_account_permission",
        label: "Service Account Permission Gate",
        status: "not_evaluated",
        reason: "No permission change or connector write request was submitted."
      },
      {
        id: "runtime_execution",
        label: "Runtime Execution",
        status: "not_evaluated",
        reason: "No connector runtime was called."
      }
    ]
  };
}

function governedAccessIntentClasses(intent: GovernedAccessIntent): string[] {
  return [
    intent.intentType === "permission_request" ? "permission_request" : undefined,
    intent.intentType === "service_request" ? "service_request" : undefined,
    intent.intentType === "access_request" ? "access_request" : undefined,
    intent.targetResourceType === "project" ? "project_access" : undefined,
    intent.targetResourceType === "repository" ? "repository_access" : undefined
  ].filter((item): item is string => Boolean(item));
}

function governedAccessIntentNeedsTargetClarification(intent: GovernedAccessIntent): boolean {
  return intent.intentType !== "unknown" &&
    intent.confidence !== "low" &&
    (!intent.targetResourceSystem || !intent.targetResourceName);
}

function governedAccessClarificationQuestion(intent: GovernedAccessIntent): string {
  if (!intent.targetResourceSystem && intent.targetResourceName) {
    return `Which system is ${intent.targetResourceName} in?`;
  }
  if (intent.targetResourceSystem && !intent.targetResourceName) {
    const resourceType = intent.targetResourceType ?? "resource";
    return `Which ${resourceType} in ${targetSystemLabel(intent.targetResourceSystem)} do you need access to?`;
  }
  return "Which system and resource do you need access to?";
}

function governedAccessIntentEvidence(intent: GovernedAccessIntent): AgentEvidence {
  return {
    agent: orchestratorAgentId,
    title: "Governed access intent interpretation",
    data: {
      intentType: intent.intentType,
      targetResourceSystem: intent.targetResourceSystem,
      targetResourceType: intent.targetResourceType,
      targetResourceName: intent.targetResourceName,
      requestedAccessLevel: intent.requestedAccessLevel,
      businessReason: intent.businessReason,
      confidence: intent.confidence,
      source: intent.source,
      aiAdvisoryOnly: true,
      requestSubmitted: false,
      runtimeExecution: governedPlanningRuntimeExecutionProof(),
      rawPromptStored: false,
      tokenMaterialStored: false,
      protectedMaterialExposed: false
    }
  };
}

function governedAccessIntentInterpretation(intent: GovernedAccessIntent): RequestInterpretation {
  return {
    scope: "enterprise_support",
    intentType: intent.intentType === "permission_request"
      ? "permission_change"
      : intent.intentType === "service_request"
        ? "manual_service_request"
        : "access_request",
    requestedCapability: "access.request.prepare",
    targetSystemText: intent.targetResourceSystem,
    targetResourceType: intent.targetResourceType,
    targetResourceName: intent.targetResourceName,
    requestedActionText: intent.intentType === "permission_request" ? "permission request" : "access request",
    requiresApproval: true,
    confidence: intent.confidence,
    reason: intent.reason,
    interpretationSource: intent.source === "ai" ? "ai" : "fallback",
    aiProvider: intent.aiProvider,
    aiModel: intent.aiModel
  };
}

function contextlessContinuationRequest(message: string): boolean {
  return /(?:👍|✅|👌)|\b(ok(?:ay)?|yes|confirm|continue|proceed|do it|go ahead)\b/i.test(message);
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
    return `NEEDS APPROVAL\n${approvalDecision.reason}\nNo changes were made. No access was granted. No request was submitted.`;
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
    if (decision.runtimeMode === "metadata_only") {
      return `${connectorRoutingStatusLabel(decision.status)}: ${target}${skill} is approved by the onboarded connector profile, but runtime execution was skipped because no trusted allowlisted runtime endpoint is available. ${decision.recommendedNextStep}`;
    }

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
  const authorizationRequirement = runtime.authorizationRequirement ?? runtime.agentResponse?.authorizationRequirement;
  if (authorizationRequirement) {
    return [
      "AUTHORIZATION REQUIRED",
      `Connect your ${authorizationRequirement.provider} account to continue.`,
      `Reason: ${authorizationRequirement.reason}`,
      `Requested scopes: ${authorizationRequirement.requestedScopes.join(", ")}`,
      "Changed: No changes were made.",
      "Raw OAuth tokens, authorization codes, refresh tokens, Authorization headers, and secrets were not exposed."
    ].join("\n");
  }

  if (runtime.executed && runtime.agentResponse) {
    const endUserAnswer = runtime.agentResponse.endUserAnswer;
    if (endUserAnswer?.safeToDisplay) {
      return [
        endUserAnswer.title,
        endUserAnswer.summary,
        endUserAnswer.whatWasChecked ? `Checked: ${endUserAnswer.whatWasChecked}` : "",
        endUserAnswer.whatWasChanged ? `Changed: ${endUserAnswer.whatWasChanged}` : "Changed: No changes were made.",
        `Next step: ${endUserAnswer.nextStep}`
      ].filter(Boolean).join("\n");
    }
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
    if (decision.toolMappingStatus === "mapped" && !connectorRuntimeToolMappingProofBound(decision)) {
      return {
        probableCause: "Tool-to-action mapping proof is not bound to the approved connector action and trusted route/resource",
        recommendedFix: "Update the connector profile or reference action metadata so the mapping proof toolId, provider, and resource system match the requested connector action."
      };
    }

    if (decision.runtimeMode === "metadata_only") {
      return {
        probableCause: "Connector profile approved the skill, but runtime was metadata-only",
        recommendedFix: "Use the connector metadata guidance or re-run onboarding after configuring a trusted allowlisted runtime endpoint."
      };
    }

    return {
      probableCause: "Connector profile and action decision are available",
      recommendedFix: "Use the connector-backed diagnosis flow."
    };
  }

  if (decision.status === "connector_skill_blocked") {
    if (decision.toolMappingStatus === "mapped" && !connectorRuntimeToolMappingProofBound(decision)) {
      return {
        probableCause: "Tool-to-action mapping proof is not bound to the approved connector action and trusted route/resource",
        recommendedFix: decision.recommendedNextStep
      };
    }

    if (decision.toolMappingStatus && decision.toolMappingStatus !== "mapped") {
      return {
        probableCause: "Tool-to-action metadata mapping did not produce a mapped connector action",
        recommendedFix: decision.recommendedNextStep
      };
    }

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

function connectorRuntimeResolutionStatus(decision: ConnectorRoutingDecision, runtime?: ConnectorRuntimeResult): ResolveResponse["resolutionStatus"] {
  if (runtime?.authorizationRequirement || runtime?.agentResponse?.authorizationRequirement || runtime?.agentResponse?.status === "needs_more_info") {
    return "needs_more_info";
  }

  if (decision.status === "connector_skill_blocked" && decision.toolMappingStatus === "mapped" && !connectorRuntimeToolMappingProofBound(decision)) {
    return "unsupported";
  }

  return connectorRoutingResolutionStatus(decision);
}

async function appendIdentityVerifiedAuditEvent(identity: VerifiedUserIdentity, tenantContext: ResolvedTenantContext): Promise<void> {
  await appendPlatformAuditEvent({
    tenantId: tenantContext.tenantId,
    actorProvider: identity.provider,
    actorSubject: identity.subject,
    actorEmail: identity.email,
    eventType: AuditEvents.USER_IDENTITY_VERIFIED,
    resourceType: "user",
    resourceId: identity.subject || identity.email,
    safeMetadata: {
      provider: identity.provider,
      issuer: identity.issuer,
      audience: identity.audience,
      email: identity.email,
      roles: identity.roles,
      tenantResolutionSource: tenantContext.source,
      requestedTenantId: tenantContext.requestedTenantId,
      requestedTenantAccepted: tenantContext.requestedTenantAccepted,
      protectedMaterialExposed: false,
      tokenMaterialStored: false
    }
  });
}

async function appendIdentityDeniedAuditEvent(identity: VerifiedUserIdentity, reason: string, tenantContext: ResolvedTenantContext): Promise<void> {
  await appendPlatformAuditEvent({
    tenantId: tenantContext.tenantId,
    actorProvider: identity.provider,
    actorSubject: identity.subject,
    actorEmail: identity.email,
    eventType: AuditEvents.USER_IDENTITY_DENIED,
    resourceType: "user",
    resourceId: identity.email,
    safeMetadata: {
      provider: identity.provider,
      email: identity.email,
      reason,
      tenantId: tenantContext.tenantId,
      tenantResolutionSource: tenantContext.source,
      requestedTenantId: tenantContext.requestedTenantId,
      requestedTenantAccepted: tenantContext.requestedTenantAccepted,
      protectedMaterialExposed: false,
      tokenMaterialStored: false
    }
  });
}

function identityWithDirectoryRoles(identity: VerifiedUserIdentity, roles: string[]): VerifiedUserIdentity {
  return {
    ...identity,
    roles: [...new Set([...identity.roles, ...roles])]
  };
}

async function appendSecurityBlockedAuditEvent(params: {
  actor?: VerifiedUserIdentity;
  category: string;
  reason: string;
  finalOutcome: string;
}): Promise<void> {
  await appendPlatformAuditEvent({
    actorProvider: params.actor?.provider,
    actorSubject: params.actor?.subject,
    actorEmail: params.actor?.email,
    eventType: AuditEvents.SECURITY_REQUEST_BLOCKED,
    resourceType: "request",
    safeMetadata: {
      category: params.category,
      reason: params.reason,
      finalOutcome: params.finalOutcome,
      protectedMaterialExposed: false,
      tokenMaterialStored: false,
      promptTextStored: false
    }
  });
}

async function appendAiInterpretationEvaluatedAuditEvent(params: {
  proof: OgenInterpretationProof;
  actor?: VerifiedUserIdentity;
}): Promise<void> {
  const { proof, actor } = params;
  await appendPlatformAuditEvent({
    actorProvider: actor?.provider,
    actorSubject: actor?.subject,
    actorEmail: actor?.email,
    eventType: AuditEvents.AI_INTERPRETATION_EVALUATED,
    resourceType: "request_interpretation",
    resourceId: proof.interpretationId,
    safeMetadata: {
      interpretationId: proof.interpretationId,
      schemaVersion: proof.schemaVersion,
      source: proof.source,
      provider: proof.provider,
      model: proof.model,
      inputHash: proof.inputHash,
      outputHash: proof.outputHash,
      confidence: proof.confidence,
      risks: proof.risks,
      advisoryOnly: true,
      rawPromptStored: false,
      rawAiResponseStored: false,
      originalInterpretationScope: proof.originalInterpretationScope,
      reconciledScope: proof.reconciledScope,
      reconciliationSource: proof.reconciliationSource,
      reconciliationReason: proof.reconciliationReason,
      protectedMaterialExposed: false,
      tokenMaterialStored: false
    }
  });
}

async function appendAiRoutingEvaluatedAuditEvent(params: {
  proof: OgenAiRoutingProof;
  actor?: VerifiedUserIdentity;
}): Promise<void> {
  const { proof, actor } = params;
  await appendPlatformAuditEvent({
    actorProvider: actor?.provider,
    actorSubject: actor?.subject,
    actorEmail: actor?.email,
    eventType: AuditEvents.AI_ROUTING_EVALUATED,
    resourceType: "ai_routing",
    resourceId: proof.routingProofId,
    safeMetadata: {
      routingProofId: proof.routingProofId,
      schemaVersion: proof.schemaVersion,
      source: proof.source,
      provider: proof.provider,
      model: proof.model,
      inputHash: proof.inputHash,
      messageHash: proof.messageHash,
      inputContextHash: proof.inputContextHash,
      agentSkillPairs: proof.safeInputContextSummary.agentSkillPairs,
      agentRoutingViewHash: proof.safeInputContextSummary.agentRoutingViewHash,
      safeInputContextSummary: proof.safeInputContextSummary,
      outputHash: proof.outputHash,
      validationStatus: proof.validationStatus,
      selectedAgentIds: proof.selectedAgentIds,
      skippedAgentIds: proof.skippedAgentIds,
      resolutionStatus: proof.resolutionStatus,
      routingConfidence: proof.routingConfidence,
      advisoryOnly: true,
      rawPromptStored: false,
      rawAiResponseStored: false,
      authorizedRuntime: false,
      protectedMaterialExposed: false,
      tokenMaterialStored: false
    }
  });
}

async function appendConnectorPolicyDecisionAuditEvent(params: {
  connectorRouting: ConnectorRoutingDecision;
  connectorPolicy: ConnectorPolicyEvaluation;
  actor?: VerifiedUserIdentity;
  tenantContext?: ResolvedTenantContext;
}): Promise<void> {
  const { connectorRouting, connectorPolicy, actor, tenantContext } = params;
  await appendPlatformAuditEvent({
    tenantId: tenantContext?.tenantId,
    actorProvider: actor?.provider,
    actorSubject: actor?.subject,
    actorEmail: actor?.email,
    eventType: AuditEvents.POLICY_DECISION_EVALUATED,
    resourceType: "connector",
    resourceId: connectorRouting.connectorId,
    safeMetadata: {
      decisionId: connectorPolicy.decisionId,
      policyVersion: connectorPolicy.policyVersion,
      effect: connectorPolicy.effect,
      primaryRuleId: connectorPolicy.primaryRuleId,
      primaryRuleSource: connectorPolicy.primaryRuleSource,
      matchedRuleIds: connectorPolicy.matchedRuleIds,
      matchedGuardrailRuleIds: connectorPolicy.matchedGuardrailRuleIds,
      matchedTenantRuleIds: connectorPolicy.matchedTenantRuleIds,
      matchedRuleSummaries: connectorPolicy.matchedRuleSummaries,
      inputHash: connectorPolicy.inputHash,
      deniedByDefault: connectorPolicy.deniedByDefault,
      requiresApproval: connectorPolicy.requiresApproval,
      reason: connectorPolicy.reason,
      connectorId: connectorRouting.connectorId,
      resourceSystem: connectorRouting.resourceSystem,
      skillId: connectorRouting.skillId,
      riskLevel: connectorRouting.riskLevel,
      executionType: connectorRouting.executionType,
      actionCategory: connectorRouting.actionCategory,
      approvalMode: connectorRouting.approvalMode,
      resourceSensitivity: connectorRouting.resourceSensitivity,
      fieldClasses: connectorRouting.fieldClasses,
      actionConstraints: connectorRouting.actionConstraints,
      requestedScopes: connectorRouting.requestedScopes,
      toolMappingStatus: connectorRouting.toolMappingStatus,
      toolMappingProof: connectorRouting.toolMappingProof,
      provider: connectorRouting.provider,
      actionResourceSystem: connectorRouting.actionResourceSystem,
      actionMetadataSource: connectorRouting.actionMetadataSource,
      runtimeMode: connectorRouting.runtimeMode,
      tenantResolutionSource: tenantContext?.source,
      requestedTenantId: tenantContext?.requestedTenantId,
      requestedTenantAccepted: tenantContext?.requestedTenantAccepted,
      protectedMaterialExposed: false,
      tokenMaterialStored: false,
      promptTextStored: false
    }
  });
}

async function appendRuntimeAuthorizationEvaluatedAuditEvent(params: {
  authorization: RuntimeAuthorizationResponse;
  requestBody: RuntimeAuthorizationRequest;
  actor: VerifiedUserIdentity;
  tenantContext: ResolvedTenantContext;
}): Promise<void> {
  const { authorization, requestBody, actor, tenantContext } = params;
  const safeRequestId = safeOptionalString(requestBody.requestId);
  await appendPlatformAuditEvent({
    tenantId: authorization.tenantId,
    actorProvider: actor.provider,
    actorSubject: actor.subject,
    actorEmail: actor.email,
    eventType: AuditEvents.RUNTIME_AUTHORIZATION_EVALUATED,
    resourceType: "runtime_authorization",
    resourceId: authorization.policy.decisionId || safeRequestId,
    safeMetadata: {
      decisionId: authorization.policy.decisionId,
      policyVersion: authorization.policy.policyVersion,
      effect: authorization.decision,
      primaryRuleId: authorization.policy.primaryRuleId,
      primaryRuleSource: authorization.policy.primaryRuleSource,
      matchedRuleIds: authorization.policy.matchedRuleIds,
      matchedGuardrailRuleIds: authorization.policy.matchedGuardrailRuleIds,
      matchedTenantRuleIds: authorization.policy.matchedTenantRuleIds,
      inputHash: authorization.policy.inputHash,
      skillId: requestBody.action.skillId,
      connectorId: requestBody.connectorRoute?.connectorId ?? requestBody.targetAgent?.connectorId ?? requestBody.resource?.connectorId,
      resourceSystem: requestBody.connectorRoute?.resourceSystem ?? requestBody.targetAgent?.resourceSystem ?? requestBody.resource?.resourceSystem,
      tenantResolutionSource: tenantContext.source,
      requestedTenantId: tenantContext.requestedTenantId,
      requestedTenantAccepted: tenantContext.requestedTenantAccepted,
      runtimeTokenIssued: false,
      externalRuntimeCalled: false,
      protectedMaterialExposed: false,
      tokenMaterialStored: false,
      rawPromptStored: false
    }
  });
}

async function appendTenantAccessDeniedAuditEvent(params: {
  actor: VerifiedUserIdentity;
  tenantContext: ResolvedTenantContext;
  route: string;
  requestId?: unknown;
  conversationId?: unknown;
}): Promise<void> {
  const { actor, tenantContext, route, requestId, conversationId } = params;
  const safeRequestId = safeOptionalString(requestId);
  const safeConversationId = safeOptionalString(conversationId);
  await appendPlatformAuditEvent({
    tenantId: tenantContext.tenantId,
    actorProvider: actor.provider,
    actorSubject: actor.subject,
    actorEmail: actor.email,
    eventType: AuditEvents.TENANT_ACCESS_DENIED,
    resourceType: "tenant",
    resourceId: tenantContext.tenantId,
    safeMetadata: {
      route,
      requestId: safeRequestId,
      conversationId: safeConversationId,
      tenantId: tenantContext.tenantId,
      tenantResolutionSource: tenantContext.source,
      requestedTenantId: tenantContext.requestedTenantId,
      requestedTenantAccepted: tenantContext.requestedTenantAccepted,
      reason: "tenant_access_denied",
      protectedMaterialExposed: false,
      tokenMaterialStored: false,
      rawPromptStored: false
    }
  });
}

async function appendGatewayAuthorizationAuditEvent(params: {
  decision: GatewayAuthorizationDecision;
  actor?: VerifiedUserIdentity;
}): Promise<void> {
  const { decision, actor } = params;
  await appendPlatformAuditEvent({
    tenantId: decision.tenantId,
    actorProvider: actor?.provider,
    actorSubject: actor?.subject,
    actorEmail: actor?.email,
    eventType: decision.effect === "allow" ? AuditEvents.GATEWAY_AUTHORIZATION_EVALUATED : AuditEvents.GATEWAY_AUTHORIZATION_DENIED,
    resourceType: "gateway_authorization",
    resourceId: decision.decisionId,
    safeMetadata: {
      decisionId: decision.decisionId,
      tenantId: decision.tenantId,
      route: decision.route,
      method: decision.method,
      capability: decision.capability,
      effect: decision.effect,
      actorEmail: actor?.email,
      actorRoles: decision.actorRoles,
      requiredRolesAny: decision.requiredRolesAny,
      matchedRole: decision.matchedRole,
      reason: decision.reason,
      protectedMaterialExposed: false,
      tokenMaterialStored: false,
      rawPromptStored: false
    }
  });
}

async function appendConnectorRuntimeAuditEvents(params: {
  connectorRouting: ConnectorRoutingDecision;
  connectorRuntime: ConnectorRuntimeResult;
  actor?: VerifiedUserIdentity;
}): Promise<void> {
  const { connectorRouting, connectorRuntime, actor } = params;
  const tokenMetadata = connectorRuntime.tokenMetadata;
  const connectorId = connectorRuntime.connectorId ?? connectorRouting.connectorId;
  const resourceSystem = connectorRuntime.resourceSystem ?? connectorRouting.resourceSystem;
  const skillId = connectorRuntime.skillId ?? connectorRouting.skillId;

  if (tokenMetadata?.tokenIssued) {
    await appendPlatformAuditEvent({
      actorProvider: tokenMetadata.actorProvider ?? actor?.provider,
      actorSubject: tokenMetadata.actorSubject ?? actor?.subject,
      actorEmail: tokenMetadata.actor ?? actor?.email,
      eventType: AuditEvents.CONNECTOR_RUNTIME_TOKEN_ISSUED,
      resourceType: "connector",
      resourceId: connectorId,
      safeMetadata: {
        connectorId,
        resourceSystem,
        skillId,
        audience: tokenMetadata.audience,
        scope: tokenMetadata.scope,
        actorProvider: tokenMetadata.actorProvider,
        actorIssuer: tokenMetadata.actorIssuer,
        actorSubject: tokenMetadata.actorSubject,
        actorRoles: tokenMetadata.actorRoles,
        tokenIssued: true,
        protectedMaterialExposed: false,
        tokenMaterialStored: false
      }
    });
  }

  const authorizationRequirement = connectorRuntime.authorizationRequirement ?? connectorRuntime.agentResponse?.authorizationRequirement;
  if (authorizationRequirement) {
    await appendPlatformAuditEvent({
      actorProvider: authorizationRequirement.actorProvider ?? tokenMetadata?.actorProvider ?? actor?.provider,
      actorSubject: authorizationRequirement.actorSubject ?? tokenMetadata?.actorSubject ?? actor?.subject,
      actorEmail: tokenMetadata?.actor ?? actor?.email,
      eventType: AuditEvents.CONNECTOR_RUNTIME_AUTHORIZATION_REQUIRED,
      resourceType: "connector",
      resourceId: connectorId,
      safeMetadata: {
        provider: authorizationRequirement.provider,
        resourceSystem: authorizationRequirement.resourceSystem ?? resourceSystem,
        connectorId: authorizationRequirement.connectorId ?? connectorId,
        requestedScopes: authorizationRequirement.requestedScopes,
        actorProvider: authorizationRequirement.actorProvider,
        actorSubject: authorizationRequirement.actorSubject,
        actorEmail: tokenMetadata?.actor ?? actor?.email,
        protectedMaterialExposed: false,
        tokenMaterialStored: false
      }
    });
  }

  await appendPlatformAuditEvent({
    actorProvider: tokenMetadata?.actorProvider ?? actor?.provider,
    actorSubject: tokenMetadata?.actorSubject ?? actor?.subject,
    actorEmail: tokenMetadata?.actor ?? actor?.email,
    eventType: connectorRuntime.executed ? AuditEvents.CONNECTOR_RUNTIME_SUCCEEDED : AuditEvents.CONNECTOR_RUNTIME_FAILED,
    resourceType: "connector",
    resourceId: connectorId,
    safeMetadata: connectorRuntime.executed
      ? {
          connectorId,
          resourceSystem,
          skillId,
          runtimeMode: connectorRuntime.runtimeMode,
          agentId: connectorRuntime.agentResponse?.agentId,
          status: connectorRuntime.agentResponse?.status,
          executionType: connectorRuntime.agentResponse?.runtimeSemantics?.executionType,
          outcome: connectorRuntime.agentResponse?.runtimeSemantics?.outcome,
          diagnosticOnly: connectorRuntime.agentResponse?.runtimeSemantics?.diagnosticOnly,
          writeActionAttempted: connectorRuntime.agentResponse?.runtimeSemantics?.writeActionAttempted,
          targetActionId: connectorRuntime.agentResponse?.runtimeSemantics?.targetActionId,
          targetActionStatus: connectorRuntime.agentResponse?.runtimeSemantics?.targetActionStatus,
          protectedMaterialExposed: false,
          tokenMaterialStored: false
        }
      : {
          connectorId,
          resourceSystem,
          skillId,
          runtimeMode: connectorRuntime.runtimeMode,
          error: connectorRuntime.error,
          errorMessage: connectorRuntime.errorMessage,
          protectedMaterialExposed: false,
          tokenMaterialStored: false
        }
  });
}

function isConnectorAccessPlanningRequest(message: string): boolean {
  return /\b(i need access to|need access|cannot access|can't access|permission|grant access|add me|role request|access request)\b/i.test(message);
}

function planningConnectorTarget(params: {
  message: string;
  connectorRoute?: ConnectorRoutingDecision;
  installedAgents: InstalledTrustedAgents;
}): ConnectorPlanningTargetResolution {
  const { message, connectorRoute, installedAgents } = params;
  const normalized = message.toLowerCase();
  const planningAgents = installedAgents.filter((agent) => agent.connectorProfile?.planning?.supported === true);
  const intentClasses = detectedPlanningIntentClasses(message);

  if (!planningAgents.length) {
    return {
      strategy: "not_supported",
      detectedIntentClasses: intentClasses,
      reason: "No installed connector advertises safe action planning support."
    };
  }

  const explicitMatch = planningAgents.find((agent) => {
    const connectorId = agent.connectorId ?? agent.connectorProfile?.connectorId ?? "";
    const resourceSystem = agent.resourceSystem ?? agent.connectorProfile?.resourceSystem ?? "";
    const displayName = agent.connectorProfile?.displayName ?? "";
    const explicitTerms = [
      connectorId,
      connectorId.replace("-reference", ""),
      resourceSystem,
      displayName
    ].map((term) => term.toLowerCase()).filter(Boolean);
    return explicitTerms.some((term) => normalized.includes(term));
  });

  if (explicitMatch) {
    const connectorId = explicitMatch.connectorId ?? explicitMatch.connectorProfile?.connectorId;
    const resourceSystem = explicitMatch.resourceSystem ?? explicitMatch.connectorProfile?.resourceSystem;
    return {
      strategy: "explicit_connector_mention",
      detectedIntentClasses: intentClasses,
      selectedConnectorId: connectorId,
      selectedResourceSystem: resourceSystem,
      reason: "The user explicitly mentioned the target connector or resource system."
    };
  }

  const routedTarget = [
    connectorRoute?.connectorId,
    connectorRoute?.resourceSystem,
    connectorRoute?.targetSystem
  ].map((term) => term?.toLowerCase()).filter((term): term is string => Boolean(term));
  const routedMatch = routedTarget.length
    ? planningAgents.find((agent) => {
        const connectorId = agent.connectorId ?? agent.connectorProfile?.connectorId ?? "";
        const resourceSystem = agent.resourceSystem ?? agent.connectorProfile?.resourceSystem ?? "";
        const displayName = agent.connectorProfile?.displayName ?? "";
        const terms = [connectorId, connectorId.replace("-reference", ""), resourceSystem, displayName]
          .map((term) => term.toLowerCase())
          .filter(Boolean);
        return routedTarget.some((target) => terms.includes(target));
      })
    : undefined;

  if (routedMatch) {
    const supportedIntentClasses = routedMatch.connectorProfile?.planning?.supportedIntentClasses ?? [];
    const hasSupportedIntent = intentClasses.some((intentClass) => supportedIntentClasses.includes(intentClass));
    const connectorId = routedMatch.connectorId ?? routedMatch.connectorProfile?.connectorId;
    const resourceSystem = routedMatch.resourceSystem ?? routedMatch.connectorProfile?.resourceSystem;
    return {
      strategy: hasSupportedIntent ? "supported_intent_class_match" : "ai_routing_target_match",
      detectedIntentClasses: intentClasses,
      selectedConnectorId: connectorId,
      selectedResourceSystem: resourceSystem,
      reason: hasSupportedIntent
        ? "The target system was clear and the connector supports the detected planning intent class."
        : "Routing detected a clear target system that matched an installed planning connector."
    };
  }

  return {
    strategy: "needs_clarification",
    detectedIntentClasses: intentClasses,
    reason: "The user did not specify the target system/application."
  };
}

function detectedPlanningIntentClasses(message: string): string[] {
  const normalized = message.toLowerCase();
  return [
    /\b(access|cannot access|can't access|grant access|access request)\b/.test(normalized) ? "access_request" : undefined,
    /\b(permission|permissions)\b/.test(normalized) ? "permission_request" : undefined,
    /\b(role|roles)\b/.test(normalized) ? "role_request" : undefined,
    /\b(project|projects)\b/.test(normalized) ? "project_access" : undefined
  ].filter((item): item is string => Boolean(item));
}

function isConnectorPlanningCandidate(params: {
  message: string;
  connectorRoute?: ConnectorRoutingDecision;
  installedAgents: InstalledTrustedAgents;
}): boolean {
  if (params.connectorRoute?.fulfillmentCapability) {
    return false;
  }
  return isConnectorAccessPlanningRequest(params.message);
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
            roles: [...params.actor.roles],
            provider: params.actor.provider,
            issuer: params.actor.issuer,
            subject: params.actor.subject
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
      ...a2aJsonRequestHeaders(),
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
    actorRoles: params.task.context.actor?.roles,
    actorProvider: params.task.context.actor?.provider,
    actorIssuer: params.task.context.actor?.issuer,
    actorSubject: params.task.context.actor?.subject
  });
  params.task.context.authMode = "oauth2_client_credentials_jwt";
  params.task.context.auth = {
    ...issued.metadata,
    authMode: "oauth2_client_credentials_jwt",
    actorProvider: issued.metadata.actorProvider,
    actorIssuer: issued.metadata.actorIssuer,
    actorSubject: issued.metadata.actorSubject
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
    ...a2aJsonRequestHeaders(),
    authorization: `Bearer ${issued.accessToken}`
  };
}

function normalizeAgentResponse(agentId: AgentName, response: AgentResponse | A2AAgentResponse | OgenA2AOutboundTaskEnvelope): A2AAgentResponse {
  const taskEnvelopeValidation = validateOgenA2AOutboundTaskEnvelope(response);
  if (taskEnvelopeValidation.ok) {
    return outboundA2AEnvelopeToAgentResponse(agentId, taskEnvelopeValidation.value);
  }

  const responseRecord = objectRecord(response);
  if (responseRecord && (responseRecord.kind === "task" || responseRecord.type === "task")) {
    return {
      agentId,
      status: "error",
      summary: taskEnvelopeValidation.response.error,
      probableCause: taskEnvelopeValidation.response.message,
      trace: [
        {
          agent: "orchestrator",
          action: "invalid_a2a_task_envelope",
          detail: taskEnvelopeValidation.response.message,
          timestamp: new Date().toISOString()
        }
      ]
    };
  }

  if ("agentId" in response && "status" in response) {
    return response;
  }

  const legacyResponse = response as AgentResponse;
  const legacyEvidence = Array.isArray(legacyResponse.evidence) ? legacyResponse.evidence : [];
  return {
    agentId,
    status: legacyEvidence.length > 0 ? "diagnosed" : "unsupported",
    summary: legacyEvidence[0]?.title ?? "Agent returned legacy evidence.",
    evidence: legacyEvidence.map((item) => ({ title: item.title, data: item.data })),
    trace: legacyResponse.trace
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

function mockIdentityProviderIssuer(): string {
  return process.env.A2A_ISSUER ?? (process.env.A2A_IDP_URL ?? "http://localhost:4110");
}

function mockIdentityProviderJwksUri(): string {
  return process.env.A2A_JWKS_URI ?? `${process.env.A2A_IDP_URL ?? "http://localhost:4110"}/.well-known/jwks.json`;
}

function safeTrustUrl(value: string, adminView = false): string {
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

    if (process.env.NODE_ENV === "production" && !adminView) {
      return internalHost ? "internal endpoint" : `${url.protocol}//${url.host}/...`;
    }

    return internalHost ? `${url.pathname}${url.search}` : url.toString();
  } catch {
    return "unknown";
  }
}

function buildTrustStatus(sessionToken?: string, adminView = false) {
  const userIdentity = publicIdentitySession(userIdentityProvider, currentUserIdentity(sessionToken));

  return {
    userIdentity: {
      ...userIdentity,
      rawTokenExposed: false
    },
    userIdentityProvider: {
      provider: userIdentityProvider.name,
      issuer: userIdentityProvider.issuer,
      audience: userIdentityProvider.audience,
      jwksUri: safeTrustUrl(userIdentityProvider.jwksUri, adminView),
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
      issuer: mockIdentityProviderIssuer(),
      jwksUri: safeTrustUrl(mockIdentityProviderJwksUri(), adminView),
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
  const headers: Record<string, string> = { "content-type": "application/json" };
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN?.trim();
  if (internalToken) {
    headers["x-internal-service-token"] = internalToken;
  } else if (process.env.NODE_ENV === "production") {
    throw new Error("internal_service_token_not_configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), demoUserTokenTimeoutMs);
  let response: Response;
  let body: { accessToken?: unknown; error?: unknown };
  try {
    response = await fetch(mockIdentityProviderDemoUserTokenUrl(), {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers,
      body: JSON.stringify({ email })
    });
    body = await response.json() as { accessToken?: unknown; error?: unknown };
  } catch {
    throw new Error("demo_user_token_failed");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "demo_user_token_failed");
  }

  if (typeof body.accessToken !== "string" || !body.accessToken) {
    throw new Error("demo_user_token_missing");
  }

  return { accessToken: body.accessToken };
}

function privateOrLinkLocalHealthHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [first, second] = ipv4.slice(1).map((part) => Number(part));
    return first === 0 ||
      first === 10 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168);
  }
  return normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:");
}

function safeAgentHealthEndpoint(endpoint: string): { ok: true; url: string } | { ok: false; error: string } {
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.toLowerCase();
    const localhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    if (url.username || url.password) {
      return { ok: false, error: "Health endpoint credentials are not allowed." };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, error: "Health endpoint uses an unsafe scheme." };
    }
    if (privateOrLinkLocalHealthHost(hostname) && !localhost) {
      return { ok: false, error: "Health endpoint host is not allowed." };
    }
    if (url.protocol === "http:" && !localhost) {
      return { ok: false, error: "Health endpoint must use HTTPS outside local development." };
    }
    if (localhost && process.env.NODE_ENV === "production") {
      return { ok: false, error: "Localhost health endpoints are disabled in production." };
    }
    return { ok: true, url: url.toString() };
  } catch {
    return { ok: false, error: "Health endpoint is invalid." };
  }
}

async function checkAgentHealth(card: ReturnType<typeof getExecutableAgentCards>[number]): Promise<AgentHealthCheck> {
  const checkedAt = new Date().toISOString();
  const healthUrl = endpointForPath(card.endpoint, "/health");
  const safeHealth = safeAgentHealthEndpoint(healthUrl);
  if (!safeHealth.ok) {
    return {
      agentId: card.agentId,
      endpointType: "unknown",
      status: "down",
      latencyMs: 0,
      checkedAt,
      details: {
        healthEndpoint: "/health",
        agentCardAvailable: Boolean(getAgentCard(card.agentId))
      },
      error: safeHealth.error
    };
  }
  const trustedAgentCard = getAgentCard(card.agentId);
  const trustedHealthUrl = trustedAgentCard ? endpointForPath(trustedAgentCard.endpoint, "/health") : healthUrl;
  if (healthUrl !== trustedHealthUrl) {
    return {
      agentId: card.agentId,
      endpointType: "unknown",
      status: "down",
      latencyMs: 0,
      checkedAt,
      details: {
        healthEndpoint: "/health",
        agentCardAvailable: Boolean(trustedAgentCard)
      },
      error: "Health endpoint is not trusted for this agent."
    };
  }
  const startTime = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(healthUrl, { redirect: "error", signal: controller.signal });
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
        error: `Health endpoint returned ${response.status}`
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
      error: status === "degraded" ? "Unexpected health payload." : undefined
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
      error: "Health check failed."
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
        error: `Health endpoint returned ${response.status}`
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
      error: status === "degraded" ? "Unexpected health payload." : undefined
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
      error: "Health check failed."
    };
  } finally {
    clearTimeout(timeout);
  }
}

function requireSessionToken(request: IncomingMessage, response: ServerResponse): string | undefined {
  cleanupExpiredUserIdentities();
  const token = getSessionToken(request);
  if (!token) {
    sendJson(response, 401, { error: "Session required" }, request);
    return undefined;
  }
  return token;
}

function requireIdentitySession(request: IncomingMessage, response: ServerResponse): { sessionToken: string; identity: VerifiedUserIdentity } | undefined {
  const sessionToken = requireSessionToken(request, response);
  if (!sessionToken) {
    return undefined;
  }

  const identity = currentUserIdentity(sessionToken);
  if (!identity) {
    sendJson(response, 401, {
      error: "identity_session_required"
    }, request);
    return undefined;
  }

  return { sessionToken, identity };
}

async function requireFreshIdentitySession(
  request: IncomingMessage,
  response: ServerResponse
): Promise<FreshIdentitySession | undefined> {
  const identitySession = requireIdentitySession(request, response);
  if (!identitySession) {
    return undefined;
  }

  const tenantContext = tenantContextForRequest(identitySession.identity);
  const directoryAccess = await verifyUserDirectoryAccess({
    identity: identitySession.identity,
    tenantId: tenantContext.tenantId
  });

  if (!directoryAccess.ok) {
    userIdentitiesBySession.delete(identitySession.sessionToken);
    await appendIdentityDeniedAuditEvent(identitySession.identity, directoryAccess.reason, tenantContext);
    sendJson(response, directoryAccess.status, {
      error: "user_directory_access_denied",
      message: directoryAccess.message
    }, request);
    return undefined;
  }

  const allowedIdentity = identityWithDirectoryRoles(identitySession.identity, directoryAccess.user.roles);
  userIdentitiesBySession.set(identitySession.sessionToken, allowedIdentity);

  return {
    sessionToken: identitySession.sessionToken,
    identity: allowedIdentity,
    tenantContext,
    gatewayRoles: directoryAccess.user.roles
  };
}

async function requireGatewayCapability(params: {
  request: IncomingMessage;
  response: ServerResponse;
  identitySession?: FreshIdentitySession;
  capability: GatewayCapability;
  route: string;
  method: string;
}): Promise<boolean> {
  const { request, response, identitySession, capability, route, method } = params;
  const tenantContext = identitySession?.tenantContext ?? tenantContextForRequest(identitySession?.identity);
  const source = identitySession
    ? "browser_session"
    : hasValidClientApiKey(request)
      ? "api_key"
      : shouldBypassCsrfForTrustedInternalRequest(request)
        ? "internal_service_token"
        : "browser_session";
  const actor = identitySession?.identity;
  const decision = evaluateGatewayAuthorization({
    tenantId: tenantContext.tenantId,
    capability,
    route,
    method,
    actor: actor
      ? {
          provider: actor.provider,
          issuer: actor.issuer,
          subject: actor.subject,
          email: actor.email,
          roles: identitySession.gatewayRoles
        }
      : undefined,
    source
  });

  await appendGatewayAuthorizationAuditEvent({ decision, actor });
  if (isGatewayAuthorized(decision)) {
    return true;
  }

  sendJson(response, 403, {
    error: "gateway_authorization_denied",
    message: "This user is not allowed to perform this Ogen gateway operation.",
    capability: decision.capability,
    requiredRolesAny: decision.requiredRolesAny
  }, request);
  return false;
}

async function requireIdentityOrAdminAccess(
  request: IncomingMessage,
  response: ServerResponse
): Promise<{ kind: "admin" } | ({ kind: "identity" } & FreshIdentitySession) | undefined> {
  if (hasValidClientApiKey(request)) {
    return { kind: "admin" };
  }

  const identitySession = await requireFreshIdentitySession(request, response);
  if (!identitySession) {
    return undefined;
  }

  return {
    kind: "identity",
    sessionToken: identitySession.sessionToken,
    identity: identitySession.identity,
    tenantContext: identitySession.tenantContext,
    gatewayRoles: identitySession.gatewayRoles
  };
}

function currentUserIdentity(sessionToken?: string): VerifiedUserIdentity | undefined {
  cleanupExpiredUserIdentities();
  return sessionToken ? userIdentitiesBySession.get(sessionToken) : undefined;
}

function cleanupExpiredUserIdentities(): void {
  for (const expiredSessionToken of cleanupExpiredSessions()) {
    userIdentitiesBySession.delete(expiredSessionToken);
  }
}

function safeUserIdentity(sessionToken?: string): UserIdentitySummary {
  return userIdentityProvider.publicIdentity(currentUserIdentity(sessionToken));
}

function cleanRuntimeProofString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function connectorRuntimeToolMappingProofBound(decision: ConnectorRoutingDecision): boolean {
  const proof = decision.toolMappingProof;
  if (!proof) {
    return false;
  }

  const skillId = cleanRuntimeProofString(decision.skillId);
  const routeResourceSystem = cleanRuntimeProofString(decision.resourceSystem);
  const actionResourceSystem = cleanRuntimeProofString(decision.actionResourceSystem);
  const provider = cleanRuntimeProofString(decision.provider);
  const proofToolId = cleanRuntimeProofString(proof?.toolId);
  const proofProvider = cleanRuntimeProofString(proof?.provider);
  const proofResourceSystem = cleanRuntimeProofString(proof?.resourceSystem);

  return decision.toolMappingStatus === "mapped" &&
    runtimeToolSourceTypes.has(proof.sourceType) &&
    typeof proof.sourceId === "string" &&
    proof.sourceId.trim().length > 0 &&
    proofToolId === skillId &&
    provider !== undefined &&
    actionResourceSystem !== undefined &&
    proofProvider !== undefined &&
    proofResourceSystem !== undefined &&
    routeResourceSystem !== undefined &&
    proofResourceSystem === routeResourceSystem &&
    proofResourceSystem === actionResourceSystem &&
    proofProvider === provider &&
    proof.deterministicMapping === true &&
    proof.aiInferred === false &&
    proof.rawDescriptionStored === false &&
    proof.protectedMaterialExposed === false;
}

function connectorRoutingWithProofBindingStatus(decision: ConnectorRoutingDecision): ConnectorRoutingDecision {
  if (
    decision.status !== "connector_skill_approved" ||
    decision.toolMappingStatus !== "mapped" ||
    connectorRuntimeToolMappingProofBound(decision)
  ) {
    return decision;
  }

  return {
    ...decision,
    status: "connector_skill_blocked",
    runtimeMode: "not_available",
    reason: "Tool-to-action mapping proof is not bound to the requested connector action and trusted route/resource.",
    recommendedNextStep: "Update the connector profile or reference action metadata so the mapping proof toolId, provider, and resource system match the requested connector action before runtime execution."
  };
}

function canExecuteConnectorRuntime(decision: ConnectorRoutingDecision, policy: ConnectorPolicyEvaluation): boolean {
  return decision.status === "connector_skill_approved" &&
    decision.toolMappingStatus === "mapped" &&
    connectorRuntimeToolMappingProofBound(decision) &&
    decision.runtimeMode === "external_runtime_available" &&
    policy.effect === "allow" &&
    decision.requiresApproval !== true;
}

function missingActionRiskMetadata(policy: ConnectorPolicyEvaluation): boolean {
  return policy.primaryRuleId === "block-missing-action-risk-metadata" ||
    policy.matchedRuleIds.includes("block-missing-action-risk-metadata");
}

function connectorPolicyFinalAnswer(decision: ConnectorRoutingDecision, policy: ConnectorPolicyEvaluation): string | undefined {
  const skill = decision.skillLabel ?? decision.skillId ?? "requested connector skill";
  if (decision.toolMappingStatus && decision.toolMappingStatus !== "mapped") {
    return [
      "BLOCKED",
      "Ogen could not execute this connector action because tool-to-action metadata mapping did not produce a mapped action.",
      "",
      "Reason:",
      `Mapping status was ${decision.toolMappingStatus}; runtime execution requires explicit deterministic provider, resource system, taxonomy, grants, permissions, and scope metadata.`,
      "",
      "No runtime token was issued. No external connector runtime was called.",
      "",
      "Next step:",
      "Update the connector profile or reference action metadata, then retry."
    ].join("\n");
  }
  if (decision.toolMappingStatus === "mapped" && !connectorRuntimeToolMappingProofBound(decision)) {
    return [
      "BLOCKED",
      "Ogen could not execute this connector action because the tool-to-action mapping proof is not bound to the requested action and trusted route/resource.",
      "",
      "Reason:",
      "Runtime execution requires mapping proof with the same tool ID, provider, and resource system as the approved connector route.",
      "",
      "No runtime token was issued. No external connector runtime was called.",
      "",
      "Next step:",
      "Update the connector profile or reference action metadata, then retry."
    ].join("\n");
  }
  if (policy.effect === "needs_approval") {
    return `Approval required: Gateway policy stopped ${skill} before runtime execution. ${policy.reason} No runtime token was issued and no external connector runtime was called.`;
  }
  if (policy.effect === "block") {
    if (missingActionRiskMetadata(policy)) {
      return [
        "BLOCKED",
        "Ogen could not execute this connector action because the connector action metadata is incomplete.",
        "",
        "Reason:",
        "This action is missing explicit execution type or risk classification, so Ogen failed closed instead of guessing that it is safe.",
        "",
        "No runtime token was issued. No external connector runtime was called.",
        "",
        "Next step:",
        "Update the connector profile or reference action metadata, then retry."
      ].join("\n");
    }
    return `Blocked by Gateway policy: ${skill} was not executed. ${policy.reason} No runtime token was issued and no external connector runtime was called.`;
  }
  return undefined;
}

function agentCardRegistryKey(request: IncomingMessage, response: ServerResponse, options?: { requireIdentity?: boolean }): string | undefined {
  const sessionToken = getSessionToken(request);
  if (sessionToken) {
    if (options?.requireIdentity && !currentUserIdentity(sessionToken)) {
      sendJson(response, 401, { error: "identity_session_required" }, request);
      return undefined;
    }
    return sessionToken;
  }

  const apiKey = clientApiKey(request);
  if (apiKey && process.env.ORCHESTRATOR_API_KEY && apiKey === process.env.ORCHESTRATOR_API_KEY) {
    return `api:${createHash("sha256").update(apiKey).digest("hex")}`;
  }

  sendJson(response, 401, { error: "Unauthorized" }, request);
  return undefined;
}

async function agentCardRegistryKeyForIdentityOrAdmin(request: IncomingMessage, response: ServerResponse): Promise<string | undefined> {
  const apiKey = clientApiKey(request);
  if (apiKey && process.env.ORCHESTRATOR_API_KEY && apiKey === process.env.ORCHESTRATOR_API_KEY) {
    return `api:${createHash("sha256").update(apiKey).digest("hex")}`;
  }

  const identitySession = await requireFreshIdentitySession(request, response);
  return identitySession?.sessionToken;
}

async function prepareEndUserDemoEnvironment(ownerKey: string): Promise<{
  ok: boolean;
  installedAgents: InstalledTrustedAgents;
  prepared: string[];
  skipped: string[];
  errors: string[];
}> {
  const existing = await listTrustedOnboardedAgentsForOwner(ownerKey);
  const prepared: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const connector of endUserDemoConnectorRequests) {
    const alreadyInstalled = (await listTrustedOnboardedAgentsForOwner(ownerKey)).some((agent) =>
      agent.connectorId === connector.expectedConnectorId ||
      agent.connectorProfile?.connectorId === connector.expectedConnectorId ||
      agent.resourceSystem === connector.expectedResourceSystem ||
      agent.connectorProfile?.resourceSystem === connector.expectedResourceSystem
    );
    if (alreadyInstalled) {
      skipped.push(connector.expectedConnectorId);
      continue;
    }

    const result = await startAgentOnboarding(ownerKey, connector);
    if ("error" in result) {
      errors.push(`${connector.expectedConnectorId}: ${result.details.join(" ")}`);
      continue;
    }
    prepared.push(connector.expectedConnectorId);
  }

  const installedAgents = await listTrustedOnboardedAgentsForOwner(ownerKey);
  return {
    ok: errors.length === 0 && installedAgents.length >= existing.length,
    installedAgents,
    prepared,
    skipped,
    errors
  };
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

async function resolveIssue(requestBody: ResolveRequest, sessionToken?: string, tenantContext = tenantContextForRequest(currentUserIdentity(sessionToken))): Promise<ResolveResponse> {
  const verifiedUser = currentUserIdentity(sessionToken);
  const conversationOwner = conversationOwnerContext({ sessionToken, actor: verifiedUser, tenantId: tenantContext.tenantId });
  const conversationState = getOrCreateConversationState(requestBody.conversationId, conversationOwner);
  const conversationId = conversationState.conversationId;
  const responseUserIdentity = safeUserIdentity(sessionToken);
  const requestAgentCards = getExecutableAgentCards();
  const installedAgents = sessionToken ? await listTrustedOnboardedAgentsForOwner(sessionToken) : [];
  appendConversationMessage(conversationState, "user", requestBody.message);
  const earlySecurityIntent = detectAdversarialIntent(requestBody.message);
  let activePendingInteraction = conversationState.pendingInteraction;
  if (
    activePendingInteraction &&
    (pendingInteractionExpired(activePendingInteraction) || !pendingInteractionMatchesResolvedOwner({
      pending: activePendingInteraction,
      conversationState,
      tenantContext,
      actor: verifiedUser
    }))
  ) {
    conversationState.pendingInteraction = undefined;
    activePendingInteraction = undefined;
  }
  const pendingInteractionResolution = activePendingInteraction
    ? await resolvePendingInteraction({
        pendingInteraction: activePendingInteraction,
        userMessage: requestBody.message,
        securityIntent: earlySecurityIntent
      })
    : undefined;

  const finalizeEarly = (response: Omit<ResolveResponse, "userIdentity">): ResolveResponse => {
    const userIdentityTrace = verifiedUser
      ? [
          executionStep(
            "orchestrator",
            "user_identity_verified",
            `Verified ${verifiedUser.provider} user ${verifiedUser.email}; actor context attached to gateway session.`
          )
        ]
      : [];
    const finalResponse: ResolveResponse = {
      ...response,
      conversationId,
      userIdentity: responseUserIdentity,
      executionTrace: [...userIdentityTrace, ...response.executionTrace]
    };
    updateConversationState(conversationState, finalResponse);
    void persistConversationStateSnapshot({
      state: conversationState,
      actor: verifiedUser,
      response: finalResponse
    });
    return finalResponse;
  };

  if (activePendingInteraction?.type === "missing_input" && pendingInteractionResolution?.relation === "unrelated_new_request") {
    conversationState.pendingInteraction = undefined;
  } else if (activePendingInteraction?.type === "missing_input" && pendingInteractionResolution?.relation === "cancel") {
    const state = pendingGovernedPlanningState(activePendingInteraction) ?? {
      targetResourceSystem: pendingString(activePendingInteraction.context, "targetResourceSystem") ?? "connector",
      targetResourceName: pendingString(activePendingInteraction.context, "targetResourceName") ?? "target",
      missingInputs: pendingStringArray(activePendingInteraction.context, "missingInputs")
    };
    return finalizeEarly({
      conversationId,
      finalAnswer: "CANCELLED\nI stopped the pending planning flow.\nNo changes were made.\nNo request was submitted.",
      classification: governedPlanningClassification(state.targetResourceSystem),
      selectedAgents: [],
      skippedAgents: [],
      routingSource: governedPlanningRoutingSource(state),
      routingConfidence: governedPlanningRoutingConfidence(state),
      routingReasoningSummary: "User cancelled governed pending planning state before new routing.",
      resolutionStatus: "resolved",
      evidence: [
        governedPlanningEvidence({
          state,
          pendingInteractionId: activePendingInteraction.id,
          pendingInteractionResumed: false
        })
      ],
      agentTrace: [
        trace("pending_planning_cancelled", pendingInteractionResolution.reason)
      ],
      executionTrace: [
        executionStep("user", "submit_issue", requestBody.message),
        executionStep("orchestrator", "resolve_pending_interaction", pendingInteractionResolution.reason),
        executionStep("orchestrator", "cancel_pending_planning", "Cleared governed pending planning state without submission or runtime execution."),
        executionStep("orchestrator", "skip_runtime_execution", "No runtime token was issued and no external connector runtime was called.")
      ],
      securityDecisions: [],
      requestInterpretation: governedPlanningInterpretation(state),
      pendingInteractionResolution,
      executionGateStack: governedPlanningGateStack({
        finalOutcome: "needs_more_info",
        stoppedAt: "gateway_governance",
        gatewayReason: "User cancelled the pending planning interaction; Gateway took no runtime action."
      }),
      a2aTasks: [],
      a2aResponses: [],
      diagnosis: {
        probableCause: "Pending governed planning flow was cancelled",
        recommendedFix: "Start a new request when you are ready."
      }
    });
  } else if (activePendingInteraction?.type === "missing_input" && (pendingInteractionResolution?.relation === "adversarial_attempt" || pendingInteractionResolution?.securityConcern)) {
    const state = pendingGovernedPlanningState(activePendingInteraction) ?? {
      targetResourceSystem: pendingString(activePendingInteraction.context, "targetResourceSystem") ?? "connector",
      targetResourceName: pendingString(activePendingInteraction.context, "targetResourceName") ?? "target",
      missingInputs: pendingStringArray(activePendingInteraction.context, "missingInputs")
    };
    await appendSecurityBlockedAuditEvent({
      actor: verifiedUser,
      category: earlySecurityIntent.category ?? "adversarial_or_governance_bypass",
      reason: earlySecurityIntent.detected ? earlySecurityIntent.reason : pendingInteractionResolution.reason,
      finalOutcome: "blocked_at_gateway"
    });
    return finalizeEarly({
      conversationId,
      finalAnswer: "BLOCKED\nI cannot use follow-up text to bypass approval, policy, identity, tenant, or connector controls.\nNo changes were made.\nNo request was submitted.",
      classification: governedPlanningClassification(state.targetResourceSystem),
      selectedAgents: [],
      skippedAgents: [],
      routingSource: governedPlanningRoutingSource(state),
      routingConfidence: governedPlanningRoutingConfidence(state),
      routingReasoningSummary: "Blocked adversarial pending planning follow-up before new routing.",
      resolutionStatus: "resolved",
      evidence: [
        governedPlanningEvidence({
          state,
          pendingInteractionId: activePendingInteraction.id,
          pendingInteractionResumed: false
        })
      ],
      agentTrace: [
        trace("pending_planning_adversarial_blocked", pendingInteractionResolution.reason)
      ],
      executionTrace: [
        executionStep("user", "submit_issue", requestBody.message),
        executionStep("orchestrator", "resolve_pending_interaction", pendingInteractionResolution.reason),
        executionStep("orchestrator", "block_at_gateway_governance", "Follow-up attempted to bypass governed controls."),
        executionStep("orchestrator", "skip_runtime_execution", "No runtime token was issued and no external connector runtime was called.")
      ],
      securityDecisions: [],
      requestInterpretation: governedPlanningInterpretation(state),
      securityIntent: earlySecurityIntent.detected ? earlySecurityIntent : {
        detected: true,
        category: "policy_bypass_attempt",
        reason: pendingInteractionResolution.reason
      },
      pendingInteractionResolution,
      executionGateStack: governedPlanningGateStack({
        finalOutcome: "blocked_at_gateway",
        stoppedAt: "gateway_governance",
        gatewayReason: "Gateway blocked the pending planning follow-up because it attempted to bypass governed controls."
      }),
      a2aTasks: [],
      a2aResponses: [],
      diagnosis: {
        probableCause: "Governance bypass attempt in pending planning follow-up",
        recommendedFix: "Use normal approved request and review steps. Prompt text cannot grant permissions or bypass policy."
      }
    });
  } else if (
    activePendingInteraction?.type === "missing_input" &&
    pendingInteractionResolution &&
    (pendingInteractionResolution.relation === "provide_missing_input" ||
      pendingInteractionResolution.relation === "ask_question" ||
      pendingInteractionResolution.relation === "unclear")
  ) {
    const merged = pendingInteractionResolution.relation === "provide_missing_input"
      ? mergeGovernedPlanningInputs({ pending: activePendingInteraction, resolution: pendingInteractionResolution })
      : undefined;
    const state = merged?.state ?? pendingGovernedPlanningState(activePendingInteraction);
    if (state) {
      const remainingInputs = state.missingInputs;
      if (remainingInputs.length) {
        const updatedPendingInteraction: PendingInteraction = {
          ...activePendingInteraction,
          context: {
            ...activePendingInteraction.context,
            intentType: state.intentType,
            intentSource: state.intentSource,
            intentConfidence: state.intentConfidence,
            connectorId: state.connectorId,
            resourceSystem: state.resourceSystem,
            targetResourceSystem: state.targetResourceSystem,
            targetResourceType: state.targetResourceType,
            targetResourceName: state.targetResourceName,
            requestedAccessLevel: state.requestedAccessLevel,
            businessReason: state.businessReason,
            missingInputs: remainingInputs,
            collectedInputs: governedPlanningCollectedInputs(state),
            inputSchema: activePendingInteraction.context.inputSchema ?? governedPlanningInputSchema(),
            inputHints: activePendingInteraction.context.inputHints ?? {
              expectedSlots: ["targetResourceName", "accessLevel", "businessReason"],
              cancellationPhrases: ["cancel", "never mind", "stop", "forget it", "don't continue"],
              confirmationPhrases: []
            },
            rawPromptStored: false,
            tokenMaterialStored: false,
            protectedMaterialExposed: false
          }
        };
        return finalizeEarly({
          conversationId,
          finalAnswer: [
            "NEEDS MORE INFO",
            governedPlanningQuestion(remainingInputs),
            "",
            governedPlanningTargetLine(state),
            state.requestedAccessLevel ? `Access level: ${state.requestedAccessLevel}.` : undefined,
            state.businessReason ? `Business reason: ${state.businessReason}.` : undefined,
            "",
            "No changes were made.",
            "No request was submitted."
          ].filter((line): line is string => line !== undefined).join("\n"),
          classification: governedPlanningClassification(state.targetResourceSystem),
          selectedAgents: [],
          skippedAgents: [],
          routingSource: governedPlanningRoutingSource(state),
          routingConfidence: governedPlanningRoutingConfidence(state),
          routingReasoningSummary: "Pending governed planning state was resumed and still needs remaining inputs.",
          resolutionStatus: "needs_more_info",
          evidence: [
            governedPlanningEvidence({
              state,
              pendingInteractionId: activePendingInteraction.id,
              pendingInteractionResumed: true,
              missingInputsCollected: merged?.collectedInputs
            })
          ],
          agentTrace: [
            trace("pending_planning_resumed", pendingInteractionResolution.reason),
            trace("pending_planning_needs_more_info", `Remaining inputs: ${remainingInputs.join(", ")}`)
          ],
          executionTrace: [
            executionStep("user", "submit_issue", requestBody.message),
            executionStep("orchestrator", "resolve_pending_interaction", pendingInteractionResolution.reason),
            executionStep("orchestrator", "collect_missing_planning_inputs", `Collected: ${(merged?.collectedInputs ?? []).join(", ") || "none"}. Remaining: ${remainingInputs.join(", ")}.`),
            executionStep("orchestrator", "skip_runtime_execution", "No request was submitted, no runtime token was issued, and no external connector runtime was called.")
          ],
          securityDecisions: [],
          requestInterpretation: governedPlanningInterpretation(state),
          pendingInteraction: updatedPendingInteraction,
          pendingInteractionResolution,
          executionGateStack: governedPlanningGateStack({
            finalOutcome: "needs_more_info",
            stoppedAt: "gateway_governance",
            gatewayReason: "Gateway resumed pending planning state and asked only for remaining planning inputs."
          }),
          a2aTasks: [],
          a2aResponses: [],
          diagnosis: {
            probableCause: "Governed connector planning still needs missing inputs",
            recommendedFix: governedPlanningQuestion(remainingInputs)
          }
        });
      }

      return finalizeEarly({
        conversationId,
        finalAnswer: [
          "PLANNING READY",
          `I continued the planning flow for ${state.targetResourceSystem} ${state.targetResourceName ?? "target"} ${state.requestedAccessLevel ?? "requested"} access.`,
          state.businessReason ? `Business reason: ${state.businessReason}.` : undefined,
          "",
          "No changes were made.",
          "No request was submitted.",
          "This is ready for review/approval/request submission in a later step."
        ].filter((line): line is string => line !== undefined).join("\n"),
        classification: governedPlanningClassification(state.targetResourceSystem),
        selectedAgents: [],
        skippedAgents: [],
        routingSource: governedPlanningRoutingSource(state),
        routingConfidence: governedPlanningRoutingConfidence(state),
        routingReasoningSummary: "Pending governed planning state resumed before new routing and collected all required inputs.",
        resolutionStatus: "needs_more_info",
        evidence: [
          governedPlanningEvidence({
            state,
            pendingInteractionId: activePendingInteraction.id,
            pendingInteractionResumed: true,
            missingInputsCollected: merged?.collectedInputs
          })
        ],
        agentTrace: [
          trace("pending_planning_resumed", pendingInteractionResolution.reason),
          trace("pending_planning_ready", "All required planning inputs were collected without submission or runtime execution.")
        ],
        executionTrace: [
          executionStep("user", "submit_issue", requestBody.message),
          executionStep("orchestrator", "resolve_pending_interaction", pendingInteractionResolution.reason),
          executionStep("orchestrator", "collect_missing_planning_inputs", `Collected: ${(merged?.collectedInputs ?? []).join(", ") || "none"}.`),
          executionStep("orchestrator", "complete_planning_without_submission", "Planning inputs are complete. No request was submitted."),
          executionStep("orchestrator", "skip_runtime_execution", "runtimeExecution.executed=false; runtimeExecution.runtimeTokenIssued=false; runtimeExecution.externalRuntimeCalled=false.")
        ],
        securityDecisions: [],
        requestInterpretation: governedPlanningInterpretation(state),
        pendingInteractionResolution,
        executionGateStack: governedPlanningGateStack({
          finalOutcome: "planned",
          stoppedAt: "runtime_execution",
          gatewayReason: "Gateway resumed tenant/user/conversation-scoped planning state and completed planning without submission."
        }),
        a2aTasks: [],
        a2aResponses: [],
        diagnosis: {
          probableCause: "Governed connector planning inputs are complete",
          recommendedFix: "Review the plan and submit through a governed approval/request flow later."
        }
      });
    }
    conversationState.pendingInteraction = undefined;
  }

  if (!earlySecurityIntent.detected) {
    const initialAccessIntent = await interpretGovernedAccessIntent({
      message: requestBody.message,
      installedAgents,
      previousInterpretation: conversationState.lastRequestInterpretation
    });
    const initialPlanningState = initialGovernedPlanningState({ intent: initialAccessIntent, installedAgents });
    if (initialPlanningState) {
      const pendingInteraction = initialPlanningState.missingInputs.length
        ? buildGovernedPlanningPendingInteraction({
            originalUserRequest: requestBody.message,
            tenantContext,
            conversationState,
            actor: verifiedUser,
            state: initialPlanningState
          })
        : undefined;
      return finalizeEarly({
        conversationId,
        finalAnswer: initialPlanningState.missingInputs.length
          ? [
              "NEEDS MORE INFO",
              governedPlanningQuestion(initialPlanningState.missingInputs),
              "",
              governedPlanningTargetLine(initialPlanningState),
              "",
              "No changes were made.",
              "No request was submitted."
            ].join("\n")
          : [
              "PLANNING READY",
              `I prepared the planning inputs for ${initialPlanningState.targetResourceSystem} ${initialPlanningState.targetResourceName ?? "target"} ${initialPlanningState.requestedAccessLevel ?? "requested"} access.`,
              initialPlanningState.businessReason ? `Business reason: ${initialPlanningState.businessReason}.` : undefined,
              "",
              "No changes were made.",
              "No request was submitted.",
              "This is ready for review/approval/request submission in a later step."
            ].filter((line): line is string => line !== undefined).join("\n"),
        classification: governedPlanningClassification(initialPlanningState.targetResourceSystem),
        selectedAgents: [],
        skippedAgents: [],
        routingSource: initialAccessIntent.source === "ai" ? "ai" : "rules_fallback",
        routingConfidence: initialAccessIntent.confidence,
        routingReasoningSummary: initialPlanningState.missingInputs.length
          ? "Stored tenant/user/conversation-scoped governed planning state before runtime routing."
          : "Collected complete governed planning inputs without submitting or executing the request.",
        resolutionStatus: "needs_more_info",
        evidence: [
          governedPlanningEvidence({
            state: initialPlanningState,
            pendingInteractionId: pendingInteraction?.id,
            pendingInteractionResumed: false
          })
        ],
        agentTrace: [
          trace(
            initialPlanningState.missingInputs.length ? "pending_planning_created" : "planning_ready_without_submission",
            initialPlanningState.missingInputs.length
              ? `Missing inputs: ${initialPlanningState.missingInputs.join(", ")}`
              : "All required normalized planning inputs are present; no request submitted."
          )
        ],
        executionTrace: [
          executionStep("user", "submit_issue", requestBody.message),
          executionStep("orchestrator", "interpret_governed_access_intent", `Normalized governed access planning intent from ${initialAccessIntent.source}; AI output is advisory only and Gateway validation retained safe fields.`),
          ...(initialPlanningState.missingInputs.length
            ? [executionStep("orchestrator", "store_pending_planning_state", `Stored missing inputs: ${initialPlanningState.missingInputs.join(", ")}.`)]
            : [executionStep("orchestrator", "complete_planning_without_submission", "Planning inputs are complete. No request was submitted.")]),
          executionStep("orchestrator", "skip_runtime_execution", "No request was submitted, no runtime token was issued, and no external connector runtime was called.")
        ],
        securityDecisions: [],
        requestInterpretation: governedPlanningInterpretation(initialPlanningState),
        pendingInteraction,
        executionGateStack: governedPlanningGateStack({
          finalOutcome: initialPlanningState.missingInputs.length ? "needs_more_info" : "planned",
          stoppedAt: initialPlanningState.missingInputs.length ? "gateway_governance" : "runtime_execution",
          gatewayReason: initialPlanningState.missingInputs.length
            ? "Gateway stored governed pending planning state and asked for missing inputs."
            : "Gateway completed planning inputs without submission or runtime execution."
        }),
        a2aTasks: [],
        a2aResponses: [],
        diagnosis: {
          probableCause: initialPlanningState.missingInputs.length
            ? "Governed connector planning requires missing inputs"
            : "Governed connector planning inputs are complete",
          recommendedFix: initialPlanningState.missingInputs.length
            ? governedPlanningQuestion(initialPlanningState.missingInputs)
            : "Review the plan and submit through a governed approval/request flow later."
        }
      });
    }

    if (governedAccessIntentNeedsTargetClarification(initialAccessIntent)) {
      const detectedIntentClasses = governedAccessIntentClasses(initialAccessIntent);
      const safeDetectedIntentClasses = detectedIntentClasses.length ? detectedIntentClasses : ["access_request"];
      const createdAt = new Date();
      const pendingInteraction = buildGovernedAccessTargetSelectionPendingInteraction({
        originalUserRequest: requestBody.message,
        tenantContext,
        conversationState,
        actor: verifiedUser,
        intent: initialAccessIntent,
        detectedIntentClasses: safeDetectedIntentClasses,
        createdAt
      });
      const planningInterpretation = governedAccessIntentInterpretation(initialAccessIntent);
      return finalizeEarly({
        conversationId,
        finalAnswer: [
          "NEEDS MORE INFO",
          governedAccessClarificationQuestion(initialAccessIntent),
          "",
          "No changes were made.",
          "No request was submitted."
        ].join("\n"),
        classification: governedPlanningClassification(initialAccessIntent.targetResourceSystem ?? "Unknown"),
        selectedAgents: [],
        skippedAgents: [],
        routingSource: initialAccessIntent.source === "ai" ? "ai" : "rules_fallback",
        routingConfidence: initialAccessIntent.confidence,
        routingReasoningSummary: "Normalized governed access-planning intent needs target/resource clarification before a planning state can be created.",
        resolutionStatus: "needs_more_info",
        evidence: [
          governedAccessIntentEvidence(initialAccessIntent)
        ],
        agentTrace: [
          trace("governed_access_intent_needs_target", initialAccessIntent.reason)
        ],
        executionTrace: [
          executionStep("user", "submit_issue", requestBody.message),
          executionStep("orchestrator", "interpret_governed_access_intent", `Normalized governed access planning intent from ${initialAccessIntent.source}; AI output is advisory only and cannot grant policy authority.`),
          executionStep("orchestrator", "ask_for_governed_access_target", "Target system or resource was unclear, so Gateway asked a clarification question before creating planning state."),
          executionStep("orchestrator", "skip_runtime_execution", "No request was submitted, no runtime token was issued, and no external connector runtime was called.")
        ],
        securityDecisions: [],
        requestInterpretation: planningInterpretation,
        connectorPlanningTargetResolution: {
          strategy: "needs_clarification",
          detectedIntentClasses: safeDetectedIntentClasses,
          reason: "Normalized governed access-planning intent did not contain a clear target system and resource."
        },
        safeTargetSelection: !initialAccessIntent.targetResourceSystem
          ? buildSafeTargetSelection(safeDetectedIntentClasses, installedAgents)
          : undefined,
        pendingFollowUp: {
          type: "connector_planning_target",
          originalMessage: requestBody.message,
          detectedIntentClasses: safeDetectedIntentClasses,
          missingFields: ["targetSystem"],
          createdAt: createdAt.toISOString()
        },
        pendingInteraction,
        executionGateStack: governedPlanningGateStack({
          finalOutcome: "needs_more_info",
          stoppedAt: "gateway_governance",
          gatewayReason: "Gateway asked for target/resource clarification before governed access planning."
        }),
        a2aTasks: [],
        a2aResponses: [],
        diagnosis: {
          probableCause: "Governed connector planning target is unclear",
          recommendedFix: governedAccessClarificationQuestion(initialAccessIntent)
        }
      });
    }
  }

  const followUp = await interpretFollowUp({
    currentMessage: requestBody.message,
    previousUserMessage: lastUserMessageBeforeLatest(conversationState),
    previousAssistantMessage: lastAssistantMessage(conversationState),
    previousInterpretation: conversationState.lastRequestInterpretation,
    previousIncidentContext: conversationState.lastIncidentContext
  });
  const planningFollowUpResolution = buildPlanningFollowUpResolution({
    state: conversationState,
    currentMessage: requestBody.message,
    installedAgents
  });
  const effectiveMessage = planningFollowUpResolution?.resolvedMessage ?? buildEffectiveMessageForRouting(conversationState, requestBody.message, followUp);
  const { routingDecision, interpretationProof, routingProof } = await routeWithAIWithProof(effectiveMessage, { agentCards: requestAgentCards });
  const classification = routingDecision.classification;
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
  const securityIntent = detectAdversarialIntent(
    `${requestBody.message}\n${effectiveMessage}\n${incidentInterpretation?.requestedActionText ?? routingDecision.requestInterpretation?.requestedActionText ?? ""}`
  );
  const effectiveSecurityIntent = earlySecurityIntent.detected ? earlySecurityIntent : securityIntent;
  const connectorRouting = routeConnectorRequest(
    effectiveMessage,
    installedAgents
  );
  const interpretationReconciliation = reconcileConnectorSupportedInterpretation({
    inputText: effectiveMessage,
    interpretation: incidentInterpretation ?? routingDecision.requestInterpretation,
    proof: interpretationProof,
    connectorRouting,
    hasExplicitSecurityRisk: effectiveSecurityIntent.detected || sensitiveAction.isSensitive
  });
  const effectiveRequestInterpretation = interpretationReconciliation.interpretation;
  const effectiveInterpretationProof = interpretationReconciliation.proof;
  await appendAiInterpretationEvaluatedAuditEvent({
    proof: effectiveInterpretationProof,
    actor: verifiedUser
  });
  await appendAiRoutingEvaluatedAuditEvent({
    proof: routingProof,
    actor: verifiedUser
  });
  const finalize = (response: Omit<ResolveResponse, "userIdentity">): ResolveResponse => {
    const userIdentityTrace = verifiedUser
      ? [
          executionStep(
            "orchestrator",
            "user_identity_verified",
            `Verified ${verifiedUser.provider} user ${verifiedUser.email}; actor context attached to gateway session.`
          )
        ]
      : [];
    const responseWithIdentity = {
      ...response,
      conversationId,
      userIdentity: responseUserIdentity,
      executionTrace: [...userIdentityTrace, ...response.executionTrace],
      followUpInterpretation: response.followUpInterpretation ?? followUp,
      incidentContext: response.incidentContext ?? mergedIncidentContext,
      interpretationProof: response.interpretationProof ?? effectiveInterpretationProof,
      aiRoutingProof: response.aiRoutingProof ?? routingProof
    };
    const finalResponse: ResolveResponse = {
      ...responseWithIdentity,
      executionGateStack: response.executionGateStack ?? buildExecutionGateStack({
        userIdentity: responseWithIdentity.userIdentity,
        requestInterpretation: responseWithIdentity.requestInterpretation,
        aiRoutingProof: responseWithIdentity.aiRoutingProof,
        securityIntent: responseWithIdentity.securityIntent,
        connectorRouting: responseWithIdentity.connectorRouting,
        connectorPolicy: responseWithIdentity.connectorPolicy,
        connectorRuntime: responseWithIdentity.connectorRuntime,
        connectorActionPlan: responseWithIdentity.connectorActionPlan,
        evaluatedActionPlan: responseWithIdentity.evaluatedActionPlan,
        selectedAgents: responseWithIdentity.selectedAgents,
        securityDecision: responseWithIdentity.securityDecision,
        resolutionStatus: responseWithIdentity.resolutionStatus,
        classification: responseWithIdentity.classification
      })
    };
    updateConversationState(conversationState, finalResponse, mergedIncidentContext);
    void persistConversationStateSnapshot({
      state: conversationState,
      actor: verifiedUser,
      response: finalResponse
    });
    return finalResponse;
  };

  if (effectiveSecurityIntent.detected || pendingInteractionResolution?.relation === "adversarial_attempt" || pendingInteractionResolution?.securityConcern) {
    const diagnosis = {
      probableCause: "Adversarial governance bypass request blocked",
      recommendedFix: "Use normal approved requests. Prompt text cannot grant scopes, permissions, Gateway approval, or raw token access."
    };
    await appendSecurityBlockedAuditEvent({
      actor: verifiedUser,
      category: effectiveSecurityIntent.category ?? "adversarial_or_governance_bypass",
      reason: effectiveSecurityIntent.detected ? effectiveSecurityIntent.reason : "Pending interaction indicated adversarial or governance bypass concern.",
      finalOutcome: "blocked_at_gateway"
    });

    return finalize({
      finalAnswer: "BLOCKED\nThe request attempted to bypass governance or obtain protected access from prompt text. Admin access requires governed approval.\nNo changes were made. No access was granted. No request was submitted.",
      classification,
      selectedAgents: [],
      skippedAgents: routingDecision.skippedAgents,
      routingSource: routingDecision.routingSource,
      routingConfidence: routingDecision.routingConfidence,
      routingReasoningSummary: effectiveSecurityIntent.reason,
      resolutionStatus: "resolved",
      evidence: [],
      agentTrace: [
        trace("classify_issue", `Detected ${classification.system}, ${classification.errorCode ?? "no error code"}, ${classification.issueType}`),
        {
          ...trace("ADVERSARIAL_INTENT_DETECTED", effectiveSecurityIntent.reason),
          decision: "Blocked"
        },
        {
          ...trace("GATEWAY_GOVERNANCE_BLOCKED", "Prompt text cannot grant scopes, permissions, Gateway approval, or raw token access."),
          decision: "Blocked"
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
        executionStep("orchestrator", "detect_adversarial_intent", effectiveSecurityIntent.reason),
        executionStep("orchestrator", "block_at_gateway_governance", "Did not issue OAuth token or invoke runtime for adversarial prompt."),
        executionStep("orchestrator", "skip_runtime_execution", "Runtime was not executed because Gateway governance blocked the request.")
      ],
      securityDecisions: [],
      requestInterpretation: incidentInterpretation ?? routingDecision.requestInterpretation,
      securityIntent: effectiveSecurityIntent,
      pendingInteractionResolution,
      planningFollowUpResolution,
      followUpInterpretation: followUp,
      incidentContext: mergedIncidentContext,
      a2aTasks: [],
      a2aResponses: [],
      diagnosis,
      conversationId
    });
  }

  if (
    conversationState.pendingInteraction?.type === "target_selection" &&
    (pendingInteractionResolution?.relation === "ask_question" || pendingInteractionResolution?.relation === "unclear")
  ) {
    const safeTargetSelection = buildSafeTargetSelection(
      conversationState.pendingFollowUp?.detectedIntentClasses ?? detectedPlanningIntentClasses(effectiveMessage),
      installedAgents
    );
    const optionLabels = safeTargetSelection.options.map((option) => option.label).join(", ");
    const diagnosis = {
      probableCause: "Pending target selection was not resolved",
      recommendedFix: "Choose one of the installed systems or Other / not listed."
    };

    return finalize({
      conversationId,
      finalAnswer: `NEEDS MORE INFO\nChoose a target system for the previous access request. Available options: ${optionLabels}.`,
      classification,
      selectedAgents: [],
      skippedAgents: routingDecision.skippedAgents,
      routingSource: routingDecision.routingSource,
      routingConfidence: routingDecision.routingConfidence,
      routingReasoningSummary: "User asked about target options instead of selecting a target.",
      resolutionStatus: "needs_more_info",
      evidence: [],
      agentTrace: [
        trace("target_selection_preserved", pendingInteractionResolution.reason)
      ],
      executionTrace: [
        executionStep("user", "submit_issue", requestBody.message),
        executionStep("orchestrator", "preserve_pending_target_selection", "Provided available target options without clearing pending target selection.")
      ],
      securityDecisions: [],
      requestInterpretation: incidentInterpretation ?? routingDecision.requestInterpretation,
      safeTargetSelection,
      pendingInteraction: conversationState.pendingInteraction,
      pendingInteractionResolution,
      planningFollowUpResolution,
      executionGateStack: {
        stoppedAt: "gateway_governance",
        finalOutcome: "needs_more_info",
        gates: [
          {
            id: "ai_interpretation",
            label: "AI Interpretation",
            status: "passed",
            reason: "Pending target-selection response did not contain a target."
          },
          {
            id: "gateway_governance",
            label: "Gateway Governance",
            status: "blocked",
            reason: "Gateway preserved the pending interaction and did not guess a connector target."
          },
          {
            id: "oauth_scope",
            label: "OAuth Scope Gate",
            status: "not_evaluated",
            reason: "No connector was selected."
          },
          {
            id: "service_account_permission",
            label: "Service Account Permission Gate",
            status: "not_evaluated",
            reason: "No connector was selected."
          },
          {
            id: "runtime_execution",
            label: "Runtime Execution",
            status: "not_evaluated",
            reason: "Runtime was not executed."
          }
        ]
      },
      a2aTasks: [],
      a2aResponses: [],
      diagnosis
    });
  }

  if (conversationState.pendingInteraction?.type === "planned_safe_action" && pendingInteractionResolution?.relation === "confirm") {
    const pending = conversationState.pendingInteraction;
    const connectorId = pendingString(pending.context, "connectorId");
    const resourceSystem = pendingString(pending.context, "resourceSystem");
    const actionId = pendingString(pending.context, "recommendedActionId");
    const actionLabel = pendingString(pending.context, "recommendedActionLabel") ?? actionId ?? "safe check";
    const executionType = pendingString(pending.context, "executionType");
    const sideEffects = pendingString(pending.context, "sideEffects");
    const decision = pendingString(pending.context, "decision");
    const trustedAgentStillInstalled = installedAgents.some((agent) =>
      Boolean(connectorId && (agent.connectorId === connectorId || agent.connectorProfile?.connectorId === connectorId)) ||
      Boolean(resourceSystem && (agent.resourceSystem === resourceSystem || agent.connectorProfile?.resourceSystem === resourceSystem))
    );
    const stillSafe = decision === "allowed" &&
      sideEffects === "none" &&
      (executionType === "inspection_read_only" || executionType === "diagnostic_read_only") &&
      trustedAgentStillInstalled;
    const diagnosis = {
      probableCause: stillSafe ? "Pending safe action confirmed" : "Pending safe action is no longer valid",
      recommendedFix: stillSafe
        ? "This V1 demo stops at the approved plan for this request."
        : "Start a new request so the Gateway can re-evaluate the connector plan."
    };

    return finalize({
      conversationId,
      finalAnswer: stillSafe
        ? "CHECK READY\nI can continue with the safe check, but this V1 demo currently stops at the approved plan for this request.\nNo changes were made."
        : "NEEDS MORE INFO\nThe previous safe check is no longer available. Please describe the request again.",
      classification,
      selectedAgents: [],
      skippedAgents: routingDecision.skippedAgents,
      routingSource: routingDecision.routingSource,
      routingConfidence: routingDecision.routingConfidence,
      routingReasoningSummary: "Resolved user response against pending planned safe action.",
      resolutionStatus: "needs_more_info",
      evidence: [
        {
          agent: orchestratorAgentId,
          title: "Pending safe action",
          data: {
            pendingInteractionId: pending.id,
            connectorId,
            resourceSystem,
            actionId,
            actionLabel,
            decision,
            executionType,
            sideEffects,
            trustedAgentStillInstalled,
            runtimeExecuted: false,
            reason: stillSafe
              ? "No runtime implementation for planned action in V1."
              : "Pending action failed Gateway re-validation."
          }
        }
      ],
      agentTrace: [
        trace("pending_interaction_resolved", pendingInteractionResolution.reason),
        trace("planned_safe_action_revalidated", stillSafe ? "Pending safe check remains allowed and read-only/diagnostic." : "Pending safe check failed validation.")
      ],
      executionTrace: [
        executionStep("user", "submit_issue", requestBody.message),
        executionStep("orchestrator", "resolve_pending_interaction", pendingInteractionResolution.reason),
        executionStep("orchestrator", "revalidate_pending_safe_action", stillSafe ? "Decision allowed, execution type read-only/diagnostic, side effects none." : "Pending action did not satisfy safe execution constraints."),
        executionStep("orchestrator", "skip_runtime_execution", "No runtime implementation for planned action in V1; no write/admin action was executed.")
      ],
      securityDecisions: [],
      requestInterpretation: {
        ...(incidentInterpretation ?? routingDecision.requestInterpretation),
        scope: "enterprise_support",
        intentType: "access_request",
        requestedActionText: actionLabel,
        confidence: "medium",
        reason: "User confirmed the pending safe check."
      },
      pendingInteractionResolution,
      executionGateStack: {
        stoppedAt: "runtime_execution",
        finalOutcome: "planned",
        gates: [
          {
            id: "ai_interpretation",
            label: "AI Interpretation",
            status: "passed",
            reason: "User response confirmed the pending safe check.",
            evidence: {
              pendingInteractionId: pending.id,
              relation: pendingInteractionResolution.relation
            }
          },
          {
            id: "gateway_governance",
            label: "Gateway Governance",
            status: stillSafe ? "passed" : "blocked",
            reason: stillSafe
              ? "Gateway re-validated the pending action as allowed and read-only/diagnostic."
              : "Gateway rejected the pending action because it no longer met safe constraints.",
            evidence: {
              actionId,
              decision,
              executionType,
              sideEffects
            }
          },
          {
            id: "oauth_scope",
            label: "OAuth Scope Gate",
            status: "not_evaluated",
            reason: "No runtime token was issued for the V1 planned action confirmation."
          },
          {
            id: "service_account_permission",
            label: "Service Account Permission Gate",
            status: "not_evaluated",
            reason: "No runtime execution occurred; the planned action remains an approved plan."
          },
          {
            id: "runtime_execution",
            label: "Runtime Execution",
            status: "not_evaluated",
            reason: "No runtime implementation for planned action in V1. No write/action operation was executed."
          }
        ]
      },
      a2aTasks: [],
      a2aResponses: [],
      diagnosis
    });
  }

  if (conversationState.pendingInteraction && pendingInteractionResolution?.relation === "cancel") {
    const diagnosis = {
      probableCause: "Pending interaction cancelled by user",
      recommendedFix: "No action was taken."
    };

    return finalize({
      conversationId,
      finalAnswer: "CANCELLED\nNo problem. I will not run the check.",
      classification,
      selectedAgents: [],
      skippedAgents: routingDecision.skippedAgents,
      routingSource: routingDecision.routingSource,
      routingConfidence: routingDecision.routingConfidence,
      routingReasoningSummary: "User cancelled the pending interaction.",
      resolutionStatus: "resolved",
      evidence: [],
      agentTrace: [
        trace("pending_interaction_cancelled", pendingInteractionResolution.reason)
      ],
      executionTrace: [
        executionStep("user", "submit_issue", requestBody.message),
        executionStep("orchestrator", "cancel_pending_interaction", "Cleared pending interaction without runtime execution.")
      ],
      securityDecisions: [],
      requestInterpretation: incidentInterpretation ?? routingDecision.requestInterpretation,
      pendingInteractionResolution,
      executionGateStack: {
        stoppedAt: "gateway_governance",
        finalOutcome: "needs_more_info",
        gates: [
          {
            id: "ai_interpretation",
            label: "AI Interpretation",
            status: "passed",
            reason: "User cancelled the pending interaction."
          },
          {
            id: "gateway_governance",
            label: "Gateway Governance",
            status: "not_evaluated",
            reason: "Gateway took no action after cancellation."
          },
          {
            id: "oauth_scope",
            label: "OAuth Scope Gate",
            status: "not_evaluated",
            reason: "No token was issued."
          },
          {
            id: "service_account_permission",
            label: "Service Account Permission Gate",
            status: "not_evaluated",
            reason: "No connector permissions were evaluated."
          },
          {
            id: "runtime_execution",
            label: "Runtime Execution",
            status: "not_evaluated",
            reason: "Runtime was not executed."
          }
        ]
      },
      a2aTasks: [],
      a2aResponses: [],
      diagnosis
    });
  }

  if (conversationState.pendingInteraction?.type === "planned_safe_action" && pendingInteractionResolution?.relation === "unclear") {
    const diagnosis = {
      probableCause: "Pending safe check needs confirmation",
      recommendedFix: "Confirm whether the Gateway should continue with the safe check."
    };

    return finalize({
      conversationId,
      finalAnswer: "NEEDS MORE INFO\nDo you want me to continue with the safe check?",
      classification,
      selectedAgents: [],
      skippedAgents: routingDecision.skippedAgents,
      routingSource: routingDecision.routingSource,
      routingConfidence: routingDecision.routingConfidence,
      routingReasoningSummary: "Pending interaction answer was unclear.",
      resolutionStatus: "needs_more_info",
      evidence: [],
      agentTrace: [
        trace("pending_interaction_unclear", pendingInteractionResolution.reason)
      ],
      executionTrace: [
        executionStep("user", "submit_issue", requestBody.message),
        executionStep("orchestrator", "ask_pending_interaction_confirmation", "Asked for confirmation before continuing with the safe check.")
      ],
      securityDecisions: [],
      requestInterpretation: incidentInterpretation ?? routingDecision.requestInterpretation,
      pendingInteraction: conversationState.pendingInteraction,
      pendingInteractionResolution,
      executionGateStack: {
        stoppedAt: "gateway_governance",
        finalOutcome: "needs_more_info",
        gates: [
          {
            id: "ai_interpretation",
            label: "AI Interpretation",
            status: "passed",
            reason: "Pending safe-check response was unclear."
          },
          {
            id: "gateway_governance",
            label: "Gateway Governance",
            status: "not_evaluated",
            reason: "Gateway asked for confirmation before taking any action."
          },
          {
            id: "oauth_scope",
            label: "OAuth Scope Gate",
            status: "not_evaluated",
            reason: "No token was issued."
          },
          {
            id: "service_account_permission",
            label: "Service Account Permission Gate",
            status: "not_evaluated",
            reason: "No connector permissions were evaluated."
          },
          {
            id: "runtime_execution",
            label: "Runtime Execution",
            status: "not_evaluated",
            reason: "Runtime was not executed."
          }
        ]
      },
      a2aTasks: [],
      a2aResponses: [],
      diagnosis
    });
  }

  if (!conversationState.pendingInteraction && contextlessContinuationRequest(requestBody.message)) {
    const diagnosis = {
      probableCause: "No pending safe check is active",
      recommendedFix: "Describe the request you want the Gateway to check."
    };

    return finalize({
      conversationId,
      finalAnswer: "NEEDS MORE INFO\nI do not have a pending check to continue. Tell me what you want access to or what you want me to check.",
      classification,
      selectedAgents: [],
      skippedAgents: routingDecision.skippedAgents,
      routingSource: routingDecision.routingSource,
      routingConfidence: routingDecision.routingConfidence,
      routingReasoningSummary: "Continuation phrase received without pending interaction context.",
      resolutionStatus: "needs_more_info",
      evidence: [],
      agentTrace: [
        trace("pending_interaction_missing", "Did not continue because no pending interaction is active.")
      ],
      executionTrace: [
        executionStep("user", "submit_issue", requestBody.message),
        executionStep("orchestrator", "ask_for_request_context", "Continuation phrase requires a pending interaction.")
      ],
      securityDecisions: [],
      requestInterpretation: {
        ...(incidentInterpretation ?? routingDecision.requestInterpretation),
        scope: "enterprise_support",
        intentType: "unknown",
        confidence: "low",
        reason: "The message appears to confirm a prior action, but no pending interaction is active."
      },
      executionGateStack: {
        stoppedAt: "gateway_governance",
        finalOutcome: "needs_more_info",
        gates: [
          {
            id: "ai_interpretation",
            label: "AI Interpretation",
            status: "passed",
            reason: "Continuation response detected without pending interaction context."
          },
          {
            id: "gateway_governance",
            label: "Gateway Governance",
            status: "blocked",
            reason: "Gateway did not execute anything without an active pending interaction."
          },
          {
            id: "oauth_scope",
            label: "OAuth Scope Gate",
            status: "not_evaluated",
            reason: "No connector was selected."
          },
          {
            id: "service_account_permission",
            label: "Service Account Permission Gate",
            status: "not_evaluated",
            reason: "No connector was selected."
          },
          {
            id: "runtime_execution",
            label: "Runtime Execution",
            status: "not_evaluated",
            reason: "Runtime was not executed."
          }
        ]
      },
      a2aTasks: [],
      a2aResponses: [],
      diagnosis
    });
  }

  if (planningFollowUpResolution && isOtherTargetSelection(requestBody.message)) {
    const diagnosis = {
      probableCause: "Target system is not currently available in the Gateway",
      recommendedFix: "Open support ticket with details."
    };

    return finalize({
      conversationId,
      finalAnswer: "UNAVAILABLE\nOther / not listed is not governed by an installed connector here.\nNo changes were made.\nNext step: open a support ticket with the system name, access needed, and business reason.",
      classification,
      selectedAgents: [],
      skippedAgents: routingDecision.skippedAgents,
      routingSource: routingDecision.routingSource,
      routingConfidence: routingDecision.routingConfidence,
      routingReasoningSummary: "User selected Other / not listed for a pending access-planning target.",
      resolutionStatus: "unsupported",
      evidence: [],
      agentTrace: [
        trace("connector_planning_other_target", "User selected Other / not listed. Did not request connector action plan.")
      ],
      executionTrace: [
        executionStep("user", "submit_issue", requestBody.message),
        executionStep("orchestrator", "support_ticket_handoff", "Unsupported target selected. No connector plan or runtime execution requested.")
      ],
      securityDecisions: [],
      requestInterpretation: {
        ...(incidentInterpretation ?? routingDecision.requestInterpretation),
        scope: "manual_enterprise_workflow",
        intentType: "manual_service_request",
        requestedActionText: "support ticket handoff",
        confidence: "medium",
        reason: "User selected Other / not listed for the access request target."
      },
      connectorPlanningTargetResolution: {
        strategy: "not_supported",
        detectedIntentClasses: conversationState.pendingFollowUp?.detectedIntentClasses ?? detectedPlanningIntentClasses(effectiveMessage),
        reason: "User selected Other / not listed."
      },
      pendingInteractionResolution,
      planningFollowUpResolution,
      executionGateStack: {
        stoppedAt: "gateway_governance",
        finalOutcome: "unsupported",
        gates: [
          {
            id: "ai_interpretation",
            label: "AI Interpretation",
            status: "passed",
            reason: "User selected Other / not listed for the pending access-planning target.",
            evidence: {
              intent: "access request",
              targetSystem: "other"
            }
          },
          {
            id: "gateway_governance",
            label: "Gateway Governance",
            status: "blocked",
            reason: "Gateway did not select a connector for an unsupported or unlisted system."
          },
          {
            id: "oauth_scope",
            label: "OAuth Scope Gate",
            status: "not_evaluated",
            reason: "Gateway did not select a connector."
          },
          {
            id: "service_account_permission",
            label: "Service Account Permission Gate",
            status: "not_evaluated",
            reason: "Gateway did not select a connector."
          },
          {
            id: "runtime_execution",
            label: "Runtime Execution",
            status: "not_evaluated",
            reason: "No connector plan or runtime execution was requested."
          }
        ]
      },
      a2aTasks: [],
      a2aResponses: [],
      diagnosis
    });
  }

  const selectedKnownTarget = planningFollowUpResolution ? knownTargetSystemFromMessage(requestBody.message) : undefined;
  if (planningFollowUpResolution && selectedKnownTarget) {
    const selectedInstalledAgent = installedAgents.find((agent) => {
      const resourceSystem = (agent.resourceSystem ?? agent.connectorProfile?.resourceSystem ?? "").toLowerCase();
      return resourceSystem === selectedKnownTarget.value;
    });
    if (!selectedInstalledAgent || !planningSupported(selectedInstalledAgent)) {
      const systemName = selectedKnownTarget.label;
      const availableButNoPlanning = Boolean(selectedInstalledAgent);
      const diagnosis = {
        probableCause: availableButNoPlanning
          ? `${systemName} safe access planning is not available in V1`
          : `${systemName} is not currently available in the Gateway`,
        recommendedFix: "Open support ticket with details."
      };

      return finalize({
        conversationId,
        finalAnswer: availableButNoPlanning
          ? `${systemName} is available here, but safe access planning is not available for this system yet. Open a support ticket or use an available diagnostic flow.`
          : `${systemName} is not available here yet. Open a support ticket with the system name, what you need access to, and why you need it.`,
        classification,
        selectedAgents: [],
        skippedAgents: routingDecision.skippedAgents,
        routingSource: routingDecision.routingSource,
        routingConfidence: routingDecision.routingConfidence,
        routingReasoningSummary: `${systemName} was selected for a pending access-planning request, but it is not available for safe planning.`,
        resolutionStatus: "unsupported",
        evidence: [],
        agentTrace: [
          trace("connector_planning_target_unavailable", `${systemName} was not sent to plan-only runtime.`)
        ],
        executionTrace: [
          executionStep("user", "submit_issue", requestBody.message),
          executionStep("orchestrator", "support_ticket_handoff", "Selected system was not available for safe planning. No connector plan or runtime execution requested.")
        ],
        securityDecisions: [],
        requestInterpretation: {
          ...(incidentInterpretation ?? routingDecision.requestInterpretation),
          scope: "manual_enterprise_workflow",
          intentType: "manual_service_request",
          targetSystemText: systemName,
          requestedActionText: "support ticket handoff",
          confidence: "medium",
          reason: `${systemName} was selected, but safe access planning cannot proceed for this system.`
        },
        connectorPlanningTargetResolution: {
          strategy: "not_supported",
          detectedIntentClasses: conversationState.pendingFollowUp?.detectedIntentClasses ?? detectedPlanningIntentClasses(effectiveMessage),
          reason: `${systemName} is not available for safe access planning.`
        },
        pendingInteractionResolution,
        planningFollowUpResolution,
        executionGateStack: {
          stoppedAt: "gateway_governance",
          finalOutcome: "unsupported",
          gates: [
            {
              id: "ai_interpretation",
              label: "AI Interpretation",
              status: "passed",
              reason: `${systemName} selected for the pending access-planning target.`,
              evidence: {
                intent: "access request",
                targetSystem: selectedKnownTarget.value
              }
            },
            {
              id: "gateway_governance",
              label: "Gateway Governance",
              status: "blocked",
              reason: "Gateway did not request a plan for a system that is not available for safe access planning."
            },
            {
              id: "oauth_scope",
              label: "OAuth Scope Gate",
              status: "not_evaluated",
              reason: "Gateway did not select a planning-capable connector."
            },
            {
              id: "service_account_permission",
              label: "Service Account Permission Gate",
              status: "not_evaluated",
              reason: "Gateway did not select a planning-capable connector."
            },
            {
              id: "runtime_execution",
              label: "Runtime Execution",
              status: "not_evaluated",
              reason: "No connector plan or runtime execution was requested."
            }
          ]
        },
        a2aTasks: [],
        a2aResponses: [],
        diagnosis
      });
    }
  }

  if (!planningFollowUpResolution && isPreviousAccessRequestTargetSelection(requestBody.message)) {
    const diagnosis = {
      probableCause: "No previous access request is active",
      recommendedFix: "Describe the access request, including the system or application and the object you need access to."
    };

    return finalize({
      conversationId,
      finalAnswer: "I can help plan an access request, but I need the original access request first. Tell me which system or application you need access to and what object you need.",
      classification,
      selectedAgents: [],
      skippedAgents: routingDecision.skippedAgents,
      routingSource: routingDecision.routingSource,
      routingConfidence: routingDecision.routingConfidence,
      routingReasoningSummary: "Received a target-selection follow-up phrase without pending planning context.",
      resolutionStatus: "needs_more_info",
      evidence: [],
      agentTrace: [
        trace("connector_planning_follow_up_without_context", "Did not execute planning because no pending access request context was active.")
      ],
      executionTrace: [
        executionStep("user", "submit_issue", requestBody.message),
        executionStep("orchestrator", "ask_for_original_access_request", "Target selection phrase requires pending planning context.")
      ],
      securityDecisions: [],
      requestInterpretation: {
        ...(incidentInterpretation ?? routingDecision.requestInterpretation),
        scope: "enterprise_support",
        intentType: "access_request",
        requestedActionText: "access request",
        confidence: "low",
        reason: "The message refers to a previous access request, but no pending planning context exists."
      },
      executionGateStack: {
        stoppedAt: "gateway_governance",
        finalOutcome: "needs_more_info",
        gates: [
          {
            id: "ai_interpretation",
            label: "AI Interpretation",
            status: "passed",
            reason: "Target-selection follow-up detected without active planning context.",
            evidence: {
              targetSystem: "not selected",
              requestedAction: "access request follow-up"
            }
          },
          {
            id: "gateway_governance",
            label: "Gateway Governance",
            status: "blocked",
            reason: "Gateway did not select a connector without the original access request context."
          },
          {
            id: "oauth_scope",
            label: "OAuth Scope Gate",
            status: "not_evaluated",
            reason: "Gateway did not select a connector."
          },
          {
            id: "service_account_permission",
            label: "Service Account Permission Gate",
            status: "not_evaluated",
            reason: "Gateway did not select a connector."
          },
          {
            id: "runtime_execution",
            label: "Runtime Execution",
            status: "not_evaluated",
            reason: "No connector plan or runtime execution was requested."
          }
        ]
      },
      a2aTasks: [],
      a2aResponses: [],
      diagnosis
    });
  }

  if (isConnectorPlanningCandidate({ message: effectiveMessage, connectorRoute: connectorRouting, installedAgents })) {
    const planningTargetResolution = planningConnectorTarget({
      message: effectiveMessage,
      connectorRoute: connectorRouting,
      installedAgents
    });
    const planTarget = planningTargetResolution.selectedConnectorId && planningTargetResolution.selectedResourceSystem
      ? {
          connectorId: planningTargetResolution.selectedConnectorId,
          resourceSystem: planningTargetResolution.selectedResourceSystem
        }
      : undefined;
    const onboardedAgent = planTarget
      ? installedAgents.find((agent) =>
          agent.connectorId === planTarget.connectorId ||
          agent.connectorProfile?.connectorId === planTarget.connectorId ||
          agent.resourceSystem === planTarget.resourceSystem ||
          agent.connectorProfile?.resourceSystem === planTarget.resourceSystem
        )
      : undefined;

    if (onboardedAgent) {
      try {
        const { agentResponse, actionPlan } = await requestConnectorActionPlan({
          message: effectiveMessage,
          conversationId,
          onboardedAgent,
          actor: verifiedUser
        });
        if (actionPlan) {
          const evaluatedActionPlan = evaluateConnectorActionPlan(actionPlan, onboardedAgent);
          const pendingInteraction = buildPlannedSafeActionPendingInteraction({
            originalUserRequest: planningFollowUpResolution?.originalMessage ?? requestBody.message,
            evaluatedActionPlan
          });
          const finalAnswer = "PLANNED: The Gateway asked the connector for a side-effect-free action plan. No write action was attempted. The connector recommends starting with read-only inspection.";
          const diagnosis = {
            probableCause: "Connector action planning completed without side effects",
            recommendedFix: actionPlan.recommendedNextStep
          };

          return finalize({
            conversationId,
            finalAnswer,
            classification,
            selectedAgents: [],
            skippedAgents: routingDecision.skippedAgents,
            routingSource: "rules_fallback",
            routingConfidence: routingDecision.routingConfidence,
            routingReasoningSummary: "Detected access-planning request and requested a safe connector action plan.",
            resolutionStatus: "needs_more_info",
            evidence: [
              {
                agent: orchestratorAgentId,
                title: "Connector Action Plan",
                data: {
                  connectorId: actionPlan.connectorId,
                  resourceSystem: actionPlan.resourceSystem,
                  planId: actionPlan.planId,
                  mode: actionPlan.mode,
                  sideEffectsAllowed: actionPlan.sideEffectsAllowed,
                  options: evaluatedActionPlan.options.map((item) => ({
                    actionId: item.option.actionId,
                    decision: item.decision,
                    blockedAt: item.blockedAt,
                    missingApplicationGrants: item.missingApplicationGrants,
                    missingEffectivePermissions: item.missingEffectivePermissions,
                    deniedEffectivePermissions: item.deniedEffectivePermissions
                  }))
                }
              }
            ],
            agentTrace: [
              trace("classify_issue", `Detected ${classification.system}, ${classification.errorCode ?? "no error code"}, ${classification.issueType}`),
              trace("connector_action_plan_requested", "Gateway requested a side-effect-free connector action plan."),
              ...(agentResponse.trace ?? []).map((entry) => ({
                ...trace(entry.action, entry.detail),
                agent: entry.agent,
                toAgent: onboardedAgent.connectorId,
                timestamp: entry.timestamp
              }))
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
              executionStep("orchestrator", "request_connector_action_plan", "Requested plan_only connector action plan with sideEffectsAllowed=none."),
              executionStep("orchestrator", "evaluate_connector_action_plan", "Gateway evaluated planned options against governance, grants, and permissions."),
              executionStep("orchestrator", "skip_runtime_execution", "No write action was attempted during connector planning.")
            ],
            securityDecisions: [],
            requestInterpretation: incidentInterpretation ?? routingDecision.requestInterpretation,
            connectorPlanningTargetResolution: planningTargetResolution,
            pendingInteraction,
            pendingInteractionResolution,
            planningFollowUpResolution,
            connectorActionPlan: actionPlan,
            evaluatedActionPlan,
            a2aTasks: [],
            a2aResponses: [agentResponse],
            diagnosis
          });
        }
      } catch (error) {
        console.warn(`[connector-plan] ${error instanceof Error ? error.message : "failed"}`);
      }
    } else if (planningTargetResolution.strategy === "needs_clarification" || planningTargetResolution.strategy === "not_supported") {
      const planningInterpretation: RequestInterpretation = {
        ...(incidentInterpretation ?? routingDecision.requestInterpretation),
        scope: "enterprise_support",
        intentType: planningTargetResolution.detectedIntentClasses.includes("permission_request") ? "permission_change" : "access_request",
        requestedActionText: planningTargetResolution.detectedIntentClasses.includes("permission_request") ? "permission request" : "access request",
        confidence: "medium",
        reason: "Access request detected, but target system was not specified."
      };
      const hasInstalledConnectorSystems = installedAgents.length > 0;
      const diagnosis = {
        probableCause: "Connector planning target is unclear",
        recommendedFix: hasInstalledConnectorSystems
          ? "Search installed systems or choose Other / not listed."
          : "No installed systems are available for governed access planning yet. Open a support ticket with details."
      };
      const safeTargetOptions = hasInstalledConnectorSystems
        ? buildSafeTargetSelection(planningTargetResolution.detectedIntentClasses, installedAgents)
        : undefined;
      return finalize({
        conversationId,
        finalAnswer: hasInstalledConnectorSystems
          ? "Which system do you need access to? Search installed systems or choose Other / not listed."
          : "UNAVAILABLE\nNo governed systems are connected here yet.\nNo changes were made.\nNext step: open a support ticket with system name, access needed, business reason.",
        classification,
        selectedAgents: [],
        skippedAgents: routingDecision.skippedAgents,
        routingSource: routingDecision.routingSource,
        routingConfidence: routingDecision.routingConfidence,
        routingReasoningSummary: "Access-planning request detected, but target connector was unclear.",
        resolutionStatus: "needs_more_info",
        evidence: [],
        agentTrace: [
          trace("connector_planning_needs_target", "Asked user to clarify target system before requesting connector action plan.")
        ],
        executionTrace: [
          executionStep("user", "submit_issue", requestBody.message),
          executionStep("orchestrator", "ask_for_connector_planning_target", "Did not guess connector target for planning request.")
        ],
        securityDecisions: [],
        requestInterpretation: planningInterpretation,
        connectorPlanningTargetResolution: planningTargetResolution,
        safeTargetSelection: hasInstalledConnectorSystems ? buildSafeTargetSelection(planningTargetResolution.detectedIntentClasses, installedAgents) : undefined,
        pendingFollowUp: hasInstalledConnectorSystems ? {
          type: "connector_planning_target",
          originalMessage: planningFollowUpResolution?.originalMessage ?? effectiveMessage,
          detectedIntentClasses: planningTargetResolution.detectedIntentClasses,
          missingFields: ["targetSystem"],
          createdAt: new Date().toISOString()
        } : undefined,
        pendingInteraction: hasInstalledConnectorSystems ? {
          id: createTaskId(),
          type: "target_selection",
          originalUserRequest: planningFollowUpResolution?.originalMessage ?? effectiveMessage,
          createdAt: new Date().toISOString(),
          context: {
            detectedIntentClasses: planningTargetResolution.detectedIntentClasses,
            missingFields: ["targetSystem"],
            targetOptions: (safeTargetOptions?.options ?? []).map((option) => ({
              id: option.id,
              label: option.label,
              value: option.value,
              kind: option.kind
            }))
          }
        } : undefined,
        pendingInteractionResolution,
        planningFollowUpResolution,
        executionGateStack: {
          stoppedAt: "gateway_governance",
          finalOutcome: "needs_more_info",
          gates: [
            {
              id: "ai_interpretation",
              label: "AI Interpretation",
              status: "passed",
              reason: "Access-planning intent detected, but target system is unclear.",
              evidence: {
                intent: planningInterpretation.requestedActionText,
                targetSystem: "not specified",
                detectedIntentClasses: planningTargetResolution.detectedIntentClasses
              }
            },
            {
              id: "gateway_governance",
              label: "Gateway Governance",
              status: "blocked",
              reason: "Gateway did not select a connector without target system confirmation."
            },
            {
              id: "oauth_scope",
              label: "OAuth Scope Gate",
              status: "not_evaluated",
              reason: "Gateway did not select a connector."
            },
            {
              id: "service_account_permission",
              label: "Service Account Permission Gate",
              status: "not_evaluated",
              reason: "Gateway did not select a connector."
            },
            {
              id: "runtime_execution",
              label: "Runtime Execution",
              status: "not_evaluated",
              reason: "No connector plan or runtime execution was requested."
            }
          ]
        },
        a2aTasks: [],
        a2aResponses: [],
        diagnosis
      });
    }
  }

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
    await appendSecurityBlockedAuditEvent({
      actor: verifiedUser,
      category: "sensitive_security_action",
      reason: policyDecision.reason,
      finalOutcome: "blocked_by_policy"
    });

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
    const effectiveConnectorRouting = connectorRoutingWithProofBindingStatus(connectorRouting);
    const connectorStatus = connectorRoutingStatusLabel(effectiveConnectorRouting.status);
    const policyInterpretation = effectiveRequestInterpretation;
    const connectorPolicy = evaluateConnectorPolicy({
      tenantId: tenantContext.tenantId,
      conversationId,
      connectorRouteStatus: effectiveConnectorRouting.status,
      runtimeMode: effectiveConnectorRouting.runtimeMode,
      connectorId: effectiveConnectorRouting.connectorId,
      resourceSystem: effectiveConnectorRouting.resourceSystem,
      skillId: effectiveConnectorRouting.skillId,
      skillLabel: effectiveConnectorRouting.skillLabel,
      interpretation: policyInterpretation
        ? {
            interpretationId: effectiveInterpretationProof.interpretationId,
            schemaVersion: effectiveInterpretationProof.schemaVersion,
            interpretationSource: policyInterpretation.interpretationSource,
            scope: policyInterpretation.scope,
            intentType: policyInterpretation.intentType,
            requestedCapability: policyInterpretation.requestedCapability,
            confidence: policyInterpretation.confidence,
            risks: effectiveInterpretationProof.risks,
            advisoryOnly: effectiveInterpretationProof.advisoryOnly,
            originalInterpretationScope: effectiveInterpretationProof.originalInterpretationScope,
            reconciledScope: effectiveInterpretationProof.reconciledScope,
            reconciliationSource: effectiveInterpretationProof.reconciliationSource
          }
        : undefined,
      subject: {
        tenantId: tenantContext.tenantId,
        provider: verifiedUser?.provider,
        issuer: verifiedUser?.issuer,
        subject: verifiedUser?.subject,
        email: verifiedUser?.email,
        roles: verifiedUser?.roles ?? []
      },
      resource: {
        connectorId: effectiveConnectorRouting.connectorId,
        resourceSystem: effectiveConnectorRouting.resourceSystem,
        resourceId: effectiveConnectorRouting.targetResourceName,
        resourceType: effectiveConnectorRouting.targetResourceSystem,
        environment: "unknown"
      },
      action: {
        skillId: effectiveConnectorRouting.skillId,
        skillLabel: effectiveConnectorRouting.skillLabel,
        actionCategory: effectiveConnectorRouting.actionCategory,
        approvalMode: effectiveConnectorRouting.approvalMode,
        resourceSensitivity: effectiveConnectorRouting.resourceSensitivity,
        fieldClasses: effectiveConnectorRouting.fieldClasses,
        actionConstraints: effectiveConnectorRouting.actionConstraints,
        requiredApplicationGrants: effectiveConnectorRouting.requiredApplicationGrants,
        requiredEffectivePermissions: effectiveConnectorRouting.requiredEffectivePermissions,
        requestedScopes: effectiveConnectorRouting.requestedScopes,
        provider: effectiveConnectorRouting.provider,
        resourceSystem: effectiveConnectorRouting.actionResourceSystem
      },
      riskLevel: effectiveConnectorRouting.riskLevel,
      executionType: effectiveConnectorRouting.executionType,
      requiresApproval: effectiveConnectorRouting.requiresApproval,
      sensitivity: effectiveConnectorRouting.sensitivity
    });
    await appendConnectorPolicyDecisionAuditEvent({
      connectorRouting: effectiveConnectorRouting,
      connectorPolicy,
      actor: verifiedUser,
      tenantContext
    });
    const runtimeExecutable = canExecuteConnectorRuntime(effectiveConnectorRouting, connectorPolicy);
    const policyProof = {
      policyVersion: connectorPolicy.policyVersion,
      decisionId: connectorPolicy.decisionId,
      effect: connectorPolicy.effect,
      primaryRuleId: connectorPolicy.primaryRuleId,
      primaryRuleSource: connectorPolicy.primaryRuleSource,
      matchedRuleIds: connectorPolicy.matchedRuleIds,
      matchedGuardrailRuleIds: connectorPolicy.matchedGuardrailRuleIds,
      matchedTenantRuleIds: connectorPolicy.matchedTenantRuleIds,
      matchedRuleSummaries: connectorPolicy.matchedRuleSummaries,
      inputHash: connectorPolicy.inputHash,
      deniedByDefault: connectorPolicy.deniedByDefault,
      requiresApproval: connectorPolicy.requiresApproval,
      reason: connectorPolicy.reason
    };
    const connectorRuntime = runtimeExecutable
      ? await executeApprovedConnectorSkill({
          message: effectiveMessage,
          currentUserMessage: requestBody.message,
          conversationId,
          connectorRoute: effectiveConnectorRouting,
          actor: verifiedUser
        })
      : undefined;
    const runtimeAgentResponse = connectorRuntime?.agentResponse;
    const diagnosis = connectorRuntime ? connectorRuntimeDiagnosis(effectiveConnectorRouting, connectorRuntime) : connectorRoutingDiagnosis(effectiveConnectorRouting);
    const connectorEvidence: AgentEvidence[] = [
      {
        agent: orchestratorAgentId,
        title: "Connector route decision",
        data: {
          status: effectiveConnectorRouting.status,
          targetSystem: effectiveConnectorRouting.targetSystem,
          connectorId: effectiveConnectorRouting.connectorId,
          skillId: effectiveConnectorRouting.skillId,
          skillLabel: effectiveConnectorRouting.skillLabel,
          reason: effectiveConnectorRouting.reason,
          recommendedNextStep: effectiveConnectorRouting.recommendedNextStep,
          riskLevel: effectiveConnectorRouting.riskLevel,
          executionType: effectiveConnectorRouting.executionType,
          requiresApproval: effectiveConnectorRouting.requiresApproval,
          sensitivity: effectiveConnectorRouting.sensitivity,
          actionCategory: effectiveConnectorRouting.actionCategory,
          approvalMode: effectiveConnectorRouting.approvalMode,
          resourceSensitivity: effectiveConnectorRouting.resourceSensitivity,
          fieldClasses: effectiveConnectorRouting.fieldClasses,
          actionConstraints: effectiveConnectorRouting.actionConstraints,
          requestedScopes: effectiveConnectorRouting.requestedScopes,
          toolMappingStatus: effectiveConnectorRouting.toolMappingStatus,
          toolMappingProof: effectiveConnectorRouting.toolMappingProof,
          provider: effectiveConnectorRouting.provider,
          actionResourceSystem: effectiveConnectorRouting.actionResourceSystem,
          actionMetadataSource: effectiveConnectorRouting.actionMetadataSource,
          runtimeMode: effectiveConnectorRouting.runtimeMode,
          interpretationReconciliation: interpretationReconciliation.reconciled
            ? {
                originalInterpretationScope: interpretationReconciliation.originalInterpretationScope,
                reconciledScope: interpretationReconciliation.reconciledScope,
                reconciliationSource: "connector_route",
                advisoryOnly: true,
                reason: interpretationReconciliation.reason
              }
            : undefined,
          runtimeExecution: runtimeExecutable ? "external_runtime_available" : "not_executed",
          policy: connectorPolicy,
          policyProof
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
      toAgent: effectiveConnectorRouting.connectorId,
      skillId: effectiveConnectorRouting.skillId,
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
              ? `Called allowlisted external connector runtime for ${effectiveConnectorRouting.skillId}.`
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
    const metadataOnlyExecutionTrace = effectiveConnectorRouting.status === "connector_skill_approved" && effectiveConnectorRouting.runtimeMode === "metadata_only"
      ? [
          executionStep(
            "orchestrator",
            "skip_connector_runtime_execution",
            "Approved connector route is metadata-only; no trusted allowlisted runtime endpoint was available and no runtime token was issued."
          )
        ]
      : [];
    const a2aResponses = runtimeAgentResponse ? [runtimeAgentResponse] : [];
    if (connectorRuntime) {
      await appendConnectorRuntimeAuditEvents({
        connectorRouting: effectiveConnectorRouting,
        connectorRuntime,
        actor: verifiedUser
      });
    }

    return finalize({
      conversationId,
      finalAnswer: connectorRuntime ? connectorRuntimeFinalAnswer(effectiveConnectorRouting, connectorRuntime) : connectorPolicyFinalAnswer(effectiveConnectorRouting, connectorPolicy) ?? connectorRoutingFinalAnswer(effectiveConnectorRouting),
      classification,
      selectedAgents: [],
      skippedAgents,
      routingSource: "rules_fallback",
      routingConfidence: routingDecision.routingConfidence,
      routingReasoningSummary: effectiveConnectorRouting.reason,
      resolutionStatus: connectorPolicy.effect === "needs_approval" ? "needs_more_info" : connectorRuntimeResolutionStatus(effectiveConnectorRouting, connectorRuntime),
      evidence: [...connectorEvidence, ...runtimeEvidence],
      agentTrace: [
        trace("classify_issue", `Detected ${classification.system}, ${classification.errorCode ?? "no error code"}, ${classification.issueType}`),
        {
          ...trace("connector_intent_detected", effectiveConnectorRouting.reason),
          toAgent: effectiveConnectorRouting.connectorId,
          skillId: effectiveConnectorRouting.skillId,
          decision: effectiveConnectorRouting.status === "connector_skill_approved" ? "Allowed" : effectiveConnectorRouting.status === "connector_skill_blocked" || effectiveConnectorRouting.status === "connector_skill_not_declared" || effectiveConnectorRouting.status === "connector_skill_not_enabled" ? "Blocked" : "NeedsMoreContext"
        },
        {
          ...trace("connector_route_decision", `${connectorStatus}: ${effectiveConnectorRouting.recommendedNextStep}`),
          toAgent: effectiveConnectorRouting.connectorId,
          skillId: effectiveConnectorRouting.skillId,
          decision: effectiveConnectorRouting.status === "connector_skill_approved" ? "Allowed" : effectiveConnectorRouting.status === "connector_skill_blocked" || effectiveConnectorRouting.status === "connector_skill_not_declared" || effectiveConnectorRouting.status === "connector_skill_not_enabled" ? "Blocked" : "NeedsMoreContext"
        },
        ...(interpretationReconciliation.reconciled
          ? [
              trace("interpretation_scope_reconciled", interpretationReconciliation.reason ?? "Interpretation scope was reconciled by approved connector route support.")
            ]
          : []),
        ...runtimeTrace
      ],
      executionTrace: [
        executionStep("user", "submit_issue", requestBody.message),
        ...(policyInterpretation
          ? [
              executionStep(
                "orchestrator",
                "interpret_request",
                `${policyInterpretation.scope} / ${policyInterpretation.intentType}: ${policyInterpretation.reason}`
              )
            ]
          : []),
        ...(interpretationReconciliation.reconciled
          ? [
              executionStep(
                "orchestrator",
                "reconcile_interpretation_scope",
                interpretationReconciliation.reason ?? "Interpretation scope was reconciled by approved connector route support."
              )
            ]
          : []),
        executionStep("orchestrator", "route_connector_intent", `${effectiveConnectorRouting.targetSystem ?? "unknown"} / ${effectiveConnectorRouting.connectorId ?? "no connector"} / ${effectiveConnectorRouting.skillId ?? "no skill"}`),
        executionStep("orchestrator", "evaluate_onboarded_connector", `${connectorStatus}: ${effectiveConnectorRouting.reason}`),
        executionStep("orchestrator", "evaluate_connector_policy", `${connectorPolicy.effect}: ${connectorPolicy.reason}`),
        ...runtimeExecutionTrace,
        ...metadataOnlyExecutionTrace,
        executionStep(
          "orchestrator",
          connectorRuntime?.authorizationRequirement ? "return_connector_authorization_required" : connectorRuntime?.executed ? "return_connector_runtime_response" : runtimeExecutable ? "return_connector_runtime_failure" : "return_connector_guidance",
          effectiveConnectorRouting.recommendedNextStep
        )
      ],
      securityDecisions: [],
      requestInterpretation: policyInterpretation,
      interpretationProof: effectiveInterpretationProof,
      followUpInterpretation: followUp,
      incidentContext: mergedIncidentContext,
      connectorRouting: effectiveConnectorRouting,
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
        const response = await postJson<AgentResponse | A2AAgentResponse | OgenA2AOutboundTaskEnvelope>(targetCard!.endpoint, delegatedTask, headers);
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
      const response = await postJson<AgentResponse | A2AAgentResponse | OgenA2AOutboundTaskEnvelope>(executableCard.endpoint, a2aTask, headers);
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

  if (process.env.ORCHESTRATOR_HTTP_FRAMEWORK === "fastify") {
    await startOgenFastifyServer(port, process.env.HOST ?? "127.0.0.1");
    return;
  }

  startJsonServer(port, async (request, response) => {
  cleanupExpiredUserIdentities();

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
    const access = await requireIdentityOrAdminAccess(request, response);
    if (!access) {
      return;
    }

    if (access.kind === "identity" && !await requireGatewayCapability({
      request,
      response,
      identitySession: access,
      capability: "health.read",
      route: "/agents/health",
      method: "GET"
    })) {
      return;
    }

    if (!allowByRateLimit(request, response, healthRateLimit)) {
      return;
    }

    sendJson(response, 200, await buildAgentsHealthResponse());
    return;
  }

  if (request.method === "GET" && request.url === "/debug/ai-config") {
    if (!hasValidClientApiKey(request)) {
      if (process.env.NODE_ENV !== "production" && process.env.ALLOW_DEBUG_AI_CONFIG_WITH_IDENTITY === "true") {
        const access = await requireIdentityOrAdminAccess(request, response);
        if (!access) {
          return;
        }
        if (access.kind === "identity" && !await requireGatewayCapability({
          request,
          response,
          identitySession: access,
          capability: "debug.ai_config.read",
          route: "/debug/ai-config",
          method: "GET"
        })) {
          return;
        }
      } else {
        sendJson(response, 403, { error: "admin_access_required" }, request);
        return;
      }
    }

    if (process.env.NODE_ENV === "production" && !hasValidClientApiKey(request)) {
      sendJson(response, 403, { error: "admin_access_required" }, request);
      return;
    }

    sendJson(response, 200, getSafeAiConfigSummary());
    return;
  }

  if (request.method === "POST" && request.url === "/session") {
    if (!allowByRateLimit(request, response, sessionRateLimit)) {
      return;
    }

    const existingSessionToken = getSessionToken(request);
    if (existingSessionToken) {
      const csrfToken = createCsrfTokenForSession(existingSessionToken);
      sendJson(response, 200, { ok: true, csrfToken }, request, {
        "set-cookie": csrfCookieHeader(csrfToken)
      });
      return;
    }

    const sessionToken = createSessionToken();
    const csrfToken = createCsrfTokenForSession(sessionToken);
    sendJson(
      response,
      200,
      { ok: true, csrfToken },
      request,
      {
        "set-cookie": [createSessionCookieForToken(sessionToken), csrfCookieHeader(csrfToken)]
      }
    );
    return;
  }

  if (request.method === "GET" && request.url === "/identity/session") {
    const identitySession = await requireFreshIdentitySession(request, response);
    if (!identitySession) {
      return;
    }

    sendJson(response, 200, publicIdentitySession(userIdentityProvider, identitySession.identity), request);
    return;
  }

  if (request.method === "GET" && request.url === "/identity/trust-status") {
    const adminView = hasValidClientApiKey(request);
    const identitySession = adminView ? undefined : await requireFreshIdentitySession(request, response);
    if (!adminView && !identitySession) {
      return;
    }
    if (identitySession && !await requireGatewayCapability({
      request,
      response,
      identitySession,
      capability: "identity.trust_status.read",
      route: "/identity/trust-status",
      method: "GET"
    })) {
      return;
    }

    sendJson(response, 200, buildTrustStatus(identitySession?.sessionToken ?? getSessionToken(request), adminView), request);
    return;
  }

  if (request.method === "POST" && request.url === "/identity/session") {
    if (!requireCsrfForBrowserMutation(request, response)) {
      return;
    }

    const sessionToken = requireSessionToken(request, response);
    if (!sessionToken) {
      return;
    }

    const token = bearerTokenFromHeaders(request.headers);
    if (!token) {
      sendJson(response, 401, { error: "missing_user_identity_bearer_token" }, request);
      return;
    }

    const requestBody = await readOptionalJsonBody<{ tenantId?: unknown }>(request);
    try {
      const identity = await userIdentityProvider.validateBearerToken(token);
      const tenantContext = tenantContextForRequest(identity, requestedTenantIdFromBody(requestBody));
      if (!requireRequestedTenantAllowed(tenantContext)) {
        await appendIdentityDeniedAuditEvent(identity, "tenant_access_denied", tenantContext);
        sendTenantAccessDenied(response, request, tenantContext);
        return;
      }

      const directoryAccess = await verifyUserDirectoryAccess({ identity, tenantId: tenantContext.tenantId });
      if (!directoryAccess.ok) {
        userIdentitiesBySession.delete(sessionToken);
        await appendIdentityDeniedAuditEvent(identity, directoryAccess.reason, tenantContext);
        sendJson(response, directoryAccess.status, {
          error: "user_directory_access_denied",
          message: directoryAccess.message
        }, request);
        return;
      }

      const allowedIdentity = identityWithDirectoryRoles(identity, directoryAccess.user.roles);
      userIdentitiesBySession.set(sessionToken, allowedIdentity);
      await appendIdentityVerifiedAuditEvent(allowedIdentity, tenantContext);
      sendJson(response, 200, publicIdentitySession(userIdentityProvider, allowedIdentity), request);
    } catch (error) {
      sendJson(response, 401, {
        error: "invalid_user_identity_token",
        detail: error instanceof Error ? error.message : "User identity validation failed"
      }, request);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/identity/demo-login") {
    if (!requireCsrfForBrowserMutation(request, response)) {
      return;
    }

    const sessionToken = requireSessionToken(request, response);
    if (!sessionToken) {
      return;
    }

    if (!allowByRateLimit(request, response, demoLoginRateLimit)) {
      return;
    }

    const body = await readJsonBody<{ email?: unknown; tenantId?: unknown }>(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) {
      sendJson(response, 400, { error: "invalid_demo_user_email" }, request);
      return;
    }

    if (userIdentityProvider.name !== "mock") {
      sendJson(response, 400, { error: "demo_login_unavailable_for_identity_provider" }, request);
      return;
    }

    try {
      const { accessToken } = await requestDemoUserToken(email);
      const identity = await userIdentityProvider.validateBearerToken(accessToken);
      const tenantContext = tenantContextForRequest(identity, requestedTenantIdFromBody(body));
      if (!requireRequestedTenantAllowed(tenantContext)) {
        await appendIdentityDeniedAuditEvent(identity, "tenant_access_denied", tenantContext);
        sendTenantAccessDenied(response, request, tenantContext);
        return;
      }

      const directoryAccess = await verifyUserDirectoryAccess({ identity, tenantId: tenantContext.tenantId });
      if (!directoryAccess.ok) {
        userIdentitiesBySession.delete(sessionToken);
        await appendIdentityDeniedAuditEvent(identity, directoryAccess.reason, tenantContext);
        sendJson(response, directoryAccess.status, {
          error: "user_directory_access_denied",
          message: directoryAccess.message
        }, request);
        return;
      }

      const allowedIdentity = identityWithDirectoryRoles(identity, directoryAccess.user.roles);
      userIdentitiesBySession.set(sessionToken, allowedIdentity);
      await appendIdentityVerifiedAuditEvent(allowedIdentity, tenantContext);
      sendJson(response, 200, publicIdentitySession(userIdentityProvider, allowedIdentity), request);
    } catch (error) {
      sendJson(response, 400, {
        error: "demo_login_failed",
        detail: error instanceof Error ? error.message : "Demo login failed"
      }, request);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/demo/end-user-ready") {
    if (!requireCsrfForBrowserMutation(request, response)) {
      return;
    }

    const registryKey = await agentCardRegistryKeyForIdentityOrAdmin(request, response);
    if (!registryKey) {
      return;
    }
    if (!hasValidClientApiKey(request)) {
      const identitySession = await requireFreshIdentitySession(request, response);
      if (!identitySession || !await requireGatewayCapability({
        request,
        response,
        identitySession,
        capability: "demo.prepare",
        route: "/demo/end-user-ready",
        method: "POST"
      })) {
        return;
      }
    }

    if (!allowByRateLimit(request, response, agentOnboardingRateLimit)) {
      return;
    }

    const result = await prepareEndUserDemoEnvironment(registryKey);
    sendJson(response, result.errors.length ? 503 : 200, result, request);
    return;
  }

  if (request.method === "POST" && request.url === "/identity/logout") {
    if (!requireCsrfForBrowserMutation(request, response)) {
      return;
    }

    const sessionToken = requireSessionToken(request, response);
    if (!sessionToken) {
      return;
    }

    userIdentitiesBySession.delete(sessionToken);
    sendJson(response, 200, publicIdentitySession(userIdentityProvider, undefined), request);
    return;
  }

  if (request.method === "GET" && request.url === "/agent-onboarding") {
    const registryKey = await agentCardRegistryKeyForIdentityOrAdmin(request, response);
    if (!registryKey) {
      return;
    }
    if (!hasValidClientApiKey(request)) {
      const identitySession = await requireFreshIdentitySession(request, response);
      if (!identitySession || !await requireGatewayCapability({
        request,
        response,
        identitySession,
        capability: "connector.onboarding.read",
        route: "/agent-onboarding",
        method: "GET"
      })) {
        return;
      }
    }

    if (!allowByRateLimit(request, response, agentOnboardingRateLimit)) {
      return;
    }

    sendJson(response, 200, { agents: await listTrustedOnboardedAgentsForOwner(registryKey) }, request);
    return;
  }

  if (request.method === "GET" && request.url === "/agent-onboarding/supported-connectors") {
    const registryKey = await agentCardRegistryKeyForIdentityOrAdmin(request, response);
    if (!registryKey) {
      return;
    }
    if (!hasValidClientApiKey(request)) {
      const identitySession = await requireFreshIdentitySession(request, response);
      if (!identitySession || !await requireGatewayCapability({
        request,
        response,
        identitySession,
        capability: "connector.onboarding.read",
        route: "/agent-onboarding/supported-connectors",
        method: "GET"
      })) {
        return;
      }
    }

    const installedAgents = await listTrustedOnboardedAgentsForOwner(registryKey);
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
      connectors: connectorTemplates
    }, request);
    return;
  }

  if (request.method === "POST" && request.url === "/agent-onboarding/discover") {
    if (!requireCsrfForBrowserMutation(request, response)) {
      return;
    }

    const registryKey = await agentCardRegistryKeyForIdentityOrAdmin(request, response);
    if (!registryKey) {
      return;
    }
    if (!hasValidClientApiKey(request)) {
      const identitySession = await requireFreshIdentitySession(request, response);
      if (!identitySession || !await requireGatewayCapability({
        request,
        response,
        identitySession,
        capability: "connector.onboarding.discover",
        route: "/agent-onboarding/discover",
        method: "POST"
      })) {
        return;
      }
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
    if (!requireCsrfForBrowserMutation(request, response)) {
      return;
    }

    const registryKey = await agentCardRegistryKeyForIdentityOrAdmin(request, response);
    if (!registryKey) {
      return;
    }
    if (!hasValidClientApiKey(request)) {
      const identitySession = await requireFreshIdentitySession(request, response);
      if (!identitySession || !await requireGatewayCapability({
        request,
        response,
        identitySession,
        capability: "connector.onboarding.start",
        route: "/agent-onboarding/start",
        method: "POST"
      })) {
        return;
      }
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
      trustedAgents: await listTrustedOnboardedAgentsForOwner(registryKey)
    }, request);
    return;
  }

  const auditEventsUrl = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && auditEventsUrl.pathname === "/audit/events") {
    const identitySession = await requireFreshIdentitySession(request, response);
    if (!identitySession) {
      return;
    }

    const parsedAuditQuery = parseAuditEventsQuery(auditEventsUrl.searchParams);
    if (!parsedAuditQuery.ok) {
      sendJson(response, 400, {
        error: "invalid_audit_events_query",
        message: parsedAuditQuery.message
      }, request);
      return;
    }

    const auditTenantContext = tenantContextForRequest(identitySession.identity, parsedAuditQuery.query.tenantIdHint);
    if (!requireRequestedTenantAllowed(auditTenantContext)) {
      await appendTenantAccessDeniedAuditEvent({
        actor: identitySession.identity,
        tenantContext: auditTenantContext,
        route: "/audit/events"
      });
      sendTenantAccessDenied(response, request, auditTenantContext);
      return;
    }

    const auditIdentitySession = { ...identitySession, tenantContext: auditTenantContext };
    if (!await requireGatewayCapability({
      request,
      response,
      identitySession: auditIdentitySession,
      capability: "audit.read",
      route: "/audit/events",
      method: "GET"
    })) {
      return;
    }

    const query = parsedAuditQuery.query;
    const auditPage = await listAuditViewerEventsPage({
      store: getPlatformStateStore(),
      tenantId: auditTenantContext.tenantId,
      query
    });
    if (!auditPage.ok) {
      sendJson(response, auditPage.status, auditPage.body, request);
      return;
    }

    const body: AuditEventsResponse = auditPage.body;

    sendJson(response, 200, body, request);
    return;
  }

  if (request.method === "POST" && request.url === "/runtime/authorize") {
    if (!requireCsrfForBrowserMutation(request, response)) {
      return;
    }

    const identitySession = await requireFreshIdentitySession(request, response);
    if (!identitySession) {
      return;
    }

    if (!allowByRateLimit(request, response, runtimeAuthorizeRateLimit)) {
      return;
    }

    const requestBodyUnknown = await readJsonBody<unknown>(request);
    const validationError = validateRuntimeAuthorizationRequest(requestBodyUnknown);
    if (validationError) {
      sendJson(response, 400, {
        error: "invalid_runtime_authorization_request",
        message: validationError
      }, request);
      return;
    }

    const requestBody = requestBodyUnknown as RuntimeAuthorizationRequest;
    const tenantContext = tenantContextForRequest(identitySession.identity, requestBody.tenantId);
    if (!requireRequestedTenantAllowed(tenantContext)) {
      await appendTenantAccessDeniedAuditEvent({
        actor: identitySession.identity,
        tenantContext,
        route: "/runtime/authorize",
        requestId: safeRequestIdFromBody(requestBodyUnknown),
        conversationId: safeConversationIdFromBody(requestBodyUnknown)
      });
      sendTenantAccessDenied(response, request, tenantContext);
      return;
    }
    const runtimeIdentitySession = { ...identitySession, tenantContext };
    if (!await requireGatewayCapability({
      request,
      response,
      identitySession: runtimeIdentitySession,
      capability: "runtime.authorize",
      route: "/runtime/authorize",
      method: "POST"
    })) {
      return;
    }

    const authorization = evaluateRuntimeAuthorization({
      request: requestBody,
      identity: identitySession.identity,
      tenantId: tenantContext.tenantId,
      tenantResolution: tenantContext
    });
    await appendRuntimeAuthorizationEvaluatedAuditEvent({
      authorization,
      requestBody,
      actor: identitySession.identity,
      tenantContext
    });

    sendJson(response, 200, authorization, request);
    return;
  }

  if (request.method !== "POST" || request.url !== "/resolve") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (!requireCsrfForBrowserMutation(request, response)) {
    return;
  }

  const identitySession = await requireFreshIdentitySession(request, response);
  if (!identitySession) {
    return;
  }

  if (!allowByRateLimit(request, response, resolveRateLimit)) {
    return;
  }

  const unsupportedA2AVersion = unsupportedExplicitA2AProtocolVersion(request.headers);
  if (unsupportedA2AVersion) {
    sendJson(response, 400, buildUnsupportedA2AProtocolVersionResponse(unsupportedA2AVersion), request, { "content-type": A2A_CONTENT_TYPE });
    return;
  }

  const requestBodyUnknown = await readJsonBody<unknown>(request);
  const normalizedResolve = normalizeResolveRequestInput(requestBodyUnknown);
  if (!normalizedResolve.ok) {
    sendJson(response, 400, normalizedResolve.response, request, { "content-type": A2A_CONTENT_TYPE });
    return;
  }

  const resolveValidationError = validateResolveRequest(normalizedResolve.value);
  if (resolveValidationError) {
    sendJson(response, 400, {
      error: "invalid_resolve_request",
      message: resolveValidationError
    }, request);
    return;
  }
  const requestBody = normalizedResolve.value as ResolveRequest;

  const tenantContext = tenantContextForRequest(
    identitySession.identity,
    normalizedResolve.requestedCompatibilityEnvelope ? undefined : requestedTenantIdFromBody(requestBodyUnknown)
  );
  if (!requireRequestedTenantAllowed(tenantContext)) {
    await appendTenantAccessDeniedAuditEvent({
      actor: identitySession.identity,
      tenantContext,
      route: "/resolve",
      conversationId: requestBody.conversationId
    });
    sendTenantAccessDenied(response, request, tenantContext);
    return;
  }
  const resolveIdentitySession = { ...identitySession, tenantContext };
  if (!await requireGatewayCapability({
    request,
    response,
    identitySession: resolveIdentitySession,
    capability: "gateway.resolve",
    route: "/resolve",
    method: "POST"
  })) {
    return;
  }

  const resolveResult = await resolveIssue(requestBody, identitySession.sessionToken, tenantContext);
  if (normalizedResolve.requestedCompatibilityEnvelope) {
    sendJson(
      response,
      200,
      internalA2AResponseToOutboundA2AEnvelope(resolveResult, normalizedResolve.proof, {
        taskId: normalizedResolve.proof.correlation.taskId,
        contextId: resolveResult.conversationId
      }),
      request,
      { "content-type": A2A_CONTENT_TYPE }
    );
    return;
  }

  sendJson(response, 200, resolveResult);
  });
}

void start();
