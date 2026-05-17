import type { ConnectorRuntimeSemantics, ConnectorTargetActionStatus } from "../runtime.js";
import type { EndUserAnswer } from "./types.js";
import { canAccessGitHubRepository, findGitHubRepository, requestedGitHubAccessLevel } from "./githubRepoData.js";
import { findGitHubPullRequest } from "./githubPullRequestData.js";

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
  evidence?: Array<{ title: string; data: Record<string, unknown> }>;
  clarifyingQuestions?: string[];
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
  const roleHints = params.actor?.startsWith("ran@") ? ["it-support"] : params.actor?.startsWith("analyst@") ? ["read-only"] : params.actor?.startsWith("admin@") ? ["identity-admin"] : [];

  if (params.skillId === "github.pull_request.status.lookup") {
    const pr = findGitHubPullRequest(params.message);
    const repo = pr ? findGitHubRepository(pr.repo) : findGitHubRepository(params.message);
    if (!pr || !repo) {
      return {
        summary: "GitHub pull request lookup needs a repository and PR number.",
        probableCause: "The request did not include enough pull request context.",
        recommendedActions: ["Ask for the repository name and PR number."],
        clarifyingQuestions: ["Which repository and pull request number should I check?"],
        endUserAnswer: {
          title: "Which pull request should I check?",
          summary: "I need the repository name and PR number to check pull request status.",
          whatWasChecked: "No pull request lookup was performed because the target was incomplete.",
          whatWasChanged: "No changes were made.",
          nextStep: "Send a repository and PR number, for example billing-api PR 42.",
          severity: "info",
          safeToDisplay: true
        }
      };
    }

    if (!canAccessGitHubRepository(repo, params.actor, roleHints)) {
      return {
        summary: "GitHub pull request lookup was denied by repository visibility rules.",
        probableCause: "The repository is not associated with the actor or allowed groups in the connector mock data.",
        recommendedActions: ["Ask the repository owner for access or open a support ticket with the repository name."],
        evidence: [{ title: "GitHub repository visibility check", data: { repo: repo.name, actor: params.actor, status: "blocked" } }],
        endUserAnswer: {
          title: "I cannot show that pull request",
          summary: "I cannot show this pull request because the repository is not associated with your user or allowed groups.",
          whatWasChecked: "Repository visibility and pull request access were checked.",
          whatWasChanged: "No changes were made.",
          nextStep: "Ask the repository owner to grant access, or open a support ticket with the repository name.",
          severity: "medium",
          safeToDisplay: true
        }
      };
    }

    return {
      summary: `${repo.name} PR ${pr.number} is ${pr.status}. ${pr.checks}`,
      probableCause: pr.blockers.length ? pr.blockers.join("; ") : "No blocking checks or reviews are recorded.",
      recommendedActions: [pr.nextStep],
      evidence: [{ title: "GitHub pull request lookup", data: { repo: repo.name, pr: pr.number, status: pr.status, checks: pr.checks, reviewers: pr.reviewers, access: "allowed" } }],
      endUserAnswer: {
        title: `${repo.name} PR ${pr.number}: ${pr.status}`,
        summary: `${pr.title}. Checks: ${pr.checks}. Reviewers: ${pr.reviewers.join(", ")}.`,
        whatWasChecked: "Repository access, pull request status, checks, reviewers, and blockers.",
        whatWasChanged: "No changes were made.",
        nextStep: pr.nextStep,
        severity: pr.blockers.length ? "medium" : "info",
        safeToDisplay: true
      }
    };
  }

  if (params.skillId === "github.repository.access.prepare") {
    const repo = findGitHubRepository(params.message);
    const level = requestedGitHubAccessLevel(params.message);
    if (!repo || !level) {
      return {
        summary: "GitHub repository access request needs more detail.",
        probableCause: "The request did not include a clear repository or access level.",
        recommendedActions: ["Ask for repository name, read/write/admin level, business justification, and duration."],
        clarifyingQuestions: [
          repo ? "What access level do you need: read, write, or admin?" : "Which repository do you need access to?",
          "What is the business justification and expected duration?"
        ],
        endUserAnswer: {
          title: "I can prepare the repository access request",
          summary: "I need the repository name and access level first.",
          whatWasChecked: "Repository access request requirements were checked.",
          whatWasChanged: "No changes were made.",
          nextStep: "Send the repository name and access level: read, write, or admin.",
          severity: "info",
          safeToDisplay: true
        }
      };
    }

    return {
      summary: `Prepared GitHub ${repo.name} ${level} access request guidance.`,
      probableCause: "This is an access request preparation flow, not an access grant.",
      recommendedActions: [`Use ${repo.accessRequestUrl} and include business justification and duration.`],
      evidence: [{ title: "GitHub repository access request", data: { repo: repo.name, requestedAccessLevel: level, ownerTeam: repo.ownerTeam } }],
      endUserAnswer: {
        title: `${repo.name} access request`,
        summary: `Request ${level} access from ${repo.ownerTeam}. Repository visibility: ${repo.visibility}.`,
        whatWasChecked: "Repository owner, visibility, access request path, and requested level.",
        whatWasChanged: "No changes were made. No repository access was granted.",
        nextStep: "Prepare the business justification, requested duration, and access level before submitting the request.",
        severity: level === "admin" ? "medium" : "low",
        safeToDisplay: true
      }
    };
  }

  if (params.skillId === "github.repository.permission.inspect") {
    const repo = findGitHubRepository(params.message);
    if (repo) {
      return {
        summary: `GitHub repository permission inspection completed for ${repo.name}.`,
        probableCause: repo.appInstallationStatus ?? "Repository access depends on GitHub App installation scope and repository permissions.",
        recommendedActions: [
          "Check GitHub App installation access for the repository.",
          "Verify repository metadata and contents permissions.",
          "Ask the repository owner to approve any access change."
        ],
        evidence: [{ title: "GitHub repository permission inspection", data: { repo: repo.name, ownerTeam: repo.ownerTeam, appInstallationStatus: repo.appInstallationStatus } }],
        endUserAnswer: {
          title: `I checked ${repo.name} access`,
          summary: repo.appInstallationStatus ?? "The repository may not be available to the connected GitHub app or current access configuration.",
          whatWasChecked: "Repository visibility, app installation access, metadata access, and owner team.",
          whatWasChanged: "No changes were made.",
          nextStep: "Ask the repository owner to review GitHub App installation access and requested permissions.",
          severity: "medium",
          safeToDisplay: true
        }
      };
    }

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
    probableCause: findGitHubRepository(params.message)?.rateLimitStatus ?? diagnosticCause("repository sync or mutation operation", params.runtimeSemantics.targetActionStatus),
    recommendedActions: diagnosticActions(
      params.runtimeSemantics.targetActionLabel ?? "Sync GitHub repository",
      params.runtimeSemantics.targetActionStatus
    ),
    evidence: findGitHubRepository(params.message)
      ? [{ title: "GitHub repository sync evidence", data: { repo: findGitHubRepository(params.message)?.name, rateLimitStatus: findGitHubRepository(params.message)?.rateLimitStatus, appInstallationStatus: findGitHubRepository(params.message)?.appInstallationStatus } }]
      : undefined,
    endUserAnswer: {
      title: "I found a GitHub API capacity issue",
      summary: findGitHubRepository(params.message)?.rateLimitStatus ?? "Repository sync appears to be affected by API rate limits or repository access configuration.",
      whatWasChecked: "Repository access, installation context, and rate-limit related signals were checked.",
      whatWasChanged: "No changes were made.",
      nextStep: "Retry after the rate-limit window resets or ask the repository owner to review app access.",
      severity: "medium",
      safeToDisplay: true
    }
  };
}
