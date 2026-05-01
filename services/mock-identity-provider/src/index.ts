import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { exportJWK, generateKeyPair, calculateJwkThumbprint, SignJWT, type JWK, type KeyLike } from "jose";
import type { A2ATokenClaims, A2ATokenResponse } from "@a2a/shared";
import { readJsonBody, sendJson, startJsonServer } from "@a2a/shared/src/http";

dotenv.config({ path: new URL("../.env", import.meta.url) });

const port = Number(process.env.PORT ?? 4110);
const issuer = process.env.A2A_ISSUER ?? "http://localhost:4110";
const tokenTtlSeconds = Number(process.env.A2A_TOKEN_TTL_SECONDS ?? 300);

const deniedScopes = new Set([
  "security.token.inspect",
  "security.secret.reveal",
  "access.permission.grant"
]);

const clients = new Map([
  [
    "servicenow-orchestrator-agent",
    {
      clientSecret: process.env.ORCHESTRATOR_CLIENT_SECRET ?? "dev-secret",
      allowedScopes: new Set([
        "enterprise.triage",
        "jira.diagnose",
        "github.diagnose",
        "github.rate_limit.read",
        "pagerduty.diagnose",
        "security.scope.compare",
        "apihealth.read"
      ])
    }
  ]
]);

type TokenRequest = {
  grant_type?: string;
  client_id?: string;
  client_secret?: string;
  audience?: string;
  scope?: string;
};

type SigningKey = {
  privateKey: KeyLike;
  publicJwk: JWK;
  kid: string;
};

let signingKey: SigningKey;

async function createSigningKey(): Promise<SigningKey> {
  // This is a local demo key. Production would use persisted signing keys and rotation.
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  return {
    privateKey,
    publicJwk: {
      ...publicJwk,
      kid,
      alg: "RS256",
      use: "sig"
    },
    kid
  };
}

function parseScopes(scope: string): string[] {
  return scope.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function validateTokenRequest(body: TokenRequest): { ok: true; scopes: string[] } | { ok: false; status: number; error: string } {
  if (body.grant_type !== "client_credentials") {
    return { ok: false, status: 400, error: "unsupported_grant_type" };
  }

  if (!body.client_id || !body.client_secret) {
    return { ok: false, status: 401, error: "invalid_client" };
  }

  const client = clients.get(body.client_id);
  if (!client || client.clientSecret !== body.client_secret) {
    return { ok: false, status: 401, error: "invalid_client" };
  }

  if (!body.audience || !body.scope) {
    return { ok: false, status: 400, error: "missing_audience_or_scope" };
  }

  const scopes = parseScopes(body.scope);
  if (scopes.length === 0) {
    return { ok: false, status: 400, error: "missing_audience_or_scope" };
  }

  const denied = scopes.find((scope) => deniedScopes.has(scope));
  if (denied) {
    return { ok: false, status: 403, error: `scope_denied: ${denied}` };
  }

  const unsupported = scopes.find((scope) => !client.allowedScopes.has(scope));
  if (unsupported) {
    return { ok: false, status: 403, error: `scope_not_allowed: ${unsupported}` };
  }

  return { ok: true, scopes };
}

async function issueToken(body: Required<Pick<TokenRequest, "client_id" | "audience" | "scope">>, scopes: string[]): Promise<A2ATokenResponse> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + tokenTtlSeconds;
  const claims: A2ATokenClaims = {
    iss: issuer,
    sub: body.client_id,
    aud: body.audience,
    scope: scopes.join(" "),
    scp: scopes,
    iat: now,
    exp: expiresAt,
    jti: randomUUID(),
    client_id: body.client_id
  };

  const accessToken = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "RS256", kid: signingKey.kid, typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setIssuer(issuer)
    .setSubject(body.client_id)
    .setAudience(body.audience)
    .setJti(claims.jti)
    .sign(signingKey.privateKey);

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: tokenTtlSeconds,
    scope: scopes.join(" ")
  };
}

async function handleToken(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<TokenRequest>(request);
  const validation = validateTokenRequest(body);

  if (!validation.ok) {
    sendJson(response, validation.status, { error: validation.error }, request);
    return;
  }

  sendJson(
    response,
    200,
    await issueToken(
      {
        client_id: body.client_id as string,
        audience: body.audience as string,
        scope: body.scope as string
      },
      validation.scopes
    ),
    request
  );
}

async function start(): Promise<void> {
  signingKey = await createSigningKey();

  startJsonServer(port, async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { status: "ok", service: "mock-identity-provider" }, request);
      return;
    }

    if (request.method === "GET" && request.url === "/.well-known/jwks.json") {
      sendJson(response, 200, { keys: [signingKey.publicJwk] }, request);
      return;
    }

    if (request.method === "POST" && request.url === "/oauth/token") {
      await handleToken(request, response);
      return;
    }

    sendJson(response, 404, { error: "not_found" }, request);
  });
}

void start();
