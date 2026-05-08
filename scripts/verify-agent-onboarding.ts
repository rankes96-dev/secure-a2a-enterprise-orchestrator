const API_URL = process.env.ORCHESTRATOR_API_URL ?? "http://127.0.0.1:4000";

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

function assertNoSecretMarkers(value: unknown): void {
  const text = JSON.stringify(value);
  const forbidden = ["access_token", "client_assertion", "private_key", "client_secret", "Authorization", "Bearer"];
  const found = forbidden.find((marker) => text.includes(marker));
  if (found) {
    throw new Error(`onboarding response exposed forbidden marker ${found}`);
  }
}

async function verifyValidOnboarding(): Promise<void> {
  const { response, body } = await request("/agent-onboarding/start", {
    method: "POST",
    body: JSON.stringify({
      agentBaseUrl: "http://localhost:4201",
      expectedAgentId: "external-jira-agent"
    })
  });
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

  const agentProof = asRecord(result.agentProof);
  if (agentProof.signedResponseVerified !== true || agentProof.nonceMatched !== true) {
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
  if (!Array.isArray(oauthApplicationProof.grantedScopes) || !oauthApplicationProof.grantedScopes.includes("read:jira-work") || !oauthApplicationProof.grantedScopes.includes("read:jira-user")) {
    throw new Error(`granted scopes missing expected Jira scopes: ${JSON.stringify(body)}`);
  }
  const resourcePermissionProof = asRecord(result.resourcePermissionProof);
  if (resourcePermissionProof.principal !== "svc-a2a-jira-agent") {
    throw new Error(`resource permissions not loaded: ${JSON.stringify(body)}`);
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
  if (!blockedCreate || typeof blockedCreate.reason !== "string" || !blockedCreate.reason.includes("create_issues")) {
    throw new Error(`jira.issue.create was not blocked for missing create_issues: ${JSON.stringify(body)}`);
  }

  const checks = Array.isArray(result.checks) ? result.checks.map((item) => asRecord(item)) : [];
  for (const checkName of ["gateway_identity_verified", "signed_gateway_challenge_verified", "signed_agent_response_verified", "oauth_application_bound", "requested_scopes_granted", "resource_permissions_loaded", "capabilities_derived"]) {
    const check = checks.find((item) => item.name === checkName);
    if (check?.status !== "passed") {
      throw new Error(`${checkName} check did not pass: ${JSON.stringify(body)}`);
    }
  }

  assertNoSecretMarkers(body);
  logOk("valid zero-trust onboarding returned trusted metadata");
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
  await verifyFailure("wrong expectedAgentId", {
    agentBaseUrl: "http://localhost:4201",
    expectedAgentId: "wrong-agent"
  });
  await verifyFailure("unsupported base URL", {
    agentBaseUrl: "https://evil.example.com",
    expectedAgentId: "external-jira-agent"
  });
  console.info("Zero-trust Agent Onboarding verification passed.");
}

main().catch((error) => {
  console.error(`fail - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
