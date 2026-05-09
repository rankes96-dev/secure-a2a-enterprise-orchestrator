import { createRemoteJWKSet, jwtVerify } from "jose";
import { agentId, expectedAudience, mockIdpJwksUri } from "./config.js";
import { getConnectorProfile } from "./connectorProfile.js";

const jwksByUri = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export type RuntimeSkillRequirement = {
  id: string;
  label: string;
  requiredApplicationGrants: string[];
  requiredEffectivePermissions: string[];
};

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

export function runtimeSkillRequirement(skillId: unknown): RuntimeSkillRequirement | undefined {
  if (typeof skillId !== "string" || !skillId.trim()) {
    return undefined;
  }

  const profile = getConnectorProfile();
  const catalog = profile.skillCatalog.length ? profile.skillCatalog : profile.actionCatalog;
  const skill = catalog.find((item) => item.id === skillId);
  if (!skill) {
    return undefined;
  }

  return {
    id: skill.id,
    label: skill.label,
    requiredApplicationGrants: [...skill.requiredApplicationGrants],
    requiredEffectivePermissions: [...skill.requiredEffectivePermissions]
  };
}

export async function validateRuntimeToken(token: string, requiredApplicationGrants: string[]): Promise<{
  actor?: string;
  actorRoles: string[];
  scopes: string[];
}> {
  const { payload } = await jwtVerify(token, jwks(), {
    audience: expectedAudience()
  });

  const scopes = [...new Set([...scopesFromClaim(payload.scope), ...scopesFromClaim(payload.scopes)])];
  const missingGrant = requiredApplicationGrants.find((grant) => !scopes.includes(grant));
  if (missingGrant) {
    throw new Error("missing_required_application_grant");
  }

  return {
    actor: typeof payload.actor === "string" ? payload.actor : undefined,
    actorRoles: scopesFromClaim(payload.actor_roles),
    scopes
  };
}

function diagnosisForSkill(skillId: string): {
  summary: string;
  probableCause: string;
  recommendedActions: string[];
} {
  if (skillId === "jira.permission.inspect") {
    return {
      summary: "Jira permission inspection completed.",
      probableCause: "The Jira connector validated a read-only permission inspection request with the required Jira user access grant.",
      recommendedActions: [
        "Review the FIN project role membership for the affected user or integration account.",
        "Confirm the service account can read Jira project roles.",
        "Keep write actions blocked unless the connected app and integration user both receive create access."
      ]
    };
  }

  if (skillId === "jira.issue.create") {
    return {
      summary: "Jira issue create runtime request received.",
      probableCause: "The create action reached runtime with a valid scoped token. In the default demo this action should be blocked before runtime.",
      recommendedActions: [
        "Confirm this action was intentionally approved by both application access grants and effective permissions.",
        "Validate the FIN project Create Issues permission before enabling production execution.",
        "Keep runtime execution audited and scoped to the requested skill."
      ]
    };
  }

  return {
    summary: "Jira issue creation failure diagnosis completed.",
    probableCause: "The failure is consistent with missing Jira project permission or insufficient create issue access for the integration/user context.",
    recommendedActions: [
      "Check the FIN project permission scheme.",
      "Verify the integration user has Browse Projects and View Issues.",
      "For actual issue creation, grant write:jira-work and Create Issues permission; otherwise keep create action blocked."
    ]
  };
}

export function safeDiagnosis(params: {
  skill: RuntimeSkillRequirement;
  actor?: string;
  actorRoles: string[];
  scopes: string[];
}) {
  const diagnosis = diagnosisForSkill(params.skill.id);

  return {
    agentId,
    connectorId: getConnectorProfile().connectorId,
    resourceSystem: getConnectorProfile().resourceSystem,
    skillId: params.skill.id,
    status: "diagnosed",
    summary: diagnosis.summary,
    probableCause: diagnosis.probableCause,
    recommendedActions: diagnosis.recommendedActions,
    evidence: [
      {
        title: "Connector runtime validation",
        data: {
          skillId: params.skill.id,
          audience: expectedAudience(),
          requiredApplicationGrants: params.skill.requiredApplicationGrants,
          requiredEffectivePermissions: params.skill.requiredEffectivePermissions,
          tokenScopeValidated: params.skill.requiredApplicationGrants.every((grant) => params.scopes.includes(grant)),
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
        action: "external_connector_runtime_validated",
        detail: "Validated scoped A2A JWT and executed approved connector skill.",
        timestamp: new Date().toISOString()
      }
    ]
  };
}
