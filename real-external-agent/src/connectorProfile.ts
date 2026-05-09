import type { AdminConfig } from "./adminConfig.js";

export type CatalogItem = {
  id: string;
  label: string;
  description: string;
};

export type ActionCatalogItem = {
  id: string;
  label: string;
  description: string;
  requiredApplicationGrants: string[];
  requiredEffectivePermissions: string[];
};

export type ConnectorProfile = {
  resourceSystem: "jira";
  connectorId: "jira-reference";
  displayName: "Jira Cloud Reference Connector";
  applicationAccessGrantCatalog: CatalogItem[];
  effectivePermissionCatalog: CatalogItem[];
  actionCatalog: ActionCatalogItem[];
};

export type ActionReadinessPreview = {
  actionId: string;
  label: string;
  status:
    | "ready"
    | "disabled"
    | "blocked_missing_application_grant"
    | "blocked_missing_effective_permission"
    | "blocked_denied_permission"
    | "blocked_application_grant_and_permission";
  missingApplicationGrants: string[];
  missingEffectivePermissions: string[];
  deniedPermissions: string[];
};

const jiraConnectorProfile: ConnectorProfile = {
  resourceSystem: "jira",
  connectorId: "jira-reference",
  displayName: "Jira Cloud Reference Connector",
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
  actionCatalog: [
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
  ]
};

export function getConnectorProfile(): ConnectorProfile {
  return jiraConnectorProfile;
}

export function actionRequirementsFor(actionId: string): ActionCatalogItem | undefined {
  return jiraConnectorProfile.actionCatalog.find((action) => action.id === actionId);
}

export function deriveRequestedApplicationGrants(enabledActionIds: string[]): string[] {
  const requested = new Set<string>();
  for (const actionId of enabledActionIds) {
    const action = actionRequirementsFor(actionId);
    action?.requiredApplicationGrants.forEach((grant) => requested.add(grant));
  }
  return [...requested];
}

export function previewActionReadiness(config: AdminConfig): ActionReadinessPreview[] {
  const selectedGrants = new Set(config.oauthApplication.applicationAccessGrants);
  const effectivePermissions = new Set(config.servicePrincipal.effectivePermissions);
  const deniedPermissions = new Set(config.servicePrincipal.deniedPermissions);
  const enabledActions = new Set(config.capabilityDeclaration.agentDeclaredCapabilities);

  return jiraConnectorProfile.actionCatalog.map((action) => {
    if (!enabledActions.has(action.id)) {
      return {
        actionId: action.id,
        label: action.label,
        status: "disabled",
        missingApplicationGrants: [],
        missingEffectivePermissions: [],
        deniedPermissions: []
      };
    }

    const missingApplicationGrants = action.requiredApplicationGrants.filter((grant) => !selectedGrants.has(grant));
    const denied = action.requiredEffectivePermissions.filter((permission) => deniedPermissions.has(permission));
    const missingEffectivePermissions = action.requiredEffectivePermissions.filter((permission) => !effectivePermissions.has(permission) && !deniedPermissions.has(permission));
    const hasApplicationGrantBlock = missingApplicationGrants.length > 0;
    const hasPermissionBlock = missingEffectivePermissions.length > 0 || denied.length > 0;

    return {
      actionId: action.id,
      label: action.label,
      status: hasApplicationGrantBlock && hasPermissionBlock
        ? "blocked_application_grant_and_permission"
        : hasApplicationGrantBlock
          ? "blocked_missing_application_grant"
          : denied.length > 0
            ? "blocked_denied_permission"
            : missingEffectivePermissions.length > 0
              ? "blocked_missing_effective_permission"
              : "ready",
      missingApplicationGrants,
      missingEffectivePermissions,
      deniedPermissions: denied
    };
  });
}
