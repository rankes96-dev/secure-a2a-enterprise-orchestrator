import { existsSync, readFileSync } from "node:fs";
import { AuditEvents } from "../services/orchestrator-api/src/audit/auditEvents.js";
import { evaluateGatewayAuthorization } from "../services/orchestrator-api/src/authorization/gatewayAuthorization.js";
import { securityEventFromAuditEvent } from "../services/orchestrator-api/src/securityEvents/securityEventPublisher.js";
import { InMemoryPlatformStateStore } from "../services/orchestrator-api/src/state/inMemoryPlatformStateStore.js";
import type { StoredAuditEvent } from "../services/orchestrator-api/src/state/platformStateStore.js";

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

function requireExcludes(source: string, phrase: string, context: string): void {
  if (source.includes(phrase)) {
    fail(`${context} should not include forbidden phrase: ${phrase}`);
    return;
  }
  ok(context);
}

function blockBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start < 0) {
    fail(`missing block marker: ${startMarker}`);
    return "";
  }
  const end = source.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

function evaluateAuditRead(roles: string[]) {
  return evaluateGatewayAuthorization({
    tenantId: "default",
    capability: "audit.read",
    route: "/audit/events",
    method: "GET",
    actor: {
      provider: "mock",
      issuer: "https://idp.ogen.local",
      subject: "audit-viewer-user",
      email: "audit-viewer@example.com",
      roles
    },
    source: "browser_session"
  });
}

const packageJsonPath = "package.json";
const sharedPath = "packages/shared/src/index.ts";
const indexPath = "services/orchestrator-api/src/index.ts";
const schemaPath = "services/orchestrator-api/src/http/schemas/auditViewerSchemas.ts";
const policyPath = "services/orchestrator-api/src/authorization/gatewayAuthorizationPolicy.ts";
const storeTypesPath = "services/orchestrator-api/src/state/platformStateStore.ts";
const memoryStorePath = "services/orchestrator-api/src/state/inMemoryPlatformStateStore.ts";
const postgresStorePath = "services/orchestrator-api/src/state/postgresPlatformStateStore.ts";
const securityTimelinePath = "apps/web-ui/src/components/security-timeline/SecurityTimelineTab.tsx";
const frontendMainPath = "apps/web-ui/src/main.tsx";
const frontendAuditApiPath = "apps/web-ui/src/api/auditEvents.ts";
const platformDocsPath = "docs/v2-platform-foundation.md";
const deploymentDocsPath = "docs/deployment.md";

const packageJson = read(packageJsonPath);
const shared = read(sharedPath);
const indexSource = read(indexPath);
const schema = read(schemaPath);
const policy = read(policyPath);
const storeTypes = read(storeTypesPath);
const memoryStore = read(memoryStorePath);
const postgresStore = read(postgresStorePath);
const securityTimeline = read(securityTimelinePath);
const frontendMain = read(frontendMainPath);
const frontendAuditApi = read(frontendAuditApiPath);
const platformDocs = read(platformDocsPath);
const deploymentDocs = read(deploymentDocsPath);

const auditViewerTypeBlock = blockBetween(shared, "export type AuditViewerEvent", "export type AuditEventsResponse");
const auditEventsResponseBlock = blockBetween(shared, "export type AuditEventsResponse", "export interface ResolveRequest");
for (const phrase of [
  "export type AuditViewerEvent",
  "severity: AuditEventSeverity",
  "outcome: AuditEventOutcome",
  "summary: AuditEventSummary",
  "protectedMaterialExposed: false",
  "tokenMaterialStored: false",
  "rawPromptStored: false",
  "export type AuditEventsResponse",
  "safeMetadataReturned: false"
]) {
  requireIncludes(shared, phrase, "shared audit viewer contract");
}
for (const forbidden of [
  "safeMetadata:",
  "actorSubject",
  "token:",
  "rawPrompt:"
]) {
  requireExcludes(auditViewerTypeBlock, forbidden, "audit viewer event contract excludes raw/security-sensitive fields");
  requireExcludes(auditEventsResponseBlock, forbidden, "audit events response contract excludes raw/security-sensitive fields");
}

for (const phrase of [
  "auditEventsQuerySchema",
  "auditEventsResponseSchema",
  "additionalProperties: false",
  "safeMetadataReturned",
  "protectedMaterialExposed",
  "tokenMaterialStored",
  "rawPromptStored"
]) {
  requireIncludes(schema, phrase, "audit viewer schema");
}
requireExcludes(schema, "safeMetadata:", "audit viewer schema does not expose stored metadata object");

const auditRoute = blockBetween(indexSource, 'auditEventsUrl.pathname === "/audit/events"', 'if (request.method === "POST" && request.url === "/runtime/authorize")');
for (const phrase of [
  "await requireFreshIdentitySession(request, response)",
  "parseAuditEventsQuery(auditEventsUrl.searchParams)",
  "tenantContextForRequest(identitySession.identity, parsedAuditQuery.query.tenantIdHint)",
  "requireRequestedTenantAllowed(auditTenantContext)",
  "appendTenantAccessDeniedAuditEvent",
  "requireGatewayCapability",
  'capability: "audit.read"',
  'route: "/audit/events"',
  'method: "GET"',
  "getPlatformStateStore().listAuditEvents",
  "tenantId: auditTenantContext.tenantId",
  "auditViewerEventFromStoredAuditEvent",
  "responseProof",
  "safeMetadataReturned: false",
  "protectedMaterialExposed: false",
  "tokenMaterialStored: false",
  "rawPromptStored: false"
]) {
  requireIncludes(auditRoute, phrase, "GET /audit/events route boundary");
}
for (const forbidden of [
  "readJsonBody",
  "request.actor",
  "actor_roles",
  "hasValidClientApiKey"
]) {
  requireExcludes(auditRoute, forbidden, "GET /audit/events route uses browser session identity only");
}

const mapperBlock = blockBetween(indexSource, "function auditViewerEventFromStoredAuditEvent", "async function appendGatewayAuthorizationAuditEvent");
const mapperReturnBlock = mapperBlock.slice(mapperBlock.indexOf("return {"));
for (const phrase of [
  "securityEventFromAuditEvent(event)",
  "severity: securityEvent.severity",
  "outcome: securityEvent.outcome",
  "conversationId: securityEvent.conversationId",
  "summary:",
  "proof:"
]) {
  requireIncludes(mapperBlock, phrase, "audit viewer projection mapper");
}
for (const forbidden of [
  "actorSubject:",
  "safeMetadata:",
  "access_token",
  "refresh_token",
  "Authorization"
]) {
  requireExcludes(mapperReturnBlock, forbidden, "audit viewer projection return excludes raw/security-sensitive fields");
}

const auditPolicyBlock = blockBetween(policy, '"audit.read": {', '"users.manage": {');
for (const role of ["security_viewer", "gateway_admin", "tenant_admin", "admin"]) {
  requireIncludes(auditPolicyBlock, `"${role}"`, `audit.read policy includes ${role}`);
}
for (const role of ["end_user", "operator", "it-support", "connector_admin"]) {
  requireExcludes(auditPolicyBlock, `"${role}"`, `audit.read policy excludes ${role}`);
}

for (const phrase of [
  "eventType?: string",
  "from?: string",
  "to?: string",
  "conversationId?: string",
  "offset?: number"
]) {
  requireIncludes(storeTypes, phrase, "platform state audit list filters");
  requireIncludes(memoryStore, phrase, "in-memory audit list filters");
  requireIncludes(postgresStore, phrase, "postgres audit list filters");
}
for (const phrase of [
  "event.eventType !== params.eventType",
  "event.safeMetadata.conversationId !== params.conversationId",
  "filtered.slice(offset, offset + limit)"
]) {
  requireIncludes(memoryStore, phrase, "in-memory audit viewer filtering");
}
for (const phrase of [
  "event_type = ?",
  "created_at >= ?",
  "created_at <= ?",
  "safe_metadata ->> 'conversationId' = ?",
  "offset $"
]) {
  requireIncludes(postgresStore, phrase, "postgres audit viewer filtering");
}

for (const phrase of [
  "AuditEventsResponse",
  "auditEventsResponse",
  "auditEventsError",
  "isAuditEventsLoading",
  "loadAuditEvents",
  "fetchAuditEvents(API_URL, filters",
  "handleProtectedResponse(response, \"Failed to load persisted audit events\")"
]) {
  requireIncludes(frontendMain, phrase, "frontend audit viewer API wiring");
}
for (const phrase of [
  "auditEventsQuery",
  'fetch(`${apiUrl}/audit/events?${query.toString()}`',
  'method: "GET"',
  'credentials: "include"'
]) {
  requireIncludes(frontendAuditApi, phrase, "frontend audit viewer API client");
}
for (const phrase of [
  "Persisted audit viewer",
  "Tenant audit events",
  "audit-viewer-table",
  "audit-status-badge",
  "audit-severity-badge",
  "loadAuditEvents"
]) {
  requireIncludes(securityTimeline, phrase, "Security Timeline persisted audit viewer UI");
}
requireExcludes(securityTimeline, "safeMetadata", "Security Timeline does not render stored safeMetadata");
for (const forbidden of ["access_token", "refresh_token", "Authorization header", "rawPrompt"]) {
  requireExcludes(securityTimeline, forbidden, "Security Timeline audit viewer avoids protected material labels");
}

const parsedPackageJson = JSON.parse(packageJson) as { scripts?: Record<string, string> };
if (parsedPackageJson.scripts?.["verify:audit-viewer-boundary"] !== "tsx scripts/verify-audit-viewer-boundary.ts") {
  fail("package.json should include verify:audit-viewer-boundary");
} else {
  ok("package.json includes verify:audit-viewer-boundary");
}
if (!parsedPackageJson.scripts?.["verify:v2-plan"]?.includes("verify:audit-viewer-boundary")) {
  fail("verify:v2-plan should run audit viewer boundary verification");
} else {
  ok("verify:v2-plan includes audit viewer boundary verification");
}

for (const phrase of [
  "Phase 2.19  Persisted Audit Viewer (MVP)",
  "GET `/audit/events`",
  "`audit.read`",
  "tenant-scoped",
  "no raw prompt, token, secret, or stored metadata payload",
  "tenant.access.denied remains blocked"
]) {
  requireIncludes(platformDocs, phrase, "platform docs cover persisted audit viewer");
}
for (const phrase of [
  "Persisted audit viewer",
  "PLATFORM_STATE_STORE_DRIVER=postgres",
  "audit.read",
  "CSRF cookie follows session SameSite"
]) {
  requireIncludes(deploymentDocs, phrase, "deployment docs cover persisted audit viewer and cross-site cookies");
}

for (const role of ["security_viewer", "gateway_admin", "tenant_admin", "admin"]) {
  if (evaluateAuditRead([role]).effect !== "allow") {
    fail(`${role} should be allowed to read persisted audit events`);
  } else {
    ok(`${role} can audit.read`);
  }
}
for (const role of ["end_user", "operator", "it-support", "connector_admin"]) {
  if (evaluateAuditRead([role]).effect !== "block") {
    fail(`${role} should not be allowed to read persisted audit events`);
  } else {
    ok(`${role} cannot audit.read`);
  }
}

const tenantDeniedEnvelope = securityEventFromAuditEvent({
  id: "tenant-denied-verify",
  tenantId: "tenant-a",
  actorProvider: "mock",
  actorSubject: "subject-a",
  actorEmail: "audit-viewer@example.com",
  eventType: AuditEvents.TENANT_ACCESS_DENIED,
  resourceType: "tenant",
  resourceId: "tenant-a",
  createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  safeMetadata: {
    route: "/audit/events",
    conversationId: "conversation-a",
    protectedMaterialExposed: false,
    tokenMaterialStored: false,
    rawPromptStored: false
  }
});
if (tenantDeniedEnvelope.outcome !== "blocked") {
  fail("tenant.access.denied must remain blocked in audit viewer classification");
} else {
  ok("tenant.access.denied remains blocked");
}
if (tenantDeniedEnvelope.severity === "info" || tenantDeniedEnvelope.severity === "low") {
  fail("tenant.access.denied must be warning-or-higher severity");
} else {
  ok("tenant.access.denied remains warning-or-higher severity");
}

function auditEvent(overrides: Partial<StoredAuditEvent>): StoredAuditEvent {
  return {
    id: overrides.id ?? "audit-event",
    tenantId: overrides.tenantId ?? "tenant-a",
    actorProvider: "mock",
    actorSubject: "subject-a",
    actorEmail: "audit-viewer@example.com",
    eventType: overrides.eventType ?? AuditEvents.GATEWAY_AUTHORIZATION_EVALUATED,
    resourceType: overrides.resourceType ?? "gateway_authorization",
    resourceId: overrides.resourceId ?? overrides.id ?? "audit-event",
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00.000Z").toISOString(),
    safeMetadata: overrides.safeMetadata ?? {
      conversationId: "conversation-a",
      route: "/resolve",
      method: "POST",
      capability: "gateway.resolve",
      protectedMaterialExposed: false,
      tokenMaterialStored: false,
      rawPromptStored: false
    }
  };
}

async function verifyStoreRuntime(): Promise<void> {
  const store = new InMemoryPlatformStateStore();
  await store.appendAuditEvent(auditEvent({ id: "tenant-a-new", tenantId: "tenant-a", createdAt: "2026-01-01T00:02:00.000Z" }));
  await store.appendAuditEvent(auditEvent({
    id: "tenant-a-denied",
    tenantId: "tenant-a",
    eventType: AuditEvents.TENANT_ACCESS_DENIED,
    createdAt: "2026-01-01T00:01:00.000Z",
    safeMetadata: {
      conversationId: "conversation-denied",
      route: "/runtime/authorize",
      method: "POST",
      reason: "tenant_access_denied",
      protectedMaterialExposed: false,
      tokenMaterialStored: false,
      rawPromptStored: false
    }
  }));
  await store.appendAuditEvent(auditEvent({ id: "tenant-b", tenantId: "tenant-b", createdAt: "2026-01-01T00:03:00.000Z" }));

  const tenantAEvents = await store.listAuditEvents({ tenantId: "tenant-a", limit: 10 });
  if (tenantAEvents.length !== 2 || tenantAEvents.some((event) => event.tenantId !== "tenant-a")) {
    fail("audit list must isolate events by tenant");
  } else {
    ok("audit list isolates events by tenant");
  }
  const deniedEvents = await store.listAuditEvents({
    tenantId: "tenant-a",
    eventType: AuditEvents.TENANT_ACCESS_DENIED,
    conversationId: "conversation-denied",
    limit: 10
  });
  if (deniedEvents.length !== 1 || deniedEvents[0].id !== "tenant-a-denied") {
    fail("audit list should filter by eventType and safe conversationId");
  } else {
    ok("audit list filters by eventType and safe conversationId");
  }
  const pagedEvents = await store.listAuditEvents({ tenantId: "tenant-a", limit: 1, offset: 1 });
  if (pagedEvents.length !== 1 || pagedEvents[0].id !== "tenant-a-denied") {
    fail("audit list should return deterministic newest-first pagination");
  } else {
    ok("audit list returns deterministic newest-first pagination");
  }
}

verifyStoreRuntime().then(() => {
  if (failed) {
    process.exitCode = 1;
  } else {
    console.log("Audit viewer boundary verification passed.");
  }
}).catch((error: unknown) => {
  fail(error instanceof Error ? error.message : "audit viewer runtime verification failed");
  process.exitCode = 1;
});
