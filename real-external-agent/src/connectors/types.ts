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
  requestedScopes?: string[];
  capabilityIds?: string[];
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

export type EndUserAnswerSeverity =
  | "info"
  | "low"
  | "medium"
  | "high";

export type EndUserAnswer = {
  title: string;
  summary: string;
  whatWasChecked?: string;
  whatWasChanged?: string;
  nextStep: string;
  severity?: EndUserAnswerSeverity;
  safeToDisplay: true;
};

export type ConnectorValidationTestCategory =
  | "end_user_planning"
  | "approved_diagnostic"
  | "blocked_write_action"
  | "adversarial"
  | "unsupported_handoff";

export type ConnectorValidationTestOutcome =
  | "needs_more_info"
  | "planned"
  | "check_ready"
  | "diagnosed"
  | "blocked"
  | "unsupported";

export type ConnectorValidationTestStep = {
  message: string;
  expectedOutcome: ConnectorValidationTestOutcome;
};

export type ConnectorValidationTest = {
  id: string;
  title: string;
  category: ConnectorValidationTestCategory;
  persona: "end_user" | "bizapps_it" | "security";
  description: string;
  proves: string;
  steps: ConnectorValidationTestStep[];
  expectedFinalOutcome: ConnectorValidationTestOutcome;
  requiresPlanning?: boolean;
  requiresRuntimeReady?: boolean;
  referenceOnly?: boolean;
};

export type ConnectorProfile = {
  resourceSystem: string;
  connectorId: string;
  displayName: string;
  version: string;
  profileSource: "external_agent" | "built_in_reference" | "custom_connector";
  planning?: {
    supported: boolean;
    description: string;
    supportedIntentClasses: string[];
  };
  applicationAccessGrantCatalog: ConnectorCatalogItem[];
  effectivePermissionCatalog: ConnectorCatalogItem[];
  skillCatalog: ConnectorSkillRequirement[];
  actionCatalog: ConnectorSkillRequirement[];
  validationTests?: ConnectorValidationTest[];
  demoDefaults: ConnectorDemoDefaults;
};

export type SupportedConnector = {
  connectorId: string;
  resourceSystem: string;
  displayName: string;
  status: "available" | "coming_soon";
  description: string;
};
