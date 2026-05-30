import type {
  OgenActionCategory,
  OgenActionConstraints,
  OgenApprovalMode,
  OgenFieldClass,
  OgenResourceSensitivity
} from "./ogenActionTaxonomy.js";

export type OgenToolSourceType =
  | "mcp_tool_manifest"
  | "a2a_agent_card_skill"
  | "connector_profile_action"
  | "sdk_action_catalog"
  | "manually_imported_catalog";

export type OgenToolMappingStatus =
  | "mapped"
  | "incomplete_metadata"
  | "unsupported_tool_shape"
  | "blocked_unknown_tool";

export type OgenMappedExecutionType =
  | "diagnostic_read_only"
  | "inspection_read_only"
  | "write_action"
  | "unsupported";

export type OgenMappedRiskLevel =
  | "low"
  | "medium"
  | "high"
  | "sensitive";

export type OgenToolDefinition = {
  sourceType: OgenToolSourceType;
  sourceId: string;
  toolId: string;
  actionId?: string;
  label?: string;
  provider?: string;
  resourceSystem?: string;
  executionType?: OgenMappedExecutionType;
  riskLevel?: OgenMappedRiskLevel;
  requiresApproval?: boolean;
  sensitivity?: "standard" | "sensitive";
  actionCategory?: OgenActionCategory;
  approvalMode?: OgenApprovalMode;
  resourceSensitivity?: OgenResourceSensitivity;
  fieldClasses?: OgenFieldClass[];
  actionConstraints?: OgenActionConstraints;
  requiredApplicationGrants?: string[];
  requiredEffectivePermissions?: string[];
  requestedScopes?: string[];
};

export type OgenNormalizedActionMetadata = {
  actionId: string;
  label: string;
  provider: string;
  resourceSystem: string;
  executionType: OgenMappedExecutionType;
  riskLevel: OgenMappedRiskLevel;
  requiresApproval: boolean;
  sensitivity: "standard" | "sensitive";
  actionCategory: OgenActionCategory;
  approvalMode: OgenApprovalMode;
  resourceSensitivity: OgenResourceSensitivity;
  fieldClasses: OgenFieldClass[];
  actionConstraints: OgenActionConstraints;
  requiredApplicationGrants: string[];
  requiredEffectivePermissions: string[];
  requestedScopes: string[];
};

export type OgenToolMappingProof = {
  sourceType: OgenToolSourceType;
  sourceId: string;
  toolId: string;
  provider?: string;
  resourceSystem?: string;
  deterministicMapping: true;
  aiInferred: false;
  rawDescriptionStored: false;
  protectedMaterialExposed: false;
};

export type OgenToolMappingCertificationResult = {
  certified: boolean;
  failedChecks: string[];
};

export type OgenToolToActionMapping = {
  status: OgenToolMappingStatus;
  action?: OgenNormalizedActionMetadata;
  missingFields: string[];
  reason: string;
  proof: OgenToolMappingProof;
  certificationResult: OgenToolMappingCertificationResult;
};
