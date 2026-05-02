import dotenv from "dotenv";
import type { OAuthClientAuthMethod } from "@a2a/shared";

dotenv.config({ path: new URL("../../.env", import.meta.url) });
dotenv.config({ path: new URL("../../../orchestrator-api/.env", import.meta.url), quiet: true });

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

const orchestratorAllowedAuthMethods = parseAllowedAuthMethods();
const orchestratorPrivateKeyJwtEnabled = process.env.ORCHESTRATOR_PRIVATE_KEY_JWT_ENABLED === "true";
const orchestratorPublicJwkJson = process.env.ORCHESTRATOR_PUBLIC_JWK_JSON;

function validatePrivateKeyJwtRegistration(): void {
  if (!orchestratorPrivateKeyJwtEnabled || !orchestratorAllowedAuthMethods.includes("private_key_jwt")) {
    return;
  }

  if (!orchestratorPublicJwkJson?.trim()) {
    throw new Error("[mock-idp] ORCHESTRATOR_PUBLIC_JWK_JSON is required when ORCHESTRATOR_PRIVATE_KEY_JWT_ENABLED=true and private_key_jwt is allowed.");
  }

  try {
    const parsed = JSON.parse(orchestratorPublicJwkJson) as { kty?: unknown };
    if (!parsed || typeof parsed !== "object" || typeof parsed.kty !== "string") {
      throw new Error("JWK must be a JSON object with kty.");
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`[mock-idp] ORCHESTRATOR_PUBLIC_JWK_JSON is invalid: ${detail}`);
  }
}

validatePrivateKeyJwtRegistration();

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
    allowedAuthMethods: orchestratorAllowedAuthMethods,
    privateKeyJwt: {
      enabled: orchestratorPrivateKeyJwtEnabled,
      expectedAudience:
        process.env.ORCHESTRATOR_PRIVATE_KEY_JWT_AUDIENCE ??
        `${process.env.A2A_ISSUER ?? "http://localhost:4110"}/oauth/token`,
      // The Mock IdP stores only the orchestrator public key, never the private key.
      publicJwkJson: orchestratorPublicJwkJson
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
