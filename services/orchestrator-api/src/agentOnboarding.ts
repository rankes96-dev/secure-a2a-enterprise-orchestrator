import { randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { decideConnectorActions } from "./connectors/decisionEngine";
import { connectorProfileHash, validateConnectorProfile } from "./connectors/profileValidation";
import type { ConnectorActionDecision, ConnectorProfile } from "./connectors/types";
import { gatewayMetadata, gatewayPublicIdentity, signGatewayOnboardingChallenge } from "./security/gatewayIdentity";
import { validateOAuthApplicationBinding } from "./trustedOAuthApplications";

export type AgentTrustLevel =
  | "untrusted"
  | "schema_valid"
  | "oauth_bound"
  | "signed_response_verified"
  | "endpoint_control_verified"
  | "trusted_metadata_only"
  | "executable_pending_runtime_validation";

export type AgentOnboardingRequest = {
  agentBaseUrl: string;
  expectedAgentId: string;
};

export type AgentOnboardingChallenge = {
  onboardingId: string;
  nonce: string;
  agentBaseUrl: string;
  expectedAudience: "secure-a2a-gateway";
  expectedAgentId: string;
  expiresAt: string;
};

export type ExternalAgentTrustResponse = {
  onboardingId: string;
  agentId: string;
  issuer: string;
  clientId: string;
  audience: string;
  nonce: string;
  agentDeclaredCapabilities: string[];
  requestedApplicationGrants: string[];
  requestedScopes: string[];
  tokenEndpointAuthMethod: "private_key_jwt" | "client_secret_post" | "unknown";
  jwksUri: string;
  signatureVerified: boolean;
  resourceSystem?: string;
  connectorId?: string;
  connectorProfileUrl?: string;
  connectorProfileHash?: string;
  trustAdapter?: string;
  oauthApplication?: {
    appName?: string;
    clientId: string;
    authorizationServerIssuer: string;
    applicationAccessGrants: string[];
    grantedScopes: string[];
    tokenEndpointAuthMethod: "private_key_jwt" | "client_secret_post" | "unknown";
    status: "active" | "disabled" | "unknown";
  };
  servicePrincipal?: {
    principalType: string;
    principalId: string;
    effectivePermissions: string[];
    deniedPermissions: string[];
  };
};

export type ExternalAgentDiscovery = {
  agentId: string;
  issuer: string;
  resourceSystem?: string;
  connectorId?: string;
  connectorDisplayName?: string;
  connectorProfileUrl?: string;
  trustAdapter?: string;
  jwksUri: string;
  onboardingEndpoint: string;
  runtimeEndpoint: string;
  adminConsoleUrl?: string;
  auth: {
    audience: string;
    tokenEndpointAuthMethod: "private_key_jwt" | "client_secret_post" | "unknown";
  };
  connectionRequirements?: {
    requiresGatewayRegistration: boolean;
    requiresOAuthApplication: boolean;
    requiresServicePrincipal: boolean;
  };
};

export type OAuthApplicationRegistration = {
  clientId: string;
  agentId: string;
  issuer: string;
  audience: string;
  applicationAccessGrants: string[];
  grantedScopes: string[];
  tokenEndpointAuthMethod: "private_key_jwt" | "client_secret_post" | "unknown";
  status: "active" | "disabled";
};

export type AgentOnboardingCheck = {
  name: string;
  status: "passed" | "failed" | "metadata_only";
  detail?: string;
};

export type TrustedOnboardedAgent = {
  agentId: string;
  issuer: string;
  clientId: string;
  audience: string;
  requestedScopes: string[];
  requestedApplicationGrants: string[];
  agentDeclaredCapabilities: string[];
  applicationAccessGrants: string[];
  grantedScopes: string[];
  approvedCapabilities: DerivedCapability[];
  blockedCapabilities: DerivedCapability[];
  connectorProfile?: Pick<ConnectorProfile, "connectorId" | "resourceSystem" | "displayName" | "version" | "profileSource">;
  connectorProfileVerified: boolean;
  connectorDecisionSource: string;
  resourcePrincipal?: string;
  trustLevel: AgentTrustLevel;
  executable: false;
  executionState: "metadata_only";
  tokenEndpointAuthMethod: "private-key-jwt" | "client-secret-post" | "unknown";
  oauthApplicationBound: boolean;
};

export type DerivedCapability = {
  capability: string;
  label?: string;
  reason: string;
  requiredApplicationGrants?: string[];
  requiredEffectivePermissions?: string[];
  missingApplicationGrants?: string[];
  missingEffectivePermissions?: string[];
  deniedEffectivePermissions?: string[];
};

export type AgentProof = {
  discoveryFetched: boolean;
  externalAgentContacted: boolean;
  signedResponseVerified: boolean;
  nonceMatched: boolean;
};

export type GatewayProof = {
  gatewayClientId: string;
  gatewayIssuer: string;
  signedChallengeVerifiedByAgent: boolean;
  rawAssertionExposed: false;
};

export type OAuthApplicationProof = {
  clientBound: boolean;
  applicationAccessGrants: string[];
  grantedScopes: string[];
  missingRequestedApplicationGrants?: string[];
  allowedClientId?: string;
  tokenEndpointAuthMethod?: TrustedOnboardedAgent["tokenEndpointAuthMethod"];
  status?: "active" | "disabled";
};

export type ResourcePermissionProof = {
  principal: string;
  effectivePermissions: string[];
  deniedPermissions: string[];
};

export type ExternalApplicationAttestation = {
  resourceSystem?: string;
  connectorId?: string;
  connectorProfileUrl?: string;
  connectorProfileHash?: string;
  trustAdapter?: string;
  oauthApplication?: ExternalAgentTrustResponse["oauthApplication"];
  servicePrincipal?: ExternalAgentTrustResponse["servicePrincipal"];
};

export type AgentOnboardingValidationResult =
  | {
      onboardingId: string;
      status: "trusted_metadata_only";
      trustLevel: AgentTrustLevel;
      discoveredAgent: {
        agentId: string;
        issuer: string;
        clientId: string;
        audience: string;
        requestedScopes: string[];
        requestedApplicationGrants: string[];
        agentDeclaredCapabilities: string[];
      };
      agent: {
        agentId: string;
        issuer: string;
        clientId: string;
        audience: string;
      };
      gatewayProof: GatewayProof;
      agentProof: AgentProof;
      oauthApplicationProof: OAuthApplicationProof;
      resourcePermissionProof: ResourcePermissionProof;
      externalApplicationAttestation?: ExternalApplicationAttestation;
      connectorProfile?: Pick<ConnectorProfile, "connectorId" | "resourceSystem" | "displayName" | "version" | "profileSource">;
      connectorProfileVerified: boolean;
      connectorDecisionSource: string;
      capabilityDecision: {
        approvedCapabilities: DerivedCapability[];
        blockedCapabilities: DerivedCapability[];
      };
      checks: AgentOnboardingCheck[];
      message: string;
      trustedAgent: TrustedOnboardedAgent;
    }
  | {
      error: "agent_onboarding_failed";
      details: string[];
      checks: AgentOnboardingCheck[];
    };

export type AgentOnboardingDiscoveryResult =
  | {
      discovered: true;
      agentBaseUrl: string;
      expectedAgentId: string;
      discovery: ExternalAgentDiscovery;
      gatewayRegistration: ReturnType<typeof gatewayMetadata>;
      connectionInstructions: {
        admin: string[];
        externalAgentDeveloper: string[];
      };
      checks: AgentOnboardingCheck[];
    }
  | {
      discovered: false;
      error: "agent_discovery_failed";
      details: string[];
      checks: AgentOnboardingCheck[];
      gatewayRegistration: ReturnType<typeof gatewayMetadata>;
    };

const trustedAgentsByOwner = new Map<string, TrustedOnboardedAgent[]>();
const httpTimeoutMs = 2_000;
const maxDiscoveryJsonBytes = 32_000;
const maxConnectorProfileJsonBytes = 64_000;
const maxOnboardingJsonBytes = 64_000;
const allowedAgentBaseUrls = new Set(["http://localhost:4201"]);

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function addCheck(checks: AgentOnboardingCheck[], name: string, passed: boolean, detail?: string): void {
  checks.push({ name, status: passed ? "passed" : "failed", ...(detail ? { detail } : {}) });
}

function normalizeAgentBaseUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = "";
    const normalized = parsed.toString().replace(/\/+$/, "");
    return normalized;
  } catch {
    return undefined;
  }
}

function isLocalhost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function isPrivateIp(hostname: string): boolean {
  return (
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    /^169\.254\./.test(hostname)
  );
}

function validateSafeExternalUrl(value: string, expectedOrigin: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      return "URL credentials are not allowed.";
    }
    if (parsed.origin !== expectedOrigin) {
      return "URL origin must match the allowlisted external agent base URL.";
    }
    if (parsed.protocol === "http:" && !isLocalhost(parsed.hostname)) {
      return "HTTP is allowed only for localhost development agents.";
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "Only HTTP localhost or HTTPS URLs are allowed.";
    }
    if (isPrivateIp(parsed.hostname) && !isLocalhost(parsed.hostname)) {
      return "Private IP agent URLs are blocked except localhost development agents.";
    }
    return undefined;
  } catch {
    return "Malformed URL.";
  }
}

function createChallenge(input: AgentOnboardingRequest): AgentOnboardingChallenge {
  return {
    onboardingId: randomUUID(),
    nonce: randomUUID(),
    agentBaseUrl: input.agentBaseUrl,
    expectedAudience: "secure-a2a-gateway",
    expectedAgentId: input.expectedAgentId,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
  };
}

function parseOnboardingRequest(value: unknown): AgentOnboardingRequest {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  const rawAgentBaseUrl = cleanString(input.agentBaseUrl);
  return {
    agentBaseUrl: normalizeAgentBaseUrl(rawAgentBaseUrl) ?? rawAgentBaseUrl,
    expectedAgentId: cleanString(input.expectedAgentId)
  };
}

function validateOnboardingRequest(request: AgentOnboardingRequest): string[] {
  const details: string[] = [];
  if (!request.agentBaseUrl) details.push("agentBaseUrl is required.");
  if (!request.expectedAgentId) details.push("expectedAgentId is required.");
  if (request.agentBaseUrl && !allowedAgentBaseUrls.has(request.agentBaseUrl)) {
    details.push(`unsupported agentBaseUrl ${request.agentBaseUrl}. This phase only supports http://localhost:4201.`);
  }
  if (request.agentBaseUrl) {
    const unsafe = validateSafeExternalUrl(request.agentBaseUrl, request.agentBaseUrl);
    if (unsafe) {
      details.push(unsafe);
    }
  }

  return details;
}

function publicTokenEndpointAuthMethod(method: ExternalAgentTrustResponse["tokenEndpointAuthMethod"]): TrustedOnboardedAgent["tokenEndpointAuthMethod"] {
  if (method === "private_key_jwt") {
    return "private-key-jwt";
  }

  if (method === "client_secret_post") {
    return "client-secret-post";
  }

  return "unknown";
}

function decisionToDerived(decision: ConnectorActionDecision): DerivedCapability {
  return {
    capability: decision.actionId,
    label: decision.label,
    reason: decision.reason,
    requiredApplicationGrants: [...decision.requiredApplicationGrants],
    requiredEffectivePermissions: [...decision.requiredEffectivePermissions],
    missingApplicationGrants: [...decision.missingApplicationGrants],
    missingEffectivePermissions: [...decision.missingEffectivePermissions],
    deniedEffectivePermissions: [...decision.deniedEffectivePermissions]
  };
}

function blockAllDeclaredActions(declaredActions: string[], reason: string): { approvedCapabilities: DerivedCapability[]; blockedCapabilities: DerivedCapability[] } {
  return {
    approvedCapabilities: [],
    blockedCapabilities: declaredActions.map((capability) => ({ capability, label: capability, reason }))
  };
}

function deriveCapabilitiesFromConnectorDecisions(decisions: ConnectorActionDecision[]): { approvedCapabilities: DerivedCapability[]; blockedCapabilities: DerivedCapability[] } {
  return {
    approvedCapabilities: decisions.filter((decision) => decision.status === "approved").map(decisionToDerived),
    blockedCapabilities: decisions.filter((decision) => decision.status === "blocked").map(decisionToDerived)
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function externalStatus(value: unknown): "active" | "disabled" | "unknown" {
  return value === "active" || value === "disabled" ? value : "unknown";
}

async function fetchJsonWithLimit<T>(url: string, init: RequestInit, maxBytes: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), httpTimeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error("Redirects are not allowed during agent onboarding.");
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > maxBytes) {
      throw new Error("Response exceeded JSON size limit.");
    }
    const text = await response.text();
    if (text.length > maxBytes) {
      throw new Error("Response exceeded JSON size limit.");
    }
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function validateDiscovery(value: unknown, agentBaseUrl: string, expectedAgentId: string): { discovery?: ExternalAgentDiscovery; details: string[] } {
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
  if (discovery.agentId && discovery.agentId !== expectedAgentId) {
    details.push("discovery agentId did not match expectedAgentId.");
  }
  if (discovery.issuer && discovery.issuer !== agentBaseUrl) {
    details.push("discovery issuer did not match agentBaseUrl.");
  }

  for (const [label, url] of [
    ["issuer", discovery.issuer],
    ["jwksUri", discovery.jwksUri],
    ["onboardingEndpoint", discovery.onboardingEndpoint],
    ["runtimeEndpoint", discovery.runtimeEndpoint],
    ["adminConsoleUrl", discovery.adminConsoleUrl],
    ["connectorProfileUrl", discovery.connectorProfileUrl]
  ] as const) {
    if (url) {
      const unsafe = validateSafeExternalUrl(url, agentBaseUrl);
      if (unsafe) {
        details.push(`${label}: ${unsafe}`);
      }
    }
  }

  return details.length > 0 ? { details } : { discovery, details };
}

async function discoverExternalAgent(agentBaseUrl: string, expectedAgentId: string): Promise<{ discovery?: ExternalAgentDiscovery; details: string[] }> {
  const discoveryUrl = `${agentBaseUrl}/.well-known/a2a-agent.json`;
  try {
    const body = await fetchJsonWithLimit<unknown>(discoveryUrl, { method: "GET" }, maxDiscoveryJsonBytes);
    return validateDiscovery(body, agentBaseUrl, expectedAgentId);
  } catch (error) {
    return {
      details: [`external agent discovery failed: ${error instanceof Error ? error.message : "unknown error"}`]
    };
  }
}

async function fetchExternalConnectorProfile(discovery: ExternalAgentDiscovery, agentBaseUrl: string): Promise<{ profile?: ConnectorProfile; details: string[] }> {
  const connectorProfileUrl = discovery.connectorProfileUrl;
  if (!connectorProfileUrl) {
    return { details: ["connector profile URL is missing from discovery."] };
  }

  const unsafe = validateSafeExternalUrl(connectorProfileUrl, agentBaseUrl);
  if (unsafe) {
    return { details: [`connectorProfileUrl: ${unsafe}`] };
  }

  try {
    const body = await fetchJsonWithLimit<unknown>(connectorProfileUrl, { method: "GET" }, maxConnectorProfileJsonBytes);
    const validated = validateConnectorProfile(body);
    if (!validated.profile) {
      return { details: validated.details };
    }
    if (discovery.connectorId && validated.profile.connectorId !== discovery.connectorId) {
      return { details: ["connector profile connectorId did not match discovery connectorId."] };
    }
    if (discovery.resourceSystem && validated.profile.resourceSystem !== discovery.resourceSystem) {
      return { details: ["connector profile resourceSystem did not match discovery resourceSystem."] };
    }
    return { profile: validated.profile, details: [] };
  } catch (error) {
    return {
      details: [`connector profile fetch failed: ${error instanceof Error ? error.message : "unknown error"}`]
    };
  }
}

async function requestExternalAgentTrustResponse(challenge: AgentOnboardingChallenge, discovery: ExternalAgentDiscovery, gatewayAssertion: string): Promise<ExternalAgentTrustResponse | undefined> {
  const gateway = gatewayPublicIdentity();
  try {
    const body = await fetchJsonWithLimit<{ signedTrustResponse?: unknown; agentId?: unknown }>(discovery.onboardingEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
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
      agentDeclaredCapabilities: stringArray(payload.agentDeclaredCapabilities),
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

export function listTrustedOnboardedAgents(ownerKey: string): TrustedOnboardedAgent[] {
  return [...(trustedAgentsByOwner.get(ownerKey) ?? [])];
}

export function addTrustedOnboardedAgent(ownerKey: string, agent: TrustedOnboardedAgent): TrustedOnboardedAgent {
  const current = trustedAgentsByOwner.get(ownerKey) ?? [];
  trustedAgentsByOwner.set(ownerKey, [...current.filter((item) => item.agentId !== agent.agentId), agent]);
  return agent;
}

export async function discoverAgentOnboarding(value: unknown): Promise<AgentOnboardingDiscoveryResult> {
  const request = parseOnboardingRequest(value);
  const checks: AgentOnboardingCheck[] = [];
  const details = validateOnboardingRequest(request);
  const gatewayRegistration = gatewayMetadata();

  if (details.length > 0) {
    addCheck(checks, "safe_agent_base_url", false, details.join(" "));
    return { discovered: false, error: "agent_discovery_failed", details, checks, gatewayRegistration };
  }

  checks.push({ name: "safe_agent_base_url", status: "passed" });
  const discovered = await discoverExternalAgent(request.agentBaseUrl, request.expectedAgentId);
  if (!discovered.discovery) {
    checks.push({ name: "external_agent_discovery", status: "failed", detail: discovered.details.join(" ") });
    return {
      discovered: false,
      error: "agent_discovery_failed",
      details: [
        "Discovery failed. Start real-external-agent on http://localhost:4201 and ensure it exposes GET /.well-known/a2a-agent.json.",
        ...discovered.details
      ],
      checks,
      gatewayRegistration
    };
  }

  checks.push({ name: "external_agent_discovery", status: "passed" });
  const connectorProfileResult = await fetchExternalConnectorProfile(discovered.discovery, request.agentBaseUrl);
  addCheck(checks, "connector_profile_fetched", Boolean(connectorProfileResult.profile), connectorProfileResult.details.join(" "));
  return {
    discovered: true,
    agentBaseUrl: request.agentBaseUrl,
    expectedAgentId: request.expectedAgentId,
    discovery: discovered.discovery,
    gatewayRegistration,
    connectionInstructions: {
      admin: [
        "Copy the Gateway registration JSON into the external agent admin/config screen.",
        "Verify the OAuth application registration and service principal permissions before completing onboarding.",
        "Run Verify connection to require signed proof, OAuth binding, and capability derivation."
      ],
      externalAgentDeveloper: [
        "Publish discovery and public JWKS endpoints.",
        "Validate signed Gateway challenges before returning a signed trust response.",
        "Declare requested application access grants and agent actions in the signed trust response."
      ]
    },
    checks
  };
}

export async function startAgentOnboarding(ownerKey: string, value: unknown): Promise<AgentOnboardingValidationResult> {
  const request = parseOnboardingRequest(value);
  const checks: AgentOnboardingCheck[] = [];
  const details = validateOnboardingRequest(request);

  if (details.length > 0) {
    addCheck(checks, "safe_agent_base_url", false, details.join(" "));
    return { error: "agent_onboarding_failed", details, checks };
  }

  checks.push({ name: "safe_agent_base_url", status: "passed" });
  const discovered = await discoverExternalAgent(request.agentBaseUrl, request.expectedAgentId);
  if (!discovered.discovery) {
    details.push(...discovered.details);
    addCheck(checks, "external_agent_discovery", false, discovered.details.join(" "));
    return { error: "agent_onboarding_failed", details, checks };
  }
  const discovery = discovered.discovery;
  checks.push({ name: "external_agent_discovery", status: "passed" });

  const connectorProfileResult = await fetchExternalConnectorProfile(discovery, request.agentBaseUrl);
  const connectorProfile = connectorProfileResult.profile;
  addCheck(checks, "connector_profile_fetched", Boolean(connectorProfile), connectorProfileResult.details.join(" "));

  const challenge = createChallenge(request);
  checks.push({ name: "challenge_created", status: "passed" });
  const gatewayAssertion = await signGatewayOnboardingChallenge(challenge);
  const gateway = gatewayPublicIdentity();
  checks.push({ name: "gateway_identity_verified", status: "passed" });

  const trustResponse = await requestExternalAgentTrustResponse(challenge, discovery, gatewayAssertion);
  if (!trustResponse) {
    details.push("external agent trust response could not be obtained or verified.");
    addCheck(checks, "external_agent_contacted", false);
    return { error: "agent_onboarding_failed", details, checks };
  }
  checks.push({ name: "external_agent_contacted", status: "passed" });
  checks.push({ name: "external_agent_response_received", status: "passed" });
  checks.push({ name: "signed_gateway_challenge_verified", status: "passed" });

  addCheck(checks, "nonce_matched", trustResponse.nonce === challenge.nonce);
  if (trustResponse.nonce !== challenge.nonce) details.push("nonce did not match onboarding challenge.");

  addCheck(checks, "agent_id_matched", trustResponse.agentId === challenge.expectedAgentId);
  if (trustResponse.agentId !== challenge.expectedAgentId) details.push("external agentId did not match expectedAgentId.");

  addCheck(checks, "issuer_matched", trustResponse.issuer === discovery.issuer);
  if (trustResponse.issuer !== discovery.issuer) details.push("external agent issuer did not match discovery issuer.");

  addCheck(checks, "audience_matched", trustResponse.audience === discovery.auth.audience);
  if (trustResponse.audience !== discovery.auth.audience) details.push("external agent audience did not match discovery auth audience.");

  addCheck(checks, "signed_agent_response_verified", trustResponse.signatureVerified === true);
  if (!trustResponse.signatureVerified) details.push("signed external agent trust response was not verified.");

  const connectorProfileHashMatches = Boolean(
    connectorProfile &&
      (!trustResponse.connectorProfileHash || connectorProfileHash(connectorProfile) === trustResponse.connectorProfileHash)
  );
  const connectorProfileIdentityMatches = Boolean(
    connectorProfile &&
      (!trustResponse.connectorId || connectorProfile.connectorId === trustResponse.connectorId) &&
      (!trustResponse.resourceSystem || connectorProfile.resourceSystem === trustResponse.resourceSystem) &&
      (!trustResponse.connectorProfileUrl || trustResponse.connectorProfileUrl === discovery.connectorProfileUrl)
  );
  const connectorProfileVerified = Boolean(connectorProfile && connectorProfileHashMatches && connectorProfileIdentityMatches);
  const connectorProfileDetails = [
    ...(connectorProfileResult.details.length ? connectorProfileResult.details : []),
    connectorProfile && !connectorProfileHashMatches ? "connector profile hash did not match signed trust response." : "",
    connectorProfile && !connectorProfileIdentityMatches ? "connector profile identity did not match signed trust response." : ""
  ].filter(Boolean).join(" ");
  addCheck(checks, "connector_profile_verified", connectorProfileVerified, connectorProfileDetails);

  const binding = validateOAuthApplicationBinding(trustResponse);
  addCheck(checks, "oauth_application_bound", binding.valid, binding.details.join(" "));
  addCheck(checks, "requested_scopes_granted", binding.valid);
  addCheck(checks, "application_access_grants_evaluated", binding.valid);

  if (!binding.valid) {
    details.push(...binding.details);
  }

  const resourceRegistration = trustResponse.servicePrincipal
    ? {
        resourceSystem: trustResponse.resourceSystem ?? "unknown",
        principal: trustResponse.servicePrincipal.principalId,
        clientId: trustResponse.clientId,
        effectivePermissions: [...trustResponse.servicePrincipal.effectivePermissions],
        deniedPermissions: [...trustResponse.servicePrincipal.deniedPermissions]
      }
    : undefined;
  addCheck(checks, "resource_permissions_loaded", Boolean(resourceRegistration));
  if (!resourceRegistration) {
    details.push(`resource permissions not registered for clientId ${trustResponse.clientId}`);
  }

  if (details.length > 0) {
    return { error: "agent_onboarding_failed", details, checks };
  }

  if (!resourceRegistration) {
    return {
      error: "agent_onboarding_failed",
      details: [`resource permissions not registered for clientId ${trustResponse.clientId}`],
      checks
    };
  }

  const derivedCapabilities = connectorProfileVerified && connectorProfile
    ? deriveCapabilitiesFromConnectorDecisions(decideConnectorActions({
        connectorProfile,
        agentId: trustResponse.agentId,
        clientId: trustResponse.clientId,
        declaredActions: trustResponse.agentDeclaredCapabilities,
        requestedApplicationGrants: trustResponse.requestedApplicationGrants,
        applicationAccessGrants: binding.applicationAccessGrants,
        effectivePermissions: resourceRegistration.effectivePermissions,
        deniedPermissions: resourceRegistration.deniedPermissions
      }))
    : blockAllDeclaredActions(trustResponse.agentDeclaredCapabilities, "connector profile missing or invalid");
  const connectorDecisionSource = connectorProfileVerified && connectorProfile ? connectorProfile.connectorId : "missing_connector_profile";
  checks.push({ name: "capabilities_derived", status: "passed" });
  checks.push({ name: "runtime_execution_metadata_only", status: "metadata_only" });

  const trustedAgent: TrustedOnboardedAgent = {
    agentId: trustResponse.agentId,
    issuer: trustResponse.issuer,
    clientId: trustResponse.clientId,
    audience: trustResponse.audience,
    requestedScopes: [...trustResponse.requestedScopes],
    requestedApplicationGrants: [...trustResponse.requestedApplicationGrants],
    agentDeclaredCapabilities: [...trustResponse.agentDeclaredCapabilities],
    applicationAccessGrants: [...binding.applicationAccessGrants],
    grantedScopes: [...binding.grantedScopes],
    approvedCapabilities: [...derivedCapabilities.approvedCapabilities],
    blockedCapabilities: [...derivedCapabilities.blockedCapabilities],
    connectorProfile: connectorProfile
      ? {
          connectorId: connectorProfile.connectorId,
          resourceSystem: connectorProfile.resourceSystem,
          displayName: connectorProfile.displayName,
          version: connectorProfile.version,
          profileSource: connectorProfile.profileSource
        }
      : undefined,
    connectorProfileVerified,
    connectorDecisionSource,
    resourcePrincipal: resourceRegistration.principal,
    trustLevel: "trusted_metadata_only",
    executable: false,
    executionState: "metadata_only",
    tokenEndpointAuthMethod: publicTokenEndpointAuthMethod(trustResponse.tokenEndpointAuthMethod),
    oauthApplicationBound: true
  };
  addTrustedOnboardedAgent(ownerKey, trustedAgent);

  return {
    onboardingId: challenge.onboardingId,
    status: "trusted_metadata_only",
    trustLevel: "trusted_metadata_only",
    discoveredAgent: {
      agentId: trustResponse.agentId,
      issuer: trustResponse.issuer,
      clientId: trustResponse.clientId,
      audience: trustResponse.audience,
      requestedScopes: [...trustResponse.requestedScopes],
      requestedApplicationGrants: [...trustResponse.requestedApplicationGrants],
      agentDeclaredCapabilities: [...trustResponse.agentDeclaredCapabilities]
    },
    agent: {
      agentId: trustResponse.agentId,
      issuer: trustResponse.issuer,
      clientId: trustResponse.clientId,
      audience: trustResponse.audience
    },
    gatewayProof: {
      gatewayClientId: gateway.clientId,
      gatewayIssuer: gateway.issuer,
      signedChallengeVerifiedByAgent: true,
      rawAssertionExposed: false
    },
    agentProof: {
      discoveryFetched: true,
      externalAgentContacted: true,
      signedResponseVerified: trustResponse.signatureVerified === true,
      nonceMatched: trustResponse.nonce === challenge.nonce
    },
    oauthApplicationProof: {
      clientBound: binding.valid,
      applicationAccessGrants: [...binding.applicationAccessGrants],
      grantedScopes: [...binding.grantedScopes],
      missingRequestedApplicationGrants: trustResponse.requestedApplicationGrants.filter((grant) => !binding.applicationAccessGrants.includes(grant)),
      allowedClientId: binding.registration?.clientId,
      tokenEndpointAuthMethod: publicTokenEndpointAuthMethod(trustResponse.tokenEndpointAuthMethod),
      status: binding.registration?.status
    },
    resourcePermissionProof: {
      principal: resourceRegistration.principal,
      effectivePermissions: [...resourceRegistration.effectivePermissions],
      deniedPermissions: [...resourceRegistration.deniedPermissions]
    },
    externalApplicationAttestation: {
      resourceSystem: trustResponse.resourceSystem,
      connectorId: trustResponse.connectorId,
      connectorProfileUrl: trustResponse.connectorProfileUrl,
      connectorProfileHash: trustResponse.connectorProfileHash,
      trustAdapter: trustResponse.trustAdapter,
      oauthApplication: trustResponse.oauthApplication,
      servicePrincipal: trustResponse.servicePrincipal
    },
    connectorProfile: connectorProfile
      ? {
          connectorId: connectorProfile.connectorId,
          resourceSystem: connectorProfile.resourceSystem,
          displayName: connectorProfile.displayName,
          version: connectorProfile.version,
          profileSource: connectorProfile.profileSource
        }
      : undefined,
    connectorProfileVerified,
    connectorDecisionSource,
    capabilityDecision: {
      approvedCapabilities: [...derivedCapabilities.approvedCapabilities],
      blockedCapabilities: [...derivedCapabilities.blockedCapabilities]
    },
    checks,
    message: "External agent identity verified. Approved actions were derived from signed agent declarations, application access grants, effective permissions, denied permissions, and gateway policy.",
    trustedAgent
  };
}
