import type { A2AAgentResponse, ConnectorActionPlan, PlannedActionExecutionType, PlannedActionRiskLevel, PlannedActionSideEffects } from "@a2a/shared";
import type { TrustedOnboardedAgent } from "./agentOnboarding.js";
import { validateTrustedConnectorRuntimeEndpoint } from "./security/connectorRuntimeSafety.js";

const maxActionPlanJsonBytes = 64 * 1024;
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

export async function requestConnectorActionPlan(params: {
  message: string;
  conversationId: string;
  onboardedAgent: TrustedOnboardedAgent;
}): Promise<{ agentResponse: A2AAgentResponse; actionPlan?: ConnectorActionPlan }> {
  const endpoint = validateTrustedConnectorRuntimeEndpoint({
    endpoint: params.onboardedAgent.runtimeEndpoint,
    expectedEndpoint: params.onboardedAgent.runtimeEndpoint
  });
  if (!endpoint.ok) {
    throw new Error(endpoint.error);
  }

  const response = await fetch(endpoint.url, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "plan_only",
      runtimeMode: "connector_plan_only",
      allowedSideEffects: "none",
      conversationId: params.conversationId,
      connectorId: params.onboardedAgent.connectorId,
      resourceSystem: params.onboardedAgent.resourceSystem,
      message: params.message,
      trustedContext: {
        externalConfigHash: params.onboardedAgent.externalConfigHash,
        connectorProfileHash: params.onboardedAgent.connectorProfileHash
      }
    })
  });

  const body = await readJsonWithLimit(response);
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
