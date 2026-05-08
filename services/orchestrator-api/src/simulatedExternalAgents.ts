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
    agentId: "external-jira-agent",
    issuer,
    clientId: "jira-agent-client",
    audience: "external-jira-agent",
    nonce: challenge.nonce,
    supportedCapabilities: [
      "jira.issue.diagnose_creation_failure",
      "jira.permission.inspect",
      "jira.issue.create"
    ],
    requestedScopes: ["read:jira-work", "read:jira-user"],
    tokenEndpointAuthMethod: "private_key_jwt",
    jwksUri: `${issuer}/.well-known/jwks.json`,
    signatureVerified: true
  };

  return baseResponse;
}
