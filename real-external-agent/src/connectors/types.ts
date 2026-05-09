export type ConnectorCatalogItem = {
  id: string;
  label: string;
  description: string;
};

export type ConnectorSkillRequirement = {
  id: string;
  label: string;
  description: string;
  requiredApplicationGrants: string[];
  requiredEffectivePermissions: string[];
  riskLevel?: "low" | "medium" | "high" | "sensitive";
};

export type ConnectorProfile = {
  resourceSystem: string;
  connectorId: string;
  displayName: string;
  version: string;
  profileSource: "external_agent" | "built_in_reference" | "custom_connector";
  applicationAccessGrantCatalog: ConnectorCatalogItem[];
  effectivePermissionCatalog: ConnectorCatalogItem[];
  skillCatalog: ConnectorSkillRequirement[];
  actionCatalog: ConnectorSkillRequirement[];
};

export type SupportedConnector = {
  connectorId: string;
  resourceSystem: string;
  displayName: string;
  status: "available" | "coming_soon";
  description: string;
};
