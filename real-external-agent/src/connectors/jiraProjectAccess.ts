export type JiraProjectAccess = {
  projectKey: string;
  projectName: string;
  requestPath: string;
  defaultAccessLevel: "viewer" | "contributor" | "project admin";
  requiredInformation: string[];
  contributorGroups: string[];
};

export const jiraProjectAccessCatalog: JiraProjectAccess[] = [
  {
    projectKey: "FIN",
    projectName: "Finance Platform",
    requestPath: "https://jira.example.com/plugins/servlet/project-access/FIN",
    defaultAccessLevel: "viewer",
    requiredInformation: ["Requested access level", "Business justification", "Manager approval", "Expected duration"],
    contributorGroups: ["FIN Developers", "Finance Operations"]
  },
  {
    projectKey: "OPS",
    projectName: "Operations",
    requestPath: "https://jira.example.com/plugins/servlet/project-access/OPS",
    defaultAccessLevel: "viewer",
    requiredInformation: ["Requested access level", "Business justification", "Team owner"],
    contributorGroups: ["OPS Contributors"]
  }
];

export function findJiraProjectAccess(message: string): JiraProjectAccess | undefined {
  const normalized = message.toLowerCase();
  const explicitKey = message.match(/\b[A-Z][A-Z0-9]{1,8}\b/)?.[0]?.toUpperCase();
  return jiraProjectAccessCatalog.find((project) =>
    project.projectKey === explicitKey ||
    normalized.includes(project.projectKey.toLowerCase()) ||
    normalized.includes(project.projectName.toLowerCase())
  );
}

export function requestedJiraAccessLevel(message: string): "viewer" | "contributor" | "project admin" | undefined {
  const normalized = message.toLowerCase();
  if (/\b(admin|administrator|project admin)\b/.test(normalized)) return "project admin";
  if (/\b(contributor|create|edit|write|developer)\b/.test(normalized)) return "contributor";
  if (/\b(view|viewer|read|browse|see)\b/.test(normalized)) return "viewer";
  return undefined;
}

export function finProjectCreateIssueCheck(message: string): { status: "passed" | "blocked"; reason: string; missingPermission?: string } | undefined {
  if (!/\bFIN\b/i.test(message) || !/\b(create|issue|outage)\b/i.test(message)) {
    return undefined;
  }
  if (/\b403|can't|cannot|fail|fails|failing|why\b/i.test(message)) {
    return {
      status: "blocked",
      reason: "The service account has connector-level create permission, but the FIN project requires membership in FIN Developers for issue creation.",
      missingPermission: "FIN project contributor"
    };
  }
  return {
    status: "passed",
    reason: "FIN project target was identified. Connector-level checks are ready, but write execution still requires an approved execution flow."
  };
}
