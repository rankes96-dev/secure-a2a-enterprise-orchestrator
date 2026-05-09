import { createRemoteJWKSet, jwtVerify } from "jose";
import { agentId, expectedAudience, mockIdpJwksUri } from "./config.js";
import { getConnectorProfile } from "./connectorProfile.js";
import { adminConfigHash, getAdminConfig } from "./adminConfig.js";
import { buildJiraRuntimeDiagnosis } from "./connectors/jiraRuntimeDiagnosis.js";
import { buildServiceNowRuntimeDiagnosis } from "./connectors/servicenowRuntimeDiagnosis.js";
import { buildGitHubRuntimeDiagnosis } from "./connectors/githubRuntimeDiagnosis.js";

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
  trustedContext?: {
    externalConfigHash?: unknown;
    connectorProfileHash?: unknown;
  };
};

export type ConnectorAccessEvaluation = {
  missingApplicationGrants: string[];
  missingEffectivePermissions: string[];
  deniedEffectivePermissions: string[];
  skillApprovedByConfig: boolean;
  createIssueAccessReady?: boolean;
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

  const profile = getConnectorProfile(getAdminConfig().selectedConnectorId);
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

export function connectorAccessEvaluation(skill: RuntimeSkillRequirement): ConnectorAccessEvaluation {
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

export function validateRuntimeTrustedConfig(task: ConnectorRuntimeTask, skill: RuntimeSkillRequirement): {
  ok: true;
  accessEvaluation: ConnectorAccessEvaluation;
} | {
  ok: false;
  status: 403 | 409;
  body: { error: string; message: string };
} {
  const expectedHash = typeof task.trustedContext?.externalConfigHash === "string" ? task.trustedContext.externalConfigHash : "";
  if (!expectedHash || expectedHash !== adminConfigHash()) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "connector_configuration_changed",
        message: "External connector configuration changed after Gateway onboarding. Re-run Gateway onboarding before executing runtime."
      }
    };
  }

  const accessEvaluation = connectorAccessEvaluation(skill);
  if (
    !accessEvaluation.skillApprovedByConfig ||
    accessEvaluation.missingApplicationGrants.length > 0 ||
    accessEvaluation.missingEffectivePermissions.length > 0 ||
    accessEvaluation.deniedEffectivePermissions.length > 0
  ) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "skill_not_currently_approved",
        message: "Requested skill is no longer approved by current connector configuration."
      }
    };
  }

  return { ok: true, accessEvaluation };
}

export function safeDiagnosis(params: {
  task: ConnectorRuntimeTask;
  skill: RuntimeSkillRequirement;
  actor?: string;
  actorRoles: string[];
  scopes: string[];
  accessEvaluation: ConnectorAccessEvaluation;
}) {
  const profile = getConnectorProfile(getAdminConfig().selectedConnectorId);
  const diagnosisInput = {
    skillId: params.skill.id,
    message: typeof params.task.message === "string" ? params.task.message : "",
    actor: params.actor,
    requiredApplicationGrants: params.skill.requiredApplicationGrants,
    requiredEffectivePermissions: params.skill.requiredEffectivePermissions,
    connectorAccessEvaluation: params.accessEvaluation
  };
  const diagnosis = profile.connectorId === "servicenow-reference"
    ? buildServiceNowRuntimeDiagnosis(diagnosisInput)
    : profile.connectorId === "github-reference"
      ? buildGitHubRuntimeDiagnosis(diagnosisInput)
      : buildJiraRuntimeDiagnosis(diagnosisInput as Parameters<typeof buildJiraRuntimeDiagnosis>[0]);

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
          connectorAccessEvaluation: params.accessEvaluation,
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
