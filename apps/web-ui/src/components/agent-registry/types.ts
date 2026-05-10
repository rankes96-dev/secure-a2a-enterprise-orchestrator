import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";

export type ConnectionAudience = "bizapps" | "developer";

export type ConnectionWizardStep =
  | "overview"
  | "gateway-registration"
  | "connection-input"
  | "discovery"
  | "verify"
  | "result";

export type GuidedFocusTarget =
  | "demo-guide"
  | "run-task"
  | "composer"
  | "gateway-response"
  | "security-summary"
  | "trust-login"
  | "agent-registry"
  | "connector-catalog"
  | "zero-trust-onboarding"
  | "registered-agents"
  | "legacy-agents"
  | "security-timeline";

export type ActiveTab = "demo-guide" | "run-task" | "agent-registry" | "trust-identity" | "security-timeline";

export type LocalConnectorPreset = {
  label: string;
  agentBaseUrl: string;
  expectedAgentId: string;
  expectedResourceSystem: string;
  expectedConnectorId: string;
};

export type ConnectorTemplate = {
  resourceSystem: string;
  connectorId: string;
  displayName: string;
  status: "available" | "coming_soon" | "planned";
  source?: "local_reference" | "custom_sdk";
  description?: string;
  category?: "ITSM" | "DevOps" | "Work Management" | "Custom";
  publisher?: string;
  templateVersion?: string;
  authModel?: "oauth_application_with_service_account" | "custom_sdk_contract";
  runtimeSupport?: "supported" | "planned" | "not_supported";
  riskLevel?: "low" | "medium" | "high";
  tags?: string[];
  setupRequirements?: string[];
  installed?: boolean;
  installedCount?: number;
};

export type ConnectorAction = {
  capability: string;
  label?: string;
  reason: string;
  requiredApplicationGrants?: string[];
  requiredEffectivePermissions?: string[];
  missingApplicationGrants?: string[];
  missingEffectivePermissions?: string[];
  deniedEffectivePermissions?: string[];
};

export type OnboardingCheck = {
  name: string;
  status: "passed" | "failed" | "metadata_only" | "pending" | string;
  detail?: string;
};

export type ConnectorProfileSummary = {
  connectorId: string;
  resourceSystem: string;
  displayName: string;
  version?: string;
  profileSource?: "external_agent" | "built_in_reference" | "custom_connector";
};

export type TrustedOnboardedAgent = {
  agentId: string;
  issuer?: string;
  clientId?: string;
  audience?: string;
  runtimeEndpoint?: string;
  connectorProfileUrl?: string;
  connectorId?: string;
  resourceSystem?: string;
  connectorDisplayName?: string;
  requestedScopes?: string[];
  requestedApplicationGrants?: string[];
  agentDeclaredSkills?: string[];
  agentDeclaredCapabilities?: string[];
  applicationAccessGrants?: string[];
  grantedScopes?: string[];
  approvedActions?: ConnectorAction[];
  blockedActions?: ConnectorAction[];
  approvedCapabilities?: ConnectorAction[];
  blockedCapabilities?: ConnectorAction[];
  connectorProfileVerified?: boolean;
  lifecycle?: {
    state: "installed" | "verified" | "runtime_ready" | "needs_reverification" | "runtime_blocked" | "disabled" | "revoked";
    label: string;
    reason: string;
  };
  externalConfigHash?: string;
  connectorProfileHash?: string;
  resourcePrincipal?: string;
  trustLevel?: string;
  oauthApplicationBound?: boolean;
  executable?: boolean;
  executionState?: "metadata_only";
};

export type RegisteredAgentRow = TrustedOnboardedAgent & {
  status: string;
  endpointType: "public" | "session" | "unknown" | "internal";
  endpointScheme: "https" | "http" | "session" | "unknown";
  authMode: string;
  latencyMs?: number;
  agentCardAvailable: boolean;
  error?: string;
  canDelete: boolean;
  source: "zero-trust-onboarded" | "built-in" | "infrastructure";
};

export type GatewayRegistrationMetadata = {
  gatewayId: string;
  clientId: string;
  issuer: string;
  jwksUri: string;
  supportedOnboardingMethods: string[];
};

export type AgentOnboardingDiscoveryResult = {
  checks: OnboardingCheck[];
  discovery: {
    agentId: string;
    issuer: string;
    clientId?: string;
    audience?: string;
    requestedScopes?: string[];
    agentDeclaredSkills?: string[];
    agentDeclaredCapabilities?: string[];
    connectorDisplayName?: string;
    connectorId?: string;
    resourceSystem?: string;
    jwksUri: string;
    onboardingEndpoint: string;
    runtimeEndpoint: string;
    connectorProfileUrl?: string;
    adminConsoleUrl?: string;
    auth: {
      audience?: string;
      tokenEndpointAuthMethod?: string;
    };
    connectionRequirements?: {
      requiresGatewayRegistration?: boolean;
      requiresOAuthApplication?: boolean;
      requiresServicePrincipal?: boolean;
    };
  };
  gatewayRegistration?: GatewayRegistrationMetadata;
  connectionInstructions?: {
    admin: string[];
    externalAgentDeveloper: string[];
  };
};

export type AgentOnboardingResult = {
  checks: OnboardingCheck[];
  skillDecision?: {
    approvedActions: ConnectorAction[];
    blockedActions: ConnectorAction[];
  };
  capabilityDecision: {
    approvedCapabilities: ConnectorAction[];
    blockedCapabilities: ConnectorAction[];
  };
  trustedAgent: TrustedOnboardedAgent;
  connectorProfile?: ConnectorProfileSummary;
  connectorProfileVerified?: boolean;
  connectorDecisionSource?: string;
  externalApplicationAttestation?: {
    resourceSystem?: string;
    connectorId?: string;
    connectorDisplayName?: string;
    externalConfigHash?: string;
    connectorProfileHash?: string;
    oauthApplication?: {
      clientId?: string;
      appName?: string;
      authorizationServerIssuer?: string;
      applicationAccessGrants?: string[];
      grantedScopes?: string[];
      status?: string;
    };
    servicePrincipal?: {
      principalId?: string;
      effectivePermissions?: string[];
      deniedPermissions?: string[];
    };
  };
  discoveredAgent: {
    agentId?: string;
    issuer?: string;
    clientId?: string;
    requestedScopes?: string[];
    agentDeclaredSkills?: string[];
    agentDeclaredCapabilities?: string[];
  };
  oauthApplicationProof: {
    clientBound: boolean;
    grantedScopes: string[];
    applicationAccessGrants?: string[];
    tokenEndpointAuthMethod?: string;
    status?: string;
  };
  resourcePermissionProof: {
    principal?: string;
    effectivePermissions?: string[];
    deniedPermissions?: string[];
  };
  message?: string;
};

export type AgentRegistryContext = {
  health: { orchestrator: { status: string; authMode?: string } } | null;
  healthError: string;
  isHealthLoading: boolean;
  isLoading: boolean;
  zeroTrustAgentBaseUrl: string;
  setZeroTrustAgentBaseUrl: (value: string) => void;
  zeroTrustExpectedAgentId: string;
  setZeroTrustExpectedAgentId: (value: string) => void;
  setActiveTab: Dispatch<SetStateAction<ActiveTab>>;
  setZeroTrustDiscovery: (value: null) => void;
  setZeroTrustResult: (value: null) => void;
  setZeroTrustCopyMessage: (value: string) => void;
  zeroTrustExpectedResourceSystem: string;
  setZeroTrustExpectedResourceSystem: (value: string) => void;
  zeroTrustExpectedConnectorId: string;
  setZeroTrustExpectedConnectorId: (value: string) => void;
  supportedConnectorGuardrails: ConnectorTemplate[];
  zeroTrustOnboardedAgents: TrustedOnboardedAgent[];
  zeroTrustDiscovery: AgentOnboardingDiscoveryResult | null;
  zeroTrustResult: AgentOnboardingResult | null;
  zeroTrustError: string;
  setZeroTrustError: (value: string) => void;
  zeroTrustCopyMessage: string;
  gatewayRegistrationMetadata: GatewayRegistrationMetadata | null;
  connectionAudience: ConnectionAudience;
  setConnectionAudience: (value: ConnectionAudience) => void;
  connectionWizardStep: ConnectionWizardStep;
  setConnectionWizardStep: (value: ConnectionWizardStep) => void;
  connectionWizardCollapsedAfterSuccess: boolean;
  setConnectionWizardCollapsedAfterSuccess: (value: boolean) => void;
  customConnectorContractOpen: boolean;
  setCustomConnectorContractOpen: (value: boolean) => void;
  expandedInstalledAgentIds: string[];
  setExpandedInstalledAgentIds: Dispatch<SetStateAction<string[]>>;
  selectedInstalledConnectorTemplateId?: string;
  setSelectedInstalledConnectorTemplateId: Dispatch<SetStateAction<string | undefined>>;
  isZeroTrustDiscovering: boolean;
  isZeroTrustOnboarding: boolean;
  agentRegistryRootRef: RefObject<HTMLElement>;
  connectorCatalogRef: RefObject<HTMLElement>;
  zeroTrustOnboardingRef: RefObject<HTMLElement>;
  registeredAgentsRef: RefObject<HTMLElement>;
  legacyAgentsRef: RefObject<HTMLDetailsElement>;
  registeredAgentRows: RegisteredAgentRow[];
  localConnectorPresets: LocalConnectorPreset[];
  builtInAgentsCount: number;
  healthyAgentsCount: number;
  applyLocalConnectorPreset: (preset: LocalConnectorPreset) => void;
  discoverZeroTrustAgent: () => Promise<void>;
  copyGatewayRegistrationJson: (value: unknown) => Promise<void>;
  startZeroTrustOnboarding: () => Promise<void>;
  loadZeroTrustOnboardedAgents: () => Promise<void>;
  loadSupportedConnectorGuardrails: () => Promise<void>;
  resetZeroTrustConnectionState: () => void;
  renderPageHeader: (props: { eyebrow: string; title: string; subtitle: string; action?: ReactNode; children?: ReactNode }) => ReactNode;
  guideToTarget: (target: GuidedFocusTarget) => void;
  goToConnectorCatalog: () => void;
  showGuidedStatus: (message: string) => void;
  setMessage: (value: string) => void;
  resolveIssue: (message: string) => Promise<void>;
  statusDisplayLabel: (value: string) => string;
  shortHash: (value?: string) => string;
  JsonBlock: (props: { value: unknown }) => ReactNode;
  checkAgentHealth: () => Promise<void>;
  healthClass: (status: string) => string;
  endpointTypeLabel: (
    endpointType: "public" | "session" | "unknown" | "internal",
    endpointScheme?: "https" | "http" | "session" | "unknown"
  ) => string;
};
