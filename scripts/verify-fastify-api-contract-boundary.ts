import { existsSync, readFileSync } from "node:fs";
import { createOgenFastifyApp } from "../services/orchestrator-api/src/http/createOgenFastifyApp.js";

let failed = false;

function fail(message: string): void {
  failed = true;
  console.error(`FAIL: ${message}`);
}

function ok(message: string): void {
  console.log(`ok - ${message}`);
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
    return;
  }
  ok(context);
}

const packageJsonText = read("package.json");
const createAppSource = read("services/orchestrator-api/src/http/createOgenFastifyApp.ts");
const publicRoutesSource = read("services/orchestrator-api/src/http/routes/registerPublicMetadataRoutes.ts");
const starterSource = read("services/orchestrator-api/src/http/startOgenFastifyServer.ts");
const indexSource = read("services/orchestrator-api/src/index.ts");
const sharedHttpSource = read("packages/shared/src/http.ts");
const deploymentDocs = read("docs/deployment.md");
const platformDocs = read("docs/v2-platform-foundation.md");
const productIdentityDocs = read("docs/ogen-product-identity.md");

const parsedPackageJson = JSON.parse(packageJsonText) as {
  dependencies?: Record<string, string>;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
};

for (const dependency of ["fastify", "@fastify/cors", "@fastify/cookie"]) {
  if (!parsedPackageJson.dependencies?.[dependency]) {
    fail(`package.json should include ${dependency}`);
  } else {
    ok(`package.json includes ${dependency}`);
  }
}

if (!parsedPackageJson.engines?.node?.includes(">=20")) {
  fail("package.json engines.node should require >=20");
} else {
  ok("package.json engines.node requires >=20");
}

for (const phrase of [
  "Fastify",
  "@fastify/cors",
  "@fastify/cookie",
  "bodyLimit",
  "MAX_BODY_BYTES",
  "ALLOWED_ORIGINS",
  "credentials: true",
  "setErrorHandler",
  "internal_server_error",
  "requestId",
  "NODE_ENV === \"production\""
]) {
  requireIncludes(createAppSource, phrase, "Fastify app factory includes required boundary behavior");
}

for (const phrase of [
  "app.get(\"/health\"",
  "app.get(\"/.well-known/a2a-gateway.json\"",
  "app.get(\"/.well-known/jwks.json\"",
  "schema:",
  "response:",
  "gatewayMetadata()",
  "gatewayPublicJwks()"
]) {
  requireIncludes(publicRoutesSource, phrase, "public metadata routes include schema-first public route");
}

for (const phrase of [
  "createOgenFastifyApp",
  "app.listen",
  "Listening with Fastify"
]) {
  requireIncludes(starterSource, phrase, "Fastify starter exists");
}

for (const phrase of [
  "ORCHESTRATOR_HTTP_FRAMEWORK",
  "startOgenFastifyServer",
  "startJsonServer"
]) {
  requireIncludes(indexSource, phrase, "index keeps opt-in Fastify boundary and existing server");
}

requireIncludes(sharedHttpSource, "export function startJsonServer", "shared HTTP helper still exports startJsonServer");
requireIncludes(sharedHttpSource, "mock-agent helpers", "shared HTTP helper documents gradual Fastify adoption");

if (parsedPackageJson.scripts?.["verify:fastify-api-contract-boundary"] !== "tsx scripts/verify-fastify-api-contract-boundary.ts") {
  fail("package.json should include verify:fastify-api-contract-boundary");
} else {
  ok("package.json includes verify:fastify-api-contract-boundary");
}
if (!parsedPackageJson.scripts?.["verify:v2-plan"]?.includes("verify:sdk-readiness-contracts && npm run verify:fastify-api-contract-boundary")) {
  fail("verify:v2-plan should run Fastify API contract boundary after SDK readiness contracts");
} else {
  ok("verify:v2-plan includes Fastify API contract boundary after SDK readiness contracts");
}

for (const phrase of [
  "Ogen requires Node.js >= 20.",
  "Railway/runtime should be configured for Node 20 or newer.",
  "Fastify mode is opt-in:",
  "ORCHESTRATOR_HTTP_FRAMEWORK=fastify",
  "Current Fastify mode serves only:",
  "GET /health",
  "GET /.well-known/a2a-gateway.json",
  "GET /.well-known/jwks.json",
  "Use default server mode for the full app until protected routes are migrated."
]) {
  requireIncludes(deploymentDocs, phrase, "deployment docs cover Node runtime and Fastify mode clarity");
}

for (const phrase of [
  "Phase 2.14  Fastify API Contract Boundary",
  "startJsonServer remains available",
  "gradual schema-first HTTP boundary",
  "Only public metadata/health routes are migrated initially.",
  "Future protected APIs will migrate route by route.",
  "OpenAPI and SDK generation",
  "Node.js >= 20 is required.",
  "Fastify mode is public-metadata-only for now.",
  "startJsonServer remains the default full application server."
]) {
  requireIncludes(platformDocs, phrase, "platform docs cover Fastify API contract boundary");
}
requireIncludes(productIdentityDocs, "Ogen APIs should be schema-first so SDKs can be generated and verified.", "product identity docs cover schema-first API principle");

async function main(): Promise<void> {
  const app = await createOgenFastifyApp();
  app.get("/__verification-error", async () => {
    throw new Error("verification failure");
  });

  const health = await app.inject({ method: "GET", url: "/health" });
  if (health.statusCode !== 200) {
    fail(`GET /health should return 200, got ${health.statusCode}`);
  } else {
    const body = health.json() as { status?: string; service?: string };
    if (body.status !== "ok" || body.service !== "ogen-orchestrator-api") {
      fail("GET /health should return the Fastify health envelope");
    } else {
      ok("Fastify /health route works");
    }
  }

  const metadata = await app.inject({ method: "GET", url: "/.well-known/a2a-gateway.json" });
  if (metadata.statusCode !== 200) {
    fail(`GET /.well-known/a2a-gateway.json should return 200, got ${metadata.statusCode}`);
  } else {
    const body = metadata.json() as { gatewayId?: string; jwksUri?: string };
    if (body.gatewayId !== "secure-a2a-gateway" || !body.jwksUri?.endsWith("/.well-known/jwks.json")) {
      fail("gateway metadata should expose public gateway metadata");
    } else {
      ok("Fastify gateway metadata route works");
    }
  }

  const jwks = await app.inject({ method: "GET", url: "/.well-known/jwks.json" });
  if (jwks.statusCode !== 200) {
    fail(`GET /.well-known/jwks.json should return 200, got ${jwks.statusCode}`);
  } else {
    const body = jwks.json() as { keys?: unknown[] };
    if (!Array.isArray(body.keys)) {
      fail("JWKS route should return a public keys array");
    } else {
      ok("Fastify JWKS route works");
    }
  }

  const errorResponse = await app.inject({ method: "GET", url: "/__verification-error" });
  const errorText = errorResponse.body;
  if (errorResponse.statusCode !== 500) {
    fail(`Fastify error handler should return 500, got ${errorResponse.statusCode}`);
  } else if (!errorText.includes("internal_server_error") || errorText.includes("stack") || errorText.includes("at ")) {
    fail("Fastify error response should use safe envelope without stack traces");
  } else {
    ok("Fastify error handler returns safe envelope without stack traces");
  }

  await app.close();

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log("Fastify API contract boundary verification passed.");
  }
}

void main();
