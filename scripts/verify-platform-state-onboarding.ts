import { existsSync, readFileSync } from "node:fs";
import { InMemoryPlatformStateStore } from "../services/orchestrator-api/src/state/inMemoryPlatformStateStore.js";
import { getPlatformStateStore, resetPlatformStateStoreForTests } from "../services/orchestrator-api/src/state/createPlatformStateStore.js";
import { toStoredConnectorTrustRecord } from "../services/orchestrator-api/src/agentOnboarding/trustedAgentStore.js";
import type { TrustedOnboardedAgent } from "../services/orchestrator-api/src/agentOnboarding/types.js";
import type { StoredConnectorTrustRecord } from "../services/orchestrator-api/src/state/platformStateStore.js";
import { platformOwnerKeyHash } from "../services/orchestrator-api/src/state/stateKeyHash.js";

let failed = false;

function fail(message: string): void {
  console.error(`fail - ${message}`);
  failed = true;
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
  }
}

function requireExcludes(source: string, phrase: string, context: string): void {
  if (source.includes(phrase)) {
    fail(`${context} should not include forbidden phrase: ${phrase}`);
  }
}

async function verifyInMemoryStoreCopies(): Promise<void> {
  const store = new InMemoryPlatformStateStore();
  const ownerKeyHash = platformOwnerKeyHash("owner-1");
  const record: StoredConnectorTrustRecord = {
    id: `tenant-1:${ownerKeyHash}:agent-1`,
    tenantId: "tenant-1",
    ownerKeyHash,
    connectorId: "jira",
    resourceSystem: "jira",
    agentId: "agent-1",
    issuer: "https://agent.example",
    audience: "secure-a2a-gateway",
    runtimeEndpoint: "https://agent.example/a2a/task",
    connectorProfileHash: "profile-hash",
    externalConfigHash: "config-hash",
    trustedAt: "2026-05-21T00:00:00.000Z",
    updatedAt: "2026-05-21T00:00:00.000Z",
    safeMetadata: {
      displayName: "Jira",
      nested: {
        proof: ["signed-response"]
      }
    }
  };

  await store.upsertConnectorTrustRecord(record);
  if (record.ownerKeyHash !== ownerKeyHash || record.id === record.agentId || !record.id.includes(ownerKeyHash)) {
    fail(`connector trust record should be owner-hash scoped: ${JSON.stringify(record)}`);
  }
  const firstRead = await store.listConnectorTrustRecords("owner-1");
  const nested = firstRead[0]?.safeMetadata.nested as { proof?: string[] } | undefined;
  nested?.proof?.push("mutated-after-read");

  const secondRead = await store.listConnectorTrustRecords("owner-1");
  const proof = (secondRead[0]?.safeMetadata.nested as { proof?: string[] } | undefined)?.proof ?? [];
  if (proof.includes("mutated-after-read")) {
    fail("in-memory platform state store should deep-clone nested safeMetadata on reads");
  }

  const inputNested = record.safeMetadata.nested as { proof?: string[] };
  inputNested.proof?.push("mutated-after-write");
  const thirdRead = await store.listConnectorTrustRecords("owner-1");
  const storedProof = (thirdRead[0]?.safeMetadata.nested as { proof?: string[] } | undefined)?.proof ?? [];
  if (storedProof.includes("mutated-after-write")) {
    fail("in-memory platform state store should deep-clone nested safeMetadata on writes");
  }
}

function verifyGeneratedConnectorTrustRecordId(): void {
  const ownerKeyHash = platformOwnerKeyHash("owner-2");
  const agent: TrustedOnboardedAgent = {
    agentId: "agent-2",
    issuer: "https://agent.example",
    clientId: "client-2",
    audience: "secure-a2a-gateway",
    requestedScopes: [],
    requestedApplicationGrants: [],
    agentDeclaredSkills: [],
    agentDeclaredCapabilities: [],
    applicationAccessGrants: [],
    grantedScopes: [],
    effectivePermissions: [],
    deniedPermissions: [],
    approvedActions: [],
    blockedActions: [],
    approvedCapabilities: [],
    blockedCapabilities: [],
    connectorProfileVerified: true,
    connectorDecisionSource: "verification",
    trustLevel: "trusted_metadata_only",
    executable: false,
    executionState: "metadata_only",
    tokenEndpointAuthMethod: "unknown",
    oauthApplicationBound: false
  };
  const record = toStoredConnectorTrustRecord("owner-2", agent);
  if (record.ownerKeyHash !== ownerKeyHash) {
    fail(`generated connector trust record should use ownerKeyHash: ${JSON.stringify(record)}`);
  }
  if (record.id === agent.agentId || !record.id.includes(record.tenantId ?? "") || !record.id.includes(ownerKeyHash) || !record.id.endsWith(`:${agent.agentId}`)) {
    fail(`generated connector trust record id should be tenant/owner/agent scoped: ${record.id}`);
  }
  if (Object.prototype.hasOwnProperty.call(record.safeMetadata, "ownerKey")) {
    fail("generated connector trust record safeMetadata must not include ownerKey");
  }
}

function verifySingleton(): void {
  const previousDriver = process.env.PLATFORM_STATE_STORE_DRIVER;
  process.env.PLATFORM_STATE_STORE_DRIVER = "memory";
  resetPlatformStateStoreForTests();
  const first = getPlatformStateStore();
  const second = getPlatformStateStore();
  if (first !== second) {
    fail("getPlatformStateStore should return one process-local singleton store");
  }
  resetPlatformStateStoreForTests();
  if (previousDriver === undefined) {
    delete process.env.PLATFORM_STATE_STORE_DRIVER;
  } else {
    process.env.PLATFORM_STATE_STORE_DRIVER = previousDriver;
  }
}

const trustedAgentStore = read("services/orchestrator-api/src/agentOnboarding/trustedAgentStore.ts");
const onboardingService = read("services/orchestrator-api/src/agentOnboarding/onboardingService.ts");
const packageJson = read("package.json");
const plan = read("docs/v2-platform-foundation.md");
const inventory = read("docs/v2-state-inventory.md");
const parsedPackageJson = JSON.parse(packageJson) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

for (const phrase of [
  "getPlatformStateStore",
  "StoredConnectorTrustRecord",
  "toStoredConnectorTrustRecord",
  "fromStoredConnectorTrustRecord",
  "persistTrustedOnboardedAgent",
  "upsertConnectorTrustRecord",
  "safeMetadata",
  "platformOwnerKeyHash",
  "ownerKeyHash",
  "id: `${tenantId}:${ownerKeyHash}:${agent.agentId}`"
]) {
  requireIncludes(trustedAgentStore, phrase, "trusted agent platform state mapping");
}

for (const phrase of [
  "persistTrustedOnboardedAgent",
  "await persistTrustedOnboardedAgent(ownerKey, trustedAgent)"
]) {
  requireIncludes(onboardingService, phrase, "agent onboarding success path");
}

for (const phrase of [
  '"verify:platform-state-onboarding": "tsx scripts/verify-platform-state-onboarding.ts"',
  "verify:platform-state-onboarding"
]) {
  requireIncludes(packageJson, phrase, "package scripts");
}

for (const phrase of [
  "Phase 2.1: route installed connector trust registry through `PlatformStateStore`",
  "Phase 2.1: preserve existing in-memory local mode",
  "Phase 2.1: verify onboarding success writes safe connector trust records",
  "npm run verify:platform-state-onboarding"
]) {
  requireIncludes(plan, phrase, "V2 platform foundation doc");
}

for (const phrase of [
  "Phase 2.1 starts routing connector trust records through `PlatformStateStore`",
  "memory driver remains active",
  "process restart still loses data"
]) {
  requireIncludes(inventory, phrase, "V2 state inventory");
}

for (const forbidden of ["access_token", "refresh_token", "Authorization", "Bearer", "private_key", "client_secret", "client_assertion", "authorization_code"]) {
  requireExcludes(trustedAgentStore, forbidden, "trusted agent platform state mapping");
}

for (const forbidden of ["\n    id: agent.agentId,", "    ownerKey,"]) {
  requireExcludes(trustedAgentStore, forbidden, "trusted agent platform state mapping");
}

const safeMetadataStart = trustedAgentStore.indexOf("safeMetadata: {");
const safeMetadataEnd = safeMetadataStart >= 0 ? trustedAgentStore.indexOf("\n    }\n  };", safeMetadataStart) : -1;
const trustedAgentSafeMetadata = safeMetadataStart >= 0 && safeMetadataEnd > safeMetadataStart
  ? trustedAgentStore.slice(safeMetadataStart, safeMetadataEnd)
  : "";
if (!trustedAgentSafeMetadata) {
  fail("trusted agent platform state mapping should expose a safeMetadata block for verification");
} else {
  requireExcludes(trustedAgentSafeMetadata, "ownerKey", "trusted agent safeMetadata");
}

const dependencyNames = Object.keys({
  ...(parsedPackageJson.dependencies ?? {}),
  ...(parsedPackageJson.devDependencies ?? {})
});
for (const forbidden of ["prisma", "drizzle"]) {
  if (dependencyNames.some((name) => name.toLowerCase().includes(forbidden))) {
    fail(`Platform state onboarding should not introduce ORM dependency: ${forbidden}`);
  }
}

if (!parsedPackageJson.scripts?.["verify:v2-plan"]?.includes("verify:platform-state-onboarding")) {
  fail("verify:v2-plan should include verify:platform-state-onboarding");
}

async function main(): Promise<void> {
  await verifyInMemoryStoreCopies();
  verifyGeneratedConnectorTrustRecordId();
  verifySingleton();

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log("Platform state onboarding verification passed.");
  }
}

void main();
