import type { OgenActionCategory, OgenActionConstraints, OgenApprovalMode, OgenFieldClass, OgenResourceSensitivity } from "@a2a/shared";

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
  capabilityIds?: string[];
  riskLevel?: "low" | "medium" | "high" | "sensitive";
  executionType?: "diagnostic_read_only" | "write_action" | "inspection_read_only" | "unsupported";
  requiresApproval?: boolean;
  sensitivity?: "standard" | "sensitive";
  actionCategory?: OgenActionCategory;
  approvalMode?: OgenApprovalMode;
  resourceSensitivity?: OgenResourceSensitivity;
  fieldClasses?: OgenFieldClass[];
  actionConstraints?: OgenActionConstraints;
  provider?: string;
  resourceSystem?: string;
  diagnosesActionId?: string;
  diagnosesActionLabel?: string;
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
  connectorId: string;
  resourceSystem: string;
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
  skillCatalog: ConnectorActionRequirement[];
  actionCatalog: ConnectorActionRequirement[];
  validationTests?: ConnectorValidationTest[];
  intentHints?: unknown;
  demoDefaults?: unknown;
};

export type ConnectorDecisionInput = {
  connectorProfile: ConnectorProfile;
  agentId: string;
  clientId: string;
  declaredSkills: string[];
  declaredActions?: string[];
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
  riskLevel?: ConnectorActionRequirement["riskLevel"];
  executionType?: ConnectorActionRequirement["executionType"];
  requiresApproval?: boolean;
  sensitivity?: "standard" | "sensitive";
  actionCategory?: ConnectorActionRequirement["actionCategory"];
  approvalMode?: ConnectorActionRequirement["approvalMode"];
  resourceSensitivity?: ConnectorActionRequirement["resourceSensitivity"];
  fieldClasses?: ConnectorActionRequirement["fieldClasses"];
  actionConstraints?: ConnectorActionRequirement["actionConstraints"];
  provider?: string;
  resourceSystem?: string;
  requiredApplicationGrants: string[];
  requiredEffectivePermissions: string[];
  missingApplicationGrants: string[];
  missingEffectivePermissions: string[];
  deniedEffectivePermissions: string[];
};
