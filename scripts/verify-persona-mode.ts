import { readFileSync } from "node:fs";

const main = readFileSync("apps/web-ui/src/main.tsx", "utf8");
const runTask = readFileSync("apps/web-ui/src/components/run-task/RunTaskTab.tsx", "utf8");
const styles = readFileSync("apps/web-ui/src/styles.css", "utf8");

let failed = false;

function expect(source: string, phrase: string, message: string) {
  if (!source.includes(phrase)) {
    console.error(`fail - ${message}: ${phrase}`);
    failed = true;
  }
}

for (const phrase of [
  "Choose your demo view",
  "End user",
  "Ask for help or access in natural language.",
  "BizApps / IT",
  "Configure connectors, validate tests, and review security proof.",
  'personaStorageKey = "secureA2A.persona"',
  "window.localStorage.getItem(personaStorageKey)",
  "window.localStorage.setItem(personaStorageKey, nextPersona)",
  "Change view",
  "selectPersonaMode",
  "changePersonaView"
]) {
  expect(main, phrase, "persona mode shell is missing expected copy or state handling");
}

for (const phrase of [
  "isEndUserMode",
  'setActiveTab("run-task")',
  "loginDemoUser({ silent: true })",
  "end-user-shell",
  "end-user-topbar-actions",
  "System health",
  "Reset demo"
]) {
  expect(main, phrase, "persona mode shell behavior is missing");
}

for (const phrase of [
  "end-user-run-task",
  "!isEndUserMode ? renderCockpitStatusStrip() : null",
  "View technical proof",
  "technical-proof-modal",
  "Technical proof",
  "showEndUserTechnicalProof",
  "Try asking:"
]) {
  expect(runTask, phrase, "Run Task is missing end-user chat-first behavior");
}

for (const phrase of [
  ".persona-modal-backdrop",
  ".persona-modal",
  ".end-user-shell.control-plane-shell",
  ".end-user-run-task .chat-runtime-layout",
  ".end-user-run-task .task-transcript",
  ".end-user-proof-drawer",
  ".technical-proof-modal",
  ".technical-proof-modal .governance-proof-panel"
]) {
  expect(styles, phrase, "persona mode styles are missing");
}

if (!main.includes("{!isEndUserMode ? (") || !main.includes('<aside className="control-sidebar"')) {
  console.error("fail - end-user mode should hide the technical sidebar navigation");
  failed = true;
}

const endUserRenderBranch = main.match(/\{isEndUserMode \? \([\s\S]*?<RunTaskTab ctx=\{screenContext\} \/>[\s\S]*?\) : \(/)?.[0] ?? "";
for (const forbidden of ["AgentRegistryTab", "ConnectorTestCenterTab", "SecurityTimelineTab", "TrustIdentityTab", "DemoGuideTab"]) {
  if (endUserRenderBranch.includes(forbidden)) {
    console.error(`fail - end-user mode should hide technical nav/content: ${forbidden}`);
    failed = true;
  }
}

if (!main.includes("isEndUserMode ? (") || !main.includes('<RunTaskTab ctx={screenContext} />')) {
  console.error("fail - end-user mode should default to the Run Task chat");
  failed = true;
}

const endUserTopbar = main.match(/isEndUserMode \? \([\s\S]*?\) : \(/)?.[0] ?? "";
for (const forbidden of ["Secure A2A JWT", "healthLabel", "Execution unlocked", "7/7"]) {
  if (endUserTopbar.includes(forbidden)) {
    console.error(`fail - end-user topbar should hide technical status: ${forbidden}`);
    failed = true;
  }
}

if (endUserTopbar.includes("New conversation")) {
  console.error("fail - end-user topbar should not include duplicate New conversation");
  failed = true;
}

if (!endUserTopbar.includes("Change view")) {
  console.error("fail - end-user topbar should keep Change view");
  failed = true;
}

const chatPanelHeader = runTask.match(/<div className="chat-panel-header"[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
if (!chatPanelHeader.includes("New conversation")) {
  console.error("fail - chat panel header should keep New conversation");
  failed = true;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Persona mode verification passed.");
}
