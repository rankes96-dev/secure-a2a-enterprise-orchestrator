import { existsSync, readFileSync } from "node:fs";
import { evaluateOgenPolicy, OGEN_POLICY_VERSION, defaultOgenPolicyRules, defaultTenantOgenPolicyRules, mandatoryOgenPolicyGuardrails, reservedOgenPolicyRuleIds } from "../services/orchestrator-api/src/policy/ogenPolicyEngine.js";
import { evaluateConnectorPolicy } from "../services/orchestrator-api/src/policy/connectorPolicy.js";
import type { OgenPolicyInput, OgenPolicyRule } from "../services/orchestrator-api/src/policy/ogenPolicyTypes.js";

let failed = false;

function fail(message: string): void {
  failed = true;
  console.error(`FAIL: ${message}`);
}

function ok(message: string): void {
  console.log(`ok - ${message}`);
}

function read(path: string): string {
  if (!existsSync(path)) {
    fail(`${path} should exist`);
    return "";
  }
  return readFileSync(path, "utf8");
}

function requireIncludes(source: string, phrase: string, context: string): void {
  if (!source.includes(phrase)) {
    fail(`${context} missing required phrase: ${phrase}`);
    return;
  }
  ok(context);
}

function requireNotIncludes(source: string, phrase: string, context: string): void {
  if (source.includes(phrase)) {
    fail(`${context} should not include forbidden phrase: ${phrase}`);
    return;
  }
  ok(context);
}

function requireRule(id: string): void {
  if (!defaultOgenPolicyRules.some((rule) => rule.id === id)) {
    fail(`default Ogen policy rules should include ${id}`);
    return;
  }
  ok(`default Ogen policy rules include ${id}`);
}

function requireGuardrail(id: string): void {
  if (!mandatoryOgenPolicyGuardrails.some((rule) => rule.id === id)) {
    fail(`mandatory Ogen policy guardrails should include ${id}`);
    return;
  }
  ok(`mandatory Ogen policy guardrails include ${id}`);
}

function requireTenantRule(id: string): void {
  if (!defaultTenantOgenPolicyRules.some((rule) => rule.id === id)) {
    fail(`default tenant Ogen policy rules should include ${id}`);
    return;
  }
  ok(`default tenant Ogen policy rules include ${id}`);
}

function requireReservedRule(id: string): void {
  if (!reservedOgenPolicyRuleIds.includes(id)) {
    fail(`reserved Ogen policy rule IDs should include ${id}`);
    return;
  }
  ok(`reserved Ogen policy rule IDs include ${id}`);
}

type OgenPolicyInputOverrides = Partial<Omit<OgenPolicyInput, "interpretation" | "connectorRoute" | "subject" | "resource" | "action">> & {
  interpretation?: Partial<NonNullable<OgenPolicyInput["interpretation"]>>;
  connectorRoute?: Partial<OgenPolicyInput["connectorRoute"]>;
  subject?: Partial<OgenPolicyInput["subject"]>;
  resource?: Partial<OgenPolicyInput["resource"]>;
  action?: Partial<OgenPolicyInput["action"]>;
};

function baseInput(overrides: OgenPolicyInputOverrides = {}): OgenPolicyInput {
  const base: OgenPolicyInput = {
    tenantId: "default",
    policyVersion: OGEN_POLICY_VERSION,
    requestId: "smoke-request",
    conversationId: "smoke-conversation",
    interpretation: {
      interpretationSource: "ai",
      scope: "enterprise_support",
      intentType: "connector_runtime_action",
      requestedCapability: "jira.issue.status.lookup",
      confidence: "high"
    },
    connectorRoute: {
      status: "connector_skill_approved",
      connectorId: "jira-reference",
      resourceSystem: "jira",
      skillId: "jira.issue.status.lookup",
      skillLabel: "Look up Jira issue status",
      runtimeMode: "external_runtime_available"
    },
    subject: {
      tenantId: "default",
      provider: "auth0",
      issuer: "https://issuer.example/",
      subject: "user-subject",
      email: "ran@gateway.com",
      roles: ["it-support"]
    },
    resource: {
      connectorId: "jira-reference",
      resourceSystem: "jira",
      environment: "unknown"
    },
    action: {
      skillId: "jira.issue.status.lookup",
      skillLabel: "Look up Jira issue status",
      executionType: "diagnostic_read_only",
      riskLevel: "low",
      sensitivity: "standard",
      requiresApproval: false,
      requestedScopes: ["a2a:task.execute"]
    }
  };

  return {
    ...base,
    ...overrides,
    interpretation: {
      ...base.interpretation,
      ...overrides.interpretation
    },
    connectorRoute: {
      ...base.connectorRoute,
      ...overrides.connectorRoute
    },
    subject: {
      ...base.subject,
      ...overrides.subject
    },
    resource: {
      ...base.resource,
      ...overrides.resource
    },
    action: {
      ...base.action,
      ...overrides.action
    }
  };
}

function assertEffect(name: string, input: OgenPolicyInput, expected: "allow" | "block" | "needs_approval", rules?: OgenPolicyRule[]) {
  const decision = evaluateOgenPolicy(input, rules);
  if (decision.effect !== expected) {
    fail(`${name} expected ${expected}, got ${decision.effect}: ${decision.reason}`);
    return decision;
  }
  if (!decision.policyVersion || !decision.decisionId || !decision.inputHash || !decision.safeInputSummary) {
    fail(`${name} should include policy proof fields`);
    return decision;
  }
  ok(name);
  return decision;
}

function assertFrozenRules(name: string, rules: ReadonlyArray<Readonly<OgenPolicyRule>>): void {
  if (!Object.isFrozen(rules)) {
    fail(`${name} array should be frozen`);
    return;
  }

  const arrayFields: ReadonlyArray<keyof OgenPolicyRule["match"]> = [
    "connectorIds",
    "resourceSystems",
    "skillIds",
    "executionTypes",
    "riskLevels",
    "sensitivities",
    "requiredRolesAny",
    "requiredRolesAll",
    "environments",
    "routeStatuses"
  ];

  for (const rule of rules) {
    if (!Object.isFrozen(rule)) {
      fail(`${name} rule ${rule.id} should be frozen`);
      return;
    }
    if (!Object.isFrozen(rule.match)) {
      fail(`${name} rule ${rule.id} match should be frozen`);
      return;
    }
    for (const field of arrayFields) {
      const values = rule.match[field];
      if (values && !Object.isFrozen(values)) {
        fail(`${name} rule ${rule.id} match.${field} should be frozen`);
        return;
      }
    }
  }
  ok(`${name} are deeply frozen`);
}

const policyTypes = read("services/orchestrator-api/src/policy/ogenPolicyTypes.ts");
const policyEngine = read("services/orchestrator-api/src/policy/ogenPolicyEngine.ts");
const connectorPolicy = read("services/orchestrator-api/src/policy/connectorPolicy.ts");
const backend = read("services/orchestrator-api/src/index.ts");
const executionGateStack = read("services/orchestrator-api/src/executionGateStack.ts");
const auditEvents = read("services/orchestrator-api/src/audit/auditEvents.ts");
const shared = read("packages/shared/src/index.ts");
const packageJson = read("package.json");
const platformDocs = read("docs/v2-platform-foundation.md");
const productIdentityDocs = read("docs/ogen-product-identity.md");

requireIncludes(policyTypes, "export type OgenPolicyInput", "Ogen policy types exist");
requireIncludes(policyTypes, "export type OgenPolicyMatchedRuleSummary", "Ogen policy matched rule summary exists");
requireIncludes(policyTypes, 'source: "guardrail" | "tenant" | "default";', "matched rule summary source includes default");
requireIncludes(policyTypes, "export type OgenPolicyDecision", "Ogen policy decision type exists");
requireIncludes(policyEngine, "export function evaluateOgenPolicy", "Ogen policy engine exists");
requireIncludes(policyEngine, "function ruleSummary", "policy engine builds matched rule summaries");
requireIncludes(policyEngine, "function reasonFromMatchedRules", "policy engine builds explainable reasons");
requireIncludes(policyEngine, "export const defaultDenyRule", "policy engine has canonical default deny fallback");
requireIncludes(policyEngine, "primaryRule?: OgenPolicyRule", "buildDecision supports explicit primary rule override");
requireIncludes(policyEngine, "primaryRuleSource?: MatchedRuleSource", "buildDecision supports explicit primary rule source override");
requireIncludes(policyEngine, "function deepFreeze", "policy engine has deep freeze helper");
requireIncludes(policyEngine, "function freezeRules", "policy engine has immutable rule helper");
requireIncludes(policyEngine, "mandatoryOgenPolicyGuardrailsDefinition", "policy engine keeps raw guardrail definitions local");
requireIncludes(policyEngine, "defaultTenantOgenPolicyRulesDefinition", "policy engine keeps raw tenant rule definitions local");
requireIncludes(policyEngine, "export const reservedOgenPolicyRuleIds", "policy engine exports reserved rule IDs");
requireIncludes(policyEngine, "reservedOgenPolicyRuleIdSet", "policy engine has reserved rule ID set");
requireIncludes(policyEngine, "defaultDenyRule.id", "reserved rule IDs include default deny");
requireIncludes(policyEngine, "mandatoryOgenPolicyGuardrails", "Ogen policy engine defines mandatory guardrails");
requireIncludes(policyEngine, "defaultTenantOgenPolicyRules", "Ogen policy engine defines tenant rules");
requireIncludes(policyEngine, "defaultOgenPolicyRules", "Ogen policy engine defines default rules");

for (const id of [
  "block-unapproved-route",
  "block-metadata-only-runtime",
  "block-unsafe-interpretation-risk",
  "block-missing-action-risk-metadata",
  "approval-required-for-write-or-sensitive"
]) {
  requireGuardrail(id);
  requireRule(id);
  requireReservedRule(id);
  requireIncludes(policyEngine, id, "Ogen policy engine source includes default rule");
}
requireGuardrail("block-low-confidence-interpretation");
requireReservedRule("block-low-confidence-interpretation");
for (const id of [
  "allow-readonly-approved-runtime",
  "default-deny"
]) {
  requireTenantRule(id);
  requireRule(id);
  requireIncludes(policyEngine, id, "Ogen policy engine source includes default rule");
}
requireReservedRule("default-deny");
if (!Object.isFrozen(reservedOgenPolicyRuleIds)) {
  fail("reserved Ogen policy rule ID list should be frozen");
} else {
  ok("reserved Ogen policy rule ID list is frozen");
}

assertFrozenRules("mandatory Ogen policy guardrails", mandatoryOgenPolicyGuardrails);
assertFrozenRules("default tenant Ogen policy rules", defaultTenantOgenPolicyRules);
assertFrozenRules("default Ogen policy rules", defaultOgenPolicyRules);

const firstMandatoryGuardrail = mandatoryOgenPolicyGuardrails[0];
if (!firstMandatoryGuardrail) {
  fail("mandatory Ogen policy guardrails should have a first rule for immutability verification");
} else {
  const originalEnabled = firstMandatoryGuardrail.enabled;
  try {
    (firstMandatoryGuardrail as OgenPolicyRule).enabled = !originalEnabled;
  } catch {}
  if (firstMandatoryGuardrail.enabled !== originalEnabled) {
    fail("mandatory Ogen guardrail enabled flag should not be mutable");
  } else {
    ok("mandatory Ogen guardrail enabled flag is immutable");
  }

  const routeStatuses = firstMandatoryGuardrail.match.routeStatuses;
  if (routeStatuses) {
    const originalLength = routeStatuses.length;
    try {
      (routeStatuses as string[]).push("unsafe");
    } catch {}
    if (routeStatuses.length !== originalLength) {
      fail("mandatory Ogen guardrail routeStatuses should not be mutable");
    } else {
      ok("mandatory Ogen guardrail nested match arrays are immutable");
    }
  }
}

requireIncludes(policyEngine, "const enabledGuardrails = [...mandatoryOgenPolicyGuardrails]", "policy engine always evaluates mandatory guardrails");
requireIncludes(policyEngine, "const tenantRules = rules.filter", "policy engine separates custom tenant rules from guardrails");
requireIncludes(policyEngine, "!reservedOgenPolicyRuleIdSet.has(rule.id)", "policy engine filters tenant rules by reserved IDs");
requireIncludes(policyEngine, "primaryRule: defaultDenyRule", "default-deny path uses canonical Ogen rule");
requireNotIncludes(policyEngine, 'tenantRules.find((rule) => rule.id === "default-deny")', "default-deny proof does not use tenant-provided rule");
requireNotIncludes(policyEngine, 'enabledTenantRules.find((rule) => rule.id === "default-deny")', "default-deny path does not search tenant rules");
requireIncludes(policyEngine, "guardrailBlocks.length > 0", "mandatory guardrail blocks are returned before tenant rules");
requireIncludes(policyEngine, "guardrailApprovalRules.length > 0 || tenantApprovalRules.length > 0", "mandatory approval guardrails override tenant allow");

for (const phrase of [
  "policyVersion",
  "decisionId",
  "primaryRuleId",
  "primaryRuleSource",
  "matchedRuleIds",
  "matchedGuardrailRuleIds",
  "matchedTenantRuleIds",
  "matchedRuleSummaries",
  "inputHash",
  "deniedByDefault",
  "safeInputSummary"
]) {
  requireIncludes(policyTypes, phrase, "policy decision includes proof field");
  requireIncludes(shared, phrase, "shared response type includes policy proof field");
}
requireIncludes(shared, 'source: "guardrail" | "tenant" | "default";', "shared matched rule summary source includes default");

requireIncludes(connectorPolicy, "evaluateOgenPolicy(policyInput)", "connectorPolicy wraps Ogen policy engine");
requireIncludes(connectorPolicy, "primaryRuleId: decision.primaryRuleId", "connectorPolicy returns primary rule id");
requireIncludes(connectorPolicy, "primaryRuleSource: decision.primaryRuleSource", "connectorPolicy returns primary rule source");
requireIncludes(connectorPolicy, "matchedRuleSummaries: decision.matchedRuleSummaries", "connectorPolicy returns matched rule summaries");
requireIncludes(connectorPolicy, "OGEN_POLICY_VERSION", "connectorPolicy uses versioned policy");
requireIncludes(connectorPolicy, 'runtimeMode: input.runtimeMode ?? "not_available"', "connectorPolicy defaults missing runtime mode to not available");
requireNotIncludes(connectorPolicy, '? "external_runtime_available" : "not_available"', "connectorPolicy does not infer runtime availability from approved route");
requireIncludes(backend, "policyProof", "runtime evidence includes policy proof fields");
requireIncludes(executionGateStack, "policyDecisionId", "execution gate evidence includes policy decision id");
requireIncludes(executionGateStack, "policyPrimaryRuleId", "execution gate evidence includes primary rule id");
requireIncludes(executionGateStack, "policyPrimaryRuleSource", "execution gate evidence includes primary rule source");
requireIncludes(executionGateStack, "policyMatchedRuleSummaries", "execution gate evidence includes matched rule summaries");
requireIncludes(executionGateStack, "policyInputHash", "execution gate evidence includes policy input hash");
requireIncludes(executionGateStack, "policyMatchedGuardrailRuleIds", "execution gate evidence includes guardrail rule ids");
requireIncludes(executionGateStack, "policyMatchedTenantRuleIds", "execution gate evidence includes tenant rule ids");
requireIncludes(auditEvents, 'POLICY_DECISION_EVALUATED: "policy.decision.evaluated"', "policy decision audit event exists");
requireIncludes(backend, "appendConnectorPolicyDecisionAuditEvent", "backend appends policy decision audit proof");
requireIncludes(backend, "matchedGuardrailRuleIds: connectorPolicy.matchedGuardrailRuleIds", "audit/runtime proof includes guardrail rule ids");
requireIncludes(backend, "matchedTenantRuleIds: connectorPolicy.matchedTenantRuleIds", "audit/runtime proof includes tenant rule ids");
requireIncludes(backend, "primaryRuleId: connectorPolicy.primaryRuleId", "audit/runtime proof includes primary rule id");
requireIncludes(backend, "primaryRuleSource: connectorPolicy.primaryRuleSource", "audit/runtime proof includes primary rule source");
requireIncludes(backend, "matchedRuleSummaries: connectorPolicy.matchedRuleSummaries", "audit/runtime proof includes matched rule summaries");

for (const marker of [
  "access" + "_token",
  "refresh" + "_token",
  "authorization" + "_code",
  "client" + "_secret",
  "private" + "_key",
  "client" + "_assertion",
  "rawPrompt",
  "rawToken",
  "Authorization"
]) {
  requireNotIncludes(`${policyTypes}\n${policyEngine}\n${connectorPolicy}`, marker, "policy boundary source");
}
requireNotIncludes(policyEngine, 'input.action.executionType === undefined', "allow logic does not treat missing execution type as safe");
requireNotIncludes(policyEngine, 'input.action.riskLevel === undefined', "allow logic does not treat missing risk level as safe");

const approvedReadonlyDecision = assertEffect("approved read-only external runtime is allowed", baseInput(), "allow");
if (
  !approvedReadonlyDecision?.matchedTenantRuleIds.includes("allow-readonly-approved-runtime") ||
  approvedReadonlyDecision.matchedGuardrailRuleIds.length !== 0 ||
  approvedReadonlyDecision.primaryRuleId !== "allow-readonly-approved-runtime" ||
  approvedReadonlyDecision.primaryRuleSource !== "tenant" ||
  !approvedReadonlyDecision.reason.includes("Tenant policy allowed the request") ||
  !approvedReadonlyDecision.matchedRuleSummaries.some((rule) => rule.id === "allow-readonly-approved-runtime" && rule.source === "tenant")
) {
  fail("approved read-only decision should be explainably allowed by tenant rule after guardrails pass");
} else {
  ok("approved read-only decision separates tenant allow from guardrails");
}
assertEffect("approved inspection read-only medium external runtime is allowed", baseInput({
  action: {
    executionType: "inspection_read_only",
    riskLevel: "medium"
  }
}), "allow");
assertEffect("unapproved route is blocked", baseInput({
  connectorRoute: {
    status: "connector_skill_blocked"
  }
}), "block");
const missingRuntimeModePolicy = evaluateConnectorPolicy({
  connectorRouteStatus: "connector_skill_approved",
  riskLevel: "low",
  executionType: "diagnostic_read_only",
  requiresApproval: false,
  sensitivity: "standard"
});
if (missingRuntimeModePolicy.effect !== "block") {
  fail(`missing runtimeMode should block in compatibility wrapper, got ${missingRuntimeModePolicy.effect}`);
} else {
  ok("missing runtimeMode blocks in compatibility wrapper");
}
assertEffect("metadata-only runtime is blocked", baseInput({
  connectorRoute: {
    runtimeMode: "metadata_only"
  }
}), "block");
assertEffect("missing executionType blocks", baseInput({
  action: {
    executionType: undefined
  }
}), "block");
assertEffect("missing riskLevel blocks", baseInput({
  action: {
    riskLevel: undefined
  }
}), "block");
assertEffect("write action needs approval", baseInput({
  action: {
    executionType: "write_action"
  }
}), "needs_approval");
assertEffect("high-risk action needs approval", baseInput({
  action: {
    riskLevel: "high"
  }
}), "needs_approval");
assertEffect("sensitive action needs approval", baseInput({
  action: {
    sensitivity: "sensitive"
  }
}), "needs_approval");

const tenantAllowEverythingRule: OgenPolicyRule = {
  id: "tenant-allow-everything",
  name: "Tenant allow everything",
  description: "Test tenant rule that attempts to allow unsafe execution.",
  effect: "allow",
  priority: 1,
  enabled: true,
  match: {}
};
const customTenantAllowed = assertEffect("custom tenant allow rule works for valid read-only runtime", baseInput(), "allow", [tenantAllowEverythingRule]);
if (!customTenantAllowed?.matchedTenantRuleIds.includes("tenant-allow-everything")) {
  fail("custom tenant allow decision should record non-reserved tenant allow rule id");
}
const bypassMetadataOnly = assertEffect("tenant allow cannot bypass metadata-only guardrail", baseInput({
  connectorRoute: {
    runtimeMode: "metadata_only"
  }
}), "block", [tenantAllowEverythingRule]);
if (!bypassMetadataOnly?.matchedGuardrailRuleIds.includes("block-metadata-only-runtime")) {
  fail("metadata-only bypass attempt should be blocked by mandatory guardrail");
}
if (
  bypassMetadataOnly?.primaryRuleId !== "block-metadata-only-runtime" ||
  bypassMetadataOnly.primaryRuleSource !== "guardrail" ||
  !bypassMetadataOnly.reason.includes("Ogen guardrail blocked the request") ||
  !bypassMetadataOnly.matchedRuleSummaries.some((rule) => rule.id === "block-metadata-only-runtime" && rule.source === "guardrail")
) {
  fail("metadata-only guardrail decision should include explainable guardrail proof");
}
const bypassMissingRuntime = assertEffect("tenant allow cannot bypass missing runtimeMode guardrail", baseInput({
  connectorRoute: {
    runtimeMode: undefined
  }
}), "block", [tenantAllowEverythingRule]);
if (!bypassMissingRuntime?.matchedGuardrailRuleIds.includes("block-metadata-only-runtime")) {
  fail("missing runtimeMode bypass attempt should be blocked by mandatory guardrail");
}
const bypassMissingExecutionType = assertEffect("tenant allow cannot bypass missing executionType guardrail", baseInput({
  action: {
    executionType: undefined
  }
}), "block", [tenantAllowEverythingRule]);
if (!bypassMissingExecutionType?.matchedGuardrailRuleIds.includes("block-missing-action-risk-metadata")) {
  fail("missing executionType bypass attempt should be blocked by mandatory guardrail");
}
const bypassMissingRisk = assertEffect("tenant allow cannot bypass missing riskLevel guardrail", baseInput({
  action: {
    riskLevel: undefined
  }
}), "block", [tenantAllowEverythingRule]);
if (!bypassMissingRisk?.matchedGuardrailRuleIds.includes("block-missing-action-risk-metadata")) {
  fail("missing riskLevel bypass attempt should be blocked by mandatory guardrail");
}
const bypassWrite = assertEffect("tenant allow cannot bypass write approval guardrail", baseInput({
  action: {
    executionType: "write_action"
  }
}), "needs_approval", [tenantAllowEverythingRule]);
if (!bypassWrite?.matchedGuardrailRuleIds.includes("approval-required-for-write-or-sensitive")) {
  fail("write bypass attempt should require approval by mandatory guardrail");
}
if (
  bypassWrite?.primaryRuleId !== "approval-required-for-write-or-sensitive" ||
  bypassWrite.primaryRuleSource !== "guardrail" ||
  !bypassWrite.reason.includes("Ogen guardrail requires approval")
) {
  fail("write approval decision should include explainable guardrail approval proof");
}
const bypassHighRisk = assertEffect("tenant allow cannot bypass high-risk approval guardrail", baseInput({
  action: {
    riskLevel: "high"
  }
}), "needs_approval", [tenantAllowEverythingRule]);
if (!bypassHighRisk?.matchedGuardrailRuleIds.includes("approval-required-for-write-or-sensitive")) {
  fail("high-risk bypass attempt should require approval by mandatory guardrail");
}
const bypassUnsafeInterpretationRisk = assertEffect("tenant allow cannot bypass unsafe interpretation risk guardrail", baseInput({
  interpretation: {
    risks: ["policy_bypass_attempt"],
    advisoryOnly: true
  }
}), "block", [tenantAllowEverythingRule]);
if (!bypassUnsafeInterpretationRisk?.matchedGuardrailRuleIds.includes("block-unsafe-interpretation-risk")) {
  fail("unsafe interpretation risk bypass attempt should be blocked by mandatory guardrail");
}

const tenantBlockRule: OgenPolicyRule = {
  id: "tenant-block-jira",
  name: "Tenant block Jira",
  description: "Test tenant block rule.",
  effect: "block",
  priority: 1,
  enabled: true,
  match: {
    connectorIds: ["jira-reference"]
  }
};
const tenantBlocked = assertEffect("tenant block rule blocks otherwise valid read-only request", baseInput(), "block", [tenantBlockRule, tenantAllowEverythingRule]);
if (!tenantBlocked?.matchedTenantRuleIds.includes("tenant-block-jira")) {
  fail("tenant block decision should record matched tenant rule id");
}
if (
  tenantBlocked?.primaryRuleId !== "tenant-block-jira" ||
  tenantBlocked.primaryRuleSource !== "tenant" ||
  !tenantBlocked.reason.includes("Tenant policy blocked the request: Tenant block Jira.") ||
  !tenantBlocked.matchedRuleSummaries.some((rule) => rule.id === "tenant-block-jira" && rule.name === "Tenant block Jira" && rule.effect === "block" && rule.source === "tenant")
) {
  fail("tenant block decision should include explainable tenant rule proof");
}

const adminRoleRule: OgenPolicyRule = {
  id: "allow-admin-readonly-runtime",
  name: "Allow admin read-only runtime",
  description: "Test rule requiring an admin role.",
  effect: "allow",
  priority: 10,
  enabled: true,
  match: {
    routeStatuses: ["connector_skill_approved"],
    requiredRolesAny: ["admin"]
  }
};
const defaultDenyRule: OgenPolicyRule = {
  id: "default-deny",
  name: "Default deny",
  description: "Test default deny rule.",
  effect: "block",
  priority: 1000,
  enabled: true,
  match: {}
};
const tenantRoleDenied = assertEffect("missing required role blocks role-required action", baseInput({ subject: { roles: ["it-support"] } }), "block", [adminRoleRule, defaultDenyRule]);
if (
  tenantRoleDenied?.primaryRuleId !== "allow-admin-readonly-runtime" ||
  tenantRoleDenied.primaryRuleSource !== "tenant" ||
  !tenantRoleDenied.matchedTenantRuleIds.includes("allow-admin-readonly-runtime") ||
  !tenantRoleDenied.matchedRuleSummaries.some((rule) => rule.id === "allow-admin-readonly-runtime" && rule.source === "tenant") ||
  !tenantRoleDenied.reason.includes("Required policy role is missing")
) {
  fail("missing tenant role decision should identify the exact tenant rule requiring the role");
} else {
  ok("missing tenant role decision includes complete tenant rule proof");
}

const lowConfidenceDecision = evaluateOgenPolicy(baseInput({
  interpretation: {
    confidence: "low"
  }
}));
if (lowConfidenceDecision.effect === "allow") {
  fail("low confidence AI interpretation must not allow runtime execution");
} else {
  ok("low confidence AI interpretation does not allow runtime execution");
}

const defaultDenied = evaluateOgenPolicy(baseInput({
  action: {
    executionType: "unsupported",
    riskLevel: "low",
    sensitivity: "standard"
  }
}));
if (defaultDenied.effect !== "block" || defaultDenied.deniedByDefault !== true || !defaultDenied.matchedRuleIds.includes("default-deny")) {
  fail("default unmatched policy input should be denied by default");
} else if (
  defaultDenied.primaryRuleSource !== "default" ||
  defaultDenied.primaryRuleId !== "default-deny" ||
  !defaultDenied.reason.includes("denied the request by default") ||
  !defaultDenied.matchedRuleSummaries.some((rule) => rule.id === "default-deny" && rule.source === "default")
) {
  fail("default deny decision should include default primary source and explainable reason");
} else {
  ok("default unmatched policy input is blocked");
}

const customRulesWithoutDefaultDeny = evaluateOgenPolicy(baseInput({
  connectorRoute: {
    connectorId: "github-reference",
    resourceSystem: "github"
  }
}), [tenantBlockRule]);
if (
  customRulesWithoutDefaultDeny.effect !== "block" ||
  customRulesWithoutDefaultDeny.deniedByDefault !== true ||
  customRulesWithoutDefaultDeny.primaryRuleId !== "default-deny" ||
  customRulesWithoutDefaultDeny.primaryRuleSource !== "default" ||
  !customRulesWithoutDefaultDeny.matchedRuleIds.includes("default-deny") ||
  !customRulesWithoutDefaultDeny.matchedRuleSummaries.some((rule) => rule.id === "default-deny" && rule.source === "default")
) {
  fail("custom tenant rules without default-deny should still produce complete default-deny proof");
} else {
  ok("custom tenant rules without default-deny still include complete default-deny proof");
}

const fakeDefaultAllowRule: OgenPolicyRule = {
  id: "default-deny",
  name: "Fake default allow",
  description: "Tenant rule attempting to redefine Ogen default deny.",
  effect: "allow",
  priority: 1,
  enabled: true,
  match: {}
};
const fakeDefaultDecision = evaluateOgenPolicy(baseInput(), [fakeDefaultAllowRule]);
if (
  fakeDefaultDecision.effect !== "block" ||
  fakeDefaultDecision.deniedByDefault !== true ||
  fakeDefaultDecision.primaryRuleId !== "default-deny" ||
  fakeDefaultDecision.primaryRuleSource !== "default" ||
  fakeDefaultDecision.matchedTenantRuleIds.includes("default-deny") ||
  !fakeDefaultDecision.matchedRuleSummaries.some((rule) => rule.id === "default-deny" && rule.name === "Default deny" && rule.source === "default") ||
  fakeDefaultDecision.matchedRuleSummaries.some((rule) => rule.id === "default-deny" && rule.name === "Fake default allow")
) {
  fail("tenant rule cannot redefine default-deny or change canonical default-deny proof");
} else {
  ok("tenant rule cannot redefine default-deny");
}

const fakeMetadataGuardrailAllowRule: OgenPolicyRule = {
  id: "block-metadata-only-runtime",
  name: "Fake metadata-only allow",
  description: "Tenant rule attempting to redefine a mandatory guardrail.",
  effect: "allow",
  priority: 1,
  enabled: true,
  match: {}
};
const fakeGuardrailDecision = evaluateOgenPolicy(baseInput({
  connectorRoute: {
    runtimeMode: "metadata_only"
  }
}), [fakeMetadataGuardrailAllowRule]);
if (
  fakeGuardrailDecision.effect !== "block" ||
  fakeGuardrailDecision.primaryRuleId !== "block-metadata-only-runtime" ||
  fakeGuardrailDecision.primaryRuleSource !== "guardrail" ||
  !fakeGuardrailDecision.matchedGuardrailRuleIds.includes("block-metadata-only-runtime") ||
  fakeGuardrailDecision.matchedTenantRuleIds.includes("block-metadata-only-runtime")
) {
  fail("tenant rule cannot redefine mandatory guardrail IDs");
} else {
  ok("tenant rule cannot redefine mandatory guardrail IDs");
}

const mutationProbeRules: OgenPolicyRule[] = [
  {
    id: "tenant-default-deny-probe",
    name: "Tenant default deny probe",
    description: "Default deny probe for mutation verification.",
    effect: "block",
    priority: 1000,
    enabled: true,
    match: {}
  },
  {
    id: "tenant-allow-mutation-probe",
    name: "Tenant allow mutation probe",
    description: "Allow rule probe for mutation verification.",
    effect: "allow",
    priority: 20,
    enabled: true,
    match: {
      routeStatuses: ["connector_skill_approved"],
      connectorIds: ["jira-reference"]
    }
  }
];
const mutationProbeBefore = JSON.parse(JSON.stringify(mutationProbeRules)) as OgenPolicyRule[];
evaluateOgenPolicy(baseInput(), mutationProbeRules);
if (JSON.stringify(mutationProbeRules) !== JSON.stringify(mutationProbeBefore)) {
  fail("evaluateOgenPolicy should not mutate caller-provided tenant rules");
} else {
  ok("evaluateOgenPolicy leaves caller-provided tenant rules unchanged");
}

const allowRule: OgenPolicyRule = {
  id: "allow-test",
  name: "Allow test",
  description: "Allow test route.",
  effect: "allow",
  priority: 20,
  enabled: true,
  match: {
    routeStatuses: ["connector_skill_approved"]
  }
};
const blockRule: OgenPolicyRule = {
  id: "block-test",
  name: "Block test",
  description: "Block test route.",
  effect: "block",
  priority: 30,
  enabled: true,
  match: {
    routeStatuses: ["connector_skill_approved"]
  }
};
assertEffect("block rule overrides allow rule", baseInput(), "block", [allowRule, blockRule, defaultDenyRule]);

const parsedPackageJson = JSON.parse(packageJson) as { scripts?: Record<string, string> };
if (parsedPackageJson.scripts?.["verify:ogen-policy-engine"] !== "tsx scripts/verify-ogen-policy-engine.ts") {
  fail("package.json should include verify:ogen-policy-engine");
} else {
  ok("package.json includes verify:ogen-policy-engine");
}
if (!parsedPackageJson.scripts?.["verify:v2-plan"]?.includes("verify:ogen-policy-engine")) {
  fail("verify:v2-plan should include verify:ogen-policy-engine");
} else {
  ok("verify:v2-plan includes verify:ogen-policy-engine");
}

for (const phrase of [
  "Phase 2.11  Ogen Policy Engine Boundary",
  "AI interpretation is advisory",
  "deny-by-default",
  "policy decisions are audit proof",
  "metadata-only connector trust cannot execute runtime",
  "Runtime execution requires explicit runtime availability.",
  "Runtime execution requires explicit action execution type.",
  "Runtime execution requires explicit risk classification.",
  "Missing action/risk metadata fails closed.",
  "Approved connector route alone is not enough to allow runtime execution.",
  "Ogen separates mandatory platform guardrails from tenant/configurable policy rules.",
  "Tenant policies can restrict further but cannot override core Ogen safety guardrails.",
  "Decision proof records matched guardrail rules and matched tenant rules separately.",
  "Policy decisions include explainable matched rule summaries.",
  "Ogen reports whether a decision came from a mandatory guardrail, tenant rule, or default deny.",
  "Policy reasons are human-readable and audit-safe.",
  "Rule summaries never include raw prompt or token material.",
  "Mandatory Ogen guardrails are immutable runtime definitions.",
  "Tenant policies can be dynamic, but platform safety guardrails are frozen and cannot be mutated by policy loading.",
  "Policy evaluation does not mutate tenant rule inputs.",
  "Ogen rule IDs for mandatory guardrails and default-deny are reserved.",
  "Tenant policies cannot redefine reserved Ogen rule IDs.",
  "Default-deny proof always uses the canonical Ogen default deny rule.",
  "tenant-scoped policy storage"
]) {
  requireIncludes(platformDocs, phrase, "platform docs cover Ogen policy engine boundary");
}

requireIncludes(productIdentityDocs, "AI can interpret. Ogen decides. Runtime executes only approved actions. Audit proves what happened.", "product identity docs include Ogen policy principle");
requireIncludes(productIdentityDocs, "Tenant policy can restrict. Ogen guardrails cannot be bypassed.", "product identity docs include non-overridable guardrail principle");
requireIncludes(productIdentityDocs, "Ogen does not just block. It explains which guardrail or tenant policy made the decision.", "product identity docs include explainability principle");
requireIncludes(productIdentityDocs, "Ogen guardrails are immutable platform safety rules.", "product identity docs include immutable guardrail principle");
requireIncludes(productIdentityDocs, "Ogen reserved rule identities cannot be redefined by tenant policy.", "product identity docs include reserved rule identity principle");

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Ogen policy engine verification passed.");
}
