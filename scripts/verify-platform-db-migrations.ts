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
    "003_user_directory_access_gate.sql"
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
  const allMigrations = `${initial}\n${ownerHash}\n${userDirectory}`;
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
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.log("DATABASE_URL not set; skipping migration integration check.");
    return;
  }

  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd run db:apply-platform-migrations"]
    : ["run", "db:apply-platform-migrations"];
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env
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
      [["001", "002", "003"]]
    );
    const ids = new Set(migrations.rows.map((row) => row.id));
    for (const id of ["001", "002", "003"]) {
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
            (table_name = 'connector_trust_records' and column_name = 'owner_key_hash')
          )
      `
    );
    const columnKeys = new Set(requiredColumns.rows.map((row) => `${row.table_name}.${row.column_name}`));
    for (const key of ["users.status", "connector_trust_records.owner_key_hash"]) {
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
