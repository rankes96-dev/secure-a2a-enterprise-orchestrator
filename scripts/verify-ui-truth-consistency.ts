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

function requireNotIncludes(source: string, phrase: string, context: string): void {
  if (source.includes(phrase)) {
    fail(`${context} should not include stale phrase: ${phrase}`);
    return;
  }
  ok(context);
}

const securitySummary = read("apps/web-ui/src/securitySummary.ts");
const securityTimeline = read("apps/web-ui/src/components/security-timeline/SecurityTimelineTab.tsx");
const runTaskSummaryCards = read("apps/web-ui/src/components/RunTaskSummaryCards.tsx");
const runTask = read("apps/web-ui/src/components/run-task/RunTaskTab.tsx");
const main = read("apps/web-ui/src/main.tsx");
const packageJsonText = read("package.json");
const v2PlanVerifier = read("scripts/verify-v2-plan.ts");

for (const phrase of [
  'response?.connectorPolicy?.effect === "allow"',
  'response?.connectorPolicy?.effect === "block"',
  'response?.connectorPolicy?.effect === "needs_approval"',
  'return "Connector policy evaluated";',
  "const decisions = securityDecisions(response);"
]) {
  requireIncludes(securitySummary, phrase, "security summary reports connector policy before policy-not-evaluated fallback");
}

for (const phrase of [
  "const tokenMetadata = runtime.tokenMetadata;",
  "tokenMetadata?.tokenIssued === true",
  'return "runtime token issued";',
  "if (tokenMetadata) {",
  'return "raw token hidden";',
  'return "runtime token not issued";',
  "const tasks = response?.a2aTasks ?? [];"
]) {
  requireIncludes(securitySummary, phrase, "security summary token proof does not contradict connector runtime metadata");
}

for (const phrase of [
  "planningResumed(response)",
  "Connector planning resumed",
  "Pending interaction resumed",
  "External runtime called",
  "Tool mapping",
  "Tool mapping deterministic",
  "Tool mapping AI inferred",
  "Legacy/internal A2A tasks",
  "A2A task created",
  "Scoped A2A JWT issued"
]) {
  requireIncludes(securitySummary, phrase, "security timeline events distinguish mapping, runtime, and legacy A2A proof");
}

for (const phrase of [
  "connectorRuntimeExecutionTruthLabel",
  "connectorRuntimeModeTruthLabel",
  "tokenProofTruthLabel",
  "policyProofTruthLabel",
  "selectedWorkloadTruthLabel",
  "planningResumed(response)",
  "Connector planning resumed; runtime not executed",
  "No runtime token issued for planning",
  "Planning governance evaluated",
  "connector planning state active / connector runtime not executed / 0 A2A tasks",
  "Connector runtime executed",
  "Connector runtime not executed",
  "A2A task response received",
  "Connector runtime token issued",
  "Connector runtime token not issued",
  "Legacy A2A task token issued",
  "Connector policy",
  "A2A policy",
  "securityDecisionSeverity",
  "highestSeveritySecurityDecision(decisions)"
]) {
  requireIncludes(runTaskSummaryCards, phrase, "RunTask summary helpers encode product truth labels");
}
requireNotIncludes(runTaskSummaryCards, "decisions[0].decision", "RunTask policy proof helper does not trust security decision array order");

for (const phrase of [
  "connectorRuntimeExecutionTruthLabel(response)",
  "policyProofTruthLabel(response)",
  "tokenProofTruthLabel(response)",
  "selectedWorkloadTruthLabel(response)",
  'label: "Policy proof"',
  'label: "Token proof"',
  'label: "Connector runtime execution"',
  'label: "Route / task activity"',
  'label: "Raw tokens exposed", value: "No"'
]) {
  requireIncludes(securityTimeline, phrase, "Security Timeline proof summary uses truth helpers");
}
requireNotIncludes(securityTimeline, 'label: "Token issued"', "Security Timeline avoids ambiguous token-issued label");
requireNotIncludes(securityTimeline, 'label: "Runtime executed"', "Security Timeline avoids ambiguous runtime-executed label");

for (const phrase of [
  "Connector runtime executed with scoped A2A JWT",
  "connectorRuntimeModeTruthLabel(latestResponse)",
  "tokenProofTruthLabel(latestResponse)",
  "policyProofTruthLabel(latestResponse)",
  "selectedWorkloadTruthLabel(latestResponse)",
  "Legacy/internal A2A Tasks",
  "legacy A2A token",
  "No legacy/internal A2A task created"
]) {
  requireIncludes(runTask, phrase, "RunTask cards distinguish connector runtime and legacy A2A task proof");
}
requireNotIncludes(runTask, "Runtime executed with scoped A2A JWT", "RunTask avoids generic runtime execution claim");
requireNotIncludes(runTask, "No policy decision recorded.", "RunTask does not claim no policy when connectorPolicy proof may exist");

for (const phrase of [
  "function safeRawExecutionData(response: ResolveResponse)",
  "executionGateStack: response.executionGateStack",
  "pendingInteraction: response.pendingInteraction",
  "pendingInteractionResolution: response.pendingInteractionResolution",
  "planningFollowUpResolution: response.planningFollowUpResolution",
  "connectorActionPlan: response.connectorActionPlan",
  "evaluatedActionPlan: response.evaluatedActionPlan",
  "connectorRouting: response.connectorRouting",
  "connectorRuntime: response.connectorRuntime",
  "a2aTasks: response.a2aTasks?.map",
  "a2aResponses: response.a2aResponses?.map"
]) {
  requireIncludes(main, phrase, "raw execution proof keeps backend proof fields visible and sanitized");
}

const packageJson = JSON.parse(packageJsonText) as { scripts?: Record<string, string> };
if (packageJson.scripts?.["verify:ui-truth-consistency"] !== "tsx scripts/verify-ui-truth-consistency.ts") {
  fail("package.json should include verify:ui-truth-consistency");
} else {
  ok("package.json includes verify:ui-truth-consistency");
}
if (!packageJson.scripts?.["verify:v2-plan"]?.includes("verify:pending-interaction-resolver && npm run verify:planning-follow-up && npm run verify:ui-truth-consistency")) {
  fail("verify:v2-plan should run pending interaction, planning follow-up, and UI truth consistency checks together");
} else {
  ok("verify:v2-plan runs governed planning and UI truth consistency checks together");
}
requireIncludes(v2PlanVerifier, "verify:ui-truth-consistency", "v2 plan verifier checks UI truth consistency wiring");

if (failed) {
  process.exitCode = 1;
} else {
  console.log("UI truth consistency verification passed.");
}
