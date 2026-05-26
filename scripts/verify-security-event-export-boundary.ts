import { existsSync, readFileSync } from "node:fs";
import { createSecurityEventSink, resetSecurityEventSinkForTests } from "../services/orchestrator-api/src/securityEvents/createSecurityEventSink.js";
import { securityEventFromAuditEvent } from "../services/orchestrator-api/src/securityEvents/securityEventPublisher.js";
import type { StoredAuditEvent } from "../services/orchestrator-api/src/state/platformStateStore.js";

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

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    fail(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const typesPath = "services/orchestrator-api/src/securityEvents/securityEventTypes.ts";
const classificationPath = "services/orchestrator-api/src/securityEvents/securityEventClassification.ts";
const sinksPath = "services/orchestrator-api/src/securityEvents/securityEventSinks.ts";
const factoryPath = "services/orchestrator-api/src/securityEvents/createSecurityEventSink.ts";
const publisherPath = "services/orchestrator-api/src/securityEvents/securityEventPublisher.ts";
const platformAuditStorePath = "services/orchestrator-api/src/audit/platformAuditStore.ts";
const indexPath = "services/orchestrator-api/src/index.ts";

const types = read(typesPath);
const classification = read(classificationPath);
const sinks = read(sinksPath);
const factory = read(factoryPath);
const publisher = read(publisherPath);
const platformAuditStore = read(platformAuditStorePath);
const indexSource = read(indexPath);
const packageJson = read("package.json");
const plan = read("docs/v2-platform-foundation.md");
const inventory = read("docs/v2-state-inventory.md");

for (const phrase of [
  "SecurityEventEnvelope",
  "SecurityEventSink",
  "schemaVersion",
  "severity",
  "outcome",
  "conversationId",
  "requestId",
  "taskId",
  "connectorId",
  "runtimeExecutionId",
  "safeMetadata: Record<string, unknown>"
]) {
  requireIncludes(types, phrase, "security event types");
}

for (const forbidden of [
  "access" + "_token",
  "refresh" + "_token",
  "Authorization",
  "Bearer",
  "client" + "_assertion",
  "private" + "_key",
  "client" + "_secret",
  "authorization" + "_code",
  "cookie",
  "jwt"
]) {
  requireExcludes(types, forbidden, "security event types");
}

for (const phrase of [
  "severityForEventType",
  "outcomeForEventType",
  "user.identity.verified",
  "connector.runtime.failed",
  "connector.runtime.authorization_required",
  "security.request.blocked",
  "tenant.access.denied",
  "eventType.includes(\"blocked\")",
  "eventType.includes(\"failed\")"
]) {
  requireIncludes(classification, phrase, "security event classification");
}

for (const phrase of [
  "NoopSecurityEventSink",
  "ConsoleSecurityEventSink",
  "CompositeSecurityEventSink",
  "console.info",
  "eventType: event.eventType",
  "severity: event.severity",
  "outcome: event.outcome",
  "resourceType: event.resourceType",
  "resourceId: event.resourceId"
]) {
  requireIncludes(sinks, phrase, "security event sinks");
}

for (const forbidden of [
  "event.safeMetadata",
  "safeMetadata:",
  "actorEmail",
  "access" + "_token",
  "refresh" + "_token",
  "Authorization",
  "Bearer",
  "client" + "_assertion",
  "private" + "_key",
  "client" + "_secret",
  "authorization" + "_code"
]) {
  requireExcludes(sinks, forbidden, "security event sink code");
}

for (const phrase of [
  "createSecurityEventSink",
  "process.env.SECURITY_EVENT_SINK ?? \"noop\"",
  "new NoopSecurityEventSink()",
  "new ConsoleSecurityEventSink()",
  "\"webhook\"",
  "\"opentelemetry\"",
  "\"splunk\"",
  "\"sentinel\"",
  "\"elastic\"",
  "\"datadog\"",
  "is planned but not implemented in this checkpoint",
  "getSecurityEventSink",
  "resetSecurityEventSinkForTests"
]) {
  requireIncludes(factory, phrase, "security event sink factory");
}

for (const phrase of [
  "securityEventFromAuditEvent",
  "publishSecurityEventFromAuditEvent",
  "secure-a2a.security-event.v1",
  "severityForEventType(event.eventType)",
  "outcomeForEventType(event.eventType)",
  "conversationId",
  "requestId",
  "taskId",
  "connectorId",
  "runtimeExecutionId",
  "getSecurityEventSink().publish"
]) {
  requireIncludes(publisher, phrase, "security event publisher");
}

for (const phrase of [
  "publishSecurityEventFromAuditEvent",
  "await publishSecurityEventFromAuditEvent(event)"
]) {
  requireIncludes(platformAuditStore, phrase, "platform audit store publish hook");
}

for (const phrase of [
  '"verify:security-event-export-boundary": "tsx scripts/verify-security-event-export-boundary.ts"',
  "verify:platform-audit-write-through",
  "verify:platform-conversation-state",
  "verify:security-event-export-boundary"
]) {
  requireIncludes(packageJson, phrase, "package scripts");
}

for (const phrase of [
  "Phase 2.4 implements the internal `SecurityEventSink` boundary",
  "Default sink is `noop`",
  "Console sink is local diagnostic only and does not log full metadata",
  "Vendor sinks remain future work",
  "schemaVersion `secure-a2a.security-event.v1`",
  "Publish failures must not break runtime or audit write-through"
]) {
  requireIncludes(plan, phrase, "V2 platform foundation doc");
}

for (const phrase of [
  "Phase 2.4 adds a vendor-neutral export boundary",
  "stored audit events can be converted to security event envelopes",
  "external export remains disabled by default"
]) {
  requireIncludes(inventory, phrase, "V2 state inventory");
}

const parsedPackageJson = JSON.parse(packageJson) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const dependencyNames = Object.keys({
  ...(parsedPackageJson.dependencies ?? {}),
  ...(parsedPackageJson.devDependencies ?? {})
});

for (const forbidden of ["splunk", "sentinel", "datadog", "opentelemetry", "otel", "prisma", "drizzle"]) {
  if (dependencyNames.some((name) => name.toLowerCase().includes(forbidden))) {
    fail(`Phase 2.4 should not introduce dependency: ${forbidden}`);
  }
}

function fakeAuditEvent(eventType: string): StoredAuditEvent {
  return {
    id: `audit-${eventType}`,
    tenantId: "tenant-1",
    actorProvider: "auth0",
    actorSubject: "user-123",
    actorEmail: "user@example.com",
    eventType,
    resourceType: "connector",
    resourceId: "jira",
    createdAt: "2026-05-24T00:00:00.000Z",
    safeMetadata: {
      conversationId: "conversation-1",
      requestId: "request-1",
      taskId: "task-1",
      connectorId: "connector-1",
      runtimeExecutionId: "runtime-1",
      nested: {
        proof: "safe"
      }
    }
  };
}

const runtimeCases: Array<[string, string, string]> = [
  ["user.identity.verified", "info", "success"],
  ["connector.runtime.failed", "medium", "failure"],
  ["connector.runtime.authorization_required", "low", "needs_action"],
  ["security.request.blocked", "high", "blocked"],
  ["tenant.access.denied", "high", "blocked"]
];

for (const [eventType, expectedSeverity, expectedOutcome] of runtimeCases) {
  const auditEvent = fakeAuditEvent(eventType);
  const originalMetadata = JSON.stringify(auditEvent.safeMetadata);
  const envelope = securityEventFromAuditEvent(auditEvent);

  assertEqual(envelope.schemaVersion, "secure-a2a.security-event.v1", `${eventType} schema version`);
  assertEqual(envelope.severity, expectedSeverity, `${eventType} severity`);
  assertEqual(envelope.outcome, expectedOutcome, `${eventType} outcome`);
  assertEqual(envelope.conversationId, "conversation-1", `${eventType} conversationId`);
  assertEqual(envelope.requestId, "request-1", `${eventType} requestId`);
  assertEqual(envelope.taskId, "task-1", `${eventType} taskId`);
  assertEqual(envelope.connectorId, "connector-1", `${eventType} connectorId`);
  assertEqual(envelope.runtimeExecutionId, "runtime-1", `${eventType} runtimeExecutionId`);
  assertEqual(envelope.safeMetadata.nested instanceof Object, true, `${eventType} safeMetadata preserved`);
  assertEqual(JSON.stringify(auditEvent.safeMetadata), originalMetadata, `${eventType} source audit event should not mutate`);
}

const tenantDeniedEnvelope = securityEventFromAuditEvent(fakeAuditEvent("tenant.access.denied"));
if (tenantDeniedEnvelope.outcome !== "blocked") {
  fail("tenant.access.denied must export with blocked outcome");
}
if (tenantDeniedEnvelope.outcome === "success") {
  fail("tenant.access.denied must not export as success");
}
if (tenantDeniedEnvelope.severity === "info") {
  fail("tenant.access.denied must not export as info severity");
}

const runtimeAuthorizeRouteStart = indexSource.indexOf('request.url === "/runtime/authorize"');
const resolveRouteStart = indexSource.indexOf('request.url !== "/resolve"');
if (runtimeAuthorizeRouteStart < 0) {
  fail("POST /runtime/authorize route should exist for security event tenant-denial export verification");
} else {
  const runtimeRoute = indexSource.slice(runtimeAuthorizeRouteStart, resolveRouteStart > runtimeAuthorizeRouteStart ? resolveRouteStart : undefined);
  requireIncludes(runtimeRoute, "if (!requireRequestedTenantAllowed(tenantContext))", "runtime tenant denial branch");
  requireIncludes(runtimeRoute, "await appendTenantAccessDeniedAuditEvent", "runtime tenant denial exports tenant.access.denied");
  requireIncludes(runtimeRoute, 'route: "/runtime/authorize"', "runtime tenant denial export route metadata");
  if (runtimeRoute.includes("appendRuntimeAuthorizationTenantDeniedAuditEvent")) {
    fail("runtime tenant denial must not export only as runtime.authorization.evaluated");
  }
}

const previousSink = process.env.SECURITY_EVENT_SINK;
try {
  delete process.env.SECURITY_EVENT_SINK;
  resetSecurityEventSinkForTests();
  const defaultSink = createSecurityEventSink();
  assertEqual(defaultSink.constructor.name, "NoopSecurityEventSink", "default security event sink");

  for (const planned of ["webhook", "opentelemetry", "splunk", "sentinel", "elastic", "datadog"]) {
    try {
      createSecurityEventSink(planned);
      fail(`SECURITY_EVENT_SINK=${planned} should fail closed`);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("is planned but not implemented in this checkpoint")) {
        fail(`SECURITY_EVENT_SINK=${planned} should throw the planned-not-implemented error`);
      }
    }
  }
} finally {
  resetSecurityEventSinkForTests();
  if (previousSink === undefined) {
    delete process.env.SECURITY_EVENT_SINK;
  } else {
    process.env.SECURITY_EVENT_SINK = previousSink;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Security event export boundary verification passed.");
}
