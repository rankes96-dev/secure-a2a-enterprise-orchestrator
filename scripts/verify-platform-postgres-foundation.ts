import { existsSync, readFileSync } from "node:fs";
import { createPlatformStateStore, resetPlatformStateStoreForTests } from "../services/orchestrator-api/src/state/createPlatformStateStore";
import { PostgresPlatformStateStore } from "../services/orchestrator-api/src/state/postgresPlatformStateStore";

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
  if (source.toLowerCase().includes(phrase.toLowerCase())) {
    fail(`${context} must not include forbidden phrase: ${phrase}`);
  }
}

function withEnv<T>(env: Record<string, string | undefined>, action: () => T | Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return Promise.resolve()
    .then(action)
    .finally(() => {
      for (const [key, value] of previous) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      resetPlatformStateStoreForTests();
    });
}

const schema = read("services/orchestrator-api/db/schema.sql");
const applySchema = read("scripts/apply-platform-schema.ts");
const postgresStore = read("services/orchestrator-api/src/state/postgresPlatformStateStore.ts");
const factory = read("services/orchestrator-api/src/state/createPlatformStateStore.ts");
const config = read("services/orchestrator-api/src/state/postgresConfig.ts");
const platformTypes = read("services/orchestrator-api/src/state/platformStateStore.ts");
const stateKeyHash = read("services/orchestrator-api/src/state/stateKeyHash.ts");
const trustedAgentStore = read("services/orchestrator-api/src/agentOnboarding/trustedAgentStore.ts");
const tenantContext = read("services/orchestrator-api/src/tenant/tenantContext.ts");
const packageJson = read("package.json");
const plan = read("docs/v2-platform-foundation.md");
const inventory = read("docs/v2-state-inventory.md");
const deployment = read("docs/deployment.md");

for (const table of [
  "tenants",
  "users",
  "connector_trust_records",
  "audit_events",
  "conversation_states",
  "runtime_executions"
]) {
  requireIncludes(schema, `create table if not exists ${table}`, "platform schema");
}

for (const phrase of [
  "safe_metadata jsonb not null default '{}'::jsonb",
  "owner_key_hash text not null",
  "unique (tenant_id, owner_key_hash, agent_id)",
  "users_tenant_provider_subject_idx",
  "connector_trust_records_owner_key_hash_idx",
  "connector_trust_records_tenant_id_idx",
  "audit_events_tenant_created_at_idx",
  "audit_events_actor_subject_created_at_idx",
  "conversation_states_actor_subject_updated_at_idx",
  "conversation_states_tenant_updated_at_idx"
]) {
  requireIncludes(schema, phrase, "platform schema");
}

for (const forbidden of [
  "owner_key text",
  "session_token",
  "raw_session",
  "access_token",
  "refresh_token",
  "authorization_code",
  "client_secret",
  "private_key",
  "client_assertion",
  "password",
  "encrypted_access_token",
  "encrypted_refresh_token"
]) {
  requireExcludes(schema, forbidden, "platform schema");
}

for (const phrase of [
  "DATABASE_URL",
  "Applying platform schema...",
  "Platform schema applied.",
  "new Pool",
  "pool.query(schema)"
]) {
  requireIncludes(applySchema, phrase, "schema apply script");
}
for (const forbidden of ["console.log(databaseUrl", "console.info(databaseUrl", "console.error(databaseUrl"]) {
  requireExcludes(applySchema, forbidden, "schema apply script");
}

for (const phrase of [
  'import { createHash } from "node:crypto";',
  "platformOwnerKeyHash",
  'createHash("sha256").update(ownerKey).digest("hex")'
]) {
  requireIncludes(stateKeyHash, phrase, "platform owner key hashing helper");
}

for (const phrase of [
  "PostgresPlatformStateStore",
  "health()",
  "appendAuditEvent",
  "listAuditEvents",
  "upsertConnectorTrustRecord",
  "listConnectorTrustRecords",
  "deleteConnectorTrustRecord",
  "upsertConversationState",
  "getConversationState",
  "listConversationStates",
  "$1",
  "$2",
  "JSON.stringify(record.safeMetadata)",
  "JSON.stringify(event.safeMetadata)",
  "recordFromJson",
  "arrayFromJson",
  "platformOwnerKeyHash",
  "const ownerKeyHash = platformOwnerKeyHash(ownerKey);",
  "where owner_key_hash = $1",
  "record.ownerKeyHash",
  "delete from connector_trust_records where owner_key_hash = $1 and id = $2"
]) {
  requireIncludes(postgresStore, phrase, "Postgres platform state store");
}

for (const forbidden of [
  "owner_key = $1",
  "owner_key = excluded.owner_key",
  "record.ownerKey,",
  " access_token",
  " refresh_token",
  "authorization_code",
  "client_secret",
  "private_key",
  "client_assertion"
]) {
  requireExcludes(postgresStore, forbidden, "Postgres platform state store");
}

for (const phrase of [
  "platformOwnerKeyHash",
  "const tenantId = defaultTenantId();",
  "const ownerKeyHash = platformOwnerKeyHash(ownerKey);",
  "id: `${tenantId}:${ownerKeyHash}:${agent.agentId}`",
  "ownerKeyHash,"
]) {
  requireIncludes(trustedAgentStore, phrase, "trusted agent platform state mapping");
}

for (const forbidden of [
  "\n    id: agent.agentId,",
  "    ownerKey,"
]) {
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

for (const phrase of [
  'process.env.PLATFORM_STATE_STORE_DRIVER?.trim() || "memory"',
  "PLATFORM_STATE_STORE_DRIVER=postgres requires DATABASE_URL",
  "databaseUrl",
  "ssl"
]) {
  requireIncludes(config, phrase, "Postgres config");
}

for (const phrase of [
  "PostgresPlatformStateStore",
  'driver === "memory"',
  'driver === "postgres"',
  "return new InMemoryPlatformStateStore()",
  "return new PostgresPlatformStateStore()",
  "Unsupported PLATFORM_STATE_STORE_DRIVER",
  "cachedPlatformStateStore"
]) {
  requireIncludes(factory, phrase, "platform state store factory");
}

for (const phrase of [
  "tenantId?: string",
  "StoredConnectorTrustRecord",
  "StoredAuditEvent",
  "StoredConversationStateRecord"
]) {
  requireIncludes(platformTypes, phrase, "platform state store types");
}

for (const phrase of [
  "TenantContext",
  "defaultTenantId",
  "DEFAULT_TENANT_ID",
  '"default"'
]) {
  requireIncludes(tenantContext, phrase, "tenant context helper");
}

for (const phrase of [
  '"pg"',
  '"@types/pg"',
  '"db:apply-platform-schema": "tsx scripts/apply-platform-schema.ts"',
  '"verify:platform-postgres-foundation": "tsx scripts/verify-platform-postgres-foundation.ts"',
  "verify:security-scan-p1 && npm run verify:platform-postgres-foundation"
]) {
  requireIncludes(packageJson, phrase, "package scripts and dependencies");
}

for (const phrase of [
  "Phase 2.6  Tenant-Aware Postgres Schema Foundation",
  "PLATFORM_STATE_STORE_DRIVER=postgres",
  "memory remains default",
  "tenants",
  "users",
  "connector_trust_records",
  "audit_events",
  "conversation_states",
  "runtime_executions",
  "no raw token material"
]) {
  requireIncludes(plan, phrase, "V2 platform foundation docs");
}

for (const phrase of [
  "initial Postgres schema",
  "runtime may still use memory",
  "PLATFORM_STATE_STORE_DRIVER=postgres"
]) {
  requireIncludes(inventory, phrase, "state inventory docs");
}

for (const phrase of [
  "DATABASE_URL",
  "DATABASE_SSL",
  "PLATFORM_STATE_STORE_DRIVER=postgres",
  "optional"
]) {
  requireIncludes(deployment, phrase, "deployment docs");
}

async function main(): Promise<void> {
  await withEnv({
    PLATFORM_STATE_STORE_DRIVER: "memory",
    DATABASE_URL: undefined
  }, async () => {
    const store = createPlatformStateStore();
    const health = await store.health();
    if (health.driver !== "memory" || !health.ready) {
      fail(`memory store should remain the default working store: ${JSON.stringify(health)}`);
    }

    await store.appendAuditEvent({
      id: "audit-1",
      tenantId: "tenant-1",
      eventType: "verification.event",
      createdAt: "2026-05-24T00:00:00.000Z",
      safeMetadata: { safe: true }
    });
    const events = await store.listAuditEvents({ tenantId: "tenant-1", limit: 10 });
    if (events.length !== 1 || events[0]?.safeMetadata.safe !== true) {
      fail(`memory audit write/read should still work: ${JSON.stringify(events)}`);
    }
  });

  if (process.env.DATABASE_URL?.trim()) {
    await withEnv({
      PLATFORM_STATE_STORE_DRIVER: "postgres"
    }, async () => {
      const store = new PostgresPlatformStateStore();
      const health = await store.health();
      if (health.driver !== "postgres" || !health.ready) {
        fail(`Postgres health should pass when DATABASE_URL is configured: ${JSON.stringify(health)}`);
      }
    });
  } else {
    console.log("DATABASE_URL not set; skipping Postgres integration check.");
  }

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log("Platform Postgres foundation verification passed.");
  }
}

main().catch((error) => {
  console.error(`fail - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
