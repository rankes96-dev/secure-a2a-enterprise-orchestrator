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

const plannedAnswerBuilder = mainTsx.match(/function buildEndUserPlannedAnswer[\s\S]*?function governedChatAnswer/)?.[0] ?? "";
for (const phrase of [
  "I checked this request safely",
  "No changes were made",
  "approved access request"
]) {
  if (!plannedAnswerBuilder.includes(phrase)) {
    console.error(`fail - planned main chat copy missing end-user phrase: ${phrase}`);
    failed = true;
  }
}

for (const forbidden of [
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
  if (plannedAnswerBuilder.includes(forbidden)) {
    console.error(`fail - planned main chat copy should not expose technical term: ${forbidden}`);
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("UI copy verification passed.");
}
