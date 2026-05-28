import { existsSync, readFileSync } from "node:fs";

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

function objectBlockContaining(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) {
    fail(`source should include marker ${marker}`);
    return "";
  }

  const start = source.lastIndexOf("{", markerIndex);
  if (start < 0) {
    fail(`source should include object start for ${marker}`);
    return "";
  }

  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  fail(`source should include object end for ${marker}`);
  return "";
}

const taxonomy = read("packages/shared/src/ogenActionTaxonomy.ts");
const sharedIndex = read("packages/shared/src/index.ts");
const connectorTypes = read("services/orchestrator-api/src/connectors/types.ts");
const profileValidation = read("services/orchestrator-api/src/connectors/profileValidation.ts");
const connectorActionPlanner = read("services/orchestrator-api/src/connectorActionPlanner.ts");
const referenceCatalog = read("services/orchestrator-api/src/connectors/localReferenceConnectorIntentCatalog.ts");
const connectorRouting = read("services/orchestrator-api/src/connectorRouting.ts");
const policyTypes = read("services/orchestrator-api/src/policy/ogenPolicyTypes.ts");
const policyEngine = read("services/orchestrator-api/src/policy/ogenPolicyEngine.ts");
const connectorPolicy = read("services/orchestrator-api/src/policy/connectorPolicy.ts");
const runtimeAuthorization = read("services/orchestrator-api/src/runtimeAuthorization/runtimeAuthorizationEvaluator.ts");
const backend = read("services/orchestrator-api/src/index.ts");
const sdkContracts = read("services/orchestrator-api/src/sdkReadiness/sdkContracts.ts");
const sdkDocs = read("docs/sdk-readiness-contracts.md");
const platformDocs = read("docs/v2-platform-foundation.md");
const roadmap = read("docs/orchestrator-agnostic-roadmap.md");
const packageJsonText = read("package.json");
const v2PlanVerifier = read("scripts/verify-v2-plan.ts");

for (const phrase of [
  "export const OGEN_ACTION_CATEGORIES",
  "export type OgenActionCategory",
  "export const OGEN_APPROVAL_MODES",
  "export type OgenApprovalMode",
  "export const OGEN_RESOURCE_SENSITIVITIES",
  "export type OgenResourceSensitivity",
  "export const OGEN_FIELD_CLASSES",
  "export type OgenFieldClass",
  "export type OgenActionConstraints",
  "export type OgenPolicyConditionModel"
]) {
  requireIncludes(taxonomy, phrase, "shared generic action taxonomy source");
}

for (const value of [
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
  "external_message.send",
  "never",
  "policy",
  "always",
  "blocked",
  "regulated",
  "security_critical",
  "admin_controlled",
  "customer_pii",
  "employee_pii",
  "external_message"
]) {
  requireIncludes(taxonomy, `"${value}"`, "shared taxonomy includes expected value");
}

for (const phrase of [
  "bulkAllowed?: boolean",
  "maxRecordsPerRequest?: number",
  "maxActionsPerHour?: number",
  "requiresConnectedAccount?: boolean",
  "auditRequired?: boolean"
]) {
  requireIncludes(taxonomy, phrase, "action constraints include required field");
}

requireIncludes(sharedIndex, 'export * from "./ogenActionTaxonomy.js"', "shared index exports generic action taxonomy");
for (const phrase of [
  "actionCategory?: OgenActionCategory",
  "approvalMode?: OgenApprovalMode",
  "resourceSensitivity?: OgenResourceSensitivity",
  "fieldClasses?: OgenFieldClass[]",
  "actionConstraints?: OgenActionConstraints",
  "provider?: string",
  "resourceSystem?: string"
]) {
  requireIncludes(sharedIndex, phrase, "shared runtime/action contracts carry normalized action metadata");
  requireIncludes(connectorTypes, phrase, "connector action contracts carry normalized action metadata");
}
for (const phrase of ["requiredApplicationGrants?: string[]", "requiredEffectivePermissions?: string[]"]) {
  requireIncludes(sharedIndex, phrase, "shared runtime/action contracts carry normalized action metadata");
}
for (const phrase of ["requiredApplicationGrants: string[]", "requiredEffectivePermissions: string[]"]) {
  requireIncludes(connectorTypes, phrase, "connector action contracts carry grant/permission metadata");
}

for (const phrase of [
  "actionCategory: optionalValue(input.actionCategory, actionCategories)",
  "approvalMode: optionalValue(input.approvalMode, approvalModes)",
  "resourceSensitivity: optionalValue(input.resourceSensitivity, resourceSensitivities)",
  "function fieldClassArray",
  "if (value.length === 0)",
  "return [];",
  "fieldClasses: fieldClassArray(input.fieldClasses)",
  "Object.keys(input).length === 0",
  "const actionConstraintKeys = new Set",
  "const hasUnknownConstraintField = Object.keys(input).some((key) => !actionConstraintKeys.has(key));",
  "if (hasUnknownConstraintField || hasInvalidKnownField)",
  "actionConstraints: actionConstraints(input.actionConstraints)"
]) {
  requireIncludes(profileValidation, phrase, "connector profile validation preserves normalized metadata");
}

for (const phrase of [
  "function fieldClasses(value: unknown): ConnectorActionPlanOption[\"fieldClasses\"]",
  "if (!Array.isArray(value))",
  "return fields;",
  "fieldClasses: fieldClasses(item.fieldClasses)",
  "function actionConstraints(value: unknown): ConnectorActionPlanOption[\"actionConstraints\"]",
  "if (typeof value !== \"object\" || value === null || Array.isArray(value))",
  "return constraints;",
  "actionConstraints: actionConstraints(item.actionConstraints)"
]) {
  requireIncludes(connectorActionPlanner, phrase, "connector action planner preserves explicit empty taxonomy metadata");
}
for (const forbidden of [
  "fields.length ? fields : undefined",
  "Object.values(constraints).some((entry) => entry !== undefined) ? constraints : undefined",
  "typeof value === \"object\" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}"
]) {
  requireNotIncludes(connectorActionPlanner, forbidden, "connector action planner does not treat empty taxonomy metadata as missing");
}

for (const phrase of [
  "function hasCompleteNormalizedActionMetadata",
  "metadata.fieldClasses !== undefined",
  "metadata.actionConstraints !== undefined",
  "actionCategory = approved.actionCategory ?? referenceSkill?.actionCategory",
  "approvalMode = approved.approvalMode ?? referenceSkill?.approvalMode",
  "resourceSensitivity = approved.resourceSensitivity ?? referenceSkill?.resourceSensitivity",
  "const approvedMetadataComplete = hasCompleteNormalizedActionMetadata(approved)",
  "actionCategory: actionMetadata.actionCategory",
  "approvalMode: actionMetadata.approvalMode",
  "resourceSensitivity: actionMetadata.resourceSensitivity",
  "actionResourceSystem: actionMetadata.resourceSystem"
]) {
  requireIncludes(connectorRouting, phrase, "connector routing propagates normalized action metadata");
}

const referenceSkillIds = [...referenceCatalog.matchAll(/skillId: "([^"]+)"/g)].map((match) => match[1]).filter(Boolean);
if (referenceSkillIds.length === 0) {
  fail("reference catalog should include executable skill IDs");
}
for (const skillId of referenceSkillIds) {
  const block = objectBlockContaining(referenceCatalog, `skillId: "${skillId}"`);
  for (const field of ["actionCategory:", "approvalMode:", "resourceSensitivity:", "fieldClasses:", "actionConstraints:", "provider:", "resourceSystem:"]) {
    if (!block.includes(field)) {
      fail(`reference catalog skill ${skillId} should declare ${field}`);
    } else {
      ok(`reference catalog skill ${skillId} declares ${field}`);
    }
  }
}

for (const expected of [
  ["servicenow.ticket.status.lookup", 'actionCategory: "business_object.read"', 'approvalMode: "never"', 'resourceSensitivity: "standard"'],
  ["jira.issue.create", 'actionCategory: "business_object.create"', 'approvalMode: "policy"', 'resourceSensitivity: "sensitive"'],
  ["jira.project.access.prepare", 'actionCategory: "permission.grant"', 'approvalMode: "always"', 'resourceSensitivity: "security_critical"'],
  ["github.repository.access.prepare", 'actionCategory: "permission.grant"', 'approvalMode: "always"', 'resourceSensitivity: "security_critical"'],
  ["github.repository.rate_limit.diagnose", 'actionCategory: "diagnose"', 'approvalMode: "never"', 'resourceSensitivity: "standard"']
] as const) {
  const [skillId, actionCategory, approvalMode, resourceSensitivity] = expected;
  const block = objectBlockContaining(referenceCatalog, `skillId: "${skillId}"`);
  requireIncludes(block, actionCategory, `${skillId} has expected action category`);
  requireIncludes(block, approvalMode, `${skillId} has expected approval mode`);
  requireIncludes(block, resourceSensitivity, `${skillId} has expected resource sensitivity`);
}

for (const phrase of [
  "export type OgenPolicyConditionModel",
  "actionCategories?: OgenActionCategory[]",
  "approvalModes?: OgenApprovalMode[]",
  "resourceSensitivities?: OgenResourceSensitivity[]",
  "actorRolesAny?: string[]",
  "connectorIds?: string[]",
  "resourceSystems?: string[]",
  "providers?: string[]",
  "fieldClasses?: OgenFieldClass[]",
  "bulk?: boolean",
  "maxRecordsPerRequest?: number",
  "maxActionsPerHour?: number",
  "requiresConnectedAccount?: boolean",
  "auditRequired?: boolean"
]) {
  requireIncludes(policyTypes, phrase, "Ogen policy condition model supports generic condition");
}

for (const phrase of [
  "function trustedPolicyResourceSystem",
  "inList(trustedPolicyResourceSystem(input), rule.match.resourceSystems)",
  "block-resource-system-metadata-mismatch",
  "block-missing-action-taxonomy-metadata",
  "block-blocked-approval-mode",
  "const allowedOgenActionCategories",
  "const allowedOgenApprovalModes",
  "const allowedOgenResourceSensitivities",
  "const allowedOgenFieldClasses",
  "const allowedOgenActionConstraintKeys",
  "function isAllowedActionCategory",
  "function isAllowedApprovalMode",
  "function isAllowedResourceSensitivity",
  "function hasValidFieldClasses",
  "function hasValidActionConstraints",
  "function hasCompleteActionTaxonomyMetadata",
  "isAllowedActionCategory(input.action.actionCategory)",
  "isAllowedApprovalMode(input.action.approvalMode)",
  "isAllowedResourceSensitivity(input.action.resourceSensitivity)",
  "hasValidFieldClasses(input.action.fieldClasses)",
  "hasValidActionConstraints(input.action.actionConstraints)",
  "input.action.approvalMode === \"always\"",
  "input.action.approvalMode === \"blocked\"",
  "trustedResourceSystem",
  "actionResourceSystemMatchesTrusted",
  "inList(input.action.actionCategory, rule.match.actionCategories)",
  "inList(input.action.approvalMode, rule.match.approvalModes)",
  "inList(input.action.resourceSensitivity, rule.match.resourceSensitivities)",
  "inList(input.action.provider, rule.match.providers)",
  "intersects(input.action.fieldClasses, rule.match.fieldClasses)",
  "roleAnySatisfied(roles, rule.match.actorRolesAny)",
  "booleanCondition(constraints?.bulkAllowed, rule.match.bulk)",
  "maxCondition(constraints?.maxRecordsPerRequest, rule.match.maxRecordsPerRequest)",
  "booleanCondition(constraints?.requiresConnectedAccount, rule.match.requiresConnectedAccount)",
  "booleanCondition(constraints?.auditRequired, rule.match.auditRequired)"
]) {
  requireIncludes(policyEngine, phrase, "Ogen policy engine can match generic condition");
}
requireNotIncludes(policyEngine, "input.action.resourceSystem ?? input.connectorRoute.resourceSystem", "Ogen policy engine does not let caller action resource system override trusted route/resource data");
requireNotIncludes(policyEngine, "...(rule.match.actorRolesAny ?? [])", "Ogen policy engine does not treat actorRolesAny as a hard role requirement");

for (const phrase of [
  "actionCategory: input.action?.actionCategory",
  "approvalMode: input.action?.approvalMode",
  "resourceSensitivity: input.action?.resourceSensitivity",
  "actionConstraints: input.action?.actionConstraints",
  "actionCategory: request.action.actionCategory",
  "approvalMode: request.action.approvalMode",
  "resourceSensitivity: request.action.resourceSensitivity"
]) {
  requireIncludes(`${connectorPolicy}\n${runtimeAuthorization}`, phrase, "policy wrappers propagate normalized action metadata");
}
requireIncludes(backend, "resourceSystem: connectorRouting.actionResourceSystem", "resolve path propagates action resource system into policy action metadata");

for (const phrase of [
  '"actionCategory"',
  '"approvalMode"',
  '"resourceSensitivity"',
  '"fieldClasses"',
  '"actionConstraints"',
  '"normalized-action-taxonomy-complete"',
  '"missing-taxonomy-fields-fail-closed"',
  "genericPolicyConditionFields"
]) {
  requireIncludes(sdkContracts, phrase, "SDK readiness contracts include generic taxonomy and certification");
}

for (const forbiddenAuthority of ["signaturePresent", "verificationStatus", "OgenAgentCardProvenance"]) {
  requireNotIncludes(`${policyTypes}\n${policyEngine}\n${connectorPolicy}\n${runtimeAuthorization}`, forbiddenAuthority, "Ogen policy/runtime authorization does not use Agent Card provenance as authority");
}

for (const phrase of [
  "vendor-specific tools normalize to Ogen action categories",
  "OAuth scopes do not equal Ogen action permission",
  "approval is a policy outcome",
  "missing normalized action metadata fails certification",
  "signed Agent Card provenance is advisory only"
]) {
  requireIncludes(`${sdkDocs}\n${platformDocs}\n${roadmap}`, phrase, "docs explain generic taxonomy governance boundaries");
}

const packageJson = JSON.parse(packageJsonText) as { scripts?: Record<string, string> };
if (packageJson.scripts?.["verify:generic-action-taxonomy"] !== "tsx scripts/verify-generic-action-taxonomy.ts") {
  fail("package.json should include verify:generic-action-taxonomy");
} else {
  ok("package.json includes verify:generic-action-taxonomy");
}
if (!packageJson.scripts?.["verify:v2-plan"]?.includes("verify:generic-action-taxonomy")) {
  fail("verify:v2-plan should include verify:generic-action-taxonomy");
} else {
  ok("verify:v2-plan includes verify:generic-action-taxonomy");
}
requireIncludes(v2PlanVerifier, "verify:generic-action-taxonomy", "v2 plan verifier checks generic action taxonomy wiring");

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Generic action taxonomy verification passed.");
}
