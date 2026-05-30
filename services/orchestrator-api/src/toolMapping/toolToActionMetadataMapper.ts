import {
  OGEN_ACTION_CATEGORIES,
  OGEN_APPROVAL_MODES,
  OGEN_FIELD_CLASSES,
  OGEN_RESOURCE_SENSITIVITIES,
  type OgenActionConstraints,
  type OgenFieldClass,
  type OgenMappedExecutionType,
  type OgenMappedRiskLevel,
  type OgenNormalizedActionMetadata,
  type OgenToolDefinition,
  type OgenToolMappingProof,
  type OgenToolMappingStatus,
  type OgenToolSourceType,
  type OgenToolToActionMapping
} from "@a2a/shared";

const sourceTypes = new Set<OgenToolSourceType>([
  "mcp_tool_manifest",
  "a2a_agent_card_skill",
  "connector_profile_action",
  "sdk_action_catalog",
  "manually_imported_catalog"
]);

const executionTypes = new Set<OgenMappedExecutionType>([
  "diagnostic_read_only",
  "inspection_read_only",
  "write_action",
  "unsupported"
]);

const riskLevels = new Set<OgenMappedRiskLevel>([
  "low",
  "medium",
  "high",
  "sensitive"
]);

const sensitivities = new Set(["standard", "sensitive"]);
const actionConstraintKeys = new Set([
  "bulkAllowed",
  "maxRecordsPerRequest",
  "maxActionsPerHour",
  "requiresConnectedAccount",
  "auditRequired"
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const trimmed = value.map((item) => typeof item === "string" ? item.trim() : undefined);
  return trimmed.every((item): item is string => item !== undefined && item.length > 0) ? trimmed : undefined;
}

function positiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function fieldClassArray(value: unknown): OgenFieldClass[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (value.every((item) => typeof item === "string" && OGEN_FIELD_CLASSES.includes(item as OgenFieldClass))) {
    return [...value] as OgenFieldClass[];
  }
  return undefined;
}

function validActionConstraintEntry(key: string, value: unknown): boolean {
  if (!actionConstraintKeys.has(key)) {
    return false;
  }
  if (value === undefined) {
    return true;
  }
  if (key === "maxRecordsPerRequest" || key === "maxActionsPerHour") {
    return positiveInteger(value);
  }
  return value === true || value === false;
}

function actionConstraints(value: unknown): OgenActionConstraints | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  if (!Object.entries(input).every(([key, entry]) => validActionConstraintEntry(key, entry))) {
    return undefined;
  }
  const constraints: OgenActionConstraints = {};
  if ("bulkAllowed" in input) constraints.bulkAllowed = input.bulkAllowed as boolean;
  if ("maxRecordsPerRequest" in input) constraints.maxRecordsPerRequest = input.maxRecordsPerRequest as number;
  if ("maxActionsPerHour" in input) constraints.maxActionsPerHour = input.maxActionsPerHour as number;
  if ("requiresConnectedAccount" in input) constraints.requiresConnectedAccount = input.requiresConnectedAccount as boolean;
  if ("auditRequired" in input) constraints.auditRequired = input.auditRequired as boolean;
  return constraints;
}

function proof(params: {
  sourceType?: unknown;
  sourceId?: unknown;
  toolId?: unknown;
  provider?: unknown;
  resourceSystem?: unknown;
}): OgenToolMappingProof {
  const sourceType = sourceTypes.has(params.sourceType as OgenToolSourceType)
    ? params.sourceType as OgenToolSourceType
    : "manually_imported_catalog";
  return {
    sourceType,
    sourceId: cleanString(params.sourceId) ?? "unknown",
    toolId: cleanString(params.toolId) ?? "unknown",
    provider: cleanString(params.provider),
    resourceSystem: cleanString(params.resourceSystem),
    deterministicMapping: true,
    aiInferred: false,
    rawDescriptionStored: false,
    protectedMaterialExposed: false
  };
}

function fail(status: OgenToolMappingStatus, reason: string, missingFields: string[], mappingProof: OgenToolMappingProof): OgenToolToActionMapping {
  return {
    status,
    missingFields,
    reason,
    proof: mappingProof,
    certificationResult: {
      certified: false,
      failedChecks: missingFields.length ? missingFields : [status]
    }
  };
}

function hasAnyDeterministicActionMetadata(input: Record<string, unknown>): boolean {
  return [
    "executionType",
    "riskLevel",
    "actionCategory",
    "approvalMode",
    "resourceSensitivity",
    "fieldClasses",
    "actionConstraints",
    "requiredApplicationGrants",
    "requiredEffectivePermissions",
    "requestedScopes"
  ].some((field) => input[field] !== undefined);
}

export function mapToolToActionMetadata(tool: OgenToolDefinition | unknown): OgenToolToActionMapping {
  const input = record(tool);
  const mappingProof = proof({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    toolId: input.toolId,
    provider: input.provider,
    resourceSystem: input.resourceSystem
  });

  if (
    !sourceTypes.has(input.sourceType as OgenToolSourceType) ||
    !cleanString(input.sourceId) ||
    !cleanString(input.toolId)
  ) {
    return fail(
      "unsupported_tool_shape",
      "Tool mapping requires a supported source type plus deterministic source and tool identifiers.",
      ["sourceType", "sourceId", "toolId"],
      mappingProof
    );
  }

  if (!hasAnyDeterministicActionMetadata(input)) {
    return fail(
      "blocked_unknown_tool",
      "Unknown tool has no deterministic Ogen action metadata and is blocked closed.",
      ["normalizedActionMetadata"],
      mappingProof
    );
  }

  const provider = cleanString(input.provider);
  const resourceSystem = cleanString(input.resourceSystem);
  const executionType = executionTypes.has(input.executionType as OgenMappedExecutionType)
    ? input.executionType as OgenMappedExecutionType
    : undefined;
  const riskLevel = riskLevels.has(input.riskLevel as OgenMappedRiskLevel)
    ? input.riskLevel as OgenMappedRiskLevel
    : undefined;
  const sensitivity = sensitivities.has(input.sensitivity as string) ? input.sensitivity as "standard" | "sensitive" : undefined;
  const actionCategory = OGEN_ACTION_CATEGORIES.includes(input.actionCategory as OgenNormalizedActionMetadata["actionCategory"])
    ? input.actionCategory as OgenNormalizedActionMetadata["actionCategory"]
    : undefined;
  const approvalMode = OGEN_APPROVAL_MODES.includes(input.approvalMode as OgenNormalizedActionMetadata["approvalMode"])
    ? input.approvalMode as OgenNormalizedActionMetadata["approvalMode"]
    : undefined;
  const resourceSensitivity = OGEN_RESOURCE_SENSITIVITIES.includes(input.resourceSensitivity as OgenNormalizedActionMetadata["resourceSensitivity"])
    ? input.resourceSensitivity as OgenNormalizedActionMetadata["resourceSensitivity"]
    : undefined;
  const normalizedFieldClasses = fieldClassArray(input.fieldClasses);
  const normalizedActionConstraints = actionConstraints(input.actionConstraints);
  const requiredApplicationGrants = stringArray(input.requiredApplicationGrants);
  const requiredEffectivePermissions = stringArray(input.requiredEffectivePermissions);
  const requestedScopes = stringArray(input.requestedScopes);
  const requiresApproval = typeof input.requiresApproval === "boolean" ? input.requiresApproval : undefined;

  const missingFields = [
    provider ? "" : "provider",
    resourceSystem ? "" : "resourceSystem",
    executionType ? "" : "executionType",
    riskLevel ? "" : "riskLevel",
    requiresApproval !== undefined ? "" : "requiresApproval",
    sensitivity ? "" : "sensitivity",
    actionCategory ? "" : "actionCategory",
    approvalMode ? "" : "approvalMode",
    resourceSensitivity ? "" : "resourceSensitivity",
    normalizedFieldClasses !== undefined ? "" : "fieldClasses",
    normalizedActionConstraints !== undefined ? "" : "actionConstraints",
    requiredApplicationGrants !== undefined ? "" : "requiredApplicationGrants",
    requiredEffectivePermissions !== undefined ? "" : "requiredEffectivePermissions",
    requestedScopes !== undefined ? "" : "requestedScopes"
  ].filter(Boolean);

  if (missingFields.length > 0) {
    return fail(
      "incomplete_metadata",
      "Tool mapping is incomplete because explicit deterministic Ogen action metadata is missing or invalid.",
      missingFields,
      mappingProof
    );
  }

  const actionId = cleanString(input.actionId) ?? cleanString(input.toolId) ?? "unknown";
  const label = cleanString(input.label) ?? actionId;
  return {
    status: "mapped",
    missingFields: [],
    reason: "Tool definition mapped to Ogen action metadata from explicit deterministic fields only.",
    proof: mappingProof,
    action: {
      actionId,
      label,
      provider: provider as string,
      resourceSystem: resourceSystem as string,
      executionType: executionType as OgenMappedExecutionType,
      riskLevel: riskLevel as OgenMappedRiskLevel,
      requiresApproval: requiresApproval as boolean,
      sensitivity: sensitivity as "standard" | "sensitive",
      actionCategory: actionCategory as OgenNormalizedActionMetadata["actionCategory"],
      approvalMode: approvalMode as OgenNormalizedActionMetadata["approvalMode"],
      resourceSensitivity: resourceSensitivity as OgenNormalizedActionMetadata["resourceSensitivity"],
      fieldClasses: normalizedFieldClasses as OgenFieldClass[],
      actionConstraints: normalizedActionConstraints as OgenActionConstraints,
      requiredApplicationGrants: requiredApplicationGrants as string[],
      requiredEffectivePermissions: requiredEffectivePermissions as string[],
      requestedScopes: requestedScopes as string[]
    },
    certificationResult: {
      certified: true,
      failedChecks: []
    }
  };
}
