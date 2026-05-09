import type { ConnectorProfile } from "./types.js";

const serviceNowSkills = [
  {
    id: "servicenow.incident.assignment.diagnose",
    label: "Diagnose ServiceNow incident assignment failure",
    description: "Inspect incident assignment metadata, roles, and ACLs that affect assignment routing.",
    requiredApplicationGrants: ["incident.read"],
    requiredEffectivePermissions: ["role:itil", "table:incident:read"]
  },
  {
    id: "servicenow.catalog.request.diagnose",
    label: "Diagnose ServiceNow catalog request failure",
    description: "Review request item visibility and catalog read access for failed RITM workflows.",
    requiredApplicationGrants: ["catalog.read"],
    requiredEffectivePermissions: ["table:sc_req_item:read"]
  },
  {
    id: "servicenow.user.role.inspect",
    label: "Inspect ServiceNow user role access",
    description: "Inspect user role and ACL visibility that affect ServiceNow access.",
    requiredApplicationGrants: ["user.read"],
    requiredEffectivePermissions: ["acl:user:read"]
  }
];

export const serviceNowReferenceConnector: ConnectorProfile = {
  resourceSystem: "servicenow",
  connectorId: "servicenow-reference",
  displayName: "ServiceNow Reference Connector",
  version: "1.0.0",
  profileSource: "external_agent",
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
  skillCatalog: serviceNowSkills,
  actionCatalog: serviceNowSkills
};
