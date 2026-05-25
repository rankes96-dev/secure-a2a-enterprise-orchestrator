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
const backend = read("services/orchestrator-api/src/index.ts");
const packageJson = read("package.json");
const platformDocs = read("docs/v2-platform-foundation.md");
const stateInventory = read("docs/v2-state-inventory.md");

requireIncludes(trustedStore, "export async function listTrustedOnboardedAgentsForOwner", "trusted store exports async read-through helper");
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
