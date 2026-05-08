import type { ExternalAgentTrustResponse, OAuthApplicationRegistration } from "./agentOnboarding";

const trustedOAuthApplications: OAuthApplicationRegistration[] = [
  {
    clientId: "salesforce-access-agent-client",
    agentId: "external-salesforce-access-agent",
    issuer: "https://agents.example.com",
    audience: "external-salesforce-access-agent",
    allowedScopes: ["salesforce.access.read"],
    allowedCapabilities: ["salesforce.access.diagnose"],
    tokenEndpointAuthMethod: "private_key_jwt",
    status: "active"
  }
];

function missingItems(requested: string[], allowed: string[]): string[] {
  const allowedSet = new Set(allowed);
  return requested.filter((item) => !allowedSet.has(item));
}

export function validateOAuthApplicationBinding(trustResponse: ExternalAgentTrustResponse): {
  valid: boolean;
  details: string[];
  allowedScopes: string[];
  allowedCapabilities: string[];
} {
  const registration = trustedOAuthApplications.find((item) => item.clientId === trustResponse.clientId);
  if (!registration) {
    return {
      valid: false,
      details: [`unknown clientId ${trustResponse.clientId}`],
      allowedScopes: [],
      allowedCapabilities: []
    };
  }

  const details: string[] = [];
  if (registration.status !== "active") details.push("OAuth application is not active.");
  if (registration.agentId !== trustResponse.agentId) details.push("OAuth application agentId does not match trust response.");
  if (registration.issuer !== trustResponse.issuer) details.push("OAuth application issuer does not match trust response.");
  if (registration.audience !== trustResponse.audience) details.push("OAuth application audience does not match trust response.");
  if (registration.tokenEndpointAuthMethod !== trustResponse.tokenEndpointAuthMethod) details.push("OAuth application token auth method does not match trust response.");

  const extraScopes = missingItems(trustResponse.scopes, registration.allowedScopes);
  if (extraScopes.length > 0) details.push(`unregistered scopes requested: ${extraScopes.join(", ")}`);

  const extraCapabilities = missingItems(trustResponse.capabilities, registration.allowedCapabilities);
  if (extraCapabilities.length > 0) details.push(`unregistered capabilities requested: ${extraCapabilities.join(", ")}`);

  return {
    valid: details.length === 0,
    details,
    allowedScopes: [...registration.allowedScopes],
    allowedCapabilities: [...registration.allowedCapabilities]
  };
}

