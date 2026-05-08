import { createRemoteJWKSet, jwtVerify } from "jose";
import { agentId, expectedAudience, mockIdpJwksUri, requiredScope } from "./config.js";

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
  if (!scopes.includes(requiredScope)) {
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
    summary: "Salesforce access diagnosis completed by external agent.",
    probableCause: "The request reached the external Salesforce access agent with a valid scoped A2A JWT.",
    recommendedActions: [
      "Confirm the user has the required Salesforce profile or permission set.",
      "Check recent Salesforce login history and connected app policy.",
      "If access was recently changed, ask the user to reauthenticate."
    ],
    evidence: [
      {
        title: "A2A JWT validation",
        data: {
          audience: expectedAudience(),
          requiredScope,
          scopeValidated: params.scopes.includes(requiredScope),
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
        detail: "Validated scoped A2A JWT before returning safe Salesforce access diagnosis.",
        timestamp: new Date().toISOString()
      }
    ]
  };
}
