import type { OgenActionCategory, OgenActionConstraints, OgenApprovalMode, OgenFieldClass, OgenResourceSensitivity, OgenToolMappingProof, OgenToolMappingStatus } from "@a2a/shared";
import type { ConnectorProfile } from "../connectors/types.js";
import type { InstalledConnectorLifecycle } from "../connectors/installedConnectorLifecycle.js";
import type { gatewayMetadata } from "../security/gatewayIdentity.js";

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
  expectedResourceSystem?: string;
  expectedConnectorId?: string;
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
  agentDeclaredSkills: string[];
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
  externalConfigHash?: string;
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
  externalConfigHash?: string;
  supportedConnectorProfileUrl?: string;
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

export type DerivedCapability = {
  capability: string;
  label?: string;
  reason: string;
  riskLevel?: "low" | "medium" | "high" | "sensitive";
  executionType?: "diagnostic_read_only" | "write_action" | "inspection_read_only" | "unsupported";
  requiresApproval?: boolean;
  sensitivity?: "standard" | "sensitive";
  actionCategory?: OgenActionCategory;
  approvalMode?: OgenApprovalMode;
  resourceSensitivity?: OgenResourceSensitivity;
  fieldClasses?: OgenFieldClass[];
  actionConstraints?: OgenActionConstraints;
  toolMappingStatus?: OgenToolMappingStatus;
  toolMappingProof?: OgenToolMappingProof;
  provider?: string;
  resourceSystem?: string;
  requiredApplicationGrants?: string[];
  requiredEffectivePermissions?: string[];
  requestedScopes?: string[];
  missingApplicationGrants?: string[];
  missingEffectivePermissions?: string[];
  deniedEffectivePermissions?: string[];
};

export type TrustedOnboardedAgent = {
  agentId: string;
  issuer: string;
  clientId: string;
  audience: string;
  runtimeEndpoint?: string;
  connectorProfileUrl?: string;
  connectorId?: string;
  resourceSystem?: string;
  connectorDisplayName?: string;
  externalConfigHash?: string;
  connectorProfileHash?: string;
  requestedScopes: string[];
  requestedApplicationGrants: string[];
  agentDeclaredSkills: string[];
  /** Compatibility alias for agentDeclaredSkills. */
  agentDeclaredCapabilities: string[];
  applicationAccessGrants: string[];
  grantedScopes: string[];
  effectivePermissions: string[];
  deniedPermissions: string[];
  approvedActions: DerivedCapability[];
  blockedActions: DerivedCapability[];
  /** Compatibility aliases for approvedActions / blockedActions. */
  approvedCapabilities: DerivedCapability[];
  blockedCapabilities: DerivedCapability[];
  connectorProfile?: Pick<ConnectorProfile, "connectorId" | "resourceSystem" | "displayName" | "version" | "profileSource" | "planning" | "validationTests">;
  connectorProfileVerified: boolean;
  connectorDecisionSource: string;
  lifecycle?: InstalledConnectorLifecycle;
  resourcePrincipal?: string;
  trustLevel: AgentTrustLevel;
  executable: false;
  executionState: "metadata_only";
  runtimeTrustSource?: "live_onboarding" | "stored_metadata";
  rehydratedFromStore?: boolean;
  tokenEndpointAuthMethod: "private-key-jwt" | "client-secret-post" | "unknown";
  oauthApplicationBound: boolean;
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
  externalConfigHash?: string;
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
        agentDeclaredSkills: string[];
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
      connectorProfile?: Pick<ConnectorProfile, "connectorId" | "resourceSystem" | "displayName" | "version" | "profileSource" | "validationTests">;
      connectorProfileVerified: boolean;
      connectorDecisionSource: string;
      skillDecision: {
        approvedActions: DerivedCapability[];
        blockedActions: DerivedCapability[];
      };
      /** Compatibility alias for skillDecision. */
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
