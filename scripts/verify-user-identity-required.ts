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

  sessionCookie = setCookie.split(";")[0] ?? "";
  logOk("created browser session");
}

async function resolveJira(): Promise<{ response: Response; body: unknown }> {
  return request("/resolve", {
    method: "POST",
    body: JSON.stringify({
      message: "Jira sync fails with 403 when creating issues"
    })
  });
}

async function verifyResolveRequiresIdentity(): Promise<void> {
  const { response, body } = await resolveJira();
  requireStatus(response, body, 401, "resolve without user identity");

  const result = asRecord(body);
  if (result.error !== "user_identity_required") {
    throw new Error(`resolve without identity returned unexpected error: ${JSON.stringify(body)}`);
  }

  logOk("resolve without login rejected with user_identity_required");
}

async function demoLogin(): Promise<void> {
  const { response, body } = await request("/identity/demo-login", {
    method: "POST",
    body: JSON.stringify({ email: "ran@company.com" })
  });
  requireStatus(response, body, 200, "demo login");
  logOk("logged in as ran@company.com");
}

async function verifyResolveWithIdentity(): Promise<void> {
  const { response, body } = await resolveJira();
  requireStatus(response, body, 200, "resolve with user identity");

  const result = asRecord(body);
  const userIdentity = asRecord(result.userIdentity);
  if (userIdentity.authenticated !== true || userIdentity.email !== "ran@company.com") {
    throw new Error(`resolve response did not include authenticated ran@company.com identity: ${JSON.stringify(userIdentity)}`);
  }

  verifyNoSensitiveStrings(body);
  logOk("resolve with login includes safe authenticated user identity");
}

async function main(): Promise<void> {
  console.info(`Verifying user identity is required for /resolve against ${API_URL}`);

  await createSession();
  await verifyResolveRequiresIdentity();
  await demoLogin();
  await verifyResolveWithIdentity();

  console.info("User identity required verification passed.");
}

main().catch((error) => {
  console.error(`fail - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
