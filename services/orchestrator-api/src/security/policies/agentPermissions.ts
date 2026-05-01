export const agentPermissions: Record<string, string[]> = {
  "servicenow-orchestrator-agent": [
    "enterprise.triage",
    "jira.diagnose",
    "github.diagnose",
    "github.rate_limit.read",
    "pagerduty.diagnose",
    "security.scope.compare",
    "apihealth.read"
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
