import { randomUUID } from "node:crypto";
import type { A2AAgentResponse } from "@a2a/shared";
import { getA2AAccessToken, type A2AIssuedTokenMetadata } from "./security/tokenClient";
import type { VerifiedUserIdentity } from "./security/userIdentity";
import type { ConnectorRoutingDecision } from "./connectorRouting";

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
};

const connectorRuntimeTimeoutMs = 5_000;
const maxConnectorRuntimeJsonBytes = 64 * 1024;
const forbiddenResponseKeys = new Set(["rawtoken", "authorization", "access_token", "refresh_token", "client_assertion", "private_key", "client_secret"]);

function validateTrustedConnectorRuntimeEndpoint(endpoint: string | undefined): { ok: true; url: URL } | { ok: false; error: string } {
  if (!endpoint) {
    return { ok: false, error: "external connector runtime endpoint is not available" };
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, error: "external connector runtime endpoint is invalid" };
  }

  if (url.username || url.password) {
    return { ok: false, error: "external connector runtime endpoint must not include credentials" };
  }

  // Local demo allowlist: the endpoint still must come from successful onboarding.
  // Future connector runtimes should extend this allowlist through deployment config,
  // not connector-specific Gateway branches.
  if (url.protocol !== "http:" || url.hostname !== "localhost" || url.port !== "4201" || url.pathname !== "/a2a/task" || url.search || url.hash) {
    return { ok: false, error: "external connector runtime endpoint is not allowlisted" };
  }

  return { ok: true, url };
}

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
    return /Bearer\s+|Authorization:|access_token|client_assertion|private_key|client_secret/i.test(value) ? "hidden" : value;
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
      status: record.status === "diagnosed" || record.status === "needs_more_info" || record.status === "blocked" || record.status === "unsupported" || record.status === "error"
        ? record.status
        : "diagnosed",
      summary: typeof record.summary === "string" ? record.summary : "External connector runtime returned a response.",
      probableCause: typeof record.probableCause === "string" ? record.probableCause : undefined,
      recommendedActions: Array.isArray(record.recommendedActions) ? record.recommendedActions.filter((item): item is string => typeof item === "string") : undefined,
      clarifyingQuestions: Array.isArray(record.clarifyingQuestions) ? record.clarifyingQuestions.filter((item): item is string => typeof item === "string") : undefined,
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

  const endpoint = validateTrustedConnectorRuntimeEndpoint(params.connectorRoute.runtimeEndpoint);
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
          runtimeMode: "external_connector_runtime",
          actor: params.actor
            ? {
                email: params.actor.email,
                roles: [...params.actor.roles]
              }
            : undefined
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
        error: "external connector runtime failed"
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
