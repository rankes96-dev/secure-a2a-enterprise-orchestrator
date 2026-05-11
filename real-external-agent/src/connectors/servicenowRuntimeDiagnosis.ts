import type { ConnectorRuntimeSemantics, ConnectorTargetActionStatus } from "../runtime.js";
import type { EndUserAnswer } from "./types.js";

export type ServiceNowRuntimeDiagnosisInput = {
  skillId: string;
  message: string;
  actor?: string;
  requiredApplicationGrants: string[];
  requiredEffectivePermissions: string[];
  connectorAccessEvaluation: {
    missingApplicationGrants: string[];
    missingEffectivePermissions: string[];
    deniedEffectivePermissions: string[];
    skillApprovedByConfig: boolean;
  };
  runtimeSemantics: ConnectorRuntimeSemantics;
};

export type ServiceNowRuntimeDiagnosis = {
  summary: string;
  probableCause: string;
  recommendedActions: string[];
  endUserAnswer?: EndUserAnswer;
};

function statusExplanation(status?: ConnectorTargetActionStatus): string {
  if (status === "ready") {
    return "target action connector-level access checks passing; investigate record-level ACLs, workflow state, or resource-specific restrictions";
  }
  if (status === "missing_application_grants") {
    return "missing application access grants for the target action";
  }
  if (status === "missing_effective_permissions") {
    return "missing ServiceNow roles, ACLs, or table permissions for the target action";
  }
  if (status === "explicitly_denied") {
    return "explicitly denied ServiceNow table permission or ACL access for the target action";
  }
  if (status === "not_enabled") {
    return "the target action not being enabled for this connector configuration";
  }
  return "unknown target action readiness";
}

function diagnosticCause(systemAction: string, status?: ConnectorTargetActionStatus): string {
  return `The diagnostic skill executed successfully. The Gateway did not attempt the ${systemAction}. The reported failure is consistent with ${statusExplanation(status)}.`;
}

function diagnosticActions(targetActionLabel: string, status?: ConnectorTargetActionStatus): string[] {
  if (status === "ready") {
    return [
      "Check record-level ACLs, workflow validators, assignment rules, and current record state.",
      "Confirm whether the failing request runs as the service account or as the end-user actor.",
      "Re-run Gateway onboarding after changing external connector grants or permissions."
    ];
  }

  return [
    "Keep this configuration if the connector should diagnose without performing the target action.",
    `Grant the required application access grants and effective permissions for ${targetActionLabel} if the target action should be enabled.`,
    "Re-run Gateway onboarding after changing external connector grants or permissions."
  ];
}

export function buildServiceNowRuntimeDiagnosis(params: ServiceNowRuntimeDiagnosisInput): ServiceNowRuntimeDiagnosis {
  if (params.skillId === "servicenow.catalog.request.diagnose") {
    return {
      summary: "ServiceNow catalog request diagnosis completed.",
      probableCause: diagnosticCause("catalog request update or fulfillment action", params.runtimeSemantics.targetActionStatus),
      recommendedActions: diagnosticActions(
        params.runtimeSemantics.targetActionLabel ?? "Process catalog request",
        params.runtimeSemantics.targetActionStatus
      ),
      endUserAnswer: {
        title: "I found a catalog request workflow issue",
        summary: "The catalog request appears to be blocked by request state, catalog role, or fulfillment configuration.",
        whatWasChecked: "Request item visibility, catalog access, and fulfillment context were checked.",
        whatWasChanged: "No changes were made.",
        nextStep: "Open a ServiceNow support request with the request item number and the catalog item name.",
        severity: "medium",
        safeToDisplay: true
      }
    };
  }

  if (params.skillId === "servicenow.user.role.inspect") {
    return {
      summary: "ServiceNow user role access inspection completed.",
      probableCause: "The connector validated user role inspection access for ACL and role metadata.",
      recommendedActions: [
        "Review the user's assigned roles and inherited groups.",
        "Check user table ACLs for the integration user.",
        "Compare expected ITIL or catalog roles with the affected workflow.",
        "Inspect recent role or group changes in ServiceNow audit history."
      ],
      endUserAnswer: {
        title: "I checked ServiceNow role access",
        summary: "The request appears related to user roles, groups, or access rules.",
        whatWasChecked: "Assigned roles, inherited groups, and access-rule visibility were checked.",
        whatWasChanged: "No changes were made.",
        nextStep: "Ask the ServiceNow owner to review the expected role or group membership.",
        severity: "medium",
        safeToDisplay: true
      }
    };
  }

  return {
    summary: "ServiceNow incident assignment diagnosis completed.",
    probableCause: diagnosticCause("incident assignment or update action", params.runtimeSemantics.targetActionStatus),
    recommendedActions: diagnosticActions(
      params.runtimeSemantics.targetActionLabel ?? "Assign ServiceNow incident",
      params.runtimeSemantics.targetActionStatus
    ),
    endUserAnswer: {
      title: "I found an assignment workflow issue",
      summary: "The incident assignment flow appears to be blocked by routing, role, or assignment configuration.",
      whatWasChecked: "Assignment routing and incident access context were checked.",
      whatWasChanged: "No changes were made.",
      nextStep: "Open a ServiceNow support request with the incident number and target assignment group.",
      severity: "medium",
      safeToDisplay: true
    }
  };
}
