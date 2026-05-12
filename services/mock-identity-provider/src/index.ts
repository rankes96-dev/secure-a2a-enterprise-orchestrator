import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { exportJWK, generateKeyPair, calculateJwkThumbprint, SignJWT, type JWK, type KeyLike } from "jose";
import type { A2ATokenClaims, A2ATokenResponse } from "@a2a/shared";
import { readJsonBody, sendJson, startJsonServer } from "@a2a/shared/http";
import { buildDiscoveredA2AResourceRegistry, type DiscoveredA2AResourceRegistry } from "./agentCardScopeRegistry.js";
import { getOAuthApplication, oauthApplications, sensitiveScopesNeverIssuedByMockIdp, type OAuthApplicationRegistration } from "./config/oauthApplications.js";
import { authenticateOAuthClient } from "./security/clientAuthentication.js";
import { evaluateSourceIpAllowlist } from "./security/sourceIpAllowlist.js";

dotenv.config({ path: new URL("../.env", import.meta.url) });
dotenv.config({ path: new URL("../../orchestrator-api/.env", import.meta.url), quiet: true });

const port = Number(process.env.PORT ?? process.env.MOCK_IDENTITY_PROVIDER_PORT ?? 4110);
const issuer = process.env.A2A_ISSUER ?? "http://localhost:4110";
const deniedScopes = new Set<string>(sensitiveScopesNeverIssuedByMockIdp);
const demoUserTokenAudience = "secure-a2a-gateway";
const demoUserTokenTtlSeconds = 900;

type DemoUserProfile = {
  email: string;
  name: string;
  roles: string[];
};

const demoUserProfiles = new Map<string, DemoUserProfile>([
  ["ran@company.com", { email: "ran@company.com", name: "Ran Keselman", roles: ["it-support"] }],
  ["analyst@company.com", { email: "analyst@company.com", name: "Security Analyst", roles: ["read-only"] }],
  ["admin@company.com", { email: "admin@company.com", name: "Identity Admin", roles: ["identity-admin"] }]
]);

type TokenRequest = {
  grant_type?: string;
  client_id?: string;
  client_secret?: string;
  client_assertion_type?: string;
  client_assertion?: string;
  audience?: string;
  scope?: string;
  delegated_by?: string;
  delegation_depth?: number;
  parent_task_id?: string;
  requested_by_agent?: string;
  actor?: string;
  actor_roles?: string[];
};

type SigningKey = {
  privateKey: KeyLike;
  publicJwk: JWK;
  kid: string;
};

type DemoUserTokenRequest = {
  email?: unknown;
  name?: unknown;
  roles?: unknown;
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

function validateDemoUserTokenRequest(value: DemoUserTokenRequest): { ok: true; profile: DemoUserProfile } | { ok: false; error: string } {
  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "invalid_demo_user_email" };
  }

  const profile = demoUserProfiles.get(email);
  if (!profile) {
    return { ok: false, error: "demo_user_not_allowed" };
  }

  if (value.name !== undefined && typeof value.name !== "string") {
    return { ok: false, error: "invalid_demo_user_name" };
  }

  if (value.roles !== undefined) {
    if (!Array.isArray(value.roles) || value.roles.some((role) => typeof role !== "string")) {
      return { ok: false, error: "invalid_demo_user_roles" };
    }

    const allowedRoles = new Set(profile.roles);
    const requestedRoles = value.roles.map((role) => role.trim()).filter(Boolean);
    if (requestedRoles.some((role) => !allowedRoles.has(role))) {
      return { ok: false, error: "demo_user_role_not_allowed" };
    }
  }

  return { ok: true, profile };
}

async function issueDemoUserToken(profile: DemoUserProfile): Promise<{ accessToken: string; expiresIn: number; tokenType: "Bearer"; user: DemoUserProfile }> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + demoUserTokenTtlSeconds;
  const subject = `user:${profile.email}`;
  const accessToken = await new SignJWT({
    email: profile.email,
    name: profile.name,
    roles: profile.roles,
    token_use: "user_identity"
  })
    .setProtectedHeader({ alg: "RS256", kid: signingKey.kid, typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(demoUserTokenAudience)
    .setSubject(subject)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setJti(randomUUID())
    .sign(signingKey.privateKey);

  return {
    accessToken,
    expiresIn: demoUserTokenTtlSeconds,
    tokenType: "Bearer",
    user: {
      email: profile.email,
      name: profile.name,
      roles: [...profile.roles]
    }
  };
}

async function handleDemoUserToken(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const validation = validateDemoUserTokenRequest(await readJsonBody<DemoUserTokenRequest>(request));
  if (!validation.ok) {
    sendJson(response, 400, { error: validation.error }, request);
    return;
  }

  sendJson(response, 200, await issueDemoUserToken(validation.profile), request);
}

type TokenValidationResult =
  | { ok: true; application: OAuthApplicationRegistration; scopes: string[]; authMethod: "client_secret_post" | "private_key_jwt" }
  | { ok: false; status: number; error: string; authMethod?: "client_secret_post" | "private_key_jwt" | "unknown" };

async function validateTokenRequest(body: TokenRequest): Promise<TokenValidationResult> {
  if (body.grant_type !== "client_credentials") {
    return { ok: false, status: 400, error: "unsupported_grant_type" };
  }

  if (!body.client_id) {
    return { ok: false, status: 401, error: "invalid_client" };
  }

  const application = getOAuthApplication(body.client_id);
  if (!application) {
    return { ok: false, status: 401, error: "invalid_client" };
  }

  const clientAuth = await authenticateOAuthClient({ body, application });
  if (!clientAuth.ok) {
    return clientAuth;
  }

  if (!body.audience || !body.scope) {
    return { ok: false, status: 400, error: "missing_audience_or_scope", authMethod: clientAuth.authMethod };
  }

  const delegationValidation = validateDelegationContext(body);
  if (!delegationValidation.ok) {
    return { ...delegationValidation, authMethod: clientAuth.authMethod };
  }

  const scopes = parseScopes(body.scope);
  if (scopes.length === 0) {
    return { ok: false, status: 400, error: "missing_audience_or_scope", authMethod: clientAuth.authMethod };
  }

  const isStaticAudience = resourceRegistry.audiences.has(body.audience);
  if (!isStaticAudience) {
    return { ok: false, status: 403, error: `audience_not_allowed: ${body.audience}`, authMethod: clientAuth.authMethod };
  }

  const denied = scopes.find((scope) => deniedScopes.has(scope));
  if (denied) {
    return { ok: false, status: 403, error: `scope_denied: ${denied}`, authMethod: clientAuth.authMethod };
  }

  const unsupported = isStaticAudience ? scopes.find((scope) => !resourceRegistry.scopes.has(scope)) : undefined;
  if (unsupported) {
    return { ok: false, status: 403, error: `scope_not_allowed: ${unsupported}`, authMethod: clientAuth.authMethod };
  }

  return { ok: true, application, scopes, authMethod: clientAuth.authMethod };
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

  if (body.actor !== undefined && typeof body.actor !== "string") {
    return { ok: false, status: 400, error: "invalid_delegation_context" };
  }

  if (body.actor_roles !== undefined && (!Array.isArray(body.actor_roles) || body.actor_roles.some((role) => typeof role !== "string"))) {
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
  body: Required<Pick<TokenRequest, "client_id" | "audience" | "scope">> & Pick<TokenRequest, "delegated_by" | "delegation_depth" | "parent_task_id" | "requested_by_agent" | "actor" | "actor_roles">,
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

  if (body.actor) {
    claims.actor = body.actor;
  }

  if (body.actor_roles) {
    claims.actor_roles = body.actor_roles;
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

async function handleToken(request: IncomingMessage, response: ServerResponse, sourceIp?: string): Promise<void> {
  const body = await readJsonBody<TokenRequest>(request);
  const validation = await validateTokenRequest(body);

  if (!validation.ok) {
    auditTokenAttempt(body, validation.authMethod ?? "unknown", "denied", validation.error, sourceIp);
    sendJson(response, validation.status, { error: validation.error }, request);
    return;
  }

  auditTokenAttempt(body, validation.authMethod, "allowed", undefined, sourceIp);
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
        requested_by_agent: body.requested_by_agent,
        actor: body.actor,
        actor_roles: body.actor_roles
      },
      validation.scopes,
      validation.application.tokenTtlSeconds ?? Number(process.env.A2A_TOKEN_TTL_SECONDS ?? 300)
    ),
    request
  );
}

function auditTokenAttempt(
  body: TokenRequest,
  authMethod: "client_secret_post" | "private_key_jwt" | "unknown",
  result: "allowed" | "denied",
  denialReason?: string,
  sourceIp?: string
): void {
  console.log(
    `[mock-idp] token_request timestamp=${new Date().toISOString()} sourceIp=${sourceIp ?? "unknown"} client_id=${body.client_id ?? "unknown"} audience=${body.audience ?? "unknown"} scope=${body.scope ?? "unknown"} authMethod=${authMethod} result=${result}${denialReason ? ` reason=${denialReason}` : ""} delegated_by=${body.delegated_by ?? "none"} delegation_depth=${body.delegation_depth ?? 0}`
  );
}

async function start(): Promise<void> {
  signingKey = await createSigningKey();
  resourceRegistry = buildDiscoveredA2AResourceRegistry();

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
            tokenTtlSeconds: application.tokenTtlSeconds ?? Number(process.env.A2A_TOKEN_TTL_SECONDS ?? 300),
            allowedAuthMethods: application.allowedAuthMethods,
            privateKeyJwt: application.privateKeyJwt
              ? {
                  enabled: application.privateKeyJwt.enabled,
                  expectedAudience: application.privateKeyJwt.expectedAudience,
                  hasPublicJwk: Boolean(application.privateKeyJwt.publicJwkJson)
                }
              : undefined
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

    if (request.method === "POST" && request.url === "/demo/user-token") {
      await handleDemoUserToken(request, response);
      return;
    }

    if (request.method === "POST" && request.url === "/oauth/token") {
      const sourceIpCheck = evaluateSourceIpAllowlist(request);
      if (!sourceIpCheck.ok) {
        console.warn(
          `[mock-idp] token_request_network_denied timestamp=${new Date().toISOString()} sourceIp=${sourceIpCheck.sourceIp} reason=${sourceIpCheck.reason}`
        );
        sendJson(response, 403, { error: "source_ip_not_allowed" }, request);
        return;
      }

      await handleToken(request, response, sourceIpCheck.sourceIp);
      return;
    }

    sendJson(response, 404, { error: "not_found" }, request);
  });
}

void start();
