import type { ReactNode, RefObject } from "react";

export type ConnectionAudience = "bizapps" | "developer";

export type ConnectionWizardStep =
  | "overview"
  | "gateway-registration"
  | "connection-input"
  | "discovery"
  | "verify"
  | "result";

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

export type AgentRegistryContext = {
  [key: string]: any;
  isLoading: boolean;
  zeroTrustAgentBaseUrl: string;
  setZeroTrustAgentBaseUrl: (value: string) => void;
  zeroTrustExpectedAgentId: string;
  setZeroTrustExpectedAgentId: (value: string) => void;
  zeroTrustExpectedResourceSystem: string;
  setZeroTrustExpectedResourceSystem: (value: string) => void;
  zeroTrustExpectedConnectorId: string;
  setZeroTrustExpectedConnectorId: (value: string) => void;
  supportedConnectorGuardrails: ConnectorTemplate[];
  zeroTrustOnboardedAgents: TrustedOnboardedAgent[];
  zeroTrustDiscovery: any;
  zeroTrustResult: any;
  zeroTrustError: string;
  setZeroTrustError: (value: string) => void;
  zeroTrustCopyMessage: string;
  gatewayRegistrationMetadata: { gatewayId: string; clientId: string; issuer: string; jwksUri: string; supportedOnboardingMethods: string[] } | null;
  connectionAudience: ConnectionAudience;
  setConnectionAudience: (value: ConnectionAudience) => void;
  connectionWizardStep: ConnectionWizardStep;
  setConnectionWizardStep: (value: ConnectionWizardStep) => void;
  connectionWizardCollapsedAfterSuccess: boolean;
  setConnectionWizardCollapsedAfterSuccess: (value: boolean) => void;
  customConnectorContractOpen: boolean;
  setCustomConnectorContractOpen: (value: boolean) => void;
  expandedInstalledAgentIds: string[];
  setExpandedInstalledAgentIds: (updater: string[] | ((current: string[]) => string[])) => void;
  selectedInstalledConnectorTemplateId?: string;
  setSelectedInstalledConnectorTemplateId: (value: string | undefined) => void;
  isZeroTrustDiscovering: boolean;
  isZeroTrustOnboarding: boolean;
  agentRegistryRootRef: RefObject<HTMLElement>;
  connectorCatalogRef: RefObject<HTMLElement>;
  zeroTrustOnboardingRef: RefObject<HTMLElement>;
  registeredAgentsRef: RefObject<HTMLElement>;
  legacyAgentsRef: RefObject<HTMLDetailsElement>;
  registeredAgentRows: any[];
  localConnectorPresets: LocalConnectorPreset[];
  applyLocalConnectorPreset: (preset: LocalConnectorPreset) => void;
  discoverZeroTrustAgent: () => Promise<void>;
  copyGatewayRegistrationJson: (value: unknown) => Promise<void>;
  startZeroTrustOnboarding: () => Promise<void>;
  loadZeroTrustOnboardedAgents: () => Promise<void>;
  loadSupportedConnectorGuardrails: () => Promise<void>;
  resetZeroTrustConnectionState: () => void;
  renderPageHeader: (props: { eyebrow: string; title: string; subtitle: string; action?: ReactNode; children?: ReactNode }) => ReactNode;
  guideToTarget: (target: any) => void;
  showGuidedStatus: (message: string) => void;
  setMessage: (value: string) => void;
  resolveIssue: (message: string) => Promise<void>;
  statusDisplayLabel: (value: string) => string;
  shortHash: (value?: string) => string;
  JsonBlock: (props: { value: unknown }) => ReactNode;
};
