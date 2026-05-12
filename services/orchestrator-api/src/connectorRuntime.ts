import { randomUUID } from "node:crypto";
import type { A2AAgentResponse, ConnectorRuntimeExecutionType, ConnectorRuntimeOutcome, ConnectorRuntimeSemantics, ConnectorTargetActionStatus, EndUserAnswer } from "@a2a/shared";
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
    rawToken: "hidden";
  };
  agentResponse?: A2AAgentResponse;
  error?: string;
  errorMessage?: string;
};

const connectorRuntimeTimeoutMs = 5_000;
const maxConnectorRuntimeJsonBytes = 64 * 1024;
const forbiddenResponseKeys = new Set(["rawtoken", "authorization", "access_token", "refresh_token", "client_assertion", "private_key", "client_secret", "bearer"]);

function publicTokenMetadata(metadata: A2AIssuedTokenMetadata): ConnectorRuntimeResult["tokenMetadata"] {
  return {
    tokenIssued: metadata.tokenIssued,
    audience: metadata.audience,
    scope: metadata.scope,
    actor: metadata.actor,
    actorRoles: metadata.actorRoles,
    rawToken: "hidden"
  };
}

function sanitizeConnectorRuntimeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return /Bearer\s+|Authorization:|access_token|refresh_token|client_assertion|private_key|client_secret/i.test(value) ? "hidden" : value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeConnectorRuntimeValue);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        forbiddenResponseKeys.has(key.toLowerCase()) ? "hidden" : sanitizeConnectorRuntimeValue(nested)
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
    typeof record.title !== "string" ||
    typeof record.summary !== "string" ||
    typeof record.nextStep !== "string"
  ) {
    return undefined;
  }

  return {
    title: record.title,
    summary: record.summary,
    whatWasChecked: typeof record.whatWasChecked === "string" ? record.whatWasChecked : undefined,
    whatWasChanged: typeof record.whatWasChanged === "string" ? record.whatWasChanged : undefined,
    nextStep: record.nextStep,
    severity,
    safeToDisplay: true
  };
}

async function readJsonWithLimit(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > maxConnectorRuntimeJsonBytes) {
    throw new Error("external connector runtime response exceeded size limit");
  }
  return text ? sanitizeConnectorRuntimeValue(JSON.parse(text)) : {};
}

function normalizeRuntimeResponse(value: unknown): A2AAgentResponse {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      agentId: typeof record.agentId === "string" ? record.agentId : "external-connector-agent",
      status: record.status === "diagnosed" || record.status === "completed" || record.status === "needs_more_info" || record.status === "blocked" || record.status === "unsupported" || record.status === "error"
        ? record.status
        : "diagnosed",
      summary: typeof record.summary === "string" ? record.summary : "External connector runtime returned a response.",
      probableCause: typeof record.probableCause === "string" ? record.probableCause : undefined,
      recommendedActions: Array.isArray(record.recommendedActions) ? record.recommendedActions.filter((item): item is string => typeof item === "string") : undefined,
      endUserAnswer: normalizeEndUserAnswer(record.endUserAnswer),
      clarifyingQuestions: Array.isArray(record.clarifyingQuestions) ? record.clarifyingQuestions.filter((item): item is string => typeof item === "string") : undefined,
      runtimeSemantics: normalizeRuntimeSemantics(record.runtimeSemantics),
      evidence: Array.isArray(record.evidence)
        ? record.evidence
            .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
            .map((item) => ({
              title: typeof item.title === "string" ? item.title : "External connector evidence",
              data: sanitizeConnectorRuntimeValue(item.data)
            }))
        : undefined,
      trace: Array.isArray(record.trace)
        ? record.trace
            .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
            .map((item) => ({
              agent: typeof item.agent === "string" ? item.agent : "external-connector-agent",
              action: typeof item.action === "string" ? item.action : "external_connector_runtime_response",
              detail: typeof item.detail === "string" ? item.detail : "External connector runtime returned a response.",
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
      error: typeof record.error === "string" ? record.error : "external connector runtime failed",
      errorMessage: typeof record.message === "string" ? record.message : undefined
    };
  }

  return { error: "external connector runtime failed" };
}

export async function executeApprovedConnectorSkill(params: {
  message: string;
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
      actorRoles: params.actor?.roles
    });
    const taskId = randomUUID();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), connectorRuntimeTimeoutMs);
    const runtimeResponse = await fetch(endpoint.url, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
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
          runtimeMode: "external_connector_runtime",
          actor: params.actor
            ? {
                email: params.actor.email,
                roles: [...params.actor.roles]
              }
            : undefined
        },
        trustedContext: {
          externalConfigHash: params.connectorRoute.externalConfigHash,
          connectorProfileHash: params.connectorRoute.connectorProfileHash
        }
      })
    });
    clearTimeout(timeout);

    const body = await readJsonWithLimit(runtimeResponse);

    if (!runtimeResponse.ok) {
      return {
        executed: false,
        runtimeMode: "external_runtime_failed",
        connectorId: params.connectorRoute.connectorId,
        resourceSystem: params.connectorRoute.resourceSystem,
        skillId: params.connectorRoute.skillId,
        runtimeEndpoint: endpoint.url.toString(),
        tokenMetadata: publicTokenMetadata(issued.metadata),
        ...runtimeErrorFromBody(body)
      };
    }

    return {
      executed: true,
      runtimeMode: "external_runtime",
      connectorId: params.connectorRoute.connectorId,
      resourceSystem: params.connectorRoute.resourceSystem,
      skillId: params.connectorRoute.skillId,
      runtimeEndpoint: endpoint.url.toString(),
      tokenMetadata: publicTokenMetadata(issued.metadata),
      agentResponse: normalizeRuntimeResponse(body)
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
