import { existsSync, readFileSync } from "node:fs";

const deploymentPath = "docs/deployment.md";
let failed = false;

if (!existsSync(deploymentPath)) {
  console.error("fail - deployment readiness documentation should exist at docs/deployment.md");
  process.exit(1);
}

const doc = readFileSync(deploymentPath, "utf8");

for (const phrase of [
  "Vercel",
  "Railway",
  "Upstash",
  "Upstash Redis",
  "external connector agents",
  "separate Railway services",
  "Jira external agent",
  "ServiceNow external agent",
  "GitHub external agent",
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
  "INTERNAL_SERVICE_TOKEN",
  "ORCHESTRATOR_PRIVATE_JWK_JSON",
  "ORCHESTRATOR_PUBLIC_JWK_JSON",
  "Gateway onboarding must use the public Railway agent URL",
  "Select BizApps / IT mode",
  "Run Connector Test Center"
]) {
  if (!doc.includes(phrase)) {
    console.error(`fail - deployment readiness doc missing: ${phrase}`);
    failed = true;
  }
}

for (const forbidden of [
  "REDIS_URL",
  "CORS_ALLOWED_ORIGINS",
  "WEB_ORIGIN",
  "OpenRouter or other AI provider",
  "OPENROUTER_API_KEY=optional",
  "Redis on Railway or Upstash"
]) {
  if (doc.includes(forbidden)) {
    console.error(`fail - deployment readiness doc should not include: ${forbidden}`);
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Deployment readiness verification passed.");
}
