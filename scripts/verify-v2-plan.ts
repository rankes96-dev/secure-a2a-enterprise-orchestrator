import { existsSync, readFileSync } from "node:fs";

const path = "docs/v2-platform-foundation.md";
const sharedPath = "packages/shared/src/index.ts";
const deploymentPath = "docs/deployment.md";
const connectorRuntimePath = "services/orchestrator-api/src/connectorRuntime.ts";
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

if (failed) {
  process.exitCode = 1;
} else {
  console.log("V2 platform foundation plan verification passed.");
}
