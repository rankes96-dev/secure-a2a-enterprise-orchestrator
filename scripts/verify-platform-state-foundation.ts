import { existsSync, readFileSync } from "node:fs";

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

const plan = read("docs/v2-platform-foundation.md");
const inventory = read("docs/v2-state-inventory.md");
const platformStateStore = read("services/orchestrator-api/src/state/platformStateStore.ts");
const inMemoryStore = read("services/orchestrator-api/src/state/inMemoryPlatformStateStore.ts");
const factory = read("services/orchestrator-api/src/state/createPlatformStateStore.ts");
const packageJson = read("package.json");
const parsedPackageJson = JSON.parse(packageJson) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

for (const phrase of [
  "Phase 2.0  Persistent State Foundation / Store Boundary",
  "Inventory all current in-memory platform state",
  "durable Postgres candidate",
  "short-lived Redis/cache candidate",
  "local-only/dev-only state",
  "PlatformStateStore",
  "InMemoryPlatformStateStore",
  "no DB migration in this checkpoint",
  "no token vault implementation",
  "no real vendor OAuth persistence",
  "no replacement of Upstash",
  "no removal of in-memory local mode",
  "defensively clone stored safe metadata",
  "process-local singleton accessor",
  "npm run verify:platform-state-foundation",
  "does not implement a database yet"
]) {
  requireIncludes(plan, phrase, "V2 platform foundation doc");
}

for (const phrase of [
  "conversations",
  "userIdentitiesBySession",
  "trusted/onboarded connector agents",
  "audit/security timeline events",
  "audit events",
  "pending interactions",
  "runtime executions",
  "Redis / Upstash",
  "Postgres",
  "defensive deep copies",
  "singleton store accessor",
  "no raw tokens"
]) {
  requireIncludes(inventory, phrase, "V2 state inventory");
}

for (const phrase of [
  "PlatformStateStore",
  "StoredConnectorTrustRecord",
  "StoredAuditEvent",
  "listConnectorTrustRecords",
  "upsertConnectorTrustRecord",
  "appendAuditEvent",
  "safeMetadata"
]) {
  requireIncludes(platformStateStore, phrase, "platform state store interface");
}

for (const phrase of [
  "InMemoryPlatformStateStore",
  "new Map<string, StoredConnectorTrustRecord[]>",
  "auditEvents: StoredAuditEvent[]",
  "structuredClone",
  "deepClone",
  "cloneSafeMetadata",
  "copyConnectorTrustRecord",
  "copyAuditEvent"
]) {
  requireIncludes(inMemoryStore, phrase, "in-memory platform state store");
}

for (const forbidden of ["safeMetadata: { ...record.safeMetadata }", "safeMetadata: { ...event.safeMetadata }"]) {
  if (inMemoryStore.includes(forbidden)) {
    fail(`in-memory platform state store should not rely on shallow safeMetadata copy: ${forbidden}`);
  }
}

for (const phrase of [
  'process.env.PLATFORM_STATE_STORE_DRIVER ?? "memory"',
  'driver === "memory"',
  'driver === "postgres"',
  "planned but not implemented in this checkpoint",
  "createPlatformStateStore",
  "cachedPlatformStateStore",
  "getPlatformStateStore",
  "cachedPlatformStateStore ??= createPlatformStateStore()"
]) {
  requireIncludes(factory, phrase, "platform state store factory");
}

requireIncludes(packageJson, '"verify:platform-state-foundation": "tsx scripts/verify-platform-state-foundation.ts"', "package scripts");

const stateSources = [platformStateStore, inMemoryStore, factory].join("\n");
for (const forbidden of ["access_token", "refresh_token", "Authorization", "private_key", "client_secret"]) {
  if (stateSources.includes(forbidden)) {
    fail(`platform state source should not include dangerous field marker: ${forbidden}`);
  }
}

for (const forbidden of ["token", "secret", "credential"]) {
  if (platformStateStore.toLowerCase().includes(forbidden)) {
    fail(`platform state store types should not add token-specific field marker: ${forbidden}`);
  }
}

const dependencyNames = Object.keys({
  ...(parsedPackageJson.dependencies ?? {}),
  ...(parsedPackageJson.devDependencies ?? {})
});
for (const forbidden of ["prisma", "drizzle", "pg", "postgres"]) {
  if (dependencyNames.some((name) => name.toLowerCase().includes(forbidden))) {
    fail(`Phase 2.0 should not introduce DB dependency: ${forbidden}`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Platform state foundation verification passed.");
}
