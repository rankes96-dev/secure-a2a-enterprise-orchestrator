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

async function externalRequest(path: string, body: unknown = {}): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(`${EXTERNAL_AGENT_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { response, body: await readJson(response) };
}

async function resetExternalAgent(): Promise<void> {
  const { response, body } = await externalRequest("/admin/reset-demo");
  requireStatus(response, body, 200, "reset external agent demo config");
}

async function configureExternalAgent(input: {
  applicationAccessGrants: string[];
  effectivePermissions: string[];
  deniedPermissions: string[];
}): Promise<void> {
  let result = await externalRequest("/admin/oauth-application", {
    appName: "Jira Agent Connected App",
    clientId: "jira-agent-client",
    authorizationServerIssuer: "http://localhost:4110",
    tokenEndpointAuthMethod: "private_key_jwt",
    applicationAccessGrants: input.applicationAccessGrants,
    grantedScopes: input.applicationAccessGrants,
    status: "active"
  });
  requireStatus(result.response, result.body, 200, "configure external OAuth application");

  result = await externalRequest("/admin/service-principal", {
    principalType: "service_account",
    principalId: "svc-a2a-jira-agent",
    effectivePermissions: input.effectivePermissions,
    deniedPermissions: input.deniedPermissions
  });
  requireStatus(result.response, result.body, 200, "configure external service principal");

  result = await externalRequest("/admin/capability-declaration", {
    enabledActionIds: allActionIds,
    agentDeclaredCapabilities: allActionIds
  });
  requireStatus(result.response, result.body, 200, "configure external agent actions");
}

function assertNoSecretMarkers(value: unknown): void {
  const text = JSON.stringify(value);
  const forbidden = [
    /access_token/i,
    /client_assertion/i,
    /privateKey/i,
    /"private_key"\s*:/i,
    /clientSecret/i,
    /"client_secret"\s*:/i,
    /Authorization/,
    /Bearer/
  ];
  const found = forbidden.find((marker) => marker.test(text));
  if (found) {
    throw new Error(`onboarding response exposed forbidden marker ${found}`);
  }
}

async function startOnboarding(): Promise<{ response: Response; body: unknown }> {
  return request("/agent-onboarding/start", {
    method: "POST",
    body: JSON.stringify({
      agentBaseUrl: EXTERNAL_AGENT_URL,
      expectedAgentId: "external-jira-agent"
    })
  });
}

async function verifyValidOnboarding(): Promise<void> {
  await resetExternalAgent();
  const discoveryResponse = await request("/agent-onboarding/discover", {
    method: "POST",
    body: JSON.stringify({
      agentBaseUrl: EXTERNAL_AGENT_URL,
      expectedAgentId: "external-jira-agent"
    })
  });
  requireStatus(discoveryResponse.response, discoveryResponse.body, 200, "discover external agent");
  const discoveryResult = asRecord(discoveryResponse.body);
  if (discoveryResult.discovered !== true) {
    throw new Error(`expected discovery to succeed: ${JSON.stringify(discoveryResponse.body)}`);
  }
  const discovery = asRecord(discoveryResult.discovery);
  if (discovery.agentId !== "external-jira-agent" || discovery.issuer !== EXTERNAL_AGENT_URL) {
    throw new Error(`discovery returned unexpected agent metadata: ${JSON.stringify(discoveryResponse.body)}`);
  }
  if (discovery.adminConsoleUrl !== `${EXTERNAL_AGENT_URL}/admin`) {
    throw new Error(`discovery did not include external admin console URL: ${JSON.stringify(discoveryResponse.body)}`);
  }
  if (discovery.connectorId !== "jira-reference" || discovery.connectorProfileUrl !== `${EXTERNAL_AGENT_URL}/.well-known/a2a-connector-profile.json`) {
    throw new Error(`discovery did not include connector profile metadata: ${JSON.stringify(discoveryResponse.body)}`);
  }
  const gatewayRegistration = asRecord(discoveryResult.gatewayRegistration);
  if (gatewayRegistration.clientId !== "secure-a2a-gateway-client") {
    throw new Error(`discovery did not include Gateway registration metadata: ${JSON.stringify(discoveryResponse.body)}`);
  }
  assertNoSecretMarkers(discoveryResponse.body);
  logOk("discovered external agent metadata");

  const { response, body } = await startOnboarding();
  requireStatus(response, body, 200, "valid onboarding");
  const result = asRecord(body);

  if (result.trustLevel !== "trusted_metadata_only") {
    throw new Error(`expected trustLevel trusted_metadata_only, got ${JSON.stringify(result.trustLevel)}`);
  }
  const discoveredAgent = asRecord(result.discoveredAgent);
  const declaredCapabilities = Array.isArray(discoveredAgent.agentDeclaredCapabilities) ? discoveredAgent.agentDeclaredCapabilities : [];
  if (!declaredCapabilities.includes("jira.issue.create")) {
    throw new Error(`discoveredAgent did not expose agent-declared capabilities: ${JSON.stringify(body)}`);
  }
  if (!Array.isArray(discoveredAgent.requestedScopes) || !discoveredAgent.requestedScopes.includes("read:jira-work")) {
    throw new Error(`discoveredAgent did not expose requested scopes: ${JSON.stringify(body)}`);
  }
  if (!Array.isArray(discoveredAgent.requestedApplicationGrants) || !discoveredAgent.requestedApplicationGrants.includes("write:jira-work")) {
    throw new Error(`discoveredAgent did not expose requested application grants: ${JSON.stringify(body)}`);
  }

  const agentProof = asRecord(result.agentProof);
  if (agentProof.discoveryFetched !== true || agentProof.externalAgentContacted !== true || agentProof.signedResponseVerified !== true || agentProof.nonceMatched !== true) {
    throw new Error(`agent proof did not pass: ${JSON.stringify(body)}`);
  }
  const gatewayProof = asRecord(result.gatewayProof);
  if (gatewayProof.signedChallengeVerifiedByAgent !== true || gatewayProof.rawAssertionExposed !== false) {
    throw new Error(`gateway proof did not pass: ${JSON.stringify(body)}`);
  }
  if (gatewayProof.gatewayClientId !== "secure-a2a-gateway-client") {
    throw new Error(`gateway proof client id mismatch: ${JSON.stringify(body)}`);
  }
  const oauthApplicationProof = asRecord(result.oauthApplicationProof);
  if (oauthApplicationProof.clientBound !== true) {
    throw new Error(`OAuth app binding did not pass: ${JSON.stringify(body)}`);
  }
  if (!Array.isArray(oauthApplicationProof.applicationAccessGrants) || !oauthApplicationProof.applicationAccessGrants.includes("read:jira-work") || !oauthApplicationProof.applicationAccessGrants.includes("read:jira-user")) {
    throw new Error(`application access grants missing expected Jira grants: ${JSON.stringify(body)}`);
  }
  const resourcePermissionProof = asRecord(result.resourcePermissionProof);
  if (resourcePermissionProof.principal !== "svc-a2a-jira-agent") {
    throw new Error(`resource permissions not loaded: ${JSON.stringify(body)}`);
  }
  const externalApplicationAttestation = asRecord(result.externalApplicationAttestation);
  const connectorProfile = asRecord(result.connectorProfile);
  if (connectorProfile.connectorId !== "jira-reference" || connectorProfile.resourceSystem !== "jira" || connectorProfile.displayName !== "Jira Cloud Reference Connector") {
    throw new Error(`onboarding result missing connector profile summary: ${JSON.stringify(body)}`);
  }
  if (result.connectorProfileVerified !== true || result.connectorDecisionSource !== "jira-reference") {
    throw new Error(`connector profile was not verified as decision source: ${JSON.stringify(body)}`);
  }
  if (externalApplicationAttestation.connectorId !== "jira-reference" || externalApplicationAttestation.connectorProfileUrl !== `${EXTERNAL_AGENT_URL}/.well-known/a2a-connector-profile.json`) {
    throw new Error(`external attestation missing connector profile binding: ${JSON.stringify(body)}`);
  }
  const externalOauthApplication = asRecord(externalApplicationAttestation.oauthApplication);
  const externalServicePrincipal = asRecord(externalApplicationAttestation.servicePrincipal);
  if (externalOauthApplication.clientId !== "jira-agent-client") {
    throw new Error(`external OAuth application attestation missing: ${JSON.stringify(body)}`);
  }
  if (!Array.isArray(externalOauthApplication.applicationAccessGrants)) {
    throw new Error(`external OAuth application attestation missing applicationAccessGrants: ${JSON.stringify(body)}`);
  }
  if (externalServicePrincipal.principalId !== "svc-a2a-jira-agent") {
    throw new Error(`external service principal attestation missing: ${JSON.stringify(body)}`);
  }
  const capabilityDecision = asRecord(result.capabilityDecision);
  const approvedCapabilities = Array.isArray(capabilityDecision.approvedCapabilities) ? capabilityDecision.approvedCapabilities.map((item) => asRecord(item)) : [];
  const blockedCapabilities = Array.isArray(capabilityDecision.blockedCapabilities) ? capabilityDecision.blockedCapabilities.map((item) => asRecord(item)) : [];
  if (!approvedCapabilities.some((item) => item.capability === "jira.issue.diagnose_creation_failure")) {
    throw new Error(`jira.issue.diagnose_creation_failure was not approved: ${JSON.stringify(body)}`);
  }
  if (!approvedCapabilities.some((item) => item.capability === "jira.permission.inspect")) {
    throw new Error(`jira.permission.inspect was not approved: ${JSON.stringify(body)}`);
  }
  const blockedCreate = blockedCapabilities.find((item) => item.capability === "jira.issue.create");
  if (approvedCapabilities.length !== 2 || blockedCapabilities.length !== 1) {
    throw new Error(`default should approve 2 and block 1 action: ${JSON.stringify(body)}`);
  }
  if (!blockedCreate || typeof blockedCreate.reason !== "string" || !blockedCreate.reason.includes("write:jira-work") || !blockedCreate.reason.includes("create_issues")) {
    throw new Error(`jira.issue.create was not blocked for missing grant and denied create_issues: ${JSON.stringify(body)}`);
  }
  if (!Array.isArray(blockedCreate.missingApplicationGrants) || !blockedCreate.missingApplicationGrants.includes("write:jira-work")) {
    throw new Error(`blocked create action missing application grant details: ${JSON.stringify(body)}`);
  }
  if (!Array.isArray(blockedCreate.deniedEffectivePermissions) || !blockedCreate.deniedEffectivePermissions.includes("create_issues")) {
    throw new Error(`blocked create action missing denied permission details: ${JSON.stringify(body)}`);
  }

  const checks = Array.isArray(result.checks) ? result.checks.map((item) => asRecord(item)) : [];
  for (const checkName of ["safe_agent_base_url", "external_agent_discovery", "connector_profile_fetched", "connector_profile_verified", "gateway_identity_verified", "external_agent_contacted", "signed_gateway_challenge_verified", "signed_agent_response_verified", "oauth_application_bound", "requested_scopes_granted", "resource_permissions_loaded", "capabilities_derived"]) {
    const check = checks.find((item) => item.name === checkName);
    if (check?.status !== "passed") {
      throw new Error(`${checkName} check did not pass: ${JSON.stringify(body)}`);
    }
  }

  assertNoSecretMarkers(body);
  logOk("valid zero-trust onboarding returned trusted metadata");
}

async function verifyNoApplicationGrants(): Promise<void> {
  await configureExternalAgent({
    applicationAccessGrants: [],
    effectivePermissions: allEffectivePermissions,
    deniedPermissions: []
  });
  const { response, body } = await startOnboarding();
  requireStatus(response, body, 200, "no application grants onboarding");
  const result = asRecord(body);
  const capabilityDecision = asRecord(result.capabilityDecision);
  const approvedCapabilities = Array.isArray(capabilityDecision.approvedCapabilities) ? capabilityDecision.approvedCapabilities.map((item) => asRecord(item)) : [];
  const blockedCapabilities = Array.isArray(capabilityDecision.blockedCapabilities) ? capabilityDecision.blockedCapabilities.map((item) => asRecord(item)) : [];
  if (approvedCapabilities.length !== 0 || blockedCapabilities.length !== 3) {
    throw new Error(`no grants should approve 0 and block all actions: ${JSON.stringify(body)}`);
  }
  if (!blockedCapabilities.every((item) => typeof item.reason === "string" && item.reason.includes("missing application access grant"))) {
    throw new Error(`no grants should block by missing application access grants: ${JSON.stringify(body)}`);
  }
  if (result.connectorProfileVerified !== true || result.connectorDecisionSource !== "jira-reference") {
    throw new Error(`no grants onboarding should still verify connector profile: ${JSON.stringify(body)}`);
  }
  assertNoSecretMarkers(body);
  logOk("no application access grants block all actions without failing onboarding");
}

async function verifyAllAccess(): Promise<void> {
  await configureExternalAgent({
    applicationAccessGrants: allApplicationAccessGrants,
    effectivePermissions: allEffectivePermissions,
    deniedPermissions: []
  });
  const { response, body } = await startOnboarding();
  requireStatus(response, body, 200, "all access onboarding");
  const result = asRecord(body);
  const capabilityDecision = asRecord(result.capabilityDecision);
  const approvedCapabilities = Array.isArray(capabilityDecision.approvedCapabilities) ? capabilityDecision.approvedCapabilities.map((item) => asRecord(item)) : [];
  if (!approvedCapabilities.some((item) => item.capability === "jira.issue.create")) {
    throw new Error(`all grants and permissions should approve create action: ${JSON.stringify(body)}`);
  }
  if (result.connectorProfileVerified !== true || result.connectorDecisionSource !== "jira-reference") {
    throw new Error(`all access onboarding should use connector profile decision source: ${JSON.stringify(body)}`);
  }
  assertNoSecretMarkers(body);
  logOk("all application grants and effective permissions approve create action");
}

async function verifyFailure(label: string, requestBody: Record<string, unknown>): Promise<void> {
  const { response, body } = await request("/agent-onboarding/start", {
    method: "POST",
    body: JSON.stringify(requestBody)
  });
  requireStatus(response, body, 400, label);
  const result = asRecord(body);
  if (result.error !== "agent_onboarding_failed") {
    throw new Error(`${label} did not fail with agent_onboarding_failed: ${JSON.stringify(body)}`);
  }
  assertNoSecretMarkers(body);
  logOk(`rejected onboarding: ${label}`);
}

async function main(): Promise<void> {
  console.info(`Verifying zero-trust Agent Onboarding against ${API_URL}`);
  await createSession();
  await verifyValidOnboarding();
  await verifyNoApplicationGrants();
  await verifyAllAccess();
  await resetExternalAgent();
  await verifyFailure("wrong expectedAgentId", {
    agentBaseUrl: EXTERNAL_AGENT_URL,
    expectedAgentId: "wrong-agent"
  });
  await verifyFailure("unsupported base URL", {
    agentBaseUrl: "https://evil.example.com",
    expectedAgentId: "external-jira-agent"
  });
  await resetExternalAgent();
  console.info("Zero-trust Agent Onboarding verification passed.");
}

main().catch((error) => {
  console.error(`fail - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
