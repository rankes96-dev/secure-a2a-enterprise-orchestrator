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
  for (const phrase of [
    "Which system do you need access to?",
    "Search supported systems...",
    "Other / not listed",
    "Search for a supported system or choose Other / not listed."
  ]) {
    if (!ui.includes(phrase) && !main.includes(phrase)) {
      fail(`safe target selection UI copy missing: ${phrase}`);
    }
  }
  if (ui.includes("installed_planning_ready") || ui.includes("planningSupported") || ui.includes("templateAvailable")) {
    fail("main chat safe target picker should not render connector planning/template status");
  }
  if (ui.includes("option.connectorId") || ui.includes("connectorId}</strong>")) {
    fail("main chat safe target picker should not render connectorId as the primary label");
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
  for (const label of ["Jira", "ServiceNow", "GitHub", "Other / not listed"]) {
    if (!labels.includes(label)) {
      fail(`safe target selection missing ${label}: ${JSON.stringify(options)}`);
    }
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
  if (typeof ambiguous.finalAnswer !== "string" || !ambiguous.finalAnswer.includes("Search for a supported system")) {
    fail(`ambiguous response should ask user to search/select supported system: ${JSON.stringify(ambiguous.finalAnswer)}`);
  }
  const conversationId = typeof ambiguous.conversationId === "string" ? ambiguous.conversationId : undefined;
  if (!conversationId) fail("ambiguous response did not return conversationId");
  logOk("ambiguous request returned simple safe target selection");

  const jiraFollowUp = await resolve("Jira project FIN", conversationId);
  const jiraGateStack = asRecord(jiraFollowUp.executionGateStack, "Jira follow-up executionGateStack");
  if (!jiraFollowUp.connectorActionPlan || !jiraFollowUp.evaluatedActionPlan || jiraGateStack.finalOutcome !== "planned") {
    fail(`Jira follow-up should return PLANNED action plan: ${JSON.stringify(jiraFollowUp)}`);
  }
  if (jiraFollowUp.connectorRuntime !== undefined) {
    fail(`Jira planning follow-up should not execute write runtime: ${JSON.stringify(jiraFollowUp.connectorRuntime)}`);
  }
  logOk("supported system follow-up returned safe plan");

  const otherStart = await resolve("I need access to the system");
  const otherConversationId = typeof otherStart.conversationId === "string" ? otherStart.conversationId : undefined;
  if (!otherConversationId) fail("Other setup response did not return conversationId");
  const other = await resolve("Other / not listed", otherConversationId);
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
