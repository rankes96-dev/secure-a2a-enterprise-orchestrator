export type ResourcePermissionRegistration = {
  resourceSystem: string;
  principal: string;
  clientId: string;
  effectivePermissions: string[];
  deniedPermissions: string[];
};

export type CapabilityPermissionEvaluation = {
  capability: string;
  requiredPermissions: string[];
  missingPermissions: string[];
  deniedPermissions: string[];
};

const resourcePermissionRegistrations: ResourcePermissionRegistration[] = [
  {
    resourceSystem: "jira",
    principal: "svc-a2a-jira-agent",
    clientId: "jira-agent-client",
    effectivePermissions: ["browse_projects", "view_issues", "read_project_roles"],
    deniedPermissions: ["create_issues"]
  },
  {
    resourceSystem: "salesforce",
    principal: "svc-a2a-salesforce-agent",
    clientId: "salesforce-access-agent-client",
    effectivePermissions: ["read_user", "read_account", "read_permission"],
    deniedPermissions: ["modify_permission"]
  }
];

const capabilityPermissionRequirements = new Map<string, string[]>([
  ["jira.issue.diagnose_creation_failure", ["browse_projects", "view_issues"]],
  ["jira.permission.inspect", ["read_project_roles"]],
  ["jira.issue.create", ["create_issues"]],
  ["salesforce.access.diagnose", ["read_user", "read_account", "read_permission"]]
]);

export function getResourcePermissionRegistration(clientId: string): ResourcePermissionRegistration | undefined {
  return resourcePermissionRegistrations.find((registration) => registration.clientId === clientId);
}

export function evaluateResourcePermissionRegistration(registration: ResourcePermissionRegistration, agentDeclaredCapabilities: string[]): CapabilityPermissionEvaluation[] {
  const effectivePermissions = new Set(registration.effectivePermissions);
  const deniedPermissions = new Set(registration.deniedPermissions);

  return agentDeclaredCapabilities.map((capability) => {
    const requiredPermissions = capabilityPermissionRequirements.get(capability) ?? [];
    return {
      capability,
      requiredPermissions,
      missingPermissions: requiredPermissions.filter((permission) => !effectivePermissions.has(permission) && !deniedPermissions.has(permission)),
      deniedPermissions: requiredPermissions.filter((permission) => deniedPermissions.has(permission))
    };
  });
}

export function evaluateResourcePermissions(clientId: string, agentDeclaredCapabilities: string[]): {
  registration?: ResourcePermissionRegistration;
  evaluations: CapabilityPermissionEvaluation[];
} {
  const registration = getResourcePermissionRegistration(clientId);

  return {
    registration,
    evaluations: registration ? evaluateResourcePermissionRegistration(registration, agentDeclaredCapabilities) : []
  };
}
