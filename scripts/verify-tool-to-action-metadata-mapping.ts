import { existsSync, readFileSync } from "node:fs";
import type { TrustedOnboardedAgent } from "../services/orchestrator-api/src/agentOnboarding/types.js";
import { decideConnectorRoute } from "../services/orchestrator-api/src/connectorRouting.js";
import { localReferenceConnectorIntentCatalog, localReferenceToolToActionMappings } from "../services/orchestrator-api/src/connectors/localReferenceConnectorIntentCatalog.js";
import { mapToolToActionMetadata } from "../services/orchestrator-api/src/toolMapping/toolToActionMetadataMapper.js";
import {
  requiredToolMappingProofFields,
  requiredToolToActionMappingFields,
  sdkCertificationChecks
} from "../services/orchestrator-api/src/sdkReadiness/sdkContracts.js";

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

const sharedToolMapping = read("packages/shared/src/toolActionMapping.ts");
const sharedIndex = read("packages/shared/src/index.ts");
const mapper = read("services/orchestrator-api/src/toolMapping/toolToActionMetadataMapper.ts");
const referenceCatalog = read("services/orchestrator-api/src/connectors/localReferenceConnectorIntentCatalog.ts");
const profileValidation = read("services/orchestrator-api/src/connectors/profileValidation.ts");
const connectorTypes = read("services/orchestrator-api/src/connectors/types.ts");
const agentOnboardingTypes = read("services/orchestrator-api/src/agentOnboarding/types.ts");
const connectorRouting = read("services/orchestrator-api/src/connectorRouting.ts");
const connectorPlanner = read("services/orchestrator-api/src/connectorActionPlanner.ts");
const decisionEngine = read("services/orchestrator-api/src/connectors/decisionEngine.ts");
const responseMapper = read("services/orchestrator-api/src/agentOnboarding/responseMapper.ts");
const backend = read("services/orchestrator-api/src/index.ts");
const runtimeAuthorizationEvaluator = read("services/orchestrator-api/src/runtimeAuthorization/runtimeAuthorizationEvaluator.ts");
const runtimeAuthorizationSchema = read("services/orchestrator-api/src/http/schemas/runtimeAuthorizationSchemas.ts");
const sdkContracts = read("services/orchestrator-api/src/sdkReadiness/sdkContracts.ts");
const sdkDocs = read("docs/sdk-readiness-contracts.md");
const platformDocs = read("docs/v2-platform-foundation.md");
const roadmap = read("docs/orchestrator-agnostic-roadmap.md");
const packageJsonText = read("package.json");
const v2PlanVerifier = read("scripts/verify-v2-plan.ts");

for (const phrase of [
  "export type OgenToolDefinition",
  "export type OgenToolSourceType",
  "mcp_tool_manifest",
  "a2a_agent_card_skill",
  "connector_profile_action",
  "sdk_action_catalog",
  "manually_imported_catalog",
  "export type OgenToolToActionMapping",
  "export type OgenToolMappingStatus",
  "mapped",
  "incomplete_metadata",
  "unsupported_tool_shape",
  "blocked_unknown_tool",
  "export type OgenToolMappingProof",
  "deterministicMapping: true",
  "aiInferred: false",
  "rawDescriptionStored: false",
  "protectedMaterialExposed: false"
]) {
  requireIncludes(sharedToolMapping, phrase, "shared tool/action mapping types");
}

requireIncludes(sharedIndex, 'export * from "./toolActionMapping.js"', "shared index exports tool/action mapping types");
requireIncludes(sharedIndex, "toolMappingStatus: OgenToolMappingStatus;", "runtime authorization request requires mapped tool mapping status");
requireIncludes(sharedIndex, "toolMappingProof: OgenToolMappingProof;", "runtime authorization request requires mapped tool proof");

for (const phrase of [
  "export function mapToolToActionMetadata",
  "hasAnyDeterministicActionMetadata",
  "blocked_unknown_tool",
  "incomplete_metadata",
  "unsupported_tool_shape",
  "deterministicMapping: true",
  "aiInferred: false",
  "rawDescriptionStored: false",
  "protectedMaterialExposed: false",
  "fieldClassArray(input.fieldClasses)",
  "actionConstraints(input.actionConstraints)"
]) {
  requireIncludes(mapper, phrase, "deterministic tool/action mapper");
}

for (const forbidden of [
  "record.description",
  "input.description",
  ".description",
  "aiClassif",
  "inferRisk",
  "scope.includes(\"write\")",
  "requestedScopes.includes"
]) {
  requireNotIncludes(mapper, forbidden, "mapper does not use descriptions, AI, or OAuth scopes as safety authority");
}

const completeTool = {
  sourceType: "mcp_tool_manifest",
  sourceId: "mcp.vendor.example",
  toolId: "vendor.item.search",
  actionId: "vendor.item.search",
  label: "Search vendor items",
  provider: "vendor",
  resourceSystem: "vendor-system",
  executionType: "inspection_read_only",
  riskLevel: "low",
  requiresApproval: false,
  sensitivity: "standard",
  actionCategory: "search",
  approvalMode: "never",
  resourceSensitivity: "standard",
  fieldClasses: [],
  actionConstraints: {},
  requiredApplicationGrants: [],
  requiredEffectivePermissions: [],
  requestedScopes: []
} as const;

const mapped = mapToolToActionMetadata(completeTool);
if (mapped.status !== "mapped" || !mapped.action || !mapped.certificationResult.certified) {
  fail("complete deterministic tool metadata should map and certify");
} else {
  ok("complete deterministic tool metadata maps and certifies");
}
if (mapped.action?.fieldClasses.length !== 0) {
  fail("explicit empty fieldClasses should be preserved");
} else {
  ok("explicit empty fieldClasses are preserved");
}
if (!mapped.action?.actionConstraints || Object.keys(mapped.action.actionConstraints).length !== 0) {
  fail("explicit empty actionConstraints should be preserved");
} else {
  ok("explicit empty actionConstraints are preserved");
}
if (mapped.proof.deterministicMapping !== true || mapped.proof.aiInferred !== false || mapped.proof.rawDescriptionStored !== false || mapped.proof.protectedMaterialExposed !== false) {
  fail("mapping proof should be deterministic, non-AI, and audit-safe");
} else {
  ok("mapping proof is deterministic, non-AI, and audit-safe");
}

const trimmedRequirements = mapToolToActionMetadata({
  ...completeTool,
  requiredApplicationGrants: [" vendor.read "],
  requiredEffectivePermissions: [" item.inspect "],
  requestedScopes: [" scope.read "]
});
if (
  trimmedRequirements.status !== "mapped" ||
  trimmedRequirements.action?.requiredApplicationGrants[0] !== "vendor.read" ||
  trimmedRequirements.action?.requiredEffectivePermissions[0] !== "item.inspect" ||
  trimmedRequirements.action?.requestedScopes[0] !== "scope.read"
) {
  fail("grant, permission, and scope entries should be trimmed before mapping");
} else {
  ok("grant, permission, and scope entries are trimmed before mapping");
}

for (const [field, label] of [
  ["requiredApplicationGrants", "blank application grant"],
  ["requiredEffectivePermissions", "blank effective permission"],
  ["requestedScopes", "blank requested scope"]
] as const) {
  const malformed = mapToolToActionMetadata({ ...completeTool, [field]: [" "] });
  if (malformed.status !== "incomplete_metadata" || !malformed.missingFields.includes(field)) {
    fail(`${label} should fail closed as incomplete metadata`);
  } else {
    ok(`${label} fails closed as incomplete metadata`);
  }
}

const incomplete = mapToolToActionMetadata({ ...completeTool, actionCategory: undefined });
if (incomplete.status !== "incomplete_metadata" || !incomplete.missingFields.includes("actionCategory")) {
  fail("missing taxonomy metadata should return incomplete_metadata");
} else {
  ok("missing taxonomy metadata returns incomplete_metadata");
}

const blockedUnknown = mapToolToActionMetadata({
  sourceType: "mcp_tool_manifest",
  sourceId: "mcp.vendor.example",
  toolId: "vendor.unknown"
});
if (blockedUnknown.status !== "blocked_unknown_tool") {
  fail("known tool ID with no deterministic metadata should fail closed as blocked_unknown_tool");
} else {
  ok("known tool ID with no deterministic metadata fails closed as blocked_unknown_tool");
}

const unsupported = mapToolToActionMetadata({ sourceType: "unknown", sourceId: "bad", toolId: "bad" });
if (unsupported.status !== "unsupported_tool_shape") {
  fail("unsupported source type should return unsupported_tool_shape");
} else {
  ok("unsupported source type returns unsupported_tool_shape");
}

if (!localReferenceToolToActionMappings.length || localReferenceToolToActionMappings.some((mapping) => mapping.status !== "mapped")) {
  fail("local reference catalog example mappings should all map deterministically");
} else {
  ok("local reference catalog exposes mapped examples");
}

for (const phrase of [
  "localReferenceToolDefinitions",
  "localReferenceToolToActionMappings",
  "mapToolToActionMetadata(tool)"
]) {
  requireIncludes(referenceCatalog, phrase, "reference catalog exposes example tool mappings");
}

for (const phrase of [
  "toolMappingStatus?: OgenToolMappingStatus",
  "toolMappingProof?: OgenToolMappingProof",
  "requestedScopes?: string[]"
]) {
  requireIncludes(connectorTypes, phrase, "connector action contracts carry mapping proof");
}

requireIncludes(agentOnboardingTypes, "requestedScopes?: string[]", "derived connector capabilities carry requested scopes");

for (const phrase of [
  "function toolMappingProof",
  "input.deterministicMapping !== true",
  "input.aiInferred !== false",
  "input.rawDescriptionStored !== false",
  "input.protectedMaterialExposed !== false",
  "toolMappingStatus: optionalValue(input.toolMappingStatus, toolMappingStatuses)",
  "toolMappingProof: toolMappingProof(input.toolMappingProof)",
  "requestedScopes: explicitStringArray(input.requestedScopes)"
]) {
  requireIncludes(profileValidation, phrase, "connector profile validation recognizes mapping proof shape");
}

for (const phrase of [
  "requestedScopes: requestedScopes ? [...requestedScopes] : undefined",
  "missing deterministic metadata requestedScopes"
]) {
  requireIncludes(decisionEngine, phrase, "connector decision engine preserves requested scopes metadata");
}

requireIncludes(responseMapper, "requestedScopes: decision.requestedScopes ? [...decision.requestedScopes] : undefined", "onboarding response mapper preserves requested scopes metadata");

for (const phrase of [
  "mapToolToActionMetadata({",
  "toolMappingStatus: toolMapping.status",
  "toolMappingProof: toolMapping.proof",
  'if (actionMetadata.toolMappingStatus !== "mapped")',
  'status: "connector_skill_blocked"',
  "toolMappingStatus: actionMetadata.toolMappingStatus",
  "toolMappingProof: actionMetadata.toolMappingProof"
]) {
  requireIncludes(connectorRouting, phrase, "connector routing carries deterministic mapping proof");
}
for (const forbidden of [
  "requiresApproval: requiresApproval ?? false",
  "sensitivity: sensitivity ??",
  "const requiredApplicationGrants = approved.requiredApplicationGrants ?? []",
  "const requiredEffectivePermissions = approved.requiredEffectivePermissions ?? []",
  "requestedScopes: []"
]) {
  requireNotIncludes(connectorRouting, forbidden, "connector routing preserves missing approval metadata as incomplete");
}

for (const phrase of [
  "function toolMappingProof",
  "toolMappingStatus: toolMappingStatus(item.toolMappingStatus)",
  "toolMappingProof: toolMappingProof(item.toolMappingProof)"
]) {
  requireIncludes(connectorPlanner, phrase, "connector planner preserves mapping proof when provided");
}

for (const phrase of [
  "toolMappingStatus: connectorRouting.toolMappingStatus",
  "toolMappingProof: connectorRouting.toolMappingProof",
  'decision.toolMappingStatus === "mapped"',
  "runtimeToolMappingStatuses.has(String(action.toolMappingStatus))",
  "connectorRuntimeToolMappingProofBound(decision)",
  "connectorRoutingWithProofBindingStatus(connectorRouting)",
  "connectorRouteStatus: effectiveConnectorRouting.status",
  'return "unsupported";',
  "action.toolMappingProof is required",
  "action.toolMappingProof must be deterministic, non-AI-derived, and audit-safe",
  "tool-to-action metadata mapping did not produce a mapped action"
]) {
  requireIncludes(backend, phrase, "backend raw proof and audit metadata include mapping proof");
}

for (const phrase of [
  "function hasMappedToolProof",
  'request.action.toolMappingStatus === "mapped"',
  "actionProvider !== undefined",
  "actionResourceSystem !== undefined",
  "proofProvider === actionProvider",
  "proofToolId === skillId",
  "proofResourceSystem === trustedResourceSystem",
  'return "connector_skill_blocked";',
  "Tool-to-action metadata mapping must be mapped and bound to the requested action and trusted route/resource before runtime authorization."
]) {
  requireIncludes(runtimeAuthorizationEvaluator, phrase, "runtime authorization evaluator fails closed without mapped tool proof");
}

for (const phrase of [
  '"toolMappingStatus", "toolMappingProof"',
  "deterministicMapping",
  "aiInferred",
  "rawDescriptionStored",
  "protectedMaterialExposed"
]) {
  requireIncludes(runtimeAuthorizationSchema, phrase, "runtime authorization schema requires mapped tool proof");
}

for (const field of [
  "tool source type",
  "normalized action metadata",
  "required scopes/grants/permissions",
  "mapping proof",
  "certification result"
]) {
  requireIncludes(`${sdkDocs}\n${platformDocs}\n${roadmap}`, field, "docs explain SDK mapping and certification expectations");
}

for (const field of [
  "sourceType",
  "sourceId",
  "toolId",
  "provider",
  "resourceSystem",
  "deterministicMapping",
  "aiInferred",
  "rawDescriptionStored",
  "protectedMaterialExposed"
]) {
  if (!requiredToolMappingProofFields.includes(field as typeof requiredToolMappingProofFields[number])) {
    fail(`required tool mapping proof fields should include ${field}`);
  } else {
    ok(`required tool mapping proof fields include ${field}`);
  }
}

for (const field of [
  "sourceType",
  "actionCategory",
  "approvalMode",
  "resourceSensitivity",
  "requiredApplicationGrants",
  "requiredEffectivePermissions",
  "requestedScopes",
  "proof",
  "certificationResult"
]) {
  if (!requiredToolToActionMappingFields.includes(field as typeof requiredToolToActionMappingFields[number])) {
    fail(`required tool/action mapping fields should include ${field}`);
  } else {
    ok(`required tool/action mapping fields include ${field}`);
  }
}

const referenceConnector = localReferenceConnectorIntentCatalog[0];
const referenceSkill = referenceConnector?.skillHints[0];
if (!referenceConnector || !referenceSkill) {
  fail("local reference catalog should expose at least one connector skill for fail-closed routing verification");
} else {
  const incompleteMappingAgent = {
    agentId: "mapping-fail-closed-agent",
    issuer: "https://issuer.example",
    clientId: "mapping-fail-closed-client",
    audience: "secure-a2a-gateway",
    runtimeEndpoint: "http://127.0.0.1:65535/a2a/task",
    connectorId: referenceConnector.connectorId,
    resourceSystem: referenceConnector.resourceSystem,
    requestedScopes: [],
    requestedApplicationGrants: [],
    agentDeclaredSkills: [referenceSkill.skillId],
    agentDeclaredCapabilities: [referenceSkill.skillId],
    applicationAccessGrants: [],
    grantedScopes: [],
    effectivePermissions: [],
    deniedPermissions: [],
    approvedActions: [
      {
        capability: referenceSkill.skillId,
        label: referenceSkill.label,
        reason: "test fixture with incomplete deterministic mapping",
        provider: "",
        resourceSystem: referenceSkill.resourceSystem,
        riskLevel: referenceSkill.riskLevel,
        executionType: referenceSkill.executionType,
        requiresApproval: referenceSkill.requiresApproval,
        sensitivity: referenceSkill.sensitivity,
        actionCategory: referenceSkill.actionCategory,
        approvalMode: referenceSkill.approvalMode,
        resourceSensitivity: referenceSkill.resourceSensitivity,
        fieldClasses: [...(referenceSkill.fieldClasses ?? [])],
        actionConstraints: { ...(referenceSkill.actionConstraints ?? {}) },
        requiredApplicationGrants: [],
        requiredEffectivePermissions: [],
        requestedScopes: []
      }
    ],
    blockedActions: [],
    approvedCapabilities: [],
    blockedCapabilities: [],
    connectorProfileVerified: true,
    connectorDecisionSource: referenceConnector.connectorId,
    trustLevel: "executable_pending_runtime_validation",
    executable: false,
    executionState: "metadata_only",
    runtimeTrustSource: "live_onboarding",
    tokenEndpointAuthMethod: "private-key-jwt",
    oauthApplicationBound: true
  } as TrustedOnboardedAgent;

  const route = decideConnectorRoute(
    {
      targetSystem: referenceConnector.resourceSystem,
      connectorId: referenceConnector.connectorId,
      requestedSkillId: referenceSkill.skillId,
      confidence: "high",
      reason: "test fixture"
    },
    [incompleteMappingAgent]
  );
  if (route.status !== "connector_skill_blocked" || route.toolMappingStatus !== "incomplete_metadata" || route.runtimeMode !== "not_available") {
    fail(`incomplete tool mapping should fail closed before approved runtime routing: ${JSON.stringify(route)}`);
  } else {
    ok("incomplete tool mapping fails closed before approved runtime routing");
  }

  const missingApprovalMetadataSkillId = `${referenceConnector.connectorId}.custom.missing-approval-metadata`;
  const missingApprovalMetadataAgent = {
    agentId: "mapping-missing-approval-agent",
    issuer: "https://issuer.example",
    clientId: "mapping-missing-approval-client",
    audience: "secure-a2a-gateway",
    runtimeEndpoint: "http://127.0.0.1:65535/a2a/task",
    connectorId: referenceConnector.connectorId,
    resourceSystem: referenceConnector.resourceSystem,
    requestedScopes: [],
    requestedApplicationGrants: [],
    agentDeclaredSkills: [missingApprovalMetadataSkillId],
    agentDeclaredCapabilities: [missingApprovalMetadataSkillId],
    applicationAccessGrants: [],
    grantedScopes: [],
    effectivePermissions: [],
    deniedPermissions: [],
    approvedActions: [
      {
        capability: missingApprovalMetadataSkillId,
        label: "Missing approval metadata",
        reason: "test fixture that omits required approval metadata",
        provider: referenceConnector.resourceSystem,
        resourceSystem: referenceConnector.resourceSystem,
        riskLevel: "low",
        executionType: "inspection_read_only",
        actionCategory: "business_object.read",
        approvalMode: "never",
        resourceSensitivity: "standard",
        fieldClasses: [],
        actionConstraints: {},
        requiredApplicationGrants: [],
        requiredEffectivePermissions: [],
        requestedScopes: []
      }
    ],
    blockedActions: [],
    approvedCapabilities: [],
    blockedCapabilities: [],
    connectorProfileVerified: true,
    connectorDecisionSource: referenceConnector.connectorId,
    trustLevel: "executable_pending_runtime_validation",
    executable: false,
    executionState: "metadata_only",
    runtimeTrustSource: "live_onboarding",
    tokenEndpointAuthMethod: "private-key-jwt",
    oauthApplicationBound: true
  } as TrustedOnboardedAgent;

  const missingApprovalRoute = decideConnectorRoute(
    {
      targetSystem: referenceConnector.resourceSystem,
      connectorId: referenceConnector.connectorId,
      requestedSkillId: missingApprovalMetadataSkillId,
      confidence: "high",
      reason: "test fixture"
    },
    [missingApprovalMetadataAgent]
  );
  if (missingApprovalRoute.status !== "connector_skill_blocked" || missingApprovalRoute.toolMappingStatus !== "incomplete_metadata" || missingApprovalRoute.runtimeMode !== "not_available") {
    fail(`missing approval metadata should remain incomplete before runtime routing: ${JSON.stringify(missingApprovalRoute)}`);
  } else {
    ok("missing approval metadata remains incomplete before runtime routing");
  }

  const missingGrantMetadataSkillId = `${referenceConnector.connectorId}.custom.missing-grant-metadata`;
  const missingGrantMetadataAgent = {
    agentId: "mapping-missing-grant-agent",
    issuer: "https://issuer.example",
    clientId: "mapping-missing-grant-client",
    audience: "secure-a2a-gateway",
    runtimeEndpoint: "http://127.0.0.1:65535/a2a/task",
    connectorId: referenceConnector.connectorId,
    resourceSystem: referenceConnector.resourceSystem,
    requestedScopes: [],
    requestedApplicationGrants: [],
    agentDeclaredSkills: [missingGrantMetadataSkillId],
    agentDeclaredCapabilities: [missingGrantMetadataSkillId],
    applicationAccessGrants: [],
    grantedScopes: [],
    effectivePermissions: [],
    deniedPermissions: [],
    approvedActions: [
      {
        capability: missingGrantMetadataSkillId,
        label: "Missing grant metadata",
        reason: "test fixture that omits required grant and permission metadata",
        provider: referenceConnector.resourceSystem,
        resourceSystem: referenceConnector.resourceSystem,
        riskLevel: "low",
        executionType: "inspection_read_only",
        requiresApproval: false,
        sensitivity: "standard",
        actionCategory: "business_object.read",
        approvalMode: "never",
        resourceSensitivity: "standard",
        fieldClasses: [],
        actionConstraints: {},
        requestedScopes: []
      }
    ],
    blockedActions: [],
    approvedCapabilities: [],
    blockedCapabilities: [],
    connectorProfileVerified: true,
    connectorDecisionSource: referenceConnector.connectorId,
    trustLevel: "executable_pending_runtime_validation",
    executable: false,
    executionState: "metadata_only",
    runtimeTrustSource: "live_onboarding",
    tokenEndpointAuthMethod: "private-key-jwt",
    oauthApplicationBound: true
  } as TrustedOnboardedAgent;

  const missingGrantRoute = decideConnectorRoute(
    {
      targetSystem: referenceConnector.resourceSystem,
      connectorId: referenceConnector.connectorId,
      requestedSkillId: missingGrantMetadataSkillId,
      confidence: "high",
      reason: "test fixture"
    },
    [missingGrantMetadataAgent]
  );
  if (missingGrantRoute.status !== "connector_skill_blocked" || missingGrantRoute.toolMappingStatus !== "incomplete_metadata" || missingGrantRoute.runtimeMode !== "not_available") {
    fail(`missing grant and permission metadata should remain incomplete before runtime routing: ${JSON.stringify(missingGrantRoute)}`);
  } else {
    ok("missing grant and permission metadata remains incomplete before runtime routing");
  }
}

for (const check of [
  "tool-action-mapping-complete",
  "tool-action-mapping-proof-safe",
  "tool-action-mapping-certification"
]) {
  if (!sdkCertificationChecks.includes(check as typeof sdkCertificationChecks[number])) {
    fail(`SDK certification checks should include ${check}`);
  } else {
    ok(`SDK certification checks include ${check}`);
  }
}

for (const phrase of [
  "requiredToolToActionMappingFields",
  "requiredToolMappingProofFields",
  '"tool-action-mapping-complete"',
  '"tool-action-mapping-proof-safe"',
  '"tool-action-mapping-certification"'
]) {
  requireIncludes(sdkContracts, phrase, "SDK readiness contracts include mapping proof and certification expectations");
}

for (const phrase of [
  "AI descriptions are not authority",
  "natural-language tool text must not classify safety",
  "Broad OAuth scopes do not grant action permission",
  "Unknown or incomplete tools fail closed",
  "Mapping proof is bound to the requested action and trusted route/resource",
  "Connector runtime execution and A2A task execution are distinct"
]) {
  requireIncludes(`${sdkDocs}\n${platformDocs}\n${roadmap}`, phrase, "docs explain mapping trust boundary");
}

const packageJson = JSON.parse(packageJsonText) as { scripts?: Record<string, string> };
if (packageJson.scripts?.["verify:tool-to-action-metadata-mapping"] !== "tsx scripts/verify-tool-to-action-metadata-mapping.ts") {
  fail("package.json should include verify:tool-to-action-metadata-mapping");
} else {
  ok("package.json includes verify:tool-to-action-metadata-mapping");
}
if (!packageJson.scripts?.["verify:v2-plan"]?.includes("verify:generic-action-taxonomy && npm run verify:tool-to-action-metadata-mapping")) {
  fail("verify:v2-plan should run tool/action mapping after generic action taxonomy");
} else {
  ok("verify:v2-plan runs tool/action mapping after generic action taxonomy");
}
requireIncludes(v2PlanVerifier, "verify:tool-to-action-metadata-mapping", "v2 plan verifier checks tool/action mapping wiring");

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Tool-to-action metadata mapping verification passed.");
}
