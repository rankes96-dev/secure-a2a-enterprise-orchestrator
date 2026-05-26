import { existsSync, readFileSync } from "node:fs";
import type { RuntimeAuthorizationRequest } from "../packages/shared/src/index.js";
import { evaluateRuntimeAuthorization } from "../services/orchestrator-api/src/runtimeAuthorization/runtimeAuthorizationEvaluator.js";
import type { VerifiedUserIdentity } from "../services/orchestrator-api/src/security/userIdentity.js";
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

const tenantResolutionSource = read("services/orchestrator-api/src/tenant/tenantResolution.ts");
const indexSource = read("services/orchestrator-api/src/index.ts");
const runtimeEvaluatorSource = read("services/orchestrator-api/src/runtimeAuthorization/runtimeAuthorizationEvaluator.ts");
const sharedTypes = read("packages/shared/src/index.ts");
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
  "appendRuntimeAuthorizationTenantDeniedAuditEvent",
  "tenant_access_denied",
  "verifyUserDirectoryAccess({ identity, tenantId: tenantContext.tenantId",
  "identity: identitySession.identity",
  "tenantId: tenantContext.tenantId",
  "tenantResolutionSource",
  "requestedTenantAccepted"
]) {
  requireIncludes(indexSource, phrase, "server uses resolved tenant context");
}

const runtimeRouteStart = indexSource.indexOf('request.url === "/runtime/authorize"');
const resolveRouteStart = indexSource.indexOf('request.url !== "/resolve"');
const runtimeRoute = indexSource.slice(runtimeRouteStart, resolveRouteStart > runtimeRouteStart ? resolveRouteStart : undefined);
for (const phrase of [
  "const tenantContext = tenantContextForRequest(identitySession.identity, requestBody.tenantId)",
  "if (!requireRequestedTenantAllowed(tenantContext))",
  "await appendRuntimeAuthorizationTenantDeniedAuditEvent",
  "sendTenantAccessDenied(response, request, tenantContext)",
  "tenantId: tenantContext.tenantId",
  "tenantResolution: tenantContext"
]) {
  requireIncludes(runtimeRoute, phrase, "runtime authorization route uses resolved tenant and rejects unauthorized requested tenant");
}

const resolveRoute = indexSource.slice(resolveRouteStart);
for (const phrase of [
  "tenantContextForRequest(identitySession.identity, requestedTenantIdFromBody(requestBody))",
  "if (!requireRequestedTenantAllowed(tenantContext))",
  "await resolveIssue(requestBody, identitySession.sessionToken, tenantContext)"
]) {
  requireIncludes(resolveRoute, phrase, "/resolve uses resolved tenant context");
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
  "policy, audit, user directory, connector trust"
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
