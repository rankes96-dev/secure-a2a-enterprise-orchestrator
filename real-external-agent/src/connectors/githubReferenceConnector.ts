import type { ConnectorProfile, ConnectorSkillRequirement } from "./types.js";

const githubSkills: ConnectorSkillRequirement[] = [
  {
    id: "github.repository.rate_limit.diagnose",
    label: "Diagnose GitHub repository API rate limit",
    description: "Inspect repository metadata and installation context that affect GitHub API rate limits.",
    requiredApplicationGrants: ["repo.metadata.read"],
    requiredEffectivePermissions: ["installation:repo_access", "org:rate_limit:read"],
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
    executionType: "inspection_read_only"
  },
  {
    id: "github.pull_request.access.diagnose",
    label: "Diagnose GitHub pull request access",
    description: "Inspect pull request read access and repository permission requirements.",
    requiredApplicationGrants: ["repo.pull_requests.read"],
    requiredEffectivePermissions: ["repo:pull_requests:read"],
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
    executionType: "inspection_read_only"
  },
  {
    id: "github.pull_request.read_checks",
    label: "Read pull request checks",
    description: "Read pull request checks and related repository metadata.",
    requiredApplicationGrants: ["repo.pull_requests.read"],
    requiredEffectivePermissions: ["installation:repo_access", "repo:pull_requests:read"],
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
