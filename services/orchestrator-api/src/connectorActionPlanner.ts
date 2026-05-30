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

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizedActionCategory(value: unknown): ConnectorActionPlanOption["actionCategory"] {
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

function approvalMode(value: unknown): ConnectorActionPlanOption["approvalMode"] {
  return value === "never" || value === "policy" || value === "always" || value === "blocked" ? value : undefined;
}

function resourceSensitivity(value: unknown): ConnectorActionPlanOption["resourceSensitivity"] {
  return value === "standard" || value === "sensitive" || value === "regulated" || value === "security_critical" || value === "admin_controlled" ? value : undefined;
}

function fieldClasses(value: unknown): ConnectorActionPlanOption["fieldClasses"] {
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
  const fields = stringArray(value).filter((fieldClass) => allowed.has(fieldClass)) as NonNullable<ConnectorActionPlanOption["fieldClasses"]>;
  return fields;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function actionConstraints(value: unknown): ConnectorActionPlanOption["actionConstraints"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const constraints: ConnectorActionPlanOption["actionConstraints"] = {
    bulkAllowed: record.bulkAllowed === true || record.bulkAllowed === false ? record.bulkAllowed : undefined,
    maxRecordsPerRequest: positiveInteger(record.maxRecordsPerRequest),
    maxActionsPerHour: positiveInteger(record.maxActionsPerHour),
    requiresConnectedAccount: record.requiresConnectedAccount === true || record.requiresConnectedAccount === false ? record.requiresConnectedAccount : undefined,
    auditRequired: record.auditRequired === true || record.auditRequired === false ? record.auditRequired : undefined
  };
  return constraints;
}

function toolMappingStatus(value: unknown): ConnectorActionPlanOption["toolMappingStatus"] {
  return value === "mapped" || value === "incomplete_metadata" || value === "unsupported_tool_shape" || value === "blocked_unknown_tool"
    ? value
    : undefined;
}

function toolMappingProof(value: unknown): ConnectorActionPlanOption["toolMappingProof"] {
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
  if (
    !sourceType ||
    typeof record.sourceId !== "string" ||
    typeof record.toolId !== "string" ||
    record.deterministicMapping !== true ||
    record.aiInferred !== false ||
    record.rawDescriptionStored !== false ||
    record.protectedMaterialExposed !== false
  ) {
    return undefined;
  }

  return {
    sourceType,
    sourceId: record.sourceId,
    toolId: record.toolId,
    provider: cleanString(record.provider),
    resourceSystem: cleanString(record.resourceSystem),
    deterministicMapping: true,
    aiInferred: false,
    rawDescriptionStored: false,
    protectedMaterialExposed: false
  };
}

function executionType(value: unknown): PlannedActionExecutionType {
  return value === "inspection_read_only" || value === "diagnostic_read_only" || value === "write_action" || value === "admin_action" || value === "unsupported"
    ? value
    : "unsupported";
}

function riskLevel(value: unknown): PlannedActionRiskLevel {
  return value === "low" || value === "medium" || value === "high" || value === "critical" ? value : "medium";
}

function sideEffects(value: unknown): PlannedActionSideEffects {
  return value === "none" || value === "reads_data" || value === "modifies_state" || value === "admin_change" || value === "cross_system" ? value : "none";
}

function normalizeConnectorActionPlan(value: unknown): ConnectorActionPlan | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const options = Array.isArray(record.options)
    ? record.options
        .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
        .map((item) => ({
          actionId: typeof item.actionId === "string" ? item.actionId : "",
          label: typeof item.label === "string" ? item.label : "",
          description: typeof item.description === "string" ? item.description : "",
          executionType: executionType(item.executionType),
          riskLevel: riskLevel(item.riskLevel),
          actionCategory: normalizedActionCategory(item.actionCategory),
          approvalMode: approvalMode(item.approvalMode),
          resourceSensitivity: resourceSensitivity(item.resourceSensitivity),
          fieldClasses: fieldClasses(item.fieldClasses),
          actionConstraints: actionConstraints(item.actionConstraints),
          toolMappingStatus: toolMappingStatus(item.toolMappingStatus),
          toolMappingProof: toolMappingProof(item.toolMappingProof),
          provider: cleanString(item.provider),
          resourceSystem: cleanString(item.resourceSystem),
          sideEffects: sideEffects(item.sideEffects),
          requiredApplicationGrants: stringArray(item.requiredApplicationGrants),
          requiredEffectivePermissions: stringArray(item.requiredEffectivePermissions),
          requiresApproval: item.requiresApproval === true,
          targetObjectTypes: stringArray(item.targetObjectTypes),
          missingInputs: stringArray(item.missingInputs)
        }))
        .filter((item) => item.actionId && item.label && item.description)
    : [];

  if (
    typeof record.planId !== "string" ||
    typeof record.connectorId !== "string" ||
    typeof record.resourceSystem !== "string" ||
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
    resourceSystem: record.resourceSystem,
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
