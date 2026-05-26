import { existsSync, readFileSync } from "node:fs";
import { InMemoryPlatformStateStore } from "../services/orchestrator-api/src/state/inMemoryPlatformStateStore.js";
import type { StoredPlatformUser } from "../services/orchestrator-api/src/state/platformStateStore.js";
import { verifyUserDirectoryAccess } from "../services/orchestrator-api/src/identity/userDirectoryAccess.js";
import type { VerifiedUserIdentity } from "../services/orchestrator-api/src/security/userIdentity.js";

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

function requireBefore(source: string, first: string, second: string, context: string): void {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex > secondIndex) {
    fail(`${context} should contain ${first} before ${second}`);
  }
}

function auth0Identity(email: string, subject = "auth0|user-1"): VerifiedUserIdentity {
  return {
    provider: "auth0",
    email: email.toLowerCase(),
    emailVerified: true,
    name: "Directory User",
    roles: ["from-auth0"],
    issuer: "https://example.auth0.com/",
    audience: "gateway-api",
    subject
  };
}

function user(params: Partial<StoredPlatformUser> & { email: string }): StoredPlatformUser {
  const now = "2026-05-25T00:00:00.000Z";
  return {
    id: params.id ?? `user:${params.email.toLowerCase()}`,
    tenantId: params.tenantId ?? "default",
    provider: params.provider,
    issuer: params.issuer,
    subject: params.subject,
    email: params.email.toLowerCase(),
    displayName: params.displayName,
    roles: params.roles ?? [],
    status: params.status ?? "active",
    createdAt: params.createdAt ?? now,
    updatedAt: params.updatedAt ?? now
  };
}

async function verifyMemoryRuntime(): Promise<void> {
  const env = {
    ...process.env,
    AUTH0_REQUIRE_USER_DIRECTORY: "true",
    PLATFORM_STATE_STORE_DRIVER: "memory"
  };

  const seededStore = new InMemoryPlatformStateStore([user({ email: "allowed@example.com", roles: ["directory-role"] })]);
  const allowed = await verifyUserDirectoryAccess({
    identity: auth0Identity("ALLOWED@example.com"),
    tenantId: "default",
    store: seededStore,
    env
  });
  if (!allowed.ok || !allowed.user.subject || allowed.user.status !== "active") {
    fail(`memory store seeded with allowed email should allow and bind user: ${JSON.stringify(allowed)}`);
  }

  const missing = await verifyUserDirectoryAccess({
    identity: auth0Identity("missing@example.com"),
    tenantId: "default",
    store: seededStore,
    env
  });
  if (missing.ok || missing.status !== 403 || missing.message !== "Access denied. Your user is not enabled for this gateway.") {
    fail(`missing email should deny with safe 403: ${JSON.stringify(missing)}`);
  }

  const disabledStore = new InMemoryPlatformStateStore([user({ email: "disabled@example.com", status: "disabled" })]);
  const disabled = await verifyUserDirectoryAccess({
    identity: auth0Identity("disabled@example.com"),
    tenantId: "default",
    store: disabledStore,
    env
  });
  if (disabled.ok || disabled.error !== "user_directory_disabled") {
    fail(`disabled user should deny: ${JSON.stringify(disabled)}`);
  }

  const mismatchStore = new InMemoryPlatformStateStore([
    user({
      email: "bound@example.com",
      provider: "auth0",
      issuer: "https://example.auth0.com/",
      subject: "auth0|other-user"
    })
  ]);
  const mismatch = await verifyUserDirectoryAccess({
    identity: auth0Identity("bound@example.com", "auth0|new-user"),
    tenantId: "default",
    store: mismatchStore,
    env
  });
  if (mismatch.ok || mismatch.error !== "user_directory_subject_mismatch") {
    fail(`subject mismatch should deny: ${JSON.stringify(mismatch)}`);
  }

  const invitedStore = new InMemoryPlatformStateStore([user({ email: "invited@example.com", status: "invited" })]);
  const invited = await verifyUserDirectoryAccess({
    identity: auth0Identity("invited@example.com", "auth0|invited-user"),
    tenantId: "default",
    store: invitedStore,
    env
  });
  if (!invited.ok || invited.user.status !== "active" || invited.user.subject !== "auth0|invited-user") {
    fail(`invited user with no subject should bind and become active: ${JSON.stringify(invited)}`);
  }

  const unverified = await verifyUserDirectoryAccess({
    identity: { ...auth0Identity("allowed@example.com"), emailVerified: false },
    tenantId: "default",
    store: seededStore,
    env
  });
  if (unverified.ok || unverified.error !== "user_directory_email_unverified") {
    fail(`Auth0 email_verified=false should deny: ${JSON.stringify(unverified)}`);
  }

  const ranStore = new InMemoryPlatformStateStore([user({ email: "ran@gateway.com", roles: ["it-support", "admin"] })]);
  const ran = await verifyUserDirectoryAccess({
    identity: auth0Identity("ran@gateway.com", "auth0|ran"),
    tenantId: "default",
    store: ranStore,
    env
  });
  if (!ran.ok || ran.user.email !== "ran@gateway.com" || !ran.user.roles.includes("admin")) {
    fail(`Auth0 user ran@gateway.com should be represented as allowed after seed: ${JSON.stringify(ran)}`);
  }

  const unseeded = await verifyUserDirectoryAccess({
    identity: auth0Identity("unseeded@gateway.com", "auth0|unseeded"),
    tenantId: "default",
    store: ranStore,
    env
  });
  if (unseeded.ok || unseeded.error !== "user_directory_missing") {
    fail(`unseeded Auth0 user should deny: ${JSON.stringify(unseeded)}`);
  }
}

const schema = read("services/orchestrator-api/db/schema.sql");
const platformTypes = read("services/orchestrator-api/src/state/platformStateStore.ts");
const memoryStore = read("services/orchestrator-api/src/state/inMemoryPlatformStateStore.ts");
const postgresStore = read("services/orchestrator-api/src/state/postgresPlatformStateStore.ts");
const userDirectoryAccess = read("services/orchestrator-api/src/identity/userDirectoryAccess.ts");
const index = read("services/orchestrator-api/src/index.ts");
const auditEvents = read("services/orchestrator-api/src/audit/auditEvents.ts");
const frontend = read("apps/web-ui/src/main.tsx");
const seedScript = read("scripts/seed-platform-user.ts");
const packageJson = read("package.json");
const plan = read("docs/v2-platform-foundation.md");
const deployment = read("docs/deployment.md");

for (const phrase of [
  "status text not null default 'active'",
  "email text not null",
  "subject text,",
  "provider text,",
  "alter column subject drop not null",
  "alter column provider drop not null",
  "users.email contains null values; seed/update users before enforcing user directory access",
  "users_tenant_email_idx",
  "on users (tenant_id, lower(email))",
  "users_tenant_provider_issuer_subject_idx",
  "where provider is not null and subject is not null"
]) {
  requireIncludes(schema, phrase, "users schema");
}

requireExcludes(schema, "coalesce(nullif(email", "users schema");

for (const phrase of [
  "password",
  "password_hash",
  "access_token",
  "refresh_token",
  "authorization_code",
  "client_secret",
  "private_key",
  "client_assertion"
]) {
  requireExcludes(schema, phrase, "users schema");
}

for (const phrase of [
  "StoredPlatformUserStatus",
  "StoredPlatformUser",
  "findUserByEmail",
  "bindUserIdentity"
]) {
  requireIncludes(platformTypes, phrase, "PlatformStateStore user directory types");
}

for (const phrase of [
  "StoredPlatformUser",
  "findUserByEmail",
  "bindUserIdentity"
]) {
  requireIncludes(memoryStore, phrase, "memory user directory store");
  requireIncludes(postgresStore, phrase, "Postgres user directory store");
}

for (const phrase of [
  "PLATFORM_ALLOWED_USER_EMAILS",
  "normalizeEmail",
  'status: "active"',
  "usersByTenantEmail",
  "User directory identity binding mismatch"
]) {
  requireIncludes(memoryStore, phrase, "memory user directory behavior");
}

for (const phrase of [
  "where tenant_id = $1",
  "and lower(email) = lower($2)",
  "for update",
  "User directory identity binding mismatch",
  "status = case when status = 'invited' then 'active' else status end"
]) {
  requireIncludes(postgresStore, phrase, "Postgres user directory behavior");
}

for (const phrase of [
  "AUTH0_REQUIRE_USER_DIRECTORY",
  "MOCK_REQUIRE_USER_DIRECTORY",
  "PLATFORM_ALLOWED_USER_EMAILS",
  "emailVerified === false",
  "reason",
  "user_directory_email_unverified",
  "findUserByEmail",
  "bindUserIdentity",
  "Access denied. Your user is not enabled for this gateway."
]) {
  requireIncludes(userDirectoryAccess, phrase, "user directory access helper");
}

const freshHelperStart = index.indexOf("async function requireFreshIdentitySession");
const freshVerifyCall = freshHelperStart < 0 ? -1 : index.indexOf("verifyUserDirectoryAccess", freshHelperStart);
const freshSessionDelete = freshHelperStart < 0 ? -1 : index.indexOf("userIdentitiesBySession.delete(identitySession.sessionToken)", freshHelperStart);
const freshDeniedResponse = freshHelperStart < 0 ? -1 : index.indexOf('error: "user_directory_access_denied"', freshHelperStart);
const freshSessionSet = freshHelperStart < 0 ? -1 : index.indexOf("userIdentitiesBySession.set(identitySession.sessionToken, allowedIdentity)", freshHelperStart);
if (freshHelperStart < 0 || freshVerifyCall < 0 || freshSessionDelete < 0 || freshDeniedResponse < 0 || freshSessionSet < 0) {
  fail("requireFreshIdentitySession should recheck directory access, clear denied identities, return safe 403, and refresh allowed identity");
}
if (freshVerifyCall > freshSessionSet) {
  fail("requireFreshIdentitySession should call verifyUserDirectoryAccess before refreshing userIdentitiesBySession");
}
requireIncludes(index, "await requireFreshIdentitySession(request, response)", "protected routes fresh directory revalidation");
requireIncludes(index, "await appendIdentityDeniedAuditEvent(identitySession.identity, directoryAccess.reason, tenantContext)", "fresh session denied audit");
requireIncludes(index, "sendJson(response, directoryAccess.status", "fresh session safe denied status");
requireIncludes(index, "message: directoryAccess.message", "fresh session safe denied message");

const identityAttachRoute = routeBlock(index, "POST", "/identity/session");
const demoLoginRoute = routeBlock(index, "POST", "/identity/demo-login");

for (const [route, context] of [
  [identityAttachRoute, "POST /identity/session denied attach"],
  [demoLoginRoute, "POST /identity/demo-login denied attach"]
] as const) {
  requireBefore(route, "userIdentitiesBySession.delete(sessionToken)", "await appendIdentityDeniedAuditEvent(identity, directoryAccess.reason, tenantContext)", context);
  requireBefore(route, "userIdentitiesBySession.delete(sessionToken)", 'error: "user_directory_access_denied"', context);
  requireIncludes(route, 'error: "user_directory_access_denied"', context);
  requireIncludes(route, "message: directoryAccess.message", context);
  requireIncludes(route, "await appendIdentityDeniedAuditEvent(identity, directoryAccess.reason, tenantContext)", context);
  requireExcludes(route, "console.log", context);
  requireExcludes(route, "console.error", context);
}

for (const phrase of [
  "USER_IDENTITY_DENIED",
  "user.identity.denied"
]) {
  requireIncludes(auditEvents, phrase, "audit events");
}
requireIncludes(index, "USER_IDENTITY_DENIED", "identity denied audit wiring");

for (const phrase of [
  'sendJson(response, directoryAccess.status',
  'error: "user_directory_access_denied"',
  "protectedMaterialExposed: false",
  "tokenMaterialStored: false"
]) {
  requireIncludes(index, phrase, "identity denied route");
}

requireIncludes(frontend, "Access denied. Your user is not enabled for this gateway.", "frontend safe denied copy");
requireIncludes(seedScript, "PLATFORM_USER_EMAIL", "seed platform user script");
requireIncludes(seedScript, "PLATFORM_USER_STATUS", "seed platform user script");
requireIncludes(seedScript, "DATABASE_URL is required", "seed platform user script");
requireIncludes(seedScript, "lower(email) = lower($2)", "seed platform user script");

const parsedPackageJson = JSON.parse(packageJson) as { scripts?: Record<string, string> };
if (parsedPackageJson.scripts?.["db:seed-platform-user"] !== "tsx scripts/seed-platform-user.ts") {
  fail("package.json should include db:seed-platform-user");
}
if (parsedPackageJson.scripts?.["verify:user-directory-access-gate"] !== "tsx scripts/verify-user-directory-access-gate.ts") {
  fail("package.json should include verify:user-directory-access-gate");
}
if (!parsedPackageJson.scripts?.["verify:v2-plan"]?.includes("verify:user-directory-access-gate")) {
  fail("verify:v2-plan should include verify:user-directory-access-gate");
}

for (const phrase of [
  "Phase 2.7  User Directory Access Gate",
  "local users table authorizes Gateway access",
  "users table is passwordless",
  "no password hashes",
  "no token storage",
  "provider/issuer/subject binding after first login",
  "mock demo remains available unless configured otherwise",
  "ran@gateway.com"
]) {
  requireIncludes(plan, phrase, "V2 platform foundation docs");
}

for (const phrase of [
  "AUTH0_REQUIRE_USER_DIRECTORY=true",
  "MOCK_REQUIRE_USER_DIRECTORY=false",
  "PLATFORM_ALLOWED_USER_EMAILS=",
  '$env:DATABASE_URL="postgresql://a2a:a2a@localhost:5432/secure_a2a_dev"',
  '$env:DATABASE_SSL="false"',
  '$env:PLATFORM_USER_EMAIL="ran@gateway.com"',
  '$env:PLATFORM_USER_ROLES="it-support,admin"',
  '$env:PLATFORM_USER_STATUS="active"',
  "npm.cmd run db:seed-platform-user"
]) {
  requireIncludes(deployment, phrase, "deployment docs");
}

async function main(): Promise<void> {
  await verifyMemoryRuntime();

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log("User directory access gate verification passed.");
  }
}

main().catch((error) => {
  console.error(`fail - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
