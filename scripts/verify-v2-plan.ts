import { existsSync, readFileSync } from "node:fs";

const path = "docs/v2-platform-foundation.md";
const sharedPath = "packages/shared/src/index.ts";
const deploymentPath = "docs/deployment.md";
const connectorRuntimePath = "services/orchestrator-api/src/connectorRuntime.ts";
const orchestratorPath = "services/orchestrator-api/src/index.ts";
const gateStackPath = "services/orchestrator-api/src/executionGateStack.ts";
const webPath = "apps/web-ui/src/main.tsx";
const realRuntimePath = "real-external-agent/src/runtime.ts";
let failed = false;

function fail(message: string): void {
  console.error(`fail - ${message}`);
  failed = true;
}

if (!existsSync(path)) {
  fail(`${path} should exist`);
} else {
  const doc = readFileSync(path, "utf8");
  for (const phrase of [
    "Secure A2A Platform Foundation",
    "V1 remains stable on `main`",
    "npm run verify:v1",
    "Phase 0  V1 Closeout / Branch Hygiene",
    "Phase 1  Real User Identity With Auth0",
    "Phase 2  Persistent Platform State",
    "Phase 2.5  Connected Accounts / User Delegated OAuth",
    "Phase 3  Connector SDK",
    "Phase 3.5  Real ServiceNow External Agent Adapter",
    "Phase 4  Governed Chat Engine",
    "Phase 5  Policy And Audit Maturity",
    "Phase 6  CI, Playwright, Production Smoke",
    "Phase 7  Presentation Polish",
    "Non-Goals",
    "real Jira API writes",
    "Real ServiceNow read-only adapter is V2 scope",
    "Autonomous/high-risk ServiceNow writes are not V2 scope",
    "shared admin/developer OAuth tokens for user-delegated external app actions",
    "real GitHub writes",
    "replacing all backend services with another stack",
    "rewriting everything from scratch",
    "Do not trust agent-declared metadata by itself.",
    "Onboarding URL allowlist protects against SSRF.",
    "Runtime URL allowlist protects against untrusted runtime execution.",
    "`private_key_jwt` remains preferred over `client_secret_post`.",
    "Auth0 is the real user identity provider",
    "Reference A2A Token Issuer",
    "authorization_required",
    "Never use one admin/developer OAuth token for all users",
    "does not replace OAuth delegated authorization",
    "servicenow.incident.read",
    "SERVICENOW_INSTANCE_URL",
    "ServiceNow credentials live only in the external adapter",
    "V2 Implementation Checklist",
    "What Remains V3+"
  ]) {
    if (!doc.includes(phrase)) {
      fail(`V2 plan missing required phrase: ${phrase}`);
    }
  }
}

if (!existsSync(sharedPath)) {
  fail(`${sharedPath} should exist`);
} else {
  const shared = readFileSync(sharedPath, "utf8");
  for (const phrase of [
    "ExternalAuthorizationRequirement",
    "ConnectedAccountStatus",
    'type: "authorization_required"',
    "authorizationRequirement?: ExternalAuthorizationRequirement",
    "actorProvider?: string",
    "actorSubject?: string",
    "requestedScopes: string[]"
  ]) {
    if (!shared.includes(phrase)) {
      fail(`shared contracts missing required phrase: ${phrase}`);
    }
  }
}

if (!existsSync(deploymentPath)) {
  fail(`${deploymentPath} should exist`);
} else {
  const deployment = readFileSync(deploymentPath, "utf8");
  for (const phrase of [
    "Auth0 is for real browser user identity",
    "Reference A2A Token Issuer",
    "they do not validate Auth0 directly"
  ]) {
    if (!deployment.includes(phrase)) {
      fail(`deployment docs missing required phrase: ${phrase}`);
    }
  }
}

if (!existsSync(connectorRuntimePath)) {
  fail(`${connectorRuntimePath} should exist`);
} else {
  const connectorRuntime = readFileSync(connectorRuntimePath, "utf8");
  for (const phrase of [
    "ExternalAuthorizationRequirement",
    "authorizationRequirement?: ExternalAuthorizationRequirement",
    "function normalizeAuthorizationRequirement(value: unknown): ExternalAuthorizationRequirement | undefined",
    'record.type !== "authorization_required"',
    "sanitizeConnectorRuntimeValue(value)",
    'trimmed !== "hidden"',
    'url.protocol === "https:" && !url.username && !url.password',
    "requestedScopes.length === 0",
    "authorizationRequirement: normalizeAuthorizationRequirement(record.authorizationRequirement)",
    "authorizationRequirement: agentResponse.authorizationRequirement",
    '"authorization"',
    '"access_token"',
    '"refresh_token"',
    '"client_assertion"',
    '"bearer"'
  ]) {
    if (!connectorRuntime.includes(phrase)) {
      fail(`connector runtime authorization propagation missing required phrase: ${phrase}`);
    }
  }
}

if (!existsSync(orchestratorPath)) {
  fail(`${orchestratorPath} should exist`);
} else {
  const orchestrator = readFileSync(orchestratorPath, "utf8");
  for (const phrase of [
    "AUTHORIZATION REQUIRED",
    "Connect your ${authorizationRequirement.provider} account to continue.",
    "Requested scopes: ${authorizationRequirement.requestedScopes.join",
    "Changed: No changes were made.",
    "Raw OAuth tokens, authorization codes, refresh tokens, Authorization headers, and secrets were not exposed.",
    "function connectorRuntimeResolutionStatus",
    'runtime?.agentResponse?.status === "needs_more_info"',
    "resolutionStatus: connectorRuntimeResolutionStatus(connectorRouting, connectorRuntime)",
    '"return_connector_authorization_required"'
  ]) {
    if (!orchestrator.includes(phrase)) {
      fail(`orchestrator authorization-required semantics missing required phrase: ${phrase}`);
    }
  }
}

if (!existsSync(gateStackPath)) {
  fail(`${gateStackPath} should exist`);
} else {
  const gateStack = readFileSync(gateStackPath, "utf8");
  for (const phrase of [
    "runtime?.authorizationRequirement",
    'return "needs_more_info"',
    'return "runtime_execution"',
    "External connector requires user authorization for ${authorizationRequirement.provider}; no target changes were made.",
    "authorizationRequired: Boolean(authorizationRequirement)",
    "authorizationProvider: authorizationRequirement?.provider",
    "requestedScopes: authorizationRequirement?.requestedScopes ?? []",
    "authorizationActorProvider: authorizationRequirement?.actorProvider",
    "authorizationActorSubject: authorizationRequirement?.actorSubject",
    "rawTokenExposed: false"
  ]) {
    if (!gateStack.includes(phrase)) {
      fail(`execution gate stack authorization-required semantics missing required phrase: ${phrase}`);
    }
  }
}

if (!existsSync(webPath)) {
  fail(`${webPath} should exist`);
} else {
  const web = readFileSync(webPath, "utf8");
  for (const phrase of [
    "response.connectorRuntime?.authorizationRequirement",
    "External account authorization required",
    "Requested scopes",
    "Actor provider",
    "Raw tokens",
    "hidden"
  ]) {
    if (!web.includes(phrase)) {
      fail(`Security Timeline authorization-required proof missing required phrase: ${phrase}`);
    }
  }
}

if (!existsSync(realRuntimePath)) {
  fail(`${realRuntimePath} should exist`);
} else {
  const realRuntime = readFileSync(realRuntimePath, "utf8");
  if (!realRuntime.includes("scopesFromClaim(payload.scp)") || !realRuntime.includes("scopesFromClaim(payload.scopes)")) {
    fail("real external agent should parse both payload.scp and payload.scopes");
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("V2 platform foundation plan verification passed.");
}
