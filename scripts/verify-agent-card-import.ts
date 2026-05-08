const API_URL = process.env.ORCHESTRATOR_API_URL ?? "http://127.0.0.1:4000";
const API_KEY = process.env.ORCHESTRATOR_API_KEY;

type AgentCard = {
  agentId: string;
  name: string;
  description: string;
  systems: string[];
  endpoint: string;
  auth: {
    type: string;
    audience: string;
  };
  skills: Array<{
    id: string;
    name: string;
    description: string;
    capabilities: string[];
    requiredScopes: string[];
    riskLevel: "low" | "medium" | "high" | "sensitive";
    examples?: string[];
    scope?: {
      systems?: string[];
      resourceTypes?: string[];
    };
  }>;
};

const sampleAgentCard: AgentCard = {
  agentId: "external-salesforce-access-agent",
  name: "Salesforce Access Agent",
  description: "Diagnoses Salesforce login and permission issues.",
  systems: ["salesforce"],
  endpoint: "https://agents.example.com/salesforce/task",
  auth: {
    type: "oauth2_client_credentials_jwt",
    audience: "external-salesforce-access-agent"
  },
  skills: [
    {
      id: "salesforce-access-diagnose",
      name: "Diagnose Salesforce access",
      description: "Checks Salesforce access issues and missing permissions.",
      capabilities: ["salesforce.access.diagnose"],
      requiredScopes: ["salesforce.access.read"],
      riskLevel: "medium",
      examples: ["I cannot login to Salesforce", "User cannot access Salesforce account"],
      scope: {
        systems: ["salesforce"],
        resourceTypes: ["user", "account", "permission"]
      }
    }
  ]
};

let sessionCookie = "";
type RequestAuthMode = "session" | "apiKey";

function logOk(message: string): void {
  console.info(`ok - ${message}`);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) as unknown : {};
}

async function request(path: string, init: RequestInit = {}, authMode: RequestAuthMode = "session"): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(authMode === "session" && sessionCookie ? { cookie: sessionCookie } : {}),
      ...(authMode === "apiKey" && API_KEY ? { "x-api-key": API_KEY } : {}),
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

async function validateGoodCard(agentCard: AgentCard = sampleAgentCard, authMode: RequestAuthMode = "session"): Promise<void> {
  const { response, body } = await request("/agent-cards/validate", {
    method: "POST",
    body: JSON.stringify({ agentCard })
  }, authMode);
  requireStatus(response, body, 200, "validate good Agent Card");

  const result = asRecord(body);
  if (result.valid !== true) {
    throw new Error(`valid Agent Card was not accepted: ${JSON.stringify(body)}`);
  }

  logOk("validated good Agent Card");
}

async function importGoodCard(agentCard: AgentCard = sampleAgentCard, authMode: RequestAuthMode = "session"): Promise<void> {
  const { response, body } = await request("/agent-cards/import", {
    method: "POST",
    body: JSON.stringify({ agentCard })
  }, authMode);
  requireStatus(response, body, 200, "import good Agent Card");

  const result = asRecord(body);
  if (result.imported !== true) {
    throw new Error(`Agent Card import response did not confirm import: ${JSON.stringify(body)}`);
  }

  logOk("imported good Agent Card");
}

async function listAgentCards(authMode: RequestAuthMode = "session"): Promise<AgentCard[]> {
  const { response, body } = await request("/agent-cards", {}, authMode);
  requireStatus(response, body, 200, "list imported Agent Cards");

  const result = asRecord(body);
  if (!Array.isArray(result.agentCards)) {
    throw new Error(`GET /agent-cards did not return agentCards array: ${JSON.stringify(body)}`);
  }

  return result.agentCards as AgentCard[];
}

async function verifyImportedCardAppears(agentCard: AgentCard = sampleAgentCard, authMode: RequestAuthMode = "session"): Promise<void> {
  const cards = await listAgentCards(authMode);
  if (!cards.some((card) => card.agentId === agentCard.agentId)) {
    throw new Error("imported Agent Card did not appear in GET /agent-cards");
  }

  logOk("imported Agent Card appears in session registry");
}

async function deleteImportedCard(agentCard: AgentCard = sampleAgentCard, authMode: RequestAuthMode = "session"): Promise<void> {
  const { response, body } = await request(`/agent-cards/${encodeURIComponent(agentCard.agentId)}`, {
    method: "DELETE"
  }, authMode);
  requireStatus(response, body, 200, "delete imported Agent Card");

  const result = asRecord(body);
  if (result.deleted !== true || result.agentId !== agentCard.agentId) {
    throw new Error(`delete response did not confirm deletion: ${JSON.stringify(body)}`);
  }

  logOk("deleted imported Agent Card");
}

async function verifyImportedCardGone(agentCard: AgentCard = sampleAgentCard, authMode: RequestAuthMode = "session"): Promise<void> {
  const cards = await listAgentCards(authMode);
  if (cards.some((card) => card.agentId === agentCard.agentId)) {
    throw new Error("deleted Agent Card still appears in GET /agent-cards");
  }

  logOk("deleted Agent Card is gone from session registry");
}

async function validateBadCard(label: string, agentCard: unknown): Promise<void> {
  const { response, body } = await request("/agent-cards/validate", {
    method: "POST",
    body: JSON.stringify({ agentCard })
  });
  requireStatus(response, body, 400, `validate bad Agent Card (${label})`);

  const result = asRecord(body);
  if (result.valid !== false || result.error !== "invalid_agent_card") {
    throw new Error(`bad Agent Card (${label}) was not rejected correctly: ${JSON.stringify(body)}`);
  }

  logOk(`rejected bad Agent Card: ${label}`);
}

async function verifyApiKeyRegistryMode(): Promise<void> {
  if (!API_KEY) {
    logOk("skipped API-key registry verification because ORCHESTRATOR_API_KEY is not configured");
    return;
  }

  const apiKeyAgentCard: AgentCard = {
    ...sampleAgentCard,
    agentId: "external-api-key-registry-agent",
    name: "API Key Registry Agent",
    auth: {
      ...sampleAgentCard.auth,
      audience: "external-api-key-registry-agent"
    },
    skills: sampleAgentCard.skills.map((skill) => ({
      ...skill,
      id: "api-key-registry-diagnose"
    }))
  };

  await validateGoodCard(apiKeyAgentCard, "apiKey");
  await importGoodCard(apiKeyAgentCard, "apiKey");
  await verifyImportedCardAppears(apiKeyAgentCard, "apiKey");
  await deleteImportedCard(apiKeyAgentCard, "apiKey");
  await verifyImportedCardGone(apiKeyAgentCard, "apiKey");
  logOk("verified API-key scoped Agent Card registry");
}

async function main(): Promise<void> {
  console.info(`Verifying Agent Card paste import against ${API_URL}`);

  await createSession();
  await validateGoodCard();
  await importGoodCard();
  await verifyImportedCardAppears();
  await deleteImportedCard();
  await verifyImportedCardGone();

  await validateBadCard("invalid endpoint scheme", {
    ...sampleAgentCard,
    agentId: "bad-file-endpoint-agent",
    endpoint: "file:///tmp/agent"
  });
  await validateBadCard("raw secret field", {
    ...sampleAgentCard,
    agentId: "bad-secret-agent",
    clientSecret: "must-not-be-pasted"
  });
  await validateBadCard("missing skills", {
    ...sampleAgentCard,
    agentId: "bad-missing-skills-agent",
    skills: undefined
  });
  await verifyApiKeyRegistryMode();

  console.info("Agent Card import verification passed.");
}

main().catch((error) => {
  console.error(`fail - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
