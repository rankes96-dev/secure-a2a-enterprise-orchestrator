import type { ConnectorRuntimeSemantics, ConnectorTargetActionStatus } from "../runtime.js";
import type { EndUserAnswer } from "./types.js";
import { canBrowseJiraIssue, findJiraIssue } from "./jiraIssueData.js";
import { finProjectCreateIssueCheck, findJiraProjectAccess, requestedJiraAccessLevel } from "./jiraProjectAccess.js";

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
  evidence?: Array<{ title: string; data: Record<string, unknown> }>;
  clarifyingQuestions?: string[];
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
  const actorRoles = params.connectorAccessEvaluation.skillApprovedByConfig ? [] : [];
  const roleContext = params.actor ? params.actor.split("@")[0] : "";
  const actorRoleHints = roleContext === "ran" ? ["it-support"] : roleContext === "analyst" ? ["read-only"] : roleContext === "admin" ? ["identity-admin"] : actorRoles;

  if (params.skillId === "jira.issue.status.lookup") {
    const issue = findJiraIssue(params.message);
    if (!issue) {
      return {
        summary: "Jira issue status lookup needs an issue key.",
        probableCause: "The request did not include a Jira issue key such as FIN-42.",
        recommendedActions: ["Ask for the Jira issue key and retry the read-only lookup."],
        clarifyingQuestions: ["Which Jira issue key should I check?"],
        endUserAnswer: {
          title: "Which Jira issue should I check?",
          summary: "I can look up a Jira issue status, but I need the issue key first.",
          whatWasChecked: "No issue lookup was performed because no issue key was provided.",
          whatWasChanged: "No changes were made.",
          nextStep: "Send the Jira issue key, for example FIN-42.",
          severity: "info",
          safeToDisplay: true
        }
      };
    }

    if (!canBrowseJiraIssue(issue, params.actor, actorRoleHints)) {
      return {
        summary: "Jira issue lookup was denied by issue visibility rules.",
        probableCause: "The issue is not associated with the actor or allowed groups in the connector mock data.",
        recommendedActions: ["Ask the project owner for access or open a support ticket with the issue key."],
        evidence: [{ title: "Jira issue visibility check", data: { issueKey: issue.key, actor: params.actor, status: "blocked" } }],
        endUserAnswer: {
          title: "I cannot show that Jira issue",
          summary: "I cannot show this issue because it is not associated with your user or allowed groups.",
          whatWasChecked: "Jira issue visibility was checked for your user.",
          whatWasChanged: "No changes were made.",
          nextStep: "Ask the project owner to grant browse access, or open a support ticket with the issue key.",
          severity: "medium",
          safeToDisplay: true
        }
      };
    }

    return {
      summary: `${issue.key} is ${issue.status}. ${issue.summary}`,
      probableCause: issue.blockers ?? "No blocker is recorded in the connector data.",
      recommendedActions: [issue.nextStep],
      evidence: [{ title: "Jira issue lookup", data: { issueKey: issue.key, status: issue.status, projectKey: issue.projectKey, actor: params.actor, access: "allowed" } }],
      endUserAnswer: {
        title: `${issue.key} is ${issue.status}`,
        summary: `${issue.summary}. Assignee: ${issue.assignee}. Last update: ${issue.lastUpdate}`,
        whatWasChecked: `Jira issue ${issue.key}, project visibility, status, assignee, and latest update.`,
        whatWasChanged: "No changes were made.",
        nextStep: issue.nextStep,
        severity: issue.blockers ? "medium" : "info",
        safeToDisplay: true
      }
    };
  }

  if (params.skillId === "jira.project.access.prepare") {
    const project = findJiraProjectAccess(params.message);
    const accessLevel = requestedJiraAccessLevel(params.message);
    if (!project || !accessLevel) {
      return {
        summary: "Jira project access request needs more detail.",
        probableCause: "The request did not include a clear project key or requested access level.",
        recommendedActions: ["Ask for project key and whether viewer, contributor, or project admin access is needed."],
        clarifyingQuestions: [
          project ? "What access level do you need: viewer, contributor, or project admin?" : "Which Jira project do you need access to?",
          "What is the business reason and expected duration?"
        ],
        endUserAnswer: {
          title: "I can prepare the Jira access request",
          summary: "I need the project and access level before preparing the request.",
          whatWasChecked: "Jira project access request requirements were checked.",
          whatWasChanged: "No changes were made.",
          nextStep: "Send the project key and requested level: viewer, contributor, or project admin.",
          severity: "info",
          safeToDisplay: true
        }
      };
    }

    return {
      summary: `Prepared Jira ${project.projectKey} ${accessLevel} access request guidance.`,
      probableCause: "This is an access request preparation flow, not a permission grant.",
      recommendedActions: [`Use ${project.requestPath} and provide: ${project.requiredInformation.join(", ")}.`],
      evidence: [{ title: "Jira project access request", data: { projectKey: project.projectKey, requestedAccessLevel: accessLevel, requestPath: project.requestPath } }],
      endUserAnswer: {
        title: `Jira ${project.projectKey} access request`,
        summary: `Use the ${project.projectName} access request path for ${accessLevel} access.`,
        whatWasChecked: "Project access request path, required fields, and requested level.",
        whatWasChanged: "No changes were made. No permission was granted.",
        nextStep: `Prepare the request with: ${project.requiredInformation.join(", ")}.`,
        severity: "low",
        safeToDisplay: true
      }
    };
  }

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
    const resourceSpecificCheck = finProjectCreateIssueCheck(params.message);
    if (resourceSpecificCheck?.status === "blocked") {
      return {
        summary: "Jira issue creation is blocked by a FIN project-specific check.",
        probableCause: resourceSpecificCheck.reason,
        recommendedActions: [
          "Gateway grant check: passed.",
          "Service-account permission check: passed.",
          "FIN project-specific check: blocked.",
          "Request FIN project contributor access through the approved access flow."
        ],
        evidence: [
          {
            title: "Resource-specific runtime check",
            data: {
              resourceSpecificCheck: {
                resourceKey: "FIN",
                status: "blocked",
                reason: resourceSpecificCheck.reason,
                missingPermission: resourceSpecificCheck.missingPermission
              }
            }
          }
        ],
        endUserAnswer: {
          title: "FIN project check blocked issue creation",
          summary: "The connector has the required grant and permission for issue creation, but the FIN project has an additional contributor requirement.",
          whatWasChecked: "Gateway grant check, service-account permission check, and FIN project-specific issue creation rules.",
          whatWasChanged: "No changes were made. No issue was created.",
          nextStep: "Request FIN project contributor access or ask the FIN project owner to create the issue.",
          severity: "medium",
          safeToDisplay: true
        }
      };
    }

    return {
      summary: "READY FOR APPROVAL / PLANNED: Jira issue creation is connector-ready but was not executed.",
      probableCause: "The connector has the required grant and permission for this action. Write actions require an approved execution flow before any issue is created.",
      recommendedActions: [
        "Request approval or continue through the approved change flow.",
        "Confirm project key, issue type, summary, impact, and priority before execution.",
        "Keep the write action audited because it can modify Jira work items."
      ],
      evidence: [
        {
          title: "Jira write readiness",
          data: {
            gatewayGrantCheck: "passed",
            serviceAccountPermissionCheck: "passed",
            resourceSpecificCheck: finProjectCreateIssueCheck(params.message) ?? { status: "not_evaluated" },
            writeExecuted: false
          }
        }
      ],
      endUserAnswer: {
        title: "Ready for approval",
        summary: "The connector has the required grant and permission for this Jira issue action, but write execution is not automatic.",
        whatWasChecked: "Gateway grant check, service-account permission check, and target project context.",
        whatWasChanged: "No changes were made. No issue was created.",
        nextStep: "Request approval or continue through the approved change flow.",
        severity: "info",
        safeToDisplay: true
      }
    };
  }

  return {
    summary: "Jira issue creation failure diagnosis completed.",
    probableCause: `The diagnostic skill executed successfully. The Gateway did not attempt to create an issue. The reported Jira 403 is consistent with ${targetStatusExplanation(params.runtimeSemantics.targetActionStatus)}.`,
    recommendedActions: diagnosticActions(
      params.runtimeSemantics.targetActionLabel ?? "Create Jira issue",
      params.runtimeSemantics.targetActionStatus
    ),
    evidence: params.runtimeSemantics.targetActionStatus === "ready"
      ? [{ title: "Jira diagnostic readiness", data: { gatewayGrantCheck: "passed", serviceAccountPermissionCheck: "passed", resourceSpecificCheck: finProjectCreateIssueCheck(params.message) ?? { status: "not_evaluated" } } }]
      : undefined,
    endUserAnswer: {
      title: params.runtimeSemantics.targetActionStatus === "ready" ? "Connector checks passed" : "I found an access or permission issue",
      summary: params.runtimeSemantics.targetActionStatus === "ready"
        ? "The connector-level grant and service-account permission checks passed. If creation still fails, the next layer to inspect is project-specific rules or workflow validators."
        : "The request appears to be blocked by the current project access or issue configuration.",
      whatWasChecked: "Project access, issue visibility, and issue creation requirements were checked.",
      whatWasChanged: "No changes were made.",
      nextStep: params.runtimeSemantics.targetActionStatus === "ready"
        ? "Check project-specific rules, required fields, workflow validators, or request approval for a write execution flow."
        : "Open an approved access request for the project or ask the project owner to review the required role.",
      severity: "medium",
      safeToDisplay: true
    }
  };
}
