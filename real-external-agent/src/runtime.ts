import { createRemoteJWKSet, jwtVerify } from "jose";
import { agentId, expectedAudience, mockIdpJwksUri, requestedScopes } from "./config.js";

const jwksByUri = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwks(): ReturnType<typeof createRemoteJWKSet> {
  const uri = mockIdpJwksUri();
  const existing = jwksByUri.get(uri);
  if (existing) {
    return existing;
  }
  const created = createRemoteJWKSet(new URL(uri));
  jwksByUri.set(uri, created);
  return created;
}

function scopesFromClaim(value: unknown): string[] {
  if (typeof value === "string") {
    return value.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export async function validateRuntimeToken(token: string): Promise<{
  actor?: string;
  actorRoles: string[];
  scopes: string[];
}> {
  const { payload } = await jwtVerify(token, jwks(), {
    audience: expectedAudience()
  });

  const scopes = [...new Set([...scopesFromClaim(payload.scope), ...scopesFromClaim(payload.scopes)])];
  if (!scopes.includes(requestedScopes[0])) {
    throw new Error("missing_required_scope");
  }

  return {
    actor: typeof payload.actor === "string" ? payload.actor : undefined,
    actorRoles: scopesFromClaim(payload.actor_roles),
    scopes
  };
}

export function safeDiagnosis(params: { actor?: string; actorRoles: string[]; scopes: string[] }) {
  return {
    agentId,
    status: "diagnosed",
    summary: "Jira access diagnosis completed by external agent.",
    probableCause: "The request reached the external Jira agent with a valid scoped A2A JWT.",
    recommendedActions: [
      "Confirm the user has the required Jira project role or permission scheme.",
      "Check Jira project permissions and OAuth connected app policy.",
      "If access was recently changed, ask the user to reauthenticate."
    ],
    evidence: [
      {
        title: "A2A JWT validation",
        data: {
          audience: expectedAudience(),
          requiredScope: requestedScopes[0],
          scopeValidated: params.scopes.includes(requestedScopes[0]),
          actorAttached: Boolean(params.actor),
          actor: params.actor,
          actorRoles: params.actorRoles,
          rawToken: "hidden"
        }
      }
    ],
    trace: [
      {
        agent: agentId,
        action: "external_agent_runtime_validated",
        detail: "Validated scoped A2A JWT before returning safe Jira access diagnosis.",
        timestamp: new Date().toISOString()
      }
    ]
  };
}
