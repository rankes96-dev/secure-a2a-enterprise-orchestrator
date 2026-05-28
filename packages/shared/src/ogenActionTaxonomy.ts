export const OGEN_ACTION_CATEGORIES = [
  "read",
  "search",
  "diagnose",
  "comment.add",
  "business_object.read",
  "business_object.create",
  "business_object.update",
  "workflow_state.change",
  "assignment.change",
  "permission.inspect",
  "permission.grant",
  "record.delete",
  "bulk.modify",
  "admin.configure",
  "external_message.send"
] as const;

export type OgenActionCategory = typeof OGEN_ACTION_CATEGORIES[number];

export const OGEN_APPROVAL_MODES = [
  "never",
  "policy",
  "always",
  "blocked"
] as const;

export type OgenApprovalMode = typeof OGEN_APPROVAL_MODES[number];

export const OGEN_RESOURCE_SENSITIVITIES = [
  "standard",
  "sensitive",
  "regulated",
  "security_critical",
  "admin_controlled"
] as const;

export type OgenResourceSensitivity = typeof OGEN_RESOURCE_SENSITIVITIES[number];

export const OGEN_FIELD_CLASSES = [
  "workflow_state",
  "assignment",
  "classification",
  "financial",
  "customer_pii",
  "employee_pii",
  "security",
  "identity",
  "permission",
  "admin_config",
  "external_message"
] as const;

export type OgenFieldClass = typeof OGEN_FIELD_CLASSES[number];

export type OgenActionConstraints = {
  bulkAllowed?: boolean;
  maxRecordsPerRequest?: number;
  maxActionsPerHour?: number;
  requiresConnectedAccount?: boolean;
  auditRequired?: boolean;
};

export type OgenPolicyConditionModel = {
  actionCategories?: OgenActionCategory[];
  executionTypes?: string[];
  riskLevels?: string[];
  approvalModes?: OgenApprovalMode[];
  resourceSensitivities?: OgenResourceSensitivity[];
  actorRolesAny?: string[];
  connectorIds?: string[];
  resourceSystems?: string[];
  providers?: string[];
  fieldClasses?: OgenFieldClass[];
  bulk?: boolean;
  maxRecordsPerRequest?: number;
  maxActionsPerHour?: number;
  requiresConnectedAccount?: boolean;
  auditRequired?: boolean;
};
