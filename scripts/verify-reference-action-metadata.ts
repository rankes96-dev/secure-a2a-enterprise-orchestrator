import { existsSync, readFileSync } from "node:fs";
import type { DerivedCapability, TrustedOnboardedAgent } from "../services/orchestrator-api/src/agentOnboarding.js";
import { decideConnectorRoute, routeConnectorRequest, type ConnectorRoutingIntent } from "../services/orchestrator-api/src/connectorRouting.js";
import { localReferenceConnectorIntentCatalog } from "../services/orchestrator-api/src/connectors/localReferenceConnectorIntentCatalog.js";
import { evaluateConnectorPolicy } from "../services/orchestrator-api/src/policy/connectorPolicy.js";

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

function skillHint(skillId: string) {
  return localReferenceConnectorIntentCatalog.flatMap((connector) => connector.skillHints).find((hint) => hint.skillId === skillId);
}

function requireSkillMetadata(skillId: string, expected: {
  riskLevel: "low" | "medium" | "high" | "sensitive";
  executionType: "diagnostic_read_only" | "inspection_read_only" | "write_action" | "unsupported";
  requiresApproval: boolean;
  sensitivity: "standard" | "sensitive";
}): void {
  const hint = skillHint(skillId);
  if (!hint) {
    fail(`${skillId} should exist in local reference connector intent catalog`);
    return;
  }

  if (
    hint.riskLevel !== expected.riskLevel ||
    hint.executionType !== expected.executionType ||
    hint.requiresApproval !== expected.requiresApproval ||
    hint.sensitivity !== expected.sensitivity
  ) {
    fail(`${skillId} should have explicit deterministic safety metadata`);
    return;
  }

  ok(`${skillId} has explicit deterministic safety metadata`);
}

function fakeTrustedAgent(params: {
  connectorId: string;
  resourceSystem: string;
  approvedCapability: string;
  runtimeEndpoint?: string;
  approvedAction?: Partial<DerivedCapability>;
}): TrustedOnboardedAgent {
  const approvedAction: DerivedCapability = {
    ...params.approvedAction,
    capability: params.approvedAction?.capability ?? params.approvedCapability,
    label: params.approvedAction?.label ?? `Approved ${params.approvedCapability}`,
    reason: params.approvedAction?.reason ?? "Approved for verification without embedded safety metadata."
  };
  const approvedActions = [approvedAction];

  return {
    agentId: `${params.connectorId}-agent`,
    issuer: "https://idp.ogen.dev",
    clientId: `${params.connectorId}-client`,
    audience: params.connectorId,
    runtimeEndpoint: params.runtimeEndpoint ?? "http://localhost:4201/a2a/task",
    connectorId: params.connectorId,
    resourceSystem: params.resourceSystem,
    connectorDisplayName: params.connectorId,
    externalConfigHash: "external-config-hash",
    connectorProfileHash: "connector-profile-hash",
    requestedScopes: [],
    requestedApplicationGrants: [],
    agentDeclaredSkills: [params.approvedCapability],
    agentDeclaredCapabilities: [params.approvedCapability],
    applicationAccessGrants: [],
    grantedScopes: [],
    effectivePermissions: [],
    deniedPermissions: [],
    approvedActions,
    blockedActions: [],
    approvedCapabilities: approvedActions,
    blockedCapabilities: [],
    connectorProfileVerified: true,
    connectorDecisionSource: params.connectorId,
    trustLevel: "trusted_metadata_only",
    executable: false,
    executionState: "metadata_only",
    runtimeTrustSource: "live_onboarding",
    tokenEndpointAuthMethod: "private-key-jwt",
    oauthApplicationBound: true
  };
}

const catalog = read("services/orchestrator-api/src/connectors/localReferenceConnectorIntentCatalog.ts");
const connectorRouting = read("services/orchestrator-api/src/connectorRouting.ts");
const backend = read("services/orchestrator-api/src/index.ts");
const shared = read("packages/shared/src/index.ts");
const packageJson = read("package.json");
const platformDocs = read("docs/v2-platform-foundation.md");
const productIdentityDocs = read("docs/ogen-product-identity.md");

for (const phrase of [
  "riskLevel?: ReferenceConnectorRiskLevel",
  "executionType?: ReferenceConnectorExecutionType",
  "requiresApproval?: boolean",
  "sensitivity?: ReferenceConnectorSensitivity"
]) {
  requireIncludes(catalog, phrase, "reference connector skill hints support safety metadata");
}

const expectedMetadata = {
  "servicenow.ticket.status.lookup": { riskLevel: "low", executionType: "inspection_read_only", requiresApproval: false, sensitivity: "standard" },
  "servicenow.catalog.item.recommend": { riskLevel: "low", executionType: "inspection_read_only", requiresApproval: false, sensitivity: "standard" },
  "servicenow.catalog.request.diagnose": { riskLevel: "low", executionType: "diagnostic_read_only", requiresApproval: false, sensitivity: "standard" },
  "servicenow.user.role.inspect": { riskLevel: "medium", executionType: "inspection_read_only", requiresApproval: false, sensitivity: "standard" },
  "servicenow.incident.assignment.diagnose": { riskLevel: "medium", executionType: "diagnostic_read_only", requiresApproval: false, sensitivity: "standard" },
  "jira.issue.status.lookup": { riskLevel: "low", executionType: "inspection_read_only", requiresApproval: false, sensitivity: "standard" },
  "jira.permission.inspect": { riskLevel: "medium", executionType: "inspection_read_only", requiresApproval: false, sensitivity: "standard" },
  "jira.issue.diagnose_creation_failure": { riskLevel: "medium", executionType: "diagnostic_read_only", requiresApproval: false, sensitivity: "standard" },
  "jira.project.access.prepare": { riskLevel: "sensitive", executionType: "write_action", requiresApproval: true, sensitivity: "sensitive" },
  "jira.issue.create": { riskLevel: "high", executionType: "write_action", requiresApproval: true, sensitivity: "sensitive" },
  "github.pull_request.status.lookup": { riskLevel: "low", executionType: "inspection_read_only", requiresApproval: false, sensitivity: "standard" },
  "github.repository.permission.inspect": { riskLevel: "medium", executionType: "inspection_read_only", requiresApproval: false, sensitivity: "standard" },
  "github.repository.rate_limit.diagnose": { riskLevel: "low", executionType: "diagnostic_read_only", requiresApproval: false, sensitivity: "standard" },
  "github.pull_request.access.diagnose": { riskLevel: "medium", executionType: "diagnostic_read_only", requiresApproval: false, sensitivity: "standard" },
  "github.repository.access.prepare": { riskLevel: "sensitive", executionType: "write_action", requiresApproval: true, sensitivity: "sensitive" }
} as const;

for (const [skillId, expected] of Object.entries(expectedMetadata)) {
  requireSkillMetadata(skillId, expected);
}

requireIncludes(connectorRouting, "function referenceSkillMetadata", "connector routing has explicit reference metadata helper");
requireIncludes(connectorRouting, "supported.skillHints.find((hint) => hint.skillId === skillId)", "reference metadata is selected by exact skill ID");
requireIncludes(connectorRouting, "approved.riskLevel ?? referenceSkill?.riskLevel", "approved risk metadata wins before reference fallback");
requireIncludes(connectorRouting, "approved.executionType ?? referenceSkill?.executionType", "approved execution metadata wins before reference fallback");
requireIncludes(connectorRouting, "actionMetadataSource?: ConnectorActionMetadataSource", "connector routing exposes action metadata source proof");
requireIncludes(connectorRouting, "actionMetadataSource: actionMetadata.source", "connector route decision records action metadata source");
requireIncludes(connectorRouting, "actionResourceSystem?: string", "connector routing carries action-level resource system separately");
requireIncludes(connectorRouting, "actionResourceSystem: actionMetadata.resourceSystem", "connector route decision propagates action-level resource system");
requireIncludes(backend, "actionResourceSystem: connectorRouting.actionResourceSystem", "backend evidence includes action-level resource system");
requireIncludes(backend, "resourceSystem: effectiveConnectorRouting.actionResourceSystem", "backend policy input uses action-level resource system for action metadata");
requireIncludes(shared, "actionResourceSystem?: string", "shared connector routing response exposes action-level resource system");

const metadataHelper = connectorRouting.slice(connectorRouting.indexOf("function referenceSkillMetadata"), connectorRouting.indexOf("function exactConnectorIdMatch"));
for (const forbidden of ["label", "reason", "includeAny", "excludeAny"]) {
  if (metadataHelper.includes(forbidden)) {
    fail(`reference metadata helper should not infer safety from ${forbidden}`);
  } else {
    ok(`reference metadata helper does not infer safety from ${forbidden}`);
  }
}

requireIncludes(shared, 'actionMetadataSource?: "approved_action" | "reference_catalog" | "missing"', "shared connector routing response exposes action metadata source");
requireIncludes(backend, "actionMetadataSource: connectorRouting.actionMetadataSource", "connector evidence/audit includes action metadata source");
requireIncludes(backend, "block-missing-action-risk-metadata", "backend detects missing action risk metadata guardrail");
requireIncludes(backend, "Ogen could not execute this connector action because the connector action metadata is incomplete.", "backend has specific missing action metadata blocked copy");
requireIncludes(backend, "failed closed instead of guessing that it is safe", "backend explains fail-closed metadata behavior");

const parsedPackageJson = JSON.parse(packageJson) as { scripts?: Record<string, string> };
if (parsedPackageJson.scripts?.["verify:reference-action-metadata"] !== "tsx scripts/verify-reference-action-metadata.ts") {
  fail("package.json should include verify:reference-action-metadata");
} else {
  ok("package.json includes verify:reference-action-metadata");
}
if (!parsedPackageJson.scripts?.["verify:v2-plan"]?.includes("verify:ai-routing-trust-boundary && npm run verify:reference-action-metadata")) {
  fail("verify:v2-plan should run reference action metadata verification after AI routing trust boundary");
} else {
  ok("verify:v2-plan includes reference action metadata verification after AI routing trust boundary");
}

const servicenowAgent = fakeTrustedAgent({
  connectorId: "servicenow-reference",
  resourceSystem: "servicenow",
  approvedCapability: "servicenow.ticket.status.lookup"
});
const servicenowDecision = routeConnectorRequest("What is the status of my ticket INC0010245?", [servicenowAgent]);
if (
  servicenowDecision.status !== "connector_skill_approved" ||
  servicenowDecision.connectorId !== "servicenow-reference" ||
  servicenowDecision.skillId !== "servicenow.ticket.status.lookup" ||
  servicenowDecision.riskLevel !== "low" ||
  servicenowDecision.executionType !== "inspection_read_only" ||
  servicenowDecision.requiresApproval !== false ||
  servicenowDecision.sensitivity !== "standard" ||
  servicenowDecision.actionMetadataSource !== "reference_catalog"
) {
  fail("ServiceNow ticket status lookup should use explicit reference metadata when approved action metadata is missing");
} else {
  ok("ServiceNow ticket status lookup uses explicit reference metadata fallback");
}

const servicenowPolicy = evaluateConnectorPolicy({
  connectorRouteStatus: servicenowDecision.status,
  runtimeMode: servicenowDecision.runtimeMode,
  connectorId: servicenowDecision.connectorId,
  resourceSystem: servicenowDecision.resourceSystem,
  skillId: servicenowDecision.skillId,
  skillLabel: servicenowDecision.skillLabel,
  subject: {
    tenantId: "default",
    userId: "verification-user",
    roles: ["employee"]
  },
  riskLevel: servicenowDecision.riskLevel,
  executionType: servicenowDecision.executionType,
  requiresApproval: servicenowDecision.requiresApproval,
  sensitivity: servicenowDecision.sensitivity,
  action: {
    actionCategory: servicenowDecision.actionCategory,
    approvalMode: servicenowDecision.approvalMode,
    resourceSensitivity: servicenowDecision.resourceSensitivity,
    fieldClasses: servicenowDecision.fieldClasses,
    actionConstraints: servicenowDecision.actionConstraints,
    provider: servicenowDecision.provider,
    resourceSystem: servicenowDecision.resourceSystem
  }
});
if (servicenowPolicy.effect !== "allow" || servicenowPolicy.primaryRuleId !== "allow-readonly-approved-runtime") {
  fail("ServiceNow ticket status lookup should be allowed by read-only approved runtime policy");
} else {
  ok("ServiceNow ticket status lookup is allowed by read-only approved runtime policy");
}

const mismatchedActionResourceSystemDecision = routeConnectorRequest("What is the status of my ticket INC0010245?", [
  fakeTrustedAgent({
    connectorId: "servicenow-reference",
    resourceSystem: "servicenow",
    approvedCapability: "servicenow.ticket.status.lookup",
    approvedAction: {
      riskLevel: "low",
      executionType: "inspection_read_only",
      requiresApproval: false,
      sensitivity: "standard",
      actionCategory: "business_object.read",
      approvalMode: "never",
      resourceSensitivity: "standard",
      fieldClasses: ["workflow_state"],
      actionConstraints: {
        bulkAllowed: false,
        maxRecordsPerRequest: 1,
        requiresConnectedAccount: true,
        auditRequired: true
      },
      provider: "servicenow",
      resourceSystem: "jira"
    }
  })
]);
if (
  mismatchedActionResourceSystemDecision.status !== "connector_skill_approved" ||
  mismatchedActionResourceSystemDecision.resourceSystem !== "servicenow" ||
  mismatchedActionResourceSystemDecision.actionResourceSystem !== "jira" ||
  mismatchedActionResourceSystemDecision.actionMetadataSource !== "approved_action"
) {
  fail("connector routing should preserve mismatched approved action resourceSystem separately from trusted route resourceSystem");
}
const mismatchedActionResourceSystemPolicy = evaluateConnectorPolicy({
  connectorRouteStatus: mismatchedActionResourceSystemDecision.status,
  runtimeMode: mismatchedActionResourceSystemDecision.runtimeMode,
  connectorId: mismatchedActionResourceSystemDecision.connectorId,
  resourceSystem: mismatchedActionResourceSystemDecision.resourceSystem,
  skillId: mismatchedActionResourceSystemDecision.skillId,
  skillLabel: mismatchedActionResourceSystemDecision.skillLabel,
  subject: {
    tenantId: "default",
    userId: "verification-user",
    roles: ["employee"]
  },
  resource: {
    connectorId: mismatchedActionResourceSystemDecision.connectorId,
    resourceSystem: mismatchedActionResourceSystemDecision.resourceSystem
  },
  riskLevel: mismatchedActionResourceSystemDecision.riskLevel,
  executionType: mismatchedActionResourceSystemDecision.executionType,
  requiresApproval: mismatchedActionResourceSystemDecision.requiresApproval,
  sensitivity: mismatchedActionResourceSystemDecision.sensitivity,
  action: {
    actionCategory: mismatchedActionResourceSystemDecision.actionCategory,
    approvalMode: mismatchedActionResourceSystemDecision.approvalMode,
    resourceSensitivity: mismatchedActionResourceSystemDecision.resourceSensitivity,
    fieldClasses: mismatchedActionResourceSystemDecision.fieldClasses,
    actionConstraints: mismatchedActionResourceSystemDecision.actionConstraints,
    provider: mismatchedActionResourceSystemDecision.provider,
    resourceSystem: mismatchedActionResourceSystemDecision.actionResourceSystem
  }
});
if (
  mismatchedActionResourceSystemPolicy.effect !== "block" ||
  mismatchedActionResourceSystemPolicy.primaryRuleId !== "block-resource-system-metadata-mismatch"
) {
  fail("mismatched approved action resourceSystem should reach Ogen mismatch guardrail");
} else {
  ok("mismatched approved action resourceSystem is blocked by Ogen mismatch guardrail");
}

const unknownIntent: ConnectorRoutingIntent = {
  targetSystem: "servicenow",
  connectorId: "servicenow-reference",
  requestedSkillId: "servicenow.unknown.lookup",
  confidence: "high",
  reason: "Verification unknown action."
};
const unknownDecision = decideConnectorRoute(unknownIntent, [
  fakeTrustedAgent({
    connectorId: "servicenow-reference",
    resourceSystem: "servicenow",
    approvedCapability: "servicenow.unknown.lookup"
  })
]);
const unknownPolicy = evaluateConnectorPolicy({
  connectorRouteStatus: unknownDecision.status,
  runtimeMode: unknownDecision.runtimeMode,
  connectorId: unknownDecision.connectorId,
  resourceSystem: unknownDecision.resourceSystem,
  skillId: unknownDecision.skillId,
  skillLabel: unknownDecision.skillLabel,
  subject: {
    tenantId: "default",
    userId: "verification-user",
    roles: ["employee"]
  },
  riskLevel: unknownDecision.riskLevel,
  executionType: unknownDecision.executionType,
  requiresApproval: unknownDecision.requiresApproval,
  sensitivity: unknownDecision.sensitivity
});
if (
  unknownDecision.status !== "connector_skill_blocked" ||
  unknownDecision.actionMetadataSource !== "missing" ||
  unknownDecision.toolMappingStatus !== "blocked_unknown_tool" ||
  unknownDecision.runtimeMode !== "not_available" ||
  unknownPolicy.effect !== "block" ||
  unknownPolicy.primaryRuleId !== "block-unapproved-route"
) {
  fail("unknown approved action without metadata should fail closed before approved runtime routing");
} else {
  ok("unknown approved action without metadata fails closed before approved runtime routing");
}

for (const phrase of [
  "Known reference connector skills carry explicit deterministic action safety metadata.",
  "Ogen may use reference catalog metadata as fallback only for known reference skills.",
  "Unknown or incomplete actions still fail closed.",
  "Ogen does not infer safety from natural language or AI output."
]) {
  requireIncludes(platformDocs, phrase, "platform docs cover reference action metadata");
}
requireIncludes(productIdentityDocs, "Ogen can use explicit connector metadata to prove a read-only action is safe, but it never guesses safety from missing metadata.", "product identity docs cover explicit connector metadata safety");

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Reference action metadata verification passed.");
}
