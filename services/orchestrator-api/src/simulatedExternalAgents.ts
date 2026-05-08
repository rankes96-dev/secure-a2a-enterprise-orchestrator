import type { AgentOnboardingChallenge, ExternalAgentTrustResponse } from "./agentOnboarding";

const safeKnownAgentBaseUrls = new Set(["https://agents.example.com", "http://localhost:4201"]);

export function isKnownSafeAgentBaseUrl(agentBaseUrl: string): boolean {
  return safeKnownAgentBaseUrls.has(agentBaseUrl);
}

export function getSimulatedExternalAgentTrustResponse(challenge: AgentOnboardingChallenge): ExternalAgentTrustResponse | undefined {
  if (!isKnownSafeAgentBaseUrl(challenge.agentBaseUrl)) {
    return undefined;
  }

  const issuer = challenge.agentBaseUrl;
  const baseResponse: ExternalAgentTrustResponse = {
    onboardingId: challenge.onboardingId,
    agentId: "external-salesforce-access-agent",
    issuer,
    clientId: "salesforce-access-agent-client",
    audience: "external-salesforce-access-agent",
    nonce: challenge.nonce,
    capabilities: ["salesforce.access.diagnose"],
    scopes: ["salesforce.access.read"],
    tokenEndpointAuthMethod: "private_key_jwt",
    jwksUri: `${issuer}/.well-known/jwks.json`,
    signatureVerified: true
  };

  return baseResponse;
}

