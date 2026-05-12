import type { ConnectorProfile, ConnectorSkillRequirement } from "./types.js";

const jiraSkills: ConnectorSkillRequirement[] = [
  {
    id: "jira.issue.status.lookup",
    label: "Look up Jira issue status",
    description: "Return an end-user-safe Jira issue status summary when the actor can browse the issue.",
    requiredApplicationGrants: ["read:jira-work"],
    requiredEffectivePermissions: ["browse_projects", "view_issues"],
    executionType: "inspection_read_only"
  },
  {
    id: "jira.project.access.prepare",
    label: "Prepare Jira project access request",
    description: "Prepare a Jira project access request without granting permission.",
    requiredApplicationGrants: ["read:jira-user"],
    requiredEffectivePermissions: ["read_project_roles"],
    executionType: "inspection_read_only"
  },
  {
    id: "jira.issue.diagnose_creation_failure",
    label: "Diagnose Jira issue creation failures",
    description: "Inspect project and issue metadata to explain why Jira issue creation is failing.",
    requiredApplicationGrants: ["read:jira-work"],
    requiredEffectivePermissions: ["browse_projects", "view_issues"],
    executionType: "diagnostic_read_only",
    diagnosesActionId: "jira.issue.create",
    diagnosesActionLabel: "Create Jira issue"
  },
  {
    id: "jira.permission.inspect",
    label: "Inspect Jira permissions",
    description: "Review project roles and user visibility that affect Jira access.",
    requiredApplicationGrants: ["read:jira-user"],
    requiredEffectivePermissions: ["read_project_roles"],
    executionType: "inspection_read_only"
  },
  {
    id: "jira.issue.create",
    label: "Create Jira issues",
    description: "Create new Jira issues through the external agent runtime.",
    requiredApplicationGrants: ["write:jira-work"],
    requiredEffectivePermissions: ["create_issues"],
    executionType: "write_action"
  }
];

export const jiraReferenceConnector: ConnectorProfile = {
  resourceSystem: "jira",
  connectorId: "jira-reference",
  displayName: "Jira Cloud Reference Connector",
  version: "1.0.0",
  profileSource: "external_agent",
  planning: {
    supported: true,
    description: "Supports side-effect-free planning for Jira access and permission requests.",
    supportedIntentClasses: ["access_request", "permission_request", "project_access"]
  },
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
  actionCatalog: jiraSkills,
  validationTests: [
    {
      id: "jira.access.planning.check_ready",
      title: "Jira access planning readiness",
      category: "end_user_planning",
      persona: "bizapps_it",
      description: "Validates ambiguous access clarification, Jira target selection, safe planning, and readiness check.",
      proves: "Jira access requests are planned safely and confirmation does not run a write/admin action directly.",
      steps: [
        { message: "I need access to the system", expectedOutcome: "needs_more_info" },
        { message: "Use Jira for the previous access request", expectedOutcome: "planned" },
        { message: "ok do it", expectedOutcome: "check_ready" }
      ],
      expectedFinalOutcome: "check_ready",
      requiresPlanning: true,
      referenceOnly: true
    },
    {
      id: "jira.issue.creation.diagnose",
      title: "Jira issue creation diagnosis",
      category: "approved_diagnostic",
      persona: "bizapps_it",
      description: "Validates the approved read-only Jira issue creation diagnostic skill.",
      proves: "Jira diagnostic skills can execute without enabling the target issue creation action.",
      steps: [
        { message: "Jira issue creation fails with 403 when creating issues in FIN project", expectedOutcome: "diagnosed" }
      ],
      expectedFinalOutcome: "diagnosed",
      requiresRuntimeReady: true,
      referenceOnly: true
    },
    {
      id: "jira.issue.status.lookup.validation",
      title: "Jira issue status lookup",
      category: "approved_diagnostic",
      persona: "end_user",
      description: "Validates end-user issue status lookup with project browse checks.",
      proves: "Jira-owned runtime data answers issue status without Gateway hardcoding issue details.",
      steps: [
        { message: "What is the status of FIN-42?", expectedOutcome: "diagnosed" }
      ],
      expectedFinalOutcome: "diagnosed",
      requiresRuntimeReady: true,
      referenceOnly: true
    },
    {
      id: "jira.project.access.prepare.validation",
      title: "Jira project access request preparation",
      category: "end_user_planning",
      persona: "end_user",
      description: "Validates Jira project access preparation without granting access.",
      proves: "The connector prepares access guidance and accurately states no permission was changed.",
      steps: [
        { message: "I need access to Jira project FIN", expectedOutcome: "diagnosed" }
      ],
      expectedFinalOutcome: "diagnosed",
      requiresRuntimeReady: true,
      referenceOnly: true
    },
    {
      id: "jira.issue.create.blocked",
      title: "Jira issue creation blocked",
      category: "blocked_write_action",
      persona: "bizapps_it",
      description: "Validates that Jira issue creation remains blocked by grants, permissions, or policy.",
      proves: "Write/admin actions stay blocked unless the connector profile and Gateway policy approve them.",
      steps: [
        { message: "Create a Jira issue in FIN project for this outage", expectedOutcome: "blocked" }
      ],
      expectedFinalOutcome: "blocked",
      referenceOnly: true
    }
  ],
  demoDefaults: {
    oauthApplication: {
      appName: "Jira Agent Connected App",
      defaultApplicationAccessGrants: ["read:jira-work", "read:jira-user"]
    },
    servicePrincipal: {
      principalId: "svc-a2a-jira-agent",
      defaultEffectivePermissions: ["browse_projects", "view_issues", "read_project_roles"],
      defaultDeniedPermissions: ["create_issues"]
    }
  }
};
