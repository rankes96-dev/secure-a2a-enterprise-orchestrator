import { randomUUID } from "node:crypto";
import { evaluateResourcePermissions, type ResourcePermissionRegistration } from "./resourcePermissions";
import { getSimulatedExternalAgentTrustResponse, isKnownSafeAgentBaseUrl } from "./simulatedExternalAgents";
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
  supportedCapabilities: string[];
  requestedScopes: string[];
  tokenEndpointAuthMethod: "private_key_jwt" | "client_secret_post" | "unknown";
  jwksUri: string;
  signatureVerified: boolean;
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
  supportedCapabilities: string[];
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
  signedResponseVerified: boolean;
  nonceMatched: boolean;
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

export type AgentOnboardingValidationResult =
  | {
      onboardingId: string;
      status: "trusted_metadata_only";
      trustLevel: AgentTrustLevel;
      agent: {
        agentId: string;
        issuer: string;
          clientId: string;
          audience: string;
      };
      agentProof: AgentProof;
      oauthApplicationProof: OAuthApplicationProof;
      resourcePermissionProof: ResourcePermissionProof;
      requestedScopes: string[];
      supportedCapabilities: string[];
      approvedCapabilities: DerivedCapability[];
      blockedCapabilities: DerivedCapability[];
      checks: AgentOnboardingCheck[];
      message: string;
      trustedAgent: TrustedOnboardedAgent;
    }
  | {
      error: "agent_onboarding_failed";
      details: string[];
      checks: AgentOnboardingCheck[];
    };

const trustedAgentsByOwner = new Map<string, TrustedOnboardedAgent[]>();

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function addCheck(checks: AgentOnboardingCheck[], name: string, passed: boolean, detail?: string): void {
  checks.push({ name, status: passed ? "passed" : "failed", ...(detail ? { detail } : {}) });
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
  supportedCapabilities: string[];
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

  for (const capability of params.supportedCapabilities) {
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

export function listTrustedOnboardedAgents(ownerKey: string): TrustedOnboardedAgent[] {
  return [...(trustedAgentsByOwner.get(ownerKey) ?? [])];
}

export function addTrustedOnboardedAgent(ownerKey: string, agent: TrustedOnboardedAgent): TrustedOnboardedAgent {
  const current = trustedAgentsByOwner.get(ownerKey) ?? [];
  trustedAgentsByOwner.set(ownerKey, [...current.filter((item) => item.agentId !== agent.agentId), agent]);
  return agent;
}

export function startAgentOnboarding(ownerKey: string, value: unknown): AgentOnboardingValidationResult {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const request: AgentOnboardingRequest = {
    agentBaseUrl: cleanString(input.agentBaseUrl),
    expectedAgentId: cleanString(input.expectedAgentId)
  };
  const checks: AgentOnboardingCheck[] = [];
  const details: string[] = [];

  if (!request.agentBaseUrl) details.push("agentBaseUrl is required.");
  if (!request.expectedAgentId) details.push("expectedAgentId is required.");
  if (request.agentBaseUrl && !isKnownSafeAgentBaseUrl(request.agentBaseUrl)) {
    details.push(`unsupported agentBaseUrl ${request.agentBaseUrl}. This phase only supports safe known mock URLs.`);
  }

  if (details.length > 0) {
    addCheck(checks, "safe_agent_base_url", false, details.join(" "));
    return { error: "agent_onboarding_failed", details, checks };
  }

  const challenge = createChallenge(request);
  checks.push({ name: "challenge_created", status: "passed" });

  const trustResponse = getSimulatedExternalAgentTrustResponse(challenge);
  if (!trustResponse) {
    details.push("external agent trust response could not be obtained from the safe simulator.");
    addCheck(checks, "external_agent_response_received", false);
    return { error: "agent_onboarding_failed", details, checks };
  }
  checks.push({ name: "external_agent_response_received", status: "passed" });

  addCheck(checks, "nonce_matched", trustResponse.nonce === challenge.nonce);
  if (trustResponse.nonce !== challenge.nonce) details.push("nonce did not match onboarding challenge.");

  addCheck(checks, "agent_id_matched", trustResponse.agentId === challenge.expectedAgentId);
  if (trustResponse.agentId !== challenge.expectedAgentId) details.push("external agentId did not match expectedAgentId.");

  addCheck(checks, "issuer_matched", trustResponse.issuer === challenge.agentBaseUrl);
  if (trustResponse.issuer !== challenge.agentBaseUrl) details.push("external agent issuer did not match agentBaseUrl.");

  addCheck(checks, "audience_matched", Boolean(trustResponse.audience));
  if (!trustResponse.audience) details.push("external agent audience is missing.");

  addCheck(checks, "signed_agent_response_verified", trustResponse.signatureVerified === true);
  if (!trustResponse.signatureVerified) details.push("simulated signed trust response was not verified.");

  const binding = validateOAuthApplicationBinding(trustResponse);
  addCheck(checks, "oauth_application_bound", binding.valid, binding.details.join(" "));
  addCheck(checks, "requested_scopes_granted", binding.valid && trustResponse.requestedScopes.every((scope) => binding.grantedScopes.includes(scope)));

  if (!binding.valid) {
    details.push(...binding.details);
  }

  const resourcePermissions = evaluateResourcePermissions(trustResponse.clientId, trustResponse.supportedCapabilities);
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
    supportedCapabilities: trustResponse.supportedCapabilities,
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
    supportedCapabilities: [...trustResponse.supportedCapabilities],
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
    agent: {
      agentId: trustResponse.agentId,
      issuer: trustResponse.issuer,
      clientId: trustResponse.clientId,
      audience: trustResponse.audience
    },
    agentProof: {
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
    requestedScopes: [...trustResponse.requestedScopes],
    supportedCapabilities: [...trustResponse.supportedCapabilities],
    approvedCapabilities: [...derivedCapabilities.approvedCapabilities],
    blockedCapabilities: [...derivedCapabilities.blockedCapabilities],
    checks,
    message: "External agent identity verified. Approved capabilities were derived from signed agent declarations, OAuth application grants, resource-system permissions, and gateway policy.",
    trustedAgent
  };
}
