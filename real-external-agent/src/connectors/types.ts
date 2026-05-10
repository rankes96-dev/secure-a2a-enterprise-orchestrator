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
  executionType?: "diagnostic_read_only" | "write_action" | "inspection_read_only" | "unsupported";
  diagnosesActionId?: string;
  diagnosesActionLabel?: string;
};

export type ConnectorDemoDefaults = {
  oauthApplication: {
    appName: string;
    defaultApplicationAccessGrants: string[];
  };
  servicePrincipal: {
    principalId: string;
    defaultEffectivePermissions: string[];
    defaultDeniedPermissions: string[];
  };
  defaultEnabledSkillIds?: string[];
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
  demoDefaults: ConnectorDemoDefaults;
};

export type SupportedConnector = {
  connectorId: string;
  resourceSystem: string;
  displayName: string;
  status: "available" | "coming_soon";
  description: string;
};
