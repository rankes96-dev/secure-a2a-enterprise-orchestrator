const API_URL = process.env.ORCHESTRATOR_API_URL ?? "http://127.0.0.1:4000";

type IdentitySessionResponse = {
  authenticated: boolean;
  user: {
    email: string;
    name?: string;
    roles: string[];
  } | null;
  issuer: string;
  audience: string;
};

type ResolveResponse = {
  userIdentity?: {
    authenticated: boolean;
    email?: string;
    name?: string;
    roles?: string[];
  };
  finalAnswer: string;
};

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

async function verifyIdentitySession(expectedAuthenticated: boolean, expectedEmail?: string): Promise<void> {
  const { response, body } = await request("/identity/session");
  requireStatus(response, body, 200, "get identity session");

  const identity = body as IdentitySessionResponse;
  if (identity.authenticated !== expectedAuthenticated) {
    throw new Error(`identity authenticated expected ${expectedAuthenticated}, got ${JSON.stringify(body)}`);
  }

  if (expectedEmail && identity.user?.email !== expectedEmail) {
    throw new Error(`identity email expected ${expectedEmail}, got ${JSON.stringify(body)}`);
  }

  logOk(`identity session authenticated=${expectedAuthenticated}`);
}

async function demoLogin(email: string, expectedStatus = 200): Promise<unknown> {
  const { response, body } = await request("/identity/demo-login", {
    method: "POST",
    body: JSON.stringify({ email })
  });
  requireStatus(response, body, expectedStatus, `demo login ${email}`);
  return body;
}

async function verifyResolveCarriesUserIdentity(): Promise<void> {
  const { response, body } = await request("/resolve", {
    method: "POST",
    body: JSON.stringify({
      message: "Jira sync fails with 403 when creating issues"
    })
  });
  requireStatus(response, body, 200, "resolve with user identity");

  const result = body as ResolveResponse;
  if (result.userIdentity?.authenticated !== true || result.userIdentity.email !== "ran@company.com") {
    throw new Error(`resolve response did not include authenticated user identity: ${JSON.stringify(body)}`);
  }

  logOk("resolve response includes safe user identity metadata");
}

async function logout(): Promise<void> {
  const { response, body } = await request("/identity/logout", { method: "POST" });
  requireStatus(response, body, 200, "logout identity");

  const result = asRecord(body);
  if (result.authenticated !== false) {
    throw new Error(`logout response did not clear authentication: ${JSON.stringify(body)}`);
  }

  logOk("logged out demo user identity");
}

async function main(): Promise<void> {
  console.info(`Verifying demo user identity against ${API_URL}`);

  await createSession();
  await verifyIdentitySession(false);

  const loginBody = await demoLogin("ran@company.com");
  const loginResult = loginBody as IdentitySessionResponse;
  if (loginResult.authenticated !== true || loginResult.user?.email !== "ran@company.com") {
    throw new Error(`demo login did not authenticate ran@company.com: ${JSON.stringify(loginBody)}`);
  }
  logOk("logged in as ran@company.com");

  await verifyIdentitySession(true, "ran@company.com");
  await verifyResolveCarriesUserIdentity();
  await logout();
  await verifyIdentitySession(false);
  await demoLogin("notallowed@company.com", 400);
  logOk("rejected disallowed demo user");

  console.info("User identity verification passed.");
}

main().catch((error) => {
  console.error(`fail - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
