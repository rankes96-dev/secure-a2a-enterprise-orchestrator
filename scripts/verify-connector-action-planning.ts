import { existsSync, readFileSync } from "node:fs";

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

function verifyStatic(): void {
  const shared = read("packages/shared/src/index.ts");
  const external = [
    "real-external-agent/src/index.ts",
    "real-external-agent/src/connectors/actionPlanning.ts",
    "real-external-agent/src/connectors/jiraActionPlan.ts"
  ].filter(existsSync).map(read).join("\n");
  const orchestrator = [
    "services/orchestrator-api/src/connectorActionPlanner.ts",
    "services/orchestrator-api/src/connectorActionPlanEvaluation.ts",
    "services/orchestrator-api/src/executionGateStack.ts",
    "services/orchestrator-api/src/index.ts"
  ].filter(existsSync).map(read).join("\n");
  const ui = [
    "apps/web-ui/src/main.tsx",
    "apps/web-ui/src/components/run-task/RunTaskTab.tsx"
  ].map(read).join("\n");

  for (const term of ["ConnectorActionPlan", "ConnectorActionPlanOption", "connectorActionPlan?: ConnectorActionPlan", "evaluatedActionPlan"]) {
    if (!shared.includes(term)) fail(`shared action planning type missing: ${term}`);
  }
  for (const term of ["ConnectorPlanningHandler", "buildConnectorActionPlan", "jiraPlanningHandler", "serviceNowPlanningHandler", "githubPlanningHandler", "plan_only", "connector_plan_only", "jiraActionPlan"]) {
    if (!external.includes(term)) fail(`external agent planning support missing: ${term}`);
  }
  const externalIndex = read("real-external-agent/src/index.ts");
  if (!externalIndex.includes("buildConnectorActionPlan") || externalIndex.includes('profile.connectorId === "jira-reference" && isJiraAccessPlanningRequest')) {
    fail("/a2a/task should use buildConnectorActionPlan instead of direct Jira-specific planning branch");
  }
  const actionPlanning = read("real-external-agent/src/connectors/actionPlanning.ts");
  const registeredHandlers = actionPlanning.match(/const planningHandlers = \[[\s\S]*?\];/)?.[0] ?? "";
  if (registeredHandlers.includes("serviceNowPlanningHandler") || registeredHandlers.includes("githubPlanningHandler")) {
    fail("ServiceNow/GitHub planning handlers should not be actively registered while their profiles advertise planning.supported=false");
  }
  for (const term of ["requestConnectorActionPlan", "evaluateConnectorActionPlan", "sideEffectsAllowed", "validateTrustedConnectorRuntimeEndpoint"]) {
    if (!orchestrator.includes(term)) fail(`orchestrator planning support missing: ${term}`);
  }
  const orchestratorIndex = read("services/orchestrator-api/src/index.ts");
  const targetDetection = orchestratorIndex.match(/function planningConnectorTarget[\s\S]*?function isConnectorPlanningCandidate/)?.[0] ?? "";
  if (targetDetection.includes('resourceSystem === "jira"') || targetDetection.includes("\\bfin\\b")) {
    fail("planningConnectorTarget should not contain hardcoded FIN/Jira target bias");
  }
  if (!orchestrator.includes("connector action plan connectorId did not match") || !orchestrator.includes("connector action plan resourceSystem did not match")) {
    fail("requestConnectorActionPlan should validate returned connectorId/resourceSystem");
  }
  const evaluator = read("services/orchestrator-api/src/connectorActionPlanEvaluation.ts");
  if (!evaluator.includes("onboardedAgent.effectivePermissions") || !evaluator.includes("onboardedAgent.deniedPermissions")) {
    fail("connectorActionPlanEvaluation should use explicit attested effectivePermissions / deniedPermissions fields");
  }
  if (evaluator.includes("approvedActions.flatMap") || evaluator.includes("blockedActions.flatMap")) {
    fail("connectorActionPlanEvaluation should not infer permissions from approvedActions/blockedActions");
  }
  for (const phrase of [
    "Connector Action Plan",
    "PLANNED",
    "side-effect-free action plan",
    "The connector proposes a request-specific action plan",
    "Planning connector:",
    "Plan-only mode returned options"
  ]) {
    if (!ui.includes(phrase)) fail(`UI planning copy missing: ${phrase}`);
  }
  if (!orchestrator.includes("No runtime write/action operation was executed")) {
    fail("Execution Gate Stack should explicitly state plan-only did not execute runtime write/action operations");
  }
  if (ui.includes("Example Jira options")) {
    fail("UI should not contain Jira-specific generic action plan copy: Example Jira options");
  }
  if (ui.includes("Reference connector:")) {
    fail("UI should use generic Planning connector copy, not Reference connector");
  }
  logOk("static connector action planning semantics present");
}

async function verifyApi(): Promise<void> {
  await createSession();
  await demoLogin();
  await resetAndOnboardJira();
  const { response, body } = await request("/resolve", {
    method: "POST",
    body: JSON.stringify({ message: "I need access to FIN project" })
  });
  requireStatus(response, body, 200, "resolve action planning request");
  assertNoSecretMarkers(body, "action planning response");

  const result = asRecord(body, "resolve response");
  const plan = asRecord(result.connectorActionPlan, "connectorActionPlan");
  const evaluated = asRecord(result.evaluatedActionPlan, "evaluatedActionPlan");
  const gateStack = asRecord(result.executionGateStack, "executionGateStack");
  if (gateStack.finalOutcome !== "planned") {
    fail(`expected finalOutcome planned, got ${JSON.stringify(gateStack)}`);
  }
  if (result.connectorRuntime !== undefined) {
    fail(`plan-only flow should not execute connector runtime: ${JSON.stringify(result.connectorRuntime)}`);
  }
  if (plan.mode !== "plan_only" || plan.safeToDisplay !== true || plan.sideEffectsAllowed !== "none") {
    fail(`connectorActionPlan is not safe plan_only: ${JSON.stringify(plan)}`);
  }
  const options = asArray(evaluated.options, "evaluatedActionPlan.options").map((item) => asRecord(item, "evaluated option"));
  const planOptions = asArray(plan.options, "connectorActionPlan.options").map((item) => asRecord(item, "plan option"));
  if (!planOptions.some((item) => item.label === "Inspect Jira project access") || !planOptions.some((item) => item.label === "Grant Jira project access")) {
    fail(`Jira reference plan should include inspect and grant options: ${JSON.stringify(planOptions)}`);
  }
  const inspect = options.find((item) => asRecord(item.option, "inspect option").actionId === "jira.project.access.inspect");
  const grant = options.find((item) => asRecord(item.option, "grant option").actionId === "jira.project.access.grant");
  if (!inspect || inspect.decision !== "allowed") {
    fail(`inspect option should be allowed with default read grants/permissions: ${JSON.stringify(options)}`);
  }
  if (!grant || (grant.decision !== "blocked" && grant.decision !== "needs_approval")) {
    fail(`grant option should be blocked or needs approval: ${JSON.stringify(options)}`);
  }
  const runtimeGate = asArray(gateStack.gates, "executionGateStack.gates").map((item) => asRecord(item, "gate")).find((item) => item.id === "runtime_execution");
  if (!runtimeGate || typeof runtimeGate.reason !== "string" || !runtimeGate.reason.includes("No runtime write/action operation was executed")) {
    fail(`plan-only runtime gate should clearly say no write/action operation executed: ${JSON.stringify(gateStack)}`);
  }

  const ambiguous = await request("/resolve", {
    method: "POST",
    body: JSON.stringify({ message: "I need access to a project" })
  });
  requireStatus(ambiguous.response, ambiguous.body, 200, "resolve ambiguous access planning request");
  assertNoSecretMarkers(ambiguous.body, "ambiguous action planning response");
  const ambiguousResult = asRecord(ambiguous.body, "ambiguous resolve response");
  const ambiguousGateStack = asRecord(ambiguousResult.executionGateStack, "ambiguous executionGateStack");
  if (ambiguousGateStack.finalOutcome !== "planned") {
    fail(`single installed planning connector should safely handle ambiguous project access request without hardcoded FIN/Jira bias: ${JSON.stringify(ambiguousResult)}`);
  }
  if (ambiguousResult.connectorRuntime !== undefined) {
    fail(`ambiguous plan-only flow should not execute connector runtime: ${JSON.stringify(ambiguousResult.connectorRuntime)}`);
  }
  logOk("API returned safe evaluated Jira connector action plan");
}

async function main(): Promise<void> {
  verifyStatic();
  await verifyApi();
  console.log("Connector action planning verification passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
