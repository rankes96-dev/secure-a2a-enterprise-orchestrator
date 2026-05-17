import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const backendPackages = [
  "services/orchestrator-api",
  "services/mock-identity-provider",
  "services/end-user-triage-agent",
  "services/jira-agent",
  "services/github-agent",
  "services/pagerduty-agent",
  "services/security-oauth-agent",
  "services/api-health-agent",
  "real-external-agent"
];

let failed = false;

function fail(message: string): void {
  console.error(`fail - ${message}`);
  failed = true;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

type PackageJson = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

for (const packageDir of backendPackages) {
  const packageJsonPath = path.join(packageDir, "package.json");
  const tsconfigBuildPath = path.join(packageDir, "tsconfig.build.json");
  const packageJson = readJson<PackageJson>(packageJsonPath);
  const scripts = packageJson.scripts ?? {};

  if (scripts.typecheck !== "tsc --noEmit") {
    fail(`${packageDir} typecheck should be tsc --noEmit`);
  }
  if (!scripts.build?.includes("tsconfig.build.json") || !scripts.build.includes("tsc -p")) {
    fail(`${packageDir} build should compile tsconfig.build.json`);
  }
  if (scripts.build?.includes("--noEmit")) {
    fail(`${packageDir} build must emit production JavaScript`);
  }
  if (!scripts.clean?.includes("clean-dist.mjs")) {
    fail(`${packageDir} clean should use scripts/clean-dist.mjs`);
  }
  if (scripts.start?.includes("tsx")) {
    fail(`${packageDir} production start must not use tsx`);
  }
  if (!scripts.start?.startsWith("node dist/")) {
    fail(`${packageDir} production start should run node dist/...`);
  }
  if (!scripts.dev?.includes("tsx")) {
    fail(`${packageDir} dev should keep using tsx`);
  }
  if (!existsSync(tsconfigBuildPath)) {
    fail(`${packageDir} should have tsconfig.build.json`);
  } else {
    const tsconfigBuild = readFileSync(tsconfigBuildPath, "utf8");
    for (const phrase of ['"outDir": "dist"', '"rootDir": "src"', '"noEmit": false', '"module": "NodeNext"', '"moduleResolution": "NodeNext"']) {
      if (!tsconfigBuild.includes(phrase)) {
        fail(`${packageDir} tsconfig.build.json missing ${phrase}`);
      }
    }
  }
}

const sharedPackage = readJson<PackageJson & { main?: string; exports?: unknown }>("packages/shared/package.json");
if (sharedPackage.main !== "dist/index.js") {
  fail("@a2a/shared runtime main should point to dist/index.js");
}
if (!JSON.stringify(sharedPackage.exports).includes("./dist/http.js")) {
  fail("@a2a/shared should export compiled http helper");
}

const rootPackage = readJson<PackageJson>("package.json");
if (!rootPackage.scripts?.["verify:v1"]?.includes("verify:production-build")) {
  fail("verify:v1 should include verify:production-build");
}

for (const requiredEnvExample of [
  "services/orchestrator-api/.env.local.example",
  "services/orchestrator-api/.env.production.example",
  "services/mock-identity-provider/.env.local.example",
  "services/mock-identity-provider/.env.production.example",
  "real-external-agent/.env.local.example",
  "real-external-agent/.env.production.example"
]) {
  if (!existsSync(requiredEnvExample)) {
    fail(`missing environment template ${requiredEnvExample}`);
  }
}

const deploymentDoc = readFileSync("docs/deployment.md", "utf8");
for (const forbidden of ["tsx src/index.ts", "tsx watch", "REDIS_URL", "WEB_ORIGIN", "CORS_ALLOWED_ORIGINS"]) {
  if (deploymentDoc.includes(forbidden)) {
    fail(`deployment docs should not include ${forbidden}`);
  }
}
for (const required of ["dist", "node dist/index.js", "OpenRouter", "Upstash Redis", "Vercel", "Railway"]) {
  if (!deploymentDoc.includes(required)) {
    fail(`deployment docs should include ${required}`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Production build verification passed.");
}
