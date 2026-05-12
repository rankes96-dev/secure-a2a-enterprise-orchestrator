import type { AgentOnboardingRequest, ExternalAgentDiscovery } from "./types.js";
import { cleanString, describeFetchFailure, fetchJsonWithLimit, maxDiscoveryJsonBytes, record } from "./utils.js";
import { validateSafeExternalUrl } from "./requestValidation.js";

export function validateDiscovery(value: unknown, request: AgentOnboardingRequest): { discovery?: ExternalAgentDiscovery; details: string[] } {
  const details: string[] = [];
  const input = record(value);
  const auth = record(input.auth);
  const discovery: ExternalAgentDiscovery = {
    agentId: cleanString(input.agentId),
    issuer: cleanString(input.issuer),
    resourceSystem: cleanString(input.resourceSystem) || undefined,
    connectorId: cleanString(input.connectorId) || undefined,
    connectorDisplayName: cleanString(input.connectorDisplayName) || undefined,
    connectorProfileUrl: cleanString(input.connectorProfileUrl) || undefined,
    externalConfigHash: cleanString(input.externalConfigHash) || undefined,
    supportedConnectorProfileUrl: cleanString(input.supportedConnectorProfileUrl) || undefined,
    trustAdapter: cleanString(input.trustAdapter) || undefined,
    jwksUri: cleanString(input.jwksUri),
    onboardingEndpoint: cleanString(input.onboardingEndpoint),
    runtimeEndpoint: cleanString(input.runtimeEndpoint),
    adminConsoleUrl: cleanString(input.adminConsoleUrl) || undefined,
    auth: {
      audience: cleanString(auth.audience),
      tokenEndpointAuthMethod:
        auth.tokenEndpointAuthMethod === "private_key_jwt" || auth.tokenEndpointAuthMethod === "client_secret_post"
          ? auth.tokenEndpointAuthMethod
          : "unknown"
    },
    connectionRequirements: record(input.connectionRequirements).requiresGatewayRegistration !== undefined
      ? {
          requiresGatewayRegistration: Boolean(record(input.connectionRequirements).requiresGatewayRegistration),
          requiresOAuthApplication: Boolean(record(input.connectionRequirements).requiresOAuthApplication),
          requiresServicePrincipal: Boolean(record(input.connectionRequirements).requiresServicePrincipal)
        }
      : undefined
  };

  if (!discovery.agentId) details.push("discovery missing agentId.");
  if (!discovery.issuer) details.push("discovery missing issuer.");
  if (!discovery.jwksUri) details.push("discovery missing jwksUri.");
  if (!discovery.onboardingEndpoint) details.push("discovery missing onboardingEndpoint.");
  if (!discovery.runtimeEndpoint) details.push("discovery missing runtimeEndpoint.");
  if (!discovery.auth.audience) details.push("discovery missing auth.audience.");
  if (discovery.agentId && discovery.agentId !== request.expectedAgentId) {
    details.push("discovery agentId did not match expectedAgentId.");
  }
  if (discovery.issuer && discovery.issuer !== request.agentBaseUrl) {
    details.push("discovery issuer did not match agentBaseUrl.");
  }
  if (request.expectedResourceSystem && discovery.resourceSystem !== request.expectedResourceSystem) {
    details.push(`Expected external system ${request.expectedResourceSystem} but discovered ${discovery.resourceSystem || "unknown"}.`);
  }
  if (request.expectedConnectorId && discovery.connectorId !== request.expectedConnectorId) {
    details.push(`Expected connector ${request.expectedConnectorId} but discovered ${discovery.connectorId || "unknown"}.`);
  }

  for (const [label, url] of [
    ["issuer", discovery.issuer],
    ["jwksUri", discovery.jwksUri],
    ["onboardingEndpoint", discovery.onboardingEndpoint],
    ["runtimeEndpoint", discovery.runtimeEndpoint],
    ["adminConsoleUrl", discovery.adminConsoleUrl],
    ["connectorProfileUrl", discovery.connectorProfileUrl],
    ["supportedConnectorProfileUrl", discovery.supportedConnectorProfileUrl]
  ] as const) {
    if (url) {
      const unsafe = validateSafeExternalUrl(url, request.agentBaseUrl);
      if (unsafe) {
        details.push(`${label}: ${unsafe}`);
      }
    }
  }

  return details.length > 0 ? { details } : { discovery, details };
}

export async function discoverExternalAgent(request: AgentOnboardingRequest): Promise<{ discovery?: ExternalAgentDiscovery; details: string[] }> {
  const discoveryUrl = `${request.agentBaseUrl}/.well-known/a2a-agent.json`;
  try {
    const body = await fetchJsonWithLimit<unknown>(discoveryUrl, { method: "GET" }, maxDiscoveryJsonBytes);
    return validateDiscovery(body, request);
  } catch (error) {
    return {
      details: [`external agent discovery failed: ${describeFetchFailure(discoveryUrl, error)}`]
    };
  }
}
