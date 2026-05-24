import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { normalizeRuntimeResponse } from "../services/orchestrator-api/src/connectorRuntime";
import { evaluateSourceIpAllowlist } from "../services/mock-identity-provider/src/security/sourceIpAllowlist";
import { buildServiceNowRuntimeDiagnosis } from "../real-external-agent/src/connectors/servicenowRuntimeDiagnosis";

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

function requireOrder(source: string, first: string, second: string, context: string): void {
  const firstIndex = source.indexOf(first);
  const secondIndex = firstIndex < 0 ? -1 : source.indexOf(second, firstIndex + first.length);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex > secondIndex) {
    fail(`${context} should contain "${first}" before "${second}"`);
  }
}

function withEnv<T>(env: Record<string, string | undefined>, action: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return action();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function mockRequest(remoteAddress: string, headers: Record<string, string> = {}): IncomingMessage {
  return {
    headers,
    socket: { remoteAddress }
  } as IncomingMessage;
}

const plan = read("docs/v2-platform-foundation.md");
const externalIndex = read("real-external-agent/src/index.ts");
const externalRuntime = read("real-external-agent/src/runtime.ts");
const requireA2AAuth = read("packages/shared/src/auth/requireA2AAuth.ts");
const verifyA2AToken = read("packages/shared/src/auth/verifyA2AToken.ts");
const mockIdp = read("services/mock-identity-provider/src/index.ts");
const mockIpAllowlist = read("services/mock-identity-provider/src/security/sourceIpAllowlist.ts");
const registry = read("packages/shared/src/a2aResourceRegistry.ts");
const orchestrator = read("services/orchestrator-api/src/index.ts");
const actionPlanner = read("services/orchestrator-api/src/connectorActionPlanner.ts");
const serviceNowDiagnosis = read("real-external-agent/src/connectors/servicenowRuntimeDiagnosis.ts");
const packageJson = read("package.json");

for (const phrase of [
  "plan-only runtime requests bypass A2A authentication",
  "runtime config oracle before JWT validation",
  "external agent accepts under-validated A2A JWTs",
  "delegation JWT claims are not bound to task context",
  "mock IdP mints tokens for arbitrary audiences",
  "spoofable proxy headers bypass Mock IdP IP allowlist",
  "trust status endpoint leaks configured JWKS URLs",
  "public demo token endpoint / mock IdP production hardening",
  "upstream agent error bodies leak through `/resolve`",
  "ServiceNow ticket lookup leaks record existence",
  "connector record access inferred from email prefixes",
  "AI-derived capability is logged without sanitization",
  "Agent Card support hints bypass delegation policy",
  "onboarding fetch errors leak network details",
  "read-only connector answers can claim changes were made",
  "connector answer can spoof governed change results",
  "divergent skills bypass onboarding action review",
  "untrusted connector profiles can approve unauthorized actions",
  "token-not-issued state is shown as successful",
  "malformed agent trace can crash Security Timeline UI",
  "replay verification can leak access tokens in logs",
  "debug AI config endpoint exposed via self-issued sessions",
  "malformed Agent Card scope can crash routing",
  "composer clears messages that were not accepted"
]) {
  requireIncludes(plan, phrase, "security remediation backlog docs");
}

for (const status of ["fixed:", "partially fixed:", "pending:", "future hardening:"]) {
  requireIncludes(plan, status, "security remediation backlog docs");
}

for (const phrase of [
  "planOnlyRuntimeRequirement",
  "await validateRuntimeToken(token, skill.requiredApplicationGrants, body.context?.actor)",
  "validatePlanOnlyTrustedConfig(body)",
  "buildConnectorActionPlan"
]) {
  requireIncludes(externalIndex, phrase, "plan-only runtime auth");
}
requireOrder(externalIndex, "await validateRuntimeToken(token, skill.requiredApplicationGrants, body.context?.actor)", "buildConnectorActionPlan", "plan-only runtime auth");
requireOrder(externalIndex, "tokenContext = await validateRuntimeToken(token, skill.requiredApplicationGrants, body.context?.actor)", "validateRuntimeTrustedConfig(body, skill)", "runtime config oracle");

for (const phrase of [
  "getA2AAccessToken",
  "authorization: `Bearer ${issued.accessToken}`",
  "actorSubject: params.actor?.subject",
  "trustedContext",
  "external connector action plan request failed"
]) {
  requireIncludes(actionPlanner, phrase, "Gateway plan-only token issuance");
}

for (const phrase of [
  "typeof payload.sub !== \"string\"",
  "typeof payload.client_id !== \"string\"",
  "typeof payload.jti !== \"string\"",
  "payload.sub !== payload.client_id",
  "issuer: mockIdpIssuer()",
  "audience: expectedAudience()",
  "missing_required_application_grant",
  "validateActorProvenance"
]) {
  requireIncludes(externalRuntime, phrase, "external A2A JWT validation");
}

for (const phrase of [
  "typeof claims.sub !== \"string\"",
  "typeof claims.jti !== \"string\"",
  "typeof claims.client_id !== \"string\"",
  "jwtVerify(match[1], jwks",
  "issuer: input.expectedIssuer",
  "audience: input.expectedAudience",
  "Missing required scope"
]) {
  requireIncludes(verifyA2AToken, phrase, "shared A2A JWT validation");
}

for (const phrase of [
  "parent_task_id does not match task context",
  "requested_by_agent does not match task context",
  "delegated_by does not match task context",
  "Delegation depth exceeds allowed limit",
  "Delegation token is missing delegated_by",
  "A2A JWT actor subject does not match task context"
]) {
  requireIncludes(requireA2AAuth, phrase, "delegation claim binding");
}

for (const phrase of [
  "resourceRegistry.audiences.has(body.audience)",
  "resourceRegistry.audienceToScopes.get(body.audience)",
  "scope_not_allowed",
  "audience_not_allowed"
]) {
  requireIncludes(mockIdp, phrase, "Mock IdP audience/scope hardening");
}
requireIncludes(registry, "audienceToScopes", "A2A resource registry audience scope binding");

for (const phrase of [
  "MOCK_IDP_TRUST_PROXY_HEADERS",
  "trustedProxyHeadersEnabled",
  "envEnabled(\"TRUST_PROXY_HEADERS\")"
]) {
  requireIncludes(mockIpAllowlist, phrase, "Mock IdP proxy header hardening");
}

for (const phrase of [
  "process.env.NODE_ENV === \"production\" && !adminView",
  "internal endpoint",
  "`${url.protocol}//${url.host}/...`",
  "admin_access_required",
  "buildTrustStatus(getSessionToken(request), hasValidClientApiKey(request))"
]) {
  requireIncludes(orchestrator, phrase, "trust status and debug hardening");
}

for (const phrase of [
  "dangerousRuntimeResponseString",
  "runtimeErrorFromBody",
  "external connector runtime failed"
]) {
  requireIncludes(read("services/orchestrator-api/src/connectorRuntime.ts"), phrase, "upstream runtime error sanitization");
}

for (const phrase of [
  "hiddenServiceNowTicketResponse",
  "not_visible_or_not_found",
  "Demo fixture role hints only",
  "not email prefixes"
]) {
  requireIncludes(serviceNowDiagnosis, phrase, "ServiceNow visibility hardening");
}

withEnv({
  MOCK_IDP_ENFORCE_IP_ALLOWLIST: "true",
  MOCK_IDP_ALLOWED_SOURCE_IPS: "203.0.113.50",
  TRUST_PROXY_HEADERS: "true",
  MOCK_IDP_TRUST_PROXY_HEADERS: undefined
}, () => {
  const result = evaluateSourceIpAllowlist(mockRequest("127.0.0.1", { "x-forwarded-for": "203.0.113.50" }));
  if (result.ok || result.sourceIp !== "127.0.0.1") {
    fail(`spoofed proxy header should not bypass Mock IdP allowlist by default: ${JSON.stringify(result)}`);
  }
});

const maliciousJwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2aWN0aW0ifQ.signature";
const normalized = normalizeRuntimeResponse({
  agentId: "malicious-agent",
  status: "error",
  summary: "Connector failed safely.",
  probableCause: `Bearer ${maliciousJwt}`,
  evidence: [{ title: "error", data: { accessToken: maliciousJwt } }],
  trace: [{ agent: "malicious-agent", action: "runtime_error", detail: `Authorization: Bearer ${maliciousJwt}`, timestamp: "2026-05-24T00:00:00.000Z" }]
});
const normalizedText = JSON.stringify(normalized);
if (normalizedText.includes(maliciousJwt) || normalizedText.includes("Authorization: Bearer")) {
  fail(`upstream token-like error body should be sanitized: ${normalizedText}`);
}

const missingTicket = buildServiceNowRuntimeDiagnosis({
  skillId: "servicenow.ticket.status.lookup",
  message: "Check INC9999999",
  actor: "ran@company.com",
  requiredApplicationGrants: ["incident.read"],
  requiredEffectivePermissions: ["itil"],
  connectorAccessEvaluation: {
    missingApplicationGrants: [],
    missingEffectivePermissions: [],
    deniedEffectivePermissions: [],
    skillApprovedByConfig: true
  },
  runtimeSemantics: {
    executionType: "diagnostic_read_only",
    outcome: "diagnosed",
    executedSkillId: "servicenow.ticket.status.lookup",
    writeActionAttempted: false,
    diagnosticOnly: true
  }
});
const deniedTicket = buildServiceNowRuntimeDiagnosis({
  skillId: "servicenow.ticket.status.lookup",
  message: "Check INC0010310",
  actor: "analyst@company.com",
  requiredApplicationGrants: ["incident.read"],
  requiredEffectivePermissions: ["itil"],
  connectorAccessEvaluation: {
    missingApplicationGrants: [],
    missingEffectivePermissions: [],
    deniedEffectivePermissions: [],
    skillApprovedByConfig: true
  },
  runtimeSemantics: {
    executionType: "diagnostic_read_only",
    outcome: "diagnosed",
    executedSkillId: "servicenow.ticket.status.lookup",
    writeActionAttempted: false,
    diagnosticOnly: true
  }
});
if (
  missingTicket.summary !== deniedTicket.summary ||
  missingTicket.endUserAnswer?.title !== deniedTicket.endUserAnswer?.title ||
  missingTicket.endUserAnswer?.summary !== deniedTicket.endUserAnswer?.summary
) {
  fail("ServiceNow missing and unauthorized ticket responses should be indistinguishable");
}
const deniedTicketText = JSON.stringify(deniedTicket);
if (deniedTicketText.includes("Messaging Operations") || deniedTicketText.includes("Shared mailbox")) {
  fail(`ServiceNow denied ticket response leaked record details: ${deniedTicketText}`);
}

for (const forbiddenDependency of ["pg", "prisma", "drizzle", "@opentelemetry", "splunk", "datadog"]) {
  if (packageJson.includes(`"${forbiddenDependency}`)) {
    fail(`P1 checkpoint should not add dependency ${forbiddenDependency}`);
  }
}

for (const phrase of [
  '"verify:security-scan-p1": "tsx scripts/verify-security-scan-p1.ts"',
  "verify:security-scan-p0 && npm run verify:security-scan-p1"
]) {
  requireIncludes(packageJson, phrase, "package scripts");
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("P1 security scan remediation verification passed.");
}
