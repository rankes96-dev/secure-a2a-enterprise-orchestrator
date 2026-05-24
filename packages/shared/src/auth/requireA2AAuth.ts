import type { IncomingMessage } from "node:http";
import type { A2AAgentResponse, A2AAuthMode, A2ATask, A2ATokenClaims, AgentTask } from "../index.js";
import { verifyA2AToken } from "./verifyA2AToken.js";

export type RequireA2AAuthInput = {
  request: IncomingMessage;
  task: A2ATask | AgentTask;
  agentId: string;
  expectedAudience: string;
  requiredScope?: string;
  authMode?: A2AAuthMode;
  expectedIssuer?: string;
  jwksUri?: string;
};

export type RequireA2AAuthResult =
  | {
      ok: true;
      taskAuth?: A2ATask["context"]["auth"];
    }
  | {
      ok: false;
      statusCode: 401 | 403;
      response: A2AAgentResponse;
    };

export function currentA2AAuthMode(): A2AAuthMode {
  return process.env.A2A_AUTH_MODE === "oauth2_client_credentials_jwt" ? "oauth2_client_credentials_jwt" : "mock_internal_token";
}

export function secureA2AAuthRequired(): boolean {
  return process.env.REQUIRE_SECURE_A2A_AUTH === "true";
}

export function assertSecureA2AAuthMode(serviceName: string): A2AAuthMode {
  const authMode = currentA2AAuthMode();

  if (secureA2AAuthRequired() && authMode !== "oauth2_client_credentials_jwt") {
    throw new Error(`[${serviceName}] REQUIRE_SECURE_A2A_AUTH=true requires A2A_AUTH_MODE=oauth2_client_credentials_jwt.`);
  }

  return authMode;
}

function blocked(agentId: string, statusCode: 401 | 403, summary: string): RequireA2AAuthResult {
  return {
    ok: false,
    statusCode,
    response: {
      agentId,
      status: "blocked",
      summary,
      trace: [
        {
          agent: agentId,
          action: "A2A_AUTH_BLOCKED",
          detail: summary,
          timestamp: new Date().toISOString()
        }
      ]
    }
  };
}

function hasA2AContext(task: A2ATask | AgentTask): task is A2ATask {
  return "context" in task;
}

function taskContextMismatch(expected: string | undefined, actual: string | undefined): boolean {
  return Boolean(expected && expected !== actual);
}

export function validateA2ADelegationClaimBinding(task: A2ATask, claims: A2ATokenClaims): { ok: true } | { ok: false; reason: string } {
  if ((claims.delegation_depth ?? 0) > 1) {
    return { ok: false, reason: "Delegation depth exceeds allowed limit" };
  }

  if (claims.delegated_by && claims.delegation_depth === undefined) {
    return { ok: false, reason: "Delegation token is missing delegation depth" };
  }

  if ((claims.delegation_depth ?? 0) > 0 && !claims.delegated_by) {
    return { ok: false, reason: "Delegation token is missing delegated_by" };
  }

  if (taskContextMismatch(claims.parent_task_id, task.parentTaskId)) {
    return { ok: false, reason: "Delegation token parent_task_id does not match task context" };
  }

  if (taskContextMismatch(claims.requested_by_agent, task.requestedByAgent)) {
    return { ok: false, reason: "Delegation token requested_by_agent does not match task context" };
  }

  if (claims.delegated_by) {
    const expectedDelegators = [task.fromAgent, task.requestedByAgent].filter((item): item is string => typeof item === "string" && item.length > 0);
    if (expectedDelegators.length > 0 && !expectedDelegators.includes(claims.delegated_by)) {
      return { ok: false, reason: "Delegation token delegated_by does not match requesting agent context" };
    }
  }

  if (task.context.actor?.subject && claims.actor_sub !== task.context.actor.subject) {
    return { ok: false, reason: "A2A JWT actor subject does not match task context" };
  }

  if (task.context.actor?.provider && claims.actor_provider !== task.context.actor.provider) {
    return { ok: false, reason: "A2A JWT actor provider does not match task context" };
  }

  if (task.context.actor?.email && claims.actor !== task.context.actor.email) {
    return { ok: false, reason: "A2A JWT actor does not match task context" };
  }

  return { ok: true };
}

function validateInternalServiceToken(request: IncomingMessage, agentId: string): RequireA2AAuthResult {
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  if (!expected) {
    return blocked(agentId, 401, "INTERNAL_SERVICE_TOKEN is not configured");
  }

  if (request.headers["x-internal-service-token"] !== expected) {
    return blocked(agentId, 401, "Unauthorized internal service token");
  }

  return { ok: true };
}

export function formatA2AAuthTraceDetail(auth?: A2ATask["context"]["auth"]): string {
  const scope = auth?.scope ?? "unknown";

  if (auth?.delegatedBy) {
    return `Validated delegated JWT issuer, audience, expiration, required scope ${scope}, delegated_by ${auth.delegatedBy}, depth ${auth.delegationDepth ?? "unknown"}`;
  }

  return `Validated JWT issuer, audience, expiration, and required scope ${scope}`;
}

export async function requireA2AAuth(input: RequireA2AAuthInput): Promise<RequireA2AAuthResult> {
  const authMode = input.authMode ?? currentA2AAuthMode();

  if (authMode !== "oauth2_client_credentials_jwt") {
    return validateInternalServiceToken(input.request, input.agentId);
  }

  if (!hasA2AContext(input.task)) {
    return blocked(input.agentId, 403, "Missing A2A task context for JWT validation");
  }

  const requiredScope = input.requiredScope;
  if (!requiredScope) {
    return blocked(input.agentId, 403, "Missing server-derived required scope for A2A JWT validation");
  }

  const expectedIssuer = input.expectedIssuer ?? process.env.A2A_ISSUER ?? "http://localhost:4110";
  const jwksUri = input.jwksUri ?? process.env.A2A_JWKS_URI ?? `${expectedIssuer}/.well-known/jwks.json`;
  const validation = await verifyA2AToken({
    authorizationHeader: input.request.headers.authorization,
    expectedIssuer,
    expectedAudience: input.expectedAudience,
    requiredScope,
    jwksUri
  });

  if (!validation.valid) {
    const statusCode = validation.reason.startsWith("Missing required scope ") ? 403 : 401;
    return blocked(input.agentId, statusCode, validation.reason);
  }

  const binding = validateA2ADelegationClaimBinding(input.task, validation.claims!);
  if (!binding.ok) {
    return blocked(input.agentId, 403, binding.reason);
  }

  return {
    ok: true,
    taskAuth: {
      authMode: "oauth2_client_credentials_jwt",
      issuer: expectedIssuer,
      audience: input.expectedAudience,
      scope: requiredScope,
      tokenValidated: true,
      validationReason: "A2A JWT validated",
      delegatedBy: validation.claims?.delegated_by,
      delegationDepth: validation.claims?.delegation_depth,
      parentTaskId: validation.claims?.parent_task_id,
      requestedByAgent: validation.claims?.requested_by_agent
    }
  };
}
