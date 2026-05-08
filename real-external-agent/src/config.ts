export const agentId = "external-jira-agent";
export const clientId = "jira-agent-client";
export const requestedScopes = ["read:jira-work", "read:jira-user"];
export const agentDeclaredCapabilities = [
  "jira.issue.diagnose_creation_failure",
  "jira.permission.inspect",
  "jira.issue.create"
];
export const tokenEndpointAuthMethod = "private_key_jwt";

export function env(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

export function port(): number {
  const parsed = Number(process.env.PORT ?? 4201);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 4201;
}

export function agentIssuer(): string {
  return env("AGENT_ISSUER", "http://localhost:4201").replace(/\/+$/, "");
}

export function mockIdpJwksUri(): string {
  return env("MOCK_IDP_JWKS_URI", "http://localhost:4110/.well-known/jwks.json");
}

export function expectedAudience(): string {
  return env("EXPECTED_AUDIENCE", agentId);
}
