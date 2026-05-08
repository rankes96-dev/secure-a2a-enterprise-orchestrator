import {
  agentDeclaredCapabilities,
  agentId,
  agentIssuer,
  clientId,
  requestedScopes,
  tokenEndpointAuthMethod,
  trustedGatewayClientId,
  trustedGatewayIssuer,
  trustedGatewayJwksUri
} from "./config.js";

export type TrustedGatewayRegistration = {
  gatewayId: string;
  clientId: string;
  issuer: string;
  jwksUri: string;
  onboardingMethod: "signed_gateway_challenge";
};

export type OAuthApplicationConfig = {
  resourceSystem: "jira";
  clientId: string;
  authorizationServerIssuer: string;
  tokenEndpointAuthMethod: "private_key_jwt";
  grantedScopes: string[];
  status: "active" | "disabled";
};

export type ServicePrincipalConfig = {
  principalType: "service_account";
  principalId: string;
  effectivePermissions: string[];
  deniedPermissions: string[];
};

export type CapabilityDeclarationConfig = {
  requestedScopes: string[];
  agentDeclaredCapabilities: string[];
};

export type AdminConfig = {
  trustedGateway: TrustedGatewayRegistration;
  oauthApplication: OAuthApplicationConfig;
  servicePrincipal: ServicePrincipalConfig;
  capabilityDeclaration: CapabilityDeclarationConfig;
};

const forbiddenSecretPatterns = [
  /client[_-]?secret/i,
  /privateKey/i,
  /"private_key"\s*:/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /authorizationHeader/i,
  /"authorization"\s*:/i,
  /bearer/i
];

function lines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasSecretMarker(value: unknown): boolean {
  const text = JSON.stringify(value);
  return forbiddenSecretPatterns.some((pattern) => pattern.test(text));
}

function demoConfig(): AdminConfig {
  return {
    trustedGateway: {
      gatewayId: "secure-a2a-gateway",
      clientId: trustedGatewayClientId(),
      issuer: trustedGatewayIssuer(),
      jwksUri: trustedGatewayJwksUri(),
      onboardingMethod: "signed_gateway_challenge"
    },
    oauthApplication: {
      resourceSystem: "jira",
      clientId,
      authorizationServerIssuer: "http://localhost:4110",
      tokenEndpointAuthMethod,
      grantedScopes: [...requestedScopes],
      status: "active"
    },
    servicePrincipal: {
      principalType: "service_account",
      principalId: "svc-a2a-jira-agent",
      effectivePermissions: ["browse_projects", "view_issues", "read_project_roles"],
      deniedPermissions: ["create_issues"]
    },
    capabilityDeclaration: {
      requestedScopes: [...requestedScopes],
      agentDeclaredCapabilities: [...agentDeclaredCapabilities]
    }
  };
}

let currentConfig = demoConfig();

export function resetDemoConfig(): AdminConfig {
  currentConfig = demoConfig();
  return getAdminConfig();
}

export function getAdminConfig(): AdminConfig {
  return {
    trustedGateway: { ...currentConfig.trustedGateway },
    oauthApplication: {
      ...currentConfig.oauthApplication,
      grantedScopes: [...currentConfig.oauthApplication.grantedScopes]
    },
    servicePrincipal: {
      ...currentConfig.servicePrincipal,
      effectivePermissions: [...currentConfig.servicePrincipal.effectivePermissions],
      deniedPermissions: [...currentConfig.servicePrincipal.deniedPermissions]
    },
    capabilityDeclaration: {
      requestedScopes: [...currentConfig.capabilityDeclaration.requestedScopes],
      agentDeclaredCapabilities: [...currentConfig.capabilityDeclaration.agentDeclaredCapabilities]
    }
  };
}

export function adminAgentMetadata() {
  const issuer = agentIssuer();
  return {
    agentId,
    issuer,
    jwksUri: `${issuer}/.well-known/jwks.json`,
    onboardingEndpoint: `${issuer}/onboarding/challenge`,
    runtimeEndpoint: `${issuer}/a2a/task`,
    adminConsoleUrl: `${issuer}/admin`,
    resourceSystem: currentConfig.oauthApplication.resourceSystem,
    trustAdapter: "jira",
    runtimeAudience: agentId
  };
}

export function readinessStatus(): { ready: boolean; warnings: string[] } {
  const warnings: string[] = [];
  if (!currentConfig.trustedGateway.clientId || !currentConfig.trustedGateway.issuer || !currentConfig.trustedGateway.jwksUri) warnings.push("Gateway registration is incomplete.");
  if (currentConfig.trustedGateway.onboardingMethod !== "signed_gateway_challenge") warnings.push("Gateway onboarding method must be signed_gateway_challenge.");
  if (currentConfig.oauthApplication.status !== "active") warnings.push("OAuth application is disabled.");
  if (!currentConfig.oauthApplication.clientId) warnings.push("OAuth client ID is missing.");
  if (currentConfig.oauthApplication.grantedScopes.length === 0) warnings.push("Granted scopes are missing.");
  if (!currentConfig.servicePrincipal.principalId) warnings.push("Service principal is missing.");
  if (currentConfig.capabilityDeclaration.agentDeclaredCapabilities.length === 0) warnings.push("Agent-declared capabilities are missing.");
  if (hasSecretMarker(currentConfig)) warnings.push("Configuration contains forbidden secret markers.");

  return { ready: warnings.length === 0, warnings };
}

export function publicAdminConfig() {
  const readiness = readinessStatus();
  return {
    agent: adminAgentMetadata(),
    ...getAdminConfig(),
    ready: readiness.ready,
    warnings: readiness.warnings
  };
}

export function saveTrustedGateway(value: unknown): { ok: true; config: ReturnType<typeof publicAdminConfig> } | { ok: false; errors: string[] } {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const candidate: TrustedGatewayRegistration = {
    gatewayId: stringValue(input.gatewayId) || "secure-a2a-gateway",
    clientId: stringValue(input.clientId),
    issuer: stringValue(input.issuer).replace(/\/+$/, ""),
    jwksUri: stringValue(input.jwksUri),
    onboardingMethod: stringValue(input.onboardingMethod) as "signed_gateway_challenge"
  };
  const errors: string[] = [];
  if (hasSecretMarker(input)) errors.push("Gateway registration must not include secrets, tokens, Authorization headers, or private keys.");
  if (!candidate.clientId) errors.push("clientId is required.");
  if (!candidate.issuer) errors.push("issuer is required.");
  if (!candidate.jwksUri) errors.push("jwksUri is required.");
  if (candidate.onboardingMethod !== "signed_gateway_challenge") errors.push("onboardingMethod must be signed_gateway_challenge.");
  if (errors.length > 0) return { ok: false, errors };

  currentConfig.trustedGateway = candidate;
  return { ok: true, config: publicAdminConfig() };
}

export function saveOAuthApplication(value: unknown): { ok: true; config: ReturnType<typeof publicAdminConfig> } | { ok: false; errors: string[] } {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const candidate: OAuthApplicationConfig = {
    resourceSystem: "jira",
    clientId: stringValue(input.clientId),
    authorizationServerIssuer: stringValue(input.authorizationServerIssuer).replace(/\/+$/, ""),
    tokenEndpointAuthMethod: "private_key_jwt",
    grantedScopes: lines(input.grantedScopes),
    status: stringValue(input.status) === "disabled" ? "disabled" : "active"
  };
  const errors: string[] = [];
  if (hasSecretMarker(input)) errors.push("OAuth application config must not include client secrets, private keys, or tokens.");
  if (!candidate.clientId) errors.push("OAuth Client ID is required.");
  if (!candidate.authorizationServerIssuer) errors.push("Authorization server issuer is required.");
  if (candidate.grantedScopes.length === 0) errors.push("Granted scopes are required.");
  if (errors.length > 0) return { ok: false, errors };

  currentConfig.oauthApplication = candidate;
  return { ok: true, config: publicAdminConfig() };
}

export function saveServicePrincipal(value: unknown): { ok: true; config: ReturnType<typeof publicAdminConfig> } | { ok: false; errors: string[] } {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const candidate: ServicePrincipalConfig = {
    principalType: "service_account",
    principalId: stringValue(input.principalId),
    effectivePermissions: lines(input.effectivePermissions),
    deniedPermissions: lines(input.deniedPermissions)
  };
  const errors: string[] = [];
  if (hasSecretMarker(input)) errors.push("Service principal config must not include secrets or tokens.");
  if (!candidate.principalId) errors.push("Principal ID is required.");
  if (candidate.effectivePermissions.length === 0) errors.push("Effective permissions are required.");
  if (errors.length > 0) return { ok: false, errors };

  currentConfig.servicePrincipal = candidate;
  return { ok: true, config: publicAdminConfig() };
}

export function saveCapabilityDeclaration(value: unknown): { ok: true; config: ReturnType<typeof publicAdminConfig> } | { ok: false; errors: string[] } {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const candidate: CapabilityDeclarationConfig = {
    requestedScopes: lines(input.requestedScopes),
    agentDeclaredCapabilities: lines(input.agentDeclaredCapabilities)
  };
  const errors: string[] = [];
  if (hasSecretMarker(input)) errors.push("Capability declaration must not include secrets or tokens.");
  if (candidate.requestedScopes.length === 0) errors.push("Requested scopes are required.");
  if (candidate.agentDeclaredCapabilities.length === 0) errors.push("Agent-declared capabilities are required.");
  if (errors.length > 0) return { ok: false, errors };

  currentConfig.capabilityDeclaration = candidate;
  return { ok: true, config: publicAdminConfig() };
}
