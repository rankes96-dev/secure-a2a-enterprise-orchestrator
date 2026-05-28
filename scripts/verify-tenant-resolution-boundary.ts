import { existsSync, readFileSync } from "node:fs";
import type { RuntimeAuthorizationRequest } from "../packages/shared/src/index.js";
import { runtimeAuthorizationResponseSchema } from "../services/orchestrator-api/src/http/schemas/runtimeAuthorizationSchemas.js";
import { evaluateRuntimeAuthorization } from "../services/orchestrator-api/src/runtimeAuthorization/runtimeAuthorizationEvaluator.js";
import type { VerifiedUserIdentity } from "../services/orchestrator-api/src/security/userIdentity.js";
import { outcomeForEventType, severityForEventType } from "../services/orchestrator-api/src/securityEvents/securityEventClassification.js";
import { resolveTenantContext } from "../services/orchestrator-api/src/tenant/tenantResolution.js";

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

function requireOrder(source: string, first: string, second: string, context: string): void {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex > secondIndex) {
    fail(`${context} should order "${first}" before "${second}"`);
    return;
  }

  ok(context);
}

const tenantResolutionSource = read("services/orchestrator-api/src/tenant/tenantResolution.ts");
const indexSource = read("services/orchestrator-api/src/index.ts");
const runtimeEvaluatorSource = read("services/orchestrator-api/src/runtimeAuthorization/runtimeAuthorizationEvaluator.ts");
const sharedTypes = read("packages/shared/src/index.ts");
const auditEventsSource = read("services/orchestrator-api/src/audit/auditEvents.ts");
const runtimeAuthorizationSchemasSource = read("services/orchestrator-api/src/http/schemas/runtimeAuthorizationSchemas.ts");
const securityEventClassificationSource = read("services/orchestrator-api/src/securityEvents/securityEventClassification.ts");
const packageJsonSource = read("package.json");
const platformDocs = read("docs/v2-platform-foundation.md");
const sdkDocs = read("docs/sdk-readiness-contracts.md");
const productIdentityDocs = read("docs/ogen-product-identity.md");

for (const phrase of [
  "export type TenantResolutionSource",
  "export type ResolvedTenantContext",
  "export function resolveTenantContext",
  "requestedTenantId",
  "requestedTenantAccepted",
  "Requested tenant is not authorized",
  "function cleanTenantId(value: unknown)",
  'typeof value === "string"',
  "defaultTenantId()",
  "auth0_org",
  "email_domain_mapping"
]) {
  requireIncludes(tenantResolutionSource, phrase, "tenant resolution boundary exists");
}

for (const phrase of [
  "tenantContextForRequest",
  "resolveTenantContext({ identity, requestedTenantId })",
  "sendTenantAccessDenied",
  "appendTenantAccessDeniedAuditEvent",
  "safeOptionalString",
  "safeConversationIdFromBody",
  "safeRequestIdFromBody",
  "validateResolveRequest",
  "tenant_access_denied",
  "message must be a non-empty string",
  "tenantId must be a string when provided",
  "conversationId must be a string when provided",
  "verifyUserDirectoryAccess({ identity, tenantId: tenantContext.tenantId",
  "identity: identitySession.identity",
  "tenantId: tenantContext.tenantId",
  "tenantResolutionSource",
  "requestedTenantAccepted"
]) {
  requireIncludes(indexSource, phrase, "server uses resolved tenant context");
}

const validateResolveStart = indexSource.indexOf("function validateResolveRequest(value: unknown): string | undefined");
const validateResolveEnd = indexSource.indexOf("function clientApiKey", validateResolveStart);
if (validateResolveStart < 0 || validateResolveEnd < validateResolveStart) {
  fail("validateResolveRequest should exist before request handling");
} else {
  ok("validateResolveRequest exists");
  const validateResolveSource = indexSource.slice(validateResolveStart, validateResolveEnd);
  for (const phrase of [
    "const body = objectRecord(value)",
    "request body must be an object",
    'typeof body.message !== "string"',
    "message must be a non-empty string",
    'typeof body.conversationId !== "string"',
    "conversationId must be a string when provided",
    'typeof body.tenantId !== "string"',
    "tenantId must be a string when provided"
  ]) {
    requireIncludes(validateResolveSource, phrase, "validateResolveRequest validates safe resolve body shape");
  }
}

const runtimeRouteStart = indexSource.indexOf('request.url === "/runtime/authorize"');
const resolveRouteStart = indexSource.indexOf('request.url !== "/resolve"');
const runtimeRoute = indexSource.slice(runtimeRouteStart, resolveRouteStart > runtimeRouteStart ? resolveRouteStart : undefined);
for (const phrase of [
  "const tenantContext = tenantContextForRequest(identitySession.identity, requestBody.tenantId)",
  "if (!requireRequestedTenantAllowed(tenantContext))",
  "await appendTenantAccessDeniedAuditEvent",
  'route: "/runtime/authorize"',
  "requestId: safeRequestIdFromBody(requestBodyUnknown)",
  "conversationId: safeConversationIdFromBody(requestBodyUnknown)",
  "sendTenantAccessDenied(response, request, tenantContext)",
  "tenantId: tenantContext.tenantId",
  "tenantResolution: tenantContext"
]) {
  requireIncludes(runtimeRoute, phrase, "runtime authorization route uses resolved tenant and rejects unauthorized requested tenant");
}
requireOrder(runtimeRoute, "await appendTenantAccessDeniedAuditEvent", "sendTenantAccessDenied(response, request, tenantContext)", "/runtime/authorize audits tenant denial before response");
requireOrder(runtimeRoute, "sendTenantAccessDenied(response, request, tenantContext)", "requireGatewayCapability", "/runtime/authorize rejects unauthorized tenant before gateway RBAC");
requireOrder(runtimeRoute, "sendTenantAccessDenied(response, request, tenantContext)", "evaluateRuntimeAuthorization", "/runtime/authorize rejects unauthorized tenant before runtime policy evaluation");
const runtimeTenantDeniedBranchStart = runtimeRoute.indexOf("if (!requireRequestedTenantAllowed(tenantContext))");
const runtimeTenantDeniedBranchEnd = runtimeRoute.indexOf("return;", runtimeTenantDeniedBranchStart);
const runtimeTenantDeniedBranch = runtimeTenantDeniedBranchStart >= 0 && runtimeTenantDeniedBranchEnd > runtimeTenantDeniedBranchStart
  ? runtimeRoute.slice(runtimeTenantDeniedBranchStart, runtimeTenantDeniedBranchEnd)
  : "";
requireIncludes(runtimeTenantDeniedBranch, "await appendTenantAccessDeniedAuditEvent", "/runtime/authorize tenant denial branch emits tenant.access.denied");
requireExcludes(runtimeTenantDeniedBranch, "evaluateRuntimeAuthorization", "/runtime/authorize tenant denial branch does not evaluate runtime policy");
requireExcludes(runtimeTenantDeniedBranch, "appendRuntimeAuthorizationEvaluatedAuditEvent", "/runtime/authorize tenant denial branch does not emit success/info runtime evaluation");
requireExcludes(runtimeRoute, "appendRuntimeAuthorizationTenantDeniedAuditEvent", "/runtime/authorize does not use legacy runtime tenant-denial helper");

const resolveRoute = indexSource.slice(resolveRouteStart);
for (const phrase of [
  "const requestBodyUnknown = await readJsonBody<unknown>(request)",
  "const normalizedResolve = normalizeResolveRequestInput(requestBodyUnknown)",
  "const resolveValidationError = validateResolveRequest(normalizedResolve.value)",
  'error: "invalid_resolve_request"',
  "const requestBody = normalizedResolve.value as ResolveRequest",
  "normalizedResolve.requestedCompatibilityEnvelope ? undefined : requestedTenantIdFromBody(requestBodyUnknown)",
  "if (!requireRequestedTenantAllowed(tenantContext))",
  "await appendTenantAccessDeniedAuditEvent",
  "conversationId: requestBody.conversationId",
  "await resolveIssue(requestBody, identitySession.sessionToken, tenantContext)"
]) {
  requireIncludes(resolveRoute, phrase, "/resolve uses resolved tenant context");
}

if (resolveRoute.indexOf("await appendTenantAccessDeniedAuditEvent") > resolveRoute.indexOf("sendTenantAccessDenied(response, request, tenantContext)")) {
  fail("/resolve should audit tenant denial before sending tenant access denied response");
} else {
  ok("/resolve audits tenant denial before response");
}

if (indexSource.includes("tenantId: requestBody.tenantId") || indexSource.includes("tenantId: body.tenantId")) {
  fail("server must not use request body tenantId as authoritative tenantId");
} else {
  ok("server does not use request body tenantId as authority");
}
if (indexSource.includes("defaultTenantId()")) {
  fail("index.ts should use tenant resolution boundary instead of direct defaultTenantId()");
} else {
  ok("index.ts does not directly call defaultTenantId()");
}

for (const phrase of [
  "tenantResolution?:",
  "requestedTenantAccepted"
]) {
  requireIncludes(sharedTypes, phrase, "shared runtime authorization response exposes safe tenant resolution summary");
}

requireIncludes(auditEventsSource, 'TENANT_ACCESS_DENIED: "tenant.access.denied"', "tenant access denied audit event exists");

for (const phrase of [
  "AuditEvents.TENANT_ACCESS_DENIED",
  "route",
  "requestId: safeRequestId",
  "conversationId: safeConversationId",
  "safeOptionalString(requestId)",
  "safeOptionalString(conversationId)",
  "tenantResolutionSource",
  "requestedTenantId",
  "requestedTenantAccepted",
  "protectedMaterialExposed: false",
  "tokenMaterialStored: false",
  "rawPromptStored: false"
]) {
  requireIncludes(indexSource, phrase, "tenant denied audit metadata is safe");
}
const tenantDeniedAuditHelperStart = indexSource.indexOf("async function appendTenantAccessDeniedAuditEvent");
const tenantDeniedAuditHelperEnd = indexSource.indexOf("\nasync function", tenantDeniedAuditHelperStart + 1);
const tenantDeniedAuditHelper = tenantDeniedAuditHelperStart >= 0 && tenantDeniedAuditHelperEnd > tenantDeniedAuditHelperStart
  ? indexSource.slice(tenantDeniedAuditHelperStart, tenantDeniedAuditHelperEnd)
  : "";
for (const forbidden of [
  "requestBody.message",
  "message:",
  "access_token",
  "refresh_token",
  "Authorization",
  "Bearer",
  "client_assertion",
  "private_key",
  "client_secret",
  "authorization_code",
  "cookie",
  "jwt"
]) {
  requireExcludes(tenantDeniedAuditHelper, forbidden, "tenant denied audit helper avoids protected material");
}
if (resolveRoute.includes("conversationId: requestBodyUnknown") || resolveRoute.includes("conversationId: (requestBodyUnknown")) {
  fail("/resolve tenant denial must not audit raw requestBodyUnknown conversationId");
} else {
  ok("/resolve tenant denial does not audit raw requestBodyUnknown conversationId");
}
if (indexSource.includes("requestId: requestBody.requestId")) {
  fail("tenant denial audit must not audit raw requestBody.requestId");
} else {
  ok("tenant denial audit does not audit raw requestBody.requestId");
}

for (const phrase of [
  'eventType === "tenant.access.denied"',
  'return "blocked"',
  'return "high"'
]) {
  requireIncludes(securityEventClassificationSource, phrase, "tenant access denied security event classification");
}
if (outcomeForEventType("tenant.access.denied") !== "blocked") {
  fail("tenant.access.denied must classify as blocked");
} else {
  ok("tenant.access.denied classifies as blocked");
}
if (severityForEventType("tenant.access.denied") === "info") {
  fail("tenant.access.denied severity must not classify as info");
} else {
  ok("tenant.access.denied severity is warning-or-higher");
}

for (const phrase of [
  "tenantResolution:",
  'required: ["source", "requestedTenantAccepted"]',
  "requestedTenantAccepted"
]) {
  requireIncludes(runtimeAuthorizationSchemasSource, phrase, "runtime authorization response schema includes tenant resolution");
}

for (const phrase of [
  "tenantResolution?: ResolvedTenantContext",
  "tenantResolution.requestedTenantAccepted"
]) {
  requireIncludes(runtimeEvaluatorSource, phrase, "runtime authorization evaluator returns resolved tenant summary");
}

const parsedPackageJson = JSON.parse(packageJsonSource) as { scripts?: Record<string, string> };
if (parsedPackageJson.scripts?.["verify:tenant-resolution-boundary"] !== "tsx scripts/verify-tenant-resolution-boundary.ts") {
  fail("package.json should include verify:tenant-resolution-boundary");
} else {
  ok("package.json includes verify:tenant-resolution-boundary");
}
if (!parsedPackageJson.scripts?.["verify:v2-plan"]?.includes("verify:browser-session-csrf-guard && npm run verify:tenant-resolution-boundary")) {
  fail("verify:v2-plan should run tenant resolution boundary after browser session CSRF guard");
} else {
  ok("verify:v2-plan includes tenant resolution boundary after browser session CSRF guard");
}

for (const phrase of [
  "Phase 2.17  Tenant Resolution Boundary",
  "tenantId is resolved by Ogen",
  "client-supplied tenantId is a hint, not authority",
  "configured default tenant",
  "Auth0 org/domain mapping",
  "policy, audit, user directory, connector trust",
  "Malformed tenant and conversation hints fail safely",
  "Tenant switching attempts through `/resolve` and `/runtime/authorize` are audited as tenant access denied",
  "Tenant denial audit records only validated string identifiers",
  "Tenant access denials are exported as blocked security events"
]) {
  requireIncludes(platformDocs, phrase, "platform docs cover tenant resolution boundary");
}
for (const phrase of [
  "SDK may send tenantId as context hint",
  "Ogen resolves the authoritative tenant",
  "SDK must not assume tenant selection is accepted"
]) {
  requireIncludes(sdkDocs, phrase, "SDK docs cover tenant hint boundary");
}
requireIncludes(productIdentityDocs, "Ogen resolves tenant context; clients cannot choose arbitrary tenants.", "product identity docs cover tenant resolution principle");

const originalDefaultTenantId = process.env.DEFAULT_TENANT_ID;
process.env.DEFAULT_TENANT_ID = "default";

const noRequested = resolveTenantContext({});
if (noRequested.tenantId !== "default" || !noRequested.requestedTenantAccepted) {
  fail("missing requested tenant should resolve to configured default and be accepted");
} else {
  ok("missing requested tenant resolves to configured default");
}

const matchingRequested = resolveTenantContext({ requestedTenantId: "default" });
if (matchingRequested.tenantId !== "default" || !matchingRequested.requestedTenantAccepted) {
  fail("matching requested tenant should be accepted");
} else {
  ok("matching requested tenant is accepted");
}

const rejectedRequested = resolveTenantContext({ requestedTenantId: "evil" });
if (rejectedRequested.tenantId !== "default" || rejectedRequested.requestedTenantAccepted) {
  fail("different requested tenant should be rejected and resolved to configured default");
} else {
  ok("different requested tenant is rejected and does not switch tenant");
}

const auth0OrgRequested = resolveTenantContext({
  identity: {
    provider: "auth0",
    email: "org-user@example.com",
    roles: ["end_user"],
    issuer: "https://idp.ogen.local",
    audience: "ogen-gateway",
    subject: "auth0|org-user",
    org_id: "org_enterprise"
  },
  requestedTenantId: "org_enterprise"
});
if (auth0OrgRequested.tenantId !== "org_enterprise" || auth0OrgRequested.source !== "auth0_org" || !auth0OrgRequested.requestedTenantAccepted) {
  fail("Auth0 org claim should resolve and accept the matching org tenant");
} else {
  ok("Auth0 org claim resolves and accepts matching org tenant");
}

let malformedTenantHint: ReturnType<typeof resolveTenantContext> | undefined;
try {
  malformedTenantHint = resolveTenantContext({ requestedTenantId: 123 as unknown });
} catch (error) {
  fail(`malformed requested tenant should not throw: ${error instanceof Error ? error.message : String(error)}`);
}
if (malformedTenantHint && (malformedTenantHint.tenantId !== "default" || !malformedTenantHint.requestedTenantAccepted)) {
  fail("non-string requested tenant should be ignored by tenant resolution");
} else if (malformedTenantHint) {
  ok("non-string requested tenant is ignored safely by tenant resolution");
}

const responseSchemaProperties = (runtimeAuthorizationResponseSchema as {
  properties?: Record<string, unknown>;
}).properties;
const tenantResolutionSchema = responseSchemaProperties?.tenantResolution as {
  required?: string[];
  properties?: Record<string, unknown>;
} | undefined;
if (
  !tenantResolutionSchema ||
  !tenantResolutionSchema.required?.includes("source") ||
  !tenantResolutionSchema.required?.includes("requestedTenantAccepted") ||
  !tenantResolutionSchema.properties?.requestedTenantId
) {
  fail("runtime authorization response schema should accept tenantResolution summary");
} else {
  ok("runtime authorization response schema accepts tenantResolution summary");
}

const identity: VerifiedUserIdentity = {
  provider: "mock",
  email: "tenant-boundary@example.com",
  roles: ["employee"],
  issuer: "https://idp.ogen.local",
  audience: "ogen-gateway",
  subject: "user-tenant-boundary"
};

const request: RuntimeAuthorizationRequest = {
  tenantId: "evil",
  actor: {
    email: "caller@example.com"
  },
  targetAgent: {
    agentId: "servicenow-agent",
    connectorId: "servicenow-reference",
    resourceSystem: "servicenow"
  },
  action: {
    skillId: "servicenow.ticket.status.lookup",
    executionType: "inspection_read_only",
    riskLevel: "low",
    requiresApproval: false,
    sensitivity: "standard"
  },
  connectorRoute: {
    runtimeMode: "external_runtime_available"
  }
};
const runtimeDecision = evaluateRuntimeAuthorization({
  request,
  identity,
  tenantId: rejectedRequested.tenantId,
  tenantResolution: rejectedRequested
});
if (runtimeDecision.tenantId !== "default" || runtimeDecision.tenantResolution?.requestedTenantAccepted !== false) {
  fail("runtime authorization should use resolved tenant, not raw requested tenant");
} else {
  ok("runtime authorization uses resolved tenant context");
}
if (runtimeDecision.policy.inputHash.includes("evil")) {
  fail("policy proof should not expose raw requested tenant as authority");
} else {
  ok("policy proof is based on resolved tenant context");
}

if (originalDefaultTenantId === undefined) {
  delete process.env.DEFAULT_TENANT_ID;
} else {
  process.env.DEFAULT_TENANT_ID = originalDefaultTenantId;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Tenant resolution boundary verification passed.");
}
