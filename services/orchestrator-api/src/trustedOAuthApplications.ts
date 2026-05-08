import type { ExternalAgentTrustResponse, OAuthApplicationRegistration } from "./agentOnboarding";

const trustedOAuthApplications: OAuthApplicationRegistration[] = [
  {
    clientId: "jira-agent-client",
    agentId: "external-jira-agent",
    issuer: "http://localhost:4201",
    audience: "external-jira-agent",
    grantedScopes: ["read:jira-work", "read:jira-user"],
    tokenEndpointAuthMethod: "private_key_jwt",
    status: "active"
  },
  {
    clientId: "salesforce-access-agent-client",
    agentId: "external-salesforce-access-agent",
    issuer: "https://agents.example.com",
    audience: "external-salesforce-access-agent",
    grantedScopes: ["salesforce.access.read"],
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
  registration?: OAuthApplicationRegistration;
  grantedScopes: string[];
} {
  if (trustResponse.oauthApplication) {
    const app = trustResponse.oauthApplication;
    const details: string[] = [];
    if (trustResponse.clientId !== app.clientId) details.push("signed response clientId does not match oauthApplication.clientId.");
    if (app.status !== "active") details.push("OAuth application is not active.");
    if (app.tokenEndpointAuthMethod !== trustResponse.tokenEndpointAuthMethod) details.push("OAuth application token auth method does not match trust response.");

    const extraScopes = missingItems(trustResponse.requestedScopes, app.grantedScopes);
    if (extraScopes.length > 0) details.push(`ungranted scopes requested: ${extraScopes.join(", ")}`);

    return {
      valid: details.length === 0,
      details,
      registration: {
        clientId: app.clientId,
        agentId: trustResponse.agentId,
        issuer: trustResponse.issuer,
        audience: trustResponse.audience,
        grantedScopes: [...app.grantedScopes],
        tokenEndpointAuthMethod: app.tokenEndpointAuthMethod,
        status: app.status === "unknown" ? "disabled" : app.status
      },
      grantedScopes: [...app.grantedScopes]
    };
  }

  const registration = trustedOAuthApplications.find((item) => item.clientId === trustResponse.clientId);
  if (!registration) {
    return {
      valid: false,
      details: [`unknown clientId ${trustResponse.clientId}`],
      grantedScopes: []
    };
  }

  const details: string[] = [];
  if (registration.status !== "active") details.push("OAuth application is not active.");
  if (registration.agentId !== trustResponse.agentId) details.push("OAuth application agentId does not match trust response.");
  if (registration.issuer !== trustResponse.issuer) details.push("OAuth application issuer does not match trust response.");
  if (registration.audience !== trustResponse.audience) details.push("OAuth application audience does not match trust response.");
  if (registration.tokenEndpointAuthMethod !== trustResponse.tokenEndpointAuthMethod) details.push("OAuth application token auth method does not match trust response.");

  const extraScopes = missingItems(trustResponse.requestedScopes, registration.grantedScopes);
  if (extraScopes.length > 0) details.push(`unregistered scopes requested: ${extraScopes.join(", ")}`);

  return {
    valid: details.length === 0,
    details,
    registration,
    grantedScopes: [...registration.grantedScopes]
  };
}
