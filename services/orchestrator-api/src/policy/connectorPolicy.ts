import type { ConnectorRoutingDecision } from "../connectorRouting.js";
import { evaluateOgenPolicy, OGEN_POLICY_VERSION } from "./ogenPolicyEngine.js";
import type { OgenPolicyAction, OgenPolicyDecision, OgenPolicyEffect, OgenPolicyInput, OgenPolicyMatchedRuleSummary, OgenPolicyResource, OgenPolicySubject } from "./ogenPolicyTypes.js";

export type ConnectorPolicyEffect = OgenPolicyEffect;

export type ConnectorPolicyRule = {
  id: string;
  name: string;
  description: string;
  effect: ConnectorPolicyEffect;
  appliesTo: {
    connectorIds?: string[];
    resourceSystems?: string[];
    skillIds?: string[];
    riskLevels?: Array<"low" | "medium" | "high" | "sensitive">;
  };
  conditions?: {
    requireUserLogin?: boolean;
    requireAdminRole?: boolean;
    businessHoursOnly?: boolean;
  };
};

export type ConnectorPolicyEvaluation = {
  effect: ConnectorPolicyEffect;
  reason: string;
  primaryRuleId?: string;
  primaryRuleSource?: "guardrail" | "tenant" | "default";
  matchedRuleIds: string[];
  matchedGuardrailRuleIds: string[];
  matchedTenantRuleIds: string[];
  matchedRuleSummaries: OgenPolicyMatchedRuleSummary[];
  policyVersion: string;
  decisionId: string;
  inputHash: string;
  deniedByDefault: boolean;
  requiresApproval: boolean;
  safeInputSummary: Record<string, unknown>;
};

export const defaultConnectorPolicyRules: ConnectorPolicyRule[] = [
  {
    id: "allow-readonly-approved-runtime",
    name: "Allow read-only approved runtime",
    description: "Read-only approved connector skills are allowed only through the Ogen policy engine.",
    effect: "allow",
    appliesTo: {
      riskLevels: ["low", "medium"]
    },
    conditions: {
      requireUserLogin: true
    }
  },
  {
    id: "block-unapproved-route",
    name: "Block unapproved routes",
    description: "Skills not approved by connector routing are blocked by the Ogen policy engine.",
    effect: "block",
    appliesTo: {}
  },
  {
    id: "approval-required-for-write-or-sensitive",
    name: "Require approval for write or sensitive actions",
    description: "High-risk, sensitive, write, or approval-marked connector actions need governed approval.",
    effect: "needs_approval",
    appliesTo: {
      riskLevels: ["high", "sensitive"]
    },
    conditions: {
      requireAdminRole: true
    }
  }
];

export type ConnectorPolicyInput = {
  connectorRouteStatus: ConnectorRoutingDecision["status"];
  runtimeMode?: ConnectorRoutingDecision["runtimeMode"];
  connectorId?: string;
  resourceSystem?: string;
  skillId?: string;
  skillLabel?: string;
  tenantId?: string;
  requestId?: string;
  conversationId?: string;
  interpretation?: OgenPolicyInput["interpretation"];
  subject?: Partial<OgenPolicySubject> & { roles?: string[] };
  resource?: Partial<OgenPolicyResource>;
  action?: Partial<OgenPolicyAction>;
  riskLevel?: "low" | "medium" | "high" | "sensitive";
  executionType?: "diagnostic_read_only" | "write_action" | "inspection_read_only" | "unsupported";
  requiresApproval?: boolean;
  sensitivity?: "standard" | "sensitive";
};

function toConnectorPolicyEvaluation(decision: OgenPolicyDecision): ConnectorPolicyEvaluation {
  return {
    effect: decision.effect,
    reason: decision.reason,
    primaryRuleId: decision.primaryRuleId,
    primaryRuleSource: decision.primaryRuleSource,
    matchedRuleIds: decision.matchedRuleIds,
    matchedGuardrailRuleIds: decision.matchedGuardrailRuleIds,
    matchedTenantRuleIds: decision.matchedTenantRuleIds,
    matchedRuleSummaries: decision.matchedRuleSummaries,
    policyVersion: decision.policyVersion,
    decisionId: decision.decisionId,
    inputHash: decision.inputHash,
    deniedByDefault: decision.deniedByDefault,
    requiresApproval: decision.requiresApproval,
    safeInputSummary: decision.safeInputSummary
  };
}

// Compatibility wrapper: existing callers still receive the connector policy
// shape, while authorization is decided by the versioned Ogen policy engine.
// An approved connector route is necessary but not sufficient; runtime
// availability must be explicit.
export function evaluateConnectorPolicy(input: ConnectorPolicyInput): ConnectorPolicyEvaluation {
  const tenantId = input.tenantId ?? input.subject?.tenantId ?? "default";
  const connectorId = input.connectorId ?? input.resource?.connectorId;
  const resourceSystem = input.resourceSystem ?? input.resource?.resourceSystem;
  const skillId = input.skillId ?? input.action?.skillId;
  const skillLabel = input.skillLabel ?? input.action?.skillLabel;
  const policyInput: OgenPolicyInput = {
    tenantId,
    policyVersion: OGEN_POLICY_VERSION,
    requestId: input.requestId,
    conversationId: input.conversationId,
    interpretation: input.interpretation,
    connectorRoute: {
      status: input.connectorRouteStatus,
      connectorId,
      resourceSystem,
      skillId,
      skillLabel,
      runtimeMode: input.runtimeMode ?? "not_available"
    },
    subject: {
      tenantId,
      userId: input.subject?.userId,
      provider: input.subject?.provider,
      issuer: input.subject?.issuer,
      subject: input.subject?.subject,
      email: input.subject?.email,
      roles: input.subject?.roles ?? [],
      groups: input.subject?.groups
    },
    resource: {
      connectorId,
      resourceSystem,
      resourceId: input.resource?.resourceId,
      resourceType: input.resource?.resourceType,
      environment: input.resource?.environment ?? "unknown"
    },
    action: {
      skillId,
      skillLabel,
      executionType: input.executionType ?? input.action?.executionType,
      riskLevel: input.riskLevel ?? input.action?.riskLevel,
      sensitivity: input.sensitivity ?? input.action?.sensitivity,
      requiresApproval: input.requiresApproval ?? input.action?.requiresApproval,
      actionCategory: input.action?.actionCategory,
      approvalMode: input.action?.approvalMode,
      resourceSensitivity: input.action?.resourceSensitivity,
      fieldClasses: input.action?.fieldClasses,
      actionConstraints: input.action?.actionConstraints,
      requiredApplicationGrants: input.action?.requiredApplicationGrants,
      requiredEffectivePermissions: input.action?.requiredEffectivePermissions,
      provider: input.action?.provider,
      resourceSystem: input.action?.resourceSystem,
      requestedScopes: input.action?.requestedScopes
    }
  };

  return toConnectorPolicyEvaluation(evaluateOgenPolicy(policyInput));
}
