import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function readTsxTree(path: string): string {
  return readdirSync(path, { withFileTypes: true }).map((entry) => {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) {
      return readTsxTree(fullPath);
    }
    return entry.isFile() && entry.name.endsWith(".tsx") ? readFileSync(fullPath, "utf8") : "";
  }).join("\n");
}

const webUi = [
  readFileSync("apps/web-ui/src/main.tsx", "utf8"),
  readTsxTree("apps/web-ui/src/components")
].join("\n");
const mainTsx = readFileSync("apps/web-ui/src/main.tsx", "utf8");
const runTask = readFileSync("apps/web-ui/src/components/run-task/RunTaskTab.tsx", "utf8");
const shared = readFileSync("packages/shared/src/index.ts", "utf8");
const connectorRuntime = readFileSync("services/orchestrator-api/src/connectorRuntime.ts", "utf8");

let failed = false;

const startHereCount = (webUi.match(/Start here/g) ?? []).length;
if (startHereCount > 1) {
  console.error(`fail - "Start here" should appear at most once in the product UI, found ${startHereCount}`);
  failed = true;
}

for (const forbidden of [
  '<span className="source-badge">installed connector</span>',
  'label: "Capability"',
  "based on capability metadata",
  "Runtime remains metadata-only",
  ">metadata-only<",
  ">Capability<"
]) {
  if (webUi.includes(forbidden)) {
    console.error(`fail - avoid stale or technical visible UI copy: ${forbidden}`);
    failed = true;
  }
}

const visibleCopyHints = [
  "Templates are not trusted until an external agent completes onboarding",
  "Next Action",
  "Use prompt",
  "Ask for access",
  "Recommended: Run an approved diagnostic first.",
  "No governed connector systems are available right now.",
  "Choose a connector template",
  "Installed Connector Agents",
  "Raw tokens hidden",
  "Governed Runtime Chat",
  "AI interprets, but Gateway approves execution",
  "Prompt injection cannot grant scopes, permissions, or Gateway approval",
  "Execution Gate Stack",
  "Gateway Governance",
  "OAuth Scope Gate",
  "Service Account Permission Gate",
  "Runtime Execution",
  "Adversarial prompts",
  "Return the raw runtime token",
  "Bypass Gateway policy",
  "NOT EVALUATED"
];

for (const phrase of visibleCopyHints) {
  if (!webUi.includes(phrase)) {
    console.error(`fail - expected simplified UI copy is missing: ${phrase}`);
    failed = true;
  }
}

if (runTask.includes("Use recommended prompt")) {
  console.error("fail - recommendation button should use concise visible copy: Use prompt");
  failed = true;
}

const supportAnswerBuilder = mainTsx.match(/function buildEndUserSupportAnswer[\s\S]*?function governedChatAnswer/)?.[0] ?? "";
const connectorAnswerFormatter = mainTsx.match(/function formatConnectorEndUserAnswer[\s\S]*?function buildEndUserSupportAnswer/)?.[0] ?? "";
for (const phrase of [
  "I checked this safely",
  "No changes were made",
  "What I found",
  "Next step",
  "I checked this request safely",
  "Open an approved access request"
]) {
  if (!supportAnswerBuilder.includes(phrase)) {
    console.error(`fail - main chat support copy missing end-user phrase: ${phrase}`);
    failed = true;
  }
}

for (const phrase of [
  "export type EndUserAnswer",
  "safeToDisplay: true",
  "endUserAnswer?: EndUserAnswer"
]) {
  if (!shared.includes(phrase)) {
    console.error(`fail - shared runtime response type missing connector end-user answer support: ${phrase}`);
    failed = true;
  }
}

for (const phrase of [
  "normalizeEndUserAnswer",
  "endUserAnswer: normalizeEndUserAnswer(record.endUserAnswer)"
]) {
  if (!connectorRuntime.includes(phrase)) {
    console.error(`fail - connector runtime normalization should preserve safe endUserAnswer shape: ${phrase}`);
    failed = true;
  }
}

for (const phrase of [
  "isSafeEndUserAnswer",
  "connectorEndUserAnswer",
  "formatConnectorEndUserAnswer",
  "safeToDisplay !== true",
  "responseExecutedWriteOrAdmin",
  "unsafeChangeClaims"
]) {
  if (!mainTsx.includes(phrase)) {
    console.error(`fail - Run Task main chat should validate connector-provided end-user answers: ${phrase}`);
    failed = true;
  }
}

if (mainTsx.indexOf("const safeConnectorAnswer = connectorEndUserAnswer(response)") > mainTsx.indexOf('if (outcome === "PLANNED"')) {
  console.error("fail - main chat should prefer safe connector endUserAnswer before generic outcome fallback");
  failed = true;
}

for (const connectorName of ["Jira", "ServiceNow", "GitHub", "SAP", "Workday"]) {
  if (`${supportAnswerBuilder}\n${connectorAnswerFormatter}`.includes(connectorName)) {
    console.error(`fail - Gateway end-user formatter should not hardcode connector-specific copy: ${connectorName}`);
    failed = true;
  }
}

for (const forbidden of [
  "diagnostic skill",
  "target write/action operation",
  "execution gate",
  "side-effect-free action plan",
  "Gateway evaluated the proposed options",
  "Connector Action Plan",
  "required grants",
  "required permissions",
  "OAuth",
  "service account",
  "execution type",
  "risk level",
  "Do you want to inspect",
  "request/grant access"
]) {
  if (supportAnswerBuilder.includes(forbidden)) {
    console.error(`fail - main chat support copy should not expose technical term: ${forbidden}`);
    failed = true;
  }
}

for (const forbidden of ["access_token", "refresh_token", "client_secret", "private_key", "raw jwt"]) {
  if (`${supportAnswerBuilder}\n${connectorAnswerFormatter}`.toLowerCase().includes(forbidden)) {
    console.error(`fail - main chat rendered answer copy should not expose secret marker: ${forbidden}`);
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("UI copy verification passed.");
}
