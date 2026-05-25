import { createHash, randomUUID } from "node:crypto";
import type { OgenPolicyDecision, OgenPolicyEffect, OgenPolicyInput, OgenPolicyRule } from "./ogenPolicyTypes.js";

export const OGEN_POLICY_VERSION = "ogen.policy.v1";

export const defaultOgenPolicyRules: OgenPolicyRule[] = [
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
  {
    id: "default-deny",
    name: "Default deny",
    description: "Requests that do not match an allow rule are blocked by default.",
    effect: "block",
    priority: 1000,
    enabled: true,
    match: {}
  }
];

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
  return {
    tenantId: input.tenantId,
    policyVersion: input.policyVersion,
    requestId: input.requestId,
    conversationId: input.conversationId,
    interpretation: input.interpretation
      ? {
          interpretationSource: input.interpretation.interpretationSource,
          scope: input.interpretation.scope,
          intentType: input.interpretation.intentType,
          requestedCapability: input.interpretation.requestedCapability,
          confidence: input.interpretation.confidence
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
      requestedScopes: input.action.requestedScopes
    }
  };
}

function inList(value: string | undefined, allowed: string[] | undefined): boolean {
  return !allowed || (value ? allowed.includes(value) : false);
}

function roleSet(input: OgenPolicyInput): Set<string> {
  return new Set(input.subject.roles.map((role) => role.toLowerCase()));
}

function roleRequirementSatisfied(input: OgenPolicyInput, rule: OgenPolicyRule): boolean {
  const roles = roleSet(input);
  const any = rule.match.requiredRolesAny?.map((role) => role.toLowerCase());
  const all = rule.match.requiredRolesAll?.map((role) => role.toLowerCase());
  const anySatisfied = !any || any.some((role) => roles.has(role));
  const allSatisfied = !all || all.every((role) => roles.has(role));
  return anySatisfied && allSatisfied;
}

function matchesGenericFields(input: OgenPolicyInput, rule: OgenPolicyRule): boolean {
  return inList(input.connectorRoute.connectorId ?? input.resource.connectorId, rule.match.connectorIds) &&
    inList(input.connectorRoute.resourceSystem ?? input.resource.resourceSystem, rule.match.resourceSystems) &&
    inList(input.connectorRoute.skillId ?? input.action.skillId, rule.match.skillIds) &&
    inList(input.action.executionType, rule.match.executionTypes) &&
    inList(input.action.riskLevel, rule.match.riskLevels) &&
    inList(input.action.sensitivity, rule.match.sensitivities) &&
    inList(input.resource.environment, rule.match.environments) &&
    inList(input.connectorRoute.status, rule.match.routeStatuses);
}

function routeApproved(input: OgenPolicyInput): boolean {
  return input.connectorRoute.status === "connector_skill_approved";
}

function runtimeExternallyAvailable(input: OgenPolicyInput): boolean {
  return input.connectorRoute.runtimeMode === "external_runtime_available";
}

function approvalRequired(input: OgenPolicyInput): boolean {
  return input.action.requiresApproval === true ||
    input.action.executionType === "write_action" ||
    input.action.riskLevel === "high" ||
    input.action.riskLevel === "sensitive" ||
    input.action.sensitivity === "sensitive";
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

  if (rule.id === "allow-readonly-approved-runtime") {
    const readOnly = input.action.executionType === "diagnostic_read_only" ||
      input.action.executionType === "inspection_read_only";
    const safeRisk = input.action.riskLevel === "low" ||
      input.action.riskLevel === "medium";
    return routeApproved(input) && runtimeExternallyAvailable(input) && readOnly && safeRisk && !approvalRequired(input);
  }

  return true;
}

function buildDecision(
  input: OgenPolicyInput,
  effect: OgenPolicyEffect,
  reason: string,
  matchedRuleIds: string[],
  deniedByDefault: boolean
): OgenPolicyDecision {
  const summary = safeInputSummary(input);
  return {
    decisionId: randomUUID(),
    tenantId: input.tenantId,
    policyVersion: input.policyVersion,
    effect,
    reason,
    matchedRuleIds,
    deniedByDefault,
    requiresApproval: effect === "needs_approval",
    createdAt: new Date().toISOString(),
    inputHash: inputHash(summary),
    safeInputSummary: summary
  };
}

function reasonFor(effect: OgenPolicyEffect, matchedRuleIds: string[]): string {
  if (matchedRuleIds.includes("block-unapproved-route")) {
    return "Connector route is not approved for runtime execution.";
  }
  if (matchedRuleIds.includes("block-low-confidence-interpretation")) {
    return "Request interpretation confidence is too low for runtime execution.";
  }
  if (matchedRuleIds.includes("block-metadata-only-runtime")) {
    return "Connector trust metadata is metadata-only; runtime execution requires fresh runtime validation.";
  }
  if (matchedRuleIds.includes("block-missing-action-risk-metadata")) {
    return "Connector action is missing explicit execution type or risk classification.";
  }
  if (effect === "needs_approval") {
    return "Ogen policy requires governed approval before this write, high-risk, or sensitive connector action can execute.";
  }
  if (effect === "allow") {
    return "Ogen policy allowed this approved read-only connector runtime action.";
  }
  return "Ogen policy denied the request by default.";
}

export function evaluateOgenPolicy(input: OgenPolicyInput, rules = defaultOgenPolicyRules): OgenPolicyDecision {
  const enabledRules = [...rules]
    .filter((rule) => rule.enabled)
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));

  const matched: OgenPolicyRule[] = [];

  for (const rule of enabledRules) {
    if (!ruleMatches(input, rule)) {
      continue;
    }

    if (!roleRequirementSatisfied(input, rule)) {
      return buildDecision(
        input,
        "block",
        `Required policy role is missing for rule ${rule.id}.`,
        [rule.id],
        false
      );
    }

    matched.push(rule);
  }

  const blocks = matched.filter((rule) => rule.effect === "block");
  if (blocks.length > 0) {
    const matchedRuleIds = blocks.map((rule) => rule.id);
    return buildDecision(input, "block", reasonFor("block", matchedRuleIds), matchedRuleIds, false);
  }

  const approvalRules = matched.filter((rule) => rule.effect === "needs_approval");
  if (approvalRules.length > 0) {
    const matchedRuleIds = approvalRules.map((rule) => rule.id);
    return buildDecision(input, "needs_approval", reasonFor("needs_approval", matchedRuleIds), matchedRuleIds, false);
  }

  const allowRules = matched.filter((rule) => rule.effect === "allow");
  if (allowRules.length > 0) {
    const matchedRuleIds = allowRules.map((rule) => rule.id);
    return buildDecision(input, "allow", reasonFor("allow", matchedRuleIds), matchedRuleIds, false);
  }

  const defaultRule = enabledRules.find((rule) => rule.id === "default-deny");
  return buildDecision(
    input,
    "block",
    "Ogen policy denied the request by default because no allow rule matched.",
    defaultRule ? [defaultRule.id] : [],
    true
  );
}
