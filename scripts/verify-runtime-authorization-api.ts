import { existsSync, readFileSync } from "node:fs";
import type { RuntimeAuthorizationRequest } from "../packages/shared/src/index.js";
import { evaluateRuntimeAuthorization } from "../services/orchestrator-api/src/runtimeAuthorization/runtimeAuthorizationEvaluator.js";
import type { VerifiedUserIdentity } from "../services/orchestrator-api/src/security/userIdentity.js";

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

const sharedTypes = read("packages/shared/src/index.ts");
const auditEvents = read("services/orchestrator-api/src/audit/auditEvents.ts");
const evaluatorSource = read("services/orchestrator-api/src/runtimeAuthorization/runtimeAuthorizationEvaluator.ts");
const indexSource = read("services/orchestrator-api/src/index.ts");
const fastifySchemas = read("services/orchestrator-api/src/http/schemas/runtimeAuthorizationSchemas.ts");
const packageJson = read("package.json");
const platformDocs = read("docs/v2-platform-foundation.md");
const sdkDocs = read("docs/sdk-readiness-contracts.md");
const productIdentityDocs = read("docs/ogen-product-identity.md");

for (const phrase of [
  "export type RuntimeAuthorizationEffect",
  "export type RuntimeAuthorizationRequest",
  "export type RuntimeAuthorizationResponse",
  "actor?:",
  "verified session identity is authoritative",
  "runtimeExecution:",
  "runtimeTokenIssued: false",
  "externalRuntimeCalled: false",
  'eventType: "runtime.authorization.evaluated"'
]) {
  requireIncludes(sharedTypes, phrase, "shared runtime authorization contract exists");
}

requireIncludes(auditEvents, 'RUNTIME_AUTHORIZATION_EVALUATED: "runtime.authorization.evaluated"', "runtime authorization audit event exists");

for (const phrase of [
  "export function evaluateRuntimeAuthorization",
  "evaluateConnectorPolicy",
  "identity.roles",
  "runtimeTokenIssued: false",
  "externalRuntimeCalled: false"
]) {
  requireIncludes(evaluatorSource, phrase, "runtime authorization evaluator includes required behavior");
}

for (const forbidden of ["executeApprovedConnectorSkill", "getA2AAccessToken", "postJson("]) {
  if (evaluatorSource.includes(forbidden)) {
    fail(`runtime authorization evaluator must not call ${forbidden}`);
  } else {
    ok(`runtime authorization evaluator does not call ${forbidden}`);
  }
}
if (evaluatorSource.includes("request.actor")) {
  fail("runtime authorization evaluator must not use request.actor as authorization authority");
} else {
  ok("runtime authorization evaluator does not use request.actor as authorization authority");
}

const runtimeAuthorizeRouteStart = indexSource.indexOf('request.url === "/runtime/authorize"');
const resolveRouteStart = indexSource.indexOf('request.url !== "/resolve"');
if (runtimeAuthorizeRouteStart < 0) {
  fail("POST /runtime/authorize route should exist");
} else {
  ok("POST /runtime/authorize route exists");
  const routeSource = indexSource.slice(runtimeAuthorizeRouteStart, resolveRouteStart > runtimeAuthorizeRouteStart ? resolveRouteStart : undefined);
  for (const phrase of [
    "requireFreshIdentitySession",
    "runtimeAuthorizeRateLimit",
    "evaluateRuntimeAuthorization",
    "appendRuntimeAuthorizationEvaluatedAuditEvent",
    "sendJson(response, 200, authorization",
    "validateRuntimeAuthorizationRequest"
  ]) {
    requireIncludes(routeSource, phrase, "POST /runtime/authorize route includes required behavior");
  }
  for (const forbidden of ["executeApprovedConnectorSkill", "getA2AAccessToken"]) {
    if (routeSource.includes(forbidden)) {
      fail(`POST /runtime/authorize route must not call ${forbidden}`);
    } else {
      ok(`POST /runtime/authorize route does not call ${forbidden}`);
    }
  }
}

for (const phrase of [
  "appendRuntimeAuthorizationEvaluatedAuditEvent",
  "AuditEvents.RUNTIME_AUTHORIZATION_EVALUATED",
  "runtimeTokenIssued: false",
  "externalRuntimeCalled: false",
  "protectedMaterialExposed: false",
  "tokenMaterialStored: false",
  "rawPromptStored: false"
]) {
  requireIncludes(indexSource, phrase, "runtime authorization route/audit includes safe proof");
}

for (const phrase of [
  "runtimeAuthorizationRequestSchema",
  "runtimeAuthorizationResponseSchema",
  'required: ["action"]',
  "tenantResolution",
  "runtimeTokenIssued",
  "externalRuntimeCalled",
  "runtime.authorization.evaluated"
]) {
  requireIncludes(fastifySchemas, phrase, "Fastify schema placeholder exists");
}
for (const phrase of [
  "tenantResolution:",
  'required: ["source", "requestedTenantAccepted"]',
  "requestedTenantAccepted"
]) {
  requireIncludes(fastifySchemas, phrase, "runtime authorization response schema includes tenant resolution");
}
if (fastifySchemas.includes('required: ["actor", "action"]')) {
  fail("Runtime authorization request schema must not require actor");
} else {
  ok("Runtime authorization request schema does not require actor");
}

const parsedPackageJson = JSON.parse(packageJson) as { scripts?: Record<string, string> };
if (parsedPackageJson.scripts?.["verify:runtime-authorization-api"] !== "tsx scripts/verify-runtime-authorization-api.ts") {
  fail("package.json should include verify:runtime-authorization-api");
} else {
  ok("package.json includes verify:runtime-authorization-api");
}
if (!parsedPackageJson.scripts?.["verify:v2-plan"]?.includes("verify:fastify-api-contract-boundary && npm run verify:runtime-authorization-api")) {
  fail("verify:v2-plan should run runtime authorization API after Fastify API contract boundary");
} else {
  ok("verify:v2-plan includes runtime authorization API after Fastify API contract boundary");
}

for (const phrase of [
  "Phase 2.15  Runtime Authorization Decision API",
  "POST /runtime/authorize",
  "authorization-only",
  "does not execute runtime",
  "does not issue a runtime token",
  "does not call an external connector runtime",
  "requires a fresh identity session",
  "`request.actor` is optional context only",
  "verified identity session is authoritative",
  "returns policy decision proof",
  "future SDK, MCP proxy, and external agent flows"
]) {
  requireIncludes(platformDocs, phrase, "platform docs cover runtime authorization API");
}

for (const phrase of [
  "Runtime Authorization API Contract",
  "SDK can call Ogen to ask if an action is allowed",
  "Actor context may be supplied as a hint",
  "Ogen verified identity session is authoritative",
  "SDK must not rely on caller-supplied actor for authorization",
  "SDK must not treat its own local decision as authority",
  "Ogen response includes policy proof",
  "Execution requires a separate future runtime execution path"
]) {
  requireIncludes(sdkDocs, phrase, "SDK docs cover runtime authorization API contract");
}

requireIncludes(productIdentityDocs, "External agents can ask Ogen for authorization, but Ogen remains the authority.", "product identity docs cover runtime authorization principle");

const identity: VerifiedUserIdentity = {
  provider: "mock",
  email: "runtime-authorize@example.com",
  roles: ["employee"],
  issuer: "https://idp.ogen.local",
  audience: "ogen-gateway",
  subject: "user-runtime-authorize"
};

function request(overrides: Partial<RuntimeAuthorizationRequest> = {}): RuntimeAuthorizationRequest {
  return {
    actor: {
      email: "caller-supplied@example.com",
      roles: ["admin"]
    },
    targetAgent: {
      agentId: "servicenow-agent",
      connectorId: "servicenow-reference",
      resourceSystem: "servicenow"
    },
    action: {
      skillId: "servicenow.ticket.status.lookup",
      skillLabel: "Look up ServiceNow ticket status",
      executionType: "inspection_read_only",
      riskLevel: "low",
      requiresApproval: false,
      sensitivity: "standard"
    },
    connectorRoute: {
      runtimeMode: "external_runtime_available"
    },
    ...overrides
  };
}

function evaluate(runtimeRequest: RuntimeAuthorizationRequest) {
  return evaluateRuntimeAuthorization({
    request: runtimeRequest,
    identity,
    tenantId: "default"
  });
}

const readOnly = evaluate(request());
if (readOnly.decision !== "allow" || !readOnly.allowed) {
  fail("read-only low risk external runtime authorization should allow");
} else if (readOnly.runtimeExecution.executed || readOnly.runtimeExecution.runtimeTokenIssued || readOnly.runtimeExecution.externalRuntimeCalled) {
  fail("read-only authorization response must not execute runtime, issue token, or call external runtime");
} else {
  ok("read-only low risk external runtime authorization allows without execution");
}

const withoutActor = request();
delete withoutActor.actor;
const noActor = evaluate(withoutActor);
if (noActor.decision !== "allow") {
  fail("runtime authorization request without actor should still evaluate");
} else {
  ok("runtime authorization request without actor still evaluates");
}

const actorAdmin = evaluate(request({
  actor: {
    email: "caller-supplied@example.com",
    roles: ["admin"]
  }
}));
const actorViewer = evaluate(request({
  actor: {
    email: "different-caller-supplied@example.com",
    roles: ["viewer"]
  }
}));
if (actorAdmin.policy.inputHash !== actorViewer.policy.inputHash || actorAdmin.decision !== actorViewer.decision) {
  fail("caller-supplied actor fields should not affect policy input or decision");
} else {
  ok("caller-supplied actor fields do not affect policy input or decision");
}

const identityAdmin = evaluateRuntimeAuthorization({
  request: request({
    actor: {
      email: "caller-supplied@example.com",
      roles: ["employee"]
    }
  }),
  identity: {
    ...identity,
    roles: ["admin"]
  },
  tenantId: "default"
});
if (identityAdmin.policy.inputHash === actorAdmin.policy.inputHash) {
  fail("verified identity roles should affect policy input while request actor roles do not");
} else {
  ok("verified identity roles are authoritative for policy input");
}

const writeAction = evaluate(request({
  action: {
    skillId: "jira.issue.create",
    skillLabel: "Create Jira issue",
    executionType: "write_action",
    riskLevel: "high",
    requiresApproval: true,
    sensitivity: "sensitive"
  }
}));
if (writeAction.decision !== "needs_approval" || !writeAction.requiresApproval) {
  fail("write/high risk authorization should require approval");
} else {
  ok("write/high risk authorization requires approval");
}

const metadataOnly = evaluate(request({
  connectorRoute: {
    runtimeMode: "metadata_only"
  }
}));
if (metadataOnly.decision !== "block" || metadataOnly.policy.primaryRuleId !== "block-metadata-only-runtime") {
  fail("metadata-only runtime authorization should block");
} else {
  ok("metadata-only runtime authorization blocks");
}

const unsafeInterpretation = evaluate(request({
  interpretation: {
    confidence: "high",
    risks: ["policy_bypass_attempt"],
    advisoryOnly: true
  }
}));
if (unsafeInterpretation.decision !== "block" || unsafeInterpretation.policy.primaryRuleId !== "block-unsafe-interpretation-risk") {
  fail("unsafe interpretation risk should block runtime authorization");
} else {
  ok("unsafe interpretation risk blocks runtime authorization");
}

const missingRuntime = evaluate(request({
  connectorRoute: undefined
}));
if (missingRuntime.decision !== "block") {
  fail("missing runtime mode should block runtime authorization");
} else {
  ok("missing runtime mode blocks runtime authorization");
}

const unknownRuntime = evaluate(request({
  connectorRoute: {
    runtimeMode: "unknown" as NonNullable<RuntimeAuthorizationRequest["connectorRoute"]>["runtimeMode"]
  }
}));
if (unknownRuntime.decision !== "block") {
  fail("unknown runtime mode should block runtime authorization");
} else {
  ok("unknown runtime mode blocks runtime authorization");
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Runtime authorization API verification passed.");
}
