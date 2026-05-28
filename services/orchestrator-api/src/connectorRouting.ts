import type { TrustedOnboardedAgent } from "./agentOnboarding.js";
import { localReferenceConnectorIntentCatalog, type ConnectorIntentHint, type ConnectorIntentSkillHint, type ReferenceConnectorExecutionType, type ReferenceConnectorRiskLevel, type ReferenceConnectorSensitivity } from "./connectors/localReferenceConnectorIntentCatalog.js";
import { isConnectorRuntimeEndpointAllowed } from "./security/connectorRuntimeSafety.js";

type ConnectorActionMetadataSource = "approved_action" | "reference_catalog" | "missing";

export type ConnectorRoutingIntent = {
  targetSystem: string;
  connectorId?: string;
  requestedSkillId?: string;
  intentClass?: "access_request" | "permission_request" | "service_request";
  targetResourceSystem?: string;
  targetResourceName?: string;
  requestedAccessLevel?: string;
  fulfillmentCapability?: string;
  missingFields?: string[];
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
  actionResourceSystem?: string;
  skillId?: string;
  skillLabel?: string;
  intentClass?: "access_request" | "permission_request" | "service_request";
  targetResourceSystem?: string;
  targetResourceName?: string;
  requestedAccessLevel?: string;
  fulfillmentCapability?: string;
  missingFields?: string[];
  runtimeEndpoint?: string;
  trustedRuntimeEndpoint?: string;
  audience?: string;
  externalConfigHash?: string;
  connectorProfileHash?: string;
  requiredApplicationGrants?: string[];
  requiredEffectivePermissions?: string[];
  riskLevel?: "low" | "medium" | "high" | "sensitive";
  executionType?: "diagnostic_read_only" | "write_action" | "inspection_read_only" | "unsupported";
  requiresApproval?: boolean;
  sensitivity?: "standard" | "sensitive";
  actionCategory?: ConnectorIntentSkillHint["actionCategory"];
  approvalMode?: ConnectorIntentSkillHint["approvalMode"];
  resourceSensitivity?: ConnectorIntentSkillHint["resourceSensitivity"];
  fieldClasses?: ConnectorIntentSkillHint["fieldClasses"];
  actionConstraints?: ConnectorIntentSkillHint["actionConstraints"];
  provider?: string;
  actionMetadataSource?: ConnectorActionMetadataSource;
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

function isAccessServiceRequest(text: string): boolean {
  const asksForAccess = /\b(i need|need|want|request|asking for|please give|give me)\b.*\b(access|permission|permissions)\b/.test(text) ||
    /\b(access|permission|permissions)\b.*\b(request|needed|need)\b/.test(text);
  if (!asksForAccess) {
    return false;
  }

  return !/\b(status|show me|what is the status|why can't|why cannot|create issue|create a jira issue|rate limit|pull request| pr\s*\d+|inc\d+|ritm\d+)\b/.test(text);
}

function extractTargetResourceSystem(text: string): string | undefined {
  if (/\b(jira|fin project|fin-)\b/.test(text)) return "jira";
  if (/\b(github|git hub|repository|repo|billing-api)\b/.test(text)) return "github";
  if (/\b(aws|amazon|cloud|production)\b/.test(text)) return "aws";
  if (/\b(salesforce|sfcc|crm)\b/.test(text)) return "salesforce";
  if (/\b(servicenow|service now)\b/.test(text)) return "servicenow";
  return undefined;
}

function extractTargetResourceName(message: string): string | undefined {
  const repo = message.match(/\b[\w.-]+-api\b/i)?.[0];
  if (repo) return repo;
  const project = message.match(/\b(?:project\s+)?([A-Z][A-Z0-9]{1,8})\b/)?.[1];
  if (project && !["AWS", "CRM"].includes(project.toUpperCase())) return project.toUpperCase();
  return undefined;
}

function extractRequestedAccessLevel(text: string): string | undefined {
  if (/\b(project admin|admin|administrator)\b/.test(text)) return "project admin";
  if (/\b(contributor|write|edit|developer)\b/.test(text)) return "contributor";
  if (/\b(viewer|view|read|browse)\b/.test(text)) return "viewer";
  return undefined;
}

function missingAccessRequestFields(intent: ConnectorRoutingIntent): string[] {
  return [
    intent.targetResourceName ? "" : "resource/project/site",
    intent.requestedAccessLevel ? "" : "accessLevel",
    "businessReason"
  ].filter(Boolean);
}

function inferAccessServiceRequestIntent(message: string): ConnectorRoutingIntent | undefined {
  const text = normalize(message);
  if (!isAccessServiceRequest(text)) {
    return undefined;
  }

  const targetResourceSystem = extractTargetResourceSystem(text);
  const targetResourceName = extractTargetResourceName(message);
  if (!targetResourceSystem && !targetResourceName) {
    return undefined;
  }

  const intentClass: ConnectorRoutingIntent["intentClass"] = text.includes("permission") ? "permission_request" : "access_request";
  const intent: ConnectorRoutingIntent = {
    targetSystem: "fulfillment",
    intentClass,
    targetResourceSystem,
    targetResourceName,
    requestedAccessLevel: extractRequestedAccessLevel(text),
    fulfillmentCapability: "access.request.prepare",
    confidence: "high",
    reason: "The request asks to prepare access or permission fulfillment, so routing is based on fulfillment capability before target resource system."
  };
  return {
    ...intent,
    missingFields: missingAccessRequestFields(intent)
  };
}

function fulfillmentSkillFor(intent: ConnectorRoutingIntent, onboardedAgents: TrustedOnboardedAgent[]) {
  if (!intent.fulfillmentCapability) {
    return undefined;
  }

  const candidates = localReferenceConnectorIntentCatalog.flatMap((connector) =>
    connector.skillHints
      .filter((hint) => hint.capabilityIds?.includes(intent.fulfillmentCapability ?? ""))
      .map((hint) => ({ connector, hint }))
  );

  return candidates
    .map((candidate) => ({
      ...candidate,
      onboarded: selectOnboardedConnectorAgent(candidate.connector, onboardedAgents)
    }))
    .find((candidate) => candidate.onboarded);
}

type SupportedConnectorIdentity = {
  connectorId: string;
  resourceSystem: string;
  displayName?: string;
};

type ApprovedConnectorAction = TrustedOnboardedAgent["approvedActions"][number];

function hasCompleteNormalizedActionMetadata(metadata: {
  riskLevel?: ReferenceConnectorRiskLevel;
  executionType?: ReferenceConnectorExecutionType;
  actionCategory?: ConnectorIntentSkillHint["actionCategory"];
  approvalMode?: ConnectorIntentSkillHint["approvalMode"];
  resourceSensitivity?: ConnectorIntentSkillHint["resourceSensitivity"];
  fieldClasses?: ConnectorIntentSkillHint["fieldClasses"];
  actionConstraints?: ConnectorIntentSkillHint["actionConstraints"];
}): boolean {
  return metadata.riskLevel !== undefined &&
    metadata.executionType !== undefined &&
    metadata.actionCategory !== undefined &&
    metadata.approvalMode !== undefined &&
    metadata.resourceSensitivity !== undefined &&
    metadata.fieldClasses !== undefined &&
    metadata.actionConstraints !== undefined;
}

function referenceSkillMetadata(
  supported: ConnectorIntentHint,
  skillId: string,
  approved: ApprovedConnectorAction
): {
  riskLevel?: ReferenceConnectorRiskLevel;
  executionType?: ReferenceConnectorExecutionType;
  requiresApproval?: boolean;
  sensitivity?: ReferenceConnectorSensitivity;
  actionCategory?: ConnectorIntentSkillHint["actionCategory"];
  approvalMode?: ConnectorIntentSkillHint["approvalMode"];
  resourceSensitivity?: ConnectorIntentSkillHint["resourceSensitivity"];
  fieldClasses?: ConnectorIntentSkillHint["fieldClasses"];
  actionConstraints?: ConnectorIntentSkillHint["actionConstraints"];
  provider?: string;
  resourceSystem?: string;
  source: ConnectorActionMetadataSource;
} {
  const referenceSkill = supported.skillHints.find((hint) => hint.skillId === skillId);
  const riskLevel = approved.riskLevel ?? referenceSkill?.riskLevel;
  const executionType = approved.executionType ?? referenceSkill?.executionType;
  const requiresApproval = approved.requiresApproval ?? referenceSkill?.requiresApproval;
  const sensitivity = approved.sensitivity ?? referenceSkill?.sensitivity;
  const actionCategory = approved.actionCategory ?? referenceSkill?.actionCategory;
  const approvalMode = approved.approvalMode ?? referenceSkill?.approvalMode;
  const resourceSensitivity = approved.resourceSensitivity ?? referenceSkill?.resourceSensitivity;
  const fieldClasses = approved.fieldClasses ?? referenceSkill?.fieldClasses;
  const actionConstraints = approved.actionConstraints ?? referenceSkill?.actionConstraints;
  const provider = approved.provider ?? referenceSkill?.provider;
  const resourceSystem = approved.resourceSystem ?? referenceSkill?.resourceSystem ?? supported.resourceSystem;
  const mergedMetadataComplete = hasCompleteNormalizedActionMetadata({
    riskLevel,
    executionType,
    actionCategory,
    approvalMode,
    resourceSensitivity,
    fieldClasses,
    actionConstraints
  });
  const approvedMetadataComplete = hasCompleteNormalizedActionMetadata(approved);
  const source: ConnectorActionMetadataSource =
    !mergedMetadataComplete
      ? "missing"
      : approvedMetadataComplete
        ? "approved_action"
        : "reference_catalog";

  return {
    riskLevel,
    executionType,
    requiresApproval,
    sensitivity,
    actionCategory,
    approvalMode,
    resourceSensitivity,
    fieldClasses: fieldClasses ? [...fieldClasses] : undefined,
    actionConstraints: actionConstraints ? { ...actionConstraints } : undefined,
    provider,
    resourceSystem,
    source
  };
}

function exactConnectorIdMatch(agent: TrustedOnboardedAgent, connectorId: string): boolean {
  return agent.connectorProfile?.connectorId === connectorId ||
    agent.connectorId === connectorId ||
    agent.connectorDecisionSource === connectorId;
}

function resourceSystemMatch(agent: TrustedOnboardedAgent, resourceSystem: string): boolean {
  return agent.resourceSystem === resourceSystem ||
    agent.connectorProfile?.resourceSystem === resourceSystem;
}

function uniqueAgents(agents: TrustedOnboardedAgent[]): TrustedOnboardedAgent[] {
  const seen = new Set<string>();
  return agents.filter((agent) => {
    const key = `${agent.agentId}:${agent.connectorId ?? agent.connectorProfile?.connectorId ?? ""}:${agent.audience}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function selectOnboardedConnectorAgent(supported: SupportedConnectorIdentity, onboardedAgents: TrustedOnboardedAgent[]): TrustedOnboardedAgent | undefined {
  const exactMatches = uniqueAgents(onboardedAgents.filter((agent) => exactConnectorIdMatch(agent, supported.connectorId)));
  if (exactMatches.length > 0) {
    return exactMatches[0];
  }

  const resourceMatches = uniqueAgents(onboardedAgents.filter((agent) => resourceSystemMatch(agent, supported.resourceSystem)));
  return resourceMatches.length === 1 ? resourceMatches[0] : undefined;
}

function ambiguousResourceSystemMatch(supported: SupportedConnectorIdentity, onboardedAgents: TrustedOnboardedAgent[]): boolean {
  const exactMatches = uniqueAgents(onboardedAgents.filter((agent) => exactConnectorIdMatch(agent, supported.connectorId)));
  if (exactMatches.length > 0) {
    return false;
  }

  return uniqueAgents(onboardedAgents.filter((agent) => resourceSystemMatch(agent, supported.resourceSystem))).length > 1;
}

function isPersistedMetadataOnlyTrust(agent: TrustedOnboardedAgent): boolean {
  return agent.runtimeTrustSource === "stored_metadata" || agent.rehydratedFromStore === true;
}

export function inferConnectorRoutingIntent(message: string): ConnectorRoutingIntent {
  const fulfillmentIntent = inferAccessServiceRequestIntent(message);
  if (fulfillmentIntent) {
    return fulfillmentIntent;
  }

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

  if (intent.fulfillmentCapability) {
    const fulfillment = fulfillmentSkillFor(intent, onboardedAgents);
    if (!fulfillment) {
      return {
        status: "unsupported",
        targetSystem: "fulfillment",
        resourceSystem: intent.targetResourceSystem,
        intentClass: intent.intentClass,
        targetResourceSystem: intent.targetResourceSystem,
        targetResourceName: intent.targetResourceName,
        requestedAccessLevel: intent.requestedAccessLevel,
        fulfillmentCapability: intent.fulfillmentCapability,
        missingFields: intent.missingFields,
        reason: `No installed connector declares fulfillment capability ${intent.fulfillmentCapability}.`,
        recommendedNextStep: "Open a support ticket with the target system, access needed, business reason, and duration."
      };
    }

    intent = {
      ...intent,
      targetSystem: fulfillment.connector.resourceSystem,
      connectorId: fulfillment.connector.connectorId,
      requestedSkillId: fulfillment.hint.skillId,
      reason: `${intent.reason} Selected ${fulfillment.connector.displayName} because it declares ${intent.fulfillmentCapability}.`
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

  if (ambiguousResourceSystemMatch(supported, onboardedAgents)) {
    return {
      status: "needs_more_info",
      targetSystem: supported.resourceSystem,
      resourceSystem: supported.resourceSystem,
      connectorId: supported.connectorId,
      skillId: intent.requestedSkillId,
      reason: `Multiple trusted connector agents are installed for ${supported.resourceSystem}, but none exactly matches connectorId ${supported.connectorId}.`,
      recommendedNextStep: "Choose the connector template or re-run onboarding for the intended connector before runtime execution."
    };
  }

  const onboarded = selectOnboardedConnectorAgent(supported, onboardedAgents);

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
    const actionMetadata = referenceSkillMetadata(supported, skillId, approved);
    const persistedMetadataOnly = isPersistedMetadataOnlyTrust(onboarded);
    const runtimeAvailable = !persistedMetadataOnly && isConnectorRuntimeEndpointAllowed(onboarded.runtimeEndpoint);
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
      trustedRuntimeEndpoint: runtimeAvailable ? onboarded.runtimeEndpoint : undefined,
      audience: onboarded.audience,
      externalConfigHash: onboarded.externalConfigHash,
      connectorProfileHash: onboarded.connectorProfileHash,
      requiredApplicationGrants: approved.requiredApplicationGrants ?? [],
      requiredEffectivePermissions: approved.requiredEffectivePermissions ?? [],
      riskLevel: actionMetadata.riskLevel,
      executionType: actionMetadata.executionType,
      requiresApproval: actionMetadata.requiresApproval,
      sensitivity: actionMetadata.sensitivity,
      actionCategory: actionMetadata.actionCategory,
      approvalMode: actionMetadata.approvalMode,
      resourceSensitivity: actionMetadata.resourceSensitivity,
      fieldClasses: actionMetadata.fieldClasses,
      actionConstraints: actionMetadata.actionConstraints,
      provider: actionMetadata.provider,
      actionResourceSystem: actionMetadata.resourceSystem,
      actionMetadataSource: actionMetadata.source,
      runtimeMode: runtimeAvailable ? "external_runtime_available" : "metadata_only",
      reason: persistedMetadataOnly
        ? "Connector trust metadata was restored from persisted state, but runtime execution requires fresh runtime validation."
        : "Connector is onboarded and the requested skill is approved by application access grants and effective permissions.",
      recommendedNextStep: persistedMetadataOnly
        ? "Re-run connector onboarding or runtime revalidation before execution."
        : intent.fulfillmentCapability ? "Use connector-backed request preparation flow." : "Use connector-backed diagnosis flow.",
      intentClass: intent.intentClass,
      targetResourceSystem: intent.targetResourceSystem,
      targetResourceName: intent.targetResourceName,
      requestedAccessLevel: intent.requestedAccessLevel,
      fulfillmentCapability: intent.fulfillmentCapability,
      missingFields: intent.missingFields
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
