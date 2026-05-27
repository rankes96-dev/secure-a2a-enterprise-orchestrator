import { existsSync, readFileSync } from "node:fs";

let failed = false;

function fail(message: string): void {
  failed = true;
  console.error(`fail - ${message}`);
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

function requireExcludes(source: string, phrase: string, context: string): void {
  if (source.includes(phrase)) {
    fail(`${context} should not include forbidden phrase: ${phrase}`);
    return;
  }
  ok(context);
}

function requireBefore(source: string, first: string, second: string, context: string): void {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex > secondIndex) {
    fail(`${context} should contain ${first} before ${second}`);
    return;
  }
  ok(context);
}

function blockBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start < 0) {
    fail(`missing block start: ${startMarker}`);
    return "";
  }
  const end = source.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

const sharedProtocol = read("packages/shared/src/a2aProtocol.ts");
const sharedIndex = read("packages/shared/src/index.ts");
const sharedHttp = read("packages/shared/src/http.ts");
const packageJson = read("package.json");
const packageLock = read("package-lock.json");
const orchestrator = read("services/orchestrator-api/src/index.ts");
const agentCards = read("services/orchestrator-api/src/agentCards.ts");
const connectorRuntime = read("services/orchestrator-api/src/connectorRuntime.ts");
const connectorActionPlanner = read("services/orchestrator-api/src/connectorActionPlanner.ts");
const onboardingUtils = read("services/orchestrator-api/src/agentOnboarding/utils.ts");
const trustResponseVerifier = read("services/orchestrator-api/src/agentOnboarding/trustResponseVerifier.ts");
const fastifyApp = read("services/orchestrator-api/src/http/createOgenFastifyApp.ts");
const realExternalAgent = read("real-external-agent/src/index.ts");
const realExternalPackage = read("real-external-agent/package.json");
const v2Docs = read("docs/v2-platform-foundation.md");
const deploymentDocs = read("docs/deployment.md");
const sdkDocs = read("docs/sdk-readiness-contracts.md");

for (const phrase of [
  'A2A_PROTOCOL_VERSION = "1.0"',
  'A2A_VERSION_HEADER = "A2A-Version"',
  'A2A_CONTENT_TYPE = "application/a2a+json"',
  'A2A_AGENT_CARD_WELL_KNOWN_PATH = "/.well-known/agent-card.json"',
  "OgenA2AProtocolVersion",
  "OgenA2AInterface",
  "OgenA2AAgentCardCompatibility",
  "unsupportedExplicitA2AProtocolVersion",
  "buildUnsupportedA2AProtocolVersionResponse",
  "a2aJsonRequestHeaders",
  "a2aJsonAcceptHeaders",
  "taskExecuted: false",
  "protectedMaterialExposed: false",
  "tokenMaterialStored: false",
  "rawPromptStored: false"
]) {
  requireIncludes(sharedProtocol, phrase, "shared A2A protocol constants/types");
}
requireIncludes(sharedIndex, 'export * from "./a2aProtocol.js"', "shared index exports A2A protocol helpers");
requireIncludes(sharedHttp, "content-type,a2a-version", "shared JSON server CORS permits A2A-Version");
requireIncludes(fastifyApp, '"a2a-version"', "Fastify CORS permits A2A-Version");

for (const phrase of [
  "A2A_AGENT_CARD_WELL_KNOWN_PATH",
  "A2A_LEGACY_AGENT_CARD_PATH",
  "OGEN_A2A_AGENT_CARD_COMPATIBILITY",
  "compatibility?: OgenA2AAgentCardCompatibility",
  "compatibility: OGEN_A2A_AGENT_CARD_COMPATIBILITY",
  "legacyAgentCardUrl",
  "a2aJsonAcceptHeaders()"
]) {
  requireIncludes(agentCards, phrase, "orchestrator agent-card discovery uses A2A compatibility path");
}

for (const phrase of [
  "a2aJsonRequestHeaders()",
  '"x-internal-service-token"',
  "authorization: `Bearer ${issued.accessToken}`",
  "unsupportedExplicitA2AProtocolVersion(request.headers)",
  "buildUnsupportedA2AProtocolVersionResponse(unsupportedA2AVersion)"
]) {
  requireIncludes(orchestrator, phrase, "orchestrator A2A outbound and version handling");
}
const resolveRoute = blockBetween(orchestrator, 'request.url !== "/resolve"', "});\n}");
requireBefore(resolveRoute, "unsupportedExplicitA2AProtocolVersion(request.headers)", "await resolveIssue", "/resolve rejects unsupported A2A version before task execution");
requireIncludes(connectorRuntime, "...a2aJsonRequestHeaders()", "connector runtime outbound A2A headers");
requireIncludes(connectorActionPlanner, "...a2aJsonRequestHeaders()", "connector action-plan outbound A2A headers");
requireIncludes(onboardingUtils, "a2aJsonAcceptHeaders()", "onboarding discovery outbound A2A accept/version headers");
requireIncludes(trustResponseVerifier, "headers: a2aJsonRequestHeaders()", "onboarding challenge outbound A2A request headers");

const localAgentPaths = [
  "services/jira-agent/src/index.ts",
  "services/github-agent/src/index.ts",
  "services/pagerduty-agent/src/index.ts",
  "services/security-oauth-agent/src/index.ts",
  "services/api-health-agent/src/index.ts",
  "services/end-user-triage-agent/src/index.ts"
];

for (const path of localAgentPaths) {
  const source = read(path);
  requireIncludes(source, 'request.url === "/agent-card" || request.url === A2A_AGENT_CARD_WELL_KNOWN_PATH', `${path} exposes legacy and well-known Agent Card routes`);
  requireIncludes(source, "compatibility: OGEN_A2A_AGENT_CARD_COMPATIBILITY", `${path} advertises safe A2A compatibility metadata`);
  requireIncludes(source, "unsupportedExplicitA2AProtocolVersion(request.headers)", `${path} rejects unsupported explicit A2A versions`);
  requireIncludes(source, "buildUnsupportedA2AProtocolVersionResponse(unsupportedVersion)", `${path} returns structured protocol error`);
  requireBefore(source, "unsupportedExplicitA2AProtocolVersion(request.headers)", "readJsonBody<A2ATask | AgentTask>(request)", `${path} checks A2A version before task body execution`);
}

requireIncludes(realExternalPackage, '"@a2a/shared": "0.1.0"', "real external agent consumes shared A2A protocol helper");
requireIncludes(packageLock, '"@a2a/shared": "0.1.0"', "package lock records real external agent shared dependency");
requireIncludes(realExternalAgent, "unsupportedExplicitA2AProtocolVersion(request.headers)", "real external connector rejects unsupported explicit A2A versions");
requireBefore(realExternalAgent, "unsupportedExplicitA2AProtocolVersion(request.headers)", "readJsonBody<ConnectorRuntimeTask>(request)", "real external connector checks A2A version before runtime task body execution");

const parsedPackage = JSON.parse(packageJson) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
if (parsedPackage.scripts?.["verify:a2a-protocol-compatibility"] !== "tsx scripts/verify-a2a-protocol-compatibility.ts") {
  fail("package.json should include verify:a2a-protocol-compatibility");
} else {
  ok("package.json includes verify:a2a-protocol-compatibility");
}
if (!parsedPackage.scripts?.["verify:v2-plan"]?.includes("verify:a2a-protocol-compatibility")) {
  fail("verify:v2-plan should include verify:a2a-protocol-compatibility");
} else {
  ok("verify:v2-plan includes verify:a2a-protocol-compatibility");
}
requireExcludes(packageJson, "@a2a-js/sdk", "Phase 2.20a does not adopt official A2A JS SDK");
requireIncludes(sharedIndex, "export interface A2ATask", "internal A2ATask remains present");

for (const phrase of [
  "Phase 2.20a  A2A 1.0 Protocol Compatibility Layer",
  "compatibility layer, not a replacement",
  "A2A_PROTOCOL_VERSION = \"1.0\"",
  "A2A-Version: 1.0",
  "application/a2a+json",
  "unsupported_a2a_version",
  "Ogen policy remains authority",
  "/runtime/authorize` remains authorization-only"
]) {
  requireIncludes(v2Docs, phrase, "V2 docs cover A2A compatibility boundary");
}

for (const phrase of [
  "A2A 1.0 compatibility rollout",
  "GET /.well-known/agent-card.json",
  "GET /agent-card",
  "A2A-Version: 1.0",
  "application/a2a+json",
  "unsupported_a2a_version",
  "compatibility-first"
]) {
  requireIncludes(deploymentDocs, phrase, "deployment docs cover A2A compatibility rollout");
}

for (const phrase of [
  "A2A 1.0 Compatibility Contract",
  "without replacing Ogen's internal task model",
  "without replacing Ogen's internal task model or adopting the official JavaScript SDK",
  "A2A_AGENT_CARD_WELL_KNOWN_PATH",
  "unsupported explicit versions must return a safe protocol error before task execution",
  "Protocol metadata is not authorization"
]) {
  requireIncludes(sdkDocs, phrase, "SDK readiness docs cover A2A compatibility contract");
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("A2A protocol compatibility verification passed.");
}
