import { createRemoteJWKSet, jwtVerify } from "jose";
import { agentId, expectedAudience, mockIdpJwksUri } from "./config.js";
import { getConnectorProfile } from "./connectorProfile.js";
import { getAdminConfig } from "./adminConfig.js";
import { buildJiraRuntimeDiagnosis, type JiraConnectorAccessEvaluation } from "./connectors/jiraRuntimeDiagnosis.js";

const jwksByUri = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export type RuntimeSkillRequirement = {
  id: string;
  label: string;
  requiredApplicationGrants: string[];
  requiredEffectivePermissions: string[];
};

export type ConnectorRuntimeTask = {
  skillId?: unknown;
  connectorId?: unknown;
  resourceSystem?: unknown;
  message?: unknown;
  context?: {
    actor?: {
      email?: unknown;
      roles?: unknown;
    };
  };
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

export function connectorAccessEvaluation(skill: RuntimeSkillRequirement): JiraConnectorAccessEvaluation {
  const config = getAdminConfig();
  const applicationAccessGrants = new Set(config.oauthApplication.applicationAccessGrants);
  const effectivePermissions = new Set(config.servicePrincipal.effectivePermissions);
  const deniedPermissions = new Set(config.servicePrincipal.deniedPermissions);
  const enabledSkills = new Set(config.capabilityDeclaration.agentDeclaredCapabilities);
  const createIssueAccessReady = applicationAccessGrants.has("write:jira-work") && effectivePermissions.has("create_issues") && !deniedPermissions.has("create_issues");

  return {
    missingApplicationGrants: skill.requiredApplicationGrants.filter((grant) => !applicationAccessGrants.has(grant)),
    missingEffectivePermissions: skill.requiredEffectivePermissions.filter((permission) => !effectivePermissions.has(permission)),
    deniedEffectivePermissions: skill.requiredEffectivePermissions.filter((permission) => deniedPermissions.has(permission)),
    skillApprovedByConfig: enabledSkills.has(skill.id),
    createIssueAccessReady
  };
}

export function safeDiagnosis(params: {
  task: ConnectorRuntimeTask;
  skill: RuntimeSkillRequirement;
  actor?: string;
  actorRoles: string[];
  scopes: string[];
}) {
  const profile = getConnectorProfile();
  const accessEvaluation = connectorAccessEvaluation(params.skill);
  const diagnosis = buildJiraRuntimeDiagnosis({
    skillId: params.skill.id,
    message: typeof params.task.message === "string" ? params.task.message : "",
    actor: params.actor,
    requiredApplicationGrants: params.skill.requiredApplicationGrants,
    requiredEffectivePermissions: params.skill.requiredEffectivePermissions,
    connectorAccessEvaluation: accessEvaluation
  });

  return {
    agentId,
    connectorId: profile.connectorId,
    resourceSystem: profile.resourceSystem,
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
          connectorAccessEvaluation: accessEvaluation,
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
