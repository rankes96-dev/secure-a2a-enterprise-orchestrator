import { readFileSync } from "node:fs";

let failed = false;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function fail(message: string): void {
  console.error(`fail - ${message}`);
  failed = true;
}

const runtimeFiles = [
  "real-external-agent/src/runtime.ts",
  "real-external-agent/src/connectors/jiraRuntimeDiagnosis.ts",
  "real-external-agent/src/connectors/servicenowRuntimeDiagnosis.ts",
  "real-external-agent/src/connectors/githubRuntimeDiagnosis.ts"
];
const runtimeText = runtimeFiles.map(read).join("\n");
const sharedText = read("packages/shared/src/index.ts");
const runTaskText = read("apps/web-ui/src/components/run-task/RunTaskTab.tsx");
const profileText = [
  "real-external-agent/src/connectors/jiraReferenceConnector.ts",
  "real-external-agent/src/connectors/servicenowReferenceConnector.ts",
  "real-external-agent/src/connectors/githubReferenceConnector.ts"
].map(read).join("\n");

for (const forbidden of [
  "connector is approved for diagnosis, but",
  "issue creation access is not fully enabled"
]) {
  if (runtimeText.toLowerCase().includes(forbidden)) {
    fail(`runtime diagnosis builders should not contain misleading diagnostic wording: ${forbidden}`);
  }
}

for (const term of [
  "diagnostic_read_only",
  "writeActionAttempted",
  "targetActionStatus",
  "targetActionId",
  "EndUserAnswer",
  "endUserAnswer"
]) {
  if (!`${sharedText}\n${runtimeText}`.includes(term)) {
    fail(`runtime semantics term is missing: ${term}`);
  }
}

for (const phrase of [
  "I found an access or permission issue",
  "I found an assignment workflow issue",
  "I found a catalog request workflow issue",
  "I found a GitHub API capacity issue",
  "I found a pull request access issue",
  "No changes were made.",
  "safeToDisplay: true"
]) {
  if (!runtimeText.includes(phrase)) {
    fail(`reference connector runtime end-user answer is missing: ${phrase}`);
  }
}

for (const term of [
  "diagnosesActionId",
  "diagnosesActionLabel",
  "executionType"
]) {
  if (!profileText.includes(term)) {
    fail(`connector profile diagnosis metadata is missing: ${term}`);
  }
}

for (const phrase of [
  "DIAGNOSED",
  "Read-only diagnostic runtime executed",
  "No target write/action operation was attempted",
  "Diagnostic skill approved",
  "Target action blocked"
]) {
  if (!runTaskText.includes(phrase)) {
    fail(`Run Task UI diagnostic semantics copy is missing: ${phrase}`);
  }
}

const helperMatch = runTaskText.match(/function\s+gatewayOutcomeLabel[\s\S]*?\n}\n/);
if (!helperMatch) {
  fail("Run Task UI should define gatewayOutcomeLabel(response)");
} else {
  const helper = helperMatch[0];
  if (!helper.includes('agentStatus === "diagnosed"') || !helper.includes('id.includes(".diagnose")') || !helper.includes('return "DIAGNOSED"')) {
    fail("gatewayOutcomeLabel should classify diagnostic runtime responses as DIAGNOSED");
  }
  if (helper.includes('return "RESOLVED"')) {
    fail("gatewayOutcomeLabel must not return RESOLVED for diagnostic runtime responses");
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Diagnostic runtime semantics verification passed.");
}
