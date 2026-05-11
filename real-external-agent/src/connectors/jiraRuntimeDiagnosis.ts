import type { ConnectorRuntimeSemantics, ConnectorTargetActionStatus } from "../runtime.js";
import type { EndUserAnswer } from "./types.js";

export type JiraConnectorAccessEvaluation = {
  missingApplicationGrants: string[];
  missingEffectivePermissions: string[];
  deniedEffectivePermissions: string[];
  skillApprovedByConfig: boolean;
};

export type JiraRuntimeDiagnosisInput = {
  skillId: string;
  message: string;
  actor?: string;
  requiredApplicationGrants: string[];
  requiredEffectivePermissions: string[];
  connectorAccessEvaluation: JiraConnectorAccessEvaluation;
  runtimeSemantics: ConnectorRuntimeSemantics;
};

export type JiraRuntimeDiagnosis = {
  summary: string;
  probableCause: string;
  recommendedActions: string[];
  endUserAnswer?: EndUserAnswer;
};

function targetStatusExplanation(status?: ConnectorTargetActionStatus): string {
  if (status === "ready") {
    return "target create action connector-level access checks passing; investigate object-level rules, workflow validators, or resource-specific restrictions";
  }
  if (status === "missing_application_grants") {
    return "the target create action missing required application access grants such as write:jira-work";
  }
  if (status === "missing_effective_permissions") {
    return "the target create action missing effective Jira permissions such as Create Issues";
  }
  if (status === "explicitly_denied") {
    return "the target create action being explicitly denied for Create Issues";
  }
  if (status === "not_enabled") {
    return "the target create action not being enabled for this connector configuration";
  }
  return "the target create action readiness being unknown";
}

function diagnosticActions(targetActionLabel: string, status?: ConnectorTargetActionStatus): string[] {
  const actions = [
    "Keep this configuration if the connector should diagnose without performing the target action.",
    `Grant the required application access grants and effective permissions for ${targetActionLabel} if the target action should be enabled.`,
    "Re-run Gateway onboarding after changing external connector grants or permissions."
  ];

  if (status === "ready") {
    return [
      "Check required fields, workflow validators, issue security, or project-specific rules.",
      "Confirm whether the failing request runs as the service account or as the end-user actor.",
      "Inspect Jira audit logs for the exact permission check that failed.",
      "Re-run Gateway onboarding after changing external connector grants or permissions."
    ];
  }

  return actions;
}

export function buildJiraRuntimeDiagnosis(params: JiraRuntimeDiagnosisInput): JiraRuntimeDiagnosis {
  if (params.skillId === "jira.permission.inspect") {
    return {
      summary: "Jira permission inspection completed.",
      probableCause: "The connector validated read-only Jira permission inspection access for the service account / integration user context.",
      recommendedActions: [
        "Review project role membership for the affected user or integration account.",
        "Compare project role visibility with the permission scheme.",
        "Confirm whether the failing action runs as the service account or as the end-user actor."
      ],
      endUserAnswer: {
        title: "I checked Jira access details",
        summary: "The request appears related to Jira project roles, visibility, or permission configuration.",
        whatWasChecked: "Project roles, issue visibility, and relevant access context were checked.",
        whatWasChanged: "No changes were made.",
        nextStep: "Ask the project owner to review the user's role and project access.",
        severity: "medium",
        safeToDisplay: true
      }
    };
  }

  if (params.skillId === "jira.issue.create") {
    return {
      summary: "Jira issue create runtime request received.",
      probableCause: "The create action reached runtime with connector-level create access. In the default demo this should remain blocked unless all grants and permissions are intentionally enabled.",
      recommendedActions: [
        "Validate the target project key, issue type, and required fields before creating issues.",
        "Keep this action audited because it can modify Jira work items.",
        "Confirm the request should run under the service account context."
      ]
    };
  }

  return {
    summary: "Jira issue creation failure diagnosis completed.",
    probableCause: `The diagnostic skill executed successfully. The Gateway did not attempt to create an issue. The reported Jira 403 is consistent with ${targetStatusExplanation(params.runtimeSemantics.targetActionStatus)}.`,
    recommendedActions: diagnosticActions(
      params.runtimeSemantics.targetActionLabel ?? "Create Jira issue",
      params.runtimeSemantics.targetActionStatus
    ),
    endUserAnswer: {
      title: "I found an access or permission issue",
      summary: "The request is failing because the current access configuration does not allow this operation.",
      whatWasChecked: "Project access, issue visibility, and relevant permission context were checked.",
      whatWasChanged: "No changes were made.",
      nextStep: "Open an approved access request or ask the project owner to review the required role.",
      severity: "medium",
      safeToDisplay: true
    }
  };
}
