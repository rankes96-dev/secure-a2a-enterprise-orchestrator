import { decideConnectorActions } from "../connectors/decisionEngine.js";
import { gatewayMetadata, gatewayPublicIdentity, signGatewayOnboardingChallenge } from "../security/gatewayIdentity.js";
import { validateOAuthApplicationBinding } from "../trustedOAuthApplications.js";
import { fetchExternalConnectorProfile, verifyConnectorProfileBinding } from "./connectorProfileFetcher.js";
import { discoverExternalAgent } from "./discovery.js";
import { createChallenge, parseOnboardingRequest, validateOnboardingRequest } from "./requestValidation.js";
import {
  blockAllDeclaredActions,
  buildResourceRegistration,
  buildTrustedAgent,
  connectorProfileSummary,
  deriveCapabilitiesFromConnectorDecisions,
  publicTokenEndpointAuthMethod
} from "./responseMapper.js";
import { persistTrustedOnboardedAgent } from "./trustedAgentStore.js";
import { requestExternalAgentTrustResponse } from "./trustResponseVerifier.js";
import type { AgentOnboardingCheck, AgentOnboardingDiscoveryResult, AgentOnboardingValidationResult } from "./types.js";

function addCheck(checks: AgentOnboardingCheck[], name: string, passed: boolean, detail?: string): void {
  checks.push({ name, status: passed ? "passed" : "failed", ...(detail ? { detail } : {}) });
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
  const discovered = await discoverExternalAgent(request);
  if (!discovered.discovery) {
    checks.push({ name: "external_agent_discovery", status: "failed", detail: discovered.details.join(" ") });
    return {
      discovered: false,
      error: "agent_discovery_failed",
      details: [
        "Discovery failed. Start the selected real-external-agent connector instance and ensure it exposes GET /.well-known/a2a-agent.json.",
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
        "Run Verify connection to require signed proof, OAuth binding, and action decision."
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
  const discovered = await discoverExternalAgent(request);
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

  addCheck(checks, "connector_identity_matched",
    (!discovery.connectorId || trustResponse.connectorId === discovery.connectorId) &&
      (!discovery.resourceSystem || trustResponse.resourceSystem === discovery.resourceSystem)
  );
  if (discovery.connectorId && trustResponse.connectorId !== discovery.connectorId) details.push("signed response connectorId did not match discovery connectorId.");
  if (discovery.resourceSystem && trustResponse.resourceSystem !== discovery.resourceSystem) details.push("signed response resourceSystem did not match discovery resourceSystem.");

  addCheck(checks, "signed_agent_response_verified", trustResponse.signatureVerified === true);
  if (!trustResponse.signatureVerified) details.push("signed external agent trust response was not verified.");

  const connectorProfileBinding = verifyConnectorProfileBinding({
    connectorProfile,
    connectorProfileDetails: connectorProfileResult.details,
    discovery,
    trustResponse
  });
  const connectorProfileVerified = connectorProfileBinding.verified;
  addCheck(checks, "connector_profile_verified", connectorProfileVerified, connectorProfileBinding.detail);

  const binding = validateOAuthApplicationBinding(trustResponse);
  addCheck(checks, "oauth_application_bound", binding.valid, binding.details.join(" "));
  addCheck(checks, "requested_scopes_granted", binding.valid);
  addCheck(checks, "application_access_grants_evaluated", binding.valid);

  if (!binding.valid) {
    details.push(...binding.details);
  }

  const resourceRegistration = buildResourceRegistration(trustResponse);
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
        declaredSkills: trustResponse.agentDeclaredSkills,
        declaredActions: trustResponse.agentDeclaredCapabilities,
        requestedApplicationGrants: trustResponse.requestedApplicationGrants,
        applicationAccessGrants: binding.applicationAccessGrants,
        effectivePermissions: resourceRegistration.effectivePermissions,
        deniedPermissions: resourceRegistration.deniedPermissions
      }))
    : blockAllDeclaredActions(trustResponse.agentDeclaredSkills, "connector profile missing or invalid");
  const connectorDecisionSource = connectorProfileVerified && connectorProfile ? connectorProfile.connectorId : "missing_connector_profile";
  checks.push({ name: "capabilities_derived", status: "passed" });
  checks.push({ name: "runtime_execution_metadata_only", status: "metadata_only" });

  const trustedAgent = buildTrustedAgent({
    trustResponse,
    discovery,
    connectorProfile,
    derivedCapabilities,
    resourceRegistration,
    connectorProfileVerified,
    connectorDecisionSource,
    applicationAccessGrants: binding.applicationAccessGrants,
    grantedScopes: binding.grantedScopes
  });
  await persistTrustedOnboardedAgent(ownerKey, trustedAgent);

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
      agentDeclaredSkills: [...trustResponse.agentDeclaredSkills],
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
      externalConfigHash: trustResponse.externalConfigHash,
      trustAdapter: trustResponse.trustAdapter,
      oauthApplication: trustResponse.oauthApplication,
      servicePrincipal: trustResponse.servicePrincipal
    },
    connectorProfile: connectorProfileSummary(connectorProfile),
    connectorProfileVerified,
    connectorDecisionSource,
    skillDecision: {
      approvedActions: [...derivedCapabilities.approvedActions],
      blockedActions: [...derivedCapabilities.blockedActions]
    },
    capabilityDecision: {
      approvedCapabilities: [...derivedCapabilities.approvedCapabilities],
      blockedCapabilities: [...derivedCapabilities.blockedCapabilities]
    },
    checks,
    message: "External agent identity verified. Approved actions were derived from signed agent declarations, application access grants, effective permissions, denied permissions, and gateway policy.",
    trustedAgent
  };
}
