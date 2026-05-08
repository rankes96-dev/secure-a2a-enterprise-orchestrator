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
      agentBaseUrl: "https://agents.example.com",
      expectedAgentId: "external-salesforce-access-agent"
    })
  });
  requireStatus(response, body, 200, "valid onboarding");
  const result = asRecord(body);

  if (result.trustLevel !== "trusted_metadata_only") {
    throw new Error(`expected trustLevel trusted_metadata_only, got ${JSON.stringify(result.trustLevel)}`);
  }
  if (!Array.isArray(result.verifiedScopes) || !result.verifiedScopes.includes("salesforce.access.read")) {
    throw new Error(`verifiedScopes missing salesforce.access.read: ${JSON.stringify(body)}`);
  }
  if (!Array.isArray(result.verifiedCapabilities) || !result.verifiedCapabilities.includes("salesforce.access.diagnose")) {
    throw new Error(`verifiedCapabilities missing salesforce.access.diagnose: ${JSON.stringify(body)}`);
  }

  const checks = Array.isArray(result.checks) ? result.checks.map((item) => asRecord(item)) : [];
  const oauthCheck = checks.find((item) => item.name === "oauth_application_bound");
  if (oauthCheck?.status !== "passed") {
    throw new Error(`oauth_application_bound check did not pass: ${JSON.stringify(body)}`);
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
    agentBaseUrl: "https://agents.example.com",
    expectedAgentId: "wrong-agent"
  });
  await verifyFailure("unsupported base URL", {
    agentBaseUrl: "https://evil.example.com",
    expectedAgentId: "external-salesforce-access-agent"
  });
  console.info("Zero-trust Agent Onboarding verification passed.");
}

main().catch((error) => {
  console.error(`fail - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

