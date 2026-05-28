import { existsSync, readFileSync } from "node:fs";

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

function requireBefore(source: string, first: string, second: string, context: string): void {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex > secondIndex) {
    fail(`${context} should place ${first} before ${second}`);
    return;
  }
  ok(context);
}

function functionBody(source: string, name: string): string {
  const marker = `function ${name}`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) {
    fail(`${name} should exist`);
    return "";
  }
  const start = source.indexOf("{", markerIndex);
  if (start < 0) {
    fail(`${name} should have a body`);
    return "";
  }

  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  fail(`${name} should have a complete body`);
  return "";
}

const main = read("apps/web-ui/src/main.tsx");
const securitySummary = read("apps/web-ui/src/securitySummary.ts");
const runTask = read("apps/web-ui/src/components/run-task/RunTaskTab.tsx");
const securityTimeline = read("apps/web-ui/src/components/security-timeline/SecurityTimelineTab.tsx");
const types = read("apps/web-ui/src/components/types.ts");
const packageJsonText = read("package.json");
const v2Plan = read("scripts/verify-v2-plan.ts");

requireIncludes(main, 'from "./securitySummary";', "main imports connector runtime security summary helpers");

const primaryPolicyLabel = functionBody(securitySummary, "primaryPolicyLabel");
requireBefore(primaryPolicyLabel, 'response?.connectorPolicy?.effect === "allow"', "const decisions = securityDecisions(response);", "primaryPolicyLabel checks connectorPolicy before securityDecisions fallback");
for (const phrase of [
  'return "Connector policy allowed";',
  'return "Connector policy blocked";',
  'return "Connector policy needs approval";',
  'return "Connector policy evaluated";'
]) {
  requireIncludes(primaryPolicyLabel, phrase, "primaryPolicyLabel maps connector policy effects");
}

const tokenStatusLabel = functionBody(securitySummary, "tokenStatusLabel");
requireBefore(tokenStatusLabel, "const runtime = response?.connectorRuntime;", "const tasks = response?.a2aTasks ?? [];", "tokenStatusLabel checks connector runtime before legacy A2A tasks");
requireBefore(tokenStatusLabel, "const tokenMetadata = runtime.tokenMetadata;", "runtime.authorizationRequirement || runtime.agentResponse?.authorizationRequirement", "tokenStatusLabel checks connectorRuntime.tokenMetadata before authorization fallback");
for (const phrase of [
  'return "runtime token issued";',
  'return "user authorization required";',
  'return "runtime executed; token proof unavailable";',
  'return "raw token hidden";',
  'return "not applicable";'
]) {
  requireIncludes(tokenStatusLabel, phrase, "tokenStatusLabel returns connector-aware token summaries");
}

const finalAnswerEventStart = securitySummary.indexOf('id: "final-answer"');
const finalAnswerEvent = finalAnswerEventStart >= 0 ? securitySummary.slice(finalAnswerEventStart, securitySummary.indexOf("return events;", finalAnswerEventStart)) : "";
for (const phrase of [
  "response.connectorRuntime || response.connectorRouting",
  'label: "Connector route"',
  'label: "Connector ID"',
  'label: "Resource system"',
  'label: "Runtime agent ID"',
  'label: "Skill ID"',
  'label: "Skill label"',
  'label: "Runtime executed"',
  'label: "Agent response status"',
  'label: "Legacy/internal A2A tasks"'
]) {
  requireIncludes(finalAnswerEvent, phrase, "final answer event includes connector runtime metadata");
}

const latestActorTokenObservedIndex = main.indexOf("const latestActorTokenObserved = Boolean(");
const latestActorTokenObserved = latestActorTokenObservedIndex >= 0 ? main.slice(latestActorTokenObservedIndex, main.indexOf(");", latestActorTokenObservedIndex) + 2) : "";
for (const phrase of [
  "latestResponse?.connectorRuntime?.tokenMetadata?.actor",
  "latestResponse?.connectorRuntime?.tokenMetadata?.actorRoles?.length",
  "latestResponse?.connectorRuntime?.tokenMetadata?.actorProvider",
  "latestResponse?.connectorRuntime?.tokenMetadata?.actorIssuer",
  "latestResponse?.connectorRuntime?.tokenMetadata?.actorSubject",
  "latestResponse?.connectorRuntime?.authorizationRequirement?.actorProvider",
  "latestResponse?.connectorRuntime?.agentResponse?.authorizationRequirement?.actorProvider",
  "latestResponse?.a2aTasks?.some"
]) {
  requireIncludes(latestActorTokenObserved, phrase, "latestActorTokenObserved includes connector runtime actor metadata before legacy fallback");
}

for (const phrase of [
  "function connectorRouteSummaryLabel",
  'return "Connector route approved";',
  'return "Connector route needs info";',
  'return "Connector route blocked";',
  "function resultSummaryLabel",
  "response.connectorRuntime.agentResponse?.status ?? \"executed\"",
  "response?.connectorPolicy?.effect === \"allow\"",
  "response?.connectorPolicy?.effect === \"block\"",
  "response?.connectorPolicy?.effect === \"needs_approval\"",
  'status === "connector_skill_blocked"',
  'return "blocked";'
]) {
  requireIncludes(securitySummary, phrase, "security summary helpers prefer connector runtime state");
}

for (const phrase of [
  "connectorRouteSummaryLabel(latestResponse)",
  "resultSummaryLabel(latestResponse)",
  "<strong>{tokenOutcome}</strong>",
  "No delegation observed",
  "Raw token hidden"
]) {
  requireIncludes(runTask, phrase, "RunTask security summary uses connector-aware labels");
}

for (const phrase of [
  "connectorRouteSummaryLabel: (response: ResolveResponse | null) => string",
  "resultSummaryLabel: (response: ResolveResponse | null) => string"
]) {
  requireIncludes(types, phrase, "component context exposes connector-aware summary helpers");
}

for (const phrase of [
  "response.connectorRuntime?.tokenMetadata?.actorRoles?.length",
  "response.connectorRuntime?.tokenMetadata?.actorProvider",
  "response.connectorRuntime?.tokenMetadata?.actorIssuer",
  "response.connectorRuntime?.tokenMetadata?.actorSubject"
]) {
  requireIncludes(securityTimeline, phrase, "SecurityTimeline proof summary detects connector runtime actor metadata");
}

const packageJson = JSON.parse(packageJsonText) as { scripts?: Record<string, string> };
if (packageJson.scripts?.["verify:connector-runtime-ui-summary"] !== "tsx scripts/verify-connector-runtime-ui-summary.ts") {
  fail("package.json should include verify:connector-runtime-ui-summary");
} else {
  ok("package.json includes verify:connector-runtime-ui-summary");
}
if (!packageJson.scripts?.["verify:v2-plan"]?.includes("verify:connector-runtime-ui-summary")) {
  fail("verify:v2-plan should include verify:connector-runtime-ui-summary");
} else {
  ok("verify:v2-plan includes verify:connector-runtime-ui-summary");
}
requireIncludes(v2Plan, 'packageJson.scripts?.["verify:connector-runtime-ui-summary"]', "v2 plan verifier checks connector runtime UI summary script");
requireIncludes(v2Plan, "verify:connector-runtime-ui-summary", "v2 plan verifier checks connector runtime UI summary wiring");

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Connector runtime UI summary verification passed.");
}
