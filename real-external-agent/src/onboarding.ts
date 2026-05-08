import { SignJWT } from "jose";
import { agentId, agentIssuer, capability, clientId, requiredScope, tokenEndpointAuthMethod } from "./config.js";
import { getSigningKey } from "./keys.js";

export type OnboardingChallenge = {
  onboardingId?: unknown;
  nonce?: unknown;
  expectedAudience?: unknown;
  expectedAgentId?: unknown;
  expiresAt?: unknown;
};

export type SignedTrustResponse = {
  signedTrustResponse: string;
  agentId: string;
};

function requireString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function createSignedTrustResponse(challenge: OnboardingChallenge): Promise<SignedTrustResponse> {
  const onboardingId = requireString(challenge.onboardingId);
  const nonce = requireString(challenge.nonce);
  const expectedAudience = requireString(challenge.expectedAudience);
  const expectedAgentId = requireString(challenge.expectedAgentId);
  const expiresAt = requireString(challenge.expiresAt);

  if (!onboardingId) {
    throw new Error("missing_onboarding_id");
  }
  if (!nonce) {
    throw new Error("missing_nonce");
  }
  if (expectedAudience !== "secure-a2a-gateway") {
    throw new Error("invalid_expected_audience");
  }
  if (expectedAgentId !== agentId) {
    throw new Error("invalid_expected_agent_id");
  }
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
    throw new Error("invalid_expires_at");
  }

  const key = await getSigningKey();
  const now = Math.floor(Date.now() / 1000);
  const issuer = agentIssuer();

  const signedTrustResponse = await new SignJWT({
    typ: "agent_onboarding_response",
    onboardingId,
    nonce,
    agentId,
    issuer,
    clientId,
    audience: agentId,
    verifiedCapabilities: [capability],
    verifiedScopes: [requiredScope],
    tokenEndpointAuthMethod
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
