import { existsSync, readFileSync } from "node:fs";
import { AuditEvents } from "../services/orchestrator-api/src/audit/auditEvents.js";
import {
  auditViewerDerivedFilterScanLimit,
  listAuditViewerEventsPage
} from "../services/orchestrator-api/src/audit/auditViewerPagination.js";
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
const paginationPath = "services/orchestrator-api/src/audit/auditViewerPagination.ts";
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
const pagination = read(paginationPath);
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
  "export type AuditEventsFilters",
  "export type AuditEventsRequest",
  "cursor?: string",
  "filters?: AuditEventsFilters",
  "export type AuditEventsResponse",
  "hasNext: boolean",
  "nextCursor?: string",
  "items: AuditViewerEvent[]",
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
  "cursor",
  "hasNext",
  "nextCursor",
  "items",
  "safeMetadataReturned",
  "protectedMaterialExposed",
  "tokenMaterialStored",
  "rawPromptStored"
]) {
  requireIncludes(schema, phrase, "audit viewer schema");
}
requireExcludes(schema, "safeMetadata:", "audit viewer schema does not expose stored metadata object");
requireExcludes(schema, "nextPage", "audit viewer schema does not expose offset/page nextPage");

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
  "listAuditViewerEventsPage",
  "store: getPlatformStateStore()",
  "tenantId: auditTenantContext.tenantId",
  "const body: AuditEventsResponse = auditPage.body"
]) {
  requireIncludes(auditRoute, phrase, "GET /audit/events route boundary");
}
for (const forbidden of [
  "readJsonBody",
  "request.actor",
  "actor_roles",
  "hasValidClientApiKey",
  "offset",
  "nextPage"
]) {
  requireExcludes(auditRoute, forbidden, "GET /audit/events route uses browser session identity only");
}

const mapperBlock = blockBetween(pagination, "export function auditViewerEventFromStoredAuditEvent", "function classificationMatches");
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

for (const phrase of [
  "listAuditViewerEventsPage",
  "auditViewerDerivedFilterScanLimit",
  "snapshotCeiling",
  "cursorAfter",
  "filterHash",
  "matches.length < query.limit + 1",
  "audit_events_filter_scan_limit_exceeded",
  "classificationMatches"
]) {
  requireIncludes(pagination, phrase, "audit viewer cursor pagination module");
}
for (const forbidden of [
  "nextPage",
  "query.offset",
  "pageEvents"
]) {
  requireExcludes(pagination, forbidden, "audit viewer pagination avoids page/offset slicing");
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
  "cursorAfter?: StoredAuditEventPageBoundary",
  "snapshotCeiling?: StoredAuditEventPageBoundary"
]) {
  requireIncludes(storeTypes, phrase, "platform state audit list filters");
  requireIncludes(memoryStore, phrase, "in-memory audit list filters");
  requireIncludes(postgresStore, phrase, "postgres audit list filters");
}
for (const phrase of [
  "event.eventType !== params.eventType",
  "event.safeMetadata.conversationId !== params.conversationId",
  "isAtOrBeforeAuditBoundary",
  "filtered.slice(0, limit)"
]) {
  requireIncludes(memoryStore, phrase, "in-memory audit viewer filtering");
}
for (const phrase of [
  "event_type = ?",
  "created_at >= ?",
  "created_at <= ?",
  "safe_metadata ->> 'conversationId' = ?",
  "params.snapshotCeiling",
  "params.cursorAfter",
  "order by created_at desc, id desc"
]) {
  requireIncludes(postgresStore, phrase, "postgres audit viewer filtering");
}
for (const forbidden of ["offset?: number", "offset $", "offsetValue"]) {
  requireExcludes(storeTypes, forbidden, "platform state audit list avoids offset pagination");
  requireExcludes(memoryStore, forbidden, "in-memory audit list avoids offset pagination");
  requireExcludes(postgresStore, forbidden, "postgres audit list avoids offset pagination");
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
  "cursor",
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
  "auditCursorHistory",
  "auditEventsResponse?.items",
  "auditEventsResponse?.nextCursor",
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
  "cursor/limit pagination",
  "snapshot ceiling",
  "Derived outcome/severity filters are applied before pagination",
  "no raw prompt, token, secret, or stored metadata payload",
  "tenant.access.denied remains blocked"
]) {
  requireIncludes(platformDocs, phrase, "platform docs cover persisted audit viewer");
}
for (const phrase of [
  "Persisted audit viewer",
  "PLATFORM_STATE_STORE_DRIVER=postgres",
  "audit.read",
  "cursor pagination",
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

function isoSecond(second: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString();
}

function assertNoProtectedMaterial(value: unknown, context: string): void {
  const serialized = JSON.stringify(value).toLowerCase();
  for (const forbidden of [
    "\"safemetadata\":",
    "\"actorsubject\":",
    "access_token",
    "refresh_token",
    "authorization header",
    "bearer secret",
    "client_secret",
    "raw prompt"
  ]) {
    if (serialized.includes(forbidden)) {
      fail(`${context} leaked protected marker: ${forbidden}`);
      return;
    }
  }
  ok(`${context} excludes protected material`);
}

async function verifyCursorPaginationRuntime(): Promise<void> {
  const filteredStore = new InMemoryPlatformStateStore();
  await filteredStore.appendAuditEvent(auditEvent({
    id: "older-blocked-event",
    tenantId: "tenant-a",
    eventType: AuditEvents.SECURITY_REQUEST_BLOCKED,
    createdAt: isoSecond(0),
    safeMetadata: {
      conversationId: "conversation-blocked",
      route: "/resolve",
      method: "POST",
      reason: "security_request_blocked",
      protectedMaterialExposed: false,
      tokenMaterialStored: false,
      rawPromptStored: false
    }
  }));
  for (let index = 1; index <= 150; index += 1) {
    await filteredStore.appendAuditEvent(auditEvent({
      id: `newer-success-${String(index).padStart(3, "0")}`,
      tenantId: "tenant-a",
      eventType: AuditEvents.GATEWAY_AUTHORIZATION_EVALUATED,
      createdAt: isoSecond(index)
    }));
  }

  const blockedPage = await listAuditViewerEventsPage({
    store: filteredStore,
    tenantId: "tenant-a",
    query: { limit: 1, outcome: "blocked" }
  });
  if (!blockedPage.ok || blockedPage.body.items.length !== 1 || blockedPage.body.items[0].id !== "older-blocked-event" || blockedPage.body.hasNext) {
    fail("outcome=blocked should find older matches beyond newer non-matching events before paging");
  } else {
    ok("outcome=blocked finds older matches beyond newer non-matching events before paging");
  }

  const highSeverityPage = await listAuditViewerEventsPage({
    store: filteredStore,
    tenantId: "tenant-a",
    query: { limit: 1, severity: "high" }
  });
  if (!highSeverityPage.ok || highSeverityPage.body.items.length !== 1 || highSeverityPage.body.items[0].id !== "older-blocked-event" || highSeverityPage.body.hasNext) {
    fail("severity=high should find older classified matches beyond newer non-matching events before paging");
  } else {
    ok("severity=high finds older classified matches beyond newer non-matching events before paging");
  }

  const stableStore = new InMemoryPlatformStateStore();
  await stableStore.appendAuditEvent(auditEvent({ id: "event-1", tenantId: "tenant-a", createdAt: isoSecond(1) }));
  await stableStore.appendAuditEvent(auditEvent({ id: "event-2", tenantId: "tenant-a", createdAt: isoSecond(2) }));
  await stableStore.appendAuditEvent(auditEvent({ id: "event-3", tenantId: "tenant-a", createdAt: isoSecond(3) }));
  const pageOne = await listAuditViewerEventsPage({
    store: stableStore,
    tenantId: "tenant-a",
    query: { limit: 2 }
  });
  if (!pageOne.ok || !pageOne.body.hasNext || !pageOne.body.nextCursor) {
    fail("first cursor page should expose a next cursor");
    return;
  }
  await stableStore.appendAuditEvent(auditEvent({ id: "new-write-between-pages", tenantId: "tenant-a", createdAt: isoSecond(4) }));
  const pageTwo = await listAuditViewerEventsPage({
    store: stableStore,
    tenantId: "tenant-a",
    query: { limit: 2, cursor: pageOne.body.nextCursor }
  });
  if (!pageTwo.ok) {
    fail("second cursor page should load after a concurrent write");
    return;
  }
  const combinedIds = [...pageOne.body.items, ...pageTwo.body.items].map((event) => event.id);
  if (combinedIds.includes("new-write-between-pages") || new Set(combinedIds).size !== combinedIds.length || combinedIds.join(",") !== "event-3,event-2,event-1") {
    fail("cursor pagination should not duplicate, skip, or include new writes in an open snapshot");
  } else {
    ok("cursor pagination is stable when new audit writes happen between requests");
  }

  await stableStore.appendAuditEvent(auditEvent({ id: "tenant-b-event", tenantId: "tenant-b", createdAt: isoSecond(5) }));
  const tenantPage = await listAuditViewerEventsPage({
    store: stableStore,
    tenantId: "tenant-a",
    query: { limit: 10 }
  });
  if (!tenantPage.ok || tenantPage.body.items.some((event) => event.tenantId !== "tenant-a")) {
    fail("cursor audit page must preserve tenant isolation");
  } else {
    ok("cursor audit page preserves tenant isolation");
  }

  const protectedStore = new InMemoryPlatformStateStore();
  await protectedStore.appendAuditEvent(auditEvent({
    id: "protected-material-source",
    tenantId: "tenant-a",
    actorSubject: "subject-must-not-return",
    createdAt: isoSecond(1),
    safeMetadata: {
      route: "/audit/events",
      method: "GET",
      reason: "Bearer secret should be hidden",
      authorization: "Bearer secret should be hidden",
      protectedMaterialExposed: false,
      tokenMaterialStored: false,
      rawPromptStored: false
    }
  }));
  const protectedPage = await listAuditViewerEventsPage({
    store: protectedStore,
    tenantId: "tenant-a",
    query: { limit: 1 }
  });
  if (!protectedPage.ok) {
    fail("protected material audit page should load");
  } else {
    assertNoProtectedMaterial(protectedPage.body, "audit response projection");
  }

  if (auditViewerDerivedFilterScanLimit < 500) {
    fail("derived filter scan limit should be high enough to cover sparse normal audit pages");
  } else {
    ok("derived filter scan limit is bounded but covers sparse normal audit pages");
  }
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
  const firstPageEvents = await store.listAuditEvents({ tenantId: "tenant-a", limit: 1 });
  const pagedEvents = await store.listAuditEvents({
    tenantId: "tenant-a",
    limit: 1,
    cursorAfter: {
      createdAt: firstPageEvents[0].createdAt,
      id: firstPageEvents[0].id
    }
  });
  if (pagedEvents.length !== 1 || pagedEvents[0].id !== "tenant-a-denied") {
    fail("audit list should return deterministic newest-first cursor pagination");
  } else {
    ok("audit list returns deterministic newest-first cursor pagination");
  }
}

Promise.all([
  verifyStoreRuntime(),
  verifyCursorPaginationRuntime()
]).then(() => {
  if (failed) {
    process.exitCode = 1;
  } else {
    console.log("Audit viewer boundary verification passed.");
  }
}).catch((error: unknown) => {
  fail(error instanceof Error ? error.message : "audit viewer runtime verification failed");
  process.exitCode = 1;
});
