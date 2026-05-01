export type PolicyDecisionMode = "allow_if_permitted" | "requires_approval";

export const actionAliases: Record<string, string> = {
  compare_oauth_scopes: "oauth.scope.compare",
  inspect_oauth_token: "security.token.inspect",
  "access.grant_permission": "access.permission.grant",
  create_incident_draft: "pagerduty.alert_ingestion.diagnose",
  read_api_health: "api.health.read",
  read_github_rate_limit: "github.rate_limit.read",
  "oauth.token.inspect": "security.token.inspect"
};

export const actionPermissions: Record<string, { requiredPermission: string; decisionMode?: PolicyDecisionMode }> = {
  "oauth.scope.compare": { requiredPermission: "security.scope.compare" },
  "security.token.inspect": { requiredPermission: "security.token.inspect" },
  "security.secret.reveal": { requiredPermission: "security.secret.reveal" },
  "access.permission.grant": { requiredPermission: "access.permission.grant", decisionMode: "requires_approval" },
  "pagerduty.alert_ingestion.diagnose": { requiredPermission: "incident.draft.create" },
  "api.health.read": { requiredPermission: "apihealth.read" },
  "github.rate_limit.read": { requiredPermission: "github.rate_limit.read" }
};

export const agentPermissions: Record<string, string[]> = {
  "servicenow-orchestrator-agent": [
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

export const delegationPolicies: Record<string, Record<string, string[]>> = {
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

export function canonicalAction(action: string): string {
  return actionAliases[action] ?? action;
}
