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
};

export type GitHubRuntimeDiagnosis = {
  summary: string;
  probableCause: string;
  recommendedActions: string[];
};

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
      probableCause: "The failure is consistent with missing pull request read permission, repository installation access, or branch protection visibility.",
      recommendedActions: [
        "Verify the GitHub App has pull request read access.",
        "Confirm the target repository is included in the app installation.",
        "Check branch protection and required-check visibility for the integration context.",
        "Inspect whether the request used an installation token or user token."
      ]
    };
  }

  return {
    summary: "GitHub repository rate-limit diagnosis completed.",
    probableCause: "The failure is consistent with app installation access, repository metadata scope, or API rate limit exhaustion.",
    recommendedActions: [
      "Check GitHub App installation access for the repository.",
      "Verify repository metadata read access.",
      "Inspect API rate limit headers and usage.",
      "Confirm whether requests are using app installation token or user token."
    ]
  };
}
