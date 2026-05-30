import type { ConnectorProfile, ConnectorSkillRequirement } from "./types.js";

const serviceNowSkills: ConnectorSkillRequirement[] = [
  {
    id: "servicenow.ticket.status.lookup",
    label: "Look up ServiceNow ticket status",
    description: "Return an end-user-safe status summary for an incident or request item the actor is allowed to view.",
    requiredApplicationGrants: ["incident.read", "catalog.read"],
    requiredEffectivePermissions: ["role:itil", "table:incident:read", "table:sc_req_item:read"],
    requestedScopes: ["incident.read", "catalog.read"],
    executionType: "inspection_read_only"
  },
  {
    id: "servicenow.catalog.item.recommend",
    label: "Recommend ServiceNow catalog item",
    description: "Recommend the right catalog item for access, mailbox, distribution list, or generic requests without submitting it.",
    requiredApplicationGrants: ["catalog.read"],
    requiredEffectivePermissions: ["table:sc_req_item:read"],
    requestedScopes: ["catalog.read"],
    capabilityIds: ["access.request.prepare", "service.request.prepare", "catalog.item.recommend", "request.fulfillment.prepare"],
    executionType: "inspection_read_only"
  },
  {
    id: "servicenow.incident.assignment.diagnose",
    label: "Diagnose ServiceNow incident assignment failure",
    description: "Inspect incident assignment metadata, roles, and ACLs that affect assignment routing.",
    requiredApplicationGrants: ["incident.read"],
    requiredEffectivePermissions: ["role:itil", "table:incident:read"],
    requestedScopes: ["incident.read"],
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
    requestedScopes: ["catalog.read"],
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
    requestedScopes: ["user.read"],
    executionType: "inspection_read_only"
  },
  {
    id: "servicenow.incident.assign",
    label: "Assign ServiceNow incident",
    description: "Assign or update ServiceNow incident records through the external agent runtime.",
    requiredApplicationGrants: ["incident.write"],
    requiredEffectivePermissions: ["role:itil", "table:incident:write"],
    requestedScopes: ["incident.write"],
    executionType: "write_action"
  },
  {
    id: "servicenow.catalog.request.approve_or_fulfill",
    label: "Process catalog request",
    description: "Approve, fulfill, or transition ServiceNow catalog request records.",
    requiredApplicationGrants: ["catalog.read"],
    requiredEffectivePermissions: ["role:catalog_admin"],
    requestedScopes: ["catalog.read"],
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
  validationTests: [
    {
      id: "servicenow.incident.assignment.diagnose.validation",
      title: "ServiceNow incident assignment diagnosis",
      category: "approved_diagnostic",
      persona: "bizapps_it",
      description: "Validates the approved read-only ServiceNow incident assignment diagnostic skill.",
      proves: "ServiceNow incident assignment diagnostics run through the installed connector without granting incident write access.",
      steps: [
        { message: "ServiceNow incident assignment keeps failing for network tickets", expectedOutcome: "diagnosed" }
      ],
      expectedFinalOutcome: "diagnosed",
      requiresRuntimeReady: true,
      referenceOnly: true
    },
    {
      id: "servicenow.catalog.request.diagnose.validation",
      title: "ServiceNow catalog request diagnosis",
      category: "approved_diagnostic",
      persona: "bizapps_it",
      description: "Validates the approved read-only ServiceNow catalog request diagnostic skill.",
      proves: "ServiceNow catalog request diagnostics can execute without enabling fulfillment or approval changes.",
      steps: [
        { message: "ServiceNow catalog request is stuck", expectedOutcome: "diagnosed" }
      ],
      expectedFinalOutcome: "diagnosed",
      requiresRuntimeReady: true,
      referenceOnly: true
    },
    {
      id: "servicenow.ticket.status.lookup.validation",
      title: "ServiceNow ticket status lookup",
      category: "approved_diagnostic",
      persona: "end_user",
      description: "Validates end-user ticket status lookup with actor-aware visibility.",
      proves: "ServiceNow-owned runtime data answers ticket questions without Gateway hardcoding domain details.",
      steps: [
        { message: "What is the status of my ticket INC0010245?", expectedOutcome: "diagnosed" }
      ],
      expectedFinalOutcome: "diagnosed",
      requiresRuntimeReady: true,
      referenceOnly: true
    },
    {
      id: "servicenow.catalog.item.recommend.validation",
      title: "ServiceNow catalog recommendation",
      category: "end_user_planning",
      persona: "end_user",
      description: "Validates catalog item recommendation without submitting a request.",
      proves: "The connector can recommend a form while accurately saying no request was submitted.",
      steps: [
        { message: "I need AWS production access", expectedOutcome: "diagnosed" }
      ],
      expectedFinalOutcome: "diagnosed",
      requiresRuntimeReady: true,
      referenceOnly: true
    },
    {
      id: "servicenow.incident.assign.blocked.validation",
      title: "ServiceNow incident assignment blocked",
      category: "blocked_write_action",
      persona: "bizapps_it",
      description: "Validates that ServiceNow incident assignment write actions remain blocked.",
      proves: "Incident assignment changes do not execute unless write grants, permissions, and Gateway policy approve them.",
      steps: [
        { message: "Assign this ServiceNow incident to the network team", expectedOutcome: "blocked" }
      ],
      expectedFinalOutcome: "blocked",
      referenceOnly: true
    }
  ],
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
