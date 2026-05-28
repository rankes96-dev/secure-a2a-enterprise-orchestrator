import { existsSync, readFileSync } from "node:fs";

const path = "docs/v2-platform-foundation.md";
const stateInventoryPath = "docs/v2-state-inventory.md";
const orchestratorAgnosticRoadmapPath = "docs/orchestrator-agnostic-roadmap.md";
const sharedPath = "packages/shared/src/index.ts";
const deploymentPath = "docs/deployment.md";
const packageJsonPath = "package.json";
const connectorRuntimePath = "services/orchestrator-api/src/connectorRuntime.ts";
const orchestratorPath = "services/orchestrator-api/src/index.ts";
const gateStackPath = "services/orchestrator-api/src/executionGateStack.ts";
const webPath = "apps/web-ui/src/main.tsx";
const webSecuritySummaryPath = "apps/web-ui/src/securitySummary.ts";
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
    "Phase 2.4  Security Event Export Boundary / SOC & Observability Readiness",
    "SecurityEventSink",
    "schemaVersion",
    "severity",
    "outcome",
    "correlation IDs",
    "SOC",
    "SIEM",
    "observability",
    "OpenTelemetry",
    "Splunk",
    "Microsoft Sentinel",
    "Datadog",
    "vendor-neutral",
    "no raw tokens",
    "no raw prompts",
    "Phase 2.5  Connected Accounts / User Delegated OAuth",
    "Phase 2.19  Persisted Audit Viewer (MVP)",
    "Phase 2.19b  Audit Viewer Scale & Operability Hardening",
    "Phase 2.19c  Indexed Audit Read Model for Outcome/Severity Filters",
    "Phase 2.19c rolling-safe rollout",
    "Phase 2.19d  Audit Index Rollout Operational Hardening",
    "Phase 2.20a  A2A 1.0 Protocol Compatibility Layer",
    "Phase 2.20b  A2A Message/Task Adapter",
    "Phase 2.21  Signed Agent Card Provenance",
    "Phase 2.22  Generic Action Taxonomy & Policy Conditions",
    "A2A-Version: 1.0",
    "application/a2a+json",
    "invalid_a2a_envelope",
    "signed Agent Card provenance is advisory only",
    "Full official Message/Task operations `list`, `get`, `cancel`, and `subscribe` are deferred",
    "GET `/audit/events`",
    "`audit.read`",
    "audit_events_filter_scan_limit_exceeded",
    "materialized outcome/severity",
    "classification index",
    "tenant.access.denied remains blocked",
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
    "What Remains V3+",
    "Orchestrator-agnostic strategy",
    "docs/orchestrator-agnostic-roadmap.md"
  ]) {
    if (!doc.includes(phrase)) {
      fail(`V2 plan missing required phrase: ${phrase}`);
    }
  }
}


if (!existsSync(orchestratorAgnosticRoadmapPath)) {
  fail(`${orchestratorAgnosticRoadmapPath} should exist`);
}

if (!existsSync(stateInventoryPath)) {
  fail(`${stateInventoryPath} should exist`);
} else {
  const stateInventory = readFileSync(stateInventoryPath, "utf8");
  for (const phrase of [
    "SecurityEventSink export boundary",
    "sanitized and vendor-neutral",
    "SOC/observability integrations",
    "structured safe events only",
    "Raw prompts",
    "raw tokens",
    "no raw tokens",
    "no raw prompts",
    "Authorization headers",
    "JWTs",
    "cookies",
    "client assertions",
    "private keys",
    "client secrets must never be exported"
  ]) {
    if (!stateInventory.includes(phrase)) {
      fail(`state inventory missing Phase 2.4 SOC export phrase: ${phrase}`);
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
    "requestedScopes: string[]",
    "AuditViewerEvent",
    "AuditEventsResponse",
    "safeMetadataReturned: false",
    "./a2aProtocol.js",
    "./a2aMessageTaskAdapter.js",
    "./ogenActionTaxonomy.js"
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
    "they do not validate Auth0 directly",
    "vendor-specific",
    "vendor-neutral",
    "Large audit table index rollout",
    "state-gated runbook",
    "Confirm schema state before any concurrent index command",
    "If columns are missing, do not run `CREATE INDEX CONCURRENTLY` yet",
    "columns + fallback trigger/backfill path",
    "Run `CREATE INDEX CONCURRENTLY` only when the columns exist and equivalent usable indexes are absent",
    "If `004` already created the indexes non-concurrently",
    "continue with the upgrade/validate/contract (`006`) sequence",
    "Column existence check",
    "Index validity/readiness check",
    "pg_index",
    "indisvalid",
    "indisready",
    "index missing -> run `CREATE INDEX CONCURRENTLY`",
    "index exists and `indisvalid = true` and `indisready = true` -> keep it and skip recreation",
    "index exists but is invalid or not ready -> run `DROP INDEX CONCURRENTLY`",
    "Do not rely on `pg_indexes` name presence alone",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS` can skip invalid named indexes",
    "Drop invalid/not-ready indexes concurrently before retrying",
    "Recreate missing or dropped invalid indexes concurrently",
    "Post-create validation query",
    "Null classification count",
    "Readiness for contract migration after both columns exist",
    "ready_for_006_contract_migration"
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
    "connectorRuntimeResolutionStatus(connectorRouting, connectorRuntime)",
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
  const webSecuritySummary = existsSync(webSecuritySummaryPath) ? readFileSync(webSecuritySummaryPath, "utf8") : "";
  const webSecurityProofSource = `${web}\n${webSecuritySummary}`;
  const answerStart = web.indexOf("function buildEndUserSupportAnswer(response: ResolveResponse): string");
  const answerEnd = web.indexOf("function governedChatAnswer(response: ResolveResponse): string");
  const answerBuilder = answerStart >= 0 && answerEnd > answerStart ? web.slice(answerStart, answerEnd) : "";
  for (const phrase of [
    "response.connectorRuntime?.authorizationRequirement",
    "response.connectorRuntime?.agentResponse?.authorizationRequirement",
    "AUTHORIZATION REQUIRED",
    "Connect your ${authorizationRequirement.provider} account to continue.",
    "No changes were made.",
    "Requested scopes",
    "External account authorization required",
    "Requested scopes",
    "Actor provider",
    "Raw tokens",
    "hidden"
  ]) {
    if (!webSecurityProofSource.includes(phrase)) {
      fail(`Security Timeline authorization-required proof missing required phrase: ${phrase}`);
    }
  }
  for (const phrase of [
    "function buildEndUserSupportAnswer(response: ResolveResponse): string",
    "response.connectorRuntime?.authorizationRequirement",
    "response.connectorRuntime?.agentResponse?.authorizationRequirement",
    "AUTHORIZATION REQUIRED",
    "Connect your ${authorizationRequirement.provider} account to continue.",
    "No changes were made.",
    "Requested scopes:",
    "Connect your ${authorizationRequirement.provider} account, then retry this request."
  ]) {
    if (!answerBuilder.includes(phrase)) {
      fail(`chat authorization-required answer missing required phrase: ${phrase}`);
    }
  }
  for (const forbidden of ["accessToken}</", "refreshToken}</", "authorizationCode}</", "Authorization header", "authorizeUrl"]) {
    if (answerBuilder.includes(forbidden)) {
      fail(`chat authorization-required answer should not expose forbidden token/url marker: ${forbidden}`);
    }
  }
}

if (!existsSync(packageJsonPath)) {
  fail(`${packageJsonPath} should exist`);
} else {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
  if (packageJson.scripts?.["verify:audit-viewer-boundary"] !== "tsx scripts/verify-audit-viewer-boundary.ts") {
    fail("package.json missing verify:audit-viewer-boundary script");
  }
  if (!packageJson.scripts?.["verify:v2-plan"]?.includes("verify:audit-viewer-boundary")) {
    fail("verify:v2-plan should run verify:audit-viewer-boundary");
  }
  if (packageJson.scripts?.["verify:a2a-protocol-compatibility"] !== "tsx scripts/verify-a2a-protocol-compatibility.ts") {
    fail("package.json missing verify:a2a-protocol-compatibility script");
  }
  if (!packageJson.scripts?.["verify:v2-plan"]?.includes("verify:a2a-protocol-compatibility")) {
    fail("verify:v2-plan should run verify:a2a-protocol-compatibility");
  }
  if (packageJson.scripts?.["verify:a2a-message-task-adapter"] !== "tsx scripts/verify-a2a-message-task-adapter.ts") {
    fail("package.json missing verify:a2a-message-task-adapter script");
  }
  if (!packageJson.scripts?.["verify:v2-plan"]?.includes("verify:a2a-message-task-adapter")) {
    fail("verify:v2-plan should run verify:a2a-message-task-adapter");
  }
  if (packageJson.scripts?.["verify:a2a-agent-card-provenance"] !== "tsx scripts/verify-a2a-agent-card-provenance.ts") {
    fail("package.json missing verify:a2a-agent-card-provenance script");
  }
  if (!packageJson.scripts?.["verify:v2-plan"]?.includes("verify:a2a-message-task-adapter && npm run verify:a2a-agent-card-provenance")) {
    fail("verify:v2-plan should run verify:a2a-agent-card-provenance after verify:a2a-message-task-adapter");
  }
  if (!packageJson.scripts?.["verify:v2-plan"]?.includes("verify:platform-db-migrations")) {
    fail("verify:v2-plan should run verify:platform-db-migrations");
  }
  if (packageJson.scripts?.["verify:generic-action-taxonomy"] !== "tsx scripts/verify-generic-action-taxonomy.ts") {
    fail("package.json missing verify:generic-action-taxonomy script");
  }
  if (!packageJson.scripts?.["verify:v2-plan"]?.includes("verify:generic-action-taxonomy")) {
    fail("verify:v2-plan should run verify:generic-action-taxonomy");
  }
  if (packageJson.scripts?.["verify:connector-runtime-ui-summary"] !== "tsx scripts/verify-connector-runtime-ui-summary.ts") {
    fail("package.json missing verify:connector-runtime-ui-summary script");
  }
  if (!packageJson.scripts?.["verify:v2-plan"]?.includes("verify:connector-runtime-ui-summary")) {
    fail("verify:v2-plan should run verify:connector-runtime-ui-summary");
  }
}


const coreDocsThatMustReferenceRoadmap = [
  path,
  "docs/ogen-product-identity.md",
  "docs/sdk-readiness-contracts.md",
  deploymentPath
];

for (const coreDocPath of coreDocsThatMustReferenceRoadmap) {
  if (!existsSync(coreDocPath)) {
    fail(`${coreDocPath} should exist`);
    continue;
  }

  const content = readFileSync(coreDocPath, "utf8");
  if (!content.includes("orchestrator-agnostic-roadmap.md")) {
    fail(`${coreDocPath} should reference docs/orchestrator-agnostic-roadmap.md to avoid orphan docs`);
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
