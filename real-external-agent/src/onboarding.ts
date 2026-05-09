import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import {
  agentId,
  agentIssuer,
  expectedAudience
} from "./config.js";
import { getAdminConfig, readinessStatus } from "./adminConfig.js";
import { getConnectorProfile } from "./connectorProfile.js";
import { getSigningKey } from "./keys.js";

export type OnboardingChallenge = {
  onboardingId?: unknown;
  nonce?: unknown;
  expectedAgentId?: unknown;
  expiresAt?: unknown;
};

export type OnboardingRequest = {
  challenge?: unknown;
  gatewayAssertion?: unknown;
  gateway?: unknown;
};

export type SignedTrustResponse = {
  signedTrustResponse: string;
  agentId: string;
};

function requireString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export class OnboardingError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return `{${Object.keys(input)
      .filter((key) => input[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(input[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function connectorProfileHash(profile: ReturnType<typeof getConnectorProfile>): string {
  return createHash("sha256").update(stableStringify(profile)).digest("hex");
}

async function verifyGatewayAssertion(request: OnboardingRequest, challenge: OnboardingChallenge): Promise<void> {
  const assertion = requireString(request.gatewayAssertion);
  if (!assertion) {
    throw new OnboardingError("missing_gateway_assertion", 401);
  }

  const gateway = asRecord(request.gateway);
  const config = getAdminConfig();
  const gatewayIssuer = config.trustedGateway.issuer;
  const gatewayClientId = config.trustedGateway.clientId;
  const gatewayJwksUri = config.trustedGateway.jwksUri;

  if (gateway.issuer && gateway.issuer !== gatewayIssuer) {
    throw new OnboardingError("untrusted_gateway_issuer", 401);
  }
  if (gateway.clientId && gateway.clientId !== gatewayClientId) {
    throw new OnboardingError("untrusted_gateway_client_id", 401);
  }
  if (gateway.jwksUri && gateway.jwksUri !== gatewayJwksUri) {
    throw new OnboardingError("untrusted_gateway_jwks_uri", 401);
  }

  const { payload } = await jwtVerify(assertion, createRemoteJWKSet(new URL(gatewayJwksUri)), {
    issuer: gatewayIssuer,
    subject: gatewayClientId,
    audience: agentId
  });

  if (payload.typ !== "gateway_onboarding_challenge") {
    throw new OnboardingError("invalid_gateway_assertion_type", 401);
  }
  if (payload.onboardingId !== challenge.onboardingId) {
    throw new OnboardingError("gateway_assertion_onboarding_id_mismatch", 401);
  }
  if (payload.nonce !== challenge.nonce) {
    throw new OnboardingError("gateway_assertion_nonce_mismatch", 401);
  }
  if (payload.expectedAgentId !== agentId) {
    throw new OnboardingError("gateway_assertion_agent_id_mismatch", 401);
  }
}

export async function createSignedTrustResponse(request: OnboardingRequest): Promise<SignedTrustResponse> {
  const config = getAdminConfig();
  const readiness = readinessStatus();
  if (!readiness.ready) {
    throw new OnboardingError(`external_agent_not_ready: ${readiness.warnings.join(" ")}`, 400);
  }
  if (config.oauthApplication.status !== "active") {
    throw new OnboardingError("oauth_application_disabled", 400);
  }
  if (!config.servicePrincipal.principalId) {
    throw new OnboardingError("service_principal_missing", 400);
  }

  const challenge = asRecord(request.challenge) as OnboardingChallenge;
  const onboardingId = requireString(challenge.onboardingId);
  const nonce = requireString(challenge.nonce);
  const expectedAgentId = requireString(challenge.expectedAgentId);
  const expiresAt = requireString(challenge.expiresAt);

  if (!onboardingId) {
    throw new OnboardingError("missing_onboarding_id");
  }
  if (!nonce) {
    throw new OnboardingError("missing_nonce");
  }
  if (expectedAgentId !== agentId) {
    throw new OnboardingError("invalid_expected_agent_id");
  }
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
    throw new OnboardingError("invalid_expires_at");
  }

  await verifyGatewayAssertion(request, challenge);

  const key = await getSigningKey();
  const now = Math.floor(Date.now() / 1000);
  const issuer = agentIssuer();
  const connectorProfile = getConnectorProfile();
  const profileUrl = `${issuer}/.well-known/a2a-connector-profile.json`;

  const signedTrustResponse = await new SignJWT({
    typ: "agent_onboarding_response",
    onboardingId,
    nonce,
    agentId,
    issuer,
    clientId: config.oauthApplication.clientId,
    audience: expectedAudience(),
    resourceSystem: config.oauthApplication.resourceSystem,
    connectorId: connectorProfile.connectorId,
    connectorProfileUrl: profileUrl,
    connectorProfileHash: connectorProfileHash(connectorProfile),
    trustAdapter: "jira",
    agentDeclaredCapabilities: config.capabilityDeclaration.agentDeclaredCapabilities,
    requestedApplicationGrants: config.capabilityDeclaration.requestedApplicationGrants,
    requestedScopes: config.capabilityDeclaration.requestedScopes,
    tokenEndpointAuthMethod: config.oauthApplication.tokenEndpointAuthMethod,
    oauthApplication: {
      appName: config.oauthApplication.appName,
      clientId: config.oauthApplication.clientId,
      authorizationServerIssuer: config.oauthApplication.authorizationServerIssuer,
      applicationAccessGrants: config.oauthApplication.applicationAccessGrants,
      grantedScopes: config.oauthApplication.grantedScopes,
      tokenEndpointAuthMethod: config.oauthApplication.tokenEndpointAuthMethod,
      status: config.oauthApplication.status
    },
    servicePrincipal: {
      principalType: config.servicePrincipal.principalType,
      principalId: config.servicePrincipal.principalId,
      effectivePermissions: config.servicePrincipal.effectivePermissions,
      deniedPermissions: config.servicePrincipal.deniedPermissions
    }
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: key.kid })
    .setIssuer(issuer)
    .setSubject(agentId)
    .setAudience("secure-a2a-gateway")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setJti(onboardingId)
    .sign(key.privateKey);

  return {
    signedTrustResponse,
    agentId
  };
}
