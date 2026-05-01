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
  aiProvider?: "openrouter" | "openai";
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
  aiProvider?: "openrouter" | "openai";
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
  aiProvider?: "openrouter" | "openai";
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

export interface AgentResponse {
  agent: AgentId;
  evidence: AgentEvidence[];
  trace: AgentTraceEntry[];
}

export type A2AAuthMode =
  | "mock_internal_token"
  | "oauth2_client_credentials_jwt";

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
  delegated_by?: string;
  delegation_depth?: number;
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
    delegationContext?: Record<string, unknown>;
  };
}

export interface A2AAgentResponse {
  agentId: string;
  status: "diagnosed" | "needs_more_info" | "blocked" | "unsupported" | "error";
  summary: string;
  probableCause?: string;
  recommendedActions?: string[];
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
  trace?: Array<{
    agent: string;
    action: string;
    detail: string;
    timestamp: string;
  }>;
}

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
  url: string;
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
  };
  agents: AgentHealthCheck[];
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    down: number;
  };
}

export * from "./auth/verifyA2AToken";
