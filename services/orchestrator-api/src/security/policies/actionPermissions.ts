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
  "pagerduty.alert_ingestion.diagnose": { requiredPermission: "pagerduty.diagnose" },
  "api.health.read": { requiredPermission: "apihealth.read" },
  "github.rate_limit.read": { requiredPermission: "github.rate_limit.read" }
};

export function canonicalAction(action: string): string {
  return actionAliases[action] ?? action;
}
