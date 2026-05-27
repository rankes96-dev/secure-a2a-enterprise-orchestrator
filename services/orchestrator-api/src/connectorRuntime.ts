import { randomUUID } from "node:crypto";
import type {
  A2AAgentResponse,
  ConnectorRuntimeExecutionType,
  ConnectorRuntimeOutcome,
  ConnectorRuntimeSemantics,
  ConnectorTargetActionStatus,
  EndUserAnswer,
  ExternalAuthorizationRequirement
} from "@a2a/shared";
import { a2aJsonRequestHeaders } from "@a2a/shared";
import { getA2AAccessToken, type A2AIssuedTokenMetadata } from "./security/tokenClient.js";
import type { VerifiedUserIdentity } from "./security/userIdentity.js";
import type { ConnectorRoutingDecision } from "./connectorRouting.js";
import { validateTrustedConnectorRuntimeEndpoint } from "./security/connectorRuntimeSafety.js";

export type ConnectorRuntimeResult = {
  executed: boolean;
  runtimeMode: "external_runtime" | "external_runtime_failed" | "metadata_only";
  connectorId?: string;
  resourceSystem?: string;
  skillId?: string;
  runtimeEndpoint?: string;
  tokenMetadata?: {
    tokenIssued: boolean;
    audience: string;
    scope: string;
    actor?: string;
    actorRoles?: string[];
    actorProvider?: string;
    actorIssuer?: string;
    actorSubject?: string;
    rawToken: "hidden";
  };
  agentResponse?: A2AAgentResponse;
  authorizationRequirement?: ExternalAuthorizationRequirement;
  error?: string;
  errorMessage?: string;
};

const connectorRuntimeTimeoutMs = 5_000;
const maxConnectorRuntimeJsonBytes = 64 * 1024;
const forbiddenResponseKeyMarkers = [
  "token",
  "jwt",
  "a2atoken",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "idtoken",
  "id_token",
  "authorization",
  "bearer",
  "clientassertion",
  "client_assertion",
  "clientsecret",
  "client_secret",
  "privatekey",
  "private_key",
  "cookie",
  "setcookie",
  "set-cookie"
];
const compactJwtPattern = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
const dangerousRuntimeStringPattern = /Bearer\s+\S+|Authorization:|access_token|refresh_token|client_secret|private_key|authorization_code/i;

function normalizeResponseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function dangerousRuntimeResponseKey(key: string): boolean {
  const normalized = normalizeResponseKey(key);
  return forbiddenResponseKeyMarkers.some((marker) => normalized.includes(normalizeResponseKey(marker)));
}

function dangerousRuntimeResponseString(value: string): boolean {
  return dangerousRuntimeStringPattern.test(value) || compactJwtPattern.test(value);
}

function publicTokenMetadata(metadata: A2AIssuedTokenMetadata, actorProvider?: string): ConnectorRuntimeResult["tokenMetadata"] {
  return {
    tokenIssued: metadata.tokenIssued,
    audience: metadata.audience,
    scope: metadata.scope,
    actor: metadata.actor,
    actorRoles: metadata.actorRoles,
    actorProvider: metadata.actorProvider ?? actorProvider,
    actorIssuer: metadata.actorIssuer,
    actorSubject: metadata.actorSubject,
    rawToken: "hidden"
  };
}

export function sanitizeConnectorRuntimeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return dangerousRuntimeResponseString(value) ? "hidden" : value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeConnectorRuntimeValue);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        dangerousRuntimeResponseKey(key) ? "hidden" : sanitizeConnectorRuntimeValue(nested)
      ])
    );
  }

  return value;
}

function runtimeExecutionType(value: unknown): ConnectorRuntimeExecutionType | undefined {
  return value === "diagnostic_read_only" || value === "write_action" || value === "inspection_read_only" || value === "unsupported"
    ? value
    : undefined;
}

function runtimeOutcome(value: unknown): ConnectorRuntimeOutcome | undefined {
  return value === "diagnosed" || value === "executed" || value === "blocked" || value === "needs_more_info" || value === "unsupported" || value === "error"
    ? value
    : undefined;
}

function targetActionStatus(value: unknown): ConnectorTargetActionStatus | undefined {
  return value === "ready" ||
    value === "not_enabled" ||
    value === "missing_application_grants" ||
    value === "missing_effective_permissions" ||
    value === "explicitly_denied" ||
    value === "unknown"
    ? value
    : undefined;
}

function normalizeRuntimeSemantics(value: unknown): ConnectorRuntimeSemantics | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const executionType = runtimeExecutionType(record.executionType);
  const outcome = runtimeOutcome(record.outcome);
  if (!executionType || !outcome || typeof record.executedSkillId !== "string") {
    return undefined;
  }

  return {
    executionType,
    outcome,
    executedSkillId: record.executedSkillId,
    targetActionId: typeof record.targetActionId === "string" ? record.targetActionId : undefined,
    targetActionLabel: typeof record.targetActionLabel === "string" ? record.targetActionLabel : undefined,
    targetActionStatus: targetActionStatus(record.targetActionStatus),
    writeActionAttempted: record.writeActionAttempted === true,
    diagnosticOnly: record.diagnosticOnly === true
  };
}

function normalizeEndUserAnswer(value: unknown): EndUserAnswer | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const severity = record.severity === "info" || record.severity === "low" || record.severity === "medium" || record.severity === "high"
    ? record.severity
    : undefined;
  if (
    record.safeToDisplay !== true ||
    !sanitizedRuntimeString(record.title) ||
    !sanitizedRuntimeString(record.summary) ||
    !sanitizedRuntimeString(record.nextStep)
  ) {
    return undefined;
  }

  return {
    title: sanitizedRuntimeString(record.title) ?? "External connector response",
    summary: sanitizedRuntimeString(record.summary) ?? "External connector returned a safe display response.",
    whatWasChecked: optionalSanitizedRuntimeString(record.whatWasChecked),
    whatWasChanged: optionalSanitizedRuntimeString(record.whatWasChanged),
    nextStep: sanitizedRuntimeString(record.nextStep) ?? "Review connector logs.",
    severity,
    safeToDisplay: true
  };
}

function sanitizedRuntimeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const sanitized = sanitizeConnectorRuntimeValue(value);
  if (typeof sanitized !== "string") {
    return undefined;
  }

  const trimmed = sanitized.trim();
  return trimmed && trimmed !== "hidden" ? trimmed : undefined;
}

function optionalSanitizedRuntimeString(value: unknown): string | undefined {
  return value === undefined ? undefined : sanitizedRuntimeString(value);
}

function normalizeAuthorizationRequirement(value: unknown): ExternalAuthorizationRequirement | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (record.type !== "authorization_required") {
    return undefined;
  }

  const provider = sanitizedRuntimeString(record.provider);
  const resourceSystem = sanitizedRuntimeString(record.resourceSystem);
  const connectorId = sanitizedRuntimeString(record.connectorId);
  const reason = sanitizedRuntimeString(record.reason);
  const authorizeUrlText = sanitizedRuntimeString(record.authorizeUrl);
  const requestedScopes = Array.isArray(record.requestedScopes)
    ? record.requestedScopes
        .map((scope) => sanitizedRuntimeString(scope))
        .filter((scope): scope is string => Boolean(scope))
    : [];
  let authorizeUrl: string | undefined;
  if (authorizeUrlText) {
    try {
      const url = new URL(authorizeUrlText);
      authorizeUrl = url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined;
    } catch {
      authorizeUrl = undefined;
    }
  }
  if (!provider || !resourceSystem || !connectorId || !reason || !authorizeUrl || requestedScopes.length === 0) {
    return undefined;
  }

  if (!Array.isArray(record.requestedScopes) || !record.requestedScopes.every((scope) => typeof scope === "string")) {
    return undefined;
  }

  return {
    type: "authorization_required",
    provider,
    resourceSystem,
    connectorId,
    reason,
    authorizeUrl,
    requestedScopes,
    actorProvider: optionalSanitizedRuntimeString(record.actorProvider),
    actorSubject: optionalSanitizedRuntimeString(record.actorSubject),
    actorEmail: optionalSanitizedRuntimeString(record.actorEmail),
    expiresAt: optionalSanitizedRuntimeString(record.expiresAt)
  };
}

async function readJsonWithLimit(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > maxConnectorRuntimeJsonBytes) {
    throw new Error("external connector runtime response exceeded size limit");
  }
  return text ? sanitizeConnectorRuntimeValue(JSON.parse(text)) : {};
}

export function normalizeRuntimeResponse(value: unknown): A2AAgentResponse {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      agentId: typeof record.agentId === "string" ? record.agentId : "external-connector-agent",
      status: record.status === "diagnosed" || record.status === "completed" || record.status === "needs_more_info" || record.status === "blocked" || record.status === "unsupported" || record.status === "error"
        ? record.status
        : "diagnosed",
      summary: sanitizedRuntimeString(record.summary) ?? "External connector runtime returned a response.",
      probableCause: optionalSanitizedRuntimeString(record.probableCause),
      recommendedActions: Array.isArray(record.recommendedActions)
        ? record.recommendedActions.map((item) => sanitizedRuntimeString(item)).filter((item): item is string => Boolean(item))
        : undefined,
      endUserAnswer: normalizeEndUserAnswer(record.endUserAnswer),
      authorizationRequirement: normalizeAuthorizationRequirement(record.authorizationRequirement),
      clarifyingQuestions: Array.isArray(record.clarifyingQuestions) ? record.clarifyingQuestions.filter((item): item is string => typeof item === "string") : undefined,
      runtimeSemantics: normalizeRuntimeSemantics(record.runtimeSemantics),
      evidence: Array.isArray(record.evidence)
        ? record.evidence
            .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
            .map((item) => ({
              title: sanitizedRuntimeString(item.title) ?? "External connector evidence",
              data: sanitizeConnectorRuntimeValue(item.data)
            }))
        : undefined,
      trace: Array.isArray(record.trace)
        ? record.trace
            .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
            .map((item) => ({
              agent: sanitizedRuntimeString(item.agent) ?? "external-connector-agent",
              action: sanitizedRuntimeString(item.action) ?? "external_connector_runtime_response",
              detail: sanitizedRuntimeString(item.detail) ?? "External connector runtime returned a response.",
              timestamp: typeof item.timestamp === "string" ? item.timestamp : new Date().toISOString()
            }))
        : undefined
    };
  }

  return {
    agentId: "external-connector-agent",
    status: "error",
    summary: "External connector runtime returned an invalid response.",
    probableCause: "Runtime response was not a JSON object.",
    recommendedActions: ["Retry the connector runtime after inspecting external agent logs."]
  };
}

function runtimeErrorFromBody(value: unknown): { error: string; errorMessage?: string } {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      error: sanitizedRuntimeString(record.error) ?? "external connector runtime failed",
      errorMessage: optionalSanitizedRuntimeString(record.message)
    };
  }

  return { error: "external connector runtime failed" };
}

export async function executeApprovedConnectorSkill(params: {
  message: string;
  currentUserMessage?: string;
  conversationId: string;
  connectorRoute: ConnectorRoutingDecision;
  actor?: VerifiedUserIdentity;
}): Promise<ConnectorRuntimeResult> {
  if (params.connectorRoute.status !== "connector_skill_approved") {
    return {
      executed: false,
      runtimeMode: "metadata_only",
      error: "connector skill is not approved for runtime execution"
    };
  }

  if (!params.connectorRoute.trustedRuntimeEndpoint) {
    return {
      executed: false,
      runtimeMode: "external_runtime_failed",
      connectorId: params.connectorRoute.connectorId,
      resourceSystem: params.connectorRoute.resourceSystem,
      skillId: params.connectorRoute.skillId,
      runtimeEndpoint: params.connectorRoute.runtimeEndpoint,
      error: "trusted runtime endpoint metadata is missing"
    };
  }

  const endpoint = validateTrustedConnectorRuntimeEndpoint({
    endpoint: params.connectorRoute.runtimeEndpoint,
    expectedEndpoint: params.connectorRoute.trustedRuntimeEndpoint
  });
  if (!endpoint.ok) {
    return {
      executed: false,
      runtimeMode: "external_runtime_failed",
      connectorId: params.connectorRoute.connectorId,
      resourceSystem: params.connectorRoute.resourceSystem,
      skillId: params.connectorRoute.skillId,
      runtimeEndpoint: params.connectorRoute.runtimeEndpoint,
      error: endpoint.error
    };
  }

  const requiredApplicationGrants = params.connectorRoute.requiredApplicationGrants ?? [];
  if (!params.connectorRoute.audience || requiredApplicationGrants.length === 0) {
    return {
      executed: false,
      runtimeMode: "external_runtime_failed",
      connectorId: params.connectorRoute.connectorId,
      resourceSystem: params.connectorRoute.resourceSystem,
      skillId: params.connectorRoute.skillId,
      runtimeEndpoint: endpoint.url.toString(),
      error: "external connector runtime token scope could not be derived"
    };
  }

  try {
    const scope = requiredApplicationGrants.join(" ");
    const issued = await getA2AAccessToken({
      audience: params.connectorRoute.audience,
      scope,
      actor: params.actor?.email,
      actorRoles: params.actor?.roles,
      actorProvider: params.actor?.provider,
      actorIssuer: params.actor?.issuer,
      actorSubject: params.actor?.subject
    });
    const taskId = randomUUID();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), connectorRuntimeTimeoutMs);
    let runtimeResponse: Response;
    let body: unknown;
    try {
      runtimeResponse = await fetch(endpoint.url, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          ...a2aJsonRequestHeaders(),
          authorization: `Bearer ${issued.accessToken}`
        },
        body: JSON.stringify({
          taskId,
          conversationId: params.conversationId,
          connectorId: params.connectorRoute.connectorId,
          resourceSystem: params.connectorRoute.resourceSystem,
          skillId: params.connectorRoute.skillId,
          message: params.message,
          context: {
            targetSystem: params.connectorRoute.targetSystem,
            intentClass: params.connectorRoute.intentClass,
            targetResourceSystem: params.connectorRoute.targetResourceSystem,
            targetResourceName: params.connectorRoute.targetResourceName,
            requestedAccessLevel: params.connectorRoute.requestedAccessLevel,
            fulfillmentCapability: params.connectorRoute.fulfillmentCapability,
            missingFields: params.connectorRoute.missingFields,
            currentUserMessage: params.currentUserMessage,
            runtimeMode: "external_connector_runtime",
            actor: params.actor
              ? {
                  email: params.actor.email,
                  roles: [...params.actor.roles],
                  provider: params.actor.provider,
                  issuer: params.actor.issuer,
                  subject: params.actor.subject
                }
              : undefined
          },
          trustedContext: {
            externalConfigHash: params.connectorRoute.externalConfigHash,
            connectorProfileHash: params.connectorRoute.connectorProfileHash
          }
        })
      });
      body = await readJsonWithLimit(runtimeResponse);
    } finally {
      clearTimeout(timeout);
    }

    if (!runtimeResponse.ok) {
      return {
        executed: false,
        runtimeMode: "external_runtime_failed",
        connectorId: params.connectorRoute.connectorId,
        resourceSystem: params.connectorRoute.resourceSystem,
        skillId: params.connectorRoute.skillId,
        runtimeEndpoint: endpoint.url.toString(),
        tokenMetadata: publicTokenMetadata(issued.metadata, params.actor?.provider),
        ...runtimeErrorFromBody(body)
      };
    }

    const agentResponse = normalizeRuntimeResponse(body);
    return {
      executed: true,
      runtimeMode: "external_runtime",
      connectorId: params.connectorRoute.connectorId,
      resourceSystem: params.connectorRoute.resourceSystem,
      skillId: params.connectorRoute.skillId,
      runtimeEndpoint: endpoint.url.toString(),
      tokenMetadata: publicTokenMetadata(issued.metadata, params.actor?.provider),
      agentResponse,
      authorizationRequirement: agentResponse.authorizationRequirement
    };
  } catch {
    return {
      executed: false,
      runtimeMode: "external_runtime_failed",
      connectorId: params.connectorRoute.connectorId,
      resourceSystem: params.connectorRoute.resourceSystem,
      skillId: params.connectorRoute.skillId,
      runtimeEndpoint: endpoint.url.toString(),
      error: "external connector runtime failed"
    };
  }
}
