import { existsSync, readFileSync } from "node:fs";
import { validateDiscovery } from "../services/orchestrator-api/src/agentOnboarding/discovery.js";
import { evaluateConnectorPolicy } from "../services/orchestrator-api/src/policy/connectorPolicy.js";

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

const orchestrator = read("services/orchestrator-api/src/index.ts");
const conversationTypes = read("services/orchestrator-api/src/conversation/conversationTypes.ts");
const conversationOwnership = read("services/orchestrator-api/src/conversation/conversationOwnership.ts");
const connectorRuntime = read("services/orchestrator-api/src/connectorRuntime.ts");
const requireA2AAuth = read("packages/shared/src/auth/requireA2AAuth.ts");
const connectorPolicy = read("services/orchestrator-api/src/policy/connectorPolicy.ts");
const executionGateStack = read("services/orchestrator-api/src/executionGateStack.ts");
const agentCards = read("services/orchestrator-api/src/agentCards.ts");
const onboardingUtils = read("services/orchestrator-api/src/agentOnboarding/utils.ts");
const webUi = read("apps/web-ui/src/main.tsx");
const packageJson = read("package.json");
const plan = read("docs/v2-platform-foundation.md");

for (const phrase of [
  "ownerSessionHash",
  "conversationOwnerContext",
  "conversationBelongsToOwner",
  "applyConversationOwner",
  "getOrCreateConversationState(requestBody.conversationId, conversationOwner)"
]) {
  requireIncludes(orchestrator + conversationTypes + conversationOwnership, phrase, "session-bound conversation state");
}
for (const forbidden of ["Conversation ID", "conversationId}</", "{conversationId}"]) {
  requireExcludes(webUi, forbidden, "web UI should not display full raw conversationId");
}

for (const phrase of [
  "dangerousRuntimeResponseKey",
  "dangerousRuntimeResponseString",
  "compactJwtPattern",
  "sanitizeConnectorRuntimeValue(item.data)",
  "sanitizedRuntimeString(record.summary)",
  "optionalSanitizedRuntimeString(record.probableCause)",
  "optionalSanitizedRuntimeString(record.message)"
]) {
  requireIncludes(connectorRuntime, phrase, "connector runtime sanitization");
}

for (const phrase of [
  "requiredScope?: string",
  "const requiredScope = input.requiredScope",
  "Missing server-derived required scope for A2A JWT validation"
]) {
  requireIncludes(requireA2AAuth, phrase, "A2A auth server-derived required scope");
}
requireExcludes(requireA2AAuth, "input.task.context.requestedScope", "A2A auth server-derived required scope");

for (const service of [
  "services/jira-agent/src/index.ts",
  "services/github-agent/src/index.ts",
  "services/security-oauth-agent/src/index.ts",
  "services/pagerduty-agent/src/index.ts",
  "services/api-health-agent/src/index.ts",
  "services/end-user-triage-agent/src/index.ts"
]) {
  const source = read(service);
  requireIncludes(source, "function requiredScopeForTask", service);
  requireIncludes(source, "requiredScope: requiredScopeForTask(task)", service);
}

for (const phrase of [
  "riskLevel",
  "executionType",
  "requiresApproval",
  "policy.effect === \"allow\"",
  "Gateway policy requires approval before this high-risk or sensitive connector skill can execute",
  "Gateway stopped the request because connector policy requires governed approval before runtime execution"
]) {
  requireIncludes(connectorPolicy + executionGateStack + orchestrator, phrase, "connector policy approval enforcement");
}

const highRiskPolicy = evaluateConnectorPolicy({
  connectorRouteStatus: "connector_skill_approved",
  riskLevel: "high",
  executionType: "write_action",
  requiresApproval: true,
  sensitivity: "standard"
});
if (highRiskPolicy.effect !== "needs_approval") {
  fail(`high-risk connector skill should require approval, got ${highRiskPolicy.effect}`);
}
const mediumPolicy = evaluateConnectorPolicy({
  connectorRouteStatus: "connector_skill_approved",
  riskLevel: "medium",
  executionType: "diagnostic_read_only",
  requiresApproval: false,
  sensitivity: "standard"
});
if (mediumPolicy.effect !== "allow") {
  fail(`medium read-only connector skill should remain allowed, got ${mediumPolicy.effect}`);
}

for (const phrase of [
  "redirect: \"error\"",
  "endpointMatchesTrustedStaticCard",
  "returned an untrusted Agent Card endpoint",
  "safeAgentHealthEndpoint",
  "Health endpoint host is not allowed",
  "Health endpoint returned ${response.status}",
  "external agent fetch failed"
]) {
  requireIncludes(agentCards + orchestrator + onboardingUtils, phrase, "Agent Card and health SSRF hardening");
}

const maliciousDiscoveryBase = {
  agentId: "external-jira-agent",
  issuer: "https://agent.example.com",
  jwksUri: "https://agent.example.com/.well-known/jwks.json",
  onboardingEndpoint: "https://agent.example.com/onboarding",
  auth: { audience: "external-jira-agent", tokenEndpointAuthMethod: "private_key_jwt" }
};
for (const runtimeEndpoint of [
  "http://169.254.169.254/latest/meta-data",
  "http://localhost:9999/a2a/task",
  "https://evil.example.com/a2a/task"
]) {
  const result = validateDiscovery({
    ...maliciousDiscoveryBase,
    runtimeEndpoint
  }, {
    agentBaseUrl: "https://agent.example.com",
    expectedAgentId: "external-jira-agent"
  });
  if (result.discovery) {
    fail(`malicious discovery runtimeEndpoint should be rejected: ${runtimeEndpoint}`);
  }
  if (result.details.join(" ").includes("169.254.169.254/latest/meta-data")) {
    fail("malicious discovery rejection should not include internal metadata response body");
  }
}

for (const phrase of [
  '"verify:security-scan-p0": "tsx scripts/verify-security-scan-p0.ts"',
  "verify:security-scan-p0"
]) {
  requireIncludes(packageJson, phrase, "package scripts");
}

for (const phrase of [
  "Security Remediation Gate after Codex Security scan",
  "session-bound conversations",
  "runtime token/JWT response redaction",
  "server-derived A2A required scopes",
  "connector risk/approval enforcement",
  "Agent Card / health check SSRF hardening"
]) {
  requireIncludes(plan, phrase, "security remediation docs");
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("P0 security scan remediation verification passed.");
}
