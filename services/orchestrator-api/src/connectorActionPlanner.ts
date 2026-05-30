import type { A2AAgentResponse, ConnectorActionPlan, ConnectorActionPlanOption, PlannedActionExecutionType, PlannedActionRiskLevel, PlannedActionSideEffects } from "@a2a/shared";
import { a2aJsonRequestHeaders } from "@a2a/shared";
import type { TrustedOnboardedAgent } from "./agentOnboarding.js";
import { validateTrustedConnectorRuntimeEndpoint } from "./security/connectorRuntimeSafety.js";
import { getA2AAccessToken } from "./security/tokenClient.js";
import type { VerifiedUserIdentity } from "./security/userIdentity.js";

const maxActionPlanJsonBytes = 64 * 1024;
const connectorActionPlanTimeoutMs = 5_000;
const forbiddenPlanKeys = new Set(["rawtoken", "authorization", "access_token", "refresh_token", "client_assertion", "private_key", "client_secret", "bearer"]);

function sanitizePlanValue(value: unknown): unknown {
  if (typeof value === "string") {
    return /Bearer\s+|Authorization:|access_token|refresh_token|client_assertion|private_key|client_secret/i.test(value) ? "hidden" : value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizePlanValue);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        forbiddenPlanKeys.has(key.toLowerCase()) ? "hidden" : sanitizePlanValue(nested)
      ])
    );
  }

  return value;
}

async function readJsonWithLimit(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > maxActionPlanJsonBytes) {
    throw new Error("external connector action plan response exceeded size limit");
  }
  return text ? sanitizePlanValue(JSON.parse(text)) : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function explicitStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const trimmed = value.map((item) => typeof item === "string" ? item.trim() : undefined);
  return trimmed.every((item): item is string => item !== undefined && item.length > 0) ? trimmed : undefined;
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizedActionCategory(value: unknown): ConnectorActionPlanOption["actionCategory"] | undefined {
  return value === "read" ||
    value === "search" ||
    value === "diagnose" ||
    value === "comment.add" ||
    value === "business_object.read" ||
    value === "business_object.create" ||
    value === "business_object.update" ||
    value === "workflow_state.change" ||
    value === "assignment.change" ||
    value === "permission.inspect" ||
    value === "permission.grant" ||
    value === "record.delete" ||
    value === "bulk.modify" ||
    value === "admin.configure" ||
    value === "external_message.send"
    ? value
    : undefined;
}

function approvalMode(value: unknown): ConnectorActionPlanOption["approvalMode"] | undefined {
  return value === "never" || value === "policy" || value === "always" || value === "blocked" ? value : undefined;
}

function resourceSensitivity(value: unknown): ConnectorActionPlanOption["resourceSensitivity"] | undefined {
  return value === "standard" || value === "sensitive" || value === "regulated" || value === "security_critical" || value === "admin_controlled" ? value : undefined;
}

function fieldClasses(value: unknown): ConnectorActionPlanOption["fieldClasses"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const allowed = new Set([
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
  ]);
  if (!value.every((fieldClass): fieldClass is NonNullable<ConnectorActionPlanOption["fieldClasses"]>[number] => typeof fieldClass === "string" && allowed.has(fieldClass))) {
    return undefined;
  }

  return [...value] as ConnectorActionPlanOption["fieldClasses"];
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function actionConstraints(value: unknown): ConnectorActionPlanOption["actionConstraints"] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const allowedKeys = new Set(["bulkAllowed", "maxRecordsPerRequest", "maxActionsPerHour", "requiresConnectedAccount", "auditRequired"]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    return undefined;
  }
  if ("bulkAllowed" in record && record.bulkAllowed !== true && record.bulkAllowed !== false) {
    return undefined;
  }
  if ("maxRecordsPerRequest" in record && positiveInteger(record.maxRecordsPerRequest) === undefined) {
    return undefined;
  }
  if ("maxActionsPerHour" in record && positiveInteger(record.maxActionsPerHour) === undefined) {
    return undefined;
  }
  if ("requiresConnectedAccount" in record && record.requiresConnectedAccount !== true && record.requiresConnectedAccount !== false) {
    return undefined;
  }
  if ("auditRequired" in record && record.auditRequired !== true && record.auditRequired !== false) {
    return undefined;
  }

  const constraints: ConnectorActionPlanOption["actionConstraints"] = {};
  if ("bulkAllowed" in record) constraints.bulkAllowed = record.bulkAllowed as boolean;
  if ("maxRecordsPerRequest" in record) constraints.maxRecordsPerRequest = record.maxRecordsPerRequest as number;
  if ("maxActionsPerHour" in record) constraints.maxActionsPerHour = record.maxActionsPerHour as number;
  if ("requiresConnectedAccount" in record) constraints.requiresConnectedAccount = record.requiresConnectedAccount as boolean;
  if ("auditRequired" in record) constraints.auditRequired = record.auditRequired as boolean;
  return constraints;
}

function toolMappingStatus(value: unknown): ConnectorActionPlanOption["toolMappingStatus"] | undefined {
  return value === "mapped" || value === "incomplete_metadata" || value === "unsupported_tool_shape" || value === "blocked_unknown_tool"
    ? value
    : undefined;
}

function toolMappingProof(value: unknown): ConnectorActionPlanOption["toolMappingProof"] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const sourceType = record.sourceType === "mcp_tool_manifest" ||
    record.sourceType === "a2a_agent_card_skill" ||
    record.sourceType === "connector_profile_action" ||
    record.sourceType === "sdk_action_catalog" ||
    record.sourceType === "manually_imported_catalog"
    ? record.sourceType
    : undefined;
  const sourceId = cleanString(record.sourceId);
  const toolId = cleanString(record.toolId);
  if (
    !sourceType ||
    !sourceId ||
    !toolId ||
    record.deterministicMapping !== true ||
    record.aiInferred !== false ||
    record.rawDescriptionStored !== false ||
    record.protectedMaterialExposed !== false
  ) {
    return undefined;
  }

  return {
    sourceType,
    sourceId,
    toolId,
    provider: cleanString(record.provider),
    resourceSystem: cleanString(record.resourceSystem),
    deterministicMapping: true,
    aiInferred: false,
    rawDescriptionStored: false,
    protectedMaterialExposed: false
  };
}

function isExecutionType(value: unknown): value is PlannedActionExecutionType {
  return value === "inspection_read_only" || value === "diagnostic_read_only" || value === "write_action" || value === "admin_action" || value === "unsupported"
}

function executionType(value: unknown): PlannedActionExecutionType {
  return isExecutionType(value) ? value : "unsupported";
}

function isRiskLevel(value: unknown): value is PlannedActionRiskLevel {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}

function riskLevel(value: unknown): PlannedActionRiskLevel {
  return isRiskLevel(value) ? value : "medium";
}

function isSideEffects(value: unknown): value is PlannedActionSideEffects {
  return value === "none" || value === "reads_data" || value === "modifies_state" || value === "admin_change" || value === "cross_system";
}

function sideEffects(value: unknown): PlannedActionSideEffects {
  return isSideEffects(value) ? value : "none";
}

function hasMappedPlanOptionMetadata(option: ConnectorActionPlanOption, planResourceSystem: string): boolean {
  const proof = option.toolMappingProof;
  return option.toolMappingStatus === "mapped" &&
    proof !== undefined &&
    option.provider !== undefined &&
    option.resourceSystem !== undefined &&
    option.resourceSystem === planResourceSystem &&
    proof.toolId === option.actionId &&
    proof.provider === option.provider &&
    proof.resourceSystem === option.resourceSystem &&
    proof.deterministicMapping === true &&
    proof.aiInferred === false &&
    proof.rawDescriptionStored === false &&
    proof.protectedMaterialExposed === false;
}

function hasConsistentApprovalMetadata(
  executionType: PlannedActionExecutionType,
  approvalMode: ConnectorActionPlanOption["approvalMode"],
  requiresApproval: boolean
): boolean {
  if (approvalMode === "always") {
    return requiresApproval === true;
  }
  if (approvalMode === "never") {
    return requiresApproval === false && executionType !== "write_action" && executionType !== "admin_action";
  }
  return true;
}

function normalizeConnectorActionPlanOption(item: Record<string, unknown>, planResourceSystem: string): ConnectorActionPlanOption | undefined {
  const actionId = cleanString(item.actionId);
  const label = cleanString(item.label);
  const description = cleanString(item.description);
  const normalizedExecutionType = executionType(item.executionType);
  const normalizedRiskLevel = riskLevel(item.riskLevel);
  const normalizedSideEffects = sideEffects(item.sideEffects);
  const actionCategory = normalizedActionCategory(item.actionCategory);
  const normalizedApprovalMode = approvalMode(item.approvalMode);
  const normalizedResourceSensitivity = resourceSensitivity(item.resourceSensitivity);
  const normalizedFieldClasses = fieldClasses(item.fieldClasses);
  const normalizedActionConstraints = actionConstraints(item.actionConstraints);
  const normalizedToolMappingStatus = toolMappingStatus(item.toolMappingStatus);
  const normalizedToolMappingProof = toolMappingProof(item.toolMappingProof);
  const provider = cleanString(item.provider);
  const resourceSystem = cleanString(item.resourceSystem);
  const requiredApplicationGrants = explicitStringArray(item.requiredApplicationGrants);
  const requiredEffectivePermissions = explicitStringArray(item.requiredEffectivePermissions);
  const requiresApproval = item.requiresApproval === true || item.requiresApproval === false ? item.requiresApproval : undefined;

  if (
    !actionId ||
    !label ||
    !description ||
    !isExecutionType(item.executionType) ||
    normalizedExecutionType === "unsupported" ||
    !isRiskLevel(item.riskLevel) ||
    !isSideEffects(item.sideEffects) ||
    actionCategory === undefined ||
    normalizedApprovalMode === undefined ||
    normalizedResourceSensitivity === undefined ||
    normalizedFieldClasses === undefined ||
    normalizedActionConstraints === undefined ||
    normalizedToolMappingStatus === undefined ||
    normalizedToolMappingProof === undefined ||
    provider === undefined ||
    resourceSystem === undefined ||
    requiredApplicationGrants === undefined ||
    requiredEffectivePermissions === undefined ||
    requiresApproval === undefined ||
    !hasConsistentApprovalMetadata(normalizedExecutionType, normalizedApprovalMode, requiresApproval)
  ) {
    return undefined;
  }

  const option: ConnectorActionPlanOption = {
    actionId,
    label,
    description,
    executionType: normalizedExecutionType,
    riskLevel: normalizedRiskLevel,
    actionCategory,
    approvalMode: normalizedApprovalMode,
    resourceSensitivity: normalizedResourceSensitivity,
    fieldClasses: normalizedFieldClasses,
    actionConstraints: normalizedActionConstraints,
    toolMappingStatus: normalizedToolMappingStatus,
    toolMappingProof: normalizedToolMappingProof,
    provider,
    resourceSystem,
    sideEffects: normalizedSideEffects,
    requiredApplicationGrants,
    requiredEffectivePermissions,
    requiresApproval,
    targetObjectTypes: stringArray(item.targetObjectTypes),
    missingInputs: stringArray(item.missingInputs)
  };

  return hasMappedPlanOptionMetadata(option, planResourceSystem) ? option : undefined;
}

function normalizeConnectorActionPlan(value: unknown): ConnectorActionPlan | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const planResourceSystem = cleanString(record.resourceSystem);
  const options = Array.isArray(record.options)
    ? record.options
        .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
        .map((item) => planResourceSystem ? normalizeConnectorActionPlanOption(item, planResourceSystem) : undefined)
        .filter((item): item is ConnectorActionPlanOption => item !== undefined)
    : [];

  if (
    typeof record.planId !== "string" ||
    typeof record.connectorId !== "string" ||
    !planResourceSystem ||
    typeof record.interpretedIntent !== "string" ||
    typeof record.userRequest !== "string" ||
    record.mode !== "plan_only" ||
    record.safeToDisplay !== true ||
    record.sideEffectsAllowed !== "none" ||
    options.length === 0 ||
    typeof record.recommendedNextStep !== "string"
  ) {
    return undefined;
  }

  return {
    planId: record.planId,
    connectorId: record.connectorId,
    resourceSystem: planResourceSystem,
    interpretedIntent: record.interpretedIntent,
    userRequest: record.userRequest,
    mode: "plan_only",
    safeToDisplay: true,
    sideEffectsAllowed: "none",
    missingInputs: stringArray(record.missingInputs),
    options,
    recommendedOptionId: typeof record.recommendedOptionId === "string" ? record.recommendedOptionId : undefined,
    recommendedNextStep: record.recommendedNextStep
  };
}

function validatePlanIdentity(plan: ConnectorActionPlan, onboardedAgent: TrustedOnboardedAgent): void {
  const expectedConnectorId = onboardedAgent.connectorId ?? onboardedAgent.connectorProfile?.connectorId;
  const expectedResourceSystem = onboardedAgent.resourceSystem ?? onboardedAgent.connectorProfile?.resourceSystem;
  if (expectedConnectorId && plan.connectorId !== expectedConnectorId) {
    throw new Error("connector action plan connectorId did not match trusted onboarded agent");
  }
  if (expectedResourceSystem && plan.resourceSystem !== expectedResourceSystem) {
    throw new Error("connector action plan resourceSystem did not match trusted onboarded agent");
  }
  if (plan.mode !== "plan_only" || plan.safeToDisplay !== true || plan.sideEffectsAllowed !== "none" || plan.options.length === 0) {
    throw new Error("connector action plan did not satisfy safe plan-only contract");
  }
}

function planOnlyScope(onboardedAgent: TrustedOnboardedAgent): string | undefined {
  const grants = [
    ...onboardedAgent.requestedApplicationGrants,
    ...onboardedAgent.applicationAccessGrants,
    ...onboardedAgent.grantedScopes
  ].filter(Boolean);
  return grants.find((grant) => /read|lookup|metadata|inspect|diagnose/i.test(grant)) ?? grants[0];
}

export async function requestConnectorActionPlan(params: {
  message: string;
  conversationId: string;
  onboardedAgent: TrustedOnboardedAgent;
  actor?: VerifiedUserIdentity;
}): Promise<{ agentResponse: A2AAgentResponse; actionPlan?: ConnectorActionPlan }> {
  const endpoint = validateTrustedConnectorRuntimeEndpoint({
    endpoint: params.onboardedAgent.runtimeEndpoint,
    expectedEndpoint: params.onboardedAgent.runtimeEndpoint
  });
  if (!endpoint.ok) {
    throw new Error(endpoint.error);
  }
  const scope = planOnlyScope(params.onboardedAgent);
  if (!params.onboardedAgent.audience || !scope) {
    throw new Error("external connector action plan auth could not be derived");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), connectorActionPlanTimeoutMs);
  let response: Response;
  let body: unknown;
  try {
    const issued = await getA2AAccessToken({
      audience: params.onboardedAgent.audience,
      scope,
      actor: params.actor?.email,
      actorRoles: params.actor?.roles,
      actorProvider: params.actor?.provider,
      actorIssuer: params.actor?.issuer,
      actorSubject: params.actor?.subject
    });
    response = await fetch(endpoint.url, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        ...a2aJsonRequestHeaders(),
        authorization: `Bearer ${issued.accessToken}`
      },
      body: JSON.stringify({
        mode: "plan_only",
        runtimeMode: "connector_plan_only",
        allowedSideEffects: "none",
        conversationId: params.conversationId,
        connectorId: params.onboardedAgent.connectorId,
        resourceSystem: params.onboardedAgent.resourceSystem,
        message: params.message,
        context: {
          actor: params.actor
            ? {
                email: params.actor.email,
                roles: [...params.actor.roles],
                provider: params.actor.provider,
                issuer: params.actor.issuer,
                subject: params.actor.subject
              }
            : undefined
        },
        trustedContext: {
          externalConfigHash: params.onboardedAgent.externalConfigHash,
          connectorProfileHash: params.onboardedAgent.connectorProfileHash
        }
      })
    });
    body = await readJsonWithLimit(response);
  } catch {
    throw new Error("external connector action plan request failed");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error("external connector action plan request failed");
  }
  const record = typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const actionPlan = normalizeConnectorActionPlan(record.actionPlan);
  if (actionPlan) {
    validatePlanIdentity(actionPlan, params.onboardedAgent);
  }
  return {
    actionPlan,
    agentResponse: {
      agentId: typeof record.agentId === "string" ? record.agentId : params.onboardedAgent.agentId,
      status: record.status === "diagnosed" || record.status === "needs_more_info" ? record.status : actionPlan ? "diagnosed" : "needs_more_info",
      summary: typeof record.summary === "string" ? record.summary : "Connector returned a safe action plan.",
      actionPlan,
      trace: Array.isArray(record.trace)
        ? record.trace
            .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
            .map((item) => ({
              agent: typeof item.agent === "string" ? item.agent : params.onboardedAgent.agentId,
              action: typeof item.action === "string" ? item.action : "connector_plan_only",
              detail: typeof item.detail === "string" ? item.detail : "Connector returned a side-effect-free action plan.",
              timestamp: typeof item.timestamp === "string" ? item.timestamp : new Date().toISOString()
            }))
        : undefined
    }
  };
}
