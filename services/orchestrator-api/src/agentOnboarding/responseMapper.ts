import type { ConnectorActionDecision, ConnectorProfile } from "../connectors/types.js";
import { deriveInstalledConnectorLifecycle } from "../connectors/installedConnectorLifecycle.js";
import type { ExternalAgentDiscovery, ExternalAgentTrustResponse, DerivedCapability, TrustedOnboardedAgent } from "./types.js";

export type ResourceRegistration = {
  resourceSystem: string;
  principal: string;
  clientId: string;
  effectivePermissions: string[];
  deniedPermissions: string[];
};

export type DerivedActionSet = {
  approvedActions: DerivedCapability[];
  blockedActions: DerivedCapability[];
  approvedCapabilities: DerivedCapability[];
  blockedCapabilities: DerivedCapability[];
};

export function publicTokenEndpointAuthMethod(method: ExternalAgentTrustResponse["tokenEndpointAuthMethod"]): TrustedOnboardedAgent["tokenEndpointAuthMethod"] {
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
    riskLevel: decision.riskLevel,
    executionType: decision.executionType,
    requiresApproval: decision.requiresApproval,
    sensitivity: decision.sensitivity,
    actionCategory: decision.actionCategory,
    approvalMode: decision.approvalMode,
    resourceSensitivity: decision.resourceSensitivity,
    fieldClasses: decision.fieldClasses ? [...decision.fieldClasses] : undefined,
    actionConstraints: decision.actionConstraints ? { ...decision.actionConstraints } : undefined,
    provider: decision.provider,
    resourceSystem: decision.resourceSystem,
    requiredApplicationGrants: [...decision.requiredApplicationGrants],
    requiredEffectivePermissions: [...decision.requiredEffectivePermissions],
    missingApplicationGrants: [...decision.missingApplicationGrants],
    missingEffectivePermissions: [...decision.missingEffectivePermissions],
    deniedEffectivePermissions: [...decision.deniedEffectivePermissions]
  };
}

export function blockAllDeclaredActions(declaredActions: string[], reason: string): DerivedActionSet {
  const blockedActions = declaredActions.map((capability) => ({ capability, label: capability, reason }));
  return {
    approvedActions: [],
    blockedActions,
    approvedCapabilities: [],
    blockedCapabilities: blockedActions
  };
}

export function deriveCapabilitiesFromConnectorDecisions(decisions: ConnectorActionDecision[]): DerivedActionSet {
  const approvedActions = decisions.filter((decision) => decision.status === "approved").map(decisionToDerived);
  const blockedActions = decisions.filter((decision) => decision.status === "blocked").map(decisionToDerived);
  return {
    approvedActions,
    blockedActions,
    approvedCapabilities: approvedActions,
    blockedCapabilities: blockedActions
  };
}

export function connectorProfileSummary(connectorProfile: ConnectorProfile | undefined): TrustedOnboardedAgent["connectorProfile"] {
  return connectorProfile
    ? {
        connectorId: connectorProfile.connectorId,
        resourceSystem: connectorProfile.resourceSystem,
        displayName: connectorProfile.displayName,
        version: connectorProfile.version,
        profileSource: connectorProfile.profileSource,
        planning: connectorProfile.planning,
        validationTests: connectorProfile.validationTests
      }
    : undefined;
}

export function buildResourceRegistration(trustResponse: ExternalAgentTrustResponse): ResourceRegistration | undefined {
  return trustResponse.servicePrincipal
    ? {
        resourceSystem: trustResponse.resourceSystem ?? "unknown",
        principal: trustResponse.servicePrincipal.principalId,
        clientId: trustResponse.clientId,
        effectivePermissions: [...trustResponse.servicePrincipal.effectivePermissions],
        deniedPermissions: [...trustResponse.servicePrincipal.deniedPermissions]
      }
    : undefined;
}

export function buildTrustedAgent(params: {
  trustResponse: ExternalAgentTrustResponse;
  discovery: ExternalAgentDiscovery;
  connectorProfile?: ConnectorProfile;
  derivedCapabilities: DerivedActionSet;
  resourceRegistration: ResourceRegistration;
  connectorProfileVerified: boolean;
  connectorDecisionSource: string;
  applicationAccessGrants: string[];
  grantedScopes: string[];
}): TrustedOnboardedAgent {
  const {
    trustResponse,
    discovery,
    connectorProfile,
    derivedCapabilities,
    resourceRegistration,
    connectorProfileVerified,
    connectorDecisionSource,
    applicationAccessGrants,
    grantedScopes
  } = params;

  const trustedAgent: TrustedOnboardedAgent = {
    agentId: trustResponse.agentId,
    issuer: trustResponse.issuer,
    clientId: trustResponse.clientId,
    audience: trustResponse.audience,
    runtimeEndpoint: discovery.runtimeEndpoint,
    connectorProfileUrl: discovery.connectorProfileUrl,
    connectorId: trustResponse.connectorId ?? discovery.connectorId,
    resourceSystem: trustResponse.resourceSystem ?? discovery.resourceSystem,
    connectorDisplayName: connectorProfile?.displayName ?? discovery.connectorDisplayName,
    externalConfigHash: trustResponse.externalConfigHash ?? discovery.externalConfigHash,
    connectorProfileHash: trustResponse.connectorProfileHash,
    requestedScopes: [...trustResponse.requestedScopes],
    requestedApplicationGrants: [...trustResponse.requestedApplicationGrants],
    agentDeclaredSkills: [...trustResponse.agentDeclaredSkills],
    agentDeclaredCapabilities: [...trustResponse.agentDeclaredCapabilities],
    applicationAccessGrants: [...applicationAccessGrants],
    grantedScopes: [...grantedScopes],
    effectivePermissions: [...resourceRegistration.effectivePermissions],
    deniedPermissions: [...resourceRegistration.deniedPermissions],
    approvedActions: [...derivedCapabilities.approvedActions],
    blockedActions: [...derivedCapabilities.blockedActions],
    approvedCapabilities: [...derivedCapabilities.approvedCapabilities],
    blockedCapabilities: [...derivedCapabilities.blockedCapabilities],
    connectorProfile: connectorProfileSummary(connectorProfile),
    connectorProfileVerified,
    connectorDecisionSource,
    resourcePrincipal: resourceRegistration.principal,
    trustLevel: "trusted_metadata_only",
    executable: false,
    executionState: "metadata_only",
    runtimeTrustSource: "live_onboarding",
    rehydratedFromStore: false,
    tokenEndpointAuthMethod: publicTokenEndpointAuthMethod(trustResponse.tokenEndpointAuthMethod),
    oauthApplicationBound: true
  };

  return {
    ...trustedAgent,
    lifecycle: deriveInstalledConnectorLifecycle(trustedAgent)
  };
}
