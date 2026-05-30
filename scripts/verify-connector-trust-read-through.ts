import { existsSync, readFileSync } from "node:fs";
import { decideConnectorRoute } from "../services/orchestrator-api/src/connectorRouting.js";
import { deriveInstalledConnectorLifecycle } from "../services/orchestrator-api/src/connectors/installedConnectorLifecycle.js";
import type { TrustedOnboardedAgent } from "../services/orchestrator-api/src/agentOnboarding/types.js";

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
    fail(`${context} should not include: ${phrase}`);
    return;
  }
  ok(context);
}

function requireRegex(source: string, pattern: RegExp, context: string): void {
  if (!pattern.test(source)) {
    fail(`${context} missing required pattern: ${pattern}`);
    return;
  }
  ok(context);
}

function routeBlock(source: string, method: string, path: string): string {
  const marker = `request.method === "${method}" && request.url === "${path}"`;
  const start = source.indexOf(marker);
  if (start < 0) {
    fail(`route block missing: ${method} ${path}`);
    return "";
  }
  const nextRoute = source.indexOf("\n  if (request.method", start + marker.length);
  return nextRoute < 0 ? source.slice(start) : source.slice(start, nextRoute);
}

const trustedStore = read("services/orchestrator-api/src/agentOnboarding/trustedAgentStore.ts");
const onboardingIndex = read("services/orchestrator-api/src/agentOnboarding/index.ts");
const types = read("services/orchestrator-api/src/agentOnboarding/types.ts");
const responseMapper = read("services/orchestrator-api/src/agentOnboarding/responseMapper.ts");
const connectorRouting = read("services/orchestrator-api/src/connectorRouting.ts");
const backend = read("services/orchestrator-api/src/index.ts");
const packageJson = read("package.json");
const platformDocs = read("docs/v2-platform-foundation.md");
const stateInventory = read("docs/v2-state-inventory.md");

requireIncludes(trustedStore, "export async function listTrustedOnboardedAgentsForOwner", "trusted store exports async read-through helper");
requireIncludes(types, 'runtimeTrustSource?: "live_onboarding" | "stored_metadata"', "trusted agent type includes runtime trust source marker");
requireIncludes(types, "rehydratedFromStore?: boolean", "trusted agent type includes rehydration marker");
requireIncludes(responseMapper, 'runtimeTrustSource: "live_onboarding"', "live onboarding marks runtime trust source");
requireIncludes(responseMapper, "rehydratedFromStore: false", "live onboarding marks non-rehydrated trust");
requireIncludes(trustedStore, 'runtimeTrustSource: "stored_metadata"', "stored trust hydration marks stored metadata trust");
requireIncludes(trustedStore, "rehydratedFromStore: true", "stored trust hydration marks rehydrated records");
requireIncludes(onboardingIndex, "listTrustedOnboardedAgentsForOwner", "agent onboarding barrel exports read-through helper");
requireIncludes(trustedStore, "getPlatformStateStore().listConnectorTrustRecords(ownerKey)", "read-through helper loads persisted trust records by owner key");
requireIncludes(trustedStore, "records.map(fromStoredConnectorTrustRecord)", "read-through helper hydrates stored trust records safely");
requireRegex(trustedStore, /trustedAgentsByOwner\.set\(ownerKey, hydrated\)/, "read-through helper warms runtime mirror");
requireRegex(trustedStore, /catch\s*\{[\s\S]*return \[\];[\s\S]*\}/, "read-through helper fails closed without fabricating trust");
requireNotIncludes(trustedStore, "console.warn(ownerKey", "read-through helper does not log raw owner key");
requireNotIncludes(trustedStore, "console.error(ownerKey", "read-through helper does not log raw owner key");
requireIncludes(trustedStore, "upsertConnectorTrustRecord(storedRecord)", "persist trusted agent still writes through platform state store");
requireIncludes(trustedStore, "platformOwnerKeyHash(ownerKey)", "persisted trust records hash owner key");

for (const forbidden of [
  "accessToken",
  "refreshToken",
  "authorizationCode",
  "clientSecret",
  "privateKey",
  "clientAssertion"
]) {
  requireNotIncludes(trustedStore, `metadata.${forbidden}`, "stored trust hydration does not read raw token metadata");
}

requireRegex(trustedStore, /fromStoredConnectorTrustRecord[\s\S]*trustLevel:[\s\S]*trusted_metadata_only/, "hydrated records remain metadata-only trust");
requireRegex(trustedStore, /fromStoredConnectorTrustRecord[\s\S]*executable: false/, "hydrated records are not runtime executable");
requireRegex(trustedStore, /fromStoredConnectorTrustRecord[\s\S]*executionState: "metadata_only"/, "hydrated records keep metadata-only execution state");
requireRegex(trustedStore, /fromStoredConnectorTrustRecord[\s\S]*approvedActions/, "hydrated records preserve approved actions");
requireRegex(trustedStore, /fromStoredConnectorTrustRecord[\s\S]*blockedActions/, "hydrated records preserve blocked actions");
requireRegex(trustedStore, /fromStoredConnectorTrustRecord[\s\S]*connectorProfile/, "hydrated records preserve connector profile");
requireIncludes(connectorRouting, 'agent.runtimeTrustSource === "stored_metadata"', "connector routing checks stored metadata trust source");
requireIncludes(connectorRouting, "agent.rehydratedFromStore === true", "connector routing checks rehydration marker");
requireIncludes(connectorRouting, "function mergedConnectorActions", "connector routing merges approvedActions and legacy approvedCapabilities");
requireRegex(connectorRouting, /const runtimeAvailable = !persistedMetadataOnly && isConnectorRuntimeEndpointAllowed\(onboarded\.runtimeEndpoint\)/, "connector routing blocks stored metadata from external runtime availability");
requireRegex(connectorRouting, /trustedRuntimeEndpoint: runtimeAvailable \? onboarded\.runtimeEndpoint : undefined/, "connector routing avoids trusted runtime endpoint for stored metadata");
requireIncludes(connectorRouting, 'runtimeMode: runtimeAvailable ? "external_runtime_available" : "metadata_only"', "connector routing keeps stored metadata runtime mode metadata_only");
requireIncludes(connectorRouting, "Connector trust metadata was restored from persisted state, but runtime execution requires fresh runtime validation.", "connector routing explains stored metadata runtime revalidation");

const demoReadyBlock = routeBlock(backend, "POST", "/demo/end-user-ready");
requireIncludes(demoReadyBlock, "await agentCardRegistryKeyForIdentityOrAdmin(request, response)", "/demo/end-user-ready still requires fresh identity/admin access");
requireIncludes(demoReadyBlock, "await prepareEndUserDemoEnvironment(registryKey)", "/demo/end-user-ready uses read-through demo preparation");
requireRegex(backend, /async function prepareEndUserDemoEnvironment[\s\S]*await listTrustedOnboardedAgentsForOwner/, "demo preparation uses connector trust read-through");

for (const [method, path] of [
  ["GET", "/agent-onboarding"],
  ["GET", "/agent-onboarding/supported-connectors"],
  ["POST", "/agent-onboarding/start"]
] as const) {
  const block = routeBlock(backend, method, path);
  requireIncludes(block, "await agentCardRegistryKeyForIdentityOrAdmin(request, response)", `${path} still requires fresh identity/admin access`);
  requireIncludes(block, "await listTrustedOnboardedAgentsForOwner", `${path} uses connector trust read-through`);
}

requireIncludes(backend, "const installedAgents = sessionToken ? await listTrustedOnboardedAgentsForOwner(sessionToken) : []", "resolve path uses connector trust read-through");
requireIncludes(backend, "await requireFreshIdentitySession(request, response)", "protected backend routes still revalidate user directory");
requireNotIncludes(backend, "requireIdentity: true", "session-only registry identity checks are not reintroduced");

const baseAgent: TrustedOnboardedAgent = {
  agentId: "external-jira-agent",
  issuer: "https://agent.example",
  clientId: "jira-agent-client",
  audience: "secure-a2a-gateway",
  runtimeEndpoint: "http://localhost:4201/a2a/task",
  connectorId: "jira-reference",
  resourceSystem: "jira",
  connectorDisplayName: "Jira",
  requestedScopes: [],
  requestedApplicationGrants: [],
  agentDeclaredSkills: ["jira.issue.status.lookup"],
  agentDeclaredCapabilities: ["jira.issue.status.lookup"],
  applicationAccessGrants: [],
  grantedScopes: [],
  effectivePermissions: [],
  deniedPermissions: [],
  approvedActions: [{
    capability: "jira.issue.status.lookup",
    label: "Look up Jira issue status",
    reason: "Allowed in test."
  }],
  blockedActions: [],
  approvedCapabilities: [{
    capability: "jira.issue.status.lookup",
    label: "Look up Jira issue status",
    reason: "Allowed in test."
  }],
  blockedCapabilities: [],
  connectorProfile: {
    connectorId: "jira-reference",
    resourceSystem: "jira",
    displayName: "Jira",
    version: "test",
    profileSource: "built_in_reference"
  },
  connectorProfileVerified: true,
  connectorDecisionSource: "test",
  trustLevel: "trusted_metadata_only",
  executable: false,
  executionState: "metadata_only",
  tokenEndpointAuthMethod: "private-key-jwt",
  oauthApplicationBound: true
};

const storedMetadataDecision = decideConnectorRoute({
  targetSystem: "jira",
  connectorId: "jira-reference",
  requestedSkillId: "jira.issue.status.lookup",
  confidence: "high",
  reason: "runtime verification test"
}, [{
  ...baseAgent,
  runtimeTrustSource: "stored_metadata",
  rehydratedFromStore: true
}]);
if (
  storedMetadataDecision.status !== "connector_skill_approved" ||
  storedMetadataDecision.runtimeMode !== "metadata_only" ||
  storedMetadataDecision.trustedRuntimeEndpoint
) {
  fail("rehydrated stored metadata must approve metadata only without executable runtime endpoint");
} else {
  ok("rehydrated stored metadata stays metadata_only and non-executable");
}

const liveOnboardingDecision = decideConnectorRoute({
  targetSystem: "jira",
  connectorId: "jira-reference",
  requestedSkillId: "jira.issue.status.lookup",
  confidence: "high",
  reason: "runtime verification test"
}, [{
  ...baseAgent,
  runtimeTrustSource: "live_onboarding",
  rehydratedFromStore: false
}]);
if (
  liveOnboardingDecision.status !== "connector_skill_approved" ||
  liveOnboardingDecision.runtimeMode !== "external_runtime_available" ||
  liveOnboardingDecision.trustedRuntimeEndpoint !== "http://localhost:4201/a2a/task"
) {
  fail("live onboarding trust should keep allowlisted external runtime availability");
} else {
  ok("live onboarding trust can use allowlisted external runtime");
}

const legacyCapabilitiesOnlyAgent: TrustedOnboardedAgent = {
  ...baseAgent,
  approvedActions: [],
  approvedCapabilities: baseAgent.approvedCapabilities,
  externalConfigHash: "legacy-external-config-hash",
  runtimeTrustSource: "live_onboarding",
  rehydratedFromStore: false
};
const legacyCapabilitiesOnlyDecision = decideConnectorRoute({
  targetSystem: "jira",
  connectorId: "jira-reference",
  requestedSkillId: "jira.issue.status.lookup",
  confidence: "high",
  reason: "legacy alias verification test"
}, [legacyCapabilitiesOnlyAgent]);
const legacyCapabilitiesOnlyLifecycle = deriveInstalledConnectorLifecycle(legacyCapabilitiesOnlyAgent);
if (
  legacyCapabilitiesOnlyDecision.status !== "connector_skill_approved" ||
  legacyCapabilitiesOnlyDecision.runtimeMode !== "external_runtime_available" ||
  legacyCapabilitiesOnlyLifecycle.state !== "runtime_ready"
) {
  fail("legacy approvedCapabilities must count as approved runtime actions when approvedActions is empty");
} else {
  ok("legacy approvedCapabilities count as approved runtime actions when approvedActions is empty");
}

const parsedPackageJson = JSON.parse(packageJson) as { scripts?: Record<string, string> };
if (parsedPackageJson.scripts?.["verify:connector-trust-read-through"] !== "tsx scripts/verify-connector-trust-read-through.ts") {
  fail("package.json should include verify:connector-trust-read-through");
} else {
  ok("package.json includes verify:connector-trust-read-through");
}
if (!parsedPackageJson.scripts?.["verify:v2-plan"]?.includes("verify:connector-trust-read-through")) {
  fail("verify:v2-plan should include verify:connector-trust-read-through");
} else {
  ok("verify:v2-plan includes verify:connector-trust-read-through");
}

for (const phrase of [
  "Phase 2.10a  Connector Trust Read-Through / Rehydration",
  "runtime mirror can rehydrate",
  "safe metadata records",
  "does not make a connector automatically executable",
  "runtime execution still requires policy",
  "memory mode remains available"
]) {
  requireIncludes(platformDocs, phrase, "platform docs cover connector trust read-through");
}

for (const phrase of [
  "persisted",
  "read-through capable",
  "restart-surviving metadata"
]) {
  requireIncludes(stateInventory, phrase, "state inventory marks connector trust read-through capability");
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Connector trust read-through verification passed.");
}
