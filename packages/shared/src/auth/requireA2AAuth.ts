import type { IncomingMessage } from "node:http";
import type { A2AAgentResponse, A2AAuthMode, A2ATask, AgentTask } from "../index";
import { verifyA2AToken } from "./verifyA2AToken";

export type RequireA2AAuthInput = {
  request: IncomingMessage;
  task: A2ATask | AgentTask;
  agentId: string;
  expectedAudience: string;
  authMode?: A2AAuthMode;
  expectedIssuer?: string;
  jwksUri?: string;
};

type RequireA2AAuthResult =
  | {
      ok: true;
      taskAuth?: A2ATask["context"]["auth"];
    }
  | {
      ok: false;
      statusCode: 401 | 403;
      response: A2AAgentResponse;
    };

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

export async function requireA2AAuth(input: RequireA2AAuthInput): Promise<RequireA2AAuthResult> {
  const authMode = input.authMode ?? process.env.A2A_AUTH_MODE ?? "mock_internal_token";

  if (authMode !== "oauth2_client_credentials_jwt") {
    return validateInternalServiceToken(input.request, input.agentId);
  }

  if (!hasA2AContext(input.task)) {
    return blocked(input.agentId, 403, "Missing A2A task context for JWT validation");
  }

  const requiredScope = input.task.context.requestedScope;
  if (!requiredScope) {
    return blocked(input.agentId, 403, "Missing requested scope in A2A task context");
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

  return {
    ok: true,
    taskAuth: {
      authMode: "oauth2_client_credentials_jwt",
      issuer: expectedIssuer,
      audience: input.expectedAudience,
      scope: requiredScope,
      tokenValidated: true,
      validationReason: "A2A JWT validated"
    }
  };
}
