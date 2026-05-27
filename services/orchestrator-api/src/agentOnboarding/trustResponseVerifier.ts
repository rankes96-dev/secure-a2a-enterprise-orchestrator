import { createRemoteJWKSet, jwtVerify } from "jose";
import { a2aJsonRequestHeaders } from "@a2a/shared";
import { gatewayPublicIdentity } from "../security/gatewayIdentity.js";
import type { AgentOnboardingChallenge, ExternalAgentDiscovery, ExternalAgentTrustResponse } from "./types.js";
import { cleanString, externalStatus, fetchJsonWithLimit, maxOnboardingJsonBytes, record, stringArray } from "./utils.js";

export async function requestExternalAgentTrustResponse(
  challenge: AgentOnboardingChallenge,
  discovery: ExternalAgentDiscovery,
  gatewayAssertion: string
): Promise<ExternalAgentTrustResponse | undefined> {
  const gateway = gatewayPublicIdentity();
  try {
    const body = await fetchJsonWithLimit<{ signedTrustResponse?: unknown; agentId?: unknown }>(discovery.onboardingEndpoint, {
      method: "POST",
      headers: a2aJsonRequestHeaders(),
      body: JSON.stringify({
        challenge: {
          onboardingId: challenge.onboardingId,
          nonce: challenge.nonce,
          expectedAgentId: challenge.expectedAgentId,
          expiresAt: challenge.expiresAt
        },
        gatewayAssertion,
        gateway
      })
    }, maxOnboardingJsonBytes);
    if (typeof body.signedTrustResponse !== "string" || body.agentId !== discovery.agentId) {
      return undefined;
    }

    const { payload } = await jwtVerify(
      body.signedTrustResponse,
      createRemoteJWKSet(new URL(discovery.jwksUri)),
      {
        issuer: discovery.issuer,
        audience: challenge.expectedAudience,
        subject: discovery.agentId
      }
    );
    const oauthApplication = record(payload.oauthApplication);
    const servicePrincipal = record(payload.servicePrincipal);

    return {
      onboardingId: cleanString(payload.onboardingId),
      agentId: cleanString(payload.agentId),
      issuer: cleanString(payload.issuer),
      clientId: cleanString(payload.clientId),
      audience: cleanString(payload.audience),
      nonce: cleanString(payload.nonce),
      agentDeclaredSkills: stringArray(payload.agentDeclaredSkills).length
        ? stringArray(payload.agentDeclaredSkills)
        : stringArray(payload.agentDeclaredCapabilities),
      agentDeclaredCapabilities: stringArray(payload.agentDeclaredCapabilities).length
        ? stringArray(payload.agentDeclaredCapabilities)
        : stringArray(payload.agentDeclaredSkills),
      requestedApplicationGrants: stringArray(payload.requestedApplicationGrants).length
        ? stringArray(payload.requestedApplicationGrants)
        : stringArray(payload.requestedScopes),
      requestedScopes: stringArray(payload.requestedScopes).length
        ? stringArray(payload.requestedScopes)
        : stringArray(payload.requestedApplicationGrants),
      tokenEndpointAuthMethod:
        payload.tokenEndpointAuthMethod === "private_key_jwt" || payload.tokenEndpointAuthMethod === "client_secret_post"
          ? payload.tokenEndpointAuthMethod
          : "unknown",
      jwksUri: discovery.jwksUri,
      signatureVerified: payload.typ === "agent_onboarding_response",
      resourceSystem: cleanString(payload.resourceSystem) || discovery.resourceSystem,
      connectorId: cleanString(payload.connectorId),
      connectorProfileUrl: cleanString(payload.connectorProfileUrl) || discovery.connectorProfileUrl,
      connectorProfileHash: cleanString(payload.connectorProfileHash),
      externalConfigHash: cleanString(payload.externalConfigHash) || discovery.externalConfigHash,
      trustAdapter: cleanString(payload.trustAdapter) || discovery.trustAdapter,
      oauthApplication: oauthApplication.clientId
        ? {
            appName: cleanString(oauthApplication.appName),
            clientId: cleanString(oauthApplication.clientId),
            authorizationServerIssuer: cleanString(oauthApplication.authorizationServerIssuer),
            applicationAccessGrants: stringArray(oauthApplication.applicationAccessGrants).length
              ? stringArray(oauthApplication.applicationAccessGrants)
              : stringArray(oauthApplication.grantedScopes),
            grantedScopes: stringArray(oauthApplication.grantedScopes),
            tokenEndpointAuthMethod:
              oauthApplication.tokenEndpointAuthMethod === "private_key_jwt" || oauthApplication.tokenEndpointAuthMethod === "client_secret_post"
                ? oauthApplication.tokenEndpointAuthMethod
                : "unknown",
            status: externalStatus(oauthApplication.status)
          }
        : undefined,
      servicePrincipal: servicePrincipal.principalId
        ? {
            principalType: cleanString(servicePrincipal.principalType),
            principalId: cleanString(servicePrincipal.principalId),
            effectivePermissions: stringArray(servicePrincipal.effectivePermissions),
            deniedPermissions: stringArray(servicePrincipal.deniedPermissions)
          }
        : undefined
    };
  } catch {
    return undefined;
  }
}
