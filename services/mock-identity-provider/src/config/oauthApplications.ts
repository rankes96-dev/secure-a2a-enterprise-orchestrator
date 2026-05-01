export type OAuthApplicationRegistration = {
  clientId: string;
  clientSecret: string;
  displayName: string;
  ownerAgentId: string;
  scopePolicy: "agent_card_registry";
  tokenTtlSeconds?: number;
};

export const sensitiveScopesNeverIssuedByMockIdp = [
  "security.token.inspect",
  "security.secret.reveal",
  "access.permission.grant"
] as const;

export const oauthApplications: OAuthApplicationRegistration[] = [
  {
    clientId: "servicenow-orchestrator-agent",
    clientSecret: process.env.ORCHESTRATOR_CLIENT_SECRET ?? "dev-secret",
    displayName: "ServiceNow Orchestrator Agent",
    ownerAgentId: "servicenow-orchestrator-agent",
    scopePolicy: "agent_card_registry",
    tokenTtlSeconds: Number(process.env.A2A_TOKEN_TTL_SECONDS ?? 300)
  }
];

// This models OAuth Application / OAuth Client registration for the local demo.
// The client is registered once, while allowed audiences/scopes are derived from
// the Agent Card Registry. In a future production design, Agent Cards may be
// created through the Agent Builder UI and persisted in a database/registry.
export function getOAuthApplication(clientId: string): OAuthApplicationRegistration | undefined {
  return oauthApplications.find((application) => application.clientId === clientId);
}
