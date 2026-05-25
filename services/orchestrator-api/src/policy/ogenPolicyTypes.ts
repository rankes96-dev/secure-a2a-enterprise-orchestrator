export type OgenPolicyEffect =
  | "allow"
  | "block"
  | "needs_approval";

export type OgenPolicySubject = {
  tenantId: string;
  userId?: string;
  provider?: string;
  issuer?: string;
  subject?: string;
  email?: string;
  roles: string[];
  groups?: string[];
};

export type OgenPolicyResource = {
  connectorId?: string;
  resourceSystem?: string;
  resourceId?: string;
  resourceType?: string;
  environment?: "production" | "staging" | "development" | "unknown";
};

export type OgenPolicyAction = {
  skillId?: string;
  skillLabel?: string;
  executionType?: "diagnostic_read_only" | "inspection_read_only" | "write_action" | "unsupported";
  riskLevel?: "low" | "medium" | "high" | "sensitive";
  sensitivity?: "standard" | "sensitive";
  requiresApproval?: boolean;
  requestedScopes?: string[];
};

export type OgenPolicyInput = {
  tenantId: string;
  policyVersion: string;
  requestId?: string;
  conversationId?: string;
  interpretation?: {
    interpretationSource?: "ai" | "fallback";
    scope?: string;
    intentType?: string;
    requestedCapability?: string;
    confidence?: "low" | "medium" | "high";
  };
  connectorRoute: {
    status: string;
    connectorId?: string;
    resourceSystem?: string;
    skillId?: string;
    skillLabel?: string;
    runtimeMode?: string;
  };
  subject: OgenPolicySubject;
  resource: OgenPolicyResource;
  action: OgenPolicyAction;
};

export type OgenPolicyRule = {
  id: string;
  name: string;
  description: string;
  effect: OgenPolicyEffect;
  priority: number;
  enabled: boolean;
  match: {
    connectorIds?: string[];
    resourceSystems?: string[];
    skillIds?: string[];
    executionTypes?: string[];
    riskLevels?: string[];
    sensitivities?: string[];
    requiredRolesAny?: string[];
    requiredRolesAll?: string[];
    environments?: string[];
    routeStatuses?: string[];
  };
};

export type OgenPolicyMatchedRuleSummary = {
  id: string;
  name: string;
  effect: OgenPolicyEffect;
  source: "guardrail" | "tenant" | "default";
  description: string;
};

export type OgenPolicyDecision = {
  decisionId: string;
  tenantId: string;
  policyVersion: string;
  effect: OgenPolicyEffect;
  reason: string;
  primaryRuleId?: string;
  primaryRuleSource?: "guardrail" | "tenant" | "default";
  matchedRuleIds: string[];
  matchedGuardrailRuleIds: string[];
  matchedTenantRuleIds: string[];
  matchedRuleSummaries: OgenPolicyMatchedRuleSummary[];
  deniedByDefault: boolean;
  requiresApproval: boolean;
  createdAt: string;
  inputHash: string;
  safeInputSummary: Record<string, unknown>;
};
