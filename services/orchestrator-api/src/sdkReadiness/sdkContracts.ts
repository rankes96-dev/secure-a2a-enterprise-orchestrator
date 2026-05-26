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
  "requiresApproval",
  "sensitivity",
  "requiredApplicationGrants",
  "requiredEffectivePermissions"
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
  "write-actions-require-approval",
  "safe-routing-view-no-secrets",
  "runtime-requires-scoped-jwt",
  "wrong-audience-rejected",
  "expired-token-rejected",
  "authorization-required-safe",
  "no-raw-token-or-prompt-evidence"
] as const;

export type SdkCertificationCheckId = typeof sdkCertificationChecks[number];
