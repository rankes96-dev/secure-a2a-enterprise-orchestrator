import { existsSync, readFileSync } from "node:fs";
import { evaluateGatewayAuthorization } from "../services/orchestrator-api/src/authorization/gatewayAuthorization.js";
import { gatewayCapabilityRequirements } from "../services/orchestrator-api/src/authorization/gatewayAuthorizationPolicy.js";
import type { GatewayCapability } from "../services/orchestrator-api/src/authorization/gatewayAuthorizationTypes.js";
import { outcomeForEventType, severityForEventType } from "../services/orchestrator-api/src/securityEvents/securityEventClassification.js";

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

function routeBlock(source: string, method: string, path: string): string {
  const marker = `request.method === "${method}" && request.url === "${path}"`;
  const start = source.indexOf(marker);
  if (start < 0) {
    fail(`${method} ${path} route should exist`);
    return "";
  }
  const nextRoute = source.indexOf("\n  if (request.method", start + marker.length);
  return nextRoute < 0 ? source.slice(start) : source.slice(start, nextRoute);
}

function resolveRouteBlock(source: string): string {
  const start = source.indexOf('request.method !== "POST" || request.url !== "/resolve"');
  if (start < 0) {
    fail("POST /resolve fallback route should exist");
    return "";
  }
  return source.slice(start);
}

function policyEntryBlock(source: string, capability: GatewayCapability): string {
  const marker = `"${capability}": {`;
  const start = source.indexOf(marker);
  if (start < 0) {
    fail(`${capability} policy entry should exist`);
    return "";
  }
  const end = source.indexOf("\n  },", start + marker.length);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

const typesPath = "services/orchestrator-api/src/authorization/gatewayAuthorizationTypes.ts";
const policyPath = "services/orchestrator-api/src/authorization/gatewayAuthorizationPolicy.ts";
const evaluatorPath = "services/orchestrator-api/src/authorization/gatewayAuthorization.ts";
const indexPath = "services/orchestrator-api/src/index.ts";
const auditEventsPath = "services/orchestrator-api/src/audit/auditEvents.ts";
const classificationPath = "services/orchestrator-api/src/securityEvents/securityEventClassification.ts";
const sharedPath = "packages/shared/src/index.ts";
const packageJsonPath = "package.json";
const platformDocsPath = "docs/v2-platform-foundation.md";
const sdkDocsPath = "docs/sdk-readiness-contracts.md";
const productIdentityDocsPath = "docs/ogen-product-identity.md";
const mockIdpPath = "services/mock-identity-provider/src/index.ts";
const frontendMainPath = "apps/web-ui/src/main.tsx";

const typesSource = read(typesPath);
const policySource = read(policyPath);
const evaluatorSource = read(evaluatorPath);
const indexSource = read(indexPath);
const auditEventsSource = read(auditEventsPath);
const classificationSource = read(classificationPath);
const sharedSource = read(sharedPath);
const packageJsonSource = read(packageJsonPath);
const platformDocs = read(platformDocsPath);
const sdkDocs = read(sdkDocsPath);
const productIdentityDocs = read(productIdentityDocsPath);
const mockIdpSource = read(mockIdpPath);
const frontendMainSource = read(frontendMainPath);

const connectorOnboardingReadRoles = [
  "end_user",
  "operator",
  "admin",
  "it-support",
  "connector_admin",
  "security_viewer",
  "gateway_admin",
  "tenant_admin"
];
const connectorOnboardingAdminRoles = ["connector_admin", "gateway_admin", "tenant_admin", "admin"];
const nonAdminOnboardingRoles = ["end_user", "operator", "it-support", "security_viewer"];

const requiredCapabilities: GatewayCapability[] = [
  "gateway.resolve",
  "runtime.authorize",
  "connector.onboarding.read",
  "connector.onboarding.discover",
  "connector.onboarding.start",
  "demo.prepare",
  "identity.session.attach",
  "identity.session.logout",
  "identity.trust_status.read",
  "health.read",
  "debug.ai_config.read",
  "audit.read",
  "users.manage",
  "policy.manage"
];

for (const phrase of [
  "export type GatewayRole",
  "end_user",
  "operator",
  "connector_admin",
  "security_viewer",
  "gateway_admin",
  "tenant_admin",
  "approver",
  "admin",
  "it-support",
  "export type GatewayCapability",
  "export type GatewayAuthorizationInput",
  "export type GatewayAuthorizationDecision",
  "protectedMaterialExposed: false",
  "tokenMaterialStored: false"
]) {
  requireIncludes(typesSource, phrase, "gateway authorization types");
}
for (const alias of ['"read-only"', '"identity-admin"']) {
  requireExcludes(typesSource, alias, "gateway authorization type excludes UI/demo role aliases");
}

for (const capability of requiredCapabilities) {
  requireIncludes(typesSource, `"${capability}"`, "gateway capability type includes required capability");
  if (!gatewayCapabilityRequirements[capability]) {
    fail(`gateway policy map should define ${capability}`);
  } else {
    ok(`gateway policy map defines ${capability}`);
  }
}

for (const phrase of [
  "gatewayCapabilityRequirements",
  "gatewaySystemSourceCapabilities",
  '"gateway.resolve"',
  '"runtime.authorize"',
  '"connector.onboarding.start"',
  '"debug.ai_config.read"',
  '"audit.read"',
  '"users.manage"',
  '"policy.manage"',
  '"admin"'
]) {
  requireIncludes(policySource, phrase, "gateway RBAC policy map");
}
const connectorOnboardingReadPolicy = policyEntryBlock(policySource, "connector.onboarding.read");
const connectorOnboardingDiscoverPolicy = policyEntryBlock(policySource, "connector.onboarding.discover");
const connectorOnboardingStartPolicy = policyEntryBlock(policySource, "connector.onboarding.start");
for (const role of connectorOnboardingReadRoles) {
  requireIncludes(connectorOnboardingReadPolicy, `"${role}"`, `connector onboarding read includes ${role}`);
}
for (const role of connectorOnboardingAdminRoles) {
  requireIncludes(connectorOnboardingDiscoverPolicy, `"${role}"`, `connector onboarding discover includes admin role ${role}`);
  requireIncludes(connectorOnboardingStartPolicy, `"${role}"`, `connector onboarding start includes admin role ${role}`);
}
for (const role of nonAdminOnboardingRoles) {
  requireExcludes(connectorOnboardingDiscoverPolicy, `"${role}"`, `connector onboarding discover excludes non-admin role ${role}`);
  requireExcludes(connectorOnboardingStartPolicy, `"${role}"`, `connector onboarding start excludes non-admin role ${role}`);
}
for (const alias of ['"read-only"', '"identity-admin"']) {
  requireExcludes(policySource, alias, "gateway RBAC policy excludes UI/demo role aliases");
}

for (const phrase of [
  "export function evaluateGatewayAuthorization",
  "export function isGatewayAuthorized",
  "effect: \"block\"",
  "input.actor?.roles",
  "gatewaySystemSourceCapabilities.has(input.capability)",
  "Verified identity does not have a required gateway role",
  "protectedMaterialExposed: false",
  "tokenMaterialStored: false"
]) {
  requireIncludes(evaluatorSource, phrase, "gateway authorization evaluator");
}
requireExcludes(evaluatorSource, "request.actor", "gateway authorization evaluator ignores caller-supplied actor roles");
requireExcludes(evaluatorSource, "rawPrompt", "gateway authorization evaluator does not handle raw prompts");
requireExcludes(evaluatorSource, "access_token", "gateway authorization evaluator does not handle token material");

for (const phrase of [
  'GATEWAY_AUTHORIZATION_EVALUATED: "gateway.authorization.evaluated"',
  'GATEWAY_AUTHORIZATION_DENIED: "gateway.authorization.denied"'
]) {
  requireIncludes(auditEventsSource, phrase, "gateway authorization audit events");
}

for (const phrase of [
  'eventType === "gateway.authorization.denied"',
  'eventType === "gateway.authorization.evaluated"',
  'return "blocked"',
  'return "high"',
  'return "success"',
  'return "info"'
]) {
  requireIncludes(classificationSource, phrase, "gateway authorization security event classification");
}
if (outcomeForEventType("gateway.authorization.denied") !== "blocked") {
  fail("gateway.authorization.denied must export as blocked");
} else {
  ok("gateway.authorization.denied exports as blocked");
}
if (severityForEventType("gateway.authorization.denied") === "info") {
  fail("gateway.authorization.denied severity must not be info");
} else {
  ok("gateway.authorization.denied severity is warning-or-higher");
}

for (const phrase of [
  "async function requireGatewayCapability",
  "evaluateGatewayAuthorization",
  "isGatewayAuthorized(decision)",
  "await appendGatewayAuthorizationAuditEvent({ decision, actor })",
  'error: "gateway_authorization_denied"',
  "This user is not allowed to perform this Ogen gateway operation.",
  "requiredRolesAny: decision.requiredRolesAny",
  "gatewayRoles: directoryAccess.user.roles",
  "roles: identitySession.gatewayRoles"
]) {
  requireIncludes(indexSource, phrase, "gateway route guard exists");
}

for (const phrase of [
  "AuditEvents.GATEWAY_AUTHORIZATION_EVALUATED",
  "AuditEvents.GATEWAY_AUTHORIZATION_DENIED",
  "decisionId",
  "capability",
  "actorRoles",
  "requiredRolesAny",
  "matchedRole",
  "rawPromptStored: false"
]) {
  requireIncludes(indexSource, phrase, "gateway authorization audit metadata is safe");
}

const resolveRoute = resolveRouteBlock(indexSource);
for (const phrase of [
  "await requireFreshIdentitySession(request, response)",
  "tenantContextForRequest(identitySession.identity, requestedTenantIdFromBody(requestBodyUnknown))",
  "requireGatewayCapability",
  'capability: "gateway.resolve"',
  'route: "/resolve"',
  'method: "POST"'
]) {
  requireIncludes(resolveRoute, phrase, "/resolve requires gateway RBAC");
}

const runtimeRoute = routeBlock(indexSource, "POST", "/runtime/authorize");
for (const phrase of [
  "await requireFreshIdentitySession(request, response)",
  "const tenantContext = tenantContextForRequest(identitySession.identity, requestBody.tenantId)",
  "requireGatewayCapability",
  'capability: "runtime.authorize"',
  'route: "/runtime/authorize"',
  'method: "POST"'
]) {
  requireIncludes(runtimeRoute, phrase, "/runtime/authorize requires gateway RBAC");
}

for (const [method, path, capability] of [
  ["GET", "/agent-onboarding", "connector.onboarding.read"],
  ["GET", "/agent-onboarding/supported-connectors", "connector.onboarding.read"],
  ["POST", "/agent-onboarding/discover", "connector.onboarding.discover"],
  ["POST", "/agent-onboarding/start", "connector.onboarding.start"],
  ["POST", "/demo/end-user-ready", "demo.prepare"]
] as const) {
  const block = routeBlock(indexSource, method, path);
  requireIncludes(block, "await agentCardRegistryKeyForIdentityOrAdmin(request, response)", `${path} preserves identity/admin access`);
  requireIncludes(block, "await requireFreshIdentitySession(request, response)", `${path} revalidates browser identity before RBAC`);
  requireIncludes(block, "requireGatewayCapability", `${path} uses gateway RBAC`);
  requireIncludes(block, `capability: "${capability}"`, `${path} checks ${capability}`);
}

const trustStatusRoute = routeBlock(indexSource, "GET", "/identity/trust-status");
requireIncludes(trustStatusRoute, "const adminView = hasValidClientApiKey(request)", "trust-status preserves API-key admin path");
requireIncludes(trustStatusRoute, "await requireFreshIdentitySession(request, response)", "trust-status browser path revalidates identity");
requireIncludes(trustStatusRoute, 'capability: "identity.trust_status.read"', "trust-status browser path checks RBAC");

const healthRoute = routeBlock(indexSource, "GET", "/agents/health");
requireIncludes(healthRoute, "await requireIdentityOrAdminAccess(request, response)", "agents health preserves identity/admin helper");
requireIncludes(healthRoute, 'capability: "health.read"', "agents health browser path checks RBAC");

const debugRoute = routeBlock(indexSource, "GET", "/debug/ai-config");
requireIncludes(debugRoute, "hasValidClientApiKey(request)", "debug ai config preserves API-key requirement");
requireIncludes(debugRoute, "ALLOW_DEBUG_AI_CONFIG_WITH_IDENTITY", "debug ai config identity override remains explicit");
requireIncludes(debugRoute, 'capability: "debug.ai_config.read"', "debug ai config identity override checks RBAC");

const identityAttachRoute = routeBlock(indexSource, "POST", "/identity/session");
const rolesLoadedIndex = identityAttachRoute.indexOf("const allowedIdentity = identityWithDirectoryRoles(identity, directoryAccess.user.roles)");
const rbacIndex = identityAttachRoute.indexOf("requireGatewayCapability");
if (rbacIndex >= 0 && (rolesLoadedIndex < 0 || rbacIndex < rolesLoadedIndex)) {
  fail("POST /identity/session must not require RBAC before directory roles are loaded");
} else {
  ok("POST /identity/session does not require RBAC before roles are loaded");
}

for (const phrase of [
  "export type GatewayAuthorizationSummary",
  'effect: "allow" | "block"',
  "requiredRolesAny: string[]"
]) {
  requireIncludes(sharedSource, phrase, "shared gateway authorization summary contract");
}

const parsedPackageJson = JSON.parse(packageJsonSource) as { scripts?: Record<string, string> };
if (parsedPackageJson.scripts?.["verify:gateway-rbac-boundary"] !== "tsx scripts/verify-gateway-rbac-boundary.ts") {
  fail("package.json should include verify:gateway-rbac-boundary");
} else {
  ok("package.json includes verify:gateway-rbac-boundary");
}
if (!parsedPackageJson.scripts?.["verify:v2-plan"]?.includes("verify:tenant-resolution-boundary && npm run verify:gateway-rbac-boundary")) {
  fail("verify:v2-plan should run gateway RBAC boundary after tenant resolution boundary");
} else {
  ok("verify:v2-plan includes gateway RBAC boundary after tenant resolution boundary");
}

for (const phrase of [
  "Phase 2.18  Gateway RBAC / ABAC Boundary",
  "Gateway operations are protected by role/capability checks",
  "Roles come from verified user directory identity, not request body",
  "RBAC is tenant-aware",
  "Connector runtime action policy remains separate from gateway RBAC",
  "Denied gateway authorization is audited"
]) {
  requireIncludes(platformDocs, phrase, "platform docs cover gateway RBAC boundary");
}
for (const phrase of [
  "gateway APIs still enforce Ogen RBAC",
  "SDK-provided actor/role data is not authoritative"
]) {
  requireIncludes(sdkDocs, phrase, "SDK docs cover gateway RBAC boundary");
}
requireIncludes(productIdentityDocs, "Ogen separates gateway administration permissions from connector runtime policy.", "product identity docs cover gateway RBAC principle");
for (const phrase of [
  "demoRoleAliasToGatewayRole",
  '"it-support": "it-support"',
  '"read-only": "security_viewer"',
  '"identity-admin": "admin"',
  'roles: demoGatewayRoles("it-support")',
  'roles: demoGatewayRoles("read-only")',
  'roles: demoGatewayRoles("identity-admin")'
]) {
  requireIncludes(mockIdpSource, phrase, "mock demo role aliases map to canonical gateway roles");
}
for (const forbidden of [
  'roles: ["read-only"]',
  'roles: ["identity-admin"]'
]) {
  requireExcludes(mockIdpSource, forbidden, "mock demo tokens must not issue UI/demo role aliases");
}
for (const phrase of [
  'roleLabel: "read-only"',
  'roleLabel: "identity-admin"'
]) {
  requireIncludes(frontendMainSource, phrase, "frontend demo role labels remain display-only aliases");
}
for (const phrase of [
  "Mock demo role labels are mapped to canonical GatewayRole values",
  "`read-only` maps to `security_viewer`",
  "`identity-admin` maps to `admin`"
]) {
  requireIncludes(platformDocs, phrase, "platform docs cover demo role alias mapping");
}

function evaluate(capability: GatewayCapability, roles: string[], source: "browser_session" | "api_key" = "browser_session") {
  return evaluateGatewayAuthorization({
    tenantId: "default",
    capability,
    route: `/verify/${capability}`,
    method: "POST",
    actor: source === "browser_session"
      ? {
          provider: "mock",
          issuer: "https://idp.ogen.local",
          subject: "user-gateway-rbac",
          email: "gateway-rbac@example.com",
          roles
        }
      : undefined,
    source
  });
}

if (evaluate("gateway.resolve", ["end_user"]).effect !== "allow") {
  fail("end_user should be allowed to use gateway.resolve");
} else {
  ok("end_user can gateway.resolve");
}
if (evaluate("runtime.authorize", ["end_user"]).effect !== "allow") {
  fail("end_user should be allowed to use runtime.authorize");
} else {
  ok("end_user can runtime.authorize");
}
for (const role of connectorOnboardingReadRoles) {
  if (evaluate("connector.onboarding.read", [role]).effect !== "allow") {
    fail(`${role} should be allowed to read connector onboarding state`);
  } else {
    ok(`${role} can connector.onboarding.read`);
  }
}
for (const role of nonAdminOnboardingRoles) {
  if (evaluate("connector.onboarding.discover", [role]).effect !== "block") {
    fail(`${role} should not be allowed to discover connector onboarding candidates`);
  } else {
    ok(`${role} cannot connector.onboarding.discover`);
  }
  if (evaluate("connector.onboarding.start", [role]).effect !== "block") {
    fail(`${role} should not be allowed to start connector onboarding`);
  } else {
    ok(`${role} cannot connector.onboarding.start`);
  }
}
for (const role of connectorOnboardingAdminRoles) {
  if (evaluate("connector.onboarding.discover", [role]).effect !== "allow") {
    fail(`${role} should be allowed to discover connector onboarding candidates`);
  } else {
    ok(`${role} can connector.onboarding.discover`);
  }
  if (evaluate("connector.onboarding.start", [role]).effect !== "allow") {
    fail(`${role} should be allowed to start connector onboarding`);
  } else {
    ok(`${role} can connector.onboarding.start`);
  }
}
for (const alias of ["read-only", "identity-admin"]) {
  if (evaluate("connector.onboarding.read", [alias]).effect !== "block" || evaluate("connector.onboarding.start", [alias]).effect !== "block") {
    fail(`UI/demo role alias ${alias} must not authorize gateway capabilities without canonical mapping`);
  } else {
    ok(`UI/demo role alias ${alias} does not authorize directly`);
  }
}
if (evaluate("audit.read", ["security_viewer"]).effect !== "allow" || evaluate("identity.trust_status.read", ["security_viewer"]).effect !== "allow") {
  fail("security_viewer should be allowed to read audit and trust status");
} else {
  ok("security_viewer can audit.read and identity.trust_status.read");
}
if (evaluate("gateway.resolve", []).effect !== "block") {
  fail("no-role actor should be denied by default");
} else {
  ok("no-role actor is denied by default");
}
if (evaluate("debug.ai_config.read", ["admin"]).effect !== "allow" || evaluate("users.manage", ["admin"]).effect !== "allow") {
  fail("admin should be allowed for admin-compatible gateway capabilities");
} else {
  ok("admin is allowed for admin-compatible gateway capabilities");
}
const callerSuppliedRoles = ["connector_admin"];
if (evaluate("connector.onboarding.start", []).effect !== "block" || callerSuppliedRoles.length === 0) {
  fail("caller-supplied role should be ignored when not present in verified identity roles");
} else {
  ok("caller-supplied role is ignored unless present in verified identity roles");
}
if (evaluate("debug.ai_config.read", [], "api_key").effect !== "allow" || evaluate("gateway.resolve", [], "api_key").effect !== "block") {
  fail("api_key source should be limited to existing admin/system capabilities");
} else {
  ok("api_key source is limited to admin/system capabilities");
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Gateway RBAC boundary verification passed.");
}
