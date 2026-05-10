import { createRemoteJWKSet, jwtVerify } from "jose";
import { agentId, expectedAudience, mockIdpJwksUri } from "./config.js";
import { getConnectorProfile } from "./connectorProfile.js";
import { adminConfigHash, getAdminConfig } from "./adminConfig.js";
import { buildJiraRuntimeDiagnosis } from "./connectors/jiraRuntimeDiagnosis.js";
import { buildServiceNowRuntimeDiagnosis } from "./connectors/servicenowRuntimeDiagnosis.js";
import { buildGitHubRuntimeDiagnosis } from "./connectors/githubRuntimeDiagnosis.js";

const jwksByUri = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export type ConnectorRuntimeExecutionType =
  | "diagnostic_read_only"
  | "write_action"
  | "inspection_read_only"
  | "unsupported";

export type ConnectorRuntimeOutcome =
  | "diagnosed"
  | "executed"
  | "blocked"
  | "needs_more_info"
  | "unsupported"
  | "error";

export type ConnectorTargetActionStatus =
  | "ready"
  | "not_enabled"
  | "missing_application_grants"
  | "missing_effective_permissions"
  | "explicitly_denied"
  | "unknown";

export type ConnectorRuntimeSemantics = {
  executionType: ConnectorRuntimeExecutionType;
  outcome: ConnectorRuntimeOutcome;
  executedSkillId: string;
  targetActionId?: string;
  targetActionLabel?: string;
  targetActionStatus?: ConnectorTargetActionStatus;
  writeActionAttempted: boolean;
  diagnosticOnly: boolean;
};

export type RuntimeSkillRequirement = {
  id: string;
  label: string;
  requiredApplicationGrants: string[];
  requiredEffectivePermissions: string[];
  executionType: ConnectorRuntimeExecutionType;
  diagnosesActionId?: string;
  diagnosesActionLabel?: string;
  targetActionRequirements?: {
    requiredApplicationGrants: string[];
    requiredEffectivePermissions: string[];
  };
};

export type ConnectorRuntimeTask = {
  skillId?: unknown;
  connectorId?: unknown;
  resourceSystem?: unknown;
  message?: unknown;
  mode?: unknown;
  runtimeMode?: unknown;
  allowedSideEffects?: unknown;
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
};

function inferExecutionType(skillId: string, explicit?: ConnectorRuntimeExecutionType): ConnectorRuntimeExecutionType {
  if (explicit) {
    return explicit;
  }
  if (skillId.includes(".diagnose")) {
    return "diagnostic_read_only";
  }
  if (skillId.includes(".inspect")) {
    return "inspection_read_only";
  }
  return "write_action";
}

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
  const config = getAdminConfig();
  const enabledSkills = new Set(config.capabilityDeclaration.agentDeclaredSkills);
  const targetAction = skill.diagnosesActionId
    ? profile.actionCatalog.find((item) => item.id === skill.diagnosesActionId) ?? profile.skillCatalog.find((item) => item.id === skill.diagnosesActionId)
    : undefined;
  const targetActionRequirements = targetAction && enabledSkills.has(targetAction.id)
    ? {
        requiredApplicationGrants: [...targetAction.requiredApplicationGrants],
        requiredEffectivePermissions: [...targetAction.requiredEffectivePermissions]
      }
    : undefined;

  return {
    id: skill.id,
    label: skill.label,
    requiredApplicationGrants: [...skill.requiredApplicationGrants],
    requiredEffectivePermissions: [...skill.requiredEffectivePermissions],
    executionType: inferExecutionType(skill.id, skill.executionType),
    diagnosesActionId: skill.diagnosesActionId,
    diagnosesActionLabel: skill.diagnosesActionLabel,
    targetActionRequirements
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
  const enabledSkills = new Set(config.capabilityDeclaration.agentDeclaredSkills);

  return {
    missingApplicationGrants: skill.requiredApplicationGrants.filter((grant) => !applicationAccessGrants.has(grant)),
    missingEffectivePermissions: skill.requiredEffectivePermissions.filter((permission) => !effectivePermissions.has(permission)),
    deniedEffectivePermissions: skill.requiredEffectivePermissions.filter((permission) => deniedPermissions.has(permission)),
    skillApprovedByConfig: enabledSkills.has(skill.id)
  };
}

export function deriveTargetActionStatus(params: {
  executedSkillId: string;
  targetActionId?: string;
  applicationAccessGrants: string[];
  effectivePermissions: string[];
  deniedPermissions: string[];
  targetActionRequirements?: {
    requiredApplicationGrants: string[];
    requiredEffectivePermissions: string[];
  };
}): ConnectorTargetActionStatus {
  if (!params.targetActionId) {
    return "unknown";
  }
  if (!params.targetActionRequirements) {
    return "not_enabled";
  }

  const applicationAccessGrants = new Set(params.applicationAccessGrants);
  const effectivePermissions = new Set(params.effectivePermissions);
  const deniedPermissions = new Set(params.deniedPermissions);
  const deniedTargetPermissions = params.targetActionRequirements.requiredEffectivePermissions.filter((permission) => deniedPermissions.has(permission));
  if (deniedTargetPermissions.length > 0) {
    return "explicitly_denied";
  }
  const missingApplicationGrants = params.targetActionRequirements.requiredApplicationGrants.filter((grant) => !applicationAccessGrants.has(grant));
  if (missingApplicationGrants.length > 0) {
    return "missing_application_grants";
  }
  const missingEffectivePermissions = params.targetActionRequirements.requiredEffectivePermissions.filter((permission) => !effectivePermissions.has(permission));
  if (missingEffectivePermissions.length > 0) {
    return "missing_effective_permissions";
  }
  return "ready";
}

function runtimeOutcomeFor(executionType: ConnectorRuntimeExecutionType): ConnectorRuntimeOutcome {
  if (executionType === "write_action") {
    return "executed";
  }
  if (executionType === "unsupported") {
    return "unsupported";
  }
  return "diagnosed";
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
  const config = getAdminConfig();
  const targetActionStatus = deriveTargetActionStatus({
    executedSkillId: params.skill.id,
    targetActionId: params.skill.diagnosesActionId,
    applicationAccessGrants: config.oauthApplication.applicationAccessGrants,
    effectivePermissions: config.servicePrincipal.effectivePermissions,
    deniedPermissions: config.servicePrincipal.deniedPermissions,
    targetActionRequirements: params.skill.targetActionRequirements
  });
  const runtimeSemantics: ConnectorRuntimeSemantics = {
    executionType: params.skill.executionType,
    outcome: runtimeOutcomeFor(params.skill.executionType),
    executedSkillId: params.skill.id,
    targetActionId: params.skill.diagnosesActionId,
    targetActionLabel: params.skill.diagnosesActionLabel,
    targetActionStatus,
    writeActionAttempted: params.skill.executionType === "write_action",
    diagnosticOnly: params.skill.executionType === "diagnostic_read_only" || params.skill.executionType === "inspection_read_only"
  };
  const diagnosisInput = {
    skillId: params.skill.id,
    message: typeof params.task.message === "string" ? params.task.message : "",
    actor: params.actor,
    requiredApplicationGrants: params.skill.requiredApplicationGrants,
    requiredEffectivePermissions: params.skill.requiredEffectivePermissions,
    connectorAccessEvaluation: params.accessEvaluation,
    runtimeSemantics
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
    status: runtimeSemantics.outcome === "executed" ? "completed" : runtimeSemantics.outcome,
    summary: diagnosis.summary,
    probableCause: diagnosis.probableCause,
    recommendedActions: diagnosis.recommendedActions,
    runtimeSemantics,
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
      },
      {
        title: "Runtime semantics",
        data: runtimeSemantics
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
