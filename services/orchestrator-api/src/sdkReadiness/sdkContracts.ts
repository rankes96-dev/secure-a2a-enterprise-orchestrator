export const SDK_READINESS_VERSION = "ogen.sdk-readiness.v1";

export const requiredConnectorProfileFields = [
  "connectorId",
  "resourceSystem",
  "version",
  "displayName",
  "profileSource",
  "applicationAccessGrantCatalog",
  "effectivePermissionCatalog",
  "skillCatalog",
  "actionCatalog",
  "validationTests"
] as const;

export const requiredExecutableActionMetadataFields = [
  "riskLevel",
  "executionType",
  "actionCategory",
  "approvalMode",
  "resourceSensitivity",
  "fieldClasses",
  "actionConstraints",
  "requiresApproval",
  "sensitivity",
  "requiredApplicationGrants",
  "requiredEffectivePermissions",
  "requestedScopes",
  "provider",
  "resourceSystem",
  "toolMappingStatus",
  "toolMappingProof"
] as const;

export const requiredToolToActionMappingFields = [
  "sourceType",
  "sourceId",
  "toolId",
  "provider",
  "resourceSystem",
  "executionType",
  "riskLevel",
  "requiresApproval",
  "sensitivity",
  "actionCategory",
  "approvalMode",
  "resourceSensitivity",
  "fieldClasses",
  "actionConstraints",
  "requiredApplicationGrants",
  "requiredEffectivePermissions",
  "requestedScopes",
  "proof",
  "certificationResult"
] as const;

export const requiredToolMappingProofFields = [
  "sourceType",
  "sourceId",
  "toolId",
  "provider",
  "resourceSystem",
  "deterministicMapping",
  "aiInferred",
  "rawDescriptionStored",
  "protectedMaterialExposed"
] as const;

export const genericPolicyConditionFields = [
  "actionCategories",
  "executionTypes",
  "riskLevels",
  "approvalModes",
  "resourceSensitivities",
  "actorRolesAny",
  "connectorIds",
  "resourceSystems",
  "providers",
  "fieldClasses",
  "bulk",
  "maxRecordsPerRequest",
  "maxActionsPerHour",
  "requiresConnectedAccount",
  "auditRequired"
] as const;

export const forbiddenSafeRoutingViewFields = [
  "endpoint",
  "runtimeEndpoint",
  "auth",
  "audience",
  "issuer",
  "jwks",
  "headers",
  "token",
  "secret",
  "description"
] as const;

export const requiredPolicyProofFields = [
  "policyVersion",
  "decisionId",
  "effect",
  "primaryRuleId",
  "primaryRuleSource",
  "matchedRuleIds",
  "matchedGuardrailRuleIds",
  "matchedTenantRuleIds",
  "matchedRuleSummaries",
  "inputHash",
  "deniedByDefault",
  "requiresApproval"
] as const;

export const requiredAiProofFields = [
  "interpretationProof",
  "aiRoutingProof",
  "advisoryOnly",
  "rawPromptStored",
  "rawAiResponseStored",
  "authorizedRuntime"
] as const;

export const sdkCertificationChecks = [
  "action-metadata-complete",
  "normalized-action-taxonomy-complete",
  "missing-taxonomy-fields-fail-closed",
  "tool-action-mapping-complete",
  "tool-action-mapping-proof-safe",
  "tool-action-mapping-certification",
  "write-actions-require-approval",
  "safe-routing-view-no-secrets",
  "runtime-requires-scoped-jwt",
  "wrong-audience-rejected",
  "expired-token-rejected",
  "authorization-required-safe",
  "no-raw-token-or-prompt-evidence"
] as const;

export type SdkCertificationCheckId = typeof sdkCertificationChecks[number];
