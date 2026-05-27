import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

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

function requireRegex(source: string, pattern: RegExp, context: string): void {
  if (!pattern.test(source)) {
    fail(`${context} missing required pattern: ${pattern}`);
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

function requireBefore(source: string, first: string, second: string, context: string): void {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex > secondIndex) {
    fail(`${context} should contain ${first} before ${second}`);
    return;
  }
  ok(context);
}

function blockBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start < 0) {
    fail(`missing block start: ${startMarker}`);
    return "";
  }
  const end = source.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

function validSchemaName(value: string): boolean {
  return /^[a-z][a-z0-9_]{0,62}$/.test(value);
}

function databaseUrlWithSearchPath(databaseUrl: string, schemaName: string): string {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.set("options", `-c search_path=${schemaName}`);
  return parsed.toString();
}

function verifyStatic(): void {
  const migrationsDir = join(process.cwd(), "services", "orchestrator-api", "db", "migrations");
  if (!existsSync(migrationsDir)) {
    fail("migrations directory should exist");
    return;
  }
  ok("migrations directory exists");

  const migrationFiles = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  for (const name of [
    "001_initial_platform_state.sql",
    "002_connector_trust_owner_hash.sql",
    "003_user_directory_access_gate.sql",
    "004_audit_event_classification_index.sql"
  ]) {
    if (!migrationFiles.includes(name)) {
      fail(`${name} should exist`);
    } else {
      ok(`${name} exists`);
    }
  }

  const initial = read("services/orchestrator-api/db/migrations/001_initial_platform_state.sql");
  const ownerHash = read("services/orchestrator-api/db/migrations/002_connector_trust_owner_hash.sql");
  const userDirectory = read("services/orchestrator-api/db/migrations/003_user_directory_access_gate.sql");
  const auditClassification = read("services/orchestrator-api/db/migrations/004_audit_event_classification_index.sql");
  const auditClassificationContract = read("services/orchestrator-api/db/contract-migrations/005_audit_event_classification_contract.sql");
  const allMigrations = `${initial}\n${ownerHash}\n${userDirectory}\n${auditClassification}\n${auditClassificationContract}`;
  const runner = read("scripts/apply-platform-migrations.ts");
  const packageJson = read("package.json");
  const platformDocs = read("docs/v2-platform-foundation.md");
  const deploymentDocs = read("docs/deployment.md");

  for (const phrase of [
    "create table if not exists tenants",
    "create table if not exists users",
    "create table if not exists connector_trust_records",
    "create table if not exists audit_events",
    "create table if not exists conversation_states",
    "create table if not exists runtime_executions",
    "alter table connector_trust_records",
    "add column if not exists owner_key_hash text",
    "owner_key_hash text not null",
    "unique (tenant_id, owner_key_hash, agent_id)"
  ]) {
    requireIncludes(initial, phrase, "initial migration current platform schema");
  }
  requireBefore(
    initial,
    "add column if not exists owner_key_hash text",
    "connector_trust_records_owner_key_hash_idx",
    "initial migration prepares owner_key_hash before dependent index"
  );

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
    requireNotIncludes(allMigrations, forbidden, "platform migrations forbidden columns");
  }

  requireIncludes(ownerHash, "add column if not exists owner_key_hash text", "connector trust migration adds owner_key_hash");
  requireIncludes(ownerHash, "digest(owner_key, ''sha256'')", "connector trust migration hashes legacy owner_key when pgcrypto is available");
  requireIncludes(ownerHash, "requires manual migration to owner_key_hash", "connector trust migration fails clearly without hash support");
  requireIncludes(ownerHash, "drop column owner_key", "connector trust migration drops legacy owner_key");
  requireIncludes(ownerHash, "alter column owner_key_hash set not null", "connector trust migration enforces owner_key_hash not null");
  requireIncludes(ownerHash, "connector_trust_records_owner_key_hash_idx", "connector trust migration ensures owner_key_hash index");
  requireNotIncludes(ownerHash, "owner_key text not null", "connector trust migration does not retain raw owner_key");

  requireIncludes(userDirectory, "add column if not exists status text not null default 'active'", "user migration adds status");
  requireIncludes(userDirectory, "alter column subject drop not null", "user migration makes subject nullable");
  requireIncludes(userDirectory, "alter column provider drop not null", "user migration makes provider nullable");
  requireIncludes(userDirectory, "users.email contains null values; seed/update users before enforcing user directory access", "user migration fails safely for blank email");
  requireIncludes(userDirectory, "alter column email set not null", "user migration enforces email");
  requireIncludes(userDirectory, "users_tenant_email_idx", "user migration creates email index");
  requireIncludes(userDirectory, "users_tenant_provider_issuer_subject_idx", "user migration creates provider binding index");

  for (const phrase of [
    "add column if not exists outcome text",
    "add column if not exists severity text",
    "audit_event_outcome_for_event_type",
    "audit_event_severity_for_event_type",
    "audit_events_materialize_classification",
    "audit_events_materialize_classification_trigger",
    "coalesce(outcome, audit_event_outcome_for_event_type(event_type))",
    "coalesce(severity, audit_event_severity_for_event_type(event_type))",
    "audit_events_outcome_check",
    "audit_events_severity_check",
    "not valid",
    "validate constraint audit_events_outcome_check",
    "validate constraint audit_events_severity_check",
    "audit_events_tenant_created_at_id_idx",
    "audit_events_tenant_outcome_created_at_id_idx",
    "audit_events_tenant_severity_created_at_id_idx",
    "audit_events_tenant_outcome_severity_created_at_id_idx"
  ]) {
    requireIncludes(auditClassification, phrase, "audit classification migration creates materialized read model");
  }
  for (const forbidden of [
    "alter column outcome set not null",
    "alter column severity set not null"
  ]) {
    requireNotIncludes(auditClassification, forbidden, "audit classification expand migration remains rolling-safe");
  }
  for (const phrase of [
    "null outcome/severity rows remain",
    "alter column outcome set not null",
    "alter column severity set not null"
  ]) {
    requireIncludes(auditClassificationContract, phrase, "audit classification contract migration enforces only after validation");
  }

  requireIncludes(runner, "platform_schema_migrations", "migration runner creates tracking table");
  requireIncludes(runner, "createHash(\"sha256\")", "migration runner computes checksum");
  requireIncludes(runner, "Checksum mismatch for platform migration", "migration runner detects checksum mismatch");
  requireRegex(runner, /\.sort\(\(left, right\) => left\.localeCompare\(right\)\)/, "migration runner sorts migrations");
  requireIncludes(runner, "await client.query(\"begin\")", "migration runner starts transactions");
  requireIncludes(runner, "await client.query(\"commit\")", "migration runner commits transactions");
  requireIncludes(runner, "await client.query(\"rollback\")", "migration runner rolls back transactions");
  requireNotIncludes(runner, "console.log(databaseUrl", "migration runner does not print database URL");
  requireNotIncludes(runner, "console.error(databaseUrl", "migration runner does not print database URL in errors");

  const parsedPackageJson = JSON.parse(packageJson) as { scripts?: Record<string, string> };
  if (parsedPackageJson.scripts?.["db:apply-platform-migrations"] !== "tsx scripts/apply-platform-migrations.ts") {
    fail("package.json should include db:apply-platform-migrations");
  } else {
    ok("package.json includes db:apply-platform-migrations");
  }
  if (parsedPackageJson.scripts?.["verify:platform-db-migrations"] !== "tsx scripts/verify-platform-db-migrations.ts") {
    fail("package.json should include verify:platform-db-migrations");
  } else {
    ok("package.json includes verify:platform-db-migrations");
  }
  if (!parsedPackageJson.scripts?.["verify:v2-plan"]?.includes("verify:platform-db-migrations")) {
    fail("verify:v2-plan should include verify:platform-db-migrations");
  } else {
    ok("verify:v2-plan includes verify:platform-db-migrations");
  }

  for (const phrase of [
    "Phase 2.9  Versioned Platform DB Migrations",
    "platform_schema_migrations",
    "checksum mismatch",
    "schema.sql remains an idempotent bootstrap/reference schema",
    "migrations are the preferred path for staging and production",
    "Applying `schema.sql` after migrations is not the normal controlled path",
    "no token or password columns"
  ]) {
    requireIncludes(platformDocs, phrase, "platform docs cover versioned migrations");
  }
  for (const phrase of [
    "Phase 2.19c rolling-safe rollout",
    "Step A: run the expand migration",
    "Step B: deploy the new app version",
    "Step C: validate no null classifications remain",
    "Step D: run the contract migration"
  ]) {
    requireIncludes(platformDocs, phrase, "platform docs cover audit classification expand/contract rollout");
    requireIncludes(deploymentDocs, phrase, "deployment docs cover audit classification expand/contract rollout");
  }

  for (const phrase of [
    "npm.cmd run db:apply-platform-migrations",
    "Railway Postgres",
    "Run `npm.cmd run db:apply-platform-migrations` before enabling `PLATFORM_STATE_STORE_DRIVER=postgres`"
  ]) {
    requireIncludes(deploymentDocs, phrase, "deployment docs cover platform migrations");
  }
  const localPostgresFlow = blockBetween(deploymentDocs, "Local Postgres user-directory flow:", "Then run the orchestrator with:");
  requireIncludes(localPostgresFlow, "npm.cmd run db:apply-platform-migrations", "local flow uses platform migrations");
  requireNotIncludes(localPostgresFlow, "npm.cmd run db:apply-platform-schema", "normal local flow does not run schema after migrations");
  requireIncludes(deploymentDocs, "local reset/bootstrap only", "deployment docs scope schema.sql to local reset/bootstrap");
}

async function verifyRuntimeIfConfigured(): Promise<void> {
  let databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.log("DATABASE_URL not set; skipping migration integration check.");
    return;
  }

  const verificationSchema = process.env.PLATFORM_DB_MIGRATION_VERIFY_SCHEMA?.trim();
  if (verificationSchema) {
    if (!validSchemaName(verificationSchema)) {
      fail("PLATFORM_DB_MIGRATION_VERIFY_SCHEMA must be a lowercase identifier with letters, numbers, or underscores.");
      return;
    }
    const adminPool = new Pool({
      connectionString: databaseUrl,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
    });
    try {
      await adminPool.query(`create schema if not exists "${verificationSchema}"`);
    } finally {
      await adminPool.end();
    }
    databaseUrl = databaseUrlWithSearchPath(databaseUrl, verificationSchema);
  }

  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd run db:apply-platform-migrations"]
    : ["run", "db:apply-platform-migrations"];
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl
    }
  });
  if (result.status !== 0) {
    fail("db:apply-platform-migrations should succeed when DATABASE_URL is set");
    return;
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
  });

  try {
    const migrations = await pool.query<{ id: string }>(
      "select id from platform_schema_migrations where id = any($1::text[])",
      [["001", "002", "003", "004"]]
    );
    const ids = new Set(migrations.rows.map((row) => row.id));
    for (const id of ["001", "002", "003", "004"]) {
      if (!ids.has(id)) {
        fail(`platform_schema_migrations should include ${id}`);
      } else {
        ok(`platform_schema_migrations includes ${id}`);
      }
    }

    const requiredColumns = await pool.query<{ table_name: string; column_name: string }>(
      `
        select table_name, column_name
        from information_schema.columns
        where table_schema = current_schema()
          and (
            (table_name = 'users' and column_name = 'status') or
            (table_name = 'connector_trust_records' and column_name = 'owner_key_hash') or
            (table_name = 'audit_events' and column_name in ('outcome', 'severity'))
          )
      `
    );
    const columnKeys = new Set(requiredColumns.rows.map((row) => `${row.table_name}.${row.column_name}`));
    for (const key of ["users.status", "connector_trust_records.owner_key_hash", "audit_events.outcome", "audit_events.severity"]) {
      if (!columnKeys.has(key)) {
        fail(`${key} should exist after migrations`);
      } else {
        ok(`${key} exists after migrations`);
      }
    }

    const legacyOwnerKey = await pool.query(
      `
        select 1
        from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'connector_trust_records'
          and column_name = 'owner_key'
      `
    );
    if (legacyOwnerKey.rowCount) {
      fail("connector_trust_records.owner_key should not exist after migrations");
    } else {
      ok("connector_trust_records.owner_key is absent after migrations");
    }

    const classificationIndexes = await pool.query<{ indexname: string }>(
      `
        select indexname
        from pg_indexes
        where schemaname = current_schema()
          and tablename = 'audit_events'
          and indexname = any($1::text[])
      `,
      [[
        "audit_events_tenant_created_at_id_idx",
        "audit_events_tenant_outcome_created_at_id_idx",
        "audit_events_tenant_severity_created_at_id_idx",
        "audit_events_tenant_outcome_severity_created_at_id_idx"
      ]]
    );
    const indexNames = new Set(classificationIndexes.rows.map((row) => row.indexname));
    for (const indexName of [
      "audit_events_tenant_created_at_id_idx",
      "audit_events_tenant_outcome_created_at_id_idx",
      "audit_events_tenant_severity_created_at_id_idx",
      "audit_events_tenant_outcome_severity_created_at_id_idx"
    ]) {
      if (!indexNames.has(indexName)) {
        fail(`${indexName} should exist after migrations`);
      } else {
        ok(`${indexName} exists after migrations`);
      }
    }

    const forbiddenColumns = await pool.query<{ table_name: string; column_name: string }>(
      `
        select table_name, column_name
        from information_schema.columns
        where table_schema = current_schema()
          and lower(column_name) = any($1::text[])
      `,
      [[
        "access_token",
        "refresh_token",
        "authorization_code",
        "client_secret",
        "private_key",
        "client_assertion",
        "password",
        "password_hash"
      ]]
    );
    if (forbiddenColumns.rowCount) {
      fail("platform migrations should not create forbidden token/password columns");
    } else {
      ok("runtime schema has no forbidden token/password columns");
    }

    const classificationTrigger = await pool.query<{ tgname: string }>(
      `
        select tgname
        from pg_trigger
        where tgrelid = 'audit_events'::regclass
          and tgname = 'audit_events_materialize_classification_trigger'
          and not tgisinternal
      `
    );
    if (!classificationTrigger.rowCount) {
      fail("audit_events materialized classification trigger should exist after expand migration");
    } else {
      ok("audit_events materialized classification trigger exists after expand migration");
    }

    const classificationFunctions = await pool.query<{ proname: string }>(
      `
        select proname
        from pg_proc
        where proname = any($1::text[])
      `,
      [[
        "audit_event_outcome_for_event_type",
        "audit_event_severity_for_event_type",
        "audit_events_materialize_classification"
      ]]
    );
    const functionNames = new Set(classificationFunctions.rows.map((row) => row.proname));
    for (const functionName of [
      "audit_event_outcome_for_event_type",
      "audit_event_severity_for_event_type",
      "audit_events_materialize_classification"
    ]) {
      if (!functionNames.has(functionName)) {
        fail(`${functionName} should exist after expand migration`);
      } else {
        ok(`${functionName} exists after expand migration`);
      }
    }

    const existingNullClassifications = await pool.query<{ count: string }>(
      `
        select count(*)::text as count
        from audit_events
        where outcome is null
           or severity is null
      `
    );
    if (existingNullClassifications.rows[0]?.count !== "0") {
      fail("audit_events backfill should leave no null classification rows before contract migration");
    } else {
      ok("audit_events backfill leaves no null classification rows before contract migration");
    }

    if (process.env.POSTGRES_RESTART_SMOKE_ALLOW_WRITE !== "true") {
      console.log("POSTGRES_RESTART_SMOKE_ALLOW_WRITE is not true; skipping audit classification migration write smoke.");
      return;
    }

    const suffix = `verify_audit_classification_${Date.now()}_${process.pid}`;
    const tenantId = `${suffix}_tenant`;
    const otherTenantId = `${suffix}_other_tenant`;
    const oldBlockedA = `${suffix}_blocked_a`;
    const oldBlockedC = `${suffix}_blocked_c`;
    const newFailure = `${suffix}_failure_new_writer`;
    const otherTenantBlocked = `${suffix}_other_tenant_blocked`;
    const insertedIds = [oldBlockedA, oldBlockedC, newFailure, otherTenantBlocked];
    try {
      await pool.query(
        `insert into audit_events (
          id, tenant_id, actor_provider, actor_subject, actor_email, event_type,
          resource_type, resource_id, created_at, safe_metadata
        ) values ($1, $2, 'verify', 'old-writer-subject', 'verify@example.test', 'security.request.blocked',
          'verify', $1, '2026-01-01T00:00:01.000Z', $3::jsonb)`,
        [oldBlockedA, tenantId, JSON.stringify({ verify: true, protectedMaterialExposed: false, tokenMaterialStored: false, rawPromptStored: false })]
      );
      await pool.query(
        `insert into audit_events (
          id, tenant_id, actor_provider, actor_subject, actor_email, event_type,
          resource_type, resource_id, created_at, safe_metadata
        ) values ($1, $2, 'verify', 'old-writer-subject', 'verify@example.test', 'gateway.authorization.denied',
          'verify', $1, '2026-01-01T00:00:01.000Z', $3::jsonb)`,
        [oldBlockedC, tenantId, JSON.stringify({ verify: true, protectedMaterialExposed: false, tokenMaterialStored: false, rawPromptStored: false })]
      );
      await pool.query(
        `insert into audit_events (
          id, tenant_id, actor_provider, actor_subject, actor_email, event_type,
          resource_type, resource_id, created_at, outcome, severity, safe_metadata
        ) values ($1, $2, 'verify', 'new-writer-subject', 'verify@example.test', 'connector.runtime.failed',
          'verify', $1, '2026-01-01T00:00:02.000Z', 'failure', 'medium', $3::jsonb)`,
        [newFailure, tenantId, JSON.stringify({ verify: true, protectedMaterialExposed: false, tokenMaterialStored: false, rawPromptStored: false })]
      );
      await pool.query(
        `insert into audit_events (
          id, tenant_id, actor_provider, actor_subject, actor_email, event_type,
          resource_type, resource_id, created_at, safe_metadata
        ) values ($1, $2, 'verify', 'other-subject', 'verify@example.test', 'tenant.access.denied',
          'verify', $1, '2026-01-01T00:00:03.000Z', $3::jsonb)`,
        [otherTenantBlocked, otherTenantId, JSON.stringify({ verify: true, protectedMaterialExposed: false, tokenMaterialStored: false, rawPromptStored: false })]
      );

      const inserted = await pool.query<{ id: string; outcome: string | null; severity: string | null }>(
        `
          select id, outcome, severity
          from audit_events
          where id = any($1::text[])
          order by id
        `,
        [insertedIds]
      );
      const byId = new Map(inserted.rows.map((row) => [row.id, row]));
      if (byId.get(oldBlockedA)?.outcome !== "blocked" || byId.get(oldBlockedA)?.severity !== "high") {
        fail("old-writer-style insert should be classified by DB fallback");
      } else {
        ok("old-writer-style insert is classified by DB fallback");
      }
      if (byId.get(newFailure)?.outcome !== "failure" || byId.get(newFailure)?.severity !== "medium") {
        fail("new-writer-style insert should preserve explicit app classification");
      } else {
        ok("new-writer-style insert preserves explicit app classification");
      }

      const nullClassifications = await pool.query<{ count: string }>(
        `
          select count(*)::text as count
          from audit_events
          where id = any($1::text[])
            and (outcome is null or severity is null)
        `,
        [insertedIds]
      );
      if (nullClassifications.rows[0]?.count !== "0") {
        fail("expand migration should leave no null classifications for old or new writer rows");
      } else {
        ok("expand migration leaves no null classifications for old or new writer rows");
      }

      const orderedBlocked = await pool.query<{ id: string }>(
        `
          select id
          from audit_events
          where tenant_id = $1
            and outcome = 'blocked'
          order by created_at desc, id desc
        `,
        [tenantId]
      );
      const orderedBlockedIds = orderedBlocked.rows.map((row) => row.id).join(",");
      if (orderedBlockedIds !== `${oldBlockedC},${oldBlockedA}`) {
        fail("classification-filtered reads should stay tenant-scoped and ordered by created_at desc, id desc");
      } else {
        ok("classification-filtered reads stay tenant-scoped and ordered by created_at desc, id desc");
      }
    } finally {
      await pool.query("delete from audit_events where id = any($1::text[])", [insertedIds]);
    }
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  verifyStatic();
  await verifyRuntimeIfConfigured();

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log("Platform DB migrations verification passed.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
