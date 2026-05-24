import type { ConnectorRuntimeSemantics, ConnectorTargetActionStatus } from "../runtime.js";
import type { EndUserAnswer } from "./types.js";
import { recommendServiceNowCatalogItem, recommendServiceNowCatalogItemForTarget } from "./servicenowCatalogItems.js";
import { canReadServiceNowTicket, extractServiceNowTicketNumber, findServiceNowTicketByNumber } from "./servicenowTicketData.js";
import { findApprovalContext, isApprovalPrompt } from "./servicenowUserAccess.js";

export type ServiceNowRuntimeDiagnosisInput = {
  skillId: string;
  message: string;
  actor?: string;
  requestContext?: {
    intentClass?: string;
    targetResourceSystem?: string;
    targetResourceName?: string;
    requestedAccessLevel?: string;
    fulfillmentCapability?: string;
    currentUserMessage?: string;
    missingFields?: string[];
  };
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
  evidence?: Array<{ title: string; data: Record<string, unknown> }>;
  clarifyingQuestions?: string[];
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

function accessRequestDetailPrompt(fields: string[]): string {
  const prompts = fields.map((field) => {
    if (field === "resource/project/site") return "which project, repository, site, or environment you need";
    if (field === "accessLevel") return "what access level you need: viewer, contributor, write, or project admin";
    if (field === "businessReason") return "the business reason";
    return field;
  });
  return prompts.join("; ");
}

function hiddenServiceNowTicketResponse(requestedTicketNumber: string): ServiceNowRuntimeDiagnosis {
  return {
    summary: "ServiceNow ticket lookup could not return a visible ticket.",
    probableCause: "The ticket number was not found or is not visible to the current actor in this demo connector data.",
    recommendedActions: ["Check the ticket number or ask the requester, watcher, assignee, or support team for access."],
    evidence: [{ title: "ServiceNow ticket visibility check", data: { requestedTicketNumber, status: "not_visible_or_not_found" } }],
    endUserAnswer: {
      title: "I cannot show that ticket",
      summary: "I cannot find a ServiceNow ticket you can view for that number.",
      whatWasChecked: "A ticket lookup and visibility check were completed.",
      whatWasChanged: "No changes were made.",
      nextStep: "Check the ticket number or ask the ticket requester or support team for access.",
      severity: "medium",
      safeToDisplay: true
    }
  };
}

export function buildServiceNowRuntimeDiagnosis(params: ServiceNowRuntimeDiagnosisInput): ServiceNowRuntimeDiagnosis {
  // Demo fixture role hints only. Real ServiceNow ACLs must come from vendor identity,
  // SCIM/directory mapping, or connected-account state, not email prefixes.
  const roleHints = params.actor?.startsWith("ran@") ? ["it-support"] : params.actor?.startsWith("admin@") ? ["identity-admin"] : params.actor?.startsWith("analyst@") ? ["read-only"] : [];

  if (params.skillId === "servicenow.ticket.status.lookup") {
    const requestedTicketNumber = extractServiceNowTicketNumber(params.requestContext?.currentUserMessage ?? "") ?? extractServiceNowTicketNumber(params.message);
    if (!requestedTicketNumber) {
      return {
        summary: "ServiceNow ticket lookup needs a ticket number.",
        probableCause: "No INC, RITM, or REQ number was provided in the request.",
        recommendedActions: ["Ask for the ticket or request number and retry the lookup."],
        clarifyingQuestions: ["What is the ServiceNow ticket number, for example INC0010213, RITM0042088, or REQ0010001?"],
        endUserAnswer: {
          title: "Which ticket should I check?",
          summary: "I can check a ServiceNow ticket status, but I need the ticket number first.",
          whatWasChecked: "No ticket lookup was performed because no ticket number was provided.",
          whatWasChanged: "No changes were made.",
          nextStep: "Send the INC, RITM, or REQ number.",
          severity: "info",
          safeToDisplay: true
        }
      };
    }

    const ticket = findServiceNowTicketByNumber(requestedTicketNumber);
    if (!ticket) {
      return hiddenServiceNowTicketResponse(requestedTicketNumber);
    }

    if (!canReadServiceNowTicket(ticket, params.actor, roleHints)) {
      return hiddenServiceNowTicketResponse(requestedTicketNumber);
    }

    return {
      summary: `${ticket.number} is ${ticket.state}. ${ticket.shortDescription}`,
      probableCause: ticket.lastUpdate,
      recommendedActions: [ticket.nextStep],
      evidence: [{ title: "ServiceNow ticket lookup", data: { ticketNumber: ticket.number, state: ticket.state, assignedGroup: ticket.assignedGroup, actor: params.actor, access: "allowed" } }],
      endUserAnswer: {
        title: `${ticket.number} is ${ticket.state}`,
        summary: `${ticket.shortDescription}. Assigned group: ${ticket.assignedGroup}. Last update: ${ticket.lastUpdate}`,
        whatWasChecked: "Ticket number, requester/watchers, assigned group, current state, and latest update.",
        whatWasChanged: "No changes were made.",
        nextStep: ticket.nextStep,
        severity: ticket.state.toLowerCase().includes("waiting") ? "medium" : "info",
        safeToDisplay: true
      }
    };
  }

  if (params.skillId === "servicenow.catalog.item.recommend") {
    const item = recommendServiceNowCatalogItemForTarget(params.requestContext?.targetResourceSystem, params.message);
    const selected = item ?? recommendServiceNowCatalogItem("access");
    if (!selected) {
      return {
        summary: "ServiceNow catalog recommendation needs more detail.",
        probableCause: "No matching catalog item was found.",
        recommendedActions: ["Ask for the system name and access needed."],
        clarifyingQuestions: ["Which system or service do you need access to?"],
        endUserAnswer: {
          title: "I need one more detail",
          summary: "I can recommend a ServiceNow catalog item, but I need the system or service name.",
          whatWasChecked: "Catalog keywords and request type.",
          whatWasChanged: "No changes were made.",
          nextStep: "Send the system or service name and the access you need.",
          severity: "info",
          safeToDisplay: true
        }
      };
    }

    const targetLabel = [
      params.requestContext?.targetResourceSystem,
      params.requestContext?.targetResourceName ? `(${params.requestContext.targetResourceName})` : ""
    ].filter(Boolean).join(" ");
    const missingFields = params.requestContext?.missingFields?.length
      ? params.requestContext.missingFields
      : selected.requiredFields;
    const requestedLevel = params.requestContext?.requestedAccessLevel;
    const requestContextSummary = targetLabel
      ? `I can help prepare a ${targetLabel} access request through ServiceNow.`
      : "I can help prepare this access request through ServiceNow.";

    return {
      summary: `Recommended ServiceNow catalog item: ${selected.name}.`,
      probableCause: selected.description,
      recommendedActions: [`Open ${selected.id} and provide: ${missingFields.join(", ")}.`],
      evidence: [{ title: "ServiceNow fulfillment capability match", data: { catalogItemId: selected.id, name: selected.name, deepLink: selected.deepLink, fulfillmentCapability: params.requestContext?.fulfillmentCapability ?? "catalog.item.recommend", targetResourceSystem: params.requestContext?.targetResourceSystem, targetResourceName: params.requestContext?.targetResourceName, requestedAccessLevel: requestedLevel, missingFields } }],
      endUserAnswer: {
        title: "Request preparation",
        summary: `${requestContextSummary} Recommended form: ${selected.name} (${selected.id}).`,
        whatWasChecked: "ServiceNow fulfillment capabilities, catalog item match, target resource, and required request details.",
        whatWasChanged: "No changes were made. No request was submitted.",
        nextStep: `Send these details: ${accessRequestDetailPrompt(missingFields)}.${requestedLevel ? ` Requested access level detected: ${requestedLevel}.` : ""}`,
        severity: "low",
        safeToDisplay: true
      }
    };
  }

  if (params.skillId === "servicenow.catalog.request.diagnose") {
    if (isApprovalPrompt(params.message)) {
      const approval = findApprovalContext(params.message);
      const allowedApprover = approval?.approver.toLowerCase() === params.actor?.toLowerCase() || approval?.delegatedTo?.toLowerCase() === params.actor?.toLowerCase();
      return {
        summary: approval
          ? `${approval.requestNumber} approval status checked.`
          : "ServiceNow approval status needs a RITM number.",
        probableCause: approval
          ? approval.blockedReason ?? (allowedApprover ? "The current actor is allowed to approve this request." : "The current actor is not the assigned approver for this request.")
          : "No RITM number or approval context was found.",
        recommendedActions: approval
          ? [allowedApprover ? "Open the approval queue and review the RITM." : "Ask the assigned approver or delegated approver to review the RITM."]
          : ["Ask for the RITM number."],
        evidence: approval ? [{ title: "ServiceNow approval check", data: { requestNumber: approval.requestNumber, actor: params.actor, approver: approval.approver, delegatedTo: approval.delegatedTo, actorIsApprover: allowedApprover } }] : undefined,
        endUserAnswer: {
          title: approval ? `${approval.requestNumber} is waiting for approval` : "Which RITM should I check?",
          summary: approval
            ? allowedApprover
              ? "You are listed as an approver or delegated approver for this request."
              : "You are not the assigned approver for this request, so I cannot approve it for you."
            : "I need the RITM number to check approval status.",
          whatWasChecked: "Request approval state, assigned approver, and delegation context.",
          whatWasChanged: "No changes were made. No approval was submitted.",
          nextStep: approval
            ? allowedApprover ? "Open your ServiceNow approval queue and review the request." : "Ask the assigned approver to review the request or update the approval delegation."
            : "Send the RITM number.",
          severity: "medium",
          safeToDisplay: true
        }
      };
    }

    return {
      summary: "ServiceNow catalog request diagnosis completed.",
      probableCause: diagnosticCause("catalog request update or fulfillment action", params.runtimeSemantics.targetActionStatus),
      recommendedActions: diagnosticActions(
        params.runtimeSemantics.targetActionLabel ?? "Process catalog request",
        params.runtimeSemantics.targetActionStatus
      ),
      endUserAnswer: {
        title: "I found a catalog request workflow issue",
        summary: "The catalog request appears to be blocked by approval, fulfillment, or access configuration.",
        whatWasChecked: "Catalog request status, approval context, and fulfillment path were checked.",
        whatWasChanged: "No changes were made.",
        nextStep: "Open a ServiceNow support request with the request number and requested item details.",
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
