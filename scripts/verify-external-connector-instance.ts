const baseUrl = process.env.EXTERNAL_AGENT_URL;
const expectedConnectorId = process.env.EXPECTED_CONNECTOR_ID;
const expectedResourceSystem = process.env.EXPECTED_RESOURCE_SYSTEM;
const expectedAgentId = process.env.EXPECTED_AGENT_ID;

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoSecretMarkers(value: unknown): void {
  const text = JSON.stringify(value);
  const forbidden = [/client_secret/i, /"private_key"\s*:/i, /access_token/i, /refresh_token/i, /Authorization/, /Bearer/];
  const found = forbidden.find((pattern) => pattern.test(text));
  if (found) {
    throw new Error(`response exposed forbidden marker ${found}`);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json() as T;
  assertCondition(response.ok, `${url} returned HTTP ${response.status}: ${JSON.stringify(body)}`);
  assertNoSecretMarkers(body);
  return body;
}

async function main(): Promise<void> {
  const url = required("EXTERNAL_AGENT_URL", baseUrl).replace(/\/+$/, "");
  const connectorId = required("EXPECTED_CONNECTOR_ID", expectedConnectorId);
  const resourceSystem = required("EXPECTED_RESOURCE_SYSTEM", expectedResourceSystem);
  const agentId = required("EXPECTED_AGENT_ID", expectedAgentId);

  const discovery = await getJson<{
    agentId: string;
    connectorId: string;
    resourceSystem: string;
    connectorProfileUrl: string;
  }>(`${url}/.well-known/a2a-agent.json`);
  assertCondition(discovery.agentId === agentId, "discovery agentId mismatch");
  assertCondition(discovery.connectorId === connectorId, "discovery connectorId mismatch");
  assertCondition(discovery.resourceSystem === resourceSystem, "discovery resourceSystem mismatch");

  const profile = await getJson<{
    connectorId: string;
    resourceSystem: string;
    skillCatalog?: unknown[];
    actionCatalog?: unknown[];
    demoDefaults?: unknown;
  }>(discovery.connectorProfileUrl);
  assertCondition(profile.connectorId === connectorId, "connector profile connectorId mismatch");
  assertCondition(profile.resourceSystem === resourceSystem, "connector profile resourceSystem mismatch");
  assertCondition(Array.isArray(profile.skillCatalog ?? profile.actionCatalog), "connector profile missing skill/action catalog");
  assertCondition(typeof profile.demoDefaults === "object" && profile.demoDefaults !== null, "connector profile missing demo defaults");

  console.log(`External connector instance verification passed for ${connectorId}.`);
}

main().catch((error) => {
  console.error(`fail - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
