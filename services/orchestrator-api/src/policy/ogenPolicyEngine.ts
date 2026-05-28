import { createHash, randomUUID } from "node:crypto";
import type { OgenPolicyDecision, OgenPolicyEffect, OgenPolicyInput, OgenPolicyMatchedRuleSummary, OgenPolicyRule } from "./ogenPolicyTypes.js";

export const OGEN_POLICY_VERSION = "ogen.policy.v1";

const allowedOgenActionCategories = new Set([
  "read",
  "search",
  "diagnose",
  "comment.add",
  "business_object.read",
  "business_object.create",
  "business_object.update",
  "workflow_state.change",
  "assignment.change",
  "permission.inspect",
  "permission.grant",
  "record.delete",
  "bulk.modify",
  "admin.configure",
  "external_message.send"
]);
const allowedOgenApprovalModes = new Set(["never", "policy", "always", "blocked"]);
const allowedOgenResourceSensitivities = new Set(["standard", "sensitive", "regulated", "security_critical", "admin_controlled"]);
const allowedOgenFieldClasses = new Set([
  "workflow_state",
  "assignment",
  "classification",
  "financial",
  "customer_pii",
  "employee_pii",
  "security",
  "identity",
  "permission",
  "admin_config",
  "external_message"
]);
const allowedOgenActionConstraintKeys = new Set([
  "bulkAllowed",
  "maxRecordsPerRequest",
  "maxActionsPerHour",
  "requiresConnectedAccount",
  "auditRequired"
]);

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      if (nested && typeof nested === "object" && !Object.isFrozen(nested)) {
        deepFreeze(nested);
      }
    }
  }
  return value as Readonly<T>;
}

function cloneRule(rule: OgenPolicyRule): OgenPolicyRule {
  return {
    ...rule,
    match: {
      ...rule.match,
      connectorIds: rule.match.connectorIds ? [...rule.match.connectorIds] : undefined,
      resourceSystems: rule.match.resourceSystems ? [...rule.match.resourceSystems] : undefined,
      skillIds: rule.match.skillIds ? [...rule.match.skillIds] : undefined,
      executionTypes: rule.match.executionTypes ? [...rule.match.executionTypes] : undefined,
      riskLevels: rule.match.riskLevels ? [...rule.match.riskLevels] : undefined,
      actionCategories: rule.match.actionCategories ? [...rule.match.actionCategories] : undefined,
      approvalModes: rule.match.approvalModes ? [...rule.match.approvalModes] : undefined,
      resourceSensitivities: rule.match.resourceSensitivities ? [...rule.match.resourceSensitivities] : undefined,
      providers: rule.match.providers ? [...rule.match.providers] : undefined,
      fieldClasses: rule.match.fieldClasses ? [...rule.match.fieldClasses] : undefined,
      sensitivities: rule.match.sensitivities ? [...rule.match.sensitivities] : undefined,
      actorRolesAny: rule.match.actorRolesAny ? [...rule.match.actorRolesAny] : undefined,
      requiredRolesAny: rule.match.requiredRolesAny ? [...rule.match.requiredRolesAny] : undefined,
      requiredRolesAll: rule.match.requiredRolesAll ? [...rule.match.requiredRolesAll] : undefined,
      environments: rule.match.environments ? [...rule.match.environments] : undefined,
      routeStatuses: rule.match.routeStatuses ? [...rule.match.routeStatuses] : undefined
    }
  };
}

function freezeRules<T extends readonly OgenPolicyRule[]>(rules: T): ReadonlyArray<Readonly<OgenPolicyRule>> {
  return deepFreeze(rules.map((rule) => cloneRule(rule)));
}

const mandatoryOgenPolicyGuardrailsDefinition: OgenPolicyRule[] = [
  {
    id: "block-unapproved-route",
    name: "Block unapproved connector route",
    description: "Runtime execution is blocked unless connector routing approved the requested skill.",
    effect: "block",
    priority: 10,
    enabled: true,
    match: {
      routeStatuses: [
        "connector_skill_blocked",
        "connector_skill_not_declared",
        "connector_skill_not_enabled",
        "connector_not_onboarded",
        "unsupported",
        "needs_more_info"
      ]
    }
  },
  {
    id: "block-low-confidence-interpretation",
    name: "Block low-confidence interpretation",
    description: "AI or fallback interpretation with low confidence cannot authorize runtime execution.",
    effect: "block",
    priority: 15,
    enabled: true,
    match: {}
  },
  {
    id: "block-unsafe-interpretation-risk",
    name: "Block unsafe interpretation risk",
    description: "Prompt injection, policy bypass, secret/token requests, and unsupported interpretation scope cannot authorize runtime execution.",
    effect: "block",
    priority: 17,
    enabled: true,
    match: {}
  },
  {
    id: "block-metadata-only-runtime",
    name: "Block metadata-only runtime",
    description: "Persisted connector metadata can show installed state but cannot execute runtime without fresh validation.",
    effect: "block",
    priority: 20,
    enabled: true,
    match: {
      routeStatuses: ["connector_skill_approved"]
    }
  },
  {
    id: "approval-required-for-write-or-sensitive",
    name: "Require approval for write or sensitive actions",
    description: "Write, high-risk, sensitive, or approval-marked connector actions require governed approval.",
    effect: "needs_approval",
    priority: 30,
    enabled: true,
    match: {
      routeStatuses: ["connector_skill_approved"]
    }
  },
  {
    id: "block-missing-action-risk-metadata",
    name: "Block missing action risk metadata",
    description: "Runtime execution requires explicit execution type and risk classification.",
    effect: "block",
    priority: 35,
    enabled: true,
    match: {
      routeStatuses: ["connector_skill_approved"]
    }
  },
  {
    id: "block-resource-system-metadata-mismatch",
    name: "Block resource system metadata mismatch",
    description: "Caller-supplied action resource system must match trusted route/resource context before policy can evaluate resource-scoped rules.",
    effect: "block",
    priority: 36,
    enabled: true,
    match: {
      routeStatuses: ["connector_skill_approved"]
    }
  },
  {
    id: "block-missing-action-taxonomy-metadata",
    name: "Block missing action taxonomy metadata",
    description: "Runtime execution requires explicit normalized action taxonomy metadata.",
    effect: "block",
    priority: 37,
    enabled: true,
    match: {
      routeStatuses: ["connector_skill_approved"]
    }
  },
  {
    id: "block-blocked-approval-mode",
    name: "Block actions marked blocked by approval mode",
    description: "Normalized action taxonomy approvalMode blocked is a mandatory deny outcome.",
    effect: "block",
    priority: 38,
    enabled: true,
    match: {
      routeStatuses: ["connector_skill_approved"]
    }
  }
];

const defaultDenyRuleDefinition: OgenPolicyRule = {
  id: "default-deny",
  name: "Default deny",
  description: "Requests that do not match an allow rule are blocked by default.",
  effect: "block",
  priority: 1000,
  enabled: true,
  match: {}
};

const defaultTenantOgenPolicyRulesDefinition: OgenPolicyRule[] = [
  {
    id: "allow-readonly-approved-runtime",
    name: "Allow read-only approved runtime",
    description: "Read-only approved connector skills may execute only when the runtime endpoint is externally available.",
    effect: "allow",
    priority: 100,
    enabled: true,
    match: {
      routeStatuses: ["connector_skill_approved"]
    }
  },
  defaultDenyRuleDefinition
];

export const mandatoryOgenPolicyGuardrails: ReadonlyArray<Readonly<OgenPolicyRule>> = freezeRules(mandatoryOgenPolicyGuardrailsDefinition);

export const defaultDenyRule: Readonly<OgenPolicyRule> = deepFreeze(cloneRule(defaultDenyRuleDefinition));

export const defaultTenantOgenPolicyRules: ReadonlyArray<Readonly<OgenPolicyRule>> = freezeRules(defaultTenantOgenPolicyRulesDefinition);

export const reservedOgenPolicyRuleIds: ReadonlyArray<string> = Object.freeze([
  ...mandatoryOgenPolicyGuardrails.map((rule) => rule.id),
  defaultDenyRule.id
]);

const reservedOgenPolicyRuleIdSet = new Set(reservedOgenPolicyRuleIds);

export const defaultOgenPolicyRules: ReadonlyArray<Readonly<OgenPolicyRule>> = freezeRules([
  ...mandatoryOgenPolicyGuardrails,
  ...defaultTenantOgenPolicyRules
]);

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)])
    );
  }

  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function inputHash(summary: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(summary)).digest("hex");
}

function safeInputSummary(input: OgenPolicyInput): Record<string, unknown> {
  const trustedResourceSystem = trustedPolicyResourceSystem(input);
  return {
    tenantId: input.tenantId,
    policyVersion: input.policyVersion,
    requestId: input.requestId,
    conversationId: input.conversationId,
    interpretation: input.interpretation
      ? {
          interpretationId: input.interpretation.interpretationId,
          schemaVersion: input.interpretation.schemaVersion,
          interpretationSource: input.interpretation.interpretationSource,
          scope: input.interpretation.scope,
          intentType: input.interpretation.intentType,
          requestedCapability: input.interpretation.requestedCapability,
          confidence: input.interpretation.confidence,
          risks: input.interpretation.risks,
          advisoryOnly: input.interpretation.advisoryOnly
        }
      : undefined,
    connectorRoute: {
      status: input.connectorRoute.status,
      connectorId: input.connectorRoute.connectorId,
      resourceSystem: input.connectorRoute.resourceSystem,
      skillId: input.connectorRoute.skillId,
      skillLabel: input.connectorRoute.skillLabel,
      runtimeMode: input.connectorRoute.runtimeMode
    },
    subject: {
      tenantId: input.subject.tenantId,
      userId: input.subject.userId,
      provider: input.subject.provider,
      issuer: input.subject.issuer,
      subject: input.subject.subject,
      email: input.subject.email,
      roles: input.subject.roles,
      groups: input.subject.groups
    },
    resource: input.resource,
    action: {
      skillId: input.action.skillId,
      skillLabel: input.action.skillLabel,
      executionType: input.action.executionType,
      riskLevel: input.action.riskLevel,
      sensitivity: input.action.sensitivity,
      requiresApproval: input.action.requiresApproval,
      actionCategory: input.action.actionCategory,
      approvalMode: input.action.approvalMode,
      resourceSensitivity: input.action.resourceSensitivity,
      fieldClasses: input.action.fieldClasses,
      actionConstraints: input.action.actionConstraints,
      requiredApplicationGrants: input.action.requiredApplicationGrants,
      requiredEffectivePermissions: input.action.requiredEffectivePermissions,
      provider: input.action.provider,
      resourceSystem: input.action.resourceSystem,
      requestedScopes: input.action.requestedScopes
    },
    policyMatchContext: {
      trustedResourceSystem,
      actionResourceSystemMatchesTrusted: !input.action.resourceSystem ||
        !trustedResourceSystem ||
        input.action.resourceSystem === trustedResourceSystem
    }
  };
}

function inList(value: string | undefined, allowed: string[] | undefined): boolean {
  return !allowed || (value ? allowed.includes(value) : false);
}

function intersects(values: string[] | undefined, allowed: string[] | undefined): boolean {
  return !allowed || (values ? values.some((value) => allowed.includes(value)) : false);
}

function booleanCondition(value: boolean | undefined, expected: boolean | undefined): boolean {
  return expected === undefined || value === expected;
}

function maxCondition(value: number | undefined, expected: number | undefined): boolean {
  return expected === undefined || (value !== undefined && value <= expected);
}

function isAllowedActionCategory(value: unknown): boolean {
  return typeof value === "string" && allowedOgenActionCategories.has(value);
}

function isAllowedApprovalMode(value: unknown): boolean {
  return typeof value === "string" && allowedOgenApprovalModes.has(value);
}

function isAllowedResourceSensitivity(value: unknown): boolean {
  return typeof value === "string" && allowedOgenResourceSensitivities.has(value);
}

function hasValidFieldClasses(value: unknown): boolean {
  return Array.isArray(value) &&
    value.every((fieldClass) => typeof fieldClass === "string" && allowedOgenFieldClasses.has(fieldClass));
}

function positiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function hasValidActionConstraintEntry(key: string, value: unknown): boolean {
  if (!allowedOgenActionConstraintKeys.has(key)) {
    return false;
  }

  if (value === undefined) {
    return true;
  }

  if (key === "maxRecordsPerRequest" || key === "maxActionsPerHour") {
    return positiveInteger(value);
  }

  return value === true || value === false;
}

function hasValidActionConstraints(value: unknown): boolean {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value as Record<string, unknown>).every(([key, entry]) => hasValidActionConstraintEntry(key, entry));
}

function trustedPolicyResourceSystem(input: OgenPolicyInput): string | undefined {
  return input.connectorRoute.resourceSystem ?? input.resource.resourceSystem;
}

function actionResourceSystemMatchesTrusted(input: OgenPolicyInput): boolean {
  const trustedResourceSystem = trustedPolicyResourceSystem(input);
  return !input.action.resourceSystem ||
    !trustedResourceSystem ||
    input.action.resourceSystem === trustedResourceSystem;
}

function hasCompleteActionTaxonomyMetadata(input: OgenPolicyInput): boolean {
  return isAllowedActionCategory(input.action.actionCategory) &&
    isAllowedApprovalMode(input.action.approvalMode) &&
    isAllowedResourceSensitivity(input.action.resourceSensitivity) &&
    hasValidFieldClasses(input.action.fieldClasses) &&
    hasValidActionConstraints(input.action.actionConstraints);
}

function roleSet(input: OgenPolicyInput): Set<string> {
  return new Set(input.subject.roles.map((role) => role.toLowerCase()));
}

function roleAnySatisfied(roles: ReadonlySet<string>, requiredRoles: readonly string[] | undefined): boolean {
  return !requiredRoles || requiredRoles.some((role) => roles.has(role.toLowerCase()));
}

function roleAllSatisfied(roles: ReadonlySet<string>, requiredRoles: readonly string[] | undefined): boolean {
  return !requiredRoles || requiredRoles.every((role) => roles.has(role.toLowerCase()));
}

function roleRequirementSatisfied(input: OgenPolicyInput, rule: OgenPolicyRule): boolean {
  const roles = roleSet(input);
  return roleAnySatisfied(roles, rule.match.requiredRolesAny) &&
    roleAllSatisfied(roles, rule.match.requiredRolesAll);
}

function matchesGenericFields(input: OgenPolicyInput, rule: OgenPolicyRule): boolean {
  const constraints = input.action.actionConstraints;
  const roles = roleSet(input);
  return inList(input.connectorRoute.connectorId ?? input.resource.connectorId, rule.match.connectorIds) &&
    inList(trustedPolicyResourceSystem(input), rule.match.resourceSystems) &&
    inList(input.connectorRoute.skillId ?? input.action.skillId, rule.match.skillIds) &&
    inList(input.action.executionType, rule.match.executionTypes) &&
    inList(input.action.riskLevel, rule.match.riskLevels) &&
    inList(input.action.actionCategory, rule.match.actionCategories) &&
    inList(input.action.approvalMode, rule.match.approvalModes) &&
    inList(input.action.resourceSensitivity, rule.match.resourceSensitivities) &&
    inList(input.action.provider, rule.match.providers) &&
    intersects(input.action.fieldClasses, rule.match.fieldClasses) &&
    inList(input.action.sensitivity, rule.match.sensitivities) &&
    booleanCondition(constraints?.bulkAllowed, rule.match.bulk) &&
    maxCondition(constraints?.maxRecordsPerRequest, rule.match.maxRecordsPerRequest) &&
    maxCondition(constraints?.maxActionsPerHour, rule.match.maxActionsPerHour) &&
    booleanCondition(constraints?.requiresConnectedAccount, rule.match.requiresConnectedAccount) &&
    booleanCondition(constraints?.auditRequired, rule.match.auditRequired) &&
    inList(input.resource.environment, rule.match.environments) &&
    inList(input.connectorRoute.status, rule.match.routeStatuses) &&
    roleAnySatisfied(roles, rule.match.actorRolesAny);
}

function routeApproved(input: OgenPolicyInput): boolean {
  return input.connectorRoute.status === "connector_skill_approved";
}

function runtimeExternallyAvailable(input: OgenPolicyInput): boolean {
  return input.connectorRoute.runtimeMode === "external_runtime_available";
}

function approvalRequired(input: OgenPolicyInput): boolean {
  return input.action.requiresApproval === true ||
    input.action.approvalMode === "always" ||
    input.action.executionType === "write_action" ||
    input.action.riskLevel === "high" ||
    input.action.riskLevel === "sensitive" ||
    input.action.sensitivity === "sensitive";
}

function unsafeInterpretationRisk(input: OgenPolicyInput): boolean {
  const risks = input.interpretation?.risks ?? [];
  return risks.some((risk) =>
    risk === "prompt_injection_attempt" ||
    risk === "policy_bypass_attempt" ||
    risk === "secret_or_token_request" ||
    risk === "unsupported_scope"
  );
}

function ruleMatches(input: OgenPolicyInput, rule: OgenPolicyRule): boolean {
  if (rule.id === "default-deny") {
    return false;
  }

  if (!matchesGenericFields(input, rule)) {
    return false;
  }

  if (rule.id === "block-low-confidence-interpretation") {
    return input.interpretation?.confidence === "low";
  }

  if (rule.id === "block-unsafe-interpretation-risk") {
    return unsafeInterpretationRisk(input);
  }

  if (rule.id === "block-metadata-only-runtime") {
    return routeApproved(input) && !runtimeExternallyAvailable(input);
  }

  if (rule.id === "approval-required-for-write-or-sensitive") {
    return routeApproved(input) && runtimeExternallyAvailable(input) && approvalRequired(input);
  }

  if (rule.id === "block-missing-action-risk-metadata") {
    return routeApproved(input) &&
      runtimeExternallyAvailable(input) &&
      (!input.action.executionType || !input.action.riskLevel);
  }

  if (rule.id === "block-resource-system-metadata-mismatch") {
    return routeApproved(input) &&
      runtimeExternallyAvailable(input) &&
      !actionResourceSystemMatchesTrusted(input);
  }

  if (rule.id === "block-missing-action-taxonomy-metadata") {
    return routeApproved(input) &&
      runtimeExternallyAvailable(input) &&
      !hasCompleteActionTaxonomyMetadata(input);
  }

  if (rule.id === "block-blocked-approval-mode") {
    return routeApproved(input) &&
      runtimeExternallyAvailable(input) &&
      input.action.approvalMode === "blocked";
  }

  if (rule.id === "allow-readonly-approved-runtime") {
    const readOnly = input.action.executionType === "diagnostic_read_only" ||
      input.action.executionType === "inspection_read_only";
    const safeRisk = input.action.riskLevel === "low" ||
      input.action.riskLevel === "medium";
    return routeApproved(input) && runtimeExternallyAvailable(input) && readOnly && safeRisk && !approvalRequired(input);
  }

  return true;
}

type MatchedRuleSource = "guardrail" | "tenant" | "default";

function ruleSummary(rule: OgenPolicyRule, source: MatchedRuleSource): OgenPolicyMatchedRuleSummary {
  return {
    id: rule.id,
    name: rule.name,
    effect: rule.effect,
    source,
    description: rule.description
  };
}

function primaryRule(params: {
  effect: OgenPolicyEffect;
  guardrailRules: readonly OgenPolicyRule[];
  tenantRules: readonly OgenPolicyRule[];
  deniedByDefault: boolean;
  primaryRule?: OgenPolicyRule;
  primaryRuleSource?: MatchedRuleSource;
}): { rule?: OgenPolicyRule; source?: MatchedRuleSource } {
  if (params.primaryRule && params.primaryRuleSource) {
    return {
      rule: params.primaryRule,
      source: params.primaryRuleSource
    };
  }

  if (params.deniedByDefault) {
    return {
      rule: defaultDenyRule,
      source: "default"
    };
  }

  const guardrail = params.guardrailRules.find((rule) => rule.effect === params.effect);
  if (guardrail) {
    return { rule: guardrail, source: "guardrail" };
  }

  const tenant = params.tenantRules.find((rule) => rule.effect === params.effect);
  return tenant ? { rule: tenant, source: "tenant" } : {};
}

function reasonFromMatchedRules(params: {
  effect: OgenPolicyEffect;
  guardrailRules: readonly OgenPolicyRule[];
  tenantRules: readonly OgenPolicyRule[];
  deniedByDefault: boolean;
  primaryRule?: OgenPolicyRule;
  primaryRuleSource?: MatchedRuleSource;
}): string {
  if (params.deniedByDefault) {
    return "Ogen policy denied the request by default because no tenant allow rule matched.";
  }

  const primary = primaryRule(params);
  if (!primary.rule || !primary.source) {
    return "Ogen policy denied the request by default because no tenant allow rule matched.";
  }

  if (primary.source === "guardrail" && params.effect === "block") {
    return `Ogen guardrail blocked the request: ${primary.rule.name}. ${primary.rule.description}`;
  }

  if (primary.source === "tenant" && params.effect === "block") {
    return `Tenant policy blocked the request: ${primary.rule.name}. ${primary.rule.description}`;
  }

  if (primary.source === "guardrail" && params.effect === "needs_approval") {
    return `Ogen guardrail requires approval: ${primary.rule.name}. ${primary.rule.description}`;
  }

  if (primary.source === "tenant" && params.effect === "needs_approval") {
    return `Tenant policy requires approval: ${primary.rule.name}. ${primary.rule.description}`;
  }

  if (primary.source === "tenant" && params.effect === "allow") {
    return `Tenant policy allowed the request: ${primary.rule.name}. ${primary.rule.description}`;
  }

  return `${primary.rule.name}. ${primary.rule.description}`;
}

function buildDecision(params: {
  input: OgenPolicyInput;
  effect: OgenPolicyEffect;
  guardrailRules: readonly OgenPolicyRule[];
  tenantRules: readonly OgenPolicyRule[];
  deniedByDefault: boolean;
  primaryRule?: OgenPolicyRule;
  primaryRuleSource?: MatchedRuleSource;
  reason?: string;
}): OgenPolicyDecision {
  const { input, effect, guardrailRules, tenantRules, deniedByDefault } = params;
  const summary = safeInputSummary(input);
  const matchedGuardrailRuleIds = guardrailRules.map((rule) => rule.id);
  const matchedTenantRuleIds = tenantRules.map((rule) => rule.id);
  const primary = primaryRule({
    effect,
    guardrailRules,
    tenantRules,
    deniedByDefault,
    primaryRule: params.primaryRule,
    primaryRuleSource: params.primaryRuleSource
  });
  const matchedRuleSummaries = [
    ...guardrailRules.map((rule) => ruleSummary(rule, "guardrail")),
    ...tenantRules.map((rule) => ruleSummary(rule, "tenant")),
    ...(primary.rule && primary.source === "default" ? [ruleSummary(primary.rule, "default")] : [])
  ];
  const matchedRuleIds = Array.from(new Set(matchedRuleSummaries.map((rule) => rule.id)));
  return {
    decisionId: randomUUID(),
    tenantId: input.tenantId,
    policyVersion: input.policyVersion,
    effect,
    reason: params.reason ?? reasonFromMatchedRules({
      effect,
      guardrailRules,
      tenantRules,
      deniedByDefault,
      primaryRule: params.primaryRule,
      primaryRuleSource: params.primaryRuleSource
    }),
    primaryRuleId: primary.rule?.id,
    primaryRuleSource: primary.source,
    matchedRuleIds,
    matchedGuardrailRuleIds,
    matchedTenantRuleIds,
    matchedRuleSummaries,
    deniedByDefault,
    requiresApproval: effect === "needs_approval",
    createdAt: new Date().toISOString(),
    inputHash: inputHash(summary),
    safeInputSummary: summary
  };
}

export function evaluateOgenPolicy(input: OgenPolicyInput, rules: readonly OgenPolicyRule[] = defaultOgenPolicyRules): OgenPolicyDecision {
  const enabledGuardrails = [...mandatoryOgenPolicyGuardrails]
    .filter((rule) => rule.enabled)
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));

  const tenantRules = rules.filter((rule) => !reservedOgenPolicyRuleIdSet.has(rule.id));
  const enabledTenantRules = tenantRules
    .filter((rule) => rule.enabled)
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));

  const matchedGuardrails: OgenPolicyRule[] = [];
  const matchedTenantRules: OgenPolicyRule[] = [];

  for (const rule of enabledGuardrails) {
    if (!ruleMatches(input, rule)) {
      continue;
    }

    if (!roleRequirementSatisfied(input, rule)) {
      return buildDecision({
        input,
        effect: "block",
        guardrailRules: [rule],
        tenantRules: [],
        deniedByDefault: false,
        primaryRule: rule,
        primaryRuleSource: "guardrail",
        reason: `Required policy role is missing for Ogen guardrail ${rule.name}. ${rule.description}`
      });
    }

    matchedGuardrails.push(rule);
  }

  const guardrailBlocks = matchedGuardrails.filter((rule) => rule.effect === "block");
  if (guardrailBlocks.length > 0) {
    return buildDecision({
      input,
      effect: "block",
      guardrailRules: guardrailBlocks,
      tenantRules: [],
      deniedByDefault: false
    });
  }

  const guardrailApprovalRules = matchedGuardrails.filter((rule) => rule.effect === "needs_approval");
  const guardrailApprovalRuleIds = guardrailApprovalRules.map((rule) => rule.id);

  for (const rule of enabledTenantRules) {
    if (!ruleMatches(input, rule)) {
      continue;
    }

    if (!roleRequirementSatisfied(input, rule)) {
      return buildDecision({
        input,
        effect: "block",
        guardrailRules: guardrailApprovalRules,
        tenantRules: [rule],
        deniedByDefault: false,
        primaryRule: rule,
        primaryRuleSource: "tenant",
        reason: `Required policy role is missing for tenant policy ${rule.name}. ${rule.description}`
      });
    }

    matchedTenantRules.push(rule);
  }

  const tenantBlocks = matchedTenantRules.filter((rule) => rule.effect === "block");
  if (tenantBlocks.length > 0) {
    return buildDecision({
      input,
      effect: "block",
      guardrailRules: guardrailApprovalRules,
      tenantRules: tenantBlocks,
      deniedByDefault: false
    });
  }

  const tenantApprovalRules = matchedTenantRules.filter((rule) => rule.effect === "needs_approval");
  if (guardrailApprovalRules.length > 0 || tenantApprovalRules.length > 0) {
    return buildDecision({
      input,
      effect: "needs_approval",
      guardrailRules: guardrailApprovalRules,
      tenantRules: tenantApprovalRules,
      deniedByDefault: false
    });
  }

  const tenantAllowRules = matchedTenantRules.filter((rule) => rule.effect === "allow");
  if (tenantAllowRules.length > 0) {
    return buildDecision({
      input,
      effect: "allow",
      guardrailRules: [],
      tenantRules: tenantAllowRules,
      deniedByDefault: false
    });
  }

  return buildDecision({
    input,
    effect: "block",
    guardrailRules: [],
    tenantRules: [],
    deniedByDefault: true,
    primaryRule: defaultDenyRule,
    primaryRuleSource: "default"
  });
}
