export type IssueType =
  | "AUTHENTICATION_FAILURE"
  | "AUTHORIZATION_FAILURE"
  | "RATE_LIMIT"
  | "CONNECTIVITY_FAILURE"
  | "WEBHOOK_FAILURE"
  | "API_AVAILABILITY"
  | "UNKNOWN";

// Enterprise systems are dynamic because future Agent Cards may be created
// through the Agent Builder UI. Do not model systems as a closed union.
export type EnterpriseSystem = string;

// Error codes may be HTTP status codes or vendor/application-specific codes.
export type ErrorCode = string;

// Operations are dynamic and should usually come from Agent Card skill metadata,
// requestedAction, capability, or runtime interpretation.
export type IntegrationOperation = string;

// Agent IDs are dynamic. Built-in demo agents are defined by Agent Cards, not by
// shared protocol unions.
export type AgentId = string;
export type AgentName = AgentId;

export type DelegationTargetAgentName = AgentId;
export type TraceActorId = string;
export type ExecutionActorId = string;
export type AgentRole = "primary" | "supporting";
export type ReporterType = "end_user" | "it_engineer" | "unknown";
export type SupportMode = "end_user_support" | "technical_integration";
export type RequestIntentType =
  | "incident_diagnosis"
  | "integration_failure"
  | "access_request"
  | "permission_change"
  | "user_provisioning"
  | "security_sensitive_action"
  | "manual_service_request"
  | "unknown";
export type RequestScope = "enterprise_support" | "manual_enterprise_workflow" | "out_of_scope" | "unknown";

export type UnsupportedWorkflowContext = {
  intentType: RequestIntentType;
  targetSystemText?: string;
  targetResourceType?: "group" | "role" | "account" | "application" | "repository" | "project" | "unknown";
  targetResourceName?: string;
  requestedActionText?: string;
  requestedCapability?: string;
  requiresApproval?: boolean;
};

export type RequestScopeContext = {
  scope: RequestScope;
  reason: string;
  detectedTopic?: string;
};

export type AdversarialIntent =
  | "prompt_injection_attempt"
  | "token_exfiltration_attempt"
  | "policy_bypass_attempt"
  | "privilege_escalation_attempt"
  | "false_authority_attempt";

export type SecurityIntent = {
  detected: boolean;
  category?: AdversarialIntent;
  reason: string;
};

export type RequestInterpretation = {
  scope: RequestScope;
  intentType: RequestIntentType;
  requestedCapability?: string;
  targetSystemText?: string;
  targetResourceType?: string;
  targetResourceName?: string;
  requestedActionText?: string;
  requiresApproval?: boolean;
  confidence: "low" | "medium" | "high";
  reason: string;
  interpretationSource?: "ai" | "fallback";
  aiProvider?: "openrouter";
  aiModel?: string;
};

export type FollowUpInterpretation = {
  isFollowUp: boolean;
  confidence: "low" | "medium" | "high";
  reason: string;
  addsEnvironment?: string;
  addsErrorText?: string;
  addsImpact?: string;
  addsSymptom?: string;
  addsTargetSystemText?: string;
  shouldPreservePreviousTargetSystem?: boolean;
  shouldPreservePreviousAction?: boolean;
  interpretationSource?: "ai" | "fallback";
  aiProvider?: "openrouter";
  aiModel?: string;
};

export interface Classification {
  system: EnterpriseSystem;
  errorCode?: ErrorCode;
  issueType: IssueType;
  operation?: IntegrationOperation;
  confidence: "low" | "medium" | "high";
  reasoningSummary: string;
  classificationSource: "ai" | "rules_fallback";
  aiProvider?: "openrouter";
  aiModel?: string;
  reporterType: ReporterType;
  supportMode: SupportMode;
}

export interface AgentTask {
  message: string;
  classification: Classification;
}

export interface AgentEvidence {
  agent: AgentId;
  title: string;
  data: Record<string, unknown>;
}

export interface AgentTraceEntry {
  agent: TraceActorId;
  action: string;
  detail: string;
  timestamp: string;
  fromAgent?: string;
  toAgent?: string;
  mediatedBy?: string;
  skillId?: string;
  decision?: "Allowed" | "Blocked" | "NeedsApproval" | "NeedsMoreContext";
  delegationDepth?: number;
}

export interface ExecutionTraceStep {
  actor: ExecutionActorId;
  action: string;
  detail: string;
  timestamp: string;
  taskId?: string;
  conversationId?: string;
  fromAgent?: string;
  toAgent?: string;
  mediatedBy?: string;
  skillId?: string;
  decision?: "Allowed" | "Blocked" | "NeedsApproval" | "NeedsMoreContext";
  delegationDepth?: number;
}

export interface SecurityDecision {
  caller: string;
  target: AgentId;
  requestedAction: string;
  requiredPermission: string;
  decision: "Allowed" | "Blocked" | "NeedsApproval" | "NeedsMoreContext";
  reason: string;
  matchedPolicy: string;
  callerPermissions: string[];
}

export interface SelectedAgent {
  agentId: AgentId;
  role: AgentRole;
  skillId?: string;
  reason: string;
  matchedCapability?: string;
  matchScore?: number;
  owner?: string;
  targetSystemText?: string;
}

export interface SkippedAgent {
  agentId: AgentId;
  reason: string;
}

export interface RoutingDecision {
  classification: Classification;
  selectedAgents: SelectedAgent[];
  skippedAgents: SkippedAgent[];
  routingSource: "ai" | "rules_fallback";
  routingConfidence: "low" | "medium" | "high";
  routingReasoningSummary: string;
  resolutionStatus: "resolved" | "needs_more_info" | "unsupported";
  requestInterpretation?: RequestInterpretation;
}

export type InterpretationProofSummary = {
  interpretationId: string;
  schemaVersion: string;
  source: "ai" | "fallback";
  provider?: string;
  model?: string;
  inputHash: string;
  outputHash: string;
  confidence: "low" | "medium" | "high";
  risks: string[];
  advisoryOnly: true;
  rawPromptStored: false;
  rawAiResponseStored: false;
};

export interface AgentResponse {
  agent: AgentId;
  evidence: AgentEvidence[];
  trace: AgentTraceEntry[];
}

export type A2AAuthMode =
  | "mock_internal_token"
  | "oauth2_client_credentials_jwt";

export type OAuthClientAuthMethod =
  | "client_secret_post"
  | "private_key_jwt";

export type PublicOAuthClientAuthMethod =
  | "client-secret-post"
  | "private-key-jwt";

export type A2ATokenClaims = {
  iss: string;
  sub: string;
  aud: string;
  scope?: string;
  scp?: string[];
  exp: number;
  iat: number;
  jti: string;
  client_id: string;
  actor?: string;
  actor_roles?: string[];
  actor_provider?: string;
  actor_issuer?: string;
  actor_sub?: string;
  delegated_by?: string;
  delegation_depth?: number;
  parent_task_id?: string;
  requested_by_agent?: string;
  original_subject?: string;
};

export type A2ATokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
};

export type A2AAuthValidationResult = {
  valid: boolean;
  reason: string;
  claims?: A2ATokenClaims;
};

export type A2ATaskAuthMetadata = {
  authMode: A2AAuthMode;
  issuer?: string;
  audience?: string;
  scope?: string;
  tokenIssued?: boolean;
  tokenValidated?: boolean;
  validationReason?: string;
  delegatedBy?: string;
  delegationDepth?: number;
  parentTaskId?: string;
  requestedByAgent?: string;
  actor?: string;
  actorRoles?: string[];
  actorProvider?: string;
  actorIssuer?: string;
  actorSubject?: string;
  tokenAuthMethod?: OAuthClientAuthMethod | PublicOAuthClientAuthMethod;
};

export type UserIdentitySummary = {
  authenticated: boolean;
  provider?: string;
  email?: string;
  name?: string;
  roles?: string[];
};

export type ExternalAuthorizationProvider =
  | "monday"
  | "servicenow"
  | "github"
  | "jira"
  | string;

export type ExternalAuthorizationRequirement = {
  type: "authorization_required";
  provider: ExternalAuthorizationProvider;
  resourceSystem: string;
  connectorId: string;
  reason: string;
  authorizeUrl: string;
  requestedScopes: string[];
  actorProvider?: string;
  actorSubject?: string;
  actorEmail?: string;
  expiresAt?: string;
};

export type ConnectedAccountStatus = {
  provider: ExternalAuthorizationProvider;
  resourceSystem: string;
  connectorId: string;
  actorProvider: string;
  actorSubject: string;
  actorEmail?: string;
  externalAccountId?: string;
  scopes: string[];
  status: "connected" | "missing" | "expired" | "revoked" | "insufficient_scope";
  expiresAt?: string;
};

export interface A2ATask {
  taskId: string;
  conversationId: string;
  fromAgent: string;
  toAgent: string;
  mediatedBy?: string;
  delegationDepth?: number;
  parentTaskId?: string;
  requestedByAgent?: string;
  skillId?: string;
  userMessage: string;
  classification: Classification;
  context: {
    reporterType?: string;
    supportMode?: string;
    sourceSystem?: "ServiceNow";
    affectedSystem?: string;
    securityDecision?: SecurityDecision;
    callerAgentId?: string;
    targetAgentId?: string;
    targetAudience?: string;
    requestedScope?: string;
    authMode?: A2AAuthMode;
    auth?: A2ATaskAuthMetadata;
    delegationContext?: Record<string, unknown>;
    actor?: {
      email: string;
      name?: string;
      roles: string[];
      provider?: string;
      issuer?: string;
      subject?: string;
    };
  };
}

export type EndUserAnswerSeverity =
  | "info"
  | "low"
  | "medium"
  | "high";

export type EndUserAnswer = {
  title: string;
  summary: string;
  whatWasChecked?: string;
  whatWasChanged?: string;
  nextStep: string;
  severity?: EndUserAnswerSeverity;
  safeToDisplay: true;
};

export interface A2AAgentResponse {
  agentId: string;
  status: "diagnosed" | "completed" | "needs_more_info" | "blocked" | "unsupported" | "error";
  summary: string;
  probableCause?: string;
  recommendedActions?: string[];
  endUserAnswer?: EndUserAnswer;
  authorizationRequirement?: ExternalAuthorizationRequirement;
  clarifyingQuestions?: string[];
  requestedDelegations?: Array<{
    targetAgentId: AgentId;
    skillId: string;
    reason: string;
    context?: Record<string, unknown>;
  }>;
  evidence?: Array<{
    title: string;
    data: unknown;
  }>;
  actionPlan?: ConnectorActionPlan;
  runtimeSemantics?: ConnectorRuntimeSemantics;
  trace?: Array<{
    agent: string;
    action: string;
    detail: string;
    timestamp: string;
  }>;
}

export type ConnectorRuntimeExecutionType =
  | "diagnostic_read_only"
  | "write_action"
  | "inspection_read_only"
  | "unsupported";

export type ConnectorRuntimeOutcome =
  | "diagnosed"
  | "executed"
  | "blocked"
  | "needs_more_info"
  | "unsupported"
  | "error";

export type ConnectorTargetActionStatus =
  | "ready"
  | "not_enabled"
  | "missing_application_grants"
  | "missing_effective_permissions"
  | "explicitly_denied"
  | "unknown";

export type ConnectorRuntimeSemantics = {
  executionType: ConnectorRuntimeExecutionType;
  outcome: ConnectorRuntimeOutcome;
  executedSkillId: string;
  targetActionId?: string;
  targetActionLabel?: string;
  targetActionStatus?: ConnectorTargetActionStatus;
  writeActionAttempted: boolean;
  diagnosticOnly: boolean;
};

export type ConnectorPlanMode = "plan_only";

export type PlannedActionExecutionType =
  | "inspection_read_only"
  | "diagnostic_read_only"
  | "write_action"
  | "admin_action"
  | "unsupported";

export type PlannedActionRiskLevel =
  | "low"
  | "medium"
  | "high"
  | "critical";

export type PlannedActionSideEffects =
  | "none"
  | "reads_data"
  | "modifies_state"
  | "admin_change"
  | "cross_system";

export type ConnectorActionPlanOption = {
  actionId: string;
  label: string;
  description: string;
  executionType: PlannedActionExecutionType;
  riskLevel: PlannedActionRiskLevel;
  sideEffects: PlannedActionSideEffects;
  requiredApplicationGrants: string[];
  requiredEffectivePermissions: string[];
  requiresApproval?: boolean;
  targetObjectTypes?: string[];
  missingInputs?: string[];
};

export type ConnectorActionPlan = {
  planId: string;
  connectorId: string;
  resourceSystem: string;
  interpretedIntent: string;
  userRequest: string;
  mode: ConnectorPlanMode;
  safeToDisplay: true;
  sideEffectsAllowed: "none";
  missingInputs: string[];
  options: ConnectorActionPlanOption[];
  recommendedOptionId?: string;
  recommendedNextStep: string;
};

export type EvaluatedConnectorActionPlan = {
  plan: ConnectorActionPlan;
  options: Array<{
    option: ConnectorActionPlanOption;
    decision: "allowed" | "blocked" | "needs_approval";
    blockedAt?: "gateway_governance" | "oauth_scope" | "service_account_permission";
    reason: string;
    missingApplicationGrants: string[];
    missingEffectivePermissions: string[];
    deniedEffectivePermissions: string[];
  }>;
  recommendedOptionDecision?: {
    optionId: string;
    decision: "allowed" | "blocked" | "needs_approval";
    blockedAt?: "gateway_governance" | "oauth_scope" | "service_account_permission";
    reason: string;
  };
};

export type ConnectorPlanningTargetStrategy =
  | "explicit_connector_mention"
  | "ai_routing_target_match"
  | "supported_intent_class_match"
  | "needs_clarification"
  | "not_supported";

export type ConnectorPlanningTargetResolution = {
  strategy: ConnectorPlanningTargetStrategy;
  detectedIntentClasses: string[];
  selectedConnectorId?: string;
  selectedResourceSystem?: string;
  reason: string;
};

export type PendingFollowUpContext = {
  type: "connector_planning_target";
  originalMessage: string;
  detectedIntentClasses: string[];
  missingFields: Array<"targetSystem">;
  createdAt: string;
};

export type PlanningFollowUpResolution = {
  type: "connector_planning_target";
  originalMessage: string;
  followUpAnswer: string;
  resolvedMessage: string;
};

export type PendingInteractionType =
  | "target_selection"
  | "missing_input"
  | "planned_safe_action"
  | "approval_required_action"
  | "support_ticket_handoff";

export type PendingInteraction = {
  id: string;
  type: PendingInteractionType;
  originalUserRequest: string;
  createdAt: string;
  expiresAt?: string;
  context: Record<string, unknown>;
};

export type PendingInteractionRelation =
  | "confirm"
  | "cancel"
  | "provide_missing_target"
  | "provide_missing_input"
  | "modify_request"
  | "ask_question"
  | "unrelated_new_request"
  | "adversarial_attempt"
  | "unclear";

export type PendingInteractionResolution = {
  relation: PendingInteractionRelation;
  confidence: "high" | "medium" | "low";
  normalizedUserIntent: string;
  extractedValues?: Record<string, string>;
  requiresNewRouting: boolean;
  securityConcern: boolean;
  reason: string;
};

export type SafeTargetSelectionSystemOption = {
  id: string;
  label: string;
  value: string;
  description?: string;
  kind: "supported_system" | "other";
};

export type SafeTargetSelection = {
  intent: string;
  reason: string;
  question: string;
  searchPlaceholder: string;
  options: SafeTargetSelectionSystemOption[];
  technicalOptions?: unknown[];
};

export type ExecutionGateId =
  | "user_identity_actor_context"
  | "ai_interpretation"
  | "gateway_governance"
  | "oauth_scope"
  | "service_account_permission"
  | "runtime_execution";

export type ExecutionGateStatus =
  | "passed"
  | "blocked"
  | "not_evaluated"
  | "executed"
  | "diagnosed"
  | "failed";

export type ExecutionGate = {
  id: ExecutionGateId;
  label: string;
  status: ExecutionGateStatus;
  reason: string;
  required?: string[];
  present?: string[];
  missing?: string[];
  denied?: string[];
  evidence?: Record<string, unknown>;
};

export type ExecutionGateStack = {
  stoppedAt?: ExecutionGateId;
  finalOutcome:
    | "planned"
    | "diagnosed"
    | "executed"
    | "blocked_at_gateway"
    | "blocked_at_oauth_scope"
    | "blocked_at_service_account_permission"
    | "runtime_failed"
    | "unsupported"
    | "needs_more_info";
  gates: ExecutionGate[];
};

export interface ResolveRequest {
  message: string;
  conversationId?: string;
}

export interface ResolveResponse {
  conversationId?: string;
  finalAnswer: string;
  classification: Classification;
  selectedAgents: SelectedAgent[];
  skippedAgents: SkippedAgent[];
  routingSource: RoutingDecision["routingSource"];
  routingConfidence: RoutingDecision["routingConfidence"];
  routingReasoningSummary: string;
  resolutionStatus: RoutingDecision["resolutionStatus"];
  evidence: AgentEvidence[];
  agentTrace: AgentTraceEntry[];
  executionTrace: ExecutionTraceStep[];
  securityDecision?: SecurityDecision;
  securityDecisions?: SecurityDecision[];
  requestInterpretation?: RequestInterpretation;
  interpretationProof?: InterpretationProofSummary;
  securityIntent?: SecurityIntent;
  executionGateStack?: ExecutionGateStack;
  connectorActionPlan?: ConnectorActionPlan;
  evaluatedActionPlan?: EvaluatedConnectorActionPlan;
  connectorPlanningTargetResolution?: ConnectorPlanningTargetResolution;
  pendingFollowUp?: PendingFollowUpContext;
  pendingInteraction?: PendingInteraction;
  pendingInteractionResolution?: PendingInteractionResolution;
  planningFollowUpResolution?: PlanningFollowUpResolution;
  safeTargetSelection?: SafeTargetSelection;
  connectorRouting?: {
    status: string;
    targetSystem?: string;
    connectorId?: string;
    resourceSystem?: string;
    skillId?: string;
    skillLabel?: string;
    intentClass?: string;
    targetResourceSystem?: string;
    targetResourceName?: string;
    requestedAccessLevel?: string;
    fulfillmentCapability?: string;
    missingFields?: string[];
    runtimeEndpoint?: string;
    trustedRuntimeEndpoint?: string;
    audience?: string;
    externalConfigHash?: string;
    connectorProfileHash?: string;
    requiredApplicationGrants?: string[];
    requiredEffectivePermissions?: string[];
    riskLevel?: "low" | "medium" | "high" | "sensitive";
    executionType?: "diagnostic_read_only" | "write_action" | "inspection_read_only" | "unsupported";
    requiresApproval?: boolean;
    sensitivity?: "standard" | "sensitive";
    missingApplicationGrants?: string[];
    missingEffectivePermissions?: string[];
    deniedEffectivePermissions?: string[];
    runtimeMode?: "external_runtime_available" | "metadata_only" | "not_available";
    reason: string;
    recommendedNextStep: string;
  };
  connectorPolicy?: {
    effect: "allow" | "block" | "needs_approval";
    reason: string;
    primaryRuleId?: string;
    primaryRuleSource?: "guardrail" | "tenant" | "default";
    matchedRuleIds: string[];
    matchedGuardrailRuleIds?: string[];
    matchedTenantRuleIds?: string[];
    matchedRuleSummaries?: Array<{
      id: string;
      name: string;
      effect: "allow" | "block" | "needs_approval";
      source: "guardrail" | "tenant" | "default";
      description: string;
    }>;
    policyVersion?: string;
    decisionId?: string;
    inputHash?: string;
    deniedByDefault?: boolean;
    requiresApproval?: boolean;
    safeInputSummary?: Record<string, unknown>;
  };
  connectorRuntime?: {
    executed: boolean;
    runtimeMode: "external_runtime" | "external_runtime_failed" | "metadata_only";
    connectorId?: string;
    resourceSystem?: string;
    skillId?: string;
    runtimeEndpoint?: string;
    tokenMetadata?: {
      tokenIssued: boolean;
      audience: string;
      scope: string;
      actor?: string;
      actorRoles?: string[];
      actorProvider?: string;
      actorIssuer?: string;
      actorSubject?: string;
      rawToken: "hidden";
    };
    agentResponse?: A2AAgentResponse;
    authorizationRequirement?: ExternalAuthorizationRequirement;
    error?: string;
    errorMessage?: string;
  };
  followUpInterpretation?: FollowUpInterpretation;
  incidentContext?: {
    targetSystemText?: string;
    environment?: string;
    symptom?: string;
    errorText?: string;
    impact?: string;
    suggestedAssignmentGroup: string;
    confidence: "low" | "medium" | "high";
    hasMinimumDetails: boolean;
  };
  userIdentity: UserIdentitySummary;
  a2aTasks?: A2ATask[];
  a2aResponses?: A2AAgentResponse[];
  diagnosis: {
    probableCause: string;
    recommendedFix: string;
  };
}

export type AgentHealthStatus = "ok" | "down" | "degraded";

export interface AgentHealthCheck {
  agentId: string;
  url?: string;
  endpointType: "internal" | "public" | "session" | "unknown";
  status: AgentHealthStatus;
  latencyMs: number;
  checkedAt: string;
  details: {
    healthEndpoint: "/health";
    agentCardAvailable: boolean;
  };
  error?: string;
}

export interface AgentsHealthResponse {
  orchestrator: {
    agentId: "servicenow-orchestrator-agent";
    status: "ok";
    timestamp: string;
    authMode: A2AAuthMode;
    secureAuthRequired: boolean;
  };
  agents: AgentHealthCheck[];
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    down: number;
  };
}

export * from "./auth/verifyA2AToken.js";
export * from "./auth/requireA2AAuth.js";
export * from "./a2aResourceRegistry.js";
export * from "./state/StateStore.js";
export * from "./state/InMemoryStateStore.js";
export * from "./state/UpstashStateStore.js";
export * from "./state/createStateStore.js";
