import dotenv from "dotenv";
import type { OAuthClientAuthMethod } from "@a2a/shared";

dotenv.config({ path: new URL("../../.env", import.meta.url) });

export type { OAuthClientAuthMethod };

export type OAuthApplicationPrivateKeyJwtConfig = {
  enabled: boolean;
  expectedAudience: string;
  publicJwkJson?: string;
};

export type OAuthApplicationRegistration = {
  clientId: string;
  clientSecret?: string;
  displayName: string;
  ownerAgentId: string;
  scopePolicy: "agent_card_registry";
  tokenTtlSeconds?: number;
  allowedAuthMethods: OAuthClientAuthMethod[];
  privateKeyJwt?: OAuthApplicationPrivateKeyJwtConfig;
};

export const sensitiveScopesNeverIssuedByMockIdp = [
  "security.token.inspect",
  "security.secret.reveal",
  "access.permission.grant"
] as const;

const supportedAuthMethods = new Set<OAuthClientAuthMethod>(["private_key_jwt", "client_secret_post"]);

function parseAllowedAuthMethods(): OAuthClientAuthMethod[] {
  const configured = process.env.ORCHESTRATOR_ALLOWED_AUTH_METHODS ?? "private_key_jwt,client_secret_post";
  const methods = configured
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is OAuthClientAuthMethod => supportedAuthMethods.has(item as OAuthClientAuthMethod));

  return methods.length > 0 ? methods : ["client_secret_post"];
}

export const oauthApplications: OAuthApplicationRegistration[] = [
  {
    clientId: "servicenow-orchestrator-agent",
    // private_key_jwt is preferred for enterprise-style client authentication.
    // client_secret_post remains available as a local fallback only.
    clientSecret: process.env.ORCHESTRATOR_CLIENT_SECRET ?? "dev-secret",
    displayName: "ServiceNow Orchestrator Agent",
    ownerAgentId: "servicenow-orchestrator-agent",
    scopePolicy: "agent_card_registry",
    tokenTtlSeconds: Number(process.env.A2A_TOKEN_TTL_SECONDS ?? 300),
    allowedAuthMethods: parseAllowedAuthMethods(),
    privateKeyJwt: {
      enabled: process.env.ORCHESTRATOR_PRIVATE_KEY_JWT_ENABLED === "true",
      expectedAudience:
        process.env.ORCHESTRATOR_PRIVATE_KEY_JWT_AUDIENCE ??
        `${process.env.A2A_ISSUER ?? "http://localhost:4110"}/oauth/token`,
      // The Mock IdP stores only the orchestrator public key, never the private key.
      publicJwkJson: process.env.ORCHESTRATOR_PUBLIC_JWK_JSON
    }
  }
];

// This models OAuth Application / OAuth Client registration for the local demo.
// The client is registered once, while allowed audiences/scopes are derived from
// the Agent Card Registry. In a future production design, Agent Cards may be
// created through the Agent Builder UI and persisted in a database/registry.
export function getOAuthApplication(clientId: string): OAuthApplicationRegistration | undefined {
  return oauthApplications.find((application) => application.clientId === clientId);
}
