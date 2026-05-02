import { randomUUID } from "node:crypto";
import { importJWK, SignJWT, type JWK, type KeyLike } from "jose";
import type { A2ATokenResponse, A2AAuthMode, OAuthClientAuthMethod } from "@a2a/shared";

export type A2ATokenRequestInput = {
  audience: string;
  scope: string;
  delegatedBy?: string;
  delegationDepth?: number;
  parentTaskId?: string;
  requestedByAgent?: string;
  tokenAuthMethod?: OAuthClientAuthMethod;
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
  tokenAuthMethod?: OAuthClientAuthMethod;
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
    input.requestedByAgent ?? "",
    input.tokenAuthMethod ?? resolveTokenAuthMethod()
  ].join(":");
}

const jwtBearerAssertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const privateKeyCache = new Map<string, KeyLike | Uint8Array>();

function resolveTokenAuthMethod(): OAuthClientAuthMethod {
  const configured = process.env.ORCHESTRATOR_TOKEN_AUTH_METHOD;
  if (configured === "private_key_jwt" || configured === "client_secret_post") {
    return configured;
  }

  return process.env.ORCHESTRATOR_PRIVATE_JWK_JSON ? "private_key_jwt" : "client_secret_post";
}

async function createClientAssertion(params: {
  idpUrl: string;
  clientId: string;
}): Promise<string> {
  const privateJwkJson = process.env.ORCHESTRATOR_PRIVATE_JWK_JSON;
  if (!privateJwkJson) {
    throw new Error("ORCHESTRATOR_PRIVATE_JWK_JSON is required for private_key_jwt token authentication.");
  }

  let key: KeyLike | Uint8Array | undefined = privateKeyCache.get(privateJwkJson);
  if (!key) {
    const privateJwk = JSON.parse(privateJwkJson) as JWK;
    key = await importJWK(privateJwk, "RS256");
    privateKeyCache.set(privateJwkJson, key);
  }

  const now = Math.floor(Date.now() / 1000);
  const audience = process.env.ORCHESTRATOR_PRIVATE_KEY_JWT_AUDIENCE ?? `${params.idpUrl}/oauth/token`;

  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(params.clientId)
    .setSubject(params.clientId)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setJti(randomUUID())
    .sign(key);
}

async function buildTokenRequestBody(params: {
  input: A2ATokenRequestInput;
  idpUrl: string;
  clientId: string;
  clientSecret: string;
  tokenAuthMethod: OAuthClientAuthMethod;
}): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    grant_type: "client_credentials",
    client_id: params.clientId,
    audience: params.input.audience,
    scope: params.input.scope,
    delegated_by: params.input.delegatedBy,
    delegation_depth: params.input.delegationDepth,
    parent_task_id: params.input.parentTaskId,
    requested_by_agent: params.input.requestedByAgent
  };

  if (params.tokenAuthMethod === "private_key_jwt") {
    body.client_assertion_type = jwtBearerAssertionType;
    body.client_assertion = await createClientAssertion({
      idpUrl: params.idpUrl,
      clientId: params.clientId
    });
    return body;
  }

  body.client_secret = params.clientSecret;
  return body;
}

export async function getA2AAccessToken(input: A2ATokenRequestInput): Promise<{ accessToken: string; metadata: A2AIssuedTokenMetadata }> {
  const idpUrl = process.env.A2A_IDP_URL ?? "http://localhost:4110";
  const issuer = process.env.A2A_ISSUER ?? idpUrl;
  const clientId = process.env.ORCHESTRATOR_CLIENT_ID ?? "servicenow-orchestrator-agent";
  const clientSecret = process.env.ORCHESTRATOR_CLIENT_SECRET ?? "dev-secret";
  const tokenAuthMethod = input.tokenAuthMethod ?? resolveTokenAuthMethod();
  const cacheKey = tokenCacheKey({ ...input, tokenAuthMethod });
  const cached = tokenCache.get(cacheKey);

  if (cached && cached.expiresAtMs > Date.now()) {
    return {
      accessToken: cached.accessToken,
      metadata: cached.metadata
    };
  }

  const body = await buildTokenRequestBody({
    input,
    idpUrl,
    clientId,
    clientSecret,
    tokenAuthMethod
  });

  const response = await fetch(`${idpUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
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
    requestedByAgent: input.requestedByAgent,
    tokenAuthMethod
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
