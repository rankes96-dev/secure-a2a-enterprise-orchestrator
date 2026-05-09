import type { TrustedOnboardedAgent } from "./agentOnboarding";

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

const supportedConnectors = [
  {
    targetSystem: "jira",
    connectorId: "jira-reference",
    displayName: "Jira Cloud Reference Connector"
  },
  {
    targetSystem: "servicenow",
    connectorId: "servicenow-reference",
    displayName: "ServiceNow Reference Connector"
  },
  {
    targetSystem: "github",
    connectorId: "github-reference",
    displayName: "GitHub Reference Connector"
  }
];

function normalize(value: string): string {
  return value.toLowerCase();
}

function isSafeConnectorRuntimeEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint) {
    return false;
  }

  try {
    const url = new URL(endpoint);
    const allowedOrigins = new Set((process.env.CONNECTOR_RUNTIME_ALLOWED_ORIGINS ?? "http://localhost:4201").split(",").map((item) => item.trim()).filter(Boolean));
    const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
    return (
      (url.protocol === "https:" || (url.protocol === "http:" && isLocalhost)) &&
      allowedOrigins.has(url.origin) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function inferConnectorRoutingIntent(message: string): ConnectorRoutingIntent {
  const text = normalize(message);

  if (/\b(jira)\b/.test(text)) {
    if (/project role|jira permission|permissions?|user cannot access project|cannot access project/.test(text)) {
      return {
        targetSystem: "jira",
        connectorId: "jira-reference",
        requestedSkillId: "jira.permission.inspect",
        confidence: "high",
        reason: "The request mentions Jira permissions or project roles."
      };
    }

    if (/\bcreate\b.*\b(jira issue|issue|ticket)\b|\b(jira issue|ticket|issue)\b.*\bcreate\b/.test(text) && !/fail|fails|failing|403|permission/.test(text)) {
      return {
        targetSystem: "jira",
        connectorId: "jira-reference",
        requestedSkillId: "jira.issue.create",
        confidence: "high",
        reason: "The request asks the connector to create a Jira issue."
      };
    }

    if (/issue|ticket creation|create issue|create ticket|403|project permission|permission/.test(text)) {
      return {
        targetSystem: "jira",
        connectorId: "jira-reference",
        requestedSkillId: "jira.issue.diagnose_creation_failure",
        confidence: "high",
        reason: "The request describes a Jira issue creation or permission failure."
      };
    }
  }

  if (/servicenow|incident|catalog item|requested item|ritm|change request/.test(text)) {
    return {
      targetSystem: "servicenow",
      connectorId: "servicenow-reference",
      confidence: "high",
      reason: "The request references ServiceNow incident or catalog workflows."
    };
  }

  if (/github|repository|repo|pull request|branch|rate limit/.test(text)) {
    return {
      targetSystem: "github",
      connectorId: "github-reference",
      confidence: "high",
      reason: "The request references GitHub repository or API workflows."
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

  const supported = supportedConnectors.find((connector) => connector.targetSystem === intent.targetSystem || connector.connectorId === intent.connectorId);
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
    agent.resourceSystem === supported.targetSystem ||
    agent.connectorProfile?.resourceSystem === supported.targetSystem
  );

  if (!onboarded) {
    return {
      status: "connector_not_onboarded",
      targetSystem: supported.targetSystem,
      resourceSystem: supported.targetSystem,
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
      targetSystem: supported.targetSystem,
      resourceSystem: onboarded.resourceSystem ?? onboarded.connectorProfile?.resourceSystem ?? supported.targetSystem,
      connectorId: onboarded.connectorId ?? onboarded.connectorProfile?.connectorId ?? supported.connectorId,
      reason: "The connector is onboarded, but the requested skill/action is unclear.",
      recommendedNextStep: "Clarify the action you want the connector to perform."
    };
  }

  const approved = onboarded.approvedCapabilities.find((item) => item.capability === skillId);
  if (approved) {
    const runtimeAvailable = isSafeConnectorRuntimeEndpoint(onboarded.runtimeEndpoint);
    return {
      status: "connector_skill_approved",
      targetSystem: supported.targetSystem,
      resourceSystem: onboarded.resourceSystem ?? onboarded.connectorProfile?.resourceSystem ?? supported.targetSystem,
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

  const blocked = onboarded.blockedCapabilities.find((item) => item.capability === skillId);
  if (blocked) {
    return {
      status: "connector_skill_blocked",
      targetSystem: supported.targetSystem,
      resourceSystem: onboarded.resourceSystem ?? onboarded.connectorProfile?.resourceSystem ?? supported.targetSystem,
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
      targetSystem: supported.targetSystem,
      resourceSystem: onboarded.resourceSystem ?? onboarded.connectorProfile?.resourceSystem ?? supported.targetSystem,
      connectorId: onboarded.connectorId ?? onboarded.connectorProfile?.connectorId ?? supported.connectorId,
      skillId,
      reason: "The requested skill is known to the connector profile but was not declared by the onboarded external agent.",
      recommendedNextStep: "Enable this skill in the external agent admin console, then re-run Gateway onboarding."
    };
  }

  return {
    status: "connector_skill_not_enabled",
    targetSystem: supported.targetSystem,
    resourceSystem: onboarded.resourceSystem ?? onboarded.connectorProfile?.resourceSystem ?? supported.targetSystem,
    connectorId: onboarded.connectorId ?? onboarded.connectorProfile?.connectorId ?? supported.connectorId,
    skillId,
    reason: "The requested skill is known to the connector profile but is not enabled in the current Gateway action decision.",
    recommendedNextStep: "Enable this skill in the external agent admin console, then re-run Gateway onboarding."
  };
}

export function routeConnectorRequest(message: string, onboardedAgents: TrustedOnboardedAgent[]): ConnectorRoutingDecision {
  return decideConnectorRoute(inferConnectorRoutingIntent(message), onboardedAgents);
}
