const API_URL = process.env.ORCHESTRATOR_API_URL ?? "http://127.0.0.1:4000";
const EXTERNAL_AGENT_URL = process.env.EXTERNAL_AGENT_URL ?? "http://localhost:4201";
const allApplicationAccessGrants = ["read:jira-work", "read:jira-user", "write:jira-work", "manage:jira-project"];
const allEffectivePermissions = ["browse_projects", "view_issues", "read_project_roles", "create_issues", "administer_projects"];
const allActionIds = ["jira.issue.diagnose_creation_failure", "jira.permission.inspect", "jira.issue.create"];

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
    /client_secret/i,
    /"private_key"\s*:/i,
    /access_token/i,
    /refresh_token/i,
    /Authorization/,
    /Bearer/
  ];
  const found = forbidden.find((marker) => marker.test(text));
  if (found) {
    throw new Error(`response exposed forbidden marker ${found}`);
  }
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

async function demoLogin(): Promise<void> {
  const { response, body } = await request("/identity/demo-login", {
    method: "POST",
    body: JSON.stringify({ email: "ran@company.com" })
  });
  requireStatus(response, body, 200, "demo login");
  logOk("logged in as ran@company.com");
}

async function resetExternalAgent(): Promise<void> {
  const { response, body } = await externalPost("/admin/reset-demo");
  requireStatus(response, body, 200, "reset external agent demo config");
  logOk("reset external agent demo config");
}

async function configureExternalAgent(input: {
  applicationAccessGrants: string[];
  effectivePermissions: string[];
  deniedPermissions: string[];
  enabledActionIds?: string[];
}): Promise<void> {
  let result = await externalPost("/admin/oauth-application", {
    appName: "Jira Agent Connected App",
    clientId: "jira-agent-client",
    authorizationServerIssuer: "http://localhost:4110",
    tokenEndpointAuthMethod: "private_key_jwt",
    applicationAccessGrants: input.applicationAccessGrants,
    grantedScopes: input.applicationAccessGrants,
    status: "active"
  });
  requireStatus(result.response, result.body, 200, "configure external OAuth application");

  result = await externalPost("/admin/service-principal", {
    principalType: "service_account",
    principalId: "svc-a2a-jira-agent",
    effectivePermissions: input.effectivePermissions,
    deniedPermissions: input.deniedPermissions
  });
  requireStatus(result.response, result.body, 200, "configure external service principal");

  const enabledActionIds = input.enabledActionIds ?? allActionIds;
  result = await externalPost("/admin/capability-declaration", {
    enabledActionIds,
    agentDeclaredCapabilities: enabledActionIds
  });
  requireStatus(result.response, result.body, 200, "configure external agent actions");
}

async function onboardJiraConnector(options: { expectCreateBlocked?: boolean; expectCreateDecision?: "blocked" | "approved" | "absent" } = {}): Promise<void> {
  const expectCreateDecision = options.expectCreateDecision ?? (options.expectCreateBlocked === false ? "approved" : "blocked");
  const { response, body } = await request("/agent-onboarding/start", {
    method: "POST",
    body: JSON.stringify({
      agentBaseUrl: EXTERNAL_AGENT_URL,
      expectedAgentId: "external-jira-agent",
      expectedResourceSystem: "jira",
      expectedConnectorId: "jira-reference"
    })
  });
  requireStatus(response, body, 200, "onboard Jira connector");

  const result = asRecord(body);
  if (result.trustLevel !== "trusted_metadata_only" || result.connectorProfileVerified !== true || result.connectorDecisionSource !== "jira-reference") {
    throw new Error(`Jira connector onboarding did not produce trusted connector metadata: ${JSON.stringify(body)}`);
  }

  const decision = asRecord(result.capabilityDecision);
  const approved = Array.isArray(decision.approvedCapabilities) ? decision.approvedCapabilities.map(asRecord) : [];
  const blocked = Array.isArray(decision.blockedCapabilities) ? decision.blockedCapabilities.map(asRecord) : [];
  if (!approved.some((item) => item.capability === "jira.issue.diagnose_creation_failure")) {
    throw new Error(`Jira diagnosis action was not approved: ${JSON.stringify(body)}`);
  }
  if (expectCreateDecision === "blocked" && !blocked.some((item) => item.capability === "jira.issue.create")) {
    throw new Error(`Jira create action was not blocked by default: ${JSON.stringify(body)}`);
  }
  if (expectCreateDecision === "approved" && !approved.some((item) => item.capability === "jira.issue.create")) {
    throw new Error(`Jira create action was not approved with full access: ${JSON.stringify(body)}`);
  }
  if (expectCreateDecision === "absent" && (approved.some((item) => item.capability === "jira.issue.create") || blocked.some((item) => item.capability === "jira.issue.create"))) {
    throw new Error(`Jira create action should be absent when not declared: ${JSON.stringify(body)}`);
  }

  assertNoSecretMarkers(body);
  logOk("onboarded Jira reference connector");
}

async function resolveMessage(message: string): Promise<Record<string, unknown>> {
  const { response, body } = await request("/resolve", {
    method: "POST",
    body: JSON.stringify({ message })
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

async function main(): Promise<void> {
  console.info(`Verifying connector-first routing against ${API_URL}`);

  await createSession();
  await demoLogin();
  await resetExternalAgent();
  await onboardJiraConnector();

  let result = await resolveMessage("Jira issue creation fails with 403 when creating issues in FIN project");
  let route = expectConnectorStatus(result, "connector_skill_approved", "Jira diagnosis");
  if (route.connectorId !== "jira-reference" || route.skillId !== "jira.issue.diagnose_creation_failure") {
    throw new Error(`Jira diagnosis route returned unexpected connector metadata: ${JSON.stringify(route)}`);
  }
  const runtime = asRecord(result.connectorRuntime);
  if (runtime.executed !== true || runtime.runtimeMode !== "external_runtime") {
    throw new Error(`Jira diagnosis did not execute connector runtime: ${JSON.stringify(runtime)}`);
  }
  const tokenMetadata = asRecord(runtime.tokenMetadata);
  if (tokenMetadata.tokenIssued !== true || tokenMetadata.rawToken !== "hidden" || tokenMetadata.audience !== "external-jira-agent" || tokenMetadata.scope !== "read:jira-work") {
    throw new Error(`Jira diagnosis runtime token metadata mismatch: ${JSON.stringify(tokenMetadata)}`);
  }
  const agentResponse = asRecord(runtime.agentResponse);
  if (agentResponse.agentId !== "external-jira-agent" || agentResponse.status !== "diagnosed") {
    throw new Error(`Jira diagnosis runtime response mismatch: ${JSON.stringify(agentResponse)}`);
  }
  if (typeof agentResponse.summary !== "string" || !agentResponse.summary.includes("Jira issue creation failure diagnosis completed")) {
    throw new Error(`Jira diagnosis runtime summary missing actual external diagnosis: ${JSON.stringify(agentResponse)}`);
  }
  if (typeof result.finalAnswer !== "string" || !result.finalAnswer.includes("I found an access or permission issue")) {
    throw new Error(`Jira diagnosis final answer did not use safe runtime end-user diagnosis: ${JSON.stringify(result.finalAnswer)}`);
  }
  const evidence = Array.isArray(agentResponse.evidence) ? agentResponse.evidence.map(asRecord) : [];
  const runtimeValidation = evidence.find((item) => item.title === "Connector runtime validation");
  if (!runtimeValidation) {
    throw new Error(`Jira diagnosis runtime evidence missing validation record: ${JSON.stringify(agentResponse)}`);
  }
  const runtimeValidationData = asRecord(runtimeValidation.data);
  if (runtimeValidationData.tokenScopeValidated !== true || runtimeValidationData.rawToken !== "hidden" || runtimeValidationData.actorAttached !== true) {
    throw new Error(`Jira diagnosis runtime evidence did not confirm token validation safely: ${JSON.stringify(runtimeValidationData)}`);
  }
  if (
    typeof agentResponse.probableCause !== "string" ||
    !agentResponse.probableCause.includes("diagnostic skill executed successfully") ||
    !agentResponse.probableCause.includes("Gateway did not attempt to create an issue")
  ) {
    throw new Error(`default Jira diagnosis did not separate diagnostic execution from target create access: ${JSON.stringify(agentResponse)}`);
  }
  const runtimeSemantics = asRecord(agentResponse.runtimeSemantics);
  if (
    runtimeSemantics.executionType !== "diagnostic_read_only" ||
    runtimeSemantics.targetActionId !== "jira.issue.create" ||
    runtimeSemantics.writeActionAttempted !== false ||
    runtimeSemantics.targetActionStatus !== "explicitly_denied"
  ) {
    throw new Error(`default Jira diagnosis runtime semantics mismatch: ${JSON.stringify(runtimeSemantics)}`);
  }
  logOk("default Jira diagnosis executes runtime and explains target create action status");

  await configureExternalAgent({
    applicationAccessGrants: allApplicationAccessGrants,
    effectivePermissions: allEffectivePermissions,
    deniedPermissions: []
  });
  await onboardJiraConnector({ expectCreateBlocked: false });
  result = await resolveMessage("Jira issue creation fails with 403 when creating issues in FIN project");
  route = expectConnectorStatus(result, "connector_skill_approved", "Jira all-access diagnosis");
  const allAccessRuntime = asRecord(result.connectorRuntime);
  if (allAccessRuntime.executed !== true) {
    throw new Error(`all-access Jira diagnosis did not execute runtime: ${JSON.stringify(allAccessRuntime)}`);
  }
  const allAccessAgentResponse = asRecord(allAccessRuntime.agentResponse);
  if (typeof allAccessAgentResponse.probableCause !== "string" || !/connector-level access checks passing/i.test(allAccessAgentResponse.probableCause)) {
    throw new Error(`all-access Jira diagnosis did not recognize connector-level access passed: ${JSON.stringify(allAccessAgentResponse)}`);
  }
  const allAccessSemantics = asRecord(allAccessAgentResponse.runtimeSemantics);
  if (allAccessSemantics.targetActionStatus !== "ready") {
    throw new Error(`all-access Jira diagnosis should mark target action ready: ${JSON.stringify(allAccessSemantics)}`);
  }
  const allAccessActions = Array.isArray(allAccessAgentResponse.recommendedActions) ? allAccessAgentResponse.recommendedActions.join(" ") : "";
  if (/Grant write:jira-work|Grant Create Issues permission/.test(allAccessActions)) {
    throw new Error(`all-access Jira diagnosis should not recommend granting already-present access: ${JSON.stringify(allAccessAgentResponse)}`);
  }
  if (!/project key|issue type|workflow validators|actor|audit logs/i.test(allAccessActions)) {
    throw new Error(`all-access Jira diagnosis should recommend project-specific checks: ${JSON.stringify(allAccessAgentResponse)}`);
  }
  if (typeof result.finalAnswer !== "string" || /I found an access or permission issue/i.test(result.finalAnswer)) {
    throw new Error(`all-access Jira diagnosis must not claim generic access or permission issue: ${JSON.stringify(result.finalAnswer)}`);
  }
  if (!/connector-level grant and service-account permission checks passed/i.test(result.finalAnswer)) {
    throw new Error(`all-access Jira diagnosis should align chat answer with proof checks: ${JSON.stringify(result.finalAnswer)}`);
  }
  const allAccessEvidence = Array.isArray(allAccessAgentResponse.evidence) ? JSON.stringify(allAccessAgentResponse.evidence) : "";
  if (!allAccessEvidence.includes("resourceSpecificCheck")) {
    throw new Error(`all-access Jira diagnosis should expose resource-specific runtime evidence: ${JSON.stringify(allAccessAgentResponse)}`);
  }
  assertNoSecretMarkers(result);
  logOk("all-access Jira diagnosis executes runtime and shifts to project-specific checks");

  await resetExternalAgent();
  await onboardJiraConnector();

  await configureExternalAgent({
    applicationAccessGrants: allApplicationAccessGrants,
    effectivePermissions: allEffectivePermissions,
    deniedPermissions: []
  });
  result = await resolveMessage("Jira issue creation fails with 403 when creating issues in FIN project");
  route = expectConnectorStatus(result, "connector_skill_approved", "Jira stale config diagnosis route");
  const staleRuntime = asRecord(result.connectorRuntime);
  if (staleRuntime.executed !== false || staleRuntime.runtimeMode !== "external_runtime_failed" || staleRuntime.error !== "connector_configuration_changed") {
    throw new Error(`stale external config should refuse runtime execution: ${JSON.stringify(staleRuntime)}`);
  }
  if (typeof result.finalAnswer !== "string" || !result.finalAnswer.includes("Connector configuration changed after onboarding")) {
    throw new Error(`stale config final answer should recommend refreshing onboarding: ${JSON.stringify(result.finalAnswer)}`);
  }
  logOk("runtime refuses stale connector configuration after admin changes");

  await resetExternalAgent();
  await configureExternalAgent({
    applicationAccessGrants: ["read:jira-work", "read:jira-user"],
    effectivePermissions: ["browse_projects", "view_issues", "read_project_roles"],
    deniedPermissions: ["create_issues"],
    enabledActionIds: ["jira.issue.diagnose_creation_failure", "jira.permission.inspect"]
  });
  await onboardJiraConnector({ expectCreateDecision: "absent" });
  result = await resolveMessage("Create a Jira issue in FIN project for this outage");
  route = expectConnectorStatus(result, "connector_skill_not_declared", "Jira create not declared");
  if (typeof route.recommendedNextStep !== "string" || !route.recommendedNextStep.includes("Enable this skill") || route.status === "unsupported") {
    throw new Error(`not-declared Jira create should guide enable and re-onboard, not unsupported: ${JSON.stringify(route)}`);
  }
  if (result.connectorRuntime !== undefined) {
    throw new Error(`Jira create not-declared route should not execute runtime: ${JSON.stringify(result.connectorRuntime)}`);
  }
  logOk("known Jira create skill not declared is not treated as unsupported");

  await resetExternalAgent();
  await onboardJiraConnector();

  result = await resolveMessage("Create a Jira issue in FIN project for this outage");
  route = expectConnectorStatus(result, "connector_skill_blocked", "Jira create");
  if (route.skillId !== "jira.issue.create" || typeof route.reason !== "string" || !route.reason.includes("write:jira-work") || !route.reason.includes("create_issues")) {
    throw new Error(`Jira create route did not explain blocked grants/permissions: ${JSON.stringify(route)}`);
  }
  if (result.connectorRuntime !== undefined) {
    throw new Error(`Jira create should not execute runtime: ${JSON.stringify(result.connectorRuntime)}`);
  }
  logOk("Jira create routes to blocked connector skill");

  result = await resolveMessage("ServiceNow incident assignment keeps failing for network tickets");
  route = expectConnectorStatus(result, "connector_not_onboarded", "ServiceNow");
  if (route.connectorId !== "servicenow-reference") {
    throw new Error(`ServiceNow route returned unexpected connector metadata: ${JSON.stringify(route)}`);
  }
  if (result.connectorRuntime !== undefined) {
    throw new Error(`ServiceNow not-onboarded route should not execute runtime: ${JSON.stringify(result.connectorRuntime)}`);
  }
  logOk("ServiceNow returns connector_not_onboarded");

  result = await resolveMessage("GitHub repository sync is failing after API rate limit");
  route = expectConnectorStatus(result, "connector_not_onboarded", "GitHub");
  if (route.connectorId !== "github-reference") {
    throw new Error(`GitHub route returned unexpected connector metadata: ${JSON.stringify(route)}`);
  }
  if (result.connectorRuntime !== undefined) {
    throw new Error(`GitHub not-onboarded route should not execute runtime: ${JSON.stringify(result.connectorRuntime)}`);
  }
  logOk("GitHub returns connector_not_onboarded");

  result = await resolveMessage("The warehouse robot arm calibration failed");
  route = expectConnectorStatus(result, "unsupported", "Unsupported request");
  if (typeof route.recommendedNextStep !== "string" || !route.recommendedNextStep.toLowerCase().includes("support ticket")) {
    throw new Error(`unsupported route did not recommend a support ticket: ${JSON.stringify(route)}`);
  }
  if (result.connectorRuntime !== undefined) {
    throw new Error(`unsupported route should not execute runtime: ${JSON.stringify(result.connectorRuntime)}`);
  }
  logOk("unsupported request returns ticket recommendation");

  await resetExternalAgent();
  console.info("Connector routing verification passed.");
}

main().catch((error) => {
  console.error(`fail - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
