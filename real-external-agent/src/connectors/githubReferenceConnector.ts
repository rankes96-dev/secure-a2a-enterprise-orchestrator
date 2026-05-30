import type { ConnectorProfile, ConnectorSkillRequirement } from "./types.js";

const githubSkills: ConnectorSkillRequirement[] = [
  {
    id: "github.pull_request.status.lookup",
    label: "Look up GitHub pull request status",
    description: "Return an end-user-safe pull request status summary when the actor can access the repository.",
    requiredApplicationGrants: ["repo.pull_requests.read"],
    requiredEffectivePermissions: ["installation:repo_access", "repo:pull_requests:read"],
    requestedScopes: ["repo.pull_requests.read"],
    executionType: "inspection_read_only"
  },
  {
    id: "github.repository.access.prepare",
    label: "Prepare GitHub repository access request",
    description: "Prepare a repository access request without granting access.",
    requiredApplicationGrants: ["repo.metadata.read"],
    requiredEffectivePermissions: ["installation:repo_access", "repo:metadata:read"],
    requestedScopes: ["repo.metadata.read"],
    executionType: "inspection_read_only"
  },
  {
    id: "github.repository.rate_limit.diagnose",
    label: "Diagnose GitHub repository API rate limit",
    description: "Inspect repository metadata and installation context that affect GitHub API rate limits.",
    requiredApplicationGrants: ["repo.metadata.read"],
    requiredEffectivePermissions: ["installation:repo_access", "org:rate_limit:read"],
    requestedScopes: ["repo.metadata.read"],
    executionType: "diagnostic_read_only",
    diagnosesActionId: "github.repository.sync",
    diagnosesActionLabel: "Sync GitHub repository"
  },
  {
    id: "github.repository.permission.inspect",
    label: "Inspect GitHub repository permissions",
    description: "Review GitHub App installation and repository metadata permissions.",
    requiredApplicationGrants: ["repo.metadata.read"],
    requiredEffectivePermissions: ["installation:repo_access", "repo:metadata:read"],
    requestedScopes: ["repo.metadata.read"],
    executionType: "inspection_read_only"
  },
  {
    id: "github.pull_request.access.diagnose",
    label: "Diagnose GitHub pull request access",
    description: "Inspect pull request read access and repository permission requirements.",
    requiredApplicationGrants: ["repo.pull_requests.read"],
    requiredEffectivePermissions: ["repo:pull_requests:read"],
    requestedScopes: ["repo.pull_requests.read"],
    executionType: "diagnostic_read_only",
    diagnosesActionId: "github.pull_request.read_checks",
    diagnosesActionLabel: "Read pull request checks"
  },
  {
    id: "github.repository.sync",
    label: "Sync GitHub repository",
    description: "Read repository metadata and contents for repository synchronization workflows.",
    requiredApplicationGrants: ["repo.metadata.read", "repo.contents.read"],
    requiredEffectivePermissions: ["installation:repo_access", "repo:metadata:read", "repo:contents:read"],
    requestedScopes: ["repo.metadata.read", "repo.contents.read"],
    executionType: "inspection_read_only"
  },
  {
    id: "github.pull_request.read_checks",
    label: "Read pull request checks",
    description: "Read pull request checks and related repository metadata.",
    requiredApplicationGrants: ["repo.pull_requests.read"],
    requiredEffectivePermissions: ["installation:repo_access", "repo:pull_requests:read"],
    requestedScopes: ["repo.pull_requests.read"],
    executionType: "inspection_read_only"
  }
];

const githubRuntimeSkills = githubSkills.filter((skill) =>
  skill.id !== "github.repository.sync" && skill.id !== "github.pull_request.read_checks"
);

export const githubReferenceConnector: ConnectorProfile = {
  resourceSystem: "github",
  connectorId: "github-reference",
  displayName: "GitHub Reference Connector",
  version: "1.0.0",
  profileSource: "external_agent",
  planning: {
    supported: false,
    description: "Planning handler not implemented in the V1 GitHub reference connector.",
    supportedIntentClasses: []
  },
  applicationAccessGrantCatalog: [
    {
      id: "repo.metadata.read",
      label: "Read repository metadata",
      description: "Allows the connected app to read repository metadata."
    },
    {
      id: "repo.contents.read",
      label: "Read repository contents",
      description: "Allows the connected app to read repository contents."
    },
    {
      id: "repo.issues.read",
      label: "Read repository issues",
      description: "Allows the connected app to read repository issues."
    },
    {
      id: "repo.pull_requests.read",
      label: "Read pull requests",
      description: "Allows the connected app to read pull request metadata."
    },
    {
      id: "repo.administration.read",
      label: "Read repository administration",
      description: "Allows the connected app to inspect repository administration settings."
    }
  ],
  effectivePermissionCatalog: [
    {
      id: "installation:repo_access",
      label: "Repository installation access",
      description: "GitHub App installation includes the target repository."
    },
    {
      id: "repo:metadata:read",
      label: "Read repository metadata",
      description: "Installation can read repository metadata."
    },
    {
      id: "repo:contents:read",
      label: "Read repository contents",
      description: "Installation can read repository contents."
    },
    {
      id: "repo:issues:read",
      label: "Read repository issues",
      description: "Installation can read repository issues."
    },
    {
      id: "repo:pull_requests:read",
      label: "Read pull requests",
      description: "Installation can read pull requests."
    },
    {
      id: "org:rate_limit:read",
      label: "Read rate-limit usage",
      description: "Installation can inspect organization or installation API rate-limit usage."
    }
  ],
  skillCatalog: githubRuntimeSkills,
  actionCatalog: githubSkills,
  validationTests: [
    {
      id: "github.repository.rate_limit.diagnose.validation",
      title: "GitHub repository rate-limit diagnosis",
      category: "approved_diagnostic",
      persona: "bizapps_it",
      description: "Validates the approved read-only GitHub repository rate-limit diagnostic skill.",
      proves: "GitHub repository rate-limit diagnostics execute through the installed connector using read-only access.",
      steps: [
        { message: "GitHub repository sync is failing after API rate limit", expectedOutcome: "diagnosed" }
      ],
      expectedFinalOutcome: "diagnosed",
      requiresRuntimeReady: true,
      referenceOnly: true
    },
    {
      id: "github.pull_request.access.diagnose.validation",
      title: "GitHub pull request access diagnosis",
      category: "approved_diagnostic",
      persona: "bizapps_it",
      description: "Validates the approved read-only GitHub pull request access diagnostic skill.",
      proves: "GitHub pull request access diagnostics execute without write or administration access.",
      steps: [
        { message: "GitHub pull request checks cannot read the repository", expectedOutcome: "diagnosed" }
      ],
      expectedFinalOutcome: "diagnosed",
      requiresRuntimeReady: true,
      referenceOnly: true
    },
    {
      id: "github.pull_request.status.lookup.validation",
      title: "GitHub pull request status lookup",
      category: "approved_diagnostic",
      persona: "end_user",
      description: "Validates end-user pull request status lookup with repository visibility checks.",
      proves: "GitHub-owned runtime data answers PR status without Gateway hardcoding repository details.",
      steps: [
        { message: "What is the status of PR 42 in billing-api?", expectedOutcome: "diagnosed" }
      ],
      expectedFinalOutcome: "diagnosed",
      requiresRuntimeReady: true,
      referenceOnly: true
    },
    {
      id: "github.repository.access.prepare.validation",
      title: "GitHub repository access request preparation",
      category: "end_user_planning",
      persona: "end_user",
      description: "Validates repository access request preparation without granting access.",
      proves: "The connector prepares access guidance and accurately states no repository access was granted.",
      steps: [
        { message: "I need access to the billing-api repo", expectedOutcome: "diagnosed" }
      ],
      expectedFinalOutcome: "diagnosed",
      requiresRuntimeReady: true,
      referenceOnly: true
    }
  ],
  demoDefaults: {
    oauthApplication: {
      appName: "GitHub Agent Connected App",
      defaultApplicationAccessGrants: ["repo.metadata.read", "repo.contents.read", "repo.issues.read", "repo.pull_requests.read"]
    },
    servicePrincipal: {
      principalId: "svc-a2a-github-agent",
      defaultEffectivePermissions: ["installation:repo_access", "repo:metadata:read", "repo:contents:read", "repo:issues:read", "repo:pull_requests:read", "org:rate_limit:read"],
      defaultDeniedPermissions: []
    }
  }
};
