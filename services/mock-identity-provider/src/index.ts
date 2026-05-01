import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { exportJWK, generateKeyPair, calculateJwkThumbprint, SignJWT, type JWK, type KeyLike } from "jose";
import type { A2ATokenClaims, A2ATokenResponse } from "@a2a/shared";
import { readJsonBody, sendJson, startJsonServer } from "@a2a/shared/src/http";
import { StaticAgentCardRegistry } from "../../orchestrator-api/src/agentCardRegistry";
import { buildDiscoveredA2AResourceRegistry, type DiscoveredA2AResourceRegistry } from "./agentCardScopeRegistry";
import { getOAuthApplication, oauthApplications, sensitiveScopesNeverIssuedByMockIdp, type OAuthApplicationRegistration } from "./config/oauthApplications";

dotenv.config({ path: new URL("../.env", import.meta.url) });

const port = Number(process.env.PORT ?? 4110);
const issuer = process.env.A2A_ISSUER ?? "http://localhost:4110";
const deniedScopes = new Set<string>(sensitiveScopesNeverIssuedByMockIdp);
const agentCardRegistry = new StaticAgentCardRegistry();

type TokenRequest = {
  grant_type?: string;
  client_id?: string;
  client_secret?: string;
  audience?: string;
  scope?: string;
  delegated_by?: string;
  delegation_depth?: number;
  parent_task_id?: string;
  requested_by_agent?: string;
};

type SigningKey = {
  privateKey: KeyLike;
  publicJwk: JWK;
  kid: string;
};

let signingKey: SigningKey;
let resourceRegistry: DiscoveredA2AResourceRegistry;

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

function validateTokenRequest(body: TokenRequest): { ok: true; application: OAuthApplicationRegistration; scopes: string[] } | { ok: false; status: number; error: string } {
  if (body.grant_type !== "client_credentials") {
    return { ok: false, status: 400, error: "unsupported_grant_type" };
  }

  if (!body.client_id || !body.client_secret) {
    return { ok: false, status: 401, error: "invalid_client" };
  }

  const application = getOAuthApplication(body.client_id);
  if (!application || application.clientSecret !== body.client_secret) {
    return { ok: false, status: 401, error: "invalid_client" };
  }

  if (!body.audience || !body.scope) {
    return { ok: false, status: 400, error: "missing_audience_or_scope" };
  }

  const delegationValidation = validateDelegationContext(body);
  if (!delegationValidation.ok) {
    return delegationValidation;
  }

  const scopes = parseScopes(body.scope);
  if (scopes.length === 0) {
    return { ok: false, status: 400, error: "missing_audience_or_scope" };
  }

  if (!resourceRegistry.audiences.has(body.audience)) {
    return { ok: false, status: 403, error: `audience_not_allowed: ${body.audience}` };
  }

  const denied = scopes.find((scope) => deniedScopes.has(scope));
  if (denied) {
    return { ok: false, status: 403, error: `scope_denied: ${denied}` };
  }

  const unsupported = scopes.find((scope) => !resourceRegistry.scopes.has(scope));
  if (unsupported) {
    return { ok: false, status: 403, error: `scope_not_allowed: ${unsupported}` };
  }

  return { ok: true, application, scopes };
}

function validateDelegationContext(body: TokenRequest): { ok: true } | { ok: false; status: 400; error: string } {
  if (body.delegated_by !== undefined && typeof body.delegated_by !== "string") {
    return { ok: false, status: 400, error: "invalid_delegation_context" };
  }

  if (body.parent_task_id !== undefined && typeof body.parent_task_id !== "string") {
    return { ok: false, status: 400, error: "invalid_delegation_context" };
  }

  if (body.requested_by_agent !== undefined && typeof body.requested_by_agent !== "string") {
    return { ok: false, status: 400, error: "invalid_delegation_context" };
  }

  if (body.delegation_depth !== undefined) {
    if (typeof body.delegation_depth !== "number" || !Number.isInteger(body.delegation_depth)) {
      return { ok: false, status: 400, error: "invalid_delegation_context" };
    }

    if (body.delegation_depth < 0 || body.delegation_depth > 1) {
      return { ok: false, status: 400, error: "invalid_delegation_context" };
    }
  }

  if (body.delegated_by && body.delegation_depth !== 1) {
    return { ok: false, status: 400, error: "invalid_delegation_context" };
  }

  if ((body.delegation_depth ?? 0) > 0 && !body.delegated_by) {
    return { ok: false, status: 400, error: "invalid_delegation_context" };
  }

  return { ok: true };
}

async function issueToken(
  body: Required<Pick<TokenRequest, "client_id" | "audience" | "scope">> & Pick<TokenRequest, "delegated_by" | "delegation_depth" | "parent_task_id" | "requested_by_agent">,
  scopes: string[],
  tokenTtlSeconds: number
): Promise<A2ATokenResponse> {
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

  if (body.delegated_by) {
    claims.delegated_by = body.delegated_by;
  }

  if (body.delegation_depth !== undefined) {
    claims.delegation_depth = body.delegation_depth;
  }

  if (body.parent_task_id) {
    claims.parent_task_id = body.parent_task_id;
  }

  if (body.requested_by_agent) {
    claims.requested_by_agent = body.requested_by_agent;
  }

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
        scope: body.scope as string,
        delegated_by: body.delegated_by,
        delegation_depth: body.delegation_depth,
        parent_task_id: body.parent_task_id,
        requested_by_agent: body.requested_by_agent
      },
      validation.scopes,
      validation.application.tokenTtlSeconds ?? Number(process.env.A2A_TOKEN_TTL_SECONDS ?? 300)
    ),
    request
  );
}

async function start(): Promise<void> {
  signingKey = await createSigningKey();
  resourceRegistry = await buildDiscoveredA2AResourceRegistry(agentCardRegistry);

  startJsonServer(port, async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { status: "ok", service: "mock-identity-provider" }, request);
      return;
    }

    if (request.method === "GET" && request.url === "/.well-known/jwks.json") {
      sendJson(response, 200, { keys: [signingKey.publicJwk] }, request);
      return;
    }

    if (request.method === "GET" && request.url === "/debug/oauth-applications") {
      sendJson(
        response,
        200,
        {
          issuer,
          applications: oauthApplications.map((application) => ({
            clientId: application.clientId,
            displayName: application.displayName,
            ownerAgentId: application.ownerAgentId,
            scopePolicy: application.scopePolicy,
            tokenTtlSeconds: application.tokenTtlSeconds ?? Number(process.env.A2A_TOKEN_TTL_SECONDS ?? 300)
          })),
          discoveredResources: {
            audiences: [...resourceRegistry.audiences].sort(),
            scopes: [...resourceRegistry.scopes].sort(),
            scopeToAgents: Object.fromEntries(
              [...resourceRegistry.scopeToAgents.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([scope, agents]) => [scope, [...new Set(agents)].sort()])
            ),
            sensitiveScopesNeverIssued: [...sensitiveScopesNeverIssuedByMockIdp]
          }
        },
        request
      );
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
