import { actionPermissions, canonicalAction } from "./policies/actionPermissions";
import { agentPermissions } from "./policies/agentPermissions";
import { delegationPolicies } from "./policies/delegationPolicies";

export interface PolicyEvaluationInput {
  callerAgentId: string;
  targetAgentId: string;
  requestedAction: string;
}

export interface PolicyEvaluationResult {
  caller: string;
  target: string;
  requestedAction: string;
  requiredPermission: string;
  decision: "Allowed" | "Blocked" | "NeedsApproval" | "NeedsMoreContext";
  reason: string;
  matchedPolicy: string;
  callerPermissions: string[];
}

export function evaluateSecurityPolicy(input: PolicyEvaluationInput): PolicyEvaluationResult {
  const requestedAction = canonicalAction(input.requestedAction);
  const policy = actionPermissions[requestedAction];
  const requiredPermission = policy?.requiredPermission;
  const callerPermissions = agentPermissions[input.callerAgentId] ?? [];
  const baseResult = {
    caller: input.callerAgentId,
    target: input.targetAgentId,
    requestedAction,
    requiredPermission: requiredPermission ?? "unknown",
    matchedPolicy: requiredPermission ? `${requestedAction} -> ${requiredPermission}` : "no_matching_policy",
    callerPermissions
  };

  if (!requiredPermission) {
    return {
      ...baseResult,
      decision: "Blocked",
      reason: `Unknown requested action ${requestedAction}.`
    };
  }

  if (policy.decisionMode === "requires_approval") {
    return {
      ...baseResult,
      decision: "NeedsApproval",
      reason: "Changing Jira permissions requires human approval and was not executed automatically.",
      matchedPolicy: `${requestedAction} -> ${requiredPermission} requires approval`
    };
  }

  if (!(input.callerAgentId in agentPermissions)) {
    return {
      ...baseResult,
      decision: "Blocked",
      reason: `No policy exists for caller ${input.callerAgentId}.`
    };
  }

  if (!callerPermissions.includes(requiredPermission)) {
    return {
      ...baseResult,
      decision: "Blocked",
      reason: `${input.callerAgentId} does not have required permission ${requiredPermission}.`
    };
  }

  return {
    ...baseResult,
    decision: "Allowed",
    reason: `${input.callerAgentId} has required permission ${requiredPermission}.`
  };
}

export function evaluateDelegationPolicy(input: PolicyEvaluationInput): PolicyEvaluationResult {
  const allowedSkills = delegationPolicies[input.callerAgentId]?.[input.targetAgentId] ?? [];
  const callerPermissions = agentPermissions[input.callerAgentId] ?? [];
  const baseResult = {
    caller: input.callerAgentId,
    target: input.targetAgentId,
    requestedAction: input.requestedAction,
    requiredPermission: input.requestedAction,
    matchedPolicy: allowedSkills.length > 0 ? `${input.callerAgentId} -> ${input.targetAgentId}` : "no_matching_delegation_policy",
    callerPermissions
  };

  if (!allowedSkills.includes(input.requestedAction)) {
    return {
      ...baseResult,
      decision: "Blocked",
      reason: `${input.callerAgentId} may not request ${input.requestedAction} from ${input.targetAgentId}.`
    };
  }

  if (!callerPermissions.includes(input.requestedAction)) {
    return {
      ...baseResult,
      decision: "Blocked",
      reason: `${input.callerAgentId} lacks delegation permission ${input.requestedAction}.`
    };
  }

  return {
    ...baseResult,
    decision: "Allowed",
    reason: `${input.callerAgentId} may request ${input.requestedAction} from ${input.targetAgentId}.`
  };
}
