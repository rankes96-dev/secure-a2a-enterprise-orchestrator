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

const topbarMarkup = mainTsx.match(/<header className="topbar"[\s\S]*?<\/header>/)?.[0] ?? "";
const chatPanelHeader = runTask.match(/<div className="chat-panel-header"[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
if (!topbarMarkup.includes("Reset demo")) {
  console.error("fail - global topbar should render Reset demo");
  failed = true;
}
const endUserTopbarMarkup = mainTsx.match(/isEndUserMode \? \([\s\S]*?\) : \(/)?.[0] ?? "";
if (endUserTopbarMarkup.includes("New conversation")) {
  console.error("fail - end-user topbar should not render duplicate New conversation");
  failed = true;
}
for (const phrase of ["Conversation", "Gateway Runtime Chat", "New conversation"]) {
  if (!chatPanelHeader.includes(phrase)) {
    console.error(`fail - Run Task chat header missing conversation control copy: ${phrase}`);
    failed = true;
  }
}

for (const phrase of [
  "Choose your demo view",
  "End user",
  "BizApps / IT",
  "Change view",
  "Support chat"
]) {
  if (!mainTsx.includes(phrase)) {
    console.error(`fail - persona mode UI copy missing: ${phrase}`);
    failed = true;
  }
}

for (const phrase of [
  "Try asking:",
  "Press Enter to send",
  "Ctrl+Enter for a new line",
  "View technical proof"
]) {
  if (!runTask.includes(phrase)) {
    console.error(`fail - end-user Run Task copy missing: ${phrase}`);
    failed = true;
  }
}

const messageListBlock = mainTsx.match(/function MessageList[\s\S]*?function App/)?.[0] ?? "";
if (!messageListBlock.includes("No messages yet") || !messageListBlock.includes("Ask your question below to start a governed chat")) {
  console.error("fail - transcript empty state should use subtle empty-state copy");
  failed = true;
}

if (messageListBlock.includes("Ask about Jira, ServiceNow, GitHub, or try to request a blocked action")) {
  console.error("fail - transcript empty state should not reuse composer placeholder text");
  failed = true;
}

if (!runTask.includes('placeholder="Ask about Jira, ServiceNow, GitHub, or try to request a blocked action..."')) {
  console.error("fail - composer textarea should keep the support prompt placeholder");
  failed = true;
}

const supportAnswerBuilder = mainTsx.match(/function buildEndUserSupportAnswer[\s\S]*?function governedChatAnswer/)?.[0] ?? "";
const connectorAnswerFormatter = mainTsx.match(/function renderEndUserAnswer[\s\S]*?function buildEndUserSupportAnswer/)?.[0] ?? "";
const runtimeFailureDetector = mainTsx.match(/function connectorRuntimeFailed[\s\S]*?function userFriendlyOutcomeLabel/)?.[0] ?? "";
const runtimeFailureAnswer = mainTsx.match(/function buildRuntimeFailureAnswer[\s\S]*?function buildEndUserSupportAnswer/)?.[0] ?? "";
const connectorUnavailableDetector = mainTsx.match(/function connectorUnavailableForEndUser[\s\S]*?function userFriendlyOutcomeLabel/)?.[0] ?? "";
const connectorUnavailableAnswer = mainTsx.match(/function buildConnectorUnavailableAnswer[\s\S]*?function buildEndUserSupportAnswer/)?.[0] ?? "";
const outOfScopeDetector = mainTsx.match(/function requestIsOutOfEnterpriseScope[\s\S]*?function connectorUnavailableForEndUser/)?.[0] ?? "";
const outOfScopeAnswer = mainTsx.match(/function buildOutOfScopeAnswer[\s\S]*?return \[[\s\S]*?\]\.join\("\\n"\);\n}/)?.[0] ?? "";
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
  "containsForbiddenSecretMarker",
  "connectorEndUserAnswer",
  "connectorRuntimeSucceeded",
  "renderEndUserAnswer",
  "connectorRuntimeFailed",
  "buildRuntimeFailureAnswer",
  "requestIsOutOfEnterpriseScope",
  "buildOutOfScopeAnswer",
  "connectorUnavailableForEndUser",
  "buildConnectorUnavailableAnswer",
  "safeToDisplay !== true",
  "responseExecutedWriteOrAdmin",
  "response.connectorRuntime?.executed === true",
  "response.connectorRuntime.agentResponse !== undefined",
  "unsafeChangeClaims",
  "raw token",
  "user was added",
  "role was changed"
]) {
  if (!mainTsx.includes(phrase)) {
    console.error(`fail - Run Task main chat should validate connector-provided end-user answers: ${phrase}`);
    failed = true;
  }
}

for (const phrase of [
  'response.requestInterpretation?.scope === "out_of_scope"',
  'classificationSupportMode === "out_of_scope"',
  'entry.action === "out_of_scope"',
  "outside enterprise support scope",
  "outside the supported enterprise"
]) {
  if (!outOfScopeDetector.includes(phrase)) {
    console.error(`fail - Run Task should detect unrelated out-of-scope requests before connector unavailable: ${phrase}`);
    failed = true;
  }
}

for (const phrase of [
  "I cant help with that request here",
  "access requests",
  "enterprise system problems",
  "integration failures",
  "security or policy checks"
]) {
  if (!outOfScopeAnswer.includes(phrase)) {
    console.error(`fail - out-of-scope answer missing end-user scope guidance: ${phrase}`);
    failed = true;
  }
}

for (const forbidden of [
  "connector",
  "external agent",
  "Gateway route",
  "runtime",
  "OAuth",
  "service account"
]) {
  if (outOfScopeAnswer.toLowerCase().includes(forbidden.toLowerCase())) {
    console.error(`fail - out-of-scope main chat copy should not expose technical term: ${forbidden}`);
    failed = true;
  }
}

for (const phrase of [
  'response.connectorRouting?.status === "connector_not_onboarded"',
  'response.connectorPlanningTargetResolution?.strategy === "not_supported"',
  'gatewayRouteStatus === "connector_not_onboarded"'
]) {
  if (!connectorUnavailableDetector.includes(phrase)) {
    console.error(`fail - Run Task should detect unavailable supported systems before rendering diagnosis copy: ${phrase}`);
    failed = true;
  }
}

for (const phrase of [
  "I can't help with this system here yet",
  "Open a support ticket",
  "No changes were made"
]) {
  if (!connectorUnavailableAnswer.includes(phrase)) {
    console.error(`fail - connector unavailable answer missing end-user handoff copy: ${phrase}`);
    failed = true;
  }
}

for (const forbidden of [
  "connector not onboarded",
  "external agent",
  "Connector Catalog",
  "Agent Registry",
  "onboarding",
  "runtime",
  "OAuth",
  "service account"
]) {
  if (connectorUnavailableAnswer.toLowerCase().includes(forbidden.toLowerCase())) {
    console.error(`fail - connector unavailable main chat copy should not expose technical term: ${forbidden}`);
    failed = true;
  }
}

for (const phrase of [
  'finalOutcome === "runtime_failed"',
  'gate.id === "runtime_execution" && gate.status === "failed"',
  "response.connectorRuntime !== undefined && response.connectorRuntime.executed === false"
]) {
  if (!runtimeFailureDetector.includes(phrase)) {
    console.error(`fail - Run Task should detect connector runtime failures before rendering diagnosis copy: ${phrase}`);
    failed = true;
  }
}

for (const phrase of [
  "I could not complete the check right now",
  "The connected system agent did not return a result",
  "No changes were made"
]) {
  if (!runtimeFailureAnswer.includes(phrase)) {
    console.error(`fail - runtime failure answer missing user-facing copy: ${phrase}`);
    failed = true;
  }
}

if (mainTsx.indexOf("const safeConnectorAnswer = connectorEndUserAnswer(response)") > mainTsx.indexOf('if (outcome === "PLANNED"')) {
  console.error("fail - main chat should prefer safe connector endUserAnswer before generic outcome fallback");
  failed = true;
}

if (supportAnswerBuilder.indexOf("if (connectorRuntimeFailed(response))") > supportAnswerBuilder.indexOf("const safeConnectorAnswer = connectorEndUserAnswer(response)")) {
  console.error("fail - runtime failure must take priority over connector endUserAnswer");
  failed = true;
}

if (supportAnswerBuilder.indexOf("if (requestIsOutOfEnterpriseScope(response))") > supportAnswerBuilder.indexOf("if (connectorUnavailableForEndUser(response))")) {
  console.error("fail - out-of-scope handling must take priority over connector unavailable handling");
  failed = true;
}

if (supportAnswerBuilder.indexOf("const safeConnectorAnswer = connectorEndUserAnswer(response)") > supportAnswerBuilder.indexOf("if (requestIsOutOfEnterpriseScope(response))")) {
  console.error("fail - successful connector endUserAnswer must take priority over out-of-scope fallback");
  failed = true;
}

if (supportAnswerBuilder.indexOf("if (connectorRuntimeFailed(response))") > supportAnswerBuilder.indexOf('if (outcome === "DIAGNOSED"')) {
  console.error("fail - runtime failure must take priority over generic diagnostic fallback");
  failed = true;
}

if (supportAnswerBuilder.indexOf("if (connectorUnavailableForEndUser(response))") > supportAnswerBuilder.indexOf('if (outcome === "DIAGNOSED"')) {
  console.error("fail - connector unavailable handling must take priority over generic diagnostic fallback");
  failed = true;
}

if (!outOfScopeDetector.includes("connectorRuntimeSucceeded(response)")) {
  console.error("fail - out-of-scope detection must not override successful connector runtime answers");
  failed = true;
}

if (mainTsx.includes('"changes were made"')) {
  console.error('fail - unsafe change claim checks must not reject the safe phrase "No changes were made."');
  failed = true;
}

if (!connectorAnswerFormatter.includes("userFriendlyOutcomeLabel(outcome)")) {
  console.error("fail - connector end-user answer renderer should map technical blocked labels to BLOCKED");
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
