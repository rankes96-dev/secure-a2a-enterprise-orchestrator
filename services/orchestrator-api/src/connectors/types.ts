export type ConnectorCatalogItem = {
  id: string;
  label: string;
  description: string;
};

export type ConnectorActionRequirement = {
  id: string;
  label: string;
  description: string;
  requiredApplicationGrants: string[];
  requiredEffectivePermissions: string[];
  riskLevel?: "low" | "medium" | "high" | "sensitive";
};

export type ConnectorProfile = {
  connectorId: string;
  resourceSystem: string;
  displayName: string;
  version: string;
  profileSource: "external_agent" | "built_in_reference" | "custom_connector";
  applicationAccessGrantCatalog: ConnectorCatalogItem[];
  effectivePermissionCatalog: ConnectorCatalogItem[];
  actionCatalog: ConnectorActionRequirement[];
};

export type ConnectorDecisionInput = {
  connectorProfile: ConnectorProfile;
  agentId: string;
  clientId: string;
  declaredActions: string[];
  requestedApplicationGrants: string[];
  applicationAccessGrants: string[];
  effectivePermissions: string[];
  deniedPermissions: string[];
};

export type ConnectorActionDecision = {
  actionId: string;
  label: string;
  status: "approved" | "blocked";
  reason: string;
  requiredApplicationGrants: string[];
  requiredEffectivePermissions: string[];
  missingApplicationGrants: string[];
  missingEffectivePermissions: string[];
  deniedEffectivePermissions: string[];
};
