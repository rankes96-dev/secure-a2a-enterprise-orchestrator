import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { importJWK, SignJWT, type JWK, type KeyLike } from "jose";
import { scopesFromClaims, verifyA2AToken } from "@a2a/shared";
import type { A2ATokenResponse, OAuthClientAuthMethod } from "@a2a/shared";

dotenv.config({ path: new URL("../services/orchestrator-api/.env", import.meta.url), quiet: true });

const jwtBearerAssertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const audience = "jira-agent";
const scope = "jira.diagnose";
const issuer = process.env.A2A_ISSUER ?? "http://localhost:4110";
const idpUrl = process.env.A2A_IDP_URL ?? issuer;
const jwksUri = process.env.A2A_JWKS_URI ?? `${issuer}/.well-known/jwks.json`;
const clientId = process.env.ORCHESTRATOR_CLIENT_ID ?? "servicenow-orchestrator-agent";
const privateKeyCache = new Map<string, KeyLike | Uint8Array>();

function isTokenAuthMethod(value: string | undefined): value is OAuthClientAuthMethod {
  return value === "private_key_jwt" || value === "client_secret_post";
}

function resolveTokenAuthMethod(): OAuthClientAuthMethod {
  if (isTokenAuthMethod(process.env.VERIFY_A2A_TOKEN_AUTH_METHOD)) {
    return process.env.VERIFY_A2A_TOKEN_AUTH_METHOD;
  }

  if (isTokenAuthMethod(process.env.ORCHESTRATOR_TOKEN_AUTH_METHOD)) {
    return process.env.ORCHESTRATOR_TOKEN_AUTH_METHOD;
  }

  return process.env.ORCHESTRATOR_PRIVATE_JWK_JSON ? "private_key_jwt" : "client_secret_post";
}

async function createClientAssertion(): Promise<string> {
  const privateJwkJson = process.env.ORCHESTRATOR_PRIVATE_JWK_JSON;
  if (!privateJwkJson) {
    throw new Error("ORCHESTRATOR_PRIVATE_JWK_JSON is required when VERIFY_A2A_TOKEN_AUTH_METHOD=private_key_jwt.");
  }

  let key = privateKeyCache.get(privateJwkJson);
  if (!key) {
    key = await importJWK(JSON.parse(privateJwkJson) as JWK, "RS256");
    privateKeyCache.set(privateJwkJson, key);
  }

  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(clientId)
    .setSubject(clientId)
    .setAudience(process.env.ORCHESTRATOR_PRIVATE_KEY_JWT_AUDIENCE ?? `${idpUrl}/oauth/token`)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setJti(randomUUID())
    .sign(key);
}

async function buildTokenRequestBody(authMethod: OAuthClientAuthMethod): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    grant_type: "client_credentials",
    client_id: clientId,
    audience,
    scope
  };

  if (authMethod === "private_key_jwt") {
    body.client_assertion_type = jwtBearerAssertionType;
    body.client_assertion = await createClientAssertion();
    return body;
  }

  body.client_secret = process.env.ORCHESTRATOR_CLIENT_SECRET ?? "dev-secret";
  return body;
}

async function postToken(body: Record<string, unknown>): Promise<{ status: number; body: unknown; rawBody: string }> {
  const response = await fetch(`${idpUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const rawBody = await response.text();
  const parsedBody = rawBody ? JSON.parse(rawBody) as unknown : {};

  return {
    status: response.status,
    body: parsedBody,
    rawBody
  };
}

async function requestToken(authMethod: OAuthClientAuthMethod): Promise<A2ATokenResponse> {
  const response = await postToken(await buildTokenRequestBody(authMethod));

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Token request failed with ${response.status}: ${response.rawBody}. ` +
        "For private_key_jwt, confirm Mock IdP has ORCHESTRATOR_PRIVATE_KEY_JWT_ENABLED=true and matching ORCHESTRATOR_PUBLIC_JWK_JSON."
    );
  }

  return response.body as A2ATokenResponse;
}

async function verifyReplayProtection(authMethod: OAuthClientAuthMethod): Promise<
  | { tested: true; firstRequestStatus: number; secondRequestStatus: number; secondRequestError?: string }
  | { tested: false; reason: string }
> {
  if (authMethod !== "private_key_jwt") {
    return { tested: false, reason: "private_key_jwt not selected" };
  }

  const body = await buildTokenRequestBody(authMethod);
  const first = await postToken(body);
  const second = await postToken(body);
  const secondBody = second.body as { error?: string };

  return {
    tested: true,
    firstRequestStatus: first.status,
    secondRequestStatus: second.status,
    secondRequestError: secondBody.error
  };
}

async function main(): Promise<void> {
  const authMethod = resolveTokenAuthMethod();
  const replayProtection = await verifyReplayProtection(authMethod);
  const token = await requestToken(authMethod);
  const authorizationHeader = `${token.token_type} ${token.access_token}`;
  const valid = await verifyA2AToken({
    authorizationHeader,
    expectedIssuer: issuer,
    expectedAudience: audience,
    requiredScope: scope,
    jwksUri
  });
  const wrongAudience = await verifyA2AToken({
    authorizationHeader,
    expectedIssuer: issuer,
    expectedAudience: "github-agent",
    requiredScope: scope,
    jwksUri
  });
  const missingScope = await verifyA2AToken({
    authorizationHeader,
    expectedIssuer: issuer,
    expectedAudience: audience,
    requiredScope: "github.diagnose",
    jwksUri
  });
  const missingHeader = await verifyA2AToken({
    expectedIssuer: issuer,
    expectedAudience: audience,
    requiredScope: scope,
    jwksUri
  });
  const invalidBearer = await verifyA2AToken({
    authorizationHeader: "Bearer not-a-jwt",
    expectedIssuer: issuer,
    expectedAudience: audience,
    requiredScope: scope,
    jwksUri
  });

  console.log(
    JSON.stringify(
      {
        tokenRequest: {
          authMethod,
          issuer,
          jwksUri,
          audience,
          scope
        },
        replayProtection,
        valid: {
          valid: valid.valid,
          reason: valid.reason,
          claims: valid.claims
            ? {
                iss: valid.claims.iss,
                sub: valid.claims.sub,
                aud: valid.claims.aud,
                scope: valid.claims.scope,
                scopes: scopesFromClaims(valid.claims),
                exp: valid.claims.exp,
                iat: valid.claims.iat,
                jti: valid.claims.jti,
                client_id: valid.claims.client_id
              }
            : undefined
        },
        wrongAudience: {
          valid: wrongAudience.valid,
          reason: wrongAudience.reason
        },
        missingScope: {
          valid: missingScope.valid,
          reason: missingScope.reason,
          scopes: missingScope.claims ? scopesFromClaims(missingScope.claims) : undefined
        },
        missingHeader,
        invalidBearer: {
          valid: invalidBearer.valid,
          reason: invalidBearer.reason
        }
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "A2A token verification script failed");
  process.exitCode = 1;
});
