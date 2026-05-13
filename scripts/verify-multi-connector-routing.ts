const API_URL = process.env.ORCHESTRATOR_API_URL ?? "http://127.0.0.1:4000";

type ConnectorFixture = {
  label: string;
  baseUrl: string;
  agentId: string;
  resourceSystem: string;
  connectorId: string;
  approvedMessage: string;
  approvedSkillId: string;
  expectedSummary: string;
};

const connectors: ConnectorFixture[] = [
  {
    label: "Jira",
    baseUrl: "http://localhost:4201",
    agentId: "external-jira-agent",
    resourceSystem: "jira",
    connectorId: "jira-reference",
    approvedMessage: "Jira issue creation fails with 403 when creating issues in FIN project",
    approvedSkillId: "jira.issue.diagnose_creation_failure",
    expectedSummary: "Jira issue creation failure diagnosis completed"
  },
  {
    label: "ServiceNow",
    baseUrl: "http://localhost:4202",
    agentId: "external-servicenow-agent",
    resourceSystem: "servicenow",
    connectorId: "servicenow-reference",
    approvedMessage: "ServiceNow incident assignment keeps failing for network tickets",
    approvedSkillId: "servicenow.incident.assignment.diagnose",
    expectedSummary: "ServiceNow incident assignment diagnosis completed"
  },
  {
    label: "GitHub",
    baseUrl: "http://localhost:4203",
    agentId: "external-github-agent",
    resourceSystem: "github",
    connectorId: "github-reference",
    approvedMessage: "GitHub repository sync is failing after API rate limit",
    approvedSkillId: "github.repository.rate_limit.diagnose",
    expectedSummary: "GitHub repository rate-limit diagnosis completed"
  }
];

let sessionCookie = "";

function logOk(message: string): void {
  console.info(`ok - ${message}`);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) as unknown : {};
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected object response, got ${JSON.stringify(value)}`);
  }

  return value as Record<string, unknown>;
}

function requireStatus(response: Response, body: unknown, status: number, label: string): void {
  if (response.status !== status) {
    throw new Error(`${label} expected HTTP ${status}, got ${response.status}: ${JSON.stringify(body)}`);
  }
}

function assertNoSecretMarkers(value: unknown): void {
  const text = JSON.stringify(value);
  const forbidden = [
    /access_token/i,
    /Authorization/,
    /Bearer/,
    /client_secret/i,
    /"private_key"\s*:/i,
    /client_assertion/i,
    /refresh_token/i
  ];
  const found = forbidden.find((marker) => marker.test(text));
  if (found) {
    throw new Error(`response exposed forbidden marker ${found}`);
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

async function externalRequest(baseUrl: string, path: string, init: RequestInit = {}): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers
    }
  });

  return { response, body: await readJson(response) };
}

async function createSession(): Promise<void> {
  const response = await fetch(`${API_URL}/session`, { method: "POST" });
  const body = await readJson(response);
  requireStatus(response, body, 200, "create session");
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("create session did not return a session cookie");
  }
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

async function resetConnector(connector: ConnectorFixture): Promise<void> {
  const { response, body } = await externalRequest(connector.baseUrl, "/admin/reset-demo", {
    method: "POST",
    body: JSON.stringify({})
  });
  requireStatus(response, body, 200, `reset ${connector.label} connector`);
  assertNoSecretMarkers(body);
  logOk(`reset ${connector.label} connector`);
}

async function onboardConnector(connector: ConnectorFixture): Promise<void> {
  const { response, body } = await request("/agent-onboarding/start", {
    method: "POST",
    body: JSON.stringify({
      agentBaseUrl: connector.baseUrl,
      expectedAgentId: connector.agentId,
      expectedResourceSystem: connector.resourceSystem,
      expectedConnectorId: connector.connectorId
    })
  });
  requireStatus(response, body, 200, `onboard ${connector.label} connector`);
  const result = asRecord(body);
  if (result.trustLevel !== "trusted_metadata_only" || result.connectorProfileVerified !== true || result.connectorDecisionSource !== connector.connectorId) {
    throw new Error(`${connector.label} onboarding did not produce trusted connector metadata: ${JSON.stringify(body)}`);
  }
  const decision = asRecord(result.capabilityDecision);
  const approved = Array.isArray(decision.approvedCapabilities) ? decision.approvedCapabilities.map(asRecord) : [];
  if (!approved.some((item) => item.capability === connector.approvedSkillId)) {
    throw new Error(`${connector.label} expected skill was not approved: ${JSON.stringify(body)}`);
  }
  assertNoSecretMarkers(body);
  logOk(`onboarded ${connector.label} reference connector`);
}

async function resolveMessage(message: string, conversationId?: string): Promise<Record<string, unknown>> {
  const { response, body } = await request("/resolve", {
    method: "POST",
    body: JSON.stringify({ message, conversationId })
  });
  requireStatus(response, body, 200, `resolve ${message}`);
  assertNoSecretMarkers(body);
  return asRecord(body);
}

function expectConnectorStatus(body: Record<string, unknown>, expectedStatus: string, label: string): Record<string, unknown> {
  const connectorRouting = asRecord(body.connectorRouting);
  if (connectorRouting.status !== expectedStatus) {
    throw new Error(`${label} expected connectorRouting.status ${expectedStatus}, got ${JSON.stringify(connectorRouting)}`);
  }
  return connectorRouting;
}

function expectServiceNowFulfillment(result: Record<string, unknown>, message: string, targetResourceSystem: string): void {
  const route = expectConnectorStatus(result, "connector_skill_approved", `${message} fulfillment route`);
  if (route.connectorId !== "servicenow-reference" || route.skillId !== "servicenow.catalog.item.recommend") {
    throw new Error(`${message} should route to ServiceNow fulfillment capability, got ${JSON.stringify(route)}`);
  }
  if (route.targetResourceSystem !== targetResourceSystem || route.fulfillmentCapability !== "access.request.prepare") {
    throw new Error(`${message} route did not preserve access request context: ${JSON.stringify(route)}`);
  }
  const runtime = asRecord(result.connectorRuntime);
  if (runtime.executed !== true || runtime.resourceSystem !== "servicenow") {
    throw new Error(`${message} should execute ServiceNow fulfillment runtime: ${JSON.stringify(runtime)}`);
  }
  const agentResponse = asRecord(runtime.agentResponse);
  const endUserAnswer = asRecord(agentResponse.endUserAnswer);
  const finalAnswer = typeof result.finalAnswer === "string" ? result.finalAnswer : "";
  if (!finalAnswer.includes("Request preparation") || !finalAnswer.includes("No request was submitted")) {
    throw new Error(`${message} should produce request-preparation copy with no submission claim: ${JSON.stringify(result.finalAnswer)}`);
  }
  if (!JSON.stringify(endUserAnswer).includes("No request was submitted")) {
    throw new Error(`${message} end-user answer should say no request was submitted: ${JSON.stringify(endUserAnswer)}`);
  }
  assertNoSecretMarkers(result);
}

async function verifyApprovedRuntime(connector: ConnectorFixture): Promise<void> {
  const result = await resolveMessage(connector.approvedMessage);
  const route = expectConnectorStatus(result, "connector_skill_approved", `${connector.label} approved route`);
  if (route.connectorId !== connector.connectorId || route.skillId !== connector.approvedSkillId) {
    throw new Error(`${connector.label} route returned unexpected connector metadata: ${JSON.stringify(route)}`);
  }
  const runtime = asRecord(result.connectorRuntime);
  if (runtime.executed !== true || runtime.runtimeMode !== "external_runtime") {
    throw new Error(`${connector.label} did not execute connector runtime: ${JSON.stringify(runtime)}`);
  }
  const tokenMetadata = asRecord(runtime.tokenMetadata);
  if (tokenMetadata.tokenIssued !== true || tokenMetadata.rawToken !== "hidden" || tokenMetadata.audience !== connector.agentId) {
    throw new Error(`${connector.label} runtime token metadata mismatch: ${JSON.stringify(tokenMetadata)}`);
  }
  const agentResponse = asRecord(runtime.agentResponse);
  if (agentResponse.agentId !== connector.agentId || agentResponse.status !== "diagnosed") {
    throw new Error(`${connector.label} runtime response metadata mismatch: ${JSON.stringify(agentResponse)}`);
  }
  if (typeof agentResponse.summary !== "string" || !agentResponse.summary.includes(connector.expectedSummary)) {
    throw new Error(`${connector.label} runtime summary missing connector diagnosis: ${JSON.stringify(agentResponse)}`);
  }
  logOk(`${connector.label} approved route executed connector runtime`);
}

async function disableServiceNowUserRoleSkill(): Promise<void> {
  const serviceNow = connectors[1];
  const enabledActionIds = [
    "servicenow.incident.assignment.diagnose",
    "servicenow.catalog.request.diagnose"
  ];
  const { response, body } = await externalRequest(serviceNow.baseUrl, "/admin/capability-declaration", {
    method: "POST",
    body: JSON.stringify({
      enabledActionIds,
      agentDeclaredCapabilities: enabledActionIds
    })
  });
  requireStatus(response, body, 200, "disable ServiceNow user role skill");
}

async function main(): Promise<void> {
  console.info(`Verifying multi-connector routing against ${API_URL}`);

  await createSession();
  await demoLogin();

  for (const connector of connectors) {
    await resetConnector(connector);
  }

  for (const connector of connectors) {
    await onboardConnector(connector);
  }

  for (const connector of connectors) {
    await verifyApprovedRuntime(connector);
  }

  let result = await resolveMessage("I want to request access to Jira");
  let route: Record<string, unknown>;
  expectServiceNowFulfillment(result, "Jira access request", "jira");
  if (!JSON.stringify(result).includes("Jira Access Request")) {
    throw new Error(`Jira access request should recommend the Jira ServiceNow catalog item: ${JSON.stringify(result.finalAnswer)}`);
  }
  logOk("Jira access request routes to ServiceNow fulfillment capability");

  result = await resolveMessage("I need access to GitHub");
  expectServiceNowFulfillment(result, "GitHub access request", "github");
  if (!JSON.stringify(result).includes("GitHub Repository Access Request")) {
    throw new Error(`GitHub access request should recommend the GitHub ServiceNow catalog item: ${JSON.stringify(result.finalAnswer)}`);
  }
  logOk("GitHub access request routes to ServiceNow fulfillment capability");

  result = await resolveMessage("I need AWS production access");
  expectServiceNowFulfillment(result, "AWS access request", "aws");
  if (!JSON.stringify(result).includes("AWS Access Request")) {
    throw new Error(`AWS access request should recommend the AWS ServiceNow catalog item: ${JSON.stringify(result.finalAnswer)}`);
  }
  logOk("AWS access request routes to ServiceNow fulfillment capability");

  result = await resolveMessage("I need access to billing-api repo");
  expectServiceNowFulfillment(result, "billing-api repo access request", "github");
  if (!JSON.stringify(result).includes("GitHub Repository Access Request")) {
    throw new Error(`billing-api repo access request should use ServiceNow fulfillment for GitHub repo access: ${JSON.stringify(result.finalAnswer)}`);
  }
  logOk("repository access request uses ServiceNow fulfillment connector by declared capability");

  result = await resolveMessage("Why can't I create a Jira issue in FIN?");
  route = expectConnectorStatus(result, "connector_skill_approved", "Jira create diagnostic");
  if (route.connectorId !== "jira-reference" || route.skillId !== "jira.issue.diagnose_creation_failure") {
    throw new Error(`Jira create diagnostic should stay on Jira connector: ${JSON.stringify(route)}`);
  }
  logOk("Jira create diagnostic still routes to Jira connector");

  result = await resolveMessage("What is the status of FIN-42?");
  route = expectConnectorStatus(result, "connector_skill_approved", "Jira issue status");
  if (route.connectorId !== "jira-reference" || route.skillId !== "jira.issue.status.lookup") {
    throw new Error(`Jira issue status should stay on Jira connector: ${JSON.stringify(route)}`);
  }
  logOk("Jira issue status still routes to Jira connector");

  result = await resolveMessage("What is the status of INC0010245?");
  route = expectConnectorStatus(result, "connector_skill_approved", "ServiceNow ticket status");
  if (route.connectorId !== "servicenow-reference" || route.skillId !== "servicenow.ticket.status.lookup") {
    throw new Error(`ServiceNow ticket status should stay on ServiceNow ticket lookup: ${JSON.stringify(route)}`);
  }
  logOk("ServiceNow ticket status still routes to ticket lookup");

  result = await resolveMessage("what is the status of INC0010213");
  route = expectConnectorStatus(result, "connector_skill_approved", "ServiceNow first ticket follow-up setup");
  if (route.connectorId !== "servicenow-reference" || route.skillId !== "servicenow.ticket.status.lookup") {
    throw new Error(`ServiceNow first ticket lookup should use ticket status lookup: ${JSON.stringify(route)}`);
  }
  const conversationId = typeof result.conversationId === "string" ? result.conversationId : undefined;
  const firstFinalAnswer = typeof result.finalAnswer === "string" ? result.finalAnswer : "";
  if (!conversationId || !firstFinalAnswer.includes("INC0010213")) {
    throw new Error(`ServiceNow first ticket lookup should return INC0010213 with a conversation id: ${JSON.stringify(result.finalAnswer)}`);
  }

  result = await resolveMessage("what is the status of INC0010244", conversationId);
  route = expectConnectorStatus(result, "connector_skill_approved", "ServiceNow explicit ticket follow-up");
  if (route.connectorId !== "servicenow-reference" || route.skillId !== "servicenow.ticket.status.lookup") {
    throw new Error(`ServiceNow explicit ticket follow-up should use ticket status lookup: ${JSON.stringify(route)}`);
  }
  const secondFinalAnswer = typeof result.finalAnswer === "string" ? result.finalAnswer : "";
  if (!secondFinalAnswer.includes("INC0010244") || !/not found/i.test(secondFinalAnswer)) {
    throw new Error(`ServiceNow explicit ticket follow-up should report INC0010244 not found: ${JSON.stringify(result.finalAnswer)}`);
  }
  if (secondFinalAnswer.includes("INC0010213")) {
    throw new Error(`ServiceNow explicit ticket follow-up final answer reused prior ticket: ${JSON.stringify(result.finalAnswer)}`);
  }
  logOk("ServiceNow explicit ticket in follow-up overrides previous ticket context");

  result = await resolveMessage("The warehouse robot arm calibration failed");
  route = expectConnectorStatus(result, "unsupported", "unsupported warehouse request");
  if (typeof route.recommendedNextStep !== "string" || !route.recommendedNextStep.toLowerCase().includes("support ticket")) {
    throw new Error(`unsupported route did not recommend a support ticket: ${JSON.stringify(route)}`);
  }
  if (result.connectorRuntime !== undefined) {
    throw new Error(`unsupported route should not execute runtime: ${JSON.stringify(result.connectorRuntime)}`);
  }
  logOk("unsupported request returns ticket recommendation");

  await disableServiceNowUserRoleSkill();
  await onboardConnector(connectors[1]);
  result = await resolveMessage("ServiceNow user ACL access issue keeps blocking assignment");
  route = expectConnectorStatus(result, "connector_skill_not_declared", "ServiceNow disabled skill");
  if (typeof route.recommendedNextStep !== "string" || !route.recommendedNextStep.includes("Enable this skill")) {
    throw new Error(`disabled ServiceNow skill did not recommend enable and re-onboard: ${JSON.stringify(route)}`);
  }
  if (result.connectorRuntime !== undefined) {
    throw new Error(`disabled ServiceNow skill should not execute runtime: ${JSON.stringify(result.connectorRuntime)}`);
  }
  logOk("disabled ServiceNow skill is not executed");

  for (const connector of connectors) {
    await resetConnector(connector);
  }

  console.info("Multi-connector routing verification passed.");
}

main().catch((error) => {
  console.error(`fail - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
