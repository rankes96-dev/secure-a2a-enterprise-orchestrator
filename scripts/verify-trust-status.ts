const API_URL = process.env.ORCHESTRATOR_API_URL ?? "http://127.0.0.1:4000";

let sessionCookie = "";

function logOk(message: string): void {
  console.info(`ok - ${message}`);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) as unknown : {};
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

function requireStatus(response: Response, body: unknown, status: number, label: string): void {
  if (response.status !== status) {
    throw new Error(`${label} expected HTTP ${status}, got ${response.status}: ${JSON.stringify(body)}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected object response, got ${JSON.stringify(value)}`);
  }

  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string, label: string): string {
  if (typeof record[key] !== "string" || !record[key]) {
    throw new Error(`${label} missing string field ${key}: ${JSON.stringify(record)}`);
  }

  return record[key];
}

function requireBoolean(record: Record<string, unknown>, key: string, expected: boolean, label: string): void {
  if (record[key] !== expected) {
    throw new Error(`${label} expected ${key}=${expected}, got ${JSON.stringify(record)}`);
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

async function getTrustStatus(): Promise<Record<string, unknown>> {
  const { response, body } = await request("/identity/trust-status");
  requireStatus(response, body, 200, "get trust status");
  return asRecord(body);
}

function verifyNoSensitiveStrings(value: unknown): void {
  const serialized = JSON.stringify(value);
  const forbidden = [
    "access_token",
    "client_assertion",
    "private_key",
    "client_secret",
    "Authorization",
    "Bearer"
  ];
  const found = forbidden.find((item) => serialized.includes(item));
  if (found) {
    throw new Error(`trust status response exposed forbidden marker: ${found}`);
  }
}

function verifyBaseTrustStatus(status: Record<string, unknown>): void {
  const userIdentity = asRecord(status.userIdentity);
  const gatewayIdentity = asRecord(status.gatewayIdentity);
  const mockIdp = asRecord(status.mockIdp);
  const securityControls = asRecord(status.securityControls);

  requireBoolean(userIdentity, "authenticated", false, "initial user identity");
  requireString(gatewayIdentity, "agentId", "gateway identity");
  requireString(gatewayIdentity, "a2aAuthMode", "gateway identity");
  requireString(mockIdp, "issuer", "mock IdP");
  requireString(mockIdp, "jwksUri", "mock IdP");
  requireBoolean(securityControls, "rawTokensDisplayed", false, "security controls");
  requireBoolean(securityControls, "agentOnboardingFetchesExternalUrls", false, "security controls");
  requireBoolean(securityControls, "userIdentityRequiredForResolve", true, "security controls");
  verifyNoSensitiveStrings(status);
  logOk("verified unauthenticated trust status");
}

function verifyAuthenticatedTrustStatus(status: Record<string, unknown>): void {
  const userIdentity = asRecord(status.userIdentity);
  const user = asRecord(userIdentity.user);

  requireBoolean(userIdentity, "authenticated", true, "authenticated user identity");
  if (user.email !== "ran@company.com") {
    throw new Error(`expected ran@company.com, got ${JSON.stringify(user)}`);
  }

  verifyNoSensitiveStrings(status);
  logOk("verified authenticated trust status");
}

async function demoLogin(): Promise<void> {
  const { response, body } = await request("/identity/demo-login", {
    method: "POST",
    body: JSON.stringify({ email: "ran@company.com" })
  });
  requireStatus(response, body, 200, "demo login");
  logOk("logged in demo user");
}

async function main(): Promise<void> {
  console.info(`Verifying trust status against ${API_URL}`);

  await createSession();
  verifyBaseTrustStatus(await getTrustStatus());
  await demoLogin();
  verifyAuthenticatedTrustStatus(await getTrustStatus());

  console.info("Trust status verification passed.");
}

main().catch((error) => {
  console.error(`fail - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
