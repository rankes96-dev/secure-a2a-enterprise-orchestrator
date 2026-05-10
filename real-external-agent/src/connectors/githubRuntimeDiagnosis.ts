import type { ConnectorRuntimeSemantics, ConnectorTargetActionStatus } from "../runtime.js";

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
      ]
    };
  }

  if (params.skillId === "github.pull_request.access.diagnose") {
    return {
      summary: "GitHub pull request access diagnosis completed.",
      probableCause: diagnosticCause("pull request checks read action", params.runtimeSemantics.targetActionStatus),
      recommendedActions: diagnosticActions(
        params.runtimeSemantics.targetActionLabel ?? "Read pull request checks",
        params.runtimeSemantics.targetActionStatus
      )
    };
  }

  return {
    summary: "GitHub repository rate-limit diagnosis completed.",
    probableCause: diagnosticCause("repository sync or mutation operation", params.runtimeSemantics.targetActionStatus),
    recommendedActions: diagnosticActions(
      params.runtimeSemantics.targetActionLabel ?? "Sync GitHub repository",
      params.runtimeSemantics.targetActionStatus
    )
  };
}
