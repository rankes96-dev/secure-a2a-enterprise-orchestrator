import { randomUUID } from "node:crypto";
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
  capabilities: string[];
  scopes: string[];
  tokenEndpointAuthMethod: "private_key_jwt" | "client_secret_post" | "unknown";
  jwksUri: string;
  signatureVerified: boolean;
};

export type OAuthApplicationRegistration = {
  clientId: string;
  agentId: string;
  issuer: string;
  audience: string;
  allowedScopes: string[];
  allowedCapabilities: string[];
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
  verifiedCapabilities: string[];
  verifiedScopes: string[];
  trustLevel: AgentTrustLevel;
  executable: false;
  executionState: "metadata_only";
  tokenEndpointAuthMethod: "private-key-jwt" | "client-secret-post" | "unknown";
  oauthApplicationBound: boolean;
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
      verifiedCapabilities: string[];
      verifiedScopes: string[];
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

  addCheck(checks, "signed_response_verified", trustResponse.signatureVerified === true);
  if (!trustResponse.signatureVerified) details.push("simulated signed trust response was not verified.");

  const binding = validateOAuthApplicationBinding(trustResponse);
  addCheck(checks, "oauth_application_bound", binding.valid, binding.details.join(" "));
  addCheck(checks, "scopes_allowed", binding.valid && trustResponse.scopes.every((scope) => binding.allowedScopes.includes(scope)));
  addCheck(checks, "capabilities_allowed", binding.valid && trustResponse.capabilities.every((capability) => binding.allowedCapabilities.includes(capability)));
  checks.push({ name: "runtime_execution", status: "metadata_only" });

  if (!binding.valid) {
    details.push(...binding.details);
  }

  if (details.length > 0) {
    return { error: "agent_onboarding_failed", details, checks };
  }

  const trustedAgent: TrustedOnboardedAgent = {
    agentId: trustResponse.agentId,
    issuer: trustResponse.issuer,
    clientId: trustResponse.clientId,
    audience: trustResponse.audience,
    verifiedCapabilities: [...trustResponse.capabilities],
    verifiedScopes: [...trustResponse.scopes],
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
    verifiedCapabilities: [...trustResponse.capabilities],
    verifiedScopes: [...trustResponse.scopes],
    checks,
    message: "External agent identity verified. Capabilities and scopes were accepted from the verified agent response and bound to a registered OAuth application.",
    trustedAgent
  };
}
