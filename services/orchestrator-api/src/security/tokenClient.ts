import type { A2ATokenResponse, A2AAuthMode } from "@a2a/shared";

export type A2ATokenRequestInput = {
  audience: string;
  scope: string;
  delegatedBy?: string;
  delegationDepth?: number;
  parentTaskId?: string;
  requestedByAgent?: string;
};

export type A2AIssuedTokenMetadata = {
  authMode: Extract<A2AAuthMode, "oauth2_client_credentials_jwt">;
  issuer: string;
  audience: string;
  scope: string;
  tokenIssued: boolean;
  expiresIn?: number;
  delegatedBy?: string;
  delegationDepth?: number;
  parentTaskId?: string;
  requestedByAgent?: string;
};

type CachedToken = {
  accessToken: string;
  metadata: A2AIssuedTokenMetadata;
  expiresAtMs: number;
};

const tokenCache = new Map<string, CachedToken>();

function tokenCacheKey(input: A2ATokenRequestInput): string {
  return [
    input.audience,
    input.scope,
    input.delegatedBy ?? "",
    input.delegationDepth ?? 0,
    input.parentTaskId ?? "",
    input.requestedByAgent ?? ""
  ].join(":");
}

export async function getA2AAccessToken(input: A2ATokenRequestInput): Promise<{ accessToken: string; metadata: A2AIssuedTokenMetadata }> {
  const idpUrl = process.env.A2A_IDP_URL ?? "http://localhost:4110";
  const issuer = process.env.A2A_ISSUER ?? idpUrl;
  const clientId = process.env.ORCHESTRATOR_CLIENT_ID ?? "servicenow-orchestrator-agent";
  const clientSecret = process.env.ORCHESTRATOR_CLIENT_SECRET ?? "dev-secret";
  const cacheKey = tokenCacheKey(input);
  const cached = tokenCache.get(cacheKey);

  if (cached && cached.expiresAtMs > Date.now()) {
    return {
      accessToken: cached.accessToken,
      metadata: cached.metadata
    };
  }

  const response = await fetch(`${idpUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      audience: input.audience,
      scope: input.scope,
      delegated_by: input.delegatedBy,
      delegation_depth: input.delegationDepth,
      parent_task_id: input.parentTaskId,
      requested_by_agent: input.requestedByAgent
    })
  });
  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(`Token request failed for audience=${input.audience} scope=${input.scope}: ${response.status} ${responseBody}`);
  }

  const token = JSON.parse(responseBody) as A2ATokenResponse;
  const metadata: A2AIssuedTokenMetadata = {
    authMode: "oauth2_client_credentials_jwt",
    issuer,
    audience: input.audience,
    scope: input.scope,
    tokenIssued: true,
    expiresIn: token.expires_in,
    delegatedBy: input.delegatedBy,
    delegationDepth: input.delegationDepth,
    parentTaskId: input.parentTaskId,
    requestedByAgent: input.requestedByAgent
  };

  if (token.expires_in > 30) {
    tokenCache.set(cacheKey, {
      accessToken: token.access_token,
      metadata,
      expiresAtMs: Date.now() + (token.expires_in - 30) * 1000
    });
  }

  return {
    accessToken: token.access_token,
    metadata
  };
}
