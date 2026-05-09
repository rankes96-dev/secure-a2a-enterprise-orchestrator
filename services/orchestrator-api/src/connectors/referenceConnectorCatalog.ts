export type ConnectorIntentHint = {
  connectorId: string;
  resourceSystem: string;
  displayName: string;
  systemTerms: string[];
  skillHints: Array<{
    skillId: string;
    label: string;
    includeAny: string[];
    excludeAny?: string[];
    reason: string;
  }>;
};

export const referenceConnectorCatalog: ConnectorIntentHint[] = [
  {
    connectorId: "jira-reference",
    resourceSystem: "jira",
    displayName: "Jira Cloud Reference Connector",
    systemTerms: ["jira"],
    skillHints: [
      {
        skillId: "jira.permission.inspect",
        label: "Inspect Jira permissions",
        includeAny: ["project role", "jira permission", "permission", "permissions", "user cannot access project", "cannot access project"],
        reason: "The request mentions Jira permissions or project roles."
      },
      {
        skillId: "jira.issue.create",
        label: "Create Jira issues",
        includeAny: ["create jira issue", "create a jira issue", "create issue", "create ticket", "jira issue create", "issue create", "ticket create"],
        excludeAny: ["fail", "fails", "failing", "403", "permission"],
        reason: "The request asks the connector to create a Jira issue."
      },
      {
        skillId: "jira.issue.diagnose_creation_failure",
        label: "Diagnose Jira issue creation failures",
        includeAny: ["issue", "ticket creation", "create issue", "create ticket", "403", "project permission", "permission"],
        reason: "The request describes a Jira issue creation or permission failure."
      }
    ]
  },
  {
    connectorId: "servicenow-reference",
    resourceSystem: "servicenow",
    displayName: "ServiceNow Reference Connector",
    systemTerms: ["servicenow", "incident", "catalog item", "requested item", "ritm", "change request"],
    skillHints: [
      {
        skillId: "servicenow.catalog.request.diagnose",
        label: "Diagnose ServiceNow catalog request failure",
        includeAny: ["catalog", "requested item", "ritm", "approval"],
        reason: "The request references a ServiceNow catalog request or RITM failure."
      },
      {
        skillId: "servicenow.user.role.inspect",
        label: "Inspect ServiceNow user role access",
        includeAny: ["role", "acl", "user access", "user cannot", "access issue"],
        reason: "The request references ServiceNow roles, ACLs, or user access."
      },
      {
        skillId: "servicenow.incident.assignment.diagnose",
        label: "Diagnose ServiceNow incident assignment failure",
        includeAny: ["servicenow", "incident", "assignment", "network tickets", "change request"],
        reason: "The request references a ServiceNow incident assignment workflow."
      }
    ]
  },
  {
    connectorId: "github-reference",
    resourceSystem: "github",
    displayName: "GitHub Reference Connector",
    systemTerms: ["github", "repository", "repo", "pull request", "branch", "rate limit"],
    skillHints: [
      {
        skillId: "github.pull_request.access.diagnose",
        label: "Diagnose GitHub pull request access",
        includeAny: ["pull request", " pr "],
        reason: "The request references GitHub pull request access."
      },
      {
        skillId: "github.repository.permission.inspect",
        label: "Inspect GitHub repository permissions",
        includeAny: ["permission", "installation", "access"],
        excludeAny: ["rate limit"],
        reason: "The request references GitHub repository permissions or installation access."
      },
      {
        skillId: "github.repository.rate_limit.diagnose",
        label: "Diagnose GitHub repository API rate limit",
        includeAny: ["github", "repository", "repo", "rate limit", "repository sync"],
        reason: "The request references GitHub repository or API rate-limit workflows."
      }
    ]
  }
];
