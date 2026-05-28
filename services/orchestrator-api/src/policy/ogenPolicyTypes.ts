import type { OgenActionCategory, OgenActionConstraints, OgenApprovalMode, OgenFieldClass, OgenResourceSensitivity } from "@a2a/shared";

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
  actionCategory?: OgenActionCategory;
  approvalMode?: OgenApprovalMode;
  resourceSensitivity?: OgenResourceSensitivity;
  fieldClasses?: OgenFieldClass[];
  actionConstraints?: OgenActionConstraints;
  requiredApplicationGrants?: string[];
  requiredEffectivePermissions?: string[];
  provider?: string;
  resourceSystem?: string;
  requestedScopes?: string[];
};

export type OgenPolicyConditionModel = {
  actionCategories?: OgenActionCategory[];
  executionTypes?: string[];
  riskLevels?: string[];
  approvalModes?: OgenApprovalMode[];
  resourceSensitivities?: OgenResourceSensitivity[];
  actorRolesAny?: string[];
  connectorIds?: string[];
  resourceSystems?: string[];
  providers?: string[];
  fieldClasses?: OgenFieldClass[];
  bulk?: boolean;
  maxRecordsPerRequest?: number;
  maxActionsPerHour?: number;
  requiresConnectedAccount?: boolean;
  auditRequired?: boolean;
};

export type OgenPolicyInput = {
  tenantId: string;
  policyVersion: string;
  requestId?: string;
  conversationId?: string;
  interpretation?: {
    interpretationId?: string;
    schemaVersion?: string;
    interpretationSource?: "ai" | "fallback";
    scope?: string;
    intentType?: string;
    requestedCapability?: string;
    confidence?: "low" | "medium" | "high";
    risks?: string[];
    advisoryOnly?: true;
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
    actionCategories?: OgenActionCategory[];
    approvalModes?: OgenApprovalMode[];
    resourceSensitivities?: OgenResourceSensitivity[];
    providers?: string[];
    fieldClasses?: OgenFieldClass[];
    sensitivities?: string[];
    bulk?: boolean;
    maxRecordsPerRequest?: number;
    maxActionsPerHour?: number;
    requiresConnectedAccount?: boolean;
    auditRequired?: boolean;
    actorRolesAny?: string[];
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
