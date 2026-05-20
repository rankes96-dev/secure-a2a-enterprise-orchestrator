export function env(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

export function port(): number {
  const parsed = Number(process.env.PORT ?? process.env.EXTERNAL_AGENT_PORT ?? 4201);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 4201;
}

export const selectedConnectorId = env("EXTERNAL_CONNECTOR_ID", "jira-reference");
export const agentId = env("EXTERNAL_AGENT_ID", "external-jira-agent");
export const clientId = env("EXTERNAL_AGENT_CLIENT_ID", "jira-agent-client");
export const tokenEndpointAuthMethod = "private_key_jwt";

export function agentIssuer(): string {
  return env("AGENT_ISSUER", `http://localhost:${port()}`).replace(/\/+$/, "");
}

export function mockIdpJwksUri(): string {
  return env("MOCK_IDP_JWKS_URI", "http://localhost:4110/.well-known/jwks.json");
}

export function mockIdpIssuer(): string {
  return env("MOCK_IDP_ISSUER", "http://localhost:4110").replace(/\/+$/, "");
}

export function expectedAudience(): string {
  return env("EXPECTED_AUDIENCE", agentId);
}

export function trustedGatewayIssuer(): string {
  return env("TRUSTED_GATEWAY_ISSUER", "http://localhost:4000").replace(/\/+$/, "");
}

export function trustedGatewayClientId(): string {
  return env("TRUSTED_GATEWAY_CLIENT_ID", "secure-a2a-gateway-client");
}

export function trustedGatewayJwksUri(): string {
  return env("TRUSTED_GATEWAY_JWKS_URI", `${trustedGatewayIssuer()}/.well-known/jwks.json`);
}
