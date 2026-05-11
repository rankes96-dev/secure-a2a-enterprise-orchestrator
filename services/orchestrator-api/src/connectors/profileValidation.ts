import { createHash } from "node:crypto";
import type { ConnectorActionRequirement, ConnectorProfile, ConnectorValidationTest, ConnectorValidationTestCategory, ConnectorValidationTestOutcome } from "./types";

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
        return {
          id: cleanString(input.id),
          label: cleanString(input.label),
          description: cleanString(input.description),
          requiredApplicationGrants: stringArray(input.requiredApplicationGrants),
          requiredEffectivePermissions: stringArray(input.requiredEffectivePermissions),
          riskLevel,
          executionType,
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
