import { readFileSync } from "node:fs";

const API_URL = process.env.ORCHESTRATOR_API_URL ?? "http://127.0.0.1:4000";
const EXTERNAL_AGENT_URL = process.env.EXTERNAL_AGENT_URL ?? "http://localhost:4201";

let sessionCookie = "";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function fail(message: string): never {
  throw new Error(message);
}

function logOk(message: string): void {
  console.info(`ok - ${message}`);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) as unknown : {};
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`Expected ${label} object, got ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(`Expected ${label} array, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireStatus(response: Response, body: unknown, status: number, label: string): void {
  if (response.status !== status) {
    fail(`${label} expected HTTP ${status}, got ${response.status}: ${JSON.stringify(body)}`);
  }
}

function assertNoSecretMarkers(value: unknown, label: string): void {
  const text = JSON.stringify(value);
  const forbidden = [/Bearer\s+/i, /"authorization"\s*:/i, /Authorization:\s*/i, /"access_token"\s*:/i, /"refresh_token"\s*:/i, /client_secret/i, /private_key/i, /raw jwt/i];
  const found = forbidden.find((marker) => marker.test(text));
  if (found) {
    fail(`${label} exposed forbidden marker ${found}`);
  }
}

async function request(path: string, init: RequestInit = {}): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
      ...init.headers
    }
  });
  return { response, body: await readJson(response) };
}

async function externalPost(path: string, body: unknown = {}): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(`${EXTERNAL_AGENT_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { response, body: await readJson(response) };
}

async function createSession(): Promise<void> {
  const response = await fetch(`${API_URL}/session`, { method: "POST" });
  const body = await readJson(response);
  requireStatus(response, body, 200, "create session");
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) fail("create session did not return a cookie");
  sessionCookie = setCookie.split(";")[0] ?? "";
  logOk("created browser session");
}

async function demoLogin(): Promise<void> {
  const { response, body } = await request("/identity/demo-login", {
    method: "POST",
    body: JSON.stringify({ email: "ran@company.com" })
  });
  requireStatus(response, body, 200, "demo login");
  logOk("logged in as ran@company.com");
}

async function resetAndOnboardJira(): Promise<void> {
  let result = await externalPost("/admin/reset-demo");
  requireStatus(result.response, result.body, 200, "reset external agent demo config");
  result = await request("/agent-onboarding/start", {
    method: "POST",
    body: JSON.stringify({
      agentBaseUrl: EXTERNAL_AGENT_URL,
      expectedAgentId: "external-jira-agent",
      expectedResourceSystem: "jira",
      expectedConnectorId: "jira-reference"
    })
  });
  requireStatus(result.response, result.body, 200, "onboard Jira connector");
  logOk("onboarded Jira reference connector");
}

async function resolve(message: string, conversationId?: string): Promise<Record<string, unknown>> {
  const { response, body } = await request("/resolve", {
    method: "POST",
    body: JSON.stringify({ message, conversationId })
  });
  requireStatus(response, body, 200, `resolve ${message}`);
  assertNoSecretMarkers(body, `resolve ${message}`);
  return asRecord(body, `resolve response for ${message}`);
}

function verifyStatic(): void {
  const ui = read("apps/web-ui/src/components/run-task/RunTaskTab.tsx");
  const main = read("apps/web-ui/src/main.tsx");
  const orchestrator = read("services/orchestrator-api/src/index.ts");
  for (const phrase of [
    "Which system do you need access to?",
    "Search installed systems...",
    "Other / not listed",
    "Use ${option.label} for the previous access request",
    "Other / not listed for the previous access request",
    "chat-safe-target-selection",
    "Search installed systems or choose Other / not listed."
  ]) {
    if (!ui.includes(phrase) && !main.includes(phrase)) {
      fail(`safe target selection UI copy missing: ${phrase}`);
    }
  }
  if (ui.includes("Search supported systems...") || main.includes("Search for a supported system")) {
    fail("Run Task safe target picker should say installed systems, not supported systems");
  }
  if (ui.includes("Go to Agent Registry") || main.includes("Go to Agent Registry") || ui.includes("install connector agent") || main.includes("install connector agent")) {
    fail("Run Task end-user flow should not tell users to install connectors or go to Agent Registry");
  }
  if (ui.includes("installed_planning_ready") || ui.includes("planningSupported") || ui.includes("templateAvailable")) {
    fail("main chat safe target picker should not render connector planning/template status");
  }
  if (ui.includes("option.connectorId") || ui.includes("connectorId}</strong>")) {
    fail("main chat safe target picker should not render connectorId as the primary label");
  }
  if (!ui.includes('useEffect(() =>') || !ui.includes('setTargetSearch("")')) {
    fail("safe target search should reset when a new safe target selection response arrives");
  }
  if (!ui.includes("<MessageList") || !ui.includes("messages={messages}") || !ui.includes('renderSafeTargetSelection("chat")')) {
    fail("safe target picker should be rendered in the chat panel, not only in the Gateway response side panel");
  }
  if (!orchestrator.includes("function buildSafeTargetSelection(intentClasses: string[], installedAgents") || !orchestrator.includes("installedAgents\n    .map")) {
    fail("safe target selection options should be built from installed agents, not connector templates");
  }
  logOk("static safe target selection UI checks passed");
}

async function main(): Promise<void> {
  verifyStatic();
  await createSession();
  await demoLogin();
  await resetAndOnboardJira();

  const ambiguous = await resolve("I need access to the system");
  const selection = asRecord(ambiguous.safeTargetSelection, "safeTargetSelection");
  const options = asArray(selection.options, "safeTargetSelection.options").map((item) => asRecord(item, "safe target option"));
  const labels = options.map((option) => option.label);
  for (const label of ["Jira", "Other / not listed"]) {
    if (!labels.includes(label)) {
      fail(`safe target selection missing ${label}: ${JSON.stringify(options)}`);
    }
  }
  if (labels.includes("ServiceNow") || labels.includes("GitHub")) {
    fail(`safe target selection should only show installed systems plus Other; got ${JSON.stringify(labels)}`);
  }
  if (selection.searchPlaceholder !== "Search installed systems...") {
    fail(`safe target selection should use installed-systems placeholder: ${JSON.stringify(selection)}`);
  }
  for (const option of options) {
    for (const forbidden of ["connectorId", "installed", "planningSupported", "status", "templateAvailable"]) {
      if (Object.prototype.hasOwnProperty.call(option, forbidden)) {
        fail(`user-facing safe target option exposed ${forbidden}: ${JSON.stringify(option)}`);
      }
    }
  }
  if (ambiguous.connectorActionPlan !== undefined || ambiguous.connectorRuntime !== undefined) {
    fail(`ambiguous safe target selection should not plan or execute runtime: ${JSON.stringify(ambiguous)}`);
  }
  if (typeof ambiguous.finalAnswer !== "string" || !ambiguous.finalAnswer.includes("Search installed systems")) {
    fail(`ambiguous response should ask user to search/select installed system: ${JSON.stringify(ambiguous.finalAnswer)}`);
  }
  if (ambiguous.finalAnswer.includes("Agent Registry") || ambiguous.finalAnswer.includes("install connector")) {
    fail(`ambiguous end-user response should not include connector installation guidance: ${JSON.stringify(ambiguous.finalAnswer)}`);
  }
  const conversationId = typeof ambiguous.conversationId === "string" ? ambiguous.conversationId : undefined;
  if (!conversationId) fail("ambiguous response did not return conversationId");
  logOk("ambiguous request returned simple safe target selection");

  const jiraFollowUp = await resolve("Use Jira for the previous access request", conversationId);
  const jiraGateStack = asRecord(jiraFollowUp.executionGateStack, "Jira follow-up executionGateStack");
  if (!jiraFollowUp.connectorActionPlan || !jiraFollowUp.evaluatedActionPlan || jiraGateStack.finalOutcome !== "planned") {
    fail(`explicit UI Jira follow-up should return PLANNED action plan: ${JSON.stringify(jiraFollowUp)}`);
  }
  if (jiraFollowUp.connectorRuntime !== undefined) {
    fail(`Jira planning follow-up should not execute write runtime: ${JSON.stringify(jiraFollowUp.connectorRuntime)}`);
  }
  logOk("explicit supported system follow-up returned safe plan");

  const serviceNowStart = await resolve("I need access to the system");
  const serviceNowConversationId = typeof serviceNowStart.conversationId === "string" ? serviceNowStart.conversationId : undefined;
  if (!serviceNowConversationId) fail("ServiceNow setup response did not return conversationId");
  const serviceNow = await resolve("Use ServiceNow for the previous access request", serviceNowConversationId);
  if (serviceNow.connectorActionPlan !== undefined || serviceNow.evaluatedActionPlan !== undefined || serviceNow.connectorRuntime !== undefined) {
    fail(`uninstalled ServiceNow follow-up should not plan or execute runtime: ${JSON.stringify(serviceNow)}`);
  }
  if (typeof serviceNow.finalAnswer !== "string" || !serviceNow.finalAnswer.includes("ServiceNow is not available here yet")) {
    fail(`uninstalled ServiceNow follow-up should use end-user availability copy: ${JSON.stringify(serviceNow.finalAnswer)}`);
  }
  if (serviceNow.finalAnswer.includes("Agent Registry") || serviceNow.finalAnswer.includes("install connector") || serviceNow.finalAnswer.includes("connector")) {
    fail(`uninstalled ServiceNow end-user response should not include install guidance: ${JSON.stringify(serviceNow.finalAnswer)}`);
  }
  logOk("uninstalled system follow-up returned support handoff");

  const noContext = await resolve("Use Jira for the previous access request");
  const noContextGateStack = asRecord(noContext.executionGateStack, "no-context executionGateStack");
  if (noContext.resolutionStatus !== "needs_more_info" || noContextGateStack.finalOutcome !== "needs_more_info") {
    fail(`explicit target selection without pending context should ask for original access request: ${JSON.stringify(noContext)}`);
  }
  if (noContext.connectorActionPlan !== undefined || noContext.connectorRuntime !== undefined) {
    fail(`explicit target selection without pending context should not plan or execute runtime: ${JSON.stringify(noContext)}`);
  }
  logOk("explicit target selection without context did not execute planning");

  const otherStart = await resolve("I need access to the system");
  const otherConversationId = typeof otherStart.conversationId === "string" ? otherStart.conversationId : undefined;
  if (!otherConversationId) fail("Other setup response did not return conversationId");
  const other = await resolve("Other / not listed for the previous access request", otherConversationId);
  const otherGateStack = asRecord(other.executionGateStack, "Other executionGateStack");
  if (other.resolutionStatus !== "unsupported" || otherGateStack.finalOutcome !== "unsupported") {
    fail(`Other / not listed should return unsupported handoff: ${JSON.stringify(other)}`);
  }
  if (other.connectorActionPlan !== undefined || other.evaluatedActionPlan !== undefined || other.connectorRuntime !== undefined) {
    fail(`Other / not listed should not plan or execute runtime: ${JSON.stringify(other)}`);
  }
  if (typeof other.finalAnswer !== "string" || !other.finalAnswer.includes("Open a support ticket")) {
    fail(`Other / not listed should suggest support ticket handoff: ${JSON.stringify(other.finalAnswer)}`);
  }
  logOk("Other / not listed returned support ticket handoff");

  console.log("Safe target selection verification passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
