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
  "Redis",
  "Upstash",
  "external connector agents",
  "separate Railway services",
  "public HTTPS URL",
  "VITE_ORCHESTRATOR_API_URL",
  "REDIS_URL",
  "CORS_ALLOWED_ORIGINS",
  "WEB_ORIGIN",
  "PUBLIC_BASE_URL",
  "Gateway onboarding must use the public Railway agent URL",
  "Select BizApps / IT mode",
  "Run Connector Test Center"
]) {
  if (!doc.includes(phrase)) {
    console.error(`fail - deployment readiness doc missing: ${phrase}`);
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Deployment readiness verification passed.");
}
