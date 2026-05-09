export type JiraConnectorAccessEvaluation = {
  missingApplicationGrants: string[];
  missingEffectivePermissions: string[];
  deniedEffectivePermissions: string[];
  skillApprovedByConfig: boolean;
  createIssueAccessReady?: boolean;
};

export type JiraRuntimeDiagnosisInput = {
  skillId: string;
  message: string;
  actor?: string;
  requiredApplicationGrants: string[];
  requiredEffectivePermissions: string[];
  connectorAccessEvaluation: JiraConnectorAccessEvaluation;
};

export type JiraRuntimeDiagnosis = {
  summary: string;
  probableCause: string;
  recommendedActions: string[];
};

export function buildJiraRuntimeDiagnosis(params: JiraRuntimeDiagnosisInput): JiraRuntimeDiagnosis {
  if (params.skillId === "jira.permission.inspect") {
    return {
      summary: "Jira permission inspection completed.",
      probableCause: "The connector validated read-only Jira permission inspection access for the service account / integration user context.",
      recommendedActions: [
        "Review project role membership for the affected user or integration account.",
        "Compare project role visibility with the permission scheme.",
        "Confirm whether the failing action runs as the service account or as the end-user actor."
      ]
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

  if (params.connectorAccessEvaluation.createIssueAccessReady) {
    return {
      summary: "Jira issue creation failure diagnosis completed.",
      probableCause: "Connector-level access checks passed. The 403 is less likely to be caused by missing application access grants or service-account permissions.",
      recommendedActions: [
        "Verify the FIN project key and target issue type.",
        "Check required fields, workflow validators, issue security, or project-specific rules.",
        "Confirm whether the failing request runs as the service account or as the end-user actor.",
        "If user-delegated execution is enabled, verify the actor has Create Issues permission in FIN.",
        "Inspect Jira audit logs for the exact permission check that failed."
      ]
    };
  }

  return {
    summary: "Jira issue creation failure diagnosis completed.",
    probableCause: "The connector is approved for diagnosis, but issue creation access is not fully enabled.",
    recommendedActions: [
      "Grant write:jira-work to the connected app only if this connector should create issues.",
      "Grant Create Issues permission to the service account / integration user only if creation should be enabled.",
      "Keep create action blocked if the connector should diagnose only."
    ]
  };
}
