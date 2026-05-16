import { existsSync, readFileSync } from "node:fs";
import { evaluateAdminAccess } from "../real-external-agent/src/adminSecurity.js";
import { applyConnectorPreset } from "../real-external-agent/src/connectorPresetEnv.js";
import { port } from "../real-external-agent/src/config.js";
import { discoveryDocument } from "../real-external-agent/src/discoveryDocument.js";

const deploymentPath = "docs/deployment.md";
const orchestratorProductionEnvPath = "services/orchestrator-api/.env.production.example";
const realExternalAgentProductionEnvPath = "real-external-agent/.env.production.example";
let failed = false;

if (!existsSync(deploymentPath)) {
  console.error("fail - deployment readiness documentation should exist at docs/deployment.md");
  process.exit(1);
}

if (!existsSync(orchestratorProductionEnvPath)) {
  console.error("fail - orchestrator production environment template should exist");
  process.exit(1);
}

if (!existsSync(realExternalAgentProductionEnvPath)) {
  console.error("fail - real external agent production environment template should exist");
  process.exit(1);
}

const doc = readFileSync(deploymentPath, "utf8");
const orchestratorProductionEnv = readFileSync(orchestratorProductionEnvPath, "utf8");
const realExternalAgentProductionEnv = readFileSync(realExternalAgentProductionEnvPath, "utf8");

function hasEnvAssignment(content: string, name: string): boolean {
  return new RegExp(`^${name}=\\S+`, "m").test(content);
}

for (const phrase of [
  "Vercel",
  "Railway",
  "Production services:",
  "Upstash",
  "Upstash Redis",
  "Upstash Redis is the production replay and security state store.",
  "Browser sessions are in-memory in V1. Persistent browser session storage is a V2 item.",
  "replay and security state, not browser sessions",
  "OpenRouter is the production AI provider",
  "external connector agents",
  "separate Railway services",
  "Jira external agent",
  "ServiceNow external agent",
  "GitHub external agent",
  "Legacy internal mock agents are local-development helpers only and are not deployed in the V1 production connector-first setup.",
  "public HTTPS URL",
  "VITE_ORCHESTRATOR_API_URL",
  "ALLOWED_ORIGINS",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "OPENROUTER_BASE_URL=https://openrouter.ai/api/v1",
  "STATE_STORE_DRIVER=upstash",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "SESSION_COOKIE_SECURE=true",
  "SESSION_COOKIE_SAMESITE=None",
  "TRUST_PROXY_HEADERS=false",
  "SHOW_INTERNAL_HEALTH_URLS=false",
  "SHOW_LEGACY_INTERNAL_AGENT_DISCOVERY_WARNINGS=false",
  "GATEWAY_ISSUER=https://<orchestrator>.railway.app",
  "ORCHESTRATOR_PUBLIC_URL=https://<orchestrator>.railway.app",
  "CONNECTOR_RUNTIME_ALLOWED_ORIGINS=https://<jira-agent>.railway.app,https://<servicenow-agent>.railway.app,https://<github-agent>.railway.app",
  "Gateway metadata",
  "Gateway JWKS URI",
  "onboarding challenges as the issuer",
  "origins only",
  "no path, query, or fragment",
  "GET /.well-known/a2a-connector-profile.json",
  "The external connector admin console is local-only by default.",
  "Railway provides `PORT`; do not set `EXTERNAL_AGENT_PORT` in Railway production.",
  "The connector preset ports `4201`, `4202`, and `4203` are local-only defaults for",
  "The connector-specific start command and EXTERNAL_* connector identity env values must match.",
  "The service fails fast in production if they do not.",
  "EXTERNAL_AGENT_ADMIN_ENABLED=false",
  "EXTERNAL_AGENT_ADMIN_TOKEN=<long-random-admin-token-if-enabled>",
  "requires `EXTERNAL_AGENT_ADMIN_TOKEN`",
  "x-admin-token",
  "x-internal-service-token",
  "Do not enable public unauthenticated admin endpoints in Railway.",
  "INTERNAL_SERVICE_TOKEN",
  "ORCHESTRATOR_PRIVATE_JWK_JSON",
  "ORCHESTRATOR_PUBLIC_JWK_JSON",
  "Gateway onboarding must use the public Railway agent URL",
  "Select BizApps / IT mode",
  "Run Connector Test Center",
  "node dist/index.js",
  "node dist/startConnector.js"
]) {
  if (!doc.includes(phrase)) {
    console.error(`fail - deployment readiness doc missing: ${phrase}`);
    failed = true;
  }
}

if (!hasEnvAssignment(orchestratorProductionEnv, "GATEWAY_ISSUER") && !hasEnvAssignment(orchestratorProductionEnv, "ORCHESTRATOR_PUBLIC_URL")) {
  console.error("fail - orchestrator production env should include GATEWAY_ISSUER or ORCHESTRATOR_PUBLIC_URL");
  failed = true;
}

if (!hasEnvAssignment(orchestratorProductionEnv, "CONNECTOR_RUNTIME_ALLOWED_ORIGINS")) {
  console.error("fail - orchestrator production env should include CONNECTOR_RUNTIME_ALLOWED_ORIGINS");
  failed = true;
}

if (!orchestratorProductionEnv.includes("CONNECTOR_RUNTIME_ALLOWED_ORIGINS=https://<jira-agent>.railway.app,https://<servicenow-agent>.railway.app,https://<github-agent>.railway.app")) {
  console.error("fail - orchestrator production env should include Railway external connector runtime origins");
  failed = true;
}

if (!realExternalAgentProductionEnv.includes("EXTERNAL_AGENT_ADMIN_ENABLED=false")) {
  console.error("fail - real external agent production env should disable admin endpoints by default");
  failed = true;
}

if (!hasEnvAssignment(realExternalAgentProductionEnv, "EXTERNAL_AGENT_ADMIN_TOKEN")) {
  console.error("fail - real external agent production env should include EXTERNAL_AGENT_ADMIN_TOKEN");
  failed = true;
}

function assertAdminDecision(
  label: string,
  decision: ReturnType<typeof evaluateAdminAccess>,
  expected: "ok" | 401 | 403 | 404
): void {
  if (expected === "ok") {
    if (!decision.ok) {
      console.error(`fail - ${label} should allow access`);
      failed = true;
    }
    return;
  }

  if (decision.ok || decision.status !== expected) {
    console.error(`fail - ${label} should return ${expected}`);
    failed = true;
  }
}

const productionAdminDisabledEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  EXTERNAL_AGENT_ADMIN_ENABLED: "false"
};
const productionAdminEnabledEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  EXTERNAL_AGENT_ADMIN_ENABLED: "true",
  EXTERNAL_AGENT_ADMIN_TOKEN: "expected-admin-token"
};

assertAdminDecision("production /admin default", evaluateAdminAccess("/admin", {}, productionAdminDisabledEnv), 404);
assertAdminDecision("production /admin/config default", evaluateAdminAccess("/admin/config", {}, productionAdminDisabledEnv), 404);
assertAdminDecision("production admin missing token", evaluateAdminAccess("/admin/config", {}, productionAdminEnabledEnv), 401);
assertAdminDecision(
  "production admin invalid token",
  evaluateAdminAccess("/admin/config", { "x-admin-token": "wrong-token" }, productionAdminEnabledEnv),
  403
);
assertAdminDecision(
  "production admin x-admin-token",
  evaluateAdminAccess("/admin/config", { "x-admin-token": "expected-admin-token" }, productionAdminEnabledEnv),
  "ok"
);
assertAdminDecision(
  "production admin x-internal-service-token",
  evaluateAdminAccess("/admin/config", { "x-internal-service-token": "expected-admin-token" }, productionAdminEnabledEnv),
  "ok"
);

function withProcessEnv<T>(nextEnv: NodeJS.ProcessEnv, action: () => T): T {
  const previousEnv = process.env;
  process.env = nextEnv;
  try {
    return action();
  } finally {
    process.env = previousEnv;
  }
}

withProcessEnv({ NODE_ENV: "production", PORT: "12345" }, () => {
  applyConnectorPreset("jira");
  if (process.env.EXTERNAL_AGENT_PORT !== undefined) {
    console.error("fail - connector preset should not set EXTERNAL_AGENT_PORT when Railway PORT is defined");
    failed = true;
  }
  if (port() !== 12345) {
    console.error("fail - Railway PORT should win over connector preset port");
    failed = true;
  }
});

withProcessEnv({
  NODE_ENV: "production",
  EXTERNAL_CONNECTOR_ID: "jira-reference",
  EXTERNAL_AGENT_ID: "external-jira-agent",
  EXTERNAL_AGENT_CLIENT_ID: "jira-agent-client"
}, () => {
  try {
    applyConnectorPreset("servicenow");
    console.error("fail - production connector preset mismatch should fail fast");
    failed = true;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Connector preset/environment mismatch")) {
      console.error("fail - production connector preset mismatch should return a clear error");
      failed = true;
    }
  }
});

withProcessEnv({
  NODE_ENV: "production",
  PORT: "12345",
  EXTERNAL_AGENT_PORT: "4202",
  EXTERNAL_CONNECTOR_ID: "servicenow-reference",
  EXTERNAL_AGENT_ID: "external-servicenow-agent",
  EXTERNAL_AGENT_CLIENT_ID: "servicenow-agent-client"
}, () => {
  try {
    applyConnectorPreset("servicenow");
  } catch {
    console.error("fail - production matching explicit connector identity should pass");
    failed = true;
  }
  if (process.env.EXTERNAL_AGENT_PORT !== "4202") {
    console.error("fail - connector preset should preserve explicit EXTERNAL_AGENT_PORT");
    failed = true;
  }
  if (port() !== 12345) {
    console.error("fail - production PORT should still win over EXTERNAL_AGENT_PORT");
    failed = true;
  }
});

for (const [preset, expectedPort] of [
  ["jira", 4201],
  ["servicenow", 4202],
  ["github", 4203]
] as const) {
  withProcessEnv({}, () => {
    applyConnectorPreset(preset);
    if (port() !== expectedPort) {
      console.error(`fail - local ${preset} connector preset should resolve port ${expectedPort}`);
      failed = true;
    }
  });
}

withProcessEnv({ NODE_ENV: "production", PORT: "12345", EXTERNAL_AGENT_ADMIN_ENABLED: "false" }, () => {
  const discovery = discoveryDocument();
  if ("adminConsoleUrl" in discovery) {
    console.error("fail - production discovery should not advertise adminConsoleUrl when admin is disabled");
    failed = true;
  }
});

withProcessEnv({ NODE_ENV: "production", PORT: "12345", EXTERNAL_AGENT_ADMIN_ENABLED: "true" }, () => {
  const discovery = discoveryDocument();
  if (!("adminConsoleUrl" in discovery)) {
    console.error("fail - production discovery should advertise adminConsoleUrl when admin is enabled");
    failed = true;
  }
});

for (const publicConnectorEndpoint of [
  "/health",
  "/.well-known/a2a-agent.json",
  "/.well-known/a2a-supported-connectors.json",
  "/.well-known/a2a-connector-profile.json",
  "/.well-known/jwks.json",
  "/onboarding/challenge",
  "/a2a/task"
]) {
  assertAdminDecision(
    `production public connector endpoint ${publicConnectorEndpoint}`,
    evaluateAdminAccess(publicConnectorEndpoint, {}, productionAdminDisabledEnv),
    "ok"
  );
}

for (const forbidden of [
  "REDIS_URL",
  "CORS_ALLOWED_ORIGINS",
  "WEB_ORIGIN",
  "OpenRouter or other AI provider",
  "OPENROUTER_API_KEY=optional",
  "Redis on Railway or Upstash",
  "tsx src/index.ts"
]) {
  if (doc.includes(forbidden)) {
    console.error(`fail - deployment readiness doc should not include: ${forbidden}`);
    failed = true;
  }
}

for (const forbiddenLegacyEnvPlaceholder of [
  "<legacy-jira-agent>",
  "<legacy-github-agent>",
  "<legacy-pagerduty-agent>",
  "<legacy-security-oauth-agent>",
  "<legacy-api-health-agent>",
  "<legacy-end-user-triage-agent>"
]) {
  if (orchestratorProductionEnv.includes(forbiddenLegacyEnvPlaceholder)) {
    console.error(`fail - orchestrator production env should not include: ${forbiddenLegacyEnvPlaceholder}`);
    failed = true;
  }
}

for (const forbiddenProductionEnvName of [
  "JIRA_AGENT_URL",
  "GITHUB_AGENT_URL",
  "PAGERDUTY_AGENT_URL",
  "SECURITY_OAUTH_AGENT_URL",
  "API_HEALTH_AGENT_URL",
  "END_USER_TRIAGE_AGENT_URL"
]) {
  if (orchestratorProductionEnv.includes(forbiddenProductionEnvName)) {
    console.error(`fail - orchestrator production env should not include local legacy agent env: ${forbiddenProductionEnvName}`);
    failed = true;
  }
}

for (const legacyDeployInstruction of [
  "Railway hosts `services/end-user-triage-agent`",
  "Railway hosts `services/jira-agent`",
  "Railway hosts `services/github-agent`",
  "Railway hosts `services/pagerduty-agent`",
  "Railway hosts `services/security-oauth-agent`",
  "Railway hosts `services/api-health-agent`",
  "Deploy `services/end-user-triage-agent`",
  "Deploy `services/jira-agent`",
  "Deploy `services/github-agent`",
  "Deploy `services/pagerduty-agent`",
  "Deploy `services/security-oauth-agent`",
  "Deploy `services/api-health-agent`"
]) {
  if (doc.includes(legacyDeployInstruction)) {
    console.error(`fail - deployment doc should not instruct production deployment of legacy internal agent: ${legacyDeployInstruction}`);
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Deployment readiness verification passed.");
}
