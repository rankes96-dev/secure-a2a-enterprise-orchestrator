import { adminAgentMetadata } from "./adminConfig.js";
import { shouldAdvertiseAdminConsole } from "./adminSecurity.js";
import { agentId, agentIssuer, expectedAudience, tokenEndpointAuthMethod } from "./config.js";

export function discoveryDocument(env: NodeJS.ProcessEnv = process.env) {
  const issuer = agentIssuer();
  const agent = adminAgentMetadata();
  return {
    agentId,
    issuer,
    resourceSystem: agent.resourceSystem,
    connectorId: agent.connectorId,
    connectorDisplayName: agent.connectorDisplayName,
    connectorProfileUrl: agent.connectorProfileUrl,
    externalConfigHash: agent.externalConfigHash,
    supportedConnectorProfileUrl: `${issuer}/.well-known/a2a-supported-connectors.json`,
    trustAdapter: agent.trustAdapter,
    jwksUri: `${issuer}/.well-known/jwks.json`,
    onboardingEndpoint: `${issuer}/onboarding/challenge`,
    runtimeEndpoint: `${issuer}/a2a/task`,
    ...(shouldAdvertiseAdminConsole(env) ? { adminConsoleUrl: `${issuer}/admin` } : {}),
    auth: {
      type: "oauth2_client_credentials_jwt",
      audience: expectedAudience(),
      tokenEndpointAuthMethod
    },
    connectionRequirements: {
      requiresGatewayRegistration: true,
      requiresOAuthApplication: true,
      requiresServicePrincipal: true
    }
  };
}
