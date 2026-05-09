import type { TrustedOnboardedAgent } from "./agentOnboarding";
import { referenceConnectorCatalog } from "./connectors/referenceConnectorCatalog";
import { isConnectorRuntimeEndpointAllowed } from "./security/connectorRuntimeSafety";

export type ConnectorRoutingIntent = {
  targetSystem: string;
  connectorId?: string;
  requestedSkillId?: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type ConnectorRoutingDecision = {
  status:
    | "connector_skill_approved"
    | "connector_skill_blocked"
    | "connector_skill_not_declared"
    | "connector_skill_not_enabled"
    | "connector_not_onboarded"
    | "unsupported"
    | "needs_more_info";
  targetSystem?: string;
  connectorId?: string;
  resourceSystem?: string;
  skillId?: string;
  skillLabel?: string;
  runtimeEndpoint?: string;
  audience?: string;
  externalConfigHash?: string;
  connectorProfileHash?: string;
  requiredApplicationGrants?: string[];
  requiredEffectivePermissions?: string[];
  missingApplicationGrants?: string[];
  missingEffectivePermissions?: string[];
  deniedEffectivePermissions?: string[];
  runtimeMode?: "external_runtime_available" | "metadata_only" | "not_available";
  reason: string;
  recommendedNextStep: string;
};

function normalize(value: string): string {
  return value.toLowerCase();
}

function includesTerm(text: string, term: string): boolean {
  return text.includes(term.toLowerCase());
}

export function inferConnectorRoutingIntent(message: string): ConnectorRoutingIntent {
  const text = normalize(message);

  for (const connector of referenceConnectorCatalog) {
    if (!connector.systemTerms.some((term) => includesTerm(text, term))) {
      continue;
    }

    const skill = connector.skillHints.find((hint) =>
      hint.includeAny.some((term) => includesTerm(text, term)) &&
        !(hint.excludeAny ?? []).some((term) => includesTerm(text, term))
    ) ?? connector.skillHints[0];

    if (skill) {
      return {
        targetSystem: connector.resourceSystem,
        connectorId: connector.connectorId,
        requestedSkillId: skill.skillId,
        confidence: "high",
        reason: skill.reason
      };
    }
  }

  if (/warehouse|robot arm|calibration/.test(text)) {
    return {
      targetSystem: "unsupported",
      confidence: "high",
      reason: "The request targets a system with no supported connector profile in this demo."
    };
  }

  return {
    targetSystem: "unknown",
    confidence: "low",
    reason: "No supported connector target was detected."
  };
}

export function decideConnectorRoute(intent: ConnectorRoutingIntent, onboardedAgents: TrustedOnboardedAgent[]): ConnectorRoutingDecision {
  if (intent.confidence === "low") {
    return {
      status: "needs_more_info",
      reason: intent.reason,
      recommendedNextStep: "Provide the target enterprise system and the action you want to perform."
    };
  }

  const supported = referenceConnectorCatalog.find((connector) => connector.resourceSystem === intent.targetSystem || connector.connectorId === intent.connectorId);
  if (!supported || !intent.connectorId) {
    return {
      status: "unsupported",
      targetSystem: intent.targetSystem === "unknown" ? undefined : intent.targetSystem,
      resourceSystem: intent.targetSystem === "unknown" ? undefined : intent.targetSystem,
      reason: intent.reason,
      recommendedNextStep: "Open a support ticket with the issue details."
    };
  }

  const onboarded = onboardedAgents.find((agent) =>
    agent.connectorProfile?.connectorId === supported.connectorId ||
    agent.connectorId === supported.connectorId ||
    agent.connectorDecisionSource === supported.connectorId ||
    agent.resourceSystem === supported.resourceSystem ||
    agent.connectorProfile?.resourceSystem === supported.resourceSystem
  );

  if (!onboarded) {
    return {
      status: "connector_not_onboarded",
      targetSystem: supported.resourceSystem,
      resourceSystem: supported.resourceSystem,
      connectorId: supported.connectorId,
      skillId: intent.requestedSkillId,
      reason: `${supported.displayName} connector is supported but has not been onboarded.`,
      recommendedNextStep: `Open Agent Registry and connect the ${supported.displayName} connector, or open a support ticket.`
    };
  }

  const skillId = intent.requestedSkillId;
  if (!skillId) {
    return {
      status: "needs_more_info",
      targetSystem: supported.resourceSystem,
      resourceSystem: onboarded.resourceSystem ?? onboarded.connectorProfile?.resourceSystem ?? supported.resourceSystem,
      connectorId: onboarded.connectorId ?? onboarded.connectorProfile?.connectorId ?? supported.connectorId,
      reason: "The connector is onboarded, but the requested skill/action is unclear.",
      recommendedNextStep: "Clarify the action you want the connector to perform."
    };
  }

  const approvedActions = onboarded.approvedActions ?? onboarded.approvedCapabilities;
  const approved = approvedActions.find((item) => item.capability === skillId);
  if (approved) {
    const runtimeAvailable = isConnectorRuntimeEndpointAllowed(onboarded.runtimeEndpoint);
    return {
      status: "connector_skill_approved",
      targetSystem: supported.resourceSystem,
      resourceSystem: onboarded.resourceSystem ?? onboarded.connectorProfile?.resourceSystem ?? supported.resourceSystem,
      connectorId: onboarded.connectorId ?? onboarded.connectorProfile?.connectorId ?? supported.connectorId,
      skillId,
      skillLabel: approved.label ?? skillId,
      runtimeEndpoint: onboarded.runtimeEndpoint,
      audience: onboarded.audience,
      externalConfigHash: onboarded.externalConfigHash,
      connectorProfileHash: onboarded.connectorProfileHash,
      requiredApplicationGrants: approved.requiredApplicationGrants ?? [],
      requiredEffectivePermissions: approved.requiredEffectivePermissions ?? [],
      runtimeMode: runtimeAvailable ? "external_runtime_available" : "metadata_only",
      reason: "Connector is onboarded and the requested skill is approved by application access grants and effective permissions.",
      recommendedNextStep: "Use connector-backed diagnosis flow."
    };
  }

  const blockedActions = onboarded.blockedActions ?? onboarded.blockedCapabilities;
  const blocked = blockedActions.find((item) => item.capability === skillId);
  if (blocked) {
    return {
      status: "connector_skill_blocked",
      targetSystem: supported.resourceSystem,
      resourceSystem: onboarded.resourceSystem ?? onboarded.connectorProfile?.resourceSystem ?? supported.resourceSystem,
      connectorId: onboarded.connectorId ?? onboarded.connectorProfile?.connectorId ?? supported.connectorId,
      skillId,
      skillLabel: blocked.label ?? skillId,
      missingApplicationGrants: blocked.missingApplicationGrants ?? [],
      missingEffectivePermissions: blocked.missingEffectivePermissions ?? [],
      deniedEffectivePermissions: blocked.deniedEffectivePermissions ?? [],
      reason: blocked.reason,
      recommendedNextStep: "Update external connector configuration or open a ticket."
    };
  }

  const declaredSkills = new Set([
    ...(onboarded.agentDeclaredSkills ?? []),
    ...(onboarded.agentDeclaredCapabilities ?? [])
  ]);
  if (!declaredSkills.has(skillId)) {
    return {
      status: "connector_skill_not_declared",
      targetSystem: supported.resourceSystem,
      resourceSystem: onboarded.resourceSystem ?? onboarded.connectorProfile?.resourceSystem ?? supported.resourceSystem,
      connectorId: onboarded.connectorId ?? onboarded.connectorProfile?.connectorId ?? supported.connectorId,
      skillId,
      reason: "The requested skill is known to the connector profile but was not declared by the onboarded external agent.",
      recommendedNextStep: "Enable this skill in the external agent admin console, then re-run Gateway onboarding."
    };
  }

  return {
    status: "connector_skill_not_enabled",
    targetSystem: supported.resourceSystem,
    resourceSystem: onboarded.resourceSystem ?? onboarded.connectorProfile?.resourceSystem ?? supported.resourceSystem,
    connectorId: onboarded.connectorId ?? onboarded.connectorProfile?.connectorId ?? supported.connectorId,
    skillId,
    reason: "The requested skill is known to the connector profile but is not enabled in the current Gateway action decision.",
    recommendedNextStep: "Enable this skill in the external agent admin console, then re-run Gateway onboarding."
  };
}

export function routeConnectorRequest(message: string, onboardedAgents: TrustedOnboardedAgent[]): ConnectorRoutingDecision {
  return decideConnectorRoute(inferConnectorRoutingIntent(message), onboardedAgents);
}
