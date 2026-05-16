import { existsSync, readFileSync } from "node:fs";

const deploymentPath = "docs/deployment.md";
const orchestratorProductionEnvPath = "services/orchestrator-api/.env.production.example";
let failed = false;

if (!existsSync(deploymentPath)) {
  console.error("fail - deployment readiness documentation should exist at docs/deployment.md");
  process.exit(1);
}

if (!existsSync(orchestratorProductionEnvPath)) {
  console.error("fail - orchestrator production environment template should exist");
  process.exit(1);
}

const doc = readFileSync(deploymentPath, "utf8");
const orchestratorProductionEnv = readFileSync(orchestratorProductionEnvPath, "utf8");

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
