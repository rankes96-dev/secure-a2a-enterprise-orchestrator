import type { RuntimeAuthorizationRequest, RuntimeAuthorizationResponse } from "@a2a/shared";
import type { ConnectorRoutingDecision } from "../connectorRouting.js";
import { evaluateConnectorPolicy } from "../policy/connectorPolicy.js";
import type { VerifiedUserIdentity } from "../security/userIdentity.js";
import type { ResolvedTenantContext } from "../tenant/tenantResolution.js";

type RuntimeMode = NonNullable<RuntimeAuthorizationRequest["connectorRoute"]>["runtimeMode"];
type ConnectorRouteStatus = ConnectorRoutingDecision["status"];

const connectorRouteStatuses: ReadonlySet<string> = new Set([
  "needs_more_info",
  "unsupported",
  "connector_skill_approved",
  "connector_skill_blocked",
  "connector_skill_not_declared",
  "connector_skill_not_enabled",
  "connector_not_onboarded"
]);

const toolSourceTypes: ReadonlySet<string> = new Set([
  "mcp_tool_manifest",
  "a2a_agent_card_skill",
  "connector_profile_action",
  "sdk_action_catalog",
  "manually_imported_catalog"
]);

function connectorId(request: RuntimeAuthorizationRequest): string | undefined {
  return request.connectorRoute?.connectorId ?? request.targetAgent?.connectorId ?? request.resource?.connectorId;
}

function resourceSystem(request: RuntimeAuthorizationRequest): string | undefined {
  return request.connectorRoute?.resourceSystem ?? request.targetAgent?.resourceSystem ?? request.resource?.resourceSystem;
}

function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function runtimeMode(request: RuntimeAuthorizationRequest): RuntimeMode {
  return request.connectorRoute?.runtimeMode ?? "not_available";
}

function hasExplicitTarget(request: RuntimeAuthorizationRequest): boolean {
  return Boolean(
    request.targetAgent?.agentId ||
    request.targetAgent?.connectorId ||
    request.resource?.connectorId ||
    request.connectorRoute?.connectorId ||
    request.resource?.resourceSystem ||
    request.connectorRoute?.resourceSystem
  );
}

function hasMappedToolProof(request: RuntimeAuthorizationRequest): boolean {
  const proof = request.action.toolMappingProof;
  const skillId = cleanString(request.action.skillId);
  const trustedResourceSystem = cleanString(resourceSystem(request));
  const actionProvider = cleanString(request.action.provider);
  const actionResourceSystem = cleanString(request.action.resourceSystem);
  const proofToolId = cleanString(proof?.toolId);
  const proofProvider = cleanString(proof?.provider);
  const proofResourceSystem = cleanString(proof?.resourceSystem);

  return request.action.toolMappingStatus === "mapped" &&
    Boolean(proof) &&
    toolSourceTypes.has(proof.sourceType) &&
    typeof proof.sourceId === "string" &&
    proof.sourceId.trim().length > 0 &&
    proofToolId === skillId &&
    actionProvider !== undefined &&
    actionResourceSystem !== undefined &&
    proofProvider !== undefined &&
    proofResourceSystem !== undefined &&
    trustedResourceSystem !== undefined &&
    proofResourceSystem === trustedResourceSystem &&
    proofProvider === actionProvider &&
    proofResourceSystem === actionResourceSystem &&
    proof.deterministicMapping === true &&
    proof.aiInferred === false &&
    proof.rawDescriptionStored === false &&
    proof.protectedMaterialExposed === false;
}

function connectorRouteStatus(request: RuntimeAuthorizationRequest): ConnectorRouteStatus {
  if (!hasMappedToolProof(request)) {
    return "connector_skill_blocked";
  }

  if (request.connectorRoute?.status && connectorRouteStatuses.has(request.connectorRoute.status)) {
    return request.connectorRoute.status as ConnectorRouteStatus;
  }

  if (request.action.skillId && hasExplicitTarget(request) && request.connectorRoute?.runtimeMode) {
    return "connector_skill_approved";
  }

  return "connector_skill_not_enabled";
}

export function evaluateRuntimeAuthorization(input: {
  request: RuntimeAuthorizationRequest;
  identity: VerifiedUserIdentity;
  tenantId: string;
  tenantResolution?: ResolvedTenantContext;
}): RuntimeAuthorizationResponse {
  const { request, identity, tenantId, tenantResolution } = input;
  const evaluatedConnectorId = connectorId(request);
  const evaluatedResourceSystem = resourceSystem(request);
  const toolMappingBlocked = !hasMappedToolProof(request);
  const policy = evaluateConnectorPolicy({
    tenantId,
    requestId: request.requestId,
    conversationId: request.conversationId,
    connectorRouteStatus: connectorRouteStatus(request),
    runtimeMode: runtimeMode(request),
    connectorId: evaluatedConnectorId,
    resourceSystem: evaluatedResourceSystem,
    skillId: request.action.skillId,
    skillLabel: request.action.skillLabel,
    interpretation: request.interpretation
      ? {
          interpretationId: request.interpretation.interpretationId,
          schemaVersion: request.interpretation.schemaVersion,
          interpretationSource: request.interpretation.source,
          confidence: request.interpretation.confidence,
          risks: request.interpretation.risks,
          advisoryOnly: request.interpretation.advisoryOnly
        }
      : undefined,
    subject: {
      tenantId,
      provider: identity.provider,
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      roles: identity.roles
    },
    resource: {
      connectorId: evaluatedConnectorId,
      resourceSystem: evaluatedResourceSystem,
      resourceId: request.resource?.resourceId,
      resourceType: request.resource?.resourceType,
      environment: request.resource?.environment ?? "unknown"
    },
    action: {
      skillId: request.action.skillId,
      skillLabel: request.action.skillLabel,
      executionType: request.action.executionType,
      riskLevel: request.action.riskLevel,
      sensitivity: request.action.sensitivity,
      requiresApproval: request.action.requiresApproval,
      actionCategory: request.action.actionCategory,
      approvalMode: request.action.approvalMode,
      resourceSensitivity: request.action.resourceSensitivity,
      fieldClasses: request.action.fieldClasses,
      actionConstraints: request.action.actionConstraints,
      requiredApplicationGrants: request.action.requiredApplicationGrants,
      requiredEffectivePermissions: request.action.requiredEffectivePermissions,
      provider: request.action.provider,
      resourceSystem: request.action.resourceSystem,
      requestedScopes: request.action.requestedScopes
    }
  });

  return {
    decision: policy.effect,
    allowed: policy.effect === "allow",
    requiresApproval: policy.effect === "needs_approval",
    reason: toolMappingBlocked && policy.effect === "block"
      ? "Tool-to-action metadata mapping must be mapped and bound to the requested action and trusted route/resource before runtime authorization."
      : policy.reason,
    tenantId,
    tenantResolution: tenantResolution
      ? {
          source: tenantResolution.source,
          requestedTenantId: tenantResolution.requestedTenantId,
          requestedTenantAccepted: tenantResolution.requestedTenantAccepted
        }
      : undefined,
    policy: {
      policyVersion: policy.policyVersion,
      decisionId: policy.decisionId,
      effect: policy.effect,
      primaryRuleId: policy.primaryRuleId,
      primaryRuleSource: policy.primaryRuleSource,
      matchedRuleIds: policy.matchedRuleIds,
      matchedGuardrailRuleIds: policy.matchedGuardrailRuleIds,
      matchedTenantRuleIds: policy.matchedTenantRuleIds,
      matchedRuleSummaries: policy.matchedRuleSummaries,
      inputHash: policy.inputHash,
      deniedByDefault: policy.deniedByDefault,
      requiresApproval: policy.requiresApproval
    },
    runtimeExecution: {
      executed: false,
      runtimeTokenIssued: false,
      externalRuntimeCalled: false
    },
    audit: {
      eventType: "runtime.authorization.evaluated",
      protectedMaterialExposed: false,
      tokenMaterialStored: false,
      rawPromptStored: false
    }
  };
}
