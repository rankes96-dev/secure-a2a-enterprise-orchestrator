import type {
  OgenActionCategory,
  OgenActionConstraints,
  OgenApprovalMode,
  OgenFieldClass,
  OgenResourceSensitivity,
  OgenToolMappingProof,
  OgenToolMappingStatus
} from "@a2a/shared";

export type ConnectorPlanMode = "plan_only";

export type PlannedActionExecutionType =
  | "inspection_read_only"
  | "diagnostic_read_only"
  | "write_action"
  | "admin_action"
  | "unsupported";

export type PlannedActionRiskLevel =
  | "low"
  | "medium"
  | "high"
  | "critical";

export type PlannedActionSideEffects =
  | "none"
  | "reads_data"
  | "modifies_state"
  | "admin_change"
  | "cross_system";

export type ConnectorActionPlanOption = {
  actionId: string;
  label: string;
  description: string;
  executionType: PlannedActionExecutionType;
  riskLevel: PlannedActionRiskLevel;
  actionCategory: OgenActionCategory;
  approvalMode: OgenApprovalMode;
  resourceSensitivity: OgenResourceSensitivity;
  fieldClasses: OgenFieldClass[];
  actionConstraints: OgenActionConstraints;
  toolMappingStatus: OgenToolMappingStatus;
  toolMappingProof: OgenToolMappingProof;
  provider: string;
  resourceSystem: string;
  sideEffects: PlannedActionSideEffects;
  requiredApplicationGrants: string[];
  requiredEffectivePermissions: string[];
  requiresApproval: boolean;
  targetObjectTypes?: string[];
  missingInputs?: string[];
};

export type ConnectorActionPlan = {
  planId: string;
  connectorId: string;
  resourceSystem: string;
  interpretedIntent: string;
  userRequest: string;
  mode: ConnectorPlanMode;
  safeToDisplay: true;
  sideEffectsAllowed: "none";
  missingInputs: string[];
  options: ConnectorActionPlanOption[];
  recommendedOptionId?: string;
  recommendedNextStep: string;
};
