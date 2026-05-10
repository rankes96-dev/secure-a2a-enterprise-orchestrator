import type { ConnectorProfile, ConnectorSkillRequirement } from "./types.js";

const serviceNowSkills: ConnectorSkillRequirement[] = [
  {
    id: "servicenow.incident.assignment.diagnose",
    label: "Diagnose ServiceNow incident assignment failure",
    description: "Inspect incident assignment metadata, roles, and ACLs that affect assignment routing.",
    requiredApplicationGrants: ["incident.read"],
    requiredEffectivePermissions: ["role:itil", "table:incident:read"],
    executionType: "diagnostic_read_only",
    diagnosesActionId: "servicenow.incident.assign",
    diagnosesActionLabel: "Assign ServiceNow incident"
  },
  {
    id: "servicenow.catalog.request.diagnose",
    label: "Diagnose ServiceNow catalog request failure",
    description: "Review request item visibility and catalog read access for failed RITM workflows.",
    requiredApplicationGrants: ["catalog.read"],
    requiredEffectivePermissions: ["table:sc_req_item:read"],
    executionType: "diagnostic_read_only",
    diagnosesActionId: "servicenow.catalog.request.approve_or_fulfill",
    diagnosesActionLabel: "Process catalog request"
  },
  {
    id: "servicenow.user.role.inspect",
    label: "Inspect ServiceNow user role access",
    description: "Inspect user role and ACL visibility that affect ServiceNow access.",
    requiredApplicationGrants: ["user.read"],
    requiredEffectivePermissions: ["acl:user:read"],
    executionType: "inspection_read_only"
  },
  {
    id: "servicenow.incident.assign",
    label: "Assign ServiceNow incident",
    description: "Assign or update ServiceNow incident records through the external agent runtime.",
    requiredApplicationGrants: ["incident.write"],
    requiredEffectivePermissions: ["role:itil", "table:incident:write"],
    executionType: "write_action"
  },
  {
    id: "servicenow.catalog.request.approve_or_fulfill",
    label: "Process catalog request",
    description: "Approve, fulfill, or transition ServiceNow catalog request records.",
    requiredApplicationGrants: ["catalog.read"],
    requiredEffectivePermissions: ["role:catalog_admin"],
    executionType: "write_action"
  }
];

const serviceNowRuntimeSkills = serviceNowSkills.filter((skill) =>
  skill.executionType !== "write_action"
);

export const serviceNowReferenceConnector: ConnectorProfile = {
  resourceSystem: "servicenow",
  connectorId: "servicenow-reference",
  displayName: "ServiceNow Reference Connector",
  version: "1.0.0",
  profileSource: "external_agent",
  planning: {
    supported: false,
    description: "Planning handler not implemented in the V1 ServiceNow reference connector.",
    supportedIntentClasses: []
  },
  applicationAccessGrantCatalog: [
    {
      id: "incident.read",
      label: "Read incidents",
      description: "Allows the connected app to read ServiceNow incident records."
    },
    {
      id: "incident.write",
      label: "Write incidents",
      description: "Allows the connected app to update ServiceNow incident records."
    },
    {
      id: "catalog.read",
      label: "Read catalog requests",
      description: "Allows the connected app to read catalog request and RITM data."
    },
    {
      id: "user.read",
      label: "Read users",
      description: "Allows the connected app to read user and role metadata."
    }
  ],
  effectivePermissionCatalog: [
    {
      id: "role:itil",
      label: "ITIL role",
      description: "Integration user has the ServiceNow itil role."
    },
    {
      id: "role:catalog_admin",
      label: "Catalog admin role",
      description: "Integration user can administer catalog configuration."
    },
    {
      id: "table:incident:read",
      label: "Read incident table",
      description: "Integration user can read incident table records."
    },
    {
      id: "table:incident:write",
      label: "Write incident table",
      description: "Integration user can update incident table records."
    },
    {
      id: "table:sc_req_item:read",
      label: "Read request item table",
      description: "Integration user can read sc_req_item records."
    },
    {
      id: "acl:user:read",
      label: "Read user ACL",
      description: "Integration user can inspect user role and ACL metadata."
    }
  ],
  skillCatalog: serviceNowRuntimeSkills,
  actionCatalog: serviceNowSkills,
  demoDefaults: {
    oauthApplication: {
      appName: "ServiceNow Agent Connected App",
      defaultApplicationAccessGrants: ["incident.read", "catalog.read", "user.read"]
    },
    servicePrincipal: {
      principalId: "svc-a2a-servicenow-agent",
      defaultEffectivePermissions: ["role:itil", "table:incident:read", "table:sc_req_item:read", "acl:user:read"],
      defaultDeniedPermissions: ["table:incident:write"]
    }
  }
};
