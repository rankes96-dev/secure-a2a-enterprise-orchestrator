import type { TrustedOnboardedAgent } from "./agentOnboarding";
import { localReferenceConnectorIntentCatalog } from "./connectors/localReferenceConnectorIntentCatalog";
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
  trustedRuntimeEndpoint?: string;
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

function exactTermMatch(text: string, term: string): boolean {
  const normalized = term.toLowerCase().trim();
  if (!normalized) {
    return false;
  }
  return text.includes(normalized);
}

function partialTermMatch(text: string, term: string): boolean {
  return term.toLowerCase().trim().split(/\s+/).filter(Boolean).every((token) => text.includes(token));
}

function scoreSkillHint(text: string, hint: { includeAny: string[]; excludeAny?: string[] }): number {
  const includeScore = hint.includeAny.reduce((score, term) => {
    if (exactTermMatch(text, term)) {
      return score + 2;
    }
    return partialTermMatch(text, term) ? score + 1 : score;
  }, 0);
  const excludePenalty = (hint.excludeAny ?? []).reduce((score, term) => score + (includesTerm(text, term) ? 3 : 0), 0);
  return includeScore - excludePenalty;
}

export function inferConnectorRoutingIntent(message: string): ConnectorRoutingIntent {
  const text = normalize(message);

  for (const connector of localReferenceConnectorIntentCatalog) {
    if (!connector.systemTerms.some((term) => includesTerm(text, term))) {
      continue;
    }

    const rankedSkills = connector.skillHints
      .map((hint) => ({ hint, score: scoreSkillHint(text, hint) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);
    const skill = rankedSkills[0]?.hint;

    if (skill) {
      return {
        targetSystem: connector.resourceSystem,
        connectorId: connector.connectorId,
        requestedSkillId: skill.skillId,
        confidence: "high",
        reason: skill.reason
      };
    }

    return {
      targetSystem: connector.resourceSystem,
      connectorId: connector.connectorId,
      confidence: "medium",
      reason: `The request mentions ${connector.displayName}, but no specific skill/action hint scored above zero.`
    };
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

  const supported = localReferenceConnectorIntentCatalog.find((connector) => connector.resourceSystem === intent.targetSystem || connector.connectorId === intent.connectorId);
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
      reason: `This organization has not installed a trusted external agent for ${supported.resourceSystem} yet.`,
      recommendedNextStep: `Open Connector Catalog and connect an external agent for the ${supported.displayName} template, or open a support ticket.`
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
    // In V1, the selected runtime endpoint is the trusted runtime endpoint stored during onboarding.
    // Future policy routing may choose among multiple trusted runtime endpoints.
    return {
      status: "connector_skill_approved",
      targetSystem: supported.resourceSystem,
      resourceSystem: onboarded.resourceSystem ?? onboarded.connectorProfile?.resourceSystem ?? supported.resourceSystem,
      connectorId: onboarded.connectorId ?? onboarded.connectorProfile?.connectorId ?? supported.connectorId,
      skillId,
      skillLabel: approved.label ?? skillId,
      runtimeEndpoint: onboarded.runtimeEndpoint,
      trustedRuntimeEndpoint: onboarded.runtimeEndpoint,
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
