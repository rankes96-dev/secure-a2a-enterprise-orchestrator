import type { AgentsHealthResponse, AuditEventsResponse, ResolveResponse } from "@a2a/shared";
import type { Dispatch, FormEvent, MutableRefObject, ReactNode, RefObject, SetStateAction } from "react";
import type { FrontendAuthConfig } from "../auth/authTypes";
import type { GuidedFocusTarget, LocalConnectorPreset, TrustedOnboardedAgent } from "./agent-registry/types";

export type Scenario = {
  label: string;
  message: string;
  subtitle: string;
  purpose?: string;
  proves: string;
  badge?: string;
};

export type ScenarioGroup = {
  category: string;
  items: Scenario[];
};

export type RenderPageHeader = (props: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
  children?: ReactNode;
}) => ReactNode;

export type JsonBlockComponent = (props: { value: unknown }) => ReactNode;

export type MessageListComponent = (props: { messages: ChatMessage[] }) => ReactNode;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  status?: "loading" | "done";
  metadata?: ResolveResponse;
};

export type DemoReadinessStatus = "ready" | "missing_connector" | "runtime_blocked" | "needs_setup" | "info";

export type SecurityTimelineFilter =
  | "all"
  | "identity"
  | "routing"
  | "policy"
  | "token"
  | "agent"
  | "delegation"
  | "response-audit";

export type SecurityTimelineEvent = {
  id: string;
  category: string;
  title: string;
  description: string;
  status: "success" | "warning" | "blocked" | "info";
  timestamp?: string;
  actor?: string;
  agentId?: string;
  metadata?: Array<{ label: string; value: string }>;
};

export type AuditViewerFilters = {
  cursor?: string;
  limit?: number;
  eventType?: string;
  outcome?: string;
  severity?: string;
  from?: string;
  to?: string;
  conversationId?: string;
};

export type DemoUserOption = {
  email: string;
  label: string;
  roleLabel: string;
};

export type TrustStatusView = {
  userIdentity: {
    authenticated: boolean;
    user: { email: string; name?: string; roles: string[] } | null;
    issuer: string;
    audience: string;
  };
  userIdentityProvider?: {
    provider: "mock" | "auth0";
    issuer: string;
    audience: string;
    jwksUri: string;
    rawTokenExposed: false;
  };
  gatewayIdentity: {
    agentId: string;
    a2aAuthMode: string;
    secureAuthRequired: boolean;
    tokenAuthMethod: string;
    actorPropagationEnabled: boolean;
  };
  mockIdp: {
    issuer: string;
    jwksUri: string;
    tokenEndpoint: string;
    userTokenEndpoint: string;
    rawKeysExposed: boolean;
  };
  securityControls: {
    rawTokensDisplayed: boolean;
    agentOnboardingFetchesExternalUrls: boolean;
    externalAgentsExecutable: boolean;
    agentCardSecretsRejected: boolean;
    userIdentityRequiredForResolve: boolean;
    privateKeyJwtReplayProtection: string;
    ipAllowlist: string;
  };
};

export type ExtractedScreenContext = Record<string, unknown> & {
  activeTab: string;
  setActiveTab: Dispatch<SetStateAction<"demo-guide" | "run-task" | "agent-registry" | "connector-test-center" | "trust-identity" | "security-timeline">>;
  persona: "end_user" | "technical" | null;
  isEndUserMode: boolean;
  isTechnicalMode: boolean;
  changePersonaView: () => void;
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
  messages: ChatMessage[];
  error: string;
  isLoading: boolean;
  health: AgentsHealthResponse | null;
  healthError: string;
  isHealthLoading: boolean;
  latestResponse: ResolveResponse | null;
  isUserAuthenticated: boolean;
  connectorTemplateCount: number;
  installedConnectorAgentCount: number;
  runtimeReadyConnectorAgentCount: number;
  zeroTrustOnboardedAgents: TrustedOnboardedAgent[];
  latestRequest: string;
  latestActorAttached: boolean;
  latestActorTokenObserved: boolean;
  latestActorRoles: string;
  executionState: string;
  authModeSummary: string;
  lastResult: string;
  policySummary: string;
  tokenSummary: string;
  delegationSummary: string;
  primarySelectedAgent: string;
  actorEmail?: string;
  policyOutcome: string;
  tokenOutcome: string;
  localConnectorPresets: LocalConnectorPreset[];
  scenarios: ScenarioGroup[];
  quickScenarios: Scenario[];
  advancedScenarios: Scenario[];
  securityTimelineFilters: Array<{ id: SecurityTimelineFilter; label: string }>;
  securityTimelineFilter: SecurityTimelineFilter;
  setSecurityTimelineFilter: Dispatch<SetStateAction<SecurityTimelineFilter>>;
  visibleSecurityTimelineEvents: SecurityTimelineEvent[];
  auditEventsResponse: AuditEventsResponse | null;
  auditEventsError: string;
  auditEventsGuidance: string[];
  isAuditEventsLoading: boolean;
  loadAuditEvents: (filters?: AuditViewerFilters) => Promise<void>;
  demoUserOptions: DemoUserOption[];
  selectedDemoUserEmail: string;
  setSelectedDemoUserEmail: Dispatch<SetStateAction<string>>;
  identityError: string;
  identityMessage: string;
  isIdentityLoading: boolean;
  identitySession: {
    authenticated: boolean;
    user: { email: string; name?: string; roles: string[] } | null;
    issuer: string;
    audience: string;
  } | null;
  trustStatus: TrustStatusView | null;
  frontendAuthConfig: FrontendAuthConfig;
  frontendAuthProviderLabel: string;
  demoGuideRootRef: RefObject<HTMLElement>;
  runTaskRootRef: RefObject<HTMLElement>;
  composerRef: RefObject<HTMLFormElement>;
  taskTextareaRef: RefObject<HTMLTextAreaElement>;
  gatewayResponseRef: RefObject<HTMLElement>;
  securitySummaryRef: RefObject<HTMLElement>;
  trustIdentityRootRef: RefObject<HTMLElement>;
  loginPanelRef: RefObject<HTMLElement>;
  demoUserSelectRef: RefObject<HTMLSelectElement>;
  loginButtonRef: RefObject<HTMLButtonElement>;
  connectorTestCenterRootRef: RefObject<HTMLElement>;
  securityTimelineRootRef: RefObject<HTMLElement>;
  timelineListRef: MutableRefObject<HTMLElement | null>;
  renderPageHeader: RenderPageHeader;
  guideToTarget: (target: GuidedFocusTarget) => void;
  showGuidedStatus: (message: string) => void;
  goToTrustIdentity: () => void;
  goToRunTask: () => void;
  goToAgentRegistry: () => void;
  goToConnectorCatalog: () => void;
  goToInstalledConnectorAgents: () => void;
  goToSecurityTimeline: () => void;
  readinessStatusForSkill: (connectorId: string, skillId: string, expected: "approved" | "blocked") => DemoReadinessStatus;
  applyLocalConnectorPreset: (preset: LocalConnectorPreset) => void;
  resolveIssue: (message: string) => Promise<void>;
  submitIssue: (event: FormEvent) => Promise<void>;
  startNewConversation: () => void;
  resetZeroTrustConnectionState: () => void;
  checkAgentHealth: () => Promise<void>;
  loadTrustStatus: () => Promise<void>;
  loginDemoUser: (options?: { silent?: boolean }) => Promise<void>;
  loginAuth0User: () => Promise<void>;
  logoutIdentity: () => Promise<void>;
  cockpitStatusClass: (value: string) => string;
  statusDisplayLabel: (value: string) => string;
  connectorRoutingStatusLabel: (status: string) => string;
  connectorRoutingStatusClass: (status: string) => string;
  connectorRouteSummaryLabel: (response: ResolveResponse | null) => string;
  resultSummaryLabel: (response: ResolveResponse | null) => string;
  connectorRuntimeFailureCopy: (error?: string, message?: string) => { title: string; body: string; nextStep?: string };
  firstSentence: (text: string, maxLength?: number) => string;
  recommendedActionItems: (text: string) => string[];
  routingDescription: (response: ResolveResponse) => string;
  securityDecisions: (response: ResolveResponse | null) => NonNullable<ResolveResponse["securityDecisions"]>;
  decisionClass: (decision: string) => string;
  JsonBlock: JsonBlockComponent;
  MessageList: MessageListComponent;
  safeRawExecutionData: (response: ResolveResponse) => unknown;
  sampleMessage: string;
  endUserSampleMessage: string;
};
