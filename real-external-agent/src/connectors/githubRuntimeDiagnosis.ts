import type { ConnectorRuntimeSemantics, ConnectorTargetActionStatus } from "../runtime.js";
import type { EndUserAnswer } from "./types.js";

export type GitHubRuntimeDiagnosisInput = {
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

export type GitHubRuntimeDiagnosis = {
  summary: string;
  probableCause: string;
  recommendedActions: string[];
  endUserAnswer?: EndUserAnswer;
};

function statusExplanation(status?: ConnectorTargetActionStatus): string {
  if (status === "ready") {
    return "target action connector-level access checks passing; investigate repository selection, branch protection, object visibility, or API response details";
  }
  if (status === "missing_application_grants") {
    return "missing GitHub App or OAuth application access grants for the target action";
  }
  if (status === "missing_effective_permissions") {
    return "missing installation access, repository metadata, pull request, or rate-limit visibility permissions for the target action";
  }
  if (status === "explicitly_denied") {
    return "explicitly denied repository or organization access for the target action";
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
      "Check repository selection, branch protection, installation token context, and object-level visibility.",
      "Inspect GitHub API response headers and audit logs for resource-specific restrictions.",
      "Re-run Gateway onboarding after changing external connector grants or permissions."
    ];
  }

  return [
    "Keep this configuration if the connector should diagnose without performing the target action.",
    `Grant the required application access grants and effective permissions for ${targetActionLabel} if the target action should be enabled.`,
    "Re-run Gateway onboarding after changing external connector grants or permissions."
  ];
}

export function buildGitHubRuntimeDiagnosis(params: GitHubRuntimeDiagnosisInput): GitHubRuntimeDiagnosis {
  if (params.skillId === "github.repository.permission.inspect") {
    return {
      summary: "GitHub repository permission inspection completed.",
      probableCause: "The failure is consistent with GitHub App installation scope, repository selection, or missing repository metadata permissions.",
      recommendedActions: [
        "Check GitHub App installation access for the repository.",
        "Verify repository metadata permissions are granted.",
        "Confirm whether the repository is private, archived, transferred, or outside the installation scope.",
        "Inspect the GitHub App installation audit log for permission changes."
      ],
      endUserAnswer: {
        title: "I found a repository access issue",
        summary: "The repository may not be available to the connected GitHub app or current access configuration.",
        whatWasChecked: "Repository visibility, installation access, and metadata access context were checked.",
        whatWasChanged: "No changes were made.",
        nextStep: "Ask the repository owner to review GitHub app installation access for this repository.",
        severity: "medium",
        safeToDisplay: true
      }
    };
  }

  if (params.skillId === "github.pull_request.access.diagnose") {
    return {
      summary: "GitHub pull request access diagnosis completed.",
      probableCause: diagnosticCause("pull request checks read action", params.runtimeSemantics.targetActionStatus),
      recommendedActions: diagnosticActions(
        params.runtimeSemantics.targetActionLabel ?? "Read pull request checks",
        params.runtimeSemantics.targetActionStatus
      ),
      endUserAnswer: {
        title: "I found a pull request access issue",
        summary: "The pull request or its checks may not be visible to the connected GitHub app or current access configuration.",
        whatWasChecked: "Pull request visibility, repository access, and check-read context were checked.",
        whatWasChanged: "No changes were made.",
        nextStep: "Ask the repository owner to review app installation access and pull request visibility.",
        severity: "medium",
        safeToDisplay: true
      }
    };
  }

  return {
    summary: "GitHub repository rate-limit diagnosis completed.",
    probableCause: diagnosticCause("repository sync or mutation operation", params.runtimeSemantics.targetActionStatus),
    recommendedActions: diagnosticActions(
      params.runtimeSemantics.targetActionLabel ?? "Sync GitHub repository",
      params.runtimeSemantics.targetActionStatus
    ),
    endUserAnswer: {
      title: "I found a GitHub API capacity issue",
      summary: "Repository sync appears to be affected by API rate limits or repository access configuration.",
      whatWasChecked: "Repository access, installation context, and rate-limit related signals were checked.",
      whatWasChanged: "No changes were made.",
      nextStep: "Retry after the rate-limit window resets or ask the repository owner to review app access.",
      severity: "medium",
      safeToDisplay: true
    }
  };
}
