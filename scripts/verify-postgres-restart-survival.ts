import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { Pool } from "pg";
import { fromStoredConnectorTrustRecord } from "../services/orchestrator-api/src/agentOnboarding/trustedAgentStore.js";
import { closePlatformStateStoreForTests, getPlatformStateStore } from "../services/orchestrator-api/src/state/createPlatformStateStore.js";
import type { StoredAuditEvent, StoredConnectorTrustRecord, StoredConversationStateRecord } from "../services/orchestrator-api/src/state/platformStateStore.js";
import { platformOwnerKeyHash } from "../services/orchestrator-api/src/state/stateKeyHash.js";
import { defaultTenantId } from "../services/orchestrator-api/src/tenant/tenantContext.js";

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
  if (source.toLowerCase().includes(phrase.toLowerCase())) {
    fail(`${context} should not include forbidden phrase: ${phrase}`);
    return;
  }
  ok(context);
}

function assertNoForbiddenKeys(value: unknown, context: string): void {
  const forbidden = [
    "access_token",
    "refresh_token",
    "authorization",
    "jwt",
    "password",
    "client_secret",
    "private_key"
  ];
  const visit = (item: unknown): string | undefined => {
    if (!item || typeof item !== "object") {
      return undefined;
    }
    if (Array.isArray(item)) {
      for (const entry of item) {
        const match = visit(entry);
        if (match) {
          return match;
        }
      }
      return undefined;
    }
    for (const [key, entry] of Object.entries(item)) {
      const normalizedKey = key.toLowerCase();
      const match = forbidden.find((marker) => normalizedKey.includes(marker));
      if (match) {
        return match;
      }
      const nested = visit(entry);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  };
  const match = visit(value);
  if (match) {
    fail(`${context} should not include forbidden key marker ${match}`);
    return;
  }
  ok(`${context} contains no forbidden token/password key markers`);
}

function staticVerification(): void {
  const platformStateStore = read("services/orchestrator-api/src/state/platformStateStore.ts");
  const postgresStore = read("services/orchestrator-api/src/state/postgresPlatformStateStore.ts");
  const createStore = read("services/orchestrator-api/src/state/createPlatformStateStore.ts");
  const trustedStore = read("services/orchestrator-api/src/agentOnboarding/trustedAgentStore.ts");
  const connectorRouting = read("services/orchestrator-api/src/connectorRouting.ts");
  const restartSmoke = read("scripts/verify-postgres-restart-survival.ts");
  const migrations = readdirSync("services/orchestrator-api/db/migrations")
    .filter((file) => file.endsWith(".sql"))
    .map((file) => read(`services/orchestrator-api/db/migrations/${file}`))
    .join("\n");
  const schema = read("services/orchestrator-api/db/schema.sql");
  const migrationRunner = read("scripts/apply-platform-migrations.ts");

  for (const phrase of [
    "upsertConnectorTrustRecord",
    "listConnectorTrustRecords",
    "appendAuditEvent",
    "listAuditEvents",
    "upsertConversationState",
    "getConversationState",
    "findUserByEmail",
    "bindUserIdentity"
  ]) {
    requireIncludes(postgresStore, phrase, "PostgresPlatformStateStore implements restart-survival methods");
  }

  requireIncludes(platformStateStore, "close?(): Promise<void>;", "PlatformStateStore exposes optional close");
  requireIncludes(postgresStore, "async close(): Promise<void>", "PostgresPlatformStateStore implements close");
  requireIncludes(postgresStore, "await this.pool.end()", "PostgresPlatformStateStore closes its pool");
  requireIncludes(createStore, "export async function closePlatformStateStoreForTests", "async close/reset helper exists");
  requireIncludes(createStore, "await store.close()", "async close/reset helper closes cached store");
  requireIncludes(restartSmoke, "await closePlatformStateStoreForTests()", "restart smoke awaits close/reset helper");
  if (new RegExp("resetPlatformStateStoreForTests\\s*\\(").test(restartSmoke)) {
    fail("restart smoke should not rely on the sync reset helper");
  } else {
    ok("restart smoke does not rely on sync reset");
  }
  requireIncludes(trustedStore, "export async function listTrustedOnboardedAgentsForOwner", "trusted store exports read-through helper");
  requireIncludes(trustedStore, 'runtimeTrustSource: "stored_metadata"', "stored connector hydration marks stored metadata");
  requireIncludes(trustedStore, "rehydratedFromStore: true", "stored connector hydration marks rehydrated records");
  requireIncludes(connectorRouting, 'agent.runtimeTrustSource === "stored_metadata"', "routing checks stored metadata source");
  requireIncludes(connectorRouting, "agent.rehydratedFromStore === true", "routing checks rehydration marker");
  requireIncludes(connectorRouting, "const runtimeAvailable = !persistedMetadataOnly && isConnectorRuntimeEndpointAllowed(onboarded.runtimeEndpoint)", "routing prevents stored metadata runtime availability");
  requireIncludes(migrationRunner, "platform_schema_migrations", "migration runner exists and tracks applied migrations");
  requireIncludes(migrations, "create table if not exists connector_trust_records", "migrations include connector trust schema");

  for (const file of [
    "001_initial_platform_state.sql",
    "002_connector_trust_owner_hash.sql",
    "003_user_directory_access_gate.sql",
    "004_audit_event_classification_index.sql"
  ]) {
    if (!existsSync(`services/orchestrator-api/db/migrations/${file}`)) {
      fail(`${file} should exist`);
    } else {
      ok(`${file} exists`);
    }
  }

  for (const forbidden of [
    "access_token",
    "refresh_token",
    "authorization_code",
    "client_secret",
    "private_key",
    "client_assertion",
    "password",
    "password_hash"
  ]) {
    requireNotIncludes(`${schema}\n${migrations}`, forbidden, "schema and migrations");
  }
}

function applyMigrations(): boolean {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd run db:apply-platform-migrations"]
    : ["run", "db:apply-platform-migrations"];
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env
  });
  if (result.status !== 0) {
    fail("Platform migrations must be applied before restart-survival write smoke.");
    return false;
  }
  return true;
}

async function upsertSmokeUser(params: {
  suffix: string;
  email: string;
  now: string;
}): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
  });
  try {
    await pool.query(
      `insert into tenants (id, name, status, created_at, updated_at)
       values ($1, $2, 'active', $3, $3)
       on conflict (id) do nothing`,
      [defaultTenantId(), "Default", params.now]
    );
    await pool.query(
      `insert into users (
        id, tenant_id, provider, issuer, subject, email, display_name, roles, status, created_at, updated_at
      ) values ($1, $2, $3, $4, $5, lower($6), $7, $8::jsonb, 'active', $9, $9)
      on conflict (tenant_id, lower(email)) do update set
        provider = excluded.provider,
        issuer = excluded.issuer,
        subject = excluded.subject,
        display_name = excluded.display_name,
        roles = excluded.roles,
        status = 'active',
        updated_at = excluded.updated_at`,
      [
        `smoke_restart_user_${params.suffix}`,
        defaultTenantId(),
        "auth0",
        "https://smoke.example/",
        `smoke-subject-${params.suffix}`,
        params.email,
        "Smoke Restart User",
        JSON.stringify(["smoke"]),
        params.now
      ]
    );
  } finally {
    await pool.end();
  }
}

async function runtimeSmoke(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("DATABASE_URL not set; skipping Postgres restart-survival integration check.");
    return;
  }

  if (process.env.POSTGRES_RESTART_SMOKE_ALLOW_WRITE !== "true") {
    console.log("POSTGRES_RESTART_SMOKE_ALLOW_WRITE is not true; skipping write smoke.");
    return;
  }

  if (!applyMigrations()) {
    return;
  }

  const previousDriver = process.env.PLATFORM_STATE_STORE_DRIVER;
  process.env.PLATFORM_STATE_STORE_DRIVER = "postgres";
  await closePlatformStateStoreForTests();

  const suffix = `${Date.now()}_${randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();
  const tenantId = defaultTenantId();
  const ownerKey = `smoke-owner-${suffix}`;
  const ownerKeyHash = platformOwnerKeyHash(ownerKey);
  const agentId = `smoke-agent-${suffix}`;
  const email = `smoke-${suffix}@gateway.test`;

  const connectorRecord: StoredConnectorTrustRecord = {
    id: `${tenantId}:${ownerKeyHash}:${agentId}`,
    tenantId,
    ownerKeyHash,
    connectorId: "jira-reference",
    resourceSystem: "jira",
    agentId,
    issuer: "https://smoke-agent.example/",
    audience: "secure-a2a-gateway",
    runtimeEndpoint: "http://localhost:4201/a2a/task",
    connectorProfileHash: `smoke-profile-hash-${suffix}`,
    externalConfigHash: `smoke-config-hash-${suffix}`,
    trustedAt: now,
    updatedAt: now,
    safeMetadata: {
      displayName: "Smoke Jira Connector",
      approvedActions: [{
        capability: "jira.issue.status.lookup",
        label: "Look up Jira issue status",
        reason: "Smoke safe metadata."
      }],
      blockedActions: [],
      connectorProfile: {
        connectorId: "jira-reference",
        resourceSystem: "jira",
        displayName: "Smoke Jira Connector",
        version: "smoke",
        profileSource: "built_in_reference"
      },
      connectorProfileVerified: true,
      tokenEndpointAuthMethod: "private-key-jwt",
      oauthApplicationBound: true
    }
  };

  const auditEvent: StoredAuditEvent = {
    id: `smoke-audit-${suffix}`,
    tenantId,
    actorProvider: "auth0",
    actorSubject: "smoke-subject",
    actorEmail: email,
    eventType: "smoke.restart_survival",
    resourceType: "smoke",
    resourceId: suffix,
    createdAt: now,
    safeMetadata: {
      protectedMaterialExposed: false,
      tokenMaterialStored: false,
      smoke: true
    }
  };

  const conversationState: StoredConversationStateRecord = {
    id: `smoke-conversation-${suffix}`,
    tenantId,
    actorProvider: "auth0",
    actorSubject: "smoke-subject",
    actorEmail: email,
    ownerSessionHash: `smoke-owner-session-hash-${suffix}`,
    createdAt: now,
    updatedAt: now,
    lastResolutionStatus: "resolved",
    needsMoreInfoCount: 0,
    messages: [{
      role: "user",
      timestamp: now,
      safeSummary: "Synthetic smoke request summary."
    }, {
      role: "assistant",
      timestamp: now,
      safeSummary: "Synthetic smoke response summary."
    }],
    lastRequestInterpretation: {
      scope: "smoke",
      intentType: "restart_survival",
      confidence: "high"
    },
    safeMetadata: {
      smoke: true,
      protectedMaterialExposed: false
    }
  };

  assertNoForbiddenKeys(connectorRecord.safeMetadata, "connector trust smoke metadata");
  assertNoForbiddenKeys(auditEvent.safeMetadata, "audit smoke metadata");
  assertNoForbiddenKeys(conversationState.safeMetadata, "conversation smoke metadata");

  try {
    const writeStore = getPlatformStateStore();
    await writeStore.upsertConnectorTrustRecord(connectorRecord);
    await writeStore.appendAuditEvent(auditEvent);
    await writeStore.upsertConversationState(conversationState);
    await upsertSmokeUser({ suffix, email, now });

    await closePlatformStateStoreForTests();
    const readStore = getPlatformStateStore();

    const connectorRecords = await readStore.listConnectorTrustRecords(ownerKey);
    const returnedConnector = connectorRecords.find((record) => record.id === connectorRecord.id);
    if (!returnedConnector) {
      fail("connector trust record should survive store recreation");
    } else {
      ok("connector trust record survived store recreation");
      if (JSON.stringify(returnedConnector).includes(ownerKey)) {
        fail("connector trust record must not expose raw owner key");
      } else {
        ok("connector trust record does not expose raw owner key");
      }
      const hydrated = fromStoredConnectorTrustRecord(returnedConnector);
      if (
        hydrated.agentId !== agentId ||
        hydrated.connectorId !== "jira-reference" ||
        hydrated.resourceSystem !== "jira" ||
        hydrated.approvedActions[0]?.capability !== "jira.issue.status.lookup" ||
        hydrated.runtimeTrustSource !== "stored_metadata" ||
        hydrated.rehydratedFromStore !== true ||
        hydrated.executionState !== "metadata_only" ||
        hydrated.executable !== false
      ) {
        fail("hydrated connector trust metadata should survive with metadata-only semantics");
      } else {
        ok("hydrated connector trust metadata survived with metadata-only semantics");
      }
    }

    const auditEvents = await readStore.listAuditEvents({ tenantId, resourceType: "smoke", resourceId: suffix, limit: 10 });
    const returnedAudit = auditEvents.find((event) => event.id === auditEvent.id);
    if (!returnedAudit || returnedAudit.safeMetadata.smoke !== true || returnedAudit.safeMetadata.tokenMaterialStored !== false) {
      fail("audit event should survive store recreation with safe metadata");
    } else {
      ok("audit event survived store recreation with safe metadata");
      assertNoForbiddenKeys(returnedAudit.safeMetadata, "returned audit metadata");
    }

    const returnedConversation = await readStore.getConversationState(conversationState.id);
    if (
      !returnedConversation ||
      returnedConversation.lastResolutionStatus !== "resolved" ||
      returnedConversation.safeMetadata.smoke !== true
    ) {
      fail("conversation state should survive store recreation with safe metadata");
    } else {
      ok("conversation state survived store recreation with safe metadata");
      assertNoForbiddenKeys(returnedConversation.safeMetadata, "returned conversation metadata");
    }

    const returnedUser = await readStore.findUserByEmail({ tenantId, email });
    if (!returnedUser || returnedUser.status !== "active" || !returnedUser.roles.includes("smoke")) {
      fail("user directory record should survive store recreation");
    } else {
      ok("user directory record survived store recreation");
      assertNoForbiddenKeys(returnedUser, "returned smoke user");
      for (const forbidden of ["password", "passwordHash", "accessToken", "refreshToken"]) {
        if (forbidden in returnedUser) {
          fail(`smoke user should not contain ${forbidden}`);
        }
      }
    }
  } finally {
    await closePlatformStateStoreForTests();
    if (previousDriver === undefined) {
      delete process.env.PLATFORM_STATE_STORE_DRIVER;
    } else {
      process.env.PLATFORM_STATE_STORE_DRIVER = previousDriver;
    }
  }
}

async function main(): Promise<void> {
  staticVerification();
  await runtimeSmoke();

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log("Postgres restart-survival verification passed.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
