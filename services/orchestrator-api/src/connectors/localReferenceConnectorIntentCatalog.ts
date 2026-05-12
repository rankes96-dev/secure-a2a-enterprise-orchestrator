// Deterministic local demo routing catalog. Production connectors should provide
// intent hints through connector profiles or a managed connector registry.
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

export const localReferenceConnectorIntentCatalog: ConnectorIntentHint[] = [
  {
    connectorId: "jira-reference",
    resourceSystem: "jira",
    displayName: "Jira Cloud Reference Connector",
    systemTerms: ["jira", "fin-", "jira-", "fin project"],
    skillHints: [
      {
        skillId: "jira.issue.status.lookup",
        label: "Look up Jira issue status",
        includeAny: ["status of", "show me", "what is the status", "fin-", "jira-"],
        excludeAny: ["create", "access to project", "can't see", "cannot see"],
        reason: "The request asks for Jira issue status."
      },
      {
        skillId: "jira.project.access.prepare",
        label: "Prepare Jira project access request",
        includeAny: ["access to jira project", "access to fin project", "can't see the fin project", "cannot see the fin project", "need access to fin", "jira project fin"],
        excludeAny: ["create issue", "status"],
        reason: "The request asks to prepare Jira project access."
      },
      {
        skillId: "jira.permission.inspect",
        label: "Inspect Jira permissions",
        includeAny: ["project role", "project roles", "jira permission", "permission", "permissions", "inspect", "user cannot access project", "cannot access project"],
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
    systemTerms: ["servicenow", "service now", "incident", "catalog item", "requested item", "ritm", "change request", "inc", "ticket", "aws", "mailing list", "תפוצה", "הרשאה"],
    skillHints: [
      {
        skillId: "servicenow.ticket.status.lookup",
        label: "Look up ServiceNow ticket status",
        includeAny: ["status of my ticket", "ticket", "inc", "ritm", "סטטוס"],
        excludeAny: ["create a mailing list", "aws production access", "need aws", "permission to aws"],
        reason: "The request asks for ServiceNow ticket or request status."
      },
      {
        skillId: "servicenow.catalog.item.recommend",
        label: "Recommend ServiceNow catalog item",
        includeAny: ["aws production access", "permission to aws", "need aws", "הרשאה ל-aws", "הרשאה ל aws", "mailing list", "create a mailing list", "תפוצה", "shared mailbox", "mailbox"],
        reason: "The request asks for a ServiceNow catalog item recommendation."
      },
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
    systemTerms: ["github", "git hub", "repository", "repo", "pull request", "branch", "rate limit", "billing-api", "pr "],
    skillHints: [
      {
        skillId: "github.pull_request.status.lookup",
        label: "Look up GitHub pull request status",
        includeAny: ["status of pr", "pull request status", "pr 42", "why is my pr blocked"],
        reason: "The request asks for GitHub pull request status."
      },
      {
        skillId: "github.repository.access.prepare",
        label: "Prepare GitHub repository access request",
        includeAny: ["access to the billing-api repo", "access to billing-api", "write access to billing-api", "can't access the repository", "cannot access the repository"],
        reason: "The request asks to prepare GitHub repository access."
      },
      {
        skillId: "github.pull_request.access.diagnose",
        label: "Diagnose GitHub pull request access",
        includeAny: ["pull request", "pull request checks", " pr "],
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
        excludeAny: ["pull request"],
        reason: "The request references GitHub repository or API rate-limit workflows."
      }
    ]
  }
];
