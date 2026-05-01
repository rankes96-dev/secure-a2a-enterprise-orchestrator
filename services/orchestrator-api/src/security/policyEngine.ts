export type RequestedSecurityAction =
  | "compare_oauth_scopes"
  | "inspect_oauth_token"
  | "create_incident_draft"
  | "read_api_health"
  | "read_github_rate_limit";

export interface PolicyEvaluationInput {
  callerAgentId: string;
  targetAgentId: string;
  requestedAction: string;
}

export interface PolicyEvaluationResult {
  caller: string;
  target: string;
  requestedAction: string;
  requiredPermission: string;
  decision: "Allowed" | "Blocked" | "NeedsApproval" | "NeedsMoreContext";
  reason: string;
  matchedPolicy: string;
  callerPermissions: string[];
}

const actionPermissions: Record<RequestedSecurityAction, string> = {
  compare_oauth_scopes: "security.scope.compare",
  inspect_oauth_token: "security.token.inspect",
  create_incident_draft: "incident.draft.create",
  read_api_health: "apihealth.read",
  read_github_rate_limit: "github.rate_limit.read"
};

const agentPermissions: Record<string, string[]> = {
  "orchestrator-agent": [
    "security.scope.compare",
    "incident.draft.create",
    "apihealth.read",
    "github.rate_limit.read"
  ],
  "github-agent": [
    "api_health.diagnose_rate_limit",
    "api_health.diagnose_connectivity_failure"
  ],
  "jira-agent": [
    "security.compare_oauth_scopes"
  ],
  "end-user-triage-agent": [
    "jira.diagnose_user_permission_issue",
    "github.diagnose_repo_access_issue",
    "pagerduty.diagnose_alert_ingestion_failure",
    "security.compare_oauth_scopes",
    "api_health.diagnose_connectivity_failure"
  ]
};

const delegationPolicies: Record<string, Record<string, string[]>> = {
  "github-agent": {
    "api-health-agent": ["api_health.diagnose_rate_limit", "api_health.diagnose_connectivity_failure"]
  },
  "jira-agent": {
    "security-oauth-agent": ["security.compare_oauth_scopes"]
  },
  "end-user-triage-agent": {
    "jira-agent": ["jira.diagnose_user_permission_issue", "jira.diagnose_issue_creation_failure"],
    "github-agent": ["github.diagnose_repo_access_issue", "github.diagnose_repository_scan_failure", "github.diagnose_rate_limit"],
    "pagerduty-agent": ["pagerduty.diagnose_alert_ingestion_failure", "pagerduty.diagnose_event_rate_limit"],
    "security-oauth-agent": ["security.compare_oauth_scopes"],
    "api-health-agent": ["api_health.diagnose_rate_limit", "api_health.diagnose_connectivity_failure", "api_health.diagnose_webhook_delivery"]
  },
  "security-oauth-agent": {
    "security-oauth-agent": ["security.compare_oauth_scopes"]
  }
};

export function evaluateSecurityPolicy(input: PolicyEvaluationInput): PolicyEvaluationResult {
  const requiredPermission = actionPermissions[input.requestedAction as RequestedSecurityAction];
  const callerPermissions = agentPermissions[input.callerAgentId] ?? [];
  const baseResult = {
    caller: input.callerAgentId,
    target: input.targetAgentId,
    requestedAction: input.requestedAction,
    requiredPermission: requiredPermission ?? "unknown",
    matchedPolicy: requiredPermission ? `${input.requestedAction} -> ${requiredPermission}` : "no_matching_policy",
    callerPermissions
  };

  if (!requiredPermission) {
    return {
      ...baseResult,
      decision: "Blocked",
      reason: `Unknown requested action ${input.requestedAction}.`
    };
  }

  if (!(input.callerAgentId in agentPermissions)) {
    return {
      ...baseResult,
      decision: "Blocked",
      reason: `No policy exists for caller ${input.callerAgentId}.`
    };
  }

  if (!callerPermissions.includes(requiredPermission)) {
    return {
      ...baseResult,
      decision: "Blocked",
      reason: `${input.callerAgentId} does not have required permission ${requiredPermission}.`
    };
  }

  return {
    ...baseResult,
    decision: "Allowed",
    reason: `${input.callerAgentId} has required permission ${requiredPermission}.`
  };
}

export function evaluateDelegationPolicy(input: PolicyEvaluationInput): PolicyEvaluationResult {
  const allowedSkills = delegationPolicies[input.callerAgentId]?.[input.targetAgentId] ?? [];
  const callerPermissions = agentPermissions[input.callerAgentId] ?? [];
  const baseResult = {
    caller: input.callerAgentId,
    target: input.targetAgentId,
    requestedAction: input.requestedAction,
    requiredPermission: input.requestedAction,
    matchedPolicy: allowedSkills.length > 0 ? `${input.callerAgentId} -> ${input.targetAgentId}` : "no_matching_delegation_policy",
    callerPermissions
  };

  if (!allowedSkills.includes(input.requestedAction)) {
    return {
      ...baseResult,
      decision: "Blocked",
      reason: `${input.callerAgentId} may not request ${input.requestedAction} from ${input.targetAgentId}.`
    };
  }

  if (!callerPermissions.includes(input.requestedAction)) {
    return {
      ...baseResult,
      decision: "Blocked",
      reason: `${input.callerAgentId} lacks delegation permission ${input.requestedAction}.`
    };
  }

  return {
    ...baseResult,
    decision: "Allowed",
    reason: `${input.callerAgentId} may request ${input.requestedAction} from ${input.targetAgentId}.`
  };
}
