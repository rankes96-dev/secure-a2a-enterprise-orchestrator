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
    "real-external-agent/src/connectors/jiraActionPlan.ts"
  ].filter(existsSync).map(read).join("\n");
  const orchestrator = [
    "services/orchestrator-api/src/connectorActionPlanner.ts",
    "services/orchestrator-api/src/connectorActionPlanEvaluation.ts",
    "services/orchestrator-api/src/index.ts"
  ].filter(existsSync).map(read).join("\n");
  const ui = [
    "apps/web-ui/src/main.tsx",
    "apps/web-ui/src/components/run-task/RunTaskTab.tsx"
  ].map(read).join("\n");

  for (const term of ["ConnectorActionPlan", "ConnectorActionPlanOption", "connectorActionPlan?: ConnectorActionPlan", "evaluatedActionPlan"]) {
    if (!shared.includes(term)) fail(`shared action planning type missing: ${term}`);
  }
  for (const term of ["plan_only", "connector_plan_only", "jiraActionPlan"]) {
    if (!external.includes(term)) fail(`external agent planning support missing: ${term}`);
  }
  for (const term of ["requestConnectorActionPlan", "evaluateConnectorActionPlan", "sideEffectsAllowed", "validateTrustedConnectorRuntimeEndpoint"]) {
    if (!orchestrator.includes(term)) fail(`orchestrator planning support missing: ${term}`);
  }
  for (const phrase of [
    "Connector Action Plan",
    "PLANNED",
    "side-effect-free action plan",
    "Inspect Jira project access",
    "Grant Jira project access",
    "Gateway does not need to know every Jira permission"
  ]) {
    if (!ui.includes(phrase)) fail(`UI planning copy missing: ${phrase}`);
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
  const inspect = options.find((item) => asRecord(item.option, "inspect option").actionId === "jira.project.access.inspect");
  const grant = options.find((item) => asRecord(item.option, "grant option").actionId === "jira.project.access.grant");
  if (!inspect || inspect.decision !== "allowed") {
    fail(`inspect option should be allowed with default read grants/permissions: ${JSON.stringify(options)}`);
  }
  if (!grant || (grant.decision !== "blocked" && grant.decision !== "needs_approval")) {
    fail(`grant option should be blocked or needs approval: ${JSON.stringify(options)}`);
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
