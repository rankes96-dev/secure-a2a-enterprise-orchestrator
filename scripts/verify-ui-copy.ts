import { readFileSync } from "node:fs";

const webUi = readFileSync("apps/web-ui/src/main.tsx", "utf8");

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
  ">Capability<",
  "Raw tokens hidden"
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
  "Installed Connector Agents"
];

for (const phrase of visibleCopyHints) {
  if (!webUi.includes(phrase)) {
    console.error(`fail - expected simplified UI copy is missing: ${phrase}`);
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("UI copy verification passed.");
}
