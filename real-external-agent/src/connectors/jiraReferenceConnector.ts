import type { ConnectorProfile } from "./types.js";

const jiraSkills = [
  {
    id: "jira.issue.diagnose_creation_failure",
    label: "Diagnose Jira issue creation failures",
    description: "Inspect project and issue metadata to explain why Jira issue creation is failing.",
    requiredApplicationGrants: ["read:jira-work"],
    requiredEffectivePermissions: ["browse_projects", "view_issues"]
  },
  {
    id: "jira.permission.inspect",
    label: "Inspect Jira permissions",
    description: "Review project roles and user visibility that affect Jira access.",
    requiredApplicationGrants: ["read:jira-user"],
    requiredEffectivePermissions: ["read_project_roles"]
  },
  {
    id: "jira.issue.create",
    label: "Create Jira issues",
    description: "Create new Jira issues through the external agent runtime.",
    requiredApplicationGrants: ["write:jira-work"],
    requiredEffectivePermissions: ["create_issues"]
  }
];

export const jiraReferenceConnector: ConnectorProfile = {
  resourceSystem: "jira",
  connectorId: "jira-reference",
  displayName: "Jira Cloud Reference Connector",
  version: "1.0.0",
  profileSource: "external_agent",
  applicationAccessGrantCatalog: [
    {
      id: "read:jira-work",
      label: "Read Jira work items",
      description: "Allows the connected app to read Jira issues and project work data."
    },
    {
      id: "read:jira-user",
      label: "Read Jira users",
      description: "Allows the connected app to read Jira user and project role data."
    },
    {
      id: "write:jira-work",
      label: "Write Jira work items",
      description: "Allows the connected app to create or modify Jira work items."
    },
    {
      id: "manage:jira-project",
      label: "Manage Jira projects",
      description: "Administrative Jira project management access."
    }
  ],
  effectivePermissionCatalog: [
    {
      id: "browse_projects",
      label: "Browse projects",
      description: "Integration user can browse Jira projects."
    },
    {
      id: "view_issues",
      label: "View issues",
      description: "Integration user can view Jira issues."
    },
    {
      id: "read_project_roles",
      label: "Read project roles",
      description: "Integration user can inspect project roles."
    },
    {
      id: "create_issues",
      label: "Create issues",
      description: "Integration user can create Jira issues."
    },
    {
      id: "administer_projects",
      label: "Administer projects",
      description: "Integration user can administer Jira projects."
    }
  ],
  skillCatalog: jiraSkills,
  actionCatalog: jiraSkills
};
