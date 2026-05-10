import type { Classification, ExecutionGate, ExecutionGateId, ExecutionGateStack, RequestInterpretation, ResolveResponse, SecurityIntent, SelectedAgent } from "@a2a/shared";
import type { ConnectorRuntimeResult } from "./connectorRuntime";

type ConnectorRouting = NonNullable<ResolveResponse["connectorRouting"]>;
type ConnectorPolicy = NonNullable<ResolveResponse["connectorPolicy"]>;

export type BuildExecutionGateStackParams = {
  requestInterpretation?: RequestInterpretation;
  securityIntent?: SecurityIntent;
  connectorRouting?: ConnectorRouting;
  connectorPolicy?: ConnectorPolicy;
  connectorRuntime?: ConnectorRuntimeResult;
  selectedAgents?: SelectedAgent[];
  resolutionStatus: ResolveResponse["resolutionStatus"];
  classification: Classification;
};

function compact(values?: string[]): string[] {
  return values?.filter(Boolean) ?? [];
}

function gate(params: ExecutionGate): ExecutionGate {
  return params;
}

function gatewayBlockStatus(status?: string): boolean {
  return Boolean(status && status !== "connector_skill_approved");
}

function finalOutcome(params: BuildExecutionGateStackParams): ExecutionGateStack["finalOutcome"] {
  if (params.securityIntent?.detected) {
    return "blocked_at_gateway";
  }

  if (params.connectorRouting?.status === "unsupported" || params.resolutionStatus === "unsupported") {
    return "unsupported";
  }

  if (params.connectorRouting?.status === "needs_more_info" || params.resolutionStatus === "needs_more_info") {
    return "needs_more_info";
  }

  if (gatewayBlockStatus(params.connectorRouting?.status)) {
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
  const oauthBlocked = stopped === "oauth_scope";

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
      securityIntent: params.securityIntent?.detected ? params.securityIntent.category : undefined
    }
  });

  const gatewayGate = gate({
    id: "gateway_governance",
    label: "Gateway Governance",
    status: routing?.status === "connector_skill_approved" && !params.securityIntent?.detected ? "passed" : "blocked",
    reason: params.securityIntent?.detected
      ? "Gateway blocked the request because prompt text cannot grant scopes, permissions, Gateway approval, or raw token access."
      : routing?.reason ?? (params.resolutionStatus === "unsupported" ? "No supported connector route was available." : "No connector-specific route was approved."),
    required: [...requiredGrants, ...requiredPermissions],
    missing: [...missingGrants, ...missingPermissions],
    denied: deniedPermissions,
    evidence: {
      routeStatus: routing?.status ?? params.resolutionStatus,
      connectorId: routing?.connectorId,
      skillId: routing?.skillId,
      policyEffect: params.connectorPolicy?.effect
    }
  });

  const oauthGate = gate({
    id: "oauth_scope",
    label: "OAuth Scope Gate",
    status: gatewayBlocked
      ? "not_evaluated"
      : missingGrants.length
        ? "blocked"
        : runtime?.tokenMetadata?.tokenIssued
          ? "passed"
          : "not_evaluated",
    reason: gatewayBlocked
      ? "Gateway stopped the request before token issuance."
      : missingGrants.length
        ? "Required OAuth application grants are missing."
        : runtime?.tokenMetadata?.tokenIssued
          ? "Scoped A2A JWT was issued for the approved skill."
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
      : missingPermissions.length || deniedPermissions.length
        ? "blocked"
        : routing?.status === "connector_skill_approved"
          ? "passed"
          : "not_evaluated",
    reason: gatewayBlocked || oauthBlocked
      ? "Stopped before this layer."
      : missingPermissions.length || deniedPermissions.length
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
    status: gatewayBlocked || oauthBlocked || serviceAccountGate.status === "blocked"
      ? "not_evaluated"
      : runtime?.executed
        ? semantics?.outcome === "diagnosed" || runtime.agentResponse?.status === "diagnosed" ? "diagnosed" : "executed"
        : runtime
          ? "failed"
          : "not_evaluated",
    reason: gatewayBlocked || oauthBlocked || serviceAccountGate.status === "blocked"
      ? "Runtime not executed. Stopped before this layer."
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
