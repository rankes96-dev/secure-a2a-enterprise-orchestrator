const API_URL = process.env.ORCHESTRATOR_API_URL ?? "http://127.0.0.1:4000";

let sessionCookie = "";
let csrfToken = "";

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
      ...(init.body && csrfToken ? { "x-ogen-csrf-token": csrfToken } : {}),
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

function requireArray(record: Record<string, unknown>, key: string): void {
  if (!Array.isArray(record[key])) {
    throw new Error(`Expected ${key} array in resolve response: ${JSON.stringify(record)}`);
  }
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
    throw new Error(`resolve response exposed forbidden marker: ${found}`);
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

  const record = asRecord(body);
  if (typeof record.csrfToken !== "string" || record.csrfToken.length === 0) {
    throw new Error("create session did not return a CSRF token");
  }

  csrfToken = record.csrfToken;
  sessionCookie = setCookie
    .split(/,(?=\s*[^;,=]+=)/)
    .map((cookie) => cookie.trim().split(";")[0])
    .filter(Boolean)
    .join("; ");
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

async function resolveScenario(): Promise<Record<string, unknown>> {
  const { response, body } = await request("/resolve", {
    method: "POST",
    body: JSON.stringify({
      message: "Jira sync fails with 403 when creating issues"
    })
  });
  requireStatus(response, body, 200, "resolve Jira scenario");
  return asRecord(body);
}

function verifyTimelineSourceResponse(response: Record<string, unknown>): void {
  const userIdentity = asRecord(response.userIdentity);
  if (userIdentity.authenticated !== true || userIdentity.email !== "ran@company.com") {
    throw new Error(`resolve response did not include authenticated ran@company.com user identity: ${JSON.stringify(userIdentity)}`);
  }

  requireArray(response, "executionTrace");
  requireArray(response, "agentTrace");
  requireArray(response, "selectedAgents");
  requireArray(response, "securityDecisions");
  requireArray(response, "a2aTasks");
  requireArray(response, "a2aResponses");
  verifyNoSensitiveStrings(response);
  logOk("resolve response includes security timeline source data without token markers");
}

async function main(): Promise<void> {
  console.info(`Verifying security timeline source data against ${API_URL}`);

  await createSession();
  await demoLogin();
  verifyTimelineSourceResponse(await resolveScenario());

  console.info("Security timeline verification passed.");
}

main().catch((error) => {
  console.error(`fail - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
