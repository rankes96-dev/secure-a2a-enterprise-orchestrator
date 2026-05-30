import type { RequestInterpretation, RequestScope } from "@a2a/shared";
import type { ConnectorRoutingDecision } from "./connectorRouting.js";
import { createInterpretationProof } from "./interpretation/interpretationProof.js";
import type { OgenInterpretationProof } from "./interpretation/interpretationTypes.js";

const explicitSecurityRisks = new Set([
  "prompt_injection_attempt",
  "policy_bypass_attempt",
  "secret_or_token_request",
  "privilege_escalation_attempt",
  "false_authority_attempt"
]);

export type ConnectorInterpretationReconciliationResult = {
  interpretation?: RequestInterpretation;
  proof: OgenInterpretationProof;
  reconciled: boolean;
  originalInterpretationScope?: RequestScope;
  reconciledScope?: RequestScope;
  reason?: string;
};

function approvedConnectorRouteSupportsScope(route: ConnectorRoutingDecision): boolean {
  return route.status === "connector_skill_approved" &&
    Boolean(route.skillId?.trim()) &&
    Boolean(route.connectorId?.trim()) &&
    Boolean((route.resourceSystem ?? route.actionResourceSystem)?.trim());
}

function hasExplicitSecurityRisk(proof: OgenInterpretationProof, hasExternalSecurityRisk: boolean): boolean {
  return hasExternalSecurityRisk || proof.risks.some((risk) => explicitSecurityRisks.has(risk));
}

function connectorSupportedScope(route: ConnectorRoutingDecision): RequestScope {
  if (
    route.intentClass === "access_request" ||
    route.intentClass === "permission_request" ||
    route.requiresApproval === true ||
    route.executionType === "write_action" ||
    route.actionCategory === "permission.grant" ||
    route.approvalMode === "always"
  ) {
    return "manual_enterprise_workflow";
  }

  return "enterprise_support";
}

function connectorSupportedReason(route: ConnectorRoutingDecision, scope: RequestScope): string {
  const routeId = [
    route.connectorId,
    route.resourceSystem ?? route.actionResourceSystem,
    route.skillId
  ].filter(Boolean).join("/");
  return `The request is supported by approved connector route ${routeId}; interpretation scope was reconciled to ${scope} before normal policy evaluation.`;
}

export function reconcileConnectorSupportedInterpretation(params: {
  inputText: string;
  interpretation?: RequestInterpretation;
  proof: OgenInterpretationProof;
  connectorRouting: ConnectorRoutingDecision;
  hasExplicitSecurityRisk?: boolean;
}): ConnectorInterpretationReconciliationResult {
  const { interpretation, proof, connectorRouting } = params;

  if (
    !interpretation ||
    !approvedConnectorRouteSupportsScope(connectorRouting) ||
    hasExplicitSecurityRisk(proof, params.hasExplicitSecurityRisk === true)
  ) {
    return {
      interpretation,
      proof,
      reconciled: false
    };
  }

  const reconciledScope = connectorSupportedScope(connectorRouting);
  const needsScopeReconciliation = interpretation.scope !== reconciledScope || proof.risks.includes("unsupported_scope");
  if (!needsScopeReconciliation) {
    return {
      interpretation,
      proof,
      reconciled: false
    };
  }

  const originalInterpretationScope = interpretation.scope;
  const reason = connectorSupportedReason(connectorRouting, reconciledScope);
  const reconciledInterpretation: RequestInterpretation = {
    ...interpretation,
    scope: reconciledScope,
    interpretationSource: interpretation.interpretationSource,
    requestedCapability:
      interpretation.requestedCapability && interpretation.requestedCapability !== "unknown"
        ? interpretation.requestedCapability
        : connectorRouting.skillId ?? interpretation.requestedCapability,
    targetSystemText: connectorRouting.targetSystem ?? connectorRouting.resourceSystem ?? interpretation.targetSystemText,
    targetResourceName: connectorRouting.targetResourceName ?? interpretation.targetResourceName,
    requestedActionText: connectorRouting.skillLabel ?? connectorRouting.skillId ?? interpretation.requestedActionText,
    requiresApproval: connectorRouting.requiresApproval ?? interpretation.requiresApproval,
    reason
  };
  const reconciledProof = createInterpretationProof({
    inputText: params.inputText,
    normalizedInterpretation: reconciledInterpretation,
    interpretationId: proof.interpretationId,
    reconciliation: {
      originalInterpretationScope,
      reconciledScope,
      reconciliationSource: "connector_route",
      reconciliationReason: reason
    }
  });

  return {
    interpretation: reconciledInterpretation,
    proof: reconciledProof,
    reconciled: true,
    originalInterpretationScope,
    reconciledScope,
    reason
  };
}
