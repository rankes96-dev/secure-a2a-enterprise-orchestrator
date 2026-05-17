import type { ExternalAgentTrustResponse, OAuthApplicationRegistration } from "./agentOnboarding.js";

export function validateOAuthApplicationBinding(trustResponse: ExternalAgentTrustResponse): {
  valid: boolean;
  details: string[];
  registration?: OAuthApplicationRegistration;
  applicationAccessGrants: string[];
  grantedScopes: string[];
} {
  if (!trustResponse.oauthApplication) {
    return {
      valid: false,
      details: ["missing signed external OAuth application attestation"],
      applicationAccessGrants: [],
      grantedScopes: []
    };
  }

  const app = trustResponse.oauthApplication;
  const details: string[] = [];
  if (trustResponse.clientId !== app.clientId) details.push("signed response clientId does not match oauthApplication.clientId.");
  if (app.status !== "active") details.push("OAuth application is not active.");
  if (app.tokenEndpointAuthMethod !== trustResponse.tokenEndpointAuthMethod) details.push("OAuth application token auth method does not match trust response.");
  const applicationAccessGrants = app.applicationAccessGrants.length ? app.applicationAccessGrants : app.grantedScopes;

  return {
    valid: details.length === 0,
    details,
    registration: {
      clientId: app.clientId,
      agentId: trustResponse.agentId,
      issuer: trustResponse.issuer,
      audience: trustResponse.audience,
      applicationAccessGrants: [...applicationAccessGrants],
      grantedScopes: [...app.grantedScopes],
      tokenEndpointAuthMethod: app.tokenEndpointAuthMethod,
      status: app.status === "unknown" ? "disabled" : app.status
    },
    applicationAccessGrants: [...applicationAccessGrants],
    grantedScopes: [...app.grantedScopes]
  };
}
