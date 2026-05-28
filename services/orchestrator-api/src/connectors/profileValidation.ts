import { createHash } from "node:crypto";
import type { ConnectorActionRequirement, ConnectorProfile, ConnectorValidationTest, ConnectorValidationTestCategory, ConnectorValidationTestOutcome } from "./types.js";

const forbiddenSecretPatterns = [
  /client[_-]?secret/i,
  /privateKey/i,
  /"private_key"\s*:/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /authorization/i,
  /bearer/i
];

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

const actionCategories: ReadonlyArray<NonNullable<ConnectorActionRequirement["actionCategory"]>> = [
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
];

const approvalModes: ReadonlyArray<NonNullable<ConnectorActionRequirement["approvalMode"]>> = ["never", "policy", "always", "blocked"];
const resourceSensitivities: ReadonlyArray<NonNullable<ConnectorActionRequirement["resourceSensitivity"]>> = [
  "standard",
  "sensitive",
  "regulated",
  "security_critical",
  "admin_controlled"
];
const fieldClasses: ReadonlyArray<NonNullable<ConnectorActionRequirement["fieldClasses"]>[number]> = [
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
];
const actionConstraintKeys = new Set([
  "bulkAllowed",
  "maxRecordsPerRequest",
  "maxActionsPerHour",
  "requiresConnectedAccount",
  "auditRequired"
]);

function optionalValue<T extends string>(value: unknown, allowed: ReadonlyArray<T>): T | undefined {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : undefined;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function fieldClassArray(value: unknown): ConnectorActionRequirement["fieldClasses"] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  if (value.length === 0) {
    return [];
  }

  if (!value.every((item): item is NonNullable<ConnectorActionRequirement["fieldClasses"]>[number] =>
    typeof item === "string" && fieldClasses.includes(item as NonNullable<ConnectorActionRequirement["fieldClasses"]>[number])
  )) {
    return undefined;
  }

  return [...value];
}

function actionConstraints(value: unknown): ConnectorActionRequirement["actionConstraints"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  const hasUnknownConstraintField = Object.keys(input).some((key) => !actionConstraintKeys.has(key));
  const hasInvalidKnownField =
    ("bulkAllowed" in input && input.bulkAllowed !== true && input.bulkAllowed !== false) ||
    ("maxRecordsPerRequest" in input && optionalPositiveInteger(input.maxRecordsPerRequest) === undefined) ||
    ("maxActionsPerHour" in input && optionalPositiveInteger(input.maxActionsPerHour) === undefined) ||
    ("requiresConnectedAccount" in input && input.requiresConnectedAccount !== true && input.requiresConnectedAccount !== false) ||
    ("auditRequired" in input && input.auditRequired !== true && input.auditRequired !== false);
  if (hasUnknownConstraintField || hasInvalidKnownField) {
    return undefined;
  }

  const constraints: ConnectorActionRequirement["actionConstraints"] = {
    bulkAllowed: input.bulkAllowed === true || input.bulkAllowed === false ? input.bulkAllowed : undefined,
    maxRecordsPerRequest: optionalPositiveInteger(input.maxRecordsPerRequest),
    maxActionsPerHour: optionalPositiveInteger(input.maxActionsPerHour),
    requiresConnectedAccount: input.requiresConnectedAccount === true || input.requiresConnectedAccount === false ? input.requiresConnectedAccount : undefined,
    auditRequired: input.auditRequired === true || input.auditRequired === false ? input.auditRequired : undefined
  };
  return Object.keys(input).length === 0 || Object.values(constraints).some((entry) => entry !== undefined) ? constraints : undefined;
}

function hasSecretMarker(value: unknown): boolean {
  const text = JSON.stringify(value);
  return forbiddenSecretPatterns.some((pattern) => pattern.test(text));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return `{${Object.keys(input)
      .filter((key) => input[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(input[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function catalog(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => {
        const input = record(item);
        return {
          id: cleanString(input.id),
          label: cleanString(input.label),
          description: cleanString(input.description)
        };
      })
    : [];
}

function actionCatalog(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => {
        const input = record(item);
        const riskLevel: ConnectorActionRequirement["riskLevel"] =
          input.riskLevel === "low" || input.riskLevel === "medium" || input.riskLevel === "high" || input.riskLevel === "sensitive"
            ? input.riskLevel
            : undefined;
        const executionType: ConnectorActionRequirement["executionType"] =
          input.executionType === "diagnostic_read_only" ||
          input.executionType === "write_action" ||
          input.executionType === "inspection_read_only" ||
          input.executionType === "unsupported"
            ? input.executionType
            : undefined;
        const sensitivity: ConnectorActionRequirement["sensitivity"] =
          input.sensitivity === "standard" || input.sensitivity === "sensitive" ? input.sensitivity : undefined;
        const capabilityIds = stringArray(input.capabilityIds);
        return {
          id: cleanString(input.id),
          label: cleanString(input.label),
          description: cleanString(input.description),
          requiredApplicationGrants: stringArray(input.requiredApplicationGrants),
          requiredEffectivePermissions: stringArray(input.requiredEffectivePermissions),
          capabilityIds: capabilityIds.length ? capabilityIds : undefined,
          riskLevel,
          executionType,
          requiresApproval: input.requiresApproval === true || input.requiresApproval === false ? input.requiresApproval : undefined,
          sensitivity,
          actionCategory: optionalValue(input.actionCategory, actionCategories),
          approvalMode: optionalValue(input.approvalMode, approvalModes),
          resourceSensitivity: optionalValue(input.resourceSensitivity, resourceSensitivities),
          fieldClasses: fieldClassArray(input.fieldClasses),
          actionConstraints: actionConstraints(input.actionConstraints),
          provider: cleanString(input.provider) || undefined,
          resourceSystem: cleanString(input.resourceSystem) || undefined,
          diagnosesActionId: cleanString(input.diagnosesActionId) || undefined,
          diagnosesActionLabel: cleanString(input.diagnosesActionLabel) || undefined
        };
      })
    : [];
}

function validationTestCategory(value: unknown): ConnectorValidationTestCategory | undefined {
  return value === "end_user_planning" ||
    value === "approved_diagnostic" ||
    value === "blocked_write_action" ||
    value === "adversarial" ||
    value === "unsupported_handoff"
    ? value
    : undefined;
}

function validationTestOutcome(value: unknown): ConnectorValidationTestOutcome | undefined {
  return value === "needs_more_info" ||
    value === "planned" ||
    value === "check_ready" ||
    value === "diagnosed" ||
    value === "blocked" ||
    value === "unsupported"
    ? value
    : undefined;
}

function validationTests(value: unknown): ConnectorValidationTest[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map((item) => {
    const input = record(item);
    return {
      id: cleanString(input.id),
      title: cleanString(input.title),
      category: validationTestCategory(input.category) ?? "approved_diagnostic",
      persona: input.persona === "end_user" || input.persona === "bizapps_it" || input.persona === "security" ? input.persona : "bizapps_it",
      description: cleanString(input.description),
      proves: cleanString(input.proves),
      steps: Array.isArray(input.steps)
        ? input.steps.map((step) => {
            const stepInput = record(step);
            return {
              message: cleanString(stepInput.message),
              expectedOutcome: validationTestOutcome(stepInput.expectedOutcome) ?? "blocked"
            };
          })
        : [],
      expectedFinalOutcome: validationTestOutcome(input.expectedFinalOutcome) ?? "blocked",
      requiresPlanning: input.requiresPlanning === true || undefined,
      requiresRuntimeReady: input.requiresRuntimeReady === true || undefined,
      referenceOnly: input.referenceOnly === true || undefined
    };
  });
}

export function connectorProfileHash(profile: ConnectorProfile): string {
  return createHash("sha256").update(stableStringify(profile)).digest("hex");
}

export function validateConnectorProfile(value: unknown): { profile?: ConnectorProfile; details: string[] } {
  const details: string[] = [];
  const input = record(value);
  if (hasSecretMarker(value)) details.push("connector profile contains forbidden secret markers.");

  const profile: ConnectorProfile = {
    connectorId: cleanString(input.connectorId),
    resourceSystem: cleanString(input.resourceSystem),
    displayName: cleanString(input.displayName),
    version: cleanString(input.version),
    profileSource:
      input.profileSource === "external_agent" || input.profileSource === "built_in_reference" || input.profileSource === "custom_connector"
        ? input.profileSource
        : "external_agent",
    planning: record(input.planning).supported === true || record(input.planning).supported === false
      ? {
          supported: record(input.planning).supported === true,
          description: cleanString(record(input.planning).description),
          supportedIntentClasses: stringArray(record(input.planning).supportedIntentClasses)
        }
      : undefined,
    applicationAccessGrantCatalog: catalog(input.applicationAccessGrantCatalog),
    effectivePermissionCatalog: catalog(input.effectivePermissionCatalog),
    skillCatalog: actionCatalog(input.skillCatalog).length ? actionCatalog(input.skillCatalog) : actionCatalog(input.actionCatalog),
    actionCatalog: actionCatalog(input.actionCatalog).length ? actionCatalog(input.actionCatalog) : actionCatalog(input.skillCatalog),
    validationTests: validationTests(input.validationTests),
    intentHints: input.intentHints,
    demoDefaults: input.demoDefaults
  };

  if (!profile.connectorId) details.push("connector profile missing connectorId.");
  if (!profile.resourceSystem) details.push("connector profile missing resourceSystem.");
  if (!profile.displayName) details.push("connector profile missing displayName.");
  if (!profile.version) details.push("connector profile missing version.");
  if (!Array.isArray(input.applicationAccessGrantCatalog)) details.push("connector profile applicationAccessGrantCatalog must be an array.");
  if (!Array.isArray(input.effectivePermissionCatalog)) details.push("connector profile effectivePermissionCatalog must be an array.");
  if (!Array.isArray(input.skillCatalog) && !Array.isArray(input.actionCatalog)) details.push("connector profile skillCatalog or actionCatalog must be an array.");
  if (profile.applicationAccessGrantCatalog.some((item) => !item.id || !item.label)) details.push("connector profile contains invalid application access grant catalog entries.");
  if (profile.effectivePermissionCatalog.some((item) => !item.id || !item.label)) details.push("connector profile contains invalid effective permission catalog entries.");
  if (profile.skillCatalog.some((action) => !action.id || !action.label)) details.push("connector profile contains invalid skill catalog entries.");
  if (profile.validationTests?.some((test) => !test.id || !test.title || !test.description || !test.proves || test.steps.length === 0 || test.steps.some((step) => !step.message))) {
    details.push("connector profile contains invalid validation test entries.");
  }

  return details.length > 0 ? { details } : { profile, details };
}
