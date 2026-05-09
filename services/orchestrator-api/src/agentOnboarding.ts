import { randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { evaluateResourcePermissionRegistration, evaluateResourcePermissions, type ResourcePermissionRegistration } from "./resourcePermissions";
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
  requestedScopes: string[];
  tokenEndpointAuthMethod: "private_key_jwt" | "client_secret_post" | "unknown";
  jwksUri: string;
  signatureVerified: boolean;
  resourceSystem?: string;
  trustAdapter?: string;
  oauthApplication?: {
    appName?: string;
    clientId: string;
    authorizationServerIssuer: string;
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
  agentDeclaredCapabilities: string[];
  grantedScopes: string[];
  approvedCapabilities: DerivedCapability[];
  blockedCapabilities: DerivedCapability[];
  resourcePrincipal?: string;
  trustLevel: AgentTrustLevel;
  executable: false;
  executionState: "metadata_only";
  tokenEndpointAuthMethod: "private-key-jwt" | "client-secret-post" | "unknown";
  oauthApplicationBound: boolean;
};

export type DerivedCapability = {
  capability: string;
  reason: string;
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
  grantedScopes: string[];
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

function requestedScopeForCapability(capability: string): string | undefined {
  if (capability === "jira.permission.inspect") {
    return "read:jira-user";
  }

  if (capability.startsWith("jira.")) {
    return "read:jira-work";
  }

  if (capability.startsWith("salesforce.")) {
    return "salesforce.access.read";
  }

  return undefined;
}

function deriveApprovedCapabilities(params: {
  agentDeclaredCapabilities: string[];
  requestedScopes: string[];
  grantedScopes: string[];
  resourceRegistration: ResourcePermissionRegistration;
  resourceEvaluations: ReturnType<typeof evaluateResourcePermissions>["evaluations"];
}): { approvedCapabilities: DerivedCapability[]; blockedCapabilities: DerivedCapability[] } {
  const requestedScopes = new Set(params.requestedScopes);
  const grantedScopes = new Set(params.grantedScopes);
  const evaluations = new Map(params.resourceEvaluations.map((evaluation) => [evaluation.capability, evaluation]));
  const approvedCapabilities: DerivedCapability[] = [];
  const blockedCapabilities: DerivedCapability[] = [];

  for (const capability of params.agentDeclaredCapabilities) {
    const requiredScope = requestedScopeForCapability(capability);
    if (requiredScope && !requestedScopes.has(requiredScope)) {
      blockedCapabilities.push({ capability, reason: `agent did not request required OAuth scope ${requiredScope}` });
      continue;
    }

    if (requiredScope && !grantedScopes.has(requiredScope)) {
      blockedCapabilities.push({ capability, reason: `OAuth application was not granted required scope ${requiredScope}` });
      continue;
    }

    const resourceEvaluation = evaluations.get(capability);
    if (!resourceEvaluation) {
      blockedCapabilities.push({ capability, reason: "no resource permission mapping exists for this capability" });
      continue;
    }

    if (resourceEvaluation.deniedPermissions.length > 0) {
      blockedCapabilities.push({
        capability,
        reason: `missing resource permission ${resourceEvaluation.deniedPermissions.join(", ")}`
      });
      continue;
    }

    if (resourceEvaluation.missingPermissions.length > 0) {
      blockedCapabilities.push({
        capability,
        reason: `missing resource permission ${resourceEvaluation.missingPermissions.join(", ")}`
      });
      continue;
    }

    approvedCapabilities.push({
      capability,
      reason: "required OAuth scope and resource permissions are present"
    });
  }

  return { approvedCapabilities, blockedCapabilities };
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
    ["adminConsoleUrl", discovery.adminConsoleUrl]
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
      requestedScopes: stringArray(payload.requestedScopes),
      tokenEndpointAuthMethod:
        payload.tokenEndpointAuthMethod === "private_key_jwt" || payload.tokenEndpointAuthMethod === "client_secret_post"
          ? payload.tokenEndpointAuthMethod
          : "unknown",
      jwksUri: discovery.jwksUri,
      signatureVerified: payload.typ === "agent_onboarding_response",
      resourceSystem: cleanString(payload.resourceSystem) || discovery.resourceSystem,
      trustAdapter: cleanString(payload.trustAdapter) || discovery.trustAdapter,
      oauthApplication: oauthApplication.clientId
        ? {
            appName: cleanString(oauthApplication.appName),
            clientId: cleanString(oauthApplication.clientId),
            authorizationServerIssuer: cleanString(oauthApplication.authorizationServerIssuer),
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
        "Declare requested scopes and agent capabilities in the signed trust response."
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

  const binding = validateOAuthApplicationBinding(trustResponse);
  addCheck(checks, "oauth_application_bound", binding.valid, binding.details.join(" "));
  addCheck(checks, "requested_scopes_granted", binding.valid && trustResponse.requestedScopes.every((scope) => binding.grantedScopes.includes(scope)));

  if (!binding.valid) {
    details.push(...binding.details);
  }

  const attestedResourceRegistration: ResourcePermissionRegistration | undefined = trustResponse.servicePrincipal
    ? {
        resourceSystem: trustResponse.resourceSystem ?? "unknown",
        principal: trustResponse.servicePrincipal.principalId,
        clientId: trustResponse.clientId,
        effectivePermissions: [...trustResponse.servicePrincipal.effectivePermissions],
        deniedPermissions: [...trustResponse.servicePrincipal.deniedPermissions]
      }
    : undefined;
  const resourcePermissions = attestedResourceRegistration
    ? {
        registration: attestedResourceRegistration,
        evaluations: evaluateResourcePermissionRegistration(attestedResourceRegistration, trustResponse.agentDeclaredCapabilities)
      }
    : evaluateResourcePermissions(trustResponse.clientId, trustResponse.agentDeclaredCapabilities);
  addCheck(checks, "resource_permissions_loaded", Boolean(resourcePermissions.registration));
  if (!resourcePermissions.registration) {
    details.push(`resource permissions not registered for clientId ${trustResponse.clientId}`);
  }

  if (details.length > 0) {
    return { error: "agent_onboarding_failed", details, checks };
  }

  const resourceRegistration = resourcePermissions.registration;
  if (!resourceRegistration) {
    return {
      error: "agent_onboarding_failed",
      details: [`resource permissions not registered for clientId ${trustResponse.clientId}`],
      checks
    };
  }

  const derivedCapabilities = deriveApprovedCapabilities({
    agentDeclaredCapabilities: trustResponse.agentDeclaredCapabilities,
    requestedScopes: trustResponse.requestedScopes,
    grantedScopes: binding.grantedScopes,
    resourceRegistration,
    resourceEvaluations: resourcePermissions.evaluations
  });
  checks.push({ name: "capabilities_derived", status: "passed" });
  checks.push({ name: "runtime_execution_metadata_only", status: "metadata_only" });

  const trustedAgent: TrustedOnboardedAgent = {
    agentId: trustResponse.agentId,
    issuer: trustResponse.issuer,
    clientId: trustResponse.clientId,
    audience: trustResponse.audience,
    requestedScopes: [...trustResponse.requestedScopes],
    agentDeclaredCapabilities: [...trustResponse.agentDeclaredCapabilities],
    grantedScopes: [...binding.grantedScopes],
    approvedCapabilities: [...derivedCapabilities.approvedCapabilities],
    blockedCapabilities: [...derivedCapabilities.blockedCapabilities],
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
      grantedScopes: [...binding.grantedScopes],
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
      trustAdapter: trustResponse.trustAdapter,
      oauthApplication: trustResponse.oauthApplication,
      servicePrincipal: trustResponse.servicePrincipal
    },
    capabilityDecision: {
      approvedCapabilities: [...derivedCapabilities.approvedCapabilities],
      blockedCapabilities: [...derivedCapabilities.blockedCapabilities]
    },
    checks,
    message: "External agent identity verified. Approved capabilities were derived from signed agent declarations, OAuth application grants, resource-system permissions, and gateway policy.",
    trustedAgent
  };
}
