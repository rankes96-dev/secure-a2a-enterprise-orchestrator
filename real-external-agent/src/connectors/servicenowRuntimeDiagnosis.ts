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
};

export type ServiceNowRuntimeDiagnosis = {
  summary: string;
  probableCause: string;
  recommendedActions: string[];
};

export function buildServiceNowRuntimeDiagnosis(params: ServiceNowRuntimeDiagnosisInput): ServiceNowRuntimeDiagnosis {
  if (params.skillId === "servicenow.catalog.request.diagnose") {
    return {
      summary: "ServiceNow catalog request diagnosis completed.",
      probableCause: "The failure is consistent with catalog request item visibility, approval workflow state, or sc_req_item table ACL restrictions.",
      recommendedActions: [
        "Verify the integration user can read the sc_req_item table.",
        "Check the RITM approval state and catalog item availability.",
        "Confirm the request is visible to the configured service account / integration user.",
        "Inspect ServiceNow workflow history for the failed approval or request transition."
      ]
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
      ]
    };
  }

  return {
    summary: "ServiceNow incident assignment diagnosis completed.",
    probableCause: "The failure is consistent with missing ITIL role, assignment group visibility, or table ACL restrictions.",
    recommendedActions: [
      "Verify the integration user has the itil role.",
      "Check incident table ACLs.",
      "Confirm assignment group visibility.",
      "Inspect ServiceNow audit/history for the failed assignment."
    ]
  };
}
