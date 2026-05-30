import type { ConnectorActionPlan, ConnectorActionPlanOption, EvaluatedConnectorActionPlan } from "@a2a/shared";
import type { TrustedOnboardedAgent } from "./agentOnboarding.js";

function missingFrom(required: string[], present: string[]): string[] {
  const presentSet = new Set(present);
  return required.filter((item) => !presentSet.has(item));
}

function deniedFrom(required: string[], denied: string[]): string[] {
  const deniedSet = new Set(denied);
  return required.filter((item) => deniedSet.has(item));
}

function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function hasMappedPlanOptionProof(option: ConnectorActionPlanOption): boolean {
  const proof = option.toolMappingProof;
  const actionId = cleanString(option.actionId);
  const provider = cleanString(option.provider);
  const resourceSystem = cleanString(option.resourceSystem);
  return option.toolMappingStatus === "mapped" &&
    proof !== undefined &&
    actionId !== undefined &&
    provider !== undefined &&
    resourceSystem !== undefined &&
    cleanString(proof.toolId) === actionId &&
    cleanString(proof.provider) === provider &&
    cleanString(proof.resourceSystem) === resourceSystem &&
    proof.deterministicMapping === true &&
    proof.aiInferred === false &&
    proof.rawDescriptionStored === false &&
    proof.protectedMaterialExposed === false;
}

function evaluateOption(option: ConnectorActionPlanOption, onboardedAgent: TrustedOnboardedAgent): EvaluatedConnectorActionPlan["options"][number] {
  const missingApplicationGrants = missingFrom(option.requiredApplicationGrants, onboardedAgent.applicationAccessGrants.length ? onboardedAgent.applicationAccessGrants : onboardedAgent.grantedScopes);
  const effectivePermissions = onboardedAgent.effectivePermissions ?? [];
  const deniedPermissions = onboardedAgent.deniedPermissions ?? [];
  const missingEffectivePermissions = missingFrom(option.requiredEffectivePermissions, effectivePermissions).filter((permission) => !deniedPermissions.includes(permission));
  const deniedEffectivePermissions = deniedFrom(option.requiredEffectivePermissions, deniedPermissions);

  if (!hasMappedPlanOptionProof(option)) {
    return {
      option,
      decision: "blocked",
      blockedAt: "gateway_governance",
      reason: "Plan option must include mapped tool-to-action metadata bound to the planned action before evaluation.",
      missingApplicationGrants,
      missingEffectivePermissions,
      deniedEffectivePermissions
    };
  }

  if (option.executionType === "unsupported") {
    return {
      option,
      decision: "blocked",
      blockedAt: "gateway_governance",
      reason: "Unsupported plan option execution type cannot be allowed.",
      missingApplicationGrants,
      missingEffectivePermissions,
      deniedEffectivePermissions
    };
  }

  if (option.approvalMode === "blocked") {
    return {
      option,
      decision: "blocked",
      blockedAt: "gateway_governance",
      reason: "Normalized action metadata marks this plan option as blocked by policy or connector metadata.",
      missingApplicationGrants,
      missingEffectivePermissions,
      deniedEffectivePermissions
    };
  }

  if (option.executionType === "write_action" || option.executionType === "admin_action" || option.requiresApproval || option.approvalMode === "always") {
    return {
      option,
      decision: "needs_approval",
      blockedAt: "gateway_governance",
      reason: "Write, admin, and always-approval plan options require explicit Gateway approval before execution.",
      missingApplicationGrants,
      missingEffectivePermissions,
      deniedEffectivePermissions
    };
  }

  if (option.sideEffects !== "none") {
    return {
      option,
      decision: "blocked",
      blockedAt: "gateway_governance",
      reason: "Plan option has side effects and plan-only mode allows no side effects.",
      missingApplicationGrants,
      missingEffectivePermissions,
      deniedEffectivePermissions
    };
  }

  if (missingApplicationGrants.length > 0) {
    return {
      option,
      decision: "blocked",
      blockedAt: "oauth_scope",
      reason: "Required OAuth application grants are missing.",
      missingApplicationGrants,
      missingEffectivePermissions,
      deniedEffectivePermissions
    };
  }

  if (missingEffectivePermissions.length > 0 || deniedEffectivePermissions.length > 0) {
    return {
      option,
      decision: "blocked",
      blockedAt: "service_account_permission",
      reason: "Required service-account permissions are missing or explicitly denied.",
      missingApplicationGrants,
      missingEffectivePermissions,
      deniedEffectivePermissions
    };
  }

  return {
    option,
    decision: "allowed",
    reason: "Read-only or diagnostic plan option has required grants and effective permissions.",
    missingApplicationGrants,
    missingEffectivePermissions,
    deniedEffectivePermissions
  };
}

export function evaluateConnectorActionPlan(plan: ConnectorActionPlan, onboardedAgent: TrustedOnboardedAgent): EvaluatedConnectorActionPlan {
  const options = plan.options.map((option) => evaluateOption(option, onboardedAgent));
  const recommended = plan.recommendedOptionId ? options.find((item) => item.option.actionId === plan.recommendedOptionId) : undefined;

  return {
    plan,
    options,
    recommendedOptionDecision: recommended
      ? {
          optionId: recommended.option.actionId,
          decision: recommended.decision,
          blockedAt: recommended.blockedAt,
          reason: recommended.reason
        }
      : undefined
  };
}
