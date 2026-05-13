import type { Classification, ConnectorActionPlan, EvaluatedConnectorActionPlan, ExecutionGate, ExecutionGateId, ExecutionGateStack, RequestInterpretation, ResolveResponse, SecurityDecision, SecurityIntent, SelectedAgent } from "@a2a/shared";
import type { ConnectorRuntimeResult } from "./connectorRuntime.js";

type ConnectorRouting = NonNullable<ResolveResponse["connectorRouting"]>;
type ConnectorPolicy = NonNullable<ResolveResponse["connectorPolicy"]>;

export type BuildExecutionGateStackParams = {
  requestInterpretation?: RequestInterpretation;
  securityIntent?: SecurityIntent;
  connectorRouting?: ConnectorRouting;
  connectorPolicy?: ConnectorPolicy;
  connectorRuntime?: ConnectorRuntimeResult;
  connectorActionPlan?: ConnectorActionPlan;
  evaluatedActionPlan?: EvaluatedConnectorActionPlan;
  selectedAgents?: SelectedAgent[];
  securityDecision?: SecurityDecision;
  resolutionStatus: ResolveResponse["resolutionStatus"];
  classification: Classification;
};

function compact(values?: string[]): string[] {
  return values?.filter(Boolean) ?? [];
}

function gate(params: ExecutionGate): ExecutionGate {
  return params;
}

function finalOutcome(params: BuildExecutionGateStackParams): ExecutionGateStack["finalOutcome"] {
  if (params.securityIntent?.detected) {
    return "blocked_at_gateway";
  }

  const securityStopped = params.securityDecision?.decision === "Blocked" || params.securityDecision?.decision === "NeedsApproval";
  if (securityStopped) {
    return "blocked_at_gateway";
  }

  if (params.connectorActionPlan) {
    return "planned";
  }

  const routing = params.connectorRouting;
  const missingApplicationGrants = compact(routing?.missingApplicationGrants);
  const missingEffectivePermissions = compact(routing?.missingEffectivePermissions);
  const deniedEffectivePermissions = compact(routing?.deniedEffectivePermissions);

  if (routing?.status === "unsupported" || params.resolutionStatus === "unsupported") {
    return "unsupported";
  }

  if (routing?.status === "needs_more_info" || params.resolutionStatus === "needs_more_info") {
    return "needs_more_info";
  }

  if (routing?.status === "connector_not_onboarded" || routing?.status === "connector_skill_not_declared" || routing?.status === "connector_skill_not_enabled") {
    return "blocked_at_gateway";
  }

  if (routing?.status === "connector_skill_blocked") {
    if (missingApplicationGrants.length > 0) {
      return "blocked_at_oauth_scope";
    }

    if (missingEffectivePermissions.length > 0 || deniedEffectivePermissions.length > 0) {
      return "blocked_at_service_account_permission";
    }

    return "blocked_at_gateway";
  }

  const runtime = params.connectorRuntime;
  if (runtime?.executed) {
    return runtime.agentResponse?.runtimeSemantics?.outcome === "diagnosed" || runtime.agentResponse?.status === "diagnosed"
      ? "diagnosed"
      : "executed";
  }

  if (runtime && !runtime.executed) {
    return "runtime_failed";
  }

  return params.selectedAgents?.length ? "executed" : "needs_more_info";
}

function stoppedAt(params: BuildExecutionGateStackParams, outcome: ExecutionGateStack["finalOutcome"]): ExecutionGateId | undefined {
  if (outcome === "blocked_at_gateway" || outcome === "unsupported" || outcome === "needs_more_info") {
    return "gateway_governance";
  }

  if (outcome === "blocked_at_oauth_scope") {
    return "oauth_scope";
  }

  if (outcome === "blocked_at_service_account_permission") {
    return "service_account_permission";
  }

  if (outcome === "runtime_failed") {
    return "runtime_execution";
  }

  return undefined;
}

export function buildExecutionGateStack(params: BuildExecutionGateStackParams): ExecutionGateStack {
  const routing = params.connectorRouting;
  const runtime = params.connectorRuntime;
  const semantics = runtime?.agentResponse?.runtimeSemantics;
  const requiredGrants = compact(routing?.requiredApplicationGrants);
  const requiredPermissions = compact(routing?.requiredEffectivePermissions);
  const missingGrants = compact(routing?.missingApplicationGrants);
  const missingPermissions = compact(routing?.missingEffectivePermissions);
  const deniedPermissions = compact(routing?.deniedEffectivePermissions);
  const outcome = finalOutcome(params);
  const stopped = stoppedAt(params, outcome);
  const gatewayBlocked = stopped === "gateway_governance";
  const securityStopped = params.securityDecision?.decision === "Blocked" || params.securityDecision?.decision === "NeedsApproval";
  const oauthBlocked = stopped === "oauth_scope";
  const serviceAccountBlocked = stopped === "service_account_permission";
  const accessBoundaryBlocked = oauthBlocked || serviceAccountBlocked;

  const aiGate = gate({
    id: "ai_interpretation",
    label: "AI Interpretation",
    status: "passed",
    reason: params.securityIntent?.detected
      ? `Adversarial request detected: ${params.securityIntent.reason}`
      : params.requestInterpretation?.reason ?? "Gateway interpreted the request using deterministic and AI-assisted routing signals.",
    evidence: {
      targetSystem: routing?.targetSystem ?? params.requestInterpretation?.targetSystemText ?? params.classification.system,
      requestedAction: routing?.skillLabel ?? routing?.skillId ?? params.requestInterpretation?.requestedActionText ?? params.requestInterpretation?.requestedCapability ?? "not mapped",
      confidence: params.requestInterpretation?.confidence ?? params.classification.confidence,
      securityIntent: params.securityIntent?.detected ? params.securityIntent.category : undefined,
      actionPlan: params.connectorActionPlan?.interpretedIntent
    }
  });

  const gatewayGate = gate({
    id: "gateway_governance",
    label: "Gateway Governance",
    status: (params.connectorActionPlan || routing?.status === "connector_skill_approved" || accessBoundaryBlocked) && !params.securityIntent?.detected && !securityStopped ? "passed" : "blocked",
    reason: params.connectorActionPlan
      ? "Gateway requested a side-effect-free connector action plan."
      : params.securityIntent?.detected
      ? "Gateway blocked the request because prompt text cannot grant scopes, permissions, Gateway approval, or raw token access."
      : params.securityDecision?.decision === "NeedsApproval"
      ? "Gateway stopped the request because this action requires governed approval."
      : params.securityDecision?.decision === "Blocked"
      ? params.securityDecision.reason
      : accessBoundaryBlocked
        ? "Gateway evaluated the request and stopped it at the access boundary shown below."
        : routing?.reason ?? (params.resolutionStatus === "unsupported" ? "No supported connector route was available." : "No connector-specific route was approved."),
    evidence: {
      routeStatus: routing?.status ?? params.resolutionStatus,
      connectorId: routing?.connectorId,
      skillId: routing?.skillId,
      policyEffect: params.connectorPolicy?.effect,
      executionType: semantics?.executionType,
      planMode: params.connectorActionPlan?.mode
    }
  });

  const oauthGate = gate({
    id: "oauth_scope",
    label: "OAuth Scope Gate",
    status: gatewayBlocked
      ? "not_evaluated"
      : params.connectorActionPlan
        ? "not_evaluated"
      : oauthBlocked
        ? "blocked"
        : routing?.status === "connector_skill_approved" || serviceAccountBlocked || runtime?.tokenMetadata?.tokenIssued
          ? "passed"
          : "not_evaluated",
    reason: gatewayBlocked
      ? "Gateway stopped the request before token issuance."
      : params.connectorActionPlan
        ? "No write/runtime scope issued. Plan-only mode allowed no side effects."
      : oauthBlocked
        ? "Required OAuth application grants are missing."
      : routing?.status === "connector_skill_approved" || serviceAccountBlocked || runtime?.tokenMetadata?.tokenIssued
          ? runtime?.tokenMetadata?.tokenIssued
            ? "Scoped A2A JWT was issued for the approved skill."
            : "Required OAuth application grants are present for this connector action."
          : "No runtime token was issued for this result.",
    required: requiredGrants,
    present: runtime?.tokenMetadata?.scope ? runtime.tokenMetadata.scope.split(/\s+/).filter(Boolean) : [],
    missing: missingGrants,
    evidence: {
      tokenIssued: runtime?.tokenMetadata?.tokenIssued === true,
      audience: runtime?.tokenMetadata?.audience
    }
  });

  const serviceAccountGate = gate({
    id: "service_account_permission",
    label: "Service Account Permission Gate",
    status: gatewayBlocked || oauthBlocked
      ? "not_evaluated"
      : params.connectorActionPlan
        ? "not_evaluated"
      : serviceAccountBlocked
        ? "blocked"
        : routing?.status === "connector_skill_approved"
          ? "passed"
          : "not_evaluated",
    reason: gatewayBlocked || oauthBlocked
      ? "Stopped before this layer."
      : params.connectorActionPlan
        ? "Permissions are evaluated against proposed plan options, not runtime execution."
      : serviceAccountBlocked
        ? "Required service-account permissions are missing or explicitly denied."
        : routing?.status === "connector_skill_approved"
          ? "Effective permissions satisfy the approved skill/action."
          : "No connector action reached service-account permission evaluation.",
    required: requiredPermissions,
    present: routing?.status === "connector_skill_approved" ? requiredPermissions : [],
    missing: missingPermissions,
    denied: deniedPermissions
  });

  const runtimeGate = gate({
    id: "runtime_execution",
    label: "Runtime Execution",
    status: gatewayBlocked || oauthBlocked || serviceAccountBlocked
      ? "not_evaluated"
      : params.connectorActionPlan
        ? "not_evaluated"
      : runtime?.executed
        ? semantics?.outcome === "diagnosed" || runtime.agentResponse?.status === "diagnosed" ? "diagnosed" : "executed"
        : runtime
          ? "failed"
          : "not_evaluated",
    reason: gatewayBlocked || oauthBlocked || serviceAccountBlocked
      ? "Runtime not executed. Stopped before this layer."
      : params.connectorActionPlan
        ? "Connector returned a side-effect-free action plan only. No runtime write/action operation was executed."
      : runtime?.executed
        ? semantics?.outcome === "diagnosed" || runtime.agentResponse?.status === "diagnosed"
          ? "Read-only diagnostic runtime executed. No target write/action operation was attempted."
          : "External connector runtime executed after Gateway approval."
        : runtime
          ? runtime.errorMessage ?? runtime.error ?? "External connector runtime failed safely."
          : "No external runtime was selected for this result.",
    evidence: {
      executed: runtime?.executed === true,
      executedSkillId: semantics?.executedSkillId ?? routing?.skillId ?? runtime?.skillId,
      targetActionId: semantics?.targetActionId,
      targetActionStatus: semantics?.targetActionStatus,
      diagnosticOnly: semantics?.diagnosticOnly
    }
  });

  return {
    stoppedAt: stopped,
    finalOutcome: outcome,
    gates: [aiGate, gatewayGate, oauthGate, serviceAccountGate, runtimeGate]
  };
}
