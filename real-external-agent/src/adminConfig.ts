import {
  agentId,
  agentIssuer,
  clientId,
  selectedConnectorId as configuredConnectorId,
  tokenEndpointAuthMethod,
  trustedGatewayClientId,
  trustedGatewayIssuer,
  trustedGatewayJwksUri
} from "./config.js";
import { deriveRequestedApplicationGrants, getConnectorProfile, listSupportedConnectors, previewActionReadiness } from "./connectorProfile.js";
import { createHash } from "node:crypto";

export type TrustedGatewayRegistration = {
  gatewayId: string;
  clientId: string;
  issuer: string;
  jwksUri: string;
  onboardingMethod: "signed_gateway_challenge";
};

export type OAuthApplicationConfig = {
  resourceSystem: string;
  appName: string;
  clientId: string;
  authorizationServerIssuer: string;
  tokenEndpointAuthMethod: "private_key_jwt";
  applicationAccessGrants: string[];
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
  enabledActionIds: string[];
  requestedApplicationGrants: string[];
  requestedScopes: string[];
  // Compatibility alias for earlier onboarding payloads. Values are enabled connector skill IDs.
  agentDeclaredCapabilities: string[];
};

export type AdminConfig = {
  selectedConnectorId: string;
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return `{${Object.keys(input)
      .filter((key) => input[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(input[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function sorted(values: string[]): string[] {
  return [...values].sort();
}

function normalizeKnownValues(values: string[], allowedIds: string[]): string[] {
  const allowed = new Set(allowedIds);
  return unique(values).filter((value) => allowed.has(value));
}

function demoConfig(): AdminConfig {
  const connectorProfile = getConnectorProfile(configuredConnectorId);
  const enabledActionIds = connectorProfile.demoDefaults.defaultEnabledSkillIds?.length
    ? [...connectorProfile.demoDefaults.defaultEnabledSkillIds]
    : connectorProfile.skillCatalog.map((action) => action.id);
  const applicationAccessGrants = [...connectorProfile.demoDefaults.oauthApplication.defaultApplicationAccessGrants];
  const requestedApplicationGrants = deriveRequestedApplicationGrants(enabledActionIds, connectorProfile.connectorId);

  return {
    selectedConnectorId: connectorProfile.connectorId,
    trustedGateway: {
      gatewayId: "secure-a2a-gateway",
      clientId: trustedGatewayClientId(),
      issuer: trustedGatewayIssuer(),
      jwksUri: trustedGatewayJwksUri(),
      onboardingMethod: "signed_gateway_challenge"
    },
    oauthApplication: {
      resourceSystem: connectorProfile.resourceSystem,
      appName: connectorProfile.demoDefaults.oauthApplication.appName,
      clientId,
      authorizationServerIssuer: "http://localhost:4110",
      tokenEndpointAuthMethod,
      applicationAccessGrants,
      grantedScopes: [...applicationAccessGrants],
      status: "active"
    },
    servicePrincipal: {
      principalType: "service_account",
      principalId: connectorProfile.demoDefaults.servicePrincipal.principalId,
      effectivePermissions: [...connectorProfile.demoDefaults.servicePrincipal.defaultEffectivePermissions],
      deniedPermissions: [...connectorProfile.demoDefaults.servicePrincipal.defaultDeniedPermissions]
    },
    capabilityDeclaration: {
      enabledActionIds,
      requestedApplicationGrants,
      requestedScopes: [...requestedApplicationGrants],
      agentDeclaredCapabilities: [...enabledActionIds]
    }
  };
}

let currentConfig = demoConfig();
let currentConfigUpdatedAt = new Date().toISOString();

function markConfigUpdated(): void {
  currentConfigUpdatedAt = new Date().toISOString();
}

function safeHashSnapshot(config: AdminConfig) {
  return {
    selectedConnectorId: config.selectedConnectorId,
    oauthApplication: {
      appName: config.oauthApplication.appName,
      clientId: config.oauthApplication.clientId,
      authorizationServerIssuer: config.oauthApplication.authorizationServerIssuer,
      tokenEndpointAuthMethod: config.oauthApplication.tokenEndpointAuthMethod,
      applicationAccessGrants: sorted(config.oauthApplication.applicationAccessGrants)
    },
    servicePrincipal: {
      principalType: config.servicePrincipal.principalType,
      principalId: config.servicePrincipal.principalId,
      effectivePermissions: sorted(config.servicePrincipal.effectivePermissions),
      deniedPermissions: sorted(config.servicePrincipal.deniedPermissions)
    },
    capabilityDeclaration: {
      enabledActionIds: sorted(config.capabilityDeclaration.enabledActionIds),
      agentDeclaredCapabilities: sorted(config.capabilityDeclaration.agentDeclaredCapabilities)
    }
  };
}

export function adminConfigHash(): string {
  return createHash("sha256").update(stableStringify(safeHashSnapshot(currentConfig))).digest("hex");
}

export function resetDemoConfig(): AdminConfig {
  currentConfig = demoConfig();
  markConfigUpdated();
  return getAdminConfig();
}

export function getAdminConfig(): AdminConfig {
  return {
    selectedConnectorId: currentConfig.selectedConnectorId,
    trustedGateway: { ...currentConfig.trustedGateway },
    oauthApplication: {
      ...currentConfig.oauthApplication,
      applicationAccessGrants: [...currentConfig.oauthApplication.applicationAccessGrants],
      grantedScopes: [...currentConfig.oauthApplication.grantedScopes]
    },
    servicePrincipal: {
      ...currentConfig.servicePrincipal,
      effectivePermissions: [...currentConfig.servicePrincipal.effectivePermissions],
      deniedPermissions: [...currentConfig.servicePrincipal.deniedPermissions]
    },
    capabilityDeclaration: {
      enabledActionIds: [...currentConfig.capabilityDeclaration.enabledActionIds],
      requestedApplicationGrants: [...currentConfig.capabilityDeclaration.requestedApplicationGrants],
      requestedScopes: [...currentConfig.capabilityDeclaration.requestedScopes],
      agentDeclaredCapabilities: [...currentConfig.capabilityDeclaration.agentDeclaredCapabilities]
    }
  };
}

export function adminAgentMetadata() {
  const issuer = agentIssuer();
  const connectorProfile = getConnectorProfile(currentConfig.selectedConnectorId);
  return {
    agentId,
    issuer,
    jwksUri: `${issuer}/.well-known/jwks.json`,
    onboardingEndpoint: `${issuer}/onboarding/challenge`,
    runtimeEndpoint: `${issuer}/a2a/task`,
    adminConsoleUrl: `${issuer}/admin`,
    resourceSystem: currentConfig.oauthApplication.resourceSystem,
    connectorId: connectorProfile.connectorId,
    connectorDisplayName: connectorProfile.displayName,
    connectorProfileUrl: `${issuer}/.well-known/a2a-connector-profile.json`,
    externalConfigHash: adminConfigHash(),
    externalConfigUpdatedAt: currentConfigUpdatedAt,
    trustAdapter: connectorProfile.resourceSystem,
    runtimeAudience: agentId
  };
}

export function readinessStatus(): { ready: boolean; status: "ready" | "readyWithWarnings" | "incomplete"; warnings: string[]; blockers: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!currentConfig.trustedGateway.clientId || !currentConfig.trustedGateway.issuer || !currentConfig.trustedGateway.jwksUri) blockers.push("Gateway registration is incomplete.");
  if (currentConfig.trustedGateway.onboardingMethod !== "signed_gateway_challenge") blockers.push("Gateway onboarding method must be signed_gateway_challenge.");
  if (currentConfig.oauthApplication.status !== "active") blockers.push("OAuth application is disabled.");
  if (!currentConfig.oauthApplication.clientId) blockers.push("OAuth client ID is missing.");
  if (!currentConfig.servicePrincipal.principalId) blockers.push("Service account is missing.");
  if (currentConfig.capabilityDeclaration.agentDeclaredCapabilities.length === 0) blockers.push("Agent actions are missing.");
  if (!listSupportedConnectors().some((connector) => connector.connectorId === currentConfig.selectedConnectorId && connector.status === "available")) blockers.push("Selected connector is not available.");
  if (hasSecretMarker(currentConfig)) blockers.push("Configuration contains forbidden secret markers.");
  if (currentConfig.oauthApplication.applicationAccessGrants.length === 0) warnings.push("No application access grants are selected. Gateway onboarding can proceed, but actions will be blocked.");
  if (currentConfig.servicePrincipal.effectivePermissions.length === 0) warnings.push("No effective permissions are selected. Gateway onboarding can proceed, but actions will be blocked.");

  return {
    ready: blockers.length === 0,
    status: blockers.length > 0 ? "incomplete" : warnings.length > 0 ? "readyWithWarnings" : "ready",
    warnings,
    blockers
  };
}

export function publicAdminConfig() {
  const readiness = readinessStatus();
  return {
    agent: adminAgentMetadata(),
    ...getAdminConfig(),
    selectedConnector: listSupportedConnectors().find((connector) => connector.connectorId === currentConfig.selectedConnectorId),
    supportedConnectors: listSupportedConnectors(),
    connectorProfile: getConnectorProfile(currentConfig.selectedConnectorId),
    actionReadiness: previewActionReadiness(currentConfig),
    externalConfigHash: adminConfigHash(),
    externalConfigUpdatedAt: currentConfigUpdatedAt,
    ready: readiness.ready,
    readinessStatus: readiness.status,
    warnings: readiness.warnings,
    blockers: readiness.blockers
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
  markConfigUpdated();
  return { ok: true, config: publicAdminConfig() };
}

export function saveOAuthApplication(value: unknown): { ok: true; config: ReturnType<typeof publicAdminConfig> } | { ok: false; errors: string[] } {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const connectorProfile = getConnectorProfile(currentConfig.selectedConnectorId);
  const applicationAccessGrants = normalizeKnownValues(
    lines(input.applicationAccessGrants).length > 0 || "applicationAccessGrants" in input
      ? lines(input.applicationAccessGrants)
      : lines(input.grantedScopes),
    connectorProfile.applicationAccessGrantCatalog.map((grant) => grant.id)
  );
  const candidate: OAuthApplicationConfig = {
    resourceSystem: connectorProfile.resourceSystem,
    appName: stringValue(input.appName) || connectorProfile.demoDefaults.oauthApplication.appName,
    clientId: stringValue(input.clientId),
    authorizationServerIssuer: stringValue(input.authorizationServerIssuer).replace(/\/+$/, ""),
    tokenEndpointAuthMethod: "private_key_jwt",
    applicationAccessGrants,
    grantedScopes: [...applicationAccessGrants],
    status: stringValue(input.status) === "disabled" ? "disabled" : "active"
  };
  const errors: string[] = [];
  if (hasSecretMarker(input)) errors.push("OAuth application config must not include client secrets, private keys, or tokens.");
  if (!candidate.clientId) errors.push("OAuth Client ID is required.");
  if (!candidate.authorizationServerIssuer) errors.push("Authorization server issuer is required.");
  if (errors.length > 0) return { ok: false, errors };

  currentConfig.oauthApplication = candidate;
  markConfigUpdated();
  return { ok: true, config: publicAdminConfig() };
}

export function saveServicePrincipal(value: unknown): { ok: true; config: ReturnType<typeof publicAdminConfig> } | { ok: false; errors: string[] } {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const permissionIds = getConnectorProfile(currentConfig.selectedConnectorId).effectivePermissionCatalog.map((permission) => permission.id);
  const deniedPermissions = normalizeKnownValues(lines(input.deniedPermissions), permissionIds);
  const candidate: ServicePrincipalConfig = {
    principalType: "service_account",
    principalId: stringValue(input.principalId),
    effectivePermissions: normalizeKnownValues(lines(input.effectivePermissions), permissionIds).filter((permission) => !deniedPermissions.includes(permission)),
    deniedPermissions
  };
  const errors: string[] = [];
  if (hasSecretMarker(input)) errors.push("Service principal config must not include secrets or tokens.");
  if (!candidate.principalId) errors.push("Principal ID is required.");
  if (errors.length > 0) return { ok: false, errors };

  currentConfig.servicePrincipal = candidate;
  markConfigUpdated();
  return { ok: true, config: publicAdminConfig() };
}

export function saveCapabilityDeclaration(value: unknown): { ok: true; config: ReturnType<typeof publicAdminConfig> } | { ok: false; errors: string[] } {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const actionIds = getConnectorProfile(currentConfig.selectedConnectorId).skillCatalog.map((action) => action.id);
  const enabledActionIds = normalizeKnownValues(
    lines(input.enabledActionIds).length > 0 || "enabledActionIds" in input
      ? lines(input.enabledActionIds)
      : lines(input.agentDeclaredCapabilities),
    actionIds
  );
  const requestedApplicationGrants = deriveRequestedApplicationGrants(enabledActionIds, currentConfig.selectedConnectorId);
  const candidate: CapabilityDeclarationConfig = {
    enabledActionIds,
    requestedApplicationGrants,
    requestedScopes: [...requestedApplicationGrants],
    agentDeclaredCapabilities: [...enabledActionIds]
  };
  const errors: string[] = [];
  if (hasSecretMarker(input)) errors.push("Capability declaration must not include secrets or tokens.");
  if (candidate.agentDeclaredCapabilities.length === 0) errors.push("Agent-declared capabilities are required.");
  if (errors.length > 0) return { ok: false, errors };

  currentConfig.capabilityDeclaration = candidate;
  markConfigUpdated();
  return { ok: true, config: publicAdminConfig() };
}
