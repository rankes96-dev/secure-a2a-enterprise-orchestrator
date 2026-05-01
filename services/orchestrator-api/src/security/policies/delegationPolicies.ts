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
