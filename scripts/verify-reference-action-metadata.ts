import { existsSync, readFileSync } from "node:fs";
import type { DerivedCapability, TrustedOnboardedAgent } from "../services/orchestrator-api/src/agentOnboarding.js";
import { decideConnectorRoute, routeConnectorRequest, type ConnectorRoutingIntent } from "../services/orchestrator-api/src/connectorRouting.js";
import { localReferenceConnectorIntentCatalog, localReferenceToolToActionMappings } from "../services/orchestrator-api/src/connectors/localReferenceConnectorIntentCatalog.js";
import { evaluateConnectorPolicy } from "../services/orchestrator-api/src/policy/connectorPolicy.js";
import { jiraReferenceConnector } from "../real-external-agent/src/connectors/jiraReferenceConnector";
import { serviceNowReferenceConnector } from "../real-external-agent/src/connectors/servicenowReferenceConnector";
import { githubReferenceConnector } from "../real-external-agent/src/connectors/githubReferenceConnector";

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
  blockedAction?: Partial<DerivedCapability> & { capability: string };
  requestedApplicationGrants?: string[];
  applicationAccessGrants?: string[];
  effectivePermissions?: string[];
  deniedPermissions?: string[];
}): TrustedOnboardedAgent {
  const approvedAction: DerivedCapability = {
    ...params.approvedAction,
    capability: params.approvedAction?.capability ?? params.approvedCapability,
    label: params.approvedAction?.label ?? `Approved ${params.approvedCapability}`,
    reason: params.approvedAction?.reason ?? "Approved for verification without embedded safety metadata."
  };
  const approvedActions = [approvedAction];
  const blockedActions: DerivedCapability[] = params.blockedAction
    ? [{
        ...params.blockedAction,
        capability: params.blockedAction.capability,
        label: params.blockedAction.label ?? `Blocked ${params.blockedAction.capability}`,
        reason: params.blockedAction.reason ?? "Blocked for verification."
      }]
    : [];
  const declaredCapabilities = [...new Set([
    params.approvedCapability,
    ...blockedActions.map((action) => action.capability)
  ])];

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
    requestedApplicationGrants: params.requestedApplicationGrants ?? [],
    agentDeclaredSkills: declaredCapabilities,
    agentDeclaredCapabilities: declaredCapabilities,
    applicationAccessGrants: params.applicationAccessGrants ?? [],
    grantedScopes: [],
    effectivePermissions: params.effectivePermissions ?? [],
    deniedPermissions: params.deniedPermissions ?? [],
    approvedActions,
    blockedActions,
    approvedCapabilities: approvedActions,
    blockedCapabilities: blockedActions,
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
  const mapping = localReferenceToolToActionMappings.find((item) => item.proof.toolId === skillId);
  if (mapping?.status !== "mapped") {
    fail(`${skillId} should map to complete deterministic tool-to-action metadata`);
  } else {
    ok(`${skillId} maps to complete deterministic tool-to-action metadata`);
  }
}

const referenceConnectorsById = new Map([
  [jiraReferenceConnector.connectorId, jiraReferenceConnector],
  [serviceNowReferenceConnector.connectorId, serviceNowReferenceConnector],
  [githubReferenceConnector.connectorId, githubReferenceConnector]
]);
for (const connector of localReferenceConnectorIntentCatalog) {
  const referenceConnector = referenceConnectorsById.get(connector.connectorId);
  if (!referenceConnector) {
    fail(`${connector.connectorId} should have a reference connector profile for skill declaration checks`);
    continue;
  }
  const declaredSkillIds = new Set([...referenceConnector.skillCatalog, ...referenceConnector.actionCatalog].map((skill) => skill.id));
  for (const hint of connector.skillHints) {
    if (!declaredSkillIds.has(hint.skillId)) {
      fail(`${connector.connectorId} local reference skill ${hint.skillId} should be declared in the reference connector profile`);
    }
  }
}
ok("local reference connector skill hints use declared reference connector skills");

requireIncludes(connectorRouting, "function referenceSkillMetadata", "connector routing has explicit reference metadata helper");
requireIncludes(connectorRouting, "supported.skillHints.find((hint) => hint.skillId === skillId)", "reference metadata is selected by exact skill ID");
requireIncludes(connectorRouting, "approved.riskLevel ?? referenceSkill?.riskLevel", "approved risk metadata wins before reference fallback");
requireIncludes(connectorRouting, "approved.executionType ?? referenceSkill?.executionType", "approved execution metadata wins before reference fallback");
requireIncludes(connectorRouting, "function missingNormalizedActionMetadataFields", "connector routing reports missing normalized metadata fields");
requireIncludes(connectorRouting, "actionMetadata.missingFields", "connector routing carries missing metadata details into blocked decisions");
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

function assertServiceNowApprovedRoute(message: string, approvedCapability: string, expectedSkillId: string): void {
  const decision = routeConnectorRequest(message, [
    fakeTrustedAgent({
      connectorId: "servicenow-reference",
      resourceSystem: "servicenow",
      approvedCapability
    })
  ]);
  if (decision.status !== "connector_skill_approved" || decision.skillId !== expectedSkillId) {
    fail(`${message} should route to approved declared ServiceNow skill ${expectedSkillId}, got ${JSON.stringify(decision)}`);
    return;
  }
  ok(`${message} routes to approved declared ServiceNow skill ${expectedSkillId}`);
}

assertServiceNowApprovedRoute("status of my request", "servicenow.ticket.status.lookup", "servicenow.ticket.status.lookup");
assertServiceNowApprovedRoute("RITM status", "servicenow.ticket.status.lookup", "servicenow.ticket.status.lookup");
assertServiceNowApprovedRoute("service catalog recommendation", "servicenow.catalog.item.recommend", "servicenow.catalog.item.recommend");

const staleMetadataBlockedJiraDecision = routeConnectorRequest("Jira issue creation fails with 403 when creating issues in FIN project", [
  fakeTrustedAgent({
    connectorId: "jira-reference",
    resourceSystem: "jira",
    approvedCapability: "jira.permission.inspect",
    requestedApplicationGrants: ["read:jira-work", "read:jira-user"],
    applicationAccessGrants: ["read:jira-work", "read:jira-user"],
    effectivePermissions: ["browse_projects", "view_issues", "read_project_roles"],
    deniedPermissions: ["create_issues"],
    blockedAction: {
      capability: "jira.issue.diagnose_creation_failure",
      label: "Diagnose Jira issue creation failures",
      reason: "missing deterministic metadata requestedScopes"
    }
  })
]);
if (
  staleMetadataBlockedJiraDecision.status !== "connector_skill_approved" ||
  staleMetadataBlockedJiraDecision.skillId !== "jira.issue.diagnose_creation_failure" ||
  staleMetadataBlockedJiraDecision.actionMetadataSource !== "reference_catalog" ||
  staleMetadataBlockedJiraDecision.runtimeMode !== "external_runtime_available" ||
  !staleMetadataBlockedJiraDecision.requestedScopes?.includes("read:jira-work")
) {
  fail("metadata-only stale blocked Jira diagnostic action should be revalidated as approved from reference metadata");
} else {
  ok("metadata-only stale blocked Jira diagnostic action is revalidated as approved from reference metadata");
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
  !unknownDecision.reason.includes("Missing deterministic metadata") ||
  unknownPolicy.effect !== "block" ||
  unknownPolicy.primaryRuleId !== "block-unapproved-route"
) {
  fail("unknown approved action without metadata should fail closed before approved runtime routing");
} else {
  ok("unknown approved action without metadata fails closed before approved runtime routing");
}

const incompleteIntent: ConnectorRoutingIntent = {
  targetSystem: "servicenow",
  connectorId: "servicenow-reference",
  requestedSkillId: "servicenow.partial.lookup",
  confidence: "high",
  reason: "Verification incomplete action metadata."
};
const incompleteDecision = decideConnectorRoute(incompleteIntent, [
  fakeTrustedAgent({
    connectorId: "servicenow-reference",
    resourceSystem: "servicenow",
    approvedCapability: "servicenow.partial.lookup",
    approvedAction: {
      riskLevel: "low",
      executionType: "inspection_read_only",
      requiresApproval: false,
      sensitivity: "standard",
      actionCategory: "business_object.read"
    }
  })
]);
if (
  incompleteDecision.status !== "connector_skill_blocked" ||
  incompleteDecision.toolMappingStatus !== "incomplete_metadata" ||
  !incompleteDecision.missingFields?.includes("approvalMode") ||
  !incompleteDecision.missingFields?.includes("provider") ||
  !incompleteDecision.reason.includes("Missing deterministic metadata")
) {
  fail("approved action with incomplete metadata should fail closed with missing field details");
} else {
  ok("approved action with incomplete metadata fails closed with missing field details");
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
