import { existsSync, readFileSync } from "node:fs";
import { appendPlatformAuditEvent } from "../services/orchestrator-api/src/audit/platformAuditStore.js";
import { getPlatformStateStore, resetPlatformStateStoreForTests } from "../services/orchestrator-api/src/state/createPlatformStateStore.js";

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

async function verifyRuntimeSanitization(): Promise<void> {
  const previousDriver = process.env.PLATFORM_STATE_STORE_DRIVER;
  process.env.PLATFORM_STATE_STORE_DRIVER = "memory";
  resetPlatformStateStoreForTests();

  await appendPlatformAuditEvent({
    eventType: "verify.audit.sanitized",
    resourceType: "connector",
    resourceId: "verify",
    safeMetadata: {
      ["access" + "_token"]: "abc",
      nested: {
        Authorization: "Bearer abc"
      }
    }
  });

  const store = getPlatformStateStore();
  const events = await store.listAuditEvents({ resourceType: "connector", resourceId: "verify", limit: 1 });
  const metadata = events[0]?.safeMetadata;
  if (!metadata) {
    fail("appendPlatformAuditEvent should append an audit event to the platform state store");
  } else {
    if (metadata["access" + "_token"] !== "hidden") {
      fail("appendPlatformAuditEvent should hide dangerous top-level metadata keys");
    }
    const nested = metadata.nested as { Authorization?: string } | undefined;
    if (nested?.Authorization !== "hidden") {
      fail("appendPlatformAuditEvent should hide dangerous nested metadata values");
    }
    if (JSON.stringify(metadata).includes("abc")) {
      fail("appendPlatformAuditEvent should not store raw dangerous metadata values");
    }
    nested.Authorization = "mutated-after-read";
    const secondRead = await store.listAuditEvents({ resourceType: "connector", resourceId: "verify", limit: 1 });
    const secondNested = secondRead[0]?.safeMetadata.nested as { Authorization?: string } | undefined;
    if (secondNested?.Authorization === "mutated-after-read") {
      fail("stored audit safeMetadata should be deep-cloned on reads");
    }
  }

  resetPlatformStateStoreForTests();
  if (previousDriver === undefined) {
    delete process.env.PLATFORM_STATE_STORE_DRIVER;
  } else {
    process.env.PLATFORM_STATE_STORE_DRIVER = previousDriver;
  }
}

const platformAuditStorePath = "services/orchestrator-api/src/audit/platformAuditStore.ts";
const platformAuditStore = read(platformAuditStorePath);
const auditEvents = read("services/orchestrator-api/src/audit/auditEvents.ts");
const onboardingService = read("services/orchestrator-api/src/agentOnboarding/onboardingService.ts");
const orchestrator = read("services/orchestrator-api/src/index.ts");
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
  "StoredAuditEvent",
  "appendPlatformAuditEvent",
  "randomUUID",
  "sanitizeAuditMetadata",
  "dangerousMarkers",
  "appendAuditEvent",
  "try",
  "catch",
  "[audit] append failed for eventType="
]) {
  requireIncludes(platformAuditStore, phrase, "platform audit store");
}

for (const phrase of [
  "USER_IDENTITY_VERIFIED",
  "CONNECTOR_ONBOARDING_TRUSTED",
  "CONNECTOR_RUNTIME_TOKEN_ISSUED",
  "CONNECTOR_RUNTIME_SUCCEEDED",
  "CONNECTOR_RUNTIME_FAILED",
  "CONNECTOR_RUNTIME_AUTHORIZATION_REQUIRED",
  "SECURITY_REQUEST_BLOCKED"
]) {
  requireIncludes(auditEvents, phrase, "audit event constants");
}

for (const phrase of [
  "appendPlatformAuditEvent",
  "AuditEvents.CONNECTOR_ONBOARDING_TRUSTED",
  "rawAssertionExposed: false",
  "rawTokenExposed: false"
]) {
  requireIncludes(onboardingService, phrase, "onboarding audit write-through");
}

for (const phrase of [
  "appendPlatformAuditEvent",
  "appendIdentityVerifiedAuditEvent",
  "AuditEvents.USER_IDENTITY_VERIFIED",
  "userIdentitiesBySession.set(sessionToken, identity)",
  "await appendIdentityVerifiedAuditEvent(identity)",
  "appendConnectorRuntimeAuditEvents",
  "AuditEvents.CONNECTOR_RUNTIME_TOKEN_ISSUED",
  "AuditEvents.CONNECTOR_RUNTIME_SUCCEEDED",
  "AuditEvents.CONNECTOR_RUNTIME_FAILED",
  "AuditEvents.CONNECTOR_RUNTIME_AUTHORIZATION_REQUIRED",
  "appendSecurityBlockedAuditEvent",
  "AuditEvents.SECURITY_REQUEST_BLOCKED",
  "promptTextStored: false",
  "rawTokenExposed: false",
  "rawToken: \"hidden\"",
  "rawTokens: \"hidden\""
]) {
  requireIncludes(orchestrator, phrase, "orchestrator audit write-through");
}

for (const phrase of [
  '"verify:platform-audit-write-through": "tsx scripts/verify-platform-audit-write-through.ts"',
  "verify:platform-audit-write-through"
]) {
  requireIncludes(packageJson, phrase, "package scripts");
}

for (const phrase of [
  "Phase 2.2: append safe audit events through `PlatformStateStore`",
  "Phase 2.2: audit write failures must not break runtime/user flow",
  "Phase 2.2: audit metadata must be sanitized and raw tokens hidden",
  "Phase 2.2: memory driver remains active; restart survival is future Postgres work",
  "npm run verify:platform-audit-write-through"
]) {
  requireIncludes(plan, phrase, "V2 platform foundation doc");
}

for (const phrase of [
  "Phase 2.2 starts write-through of safe audit events to `PlatformStateStore`",
  "Current Security Timeline still reads latest response state",
  "memory driver does not survive restart"
]) {
  requireIncludes(inventory, phrase, "V2 state inventory");
}

for (const forbidden of ["access_token", "refresh_token", "Authorization", "Bearer", "private_key", "client_secret", "client_assertion", "authorization_code"]) {
  requireExcludes(platformAuditStore, forbidden, "platform audit store source");
}

for (const forbidden of ["gateway_assertion", "signed challenge", "client assertion", "requestBody.message, safeMetadata", "prompt: requestBody.message"]) {
  requireExcludes(orchestrator, forbidden, "orchestrator audit metadata construction");
  requireExcludes(onboardingService, forbidden, "onboarding audit metadata construction");
}

const dependencyNames = Object.keys({
  ...(parsedPackageJson.dependencies ?? {}),
  ...(parsedPackageJson.devDependencies ?? {})
});
for (const forbidden of ["prisma", "drizzle", "pg", "postgres"]) {
  if (dependencyNames.some((name) => name.toLowerCase().includes(forbidden))) {
    fail(`Phase 2.2 should not introduce DB dependency: ${forbidden}`);
  }
}

if (!parsedPackageJson.scripts?.["verify:v2-plan"]?.includes("verify:platform-audit-write-through")) {
  fail("verify:v2-plan should include verify:platform-audit-write-through");
}

async function main(): Promise<void> {
  await verifyRuntimeSanitization();

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log("Platform audit write-through verification passed.");
  }
}

void main();
