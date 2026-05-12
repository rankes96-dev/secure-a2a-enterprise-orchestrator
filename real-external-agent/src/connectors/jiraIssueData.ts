export type JiraIssue = {
  key: string;
  projectKey: string;
  status: string;
  summary: string;
  assignee: string;
  lastUpdate: string;
  blockers?: string;
  nextStep: string;
  allowedUsers: string[];
  allowedGroups: string[];
};

export const jiraIssues: JiraIssue[] = [
  {
    key: "FIN-42",
    projectKey: "FIN",
    status: "In Review",
    summary: "Billing export job fails for month-end close",
    assignee: "Maya Cohen",
    lastUpdate: "Finance engineering attached the failing job trace and is waiting for DBA review.",
    blockers: "DBA review is pending before the fix can move to production.",
    nextStep: "Watch for the DBA review update or ask the FIN project lead to prioritize it.",
    allowedUsers: ["ran@company.com", "analyst@company.com"],
    allowedGroups: ["it-support", "read-only"]
  },
  {
    key: "JIRA-123",
    projectKey: "JIRA",
    status: "To Do",
    summary: "Improve dashboard keyboard focus state",
    assignee: "Unassigned",
    lastUpdate: "The issue was triaged and is waiting for sprint planning.",
    nextStep: "Ask the project owner to assign it if this is urgent.",
    allowedUsers: ["admin@company.com"],
    allowedGroups: ["identity-admin"]
  }
];

export function findJiraIssue(message: string): JiraIssue | undefined {
  const key = message.match(/\b[A-Z][A-Z0-9]+-\d+\b/i)?.[0]?.toUpperCase();
  if (!key) {
    return undefined;
  }
  return jiraIssues.find((issue) => issue.key === key);
}

export function canBrowseJiraIssue(issue: JiraIssue, actor?: string, roles: string[] = []): boolean {
  const normalizedActor = actor?.toLowerCase();
  const normalizedRoles = new Set(roles.map((role) => role.toLowerCase()));
  return Boolean(
    normalizedActor &&
      (
        issue.allowedUsers.map((user) => user.toLowerCase()).includes(normalizedActor) ||
        issue.allowedGroups.some((group) => normalizedRoles.has(group.toLowerCase()))
      )
  );
}
